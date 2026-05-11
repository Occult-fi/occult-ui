import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from '@solana/web3.js';
import { fetchPool } from './poolAccount';
import { fetchConfidentialAccount } from './confidentialAccount';
import { aesDecrypt, aesEncrypt, generateTransferProofs } from '../wasm/proofs';
import {
  CTX_LEN,
  closeContextStateIx,
  createContextStateAccountIx,
  verifyEqualityProofIx,
  verifyRangeProofU128Ix,
  verifyValidityProof3HandlesIx,
} from './zkProofIxs';
import { createRemoveLiquidityInstruction } from './generated/instructions/RemoveLiquidity';
import { TOKEN_2022_PROGRAM_ID } from './instructions';
import { derivePool } from './pdas';
import { confidentialTransferIx } from './confTransfer';

export type RemoveLiquidityPhase =
  | 'reading'
  | 'proof-gen'
  | 'preflight'
  | 'main'
  | 'cleanup'
  | 'done';

export type WalletSigner = {
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

export type RemoveLiquidityParams = {
  programId: PublicKey;
  pool: PublicKey;
  user: PublicKey;
  payer: PublicKey;
  userTokenA: PublicKey;
  userTokenB: PublicKey;
  userLp: PublicKey;
  lpAmount: bigint;
  slippageBps: number;
  userElGamalKeypair: Uint8Array;
  userAesKey: Uint8Array;
  auditorElGamalKeypair: Uint8Array;
  auditorAesKey: Uint8Array;
};

export type RemoveLiquidityResult = {
  amountA: bigint;
  amountB: bigint;
  mainSig: string;
};

async function readMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
  const acc = await connection.getAccountInfo(mint, 'confirmed');
  if (!acc || acc.data.length < 45) throw new Error(`mint ${mint.toBase58()} unreadable`);
  return acc.data[44];
}

type ProofTriple = {
  validity: Keypair;
  equality: Keypair;
  range: Keypair;
};

function freshTriple(): ProofTriple {
  return {
    validity: Keypair.generate(),
    equality: Keypair.generate(),
    range: Keypair.generate(),
  };
}

async function rentLamports(connection: Connection): Promise<{
  validity: bigint;
  equality: bigint;
  range: bigint;
}> {
  const [v, e, r] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(CTX_LEN.validity3Handles),
    connection.getMinimumBalanceForRentExemption(CTX_LEN.equality),
    connection.getMinimumBalanceForRentExemption(CTX_LEN.rangeBatched),
  ]);
  return { validity: BigInt(v), equality: BigInt(e), range: BigInt(r) };
}

