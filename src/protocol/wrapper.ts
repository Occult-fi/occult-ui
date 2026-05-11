import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { SPL_TOKEN_LEGACY_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './instructions';
import { createWrapInstruction } from './generated/instructions/Wrap';
import { createUnwrapInstruction } from './generated/instructions/Unwrap';
import type { OccultState, WrapperInfo } from './state';
import { fetchConfidentialAccount } from './confidentialAccount';

export type { WrapperInfo };
import {
  aesDecrypt,
  aesEncrypt,
  generateTransferProofs,
  generateWithdrawProofs,
} from '../wasm/proofs';

const ZK_ELGAMAL_PROOF_PROGRAM_ID = new PublicKey(
  'ZkE1Gama1Proof11111111111111111111111111111'
);

const WRAPPER_SEED = Buffer.from('wrapper');

export function deriveWrapperPda(
  programId: PublicKey,
  legacyMint: PublicKey,
  shieldedMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [WRAPPER_SEED, legacyMint.toBuffer(), shieldedMint.toBuffer()],
    programId
  );
}

// SPL Token / Token-2022 TransferChecked: data = [12, amount u64 LE, decimals u8]
function transferCheckedIx(args: {
  programId: PublicKey;
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
  decimals: number;
}): TransactionInstruction {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, args.amount, true);
  data[9] = args.decimals;
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ZK ElGamal proof discriminators (solana-zk-elgamal-proof-interface 0.1.2 ProofInstruction):
//   3  VerifyCiphertextCommitmentEquality              ← wrap + unwrap
//   6  VerifyBatchedRangeProofU64                       ← unwrap
//   7  VerifyBatchedRangeProofU128                      ← wrap (Transfer)
//   12 VerifyBatchedGroupedCiphertext3HandlesValidity   ← wrap (Transfer)
function verifyProofIx(args: {
  proofKind: 'equality' | 'rangeU64' | 'rangeU128' | 'validity3h';
  proofData: Uint8Array;
  contextStateAccount: PublicKey;
  contextStateAuthority: PublicKey;
}): TransactionInstruction {
  const tag = (() => {
    switch (args.proofKind) {
      case 'equality':
        return 3;
      case 'rangeU64':
        return 6;
      case 'rangeU128':
        return 7;
      case 'validity3h':
        return 12;
    }
  })();
  const data = new Uint8Array(1 + args.proofData.length);
  data[0] = tag;
  data.set(args.proofData, 1);
  return new TransactionInstruction({
    programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    keys: [
      { pubkey: args.contextStateAccount, isSigner: false, isWritable: true },
      { pubkey: args.contextStateAuthority, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

function closeContextStateIx(args: {
  contextStateAccount: PublicKey;
  contextStateAuthority: PublicKey;
  destination: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    keys: [
      { pubkey: args.contextStateAccount, isSigner: false, isWritable: true },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.contextStateAuthority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([0]),
  });
}

// WrapArgs layout (176 bytes):
//   [0..8]      amount: u64
//   [8..72]     auditor_ciphertext_lo: 64 bytes
//   [72..136]   auditor_ciphertext_hi: 64 bytes
//   [136..172]  new_source_decryptable_available_balance: 36 bytes
//   [172..176]  _pad
function wrapIx(args: {
  programId: PublicKey;
  payer: PublicKey;
  user: PublicKey;
  wrapper: PublicKey;
  legacyMint: PublicKey;
  shieldedMint: PublicKey;
  escrowLegacy: PublicKey;
  escrowShielded: PublicKey;
  userShielded: PublicKey;
  equalityCtx: PublicKey;
  validityCtx: PublicKey;
  rangeCtx: PublicKey;
  amount: bigint;
  auditorCiphertextLo: Uint8Array;
  auditorCiphertextHi: Uint8Array;
  newSourceDecryptableBalance: Uint8Array;
}): TransactionInstruction {
  if (args.auditorCiphertextLo.length !== 64) throw new Error('auditor_lo must be 64');
  if (args.auditorCiphertextHi.length !== 64) throw new Error('auditor_hi must be 64');
  if (args.newSourceDecryptableBalance.length !== 36)
    throw new Error('newSourceDecryptableBalance must be 36');
  return createWrapInstruction(
    {
      payer: args.payer,
      user: args.user,
      wrapper: args.wrapper,
      legacyMint: args.legacyMint,
      shieldedMint: args.shieldedMint,
      escrowLegacy: args.escrowLegacy,
      escrowShielded: args.escrowShielded,
      userShielded: args.userShielded,
      equalityCtx: args.equalityCtx,
      validityCtx: args.validityCtx,
      rangeCtx: args.rangeCtx,
      instructionsSysvar: new PublicKey('Sysvar1nstructions1111111111111111111111111'),
      token2022Program: TOKEN_2022_PROGRAM_ID,
    },
    {
      wrapArgs: {
        amount: args.amount,
        auditorCiphertextLo: Array.from(args.auditorCiphertextLo),
        auditorCiphertextHi: Array.from(args.auditorCiphertextHi),
        newSourceDecryptableAvailableBalance: Array.from(args.newSourceDecryptableBalance),
        pad: [0, 0, 0, 0],
      },
    },
    args.programId,
  );
}

function unwrapIx(args: {
  programId: PublicKey;
  payer: PublicKey;
  user: PublicKey;
  wrapper: PublicKey;
  legacyMint: PublicKey;
  shieldedMint: PublicKey;
  escrowLegacy: PublicKey;
  userShielded: PublicKey;
  userLegacy: PublicKey;
  equalityCtx: PublicKey;
  rangeCtx: PublicKey;
  legacyTokenProgram: PublicKey;
  amount: bigint;
  decimals: number;
  newDecryptableAfterWithdraw: Uint8Array;
}): TransactionInstruction {
  if (args.newDecryptableAfterWithdraw.length !== 36)
    throw new Error('newDecryptableAfterWithdraw must be 36 bytes');
  return createUnwrapInstruction(
    {
      payer: args.payer,
      user: args.user,
      wrapper: args.wrapper,
      legacyMint: args.legacyMint,
      shieldedMint: args.shieldedMint,
      escrowLegacy: args.escrowLegacy,
      userShielded: args.userShielded,
      userLegacy: args.userLegacy,
      equalityCtx: args.equalityCtx,
      rangeCtx: args.rangeCtx,
      splTokenLegacyProgram: args.legacyTokenProgram,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    },
    {
      unwrapArgs: {
        amount: args.amount,
        decimals: BigInt(args.decimals),
        newDecryptableAfterWithdraw: Array.from(args.newDecryptableAfterWithdraw),
        pad: [0, 0, 0, 0],
      },
    },
    args.programId,
  );
}

export type WrapPhase =
  | 'preparing'
  | 'proof-gen'
  | 'preflight-validity'
  | 'preflight-equality'
  | 'preflight-range-create'
  | 'preflight-range-verify'
  | 'wrap-tx'
  | 'cleanup'
  | 'done';

// ProofContextState<T> = authority(32) + proof_type(1) + context(T).
const VALIDITY_CTX_LEN = 32 + 1 + 352;
const RANGE_U128_CTX_LEN = 32 + 1 + 264;

export async function executeWrap(
  connection: Connection,
  walletAdapter: {
    signTransaction: (tx: Transaction) => Promise<Transaction>;
    signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
  },
  params: {
    state: OccultState;
    wrapper: WrapperInfo;
    user: PublicKey;
    payer: PublicKey;
    userLegacy: PublicKey;
    userShielded: PublicKey;
    auditorElgamalKeypair: Uint8Array;
    auditorAesKey: Uint8Array;
    amount: bigint;
  },
  onPhase?: (p: WrapPhase) => void
): Promise<string> {
  onPhase?.('preparing');

  const sourceAcc = await fetchConfidentialAccount(connection, params.wrapper.escrowShielded);
  const sourceCurrentBalance = await aesDecrypt(
    params.auditorAesKey,
    sourceAcc.decryptableAvailableBalance
  );
  if (params.amount > sourceCurrentBalance) {
    throw new Error(
      `wrapper out of inventory: escrow_shielded has ${sourceCurrentBalance}, need ${params.amount}`
    );
  }

  const destAcc = await fetchConfidentialAccount(connection, params.userShielded);
  const destPubkey = destAcc.elgamalPubkey;
  // Auditor pubkey = first 32 bytes of auditor keypair (pubkey || secret layout).
  const auditorPubkey = params.auditorElgamalKeypair.slice(0, 32);

  onPhase?.('proof-gen');
  const proofs = await generateTransferProofs({
    source_elgamal_keypair: params.auditorElgamalKeypair,
    source_aes_key: params.auditorAesKey,
    current_available_balance: sourceAcc.availableBalance,
    current_decryptable_available_balance: sourceAcc.decryptableAvailableBalance,
    transfer_amount: params.amount,
    destination_elgamal_pubkey: destPubkey,
    auditor_elgamal_pubkey: auditorPubkey,
  });

  const validityKp = Keypair.generate();
  const equalityKp = Keypair.generate();
  const rangeKp = Keypair.generate();

  const validityRent = await connection.getMinimumBalanceForRentExemption(VALIDITY_CTX_LEN);
  const equalityRent = await connection.getMinimumBalanceForRentExemption(EQUALITY_CTX_LEN);
  const rangeRent = await connection.getMinimumBalanceForRentExemption(RANGE_U128_CTX_LEN);

  const sendAndConfirm = async (tx: Transaction, extraSigners: Keypair[] = []) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = params.payer;
    if (extraSigners.length > 0) tx.partialSign(...extraSigners);
    const signed = await walletAdapter.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    return sig;
  };

  onPhase?.('preflight-validity');
  const validityTx = new Transaction();
  validityTx.add(
    SystemProgram.createAccount({
      fromPubkey: params.payer,
      newAccountPubkey: validityKp.publicKey,
      lamports: validityRent,
      space: VALIDITY_CTX_LEN,
      programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    }),
    verifyProofIx({
      proofKind: 'validity3h',
      proofData: proofs.validity_proof,
      contextStateAccount: validityKp.publicKey,
      contextStateAuthority: params.payer,
    })
  );
  await sendAndConfirm(validityTx, [validityKp]);

  onPhase?.('preflight-equality');
  const eqTx = new Transaction();
  eqTx.add(
    SystemProgram.createAccount({
      fromPubkey: params.payer,
      newAccountPubkey: equalityKp.publicKey,
      lamports: equalityRent,
      space: EQUALITY_CTX_LEN,
      programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    }),
    verifyProofIx({
      proofKind: 'equality',
      proofData: proofs.equality_proof,
      contextStateAccount: equalityKp.publicKey,
      contextStateAuthority: params.payer,
    })
  );
  await sendAndConfirm(eqTx, [equalityKp]);

  onPhase?.('preflight-range-create');
  const rangeCreateTx = new Transaction();
  rangeCreateTx.add(
    SystemProgram.createAccount({
      fromPubkey: params.payer,
      newAccountPubkey: rangeKp.publicKey,
      lamports: rangeRent,
      space: RANGE_U128_CTX_LEN,
      programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    })
  );
  await sendAndConfirm(rangeCreateTx, [rangeKp]);

  // Split — range proof too big to combine with create_account.
  onPhase?.('preflight-range-verify');
  const rangeVerifyTx = new Transaction();
  rangeVerifyTx.add(
    verifyProofIx({
      proofKind: 'rangeU128',
      proofData: proofs.range_proof,
      contextStateAccount: rangeKp.publicKey,
      contextStateAuthority: params.payer,
    })
  );
  await sendAndConfirm(rangeVerifyTx);

  onPhase?.('wrap-tx');
  const mainTx = new Transaction();
  const collateralIx =
    params.wrapper.kind === 'sol'
      ? SystemProgram.transfer({
          fromPubkey: params.user,
          toPubkey: params.wrapper.address,
          lamports: params.amount,
        })
      : transferCheckedIx({
          programId: params.wrapper.legacyTokenProgram,
          source: params.userLegacy,
          mint: params.wrapper.legacyMint,
          destination: params.wrapper.escrowLegacy,
          authority: params.user,
          amount: params.amount,
          decimals: params.wrapper.decimals,
        });
  mainTx.add(
    collateralIx,
    wrapIx({
      programId: params.state.programId,
      payer: params.payer,
      user: params.user,
      wrapper: params.wrapper.address,
      legacyMint: params.wrapper.legacyMint,
      shieldedMint: params.wrapper.shieldedMint,
      escrowLegacy: params.wrapper.escrowLegacy,
      escrowShielded: params.wrapper.escrowShielded,
      userShielded: params.userShielded,
      equalityCtx: equalityKp.publicKey,
      validityCtx: validityKp.publicKey,
      rangeCtx: rangeKp.publicKey,
      amount: params.amount,
      auditorCiphertextLo: proofs.auditor_ciphertext_lo,
      auditorCiphertextHi: proofs.auditor_ciphertext_hi,
      newSourceDecryptableBalance: proofs.new_decryptable_balance,
    })
  );
  const mainSig = await sendAndConfirm(mainTx);

  onPhase?.('cleanup');
  for (const ctx of [validityKp.publicKey, equalityKp.publicKey, rangeKp.publicKey]) {
    const tx = new Transaction();
    tx.add(
      closeContextStateIx({
        contextStateAccount: ctx,
        contextStateAuthority: params.payer,
        destination: params.payer,
      })
    );
    await sendAndConfirm(tx);
  }

  onPhase?.('done');
  return mainSig;
}

export type UnwrapPhase =
  | 'preparing'
  | 'proof-gen'
  | 'preflight-equality'
  | 'preflight-range-create'
  | 'preflight-range-verify'
  | 'unwrap-tx'
  | 'cleanup'
  | 'done';

// ProofContextState<T> = authority(32) + proof_type(1) + context(T).
const EQUALITY_CTX_LEN = 32 + 1 + 128;
const RANGE_CTX_LEN = 32 + 1 + 264;

export async function executeUnwrap(
  connection: Connection,
  walletAdapter: {
    signTransaction: (tx: Transaction) => Promise<Transaction>;
    signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
  },
  params: {
    state: OccultState;
    wrapper: WrapperInfo;
    user: PublicKey;
    payer: PublicKey;
    userLegacy: PublicKey;
    userShielded: PublicKey;
    elgamalKeypair: Uint8Array;
    aesKey: Uint8Array;
    amount: bigint;
  },
  onPhase?: (p: UnwrapPhase) => void
): Promise<string> {
  onPhase?.('preparing');

  const userShieldedAcc = await fetchConfidentialAccount(connection, params.userShielded);
  const currentBalancePlain = await aesDecrypt(
    params.aesKey,
    userShieldedAcc.decryptableAvailableBalance
  );
  if (params.amount > currentBalancePlain) {
    throw new Error(
      `insufficient confidential balance: have ${currentBalancePlain}, asked to unwrap ${params.amount}`
    );
  }
  const newAvail = currentBalancePlain - params.amount;
  const newDecryptableAfterWithdraw = await aesEncrypt(params.aesKey, newAvail);

  onPhase?.('proof-gen');
  const proofs = await generateWithdrawProofs({
    elgamal_keypair: params.elgamalKeypair,
    current_available_balance: userShieldedAcc.availableBalance,
    current_balance: currentBalancePlain,
    withdraw_amount: params.amount,
  });

  const equalityKp = Keypair.generate();
  const rangeKp = Keypair.generate();

  const equalityRent = await connection.getMinimumBalanceForRentExemption(EQUALITY_CTX_LEN);
  const rangeRent = await connection.getMinimumBalanceForRentExemption(RANGE_CTX_LEN);

  const sendAndConfirm = async (tx: Transaction, extraSigners: Keypair[] = []) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = params.payer;
    if (extraSigners.length > 0) tx.partialSign(...extraSigners);
    const signed = await walletAdapter.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    return sig;
  };

  onPhase?.('preflight-equality');
  const eqTx = new Transaction();
  eqTx.add(
    SystemProgram.createAccount({
      fromPubkey: params.payer,
      newAccountPubkey: equalityKp.publicKey,
      lamports: equalityRent,
      space: EQUALITY_CTX_LEN,
      programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    }),
    verifyProofIx({
      proofKind: 'equality',
      proofData: proofs.equality_proof,
      contextStateAccount: equalityKp.publicKey,
      contextStateAuthority: params.payer,
    })
  );
  await sendAndConfirm(eqTx, [equalityKp]);

  onPhase?.('preflight-range-create');
  const rangeCreateTx = new Transaction();
  rangeCreateTx.add(
    SystemProgram.createAccount({
      fromPubkey: params.payer,
      newAccountPubkey: rangeKp.publicKey,
      lamports: rangeRent,
      space: RANGE_CTX_LEN,
      programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    })
  );
  await sendAndConfirm(rangeCreateTx, [rangeKp]);

  // Split — range proof inline is ~768B, won't fit with create_account.
  onPhase?.('preflight-range-verify');
  const rangeVerifyTx = new Transaction();
  rangeVerifyTx.add(
    verifyProofIx({
      proofKind: 'rangeU64',
      proofData: proofs.range_proof,
      contextStateAccount: rangeKp.publicKey,
      contextStateAuthority: params.payer,
    })
  );
  await sendAndConfirm(rangeVerifyTx);

  // Native-SOL path: `userLegacy` becomes the user wallet (lamports land there)
  // and `legacyTokenProgram` is SystemProgram sentinel (no token-program CPI).
  const isSol = params.wrapper.kind === 'sol';
  onPhase?.('unwrap-tx');
  const mainTx = new Transaction();
  mainTx.add(
    unwrapIx({
      programId: params.state.programId,
      payer: params.payer,
      user: params.user,
      wrapper: params.wrapper.address,
      legacyMint: params.wrapper.legacyMint,
      shieldedMint: params.wrapper.shieldedMint,
      escrowLegacy: params.wrapper.escrowLegacy,
      userShielded: params.userShielded,
      userLegacy: isSol ? params.user : params.userLegacy,
      equalityCtx: equalityKp.publicKey,
      rangeCtx: rangeKp.publicKey,
      legacyTokenProgram: isSol ? SystemProgram.programId : params.wrapper.legacyTokenProgram,
      amount: params.amount,
      decimals: params.wrapper.decimals,
      newDecryptableAfterWithdraw,
    })
  );
  const mainSig = await sendAndConfirm(mainTx);

  onPhase?.('cleanup');
  const closeEqTx = new Transaction();
  closeEqTx.add(
    closeContextStateIx({
      contextStateAccount: equalityKp.publicKey,
      contextStateAuthority: params.payer,
      destination: params.payer,
    })
  );
  await sendAndConfirm(closeEqTx);

  const closeRangeTx = new Transaction();
  closeRangeTx.add(
    closeContextStateIx({
      contextStateAccount: rangeKp.publicKey,
      contextStateAuthority: params.payer,
      destination: params.payer,
    })
  );
  await sendAndConfirm(closeRangeTx);

  onPhase?.('done');
  return mainSig;
}

export { SPL_TOKEN_LEGACY_PROGRAM_ID, ZK_ELGAMAL_PROOF_PROGRAM_ID };
