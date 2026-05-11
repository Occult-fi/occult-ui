import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';

// Wire layout for "proof in instruction data, with context state":
//   accounts:  [ writable ctx_state, readonly authority ]
//   data:      [ discriminator: u8 ][ proof_data: bytes ]
// Discriminators match enum ProofInstruction in solana-zk-elgamal-proof-interface 0.1.2.
export const ZK_ELGAMAL_PROOF_PROGRAM_ID = new PublicKey(
  'ZkE1Gama1Proof11111111111111111111111111111'
);

export const PROOF_IX = {
  CloseContextState: 0,
  VerifyZeroCiphertext: 1,
  VerifyCiphertextCiphertextEquality: 2,
  VerifyCiphertextCommitmentEquality: 3,
  VerifyPubkeyValidity: 4,
  VerifyPercentageWithCap: 5,
  VerifyBatchedRangeProofU64: 6,
  VerifyBatchedRangeProofU128: 7,
  VerifyBatchedRangeProofU256: 8,
  VerifyGroupedCiphertext2HandlesValidity: 9,
  VerifyBatchedGroupedCiphertext2HandlesValidity: 10,
  VerifyGroupedCiphertext3HandlesValidity: 11,
  VerifyBatchedGroupedCiphertext3HandlesValidity: 12,
} as const;

// ProofContextState<T> = 32 (authority) + 1 (proof_type) + sizeof(T).
//   - CiphertextCommitmentEqualityProofContext = 128 → total 161
//   - BatchedGroupedCiphertext3HandlesValidityProofContext = 352 → total 385
//   - BatchedRangeProofContext = 8*32 + 8*1 = 264 → total 297
export const CTX_LEN = {
  equality: 161,
  validity3Handles: 385,
  rangeBatched: 297,
} as const;

export type CtxStateAccounts = {
  validity: PublicKey;
  equality: PublicKey;
  range: PublicKey;
};

function buildVerifyProofIx(
  discriminator: number,
  proofData: Uint8Array,
  contextStateAccount: PublicKey,
  contextStateAuthority: PublicKey
): TransactionInstruction {
  const data = new Uint8Array(1 + proofData.length);
  data[0] = discriminator;
  data.set(proofData, 1);
  return new TransactionInstruction({
    programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    keys: [
      { pubkey: contextStateAccount, isSigner: false, isWritable: true },
      { pubkey: contextStateAuthority, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function verifyValidityProof3HandlesIx(
  proofData: Uint8Array,
  ctxAccount: PublicKey,
  ctxAuthority: PublicKey
): TransactionInstruction {
  return buildVerifyProofIx(
    PROOF_IX.VerifyBatchedGroupedCiphertext3HandlesValidity,
    proofData,
    ctxAccount,
    ctxAuthority
  );
}

export function verifyEqualityProofIx(
  proofData: Uint8Array,
  ctxAccount: PublicKey,
  ctxAuthority: PublicKey
): TransactionInstruction {
  return buildVerifyProofIx(
    PROOF_IX.VerifyCiphertextCommitmentEquality,
    proofData,
    ctxAccount,
    ctxAuthority
  );
}

export function verifyRangeProofU128Ix(
  proofData: Uint8Array,
  ctxAccount: PublicKey,
  ctxAuthority: PublicKey
): TransactionInstruction {
  return buildVerifyProofIx(
    PROOF_IX.VerifyBatchedRangeProofU128,
    proofData,
    ctxAccount,
    ctxAuthority
  );
}

// accounts: [ writable ctx_state, writable destination, signer authority ]; data: [ 0 ]
export function closeContextStateIx(
  ctxAccount: PublicKey,
  destination: PublicKey,
  ctxAuthority: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    keys: [
      { pubkey: ctxAccount, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: ctxAuthority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([PROOF_IX.CloseContextState]),
  });
}

export function createContextStateAccountIx(
  payer: PublicKey,
  newAccount: PublicKey,
  space: number,
  rent: bigint
): TransactionInstruction {
  return SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: newAccount,
    lamports: Number(rent),
    space,
    programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
  });
}