export async function executeRemoveLiquidity(
  connection: Connection,
  wallet: WalletSigner,
  params: RemoveLiquidityParams,
  onPhase?: (p: RemoveLiquidityPhase) => void,
): Promise<RemoveLiquidityResult> {
  onPhase?.('reading');

  const pool = await fetchPool(connection, params.pool);
  if (pool.lpMint.equals(PublicKey.default)) throw new Error('pool has no lp_mint');
  if (pool.lpSupply === 0n) throw new Error('pool has no LP issued');
  if (params.lpAmount > pool.lpSupply) throw new Error('lp_amount > lp_supply');

  const [, poolBump] = derivePool(params.programId, pool.mintA, pool.mintB);
  const [decimalsA, decimalsB] = await Promise.all([
    readMintDecimals(connection, pool.mintA),
    readMintDecimals(connection, pool.mintB),
  ]);

  const amountA = (params.lpAmount * pool.reserveA) / pool.lpSupply;
  const amountB = (params.lpAmount * pool.reserveB) / pool.lpSupply;
  const minA = (amountA * BigInt(10_000 - params.slippageBps)) / 10_000n;
  const minB = (amountB * BigInt(10_000 - params.slippageBps)) / 10_000n;

  const [vaultA, vaultB, userLpAcc, userAAcc, userBAcc, lpEscrow] = await Promise.all([
    fetchConfidentialAccount(connection, pool.vaultA),
    fetchConfidentialAccount(connection, pool.vaultB),
    fetchConfidentialAccount(connection, params.userLp),
    fetchConfidentialAccount(connection, params.userTokenA),
    fetchConfidentialAccount(connection, params.userTokenB),
    fetchConfidentialAccount(connection, pool.lpEscrowShielded),
  ]);

  const userLpPlain = await aesDecrypt(params.userAesKey, userLpAcc.decryptableAvailableBalance);
  if (params.lpAmount > userLpPlain) throw new Error('user has insufficient LP balance');
  const userLpNewDec = await aesEncrypt(params.userAesKey, userLpPlain - params.lpAmount);

  const [vaultAPlain, vaultBPlain] = await Promise.all([
    aesDecrypt(params.auditorAesKey, vaultA.decryptableAvailableBalance),
    aesDecrypt(params.auditorAesKey, vaultB.decryptableAvailableBalance),
  ]);
  const newVaultADec = await aesEncrypt(params.auditorAesKey, vaultAPlain - amountA);
  const newVaultBDec = await aesEncrypt(params.auditorAesKey, vaultBPlain - amountB);

  onPhase?.('proof-gen');
  const auditorPub = params.auditorElGamalKeypair.slice(0, 32);
  console.log('[remove-liq] proof-gen lp (user_lp →  lp_escrow), amount=', params.lpAmount.toString());
  const lpProofs = await generateTransferProofs({
    source_elgamal_keypair: params.userElGamalKeypair,
    source_aes_key: params.userAesKey,
    current_available_balance: userLpAcc.availableBalance,
    current_decryptable_available_balance: userLpAcc.decryptableAvailableBalance,
    transfer_amount: params.lpAmount,
    destination_elgamal_pubkey: lpEscrow.elgamalPubkey,
    auditor_elgamal_pubkey: auditorPub,
  });
  console.log('[remove-liq] proof-gen vault_a (vault_a → user_a), amount=', amountA.toString());
  console.log('[remove-liq] vault_a aes-decrypted plain:', vaultAPlain.toString());
  console.log('[remove-liq] vault_a available_balance hex:', Buffer.from(vaultA.availableBalance).toString('hex'));
  console.log('[remove-liq] vault_a decryptable hex:', Buffer.from(vaultA.decryptableAvailableBalance).toString('hex'));
  const transferAProofs = await generateTransferProofs({
    source_elgamal_keypair: params.auditorElGamalKeypair,
    source_aes_key: params.auditorAesKey,
    current_available_balance: vaultA.availableBalance,
    current_decryptable_available_balance: vaultA.decryptableAvailableBalance,
    transfer_amount: amountA,
    destination_elgamal_pubkey: userAAcc.elgamalPubkey,
    auditor_elgamal_pubkey: auditorPub,
  });
  console.log('[remove-liq] proof-gen vault_b (vault_b → user_b), amount=', amountB.toString());
  const transferBProofs = await generateTransferProofs({
    source_elgamal_keypair: params.auditorElGamalKeypair,
    source_aes_key: params.auditorAesKey,
    current_available_balance: vaultB.availableBalance,
    current_decryptable_available_balance: vaultB.decryptableAvailableBalance,
    transfer_amount: amountB,
    destination_elgamal_pubkey: userBAcc.elgamalPubkey,
    auditor_elgamal_pubkey: auditorPub,
  });

  const lpKp = freshTriple();
  const aKp = freshTriple();
  const bKp = freshTriple();
  const rent = await rentLamports(connection);

  const send = async (tx: Transaction, extra: Keypair[] = []) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = params.payer;
    if (extra.length) tx.partialSign(...extra);
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    return sig;
  };

  onPhase?.('preflight');

  type ProofGroup = {
    triple: ProofTriple;
    proofs: { validity_proof: Uint8Array; equality_proof: Uint8Array; range_proof: Uint8Array };
  };
  const groups: { name: string; triple: ProofTriple; proofs: ProofGroup['proofs'] }[] = [
    { name: 'lp', triple: lpKp, proofs: lpProofs },
    { name: 'vault_a', triple: aKp, proofs: transferAProofs },
    { name: 'vault_b', triple: bKp, proofs: transferBProofs },
  ];

  for (const g of groups) {
    console.log(`[remove-liq] preflight ${g.name}: validity`);
    await send(
      new Transaction().add(
        createContextStateAccountIx(
          params.payer,
          g.triple.validity.publicKey,
          CTX_LEN.validity3Handles,
          rent.validity,
        ),
        verifyValidityProof3HandlesIx(g.proofs.validity_proof, g.triple.validity.publicKey, params.payer),
      ),
      [g.triple.validity],
    );
    console.log(`[remove-liq] preflight ${g.name}: equality`);
    await send(
      new Transaction().add(
        createContextStateAccountIx(
          params.payer,
          g.triple.equality.publicKey,
          CTX_LEN.equality,
          rent.equality,
        ),
        verifyEqualityProofIx(g.proofs.equality_proof, g.triple.equality.publicKey, params.payer),
      ),
      [g.triple.equality],
    );
    await send(
      new Transaction().add(
        createContextStateAccountIx(
          params.payer,
          g.triple.range.publicKey,
          CTX_LEN.rangeBatched,
          rent.range,
        ),
      ),
      [g.triple.range],
    );
    await send(
      new Transaction().add(
        verifyRangeProofU128Ix(g.proofs.range_proof, g.triple.range.publicKey, params.payer),
      ),
    );
  }

  onPhase?.('main');
  const lpBurnIx = confidentialTransferIx({
    source: params.userLp,
    mint: pool.lpMint,
    destination: pool.lpEscrowShielded,
    equalityCtx: lpKp.equality.publicKey,
    validityCtx: lpKp.validity.publicKey,
    rangeCtx: lpKp.range.publicKey,
    authority: params.user,
    authoritySigner: true,
    newSourceDecryptable: userLpNewDec,
    auditorCiphertextLo: lpProofs.auditor_ciphertext_lo,
    auditorCiphertextHi: lpProofs.auditor_ciphertext_hi,
  });

  const removeIx = createRemoveLiquidityInstruction(
    {
      payer: params.payer,
      user: params.user,
      pool: params.pool,
      mintA: pool.mintA,
      mintB: pool.mintB,
      poolVaultA: pool.vaultA,
      poolVaultB: pool.vaultB,
      lpMint: pool.lpMint,
      lpEscrowShielded: pool.lpEscrowShielded,
      userLpShielded: params.userLp,
      userTokenA: params.userTokenA,
      userTokenB: params.userTokenB,
      equalityCtxLp: lpKp.equality.publicKey,
      validityCtxLp: lpKp.validity.publicKey,
      rangeCtxLp: lpKp.range.publicKey,
      equalityCtxA: aKp.equality.publicKey,
      validityCtxA: aKp.validity.publicKey,
      rangeCtxA: aKp.range.publicKey,
      equalityCtxB: bKp.equality.publicKey,
      validityCtxB: bKp.validity.publicKey,
      rangeCtxB: bKp.range.publicKey,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    },
    {
      removeLiquidityArgs: {
        lpAmount: params.lpAmount,
        minAmountA: minA,
        minAmountB: minB,
        poolBump,
        decimalsA,
        decimalsB,
        pad: [0, 0, 0, 0, 0],
        vaultANewSourceDecryptable: Array.from(newVaultADec),
        pad2: [0, 0, 0, 0],
        vaultBNewSourceDecryptable: Array.from(newVaultBDec),
        pad3: [0, 0, 0, 0],
      },
    },
    params.programId,
  );

  const mainSig = await send(
    new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      lpBurnIx,
      removeIx,
    ),
  );

  onPhase?.('cleanup');
  for (const g of groups) {
    for (const k of [g.triple.validity, g.triple.equality, g.triple.range]) {
      await send(new Transaction().add(closeContextStateIx(k.publicKey, params.payer, params.payer)));
    }
  }

  onPhase?.('done');
  return { amountA, amountB, mainSig };
}
