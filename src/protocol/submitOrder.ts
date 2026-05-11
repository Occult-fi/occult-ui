import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import type { OccultState } from './state';
import { deriveBatch, deriveOrderTicket } from './pdas';
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
import { confidentialTransferIx, submitOrderIx } from './instructions';

export type WalletSigner = {
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]>;
};

export type SubmitOrderParams = {
  state: OccultState;
  // Defaults to the primary pool when omitted.
  pool?: PublicKey;
  side: 0 | 1;
  amount: bigint;
  payer: PublicKey;
  user: PublicKey;
  sourceTokenAccount: PublicKey;
  userElGamalKeypair: Uint8Array;
  userAesKey: Uint8Array;
};

export type SubmitPhase =
  | 'reading'
  | 'encrypting'
  | 'signing'
  | 'preflight'
  | 'preflight-range-verify'
  | 'submitting'
  | 'cleanup'
  | 'done';

export type SubmitOrderResult = {
  ticket: PublicKey;
  batch: PublicKey;
  batchId: bigint;
  mainSignature: string;
  signatures: string[];
};

export async function submitOrder(
  connection: Connection,
  wallet: WalletSigner,
  params: SubmitOrderParams,
  onPhase?: (p: SubmitPhase) => void
): Promise<SubmitOrderResult> {
  const setPhase = (p: SubmitPhase) => onPhase?.(p);

  setPhase('reading');
  const poolAddress = params.pool ?? params.state.primaryPool.address;
  const [pool, sourceAcc] = await Promise.all([
    fetchPool(connection, poolAddress),
    fetchConfidentialAccount(connection, params.sourceTokenAccount),
  ]);

  if (!sourceAcc.approved) {
    throw new Error('source token account is not approved for confidential transfers');
  }

  setPhase('encrypting');
  const proofs = await generateTransferProofs({
    source_elgamal_keypair: params.userElGamalKeypair,
    source_aes_key: params.userAesKey,
    current_available_balance: sourceAcc.availableBalance,
    current_decryptable_available_balance: sourceAcc.decryptableAvailableBalance,
    transfer_amount: params.amount,
    destination_elgamal_pubkey: params.state.auditorElGamalPubkey,
    auditor_elgamal_pubkey: params.state.auditorElGamalPubkey,
  });

  const validityKp = Keypair.generate();
  const equalityKp = Keypair.generate();
  const rangeKp = Keypair.generate();

  const inputVault = params.side === 0 ? pool.vaultA : pool.vaultB;
  const inputMint = params.side === 0 ? pool.mintA : pool.mintB;

  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const [equalityRent, validityRent, rangeRent] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(CTX_LEN.equality),
    connection.getMinimumBalanceForRentExemption(CTX_LEN.validity3Handles),
    connection.getMinimumBalanceForRentExemption(CTX_LEN.rangeBatched),
  ]);

  const build = (ixs: TransactionInstruction[]) => {
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = blockhash;
    tx.feePayer = params.payer;
    return tx;
  };

  const tx1 = build([
    createContextStateAccountIx(
      params.payer,
      validityKp.publicKey,
      CTX_LEN.validity3Handles,
      BigInt(validityRent)
    ),
    verifyValidityProof3HandlesIx(
      proofs.validity_proof,
      validityKp.publicKey,
      params.payer
    ),
  ]);
  const tx2 = build([
    createContextStateAccountIx(
      params.payer,
      equalityKp.publicKey,
      CTX_LEN.equality,
      BigInt(equalityRent)
    ),
    verifyEqualityProofIx(proofs.equality_proof, equalityKp.publicKey, params.payer),
  ]);
  const tx3 = build([
    createContextStateAccountIx(
      params.payer,
      rangeKp.publicKey,
      CTX_LEN.rangeBatched,
      BigInt(rangeRent)
    ),
  ]);
  const tx4 = build([
    verifyRangeProofU128Ix(proofs.range_proof, rangeKp.publicKey, params.payer),
  ]);
  const tx6 = build([
    closeContextStateIx(validityKp.publicKey, params.payer, params.payer),
    closeContextStateIx(equalityKp.publicKey, params.payer, params.payer),
    closeContextStateIx(rangeKp.publicKey, params.payer, params.payer),
  ]);

  tx1.partialSign(validityKp);
  tx2.partialSign(equalityKp);
  tx3.partialSign(rangeKp);

  setPhase('signing');
  const [s1, s2, s3, s4, s6] = await wallet.signAllTransactions([tx1, tx2, tx3, tx4, tx6]);

  setPhase('preflight');
  const [sigValidity, sigEquality, sigRangeCreate] = await Promise.all([
    sendAndConfirm(connection, s1),
    sendAndConfirm(connection, s2),
    sendAndConfirm(connection, s3),
  ]);

  setPhase('preflight-range-verify');
  const sigRangeVerify = await sendAndConfirm(connection, s4);

  // Refetch current_batch_id: settler may have advanced it during preflight.
  // On-chain submit_order rejects mismatch (OrderBatchMismatch), so we resync here.
  const pool2 = await fetchPool(connection, poolAddress);
  const batchId = pool2.currentBatchId;
  const [batchPda, batchBump] = deriveBatch(
    params.state.programId,
    poolAddress,
    batchId
  );
  const [ticketPda, ticketBump] = deriveOrderTicket(
    params.state.programId,
    poolAddress,
    params.user,
    batchId
  );

  const tx5 = build([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }),
    submitOrderIx({
      programId: params.state.programId,
      payer: params.payer,
      user: params.user,
      pool: poolAddress,
      batch: batchPda,
      orderTicket: ticketPda,
      validityCtx: validityKp.publicKey,
      side: params.side,
      batchBump,
      ticketBump,
      transferIxOffset: 1,
    }),
    confidentialTransferIx({
      source: params.sourceTokenAccount,
      mint: inputMint,
      destination: inputVault,
      equalityCtx: equalityKp.publicKey,
      validityCtx: validityKp.publicKey,
      rangeCtx: rangeKp.publicKey,
      authority: params.user,
      newSourceDecryptableBalance: proofs.new_decryptable_balance,
      auditorCiphertextLo: proofs.auditor_ciphertext_lo,
      auditorCiphertextHi: proofs.auditor_ciphertext_hi,
    }),
  ]);
  const s5 = await wallet.signTransaction(tx5);

  setPhase('submitting');
  const sigMain = await sendAndConfirm(connection, s5);

  setPhase('cleanup');
  const sigCleanup = await sendAndConfirm(connection, s6);

  setPhase('done');
  return {
    ticket: ticketPda,
    batch: batchPda,
    batchId,
    mainSignature: sigMain,
    signatures: [sigValidity, sigEquality, sigRangeCreate, sigRangeVerify, sigMain, sigCleanup],
  };
}

async function sendAndConfirm(connection: Connection, tx: Transaction): Promise<string> {
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
