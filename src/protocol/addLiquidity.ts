import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { fetchPool } from './poolAccount';
import { fetchConfidentialAccount } from './confidentialAccount';
import { generateTransferProofs } from '../wasm/proofs';
import {
  CTX_LEN,
  closeContextStateIx,
  createContextStateAccountIx,
  verifyEqualityProofIx,
  verifyRangeProofU128Ix,
  verifyValidityProof3HandlesIx,
} from './zkProofIxs';
import { confidentialTransferIx } from './confTransfer';
import { createLpDepositRequestInstruction } from './generated/instructions/LpDepositRequest';
import { deriveLpDepositRequest } from './pdas';
import { computeLpOut, applySlippage } from './liquidityMath';
import { ComputeBudgetProgram } from '@solana/web3.js';

export type AddLiquidityPhase =
  | 'reading'
  | 'side-a-proofs'
  | 'side-a-preflight'
  | 'side-a-transfer'
  | 'side-a-cleanup'
  | 'side-b-proofs'
  | 'side-b-preflight'
  | 'side-b-transfer'
  | 'side-b-cleanup'
  | 'request'
  | 'awaiting-finalize'
  | 'done';

export type WalletSigner = {
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

export type AddLiquidityParams = {
  programId: PublicKey;
  pool: PublicKey;
  user: PublicKey;
  payer: PublicKey;
  userTokenA: PublicKey;
  userTokenB: PublicKey;
  userLp: PublicKey;
  amountA: bigint;
  amountB: bigint;
  slippageBps: number;
  /** User's ElGamal keypair (64 bytes). Used to encrypt the deposit
   *  amount on the user side. In v1 demo this is the same key as the
   *  auditor's (single-key trust). */
  userElGamalKeypair: Uint8Array;
  /** User's AES key (16 bytes). Used for `decryptable_available_balance`
   *  on the user-side source token account. */
  userAesKey: Uint8Array;
  /** Auditor (pool) ElGamal pubkey (32 bytes). Encrypted into proofs
   *  so the pool authority can decrypt amount off-chain. */
  auditorElGamalPubkey: Uint8Array;
};

export type AddLiquidityResult = {
  requestPda: PublicKey;
  requestCounter: bigint;
  /** Estimate of LP tokens user will receive once auditor finalizes. */
  lpOutEstimate: bigint;
  /** Slippage-protected floor stored in the request PDA. */
  minLpOut: bigint;
  /** Last user-signed tx signature (the LpDepositRequest submission). */
  requestSig: string;
};

export async function executeAddLiquidity(
  connection: Connection,
  wallet: WalletSigner,
  params: AddLiquidityParams,
  onPhase?: (p: AddLiquidityPhase) => void,
): Promise<AddLiquidityResult> {
  onPhase?.('reading');

  const pool = await fetchPool(connection, params.pool);
  if (pool.lpMint.equals(PublicKey.default)) {
    throw new Error('pool has no lp_mint — InitLpMint not run');
  }

  // Off-chain CPMM math for slippage bound.
  const { lpOut } = computeLpOut(
    params.amountA,
    params.amountB,
    pool.reserveA,
    pool.reserveB,
    pool.lpSupply,
  );
  const minLpOut = applySlippage(lpOut, params.slippageBps);

  // === Side A: standalone ConfTransfer user_token_a → pool_vault_a ====
  await runConfTransfer(
    connection,
    wallet,
    {
      payer: params.payer,
      user: params.user,
      source: params.userTokenA,
      mint: pool.mintA,
      destination: pool.depositVaultA,
      amount: params.amountA,
      userElGamalKeypair: params.userElGamalKeypair,
      userAesKey: params.userAesKey,
      auditorElGamalPubkey: params.auditorElGamalPubkey,
    },
    'side-a',
    onPhase,
  );

  // === Side B: standalone ConfTransfer user_token_b → pool_vault_b ====
  await runConfTransfer(
    connection,
    wallet,
    {
      payer: params.payer,
      user: params.user,
      source: params.userTokenB,
      mint: pool.mintB,
      destination: pool.depositVaultB,
      amount: params.amountB,
      userElGamalKeypair: params.userElGamalKeypair,
      userAesKey: params.userAesKey,
      auditorElGamalPubkey: params.auditorElGamalPubkey,
    },
    'side-b',
    onPhase,
  );

  // === LpDepositRequest PDA ===========================================
  onPhase?.('request');
  const requestCounter = BigInt(Date.now());
  const [requestPda, requestBump] = deriveLpDepositRequest(
    params.programId,
    params.pool,
    params.user,
    requestCounter,
  );
  const requestIx = createLpDepositRequestInstruction(
    {
      payer: params.payer,
      user: params.user,
      pool: params.pool,
      request: requestPda,
      userLpShielded: params.userLp,
    },
    {
      lpDepositRequestArgs: {
        amountA: params.amountA,
        amountB: params.amountB,
        minLpOut,
        requestCounter,
        requestBump,
        pad: [0, 0, 0, 0, 0, 0, 0],
      },
    },
    params.programId,
  );
  const requestSig = await sendTx(
    connection,
    wallet,
    params.payer,
    [requestIx],
    [],
  );

  onPhase?.('awaiting-finalize');
  return {
    requestPda,
    requestCounter,
    lpOutEstimate: lpOut,
    minLpOut,
    requestSig,
  };
}

// ---------------------------------------------------------------------------
// One side: generate transfer proofs, push them into context state, send
// the standalone Token-2022 Confidential Transfer, close the contexts.
// ---------------------------------------------------------------------------

type ConfTransferParams = {
  payer: PublicKey;
  user: PublicKey;
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint;
  userElGamalKeypair: Uint8Array;
  userAesKey: Uint8Array;
  auditorElGamalPubkey: Uint8Array;
};

type SideTag = 'side-a' | 'side-b';

async function runConfTransfer(
  connection: Connection,
  wallet: WalletSigner,
  p: ConfTransferParams,
  side: SideTag,
  onPhase?: (p: AddLiquidityPhase) => void,
): Promise<void> {
  onPhase?.((side === 'side-a' ? 'side-a-proofs' : 'side-b-proofs') as AddLiquidityPhase);

  // Read source confidential balance + destination ElGamal pubkey.
  const sourceConf = await fetchConfidentialAccount(connection, p.source);
  const destConf = await fetchConfidentialAccount(connection, p.destination);

  const proofs = await generateTransferProofs({
    source_elgamal_keypair: p.userElGamalKeypair,
    source_aes_key: p.userAesKey,
    current_available_balance: sourceConf.availableBalance,
    current_decryptable_available_balance: sourceConf.decryptableAvailableBalance,
    transfer_amount: p.amount,
    destination_elgamal_pubkey: destConf.elgamalPubkey,
    auditor_elgamal_pubkey: p.auditorElGamalPubkey,
  });

  const validityKp = Keypair.generate();
  const equalityKp = Keypair.generate();
  const rangeKp = Keypair.generate();
  const [validityRent, equalityRent, rangeRent] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(CTX_LEN.validity3Handles),
    connection.getMinimumBalanceForRentExemption(CTX_LEN.equality),
    connection.getMinimumBalanceForRentExemption(CTX_LEN.rangeBatched),
  ]);

  onPhase?.((side === 'side-a' ? 'side-a-preflight' : 'side-b-preflight') as AddLiquidityPhase);

  // [1] create validity ctx + verify (combined)
  await sendTx(
    connection,
    wallet,
    p.payer,
    [
      createContextStateAccountIx(
        p.payer,
        validityKp.publicKey,
        CTX_LEN.validity3Handles,
        BigInt(validityRent),
      ),
      verifyValidityProof3HandlesIx(proofs.validity_proof, validityKp.publicKey, p.payer),
    ],
    [validityKp],
  );

  // [2] create equality ctx + verify (combined)
  await sendTx(
    connection,
    wallet,
    p.payer,
    [
      createContextStateAccountIx(
        p.payer,
        equalityKp.publicKey,
        CTX_LEN.equality,
        BigInt(equalityRent),
      ),
      verifyEqualityProofIx(proofs.equality_proof, equalityKp.publicKey, p.payer),
    ],
    [equalityKp],
  );

  // [3] create range ctx (split — proof too big to combine)
  await sendTx(
    connection,
    wallet,
    p.payer,
    [
      createContextStateAccountIx(
        p.payer,
        rangeKp.publicKey,
        CTX_LEN.rangeBatched,
        BigInt(rangeRent),
      ),
    ],
    [rangeKp],
  );

  // [4] verify range proof
  await sendTx(
    connection,
    wallet,
    p.payer,
    [verifyRangeProofU128Ix(proofs.range_proof, rangeKp.publicKey, p.payer)],
    [],
  );

  onPhase?.((side === 'side-a' ? 'side-a-transfer' : 'side-b-transfer') as AddLiquidityPhase);

  // Standalone ConfTransfer.
  const transferIx = confidentialTransferIx({
    source: p.source,
    mint: p.mint,
    destination: p.destination,
    equalityCtx: equalityKp.publicKey,
    validityCtx: validityKp.publicKey,
    rangeCtx: rangeKp.publicKey,
    authority: p.user,
    authoritySigner: true,
    newSourceDecryptable: proofs.new_decryptable_balance,
    auditorCiphertextLo: proofs.auditor_ciphertext_lo,
    auditorCiphertextHi: proofs.auditor_ciphertext_hi,
  });
  await sendTx(
    connection,
    wallet,
    p.payer,
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }), transferIx],
    [],
  );

  onPhase?.((side === 'side-a' ? 'side-a-cleanup' : 'side-b-cleanup') as AddLiquidityPhase);

  // Cleanup ×3.
  for (const k of [validityKp, equalityKp, rangeKp]) {
    await sendTx(
      connection,
      wallet,
      p.payer,
      [closeContextStateIx(k.publicKey, p.payer, p.payer)],
      [],
    );
  }
}

async function sendTx(
  connection: Connection,
  wallet: WalletSigner,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  extraSigners: Keypair[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
  tx.add(...ixs);
  if (extraSigners.length) tx.partialSign(...extraSigners);
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  return sig;
}

// Suppress unused-import lint for SystemProgram (kept for future explicit
// system-program ix slots in the request path).
const _ = SystemProgram;
