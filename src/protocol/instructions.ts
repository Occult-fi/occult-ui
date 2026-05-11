import {
  PublicKey,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import { createSubmitOrderInstruction } from './generated/instructions/SubmitOrder';

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
);

export const SPL_TOKEN_LEGACY_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

export function submitOrderIx(args: {
  programId: PublicKey;
  payer: PublicKey;
  user: PublicKey;
  pool: PublicKey;
  batch: PublicKey;
  orderTicket: PublicKey;
  validityCtx: PublicKey;
  side: 0 | 1;
  batchBump: number;
  ticketBump: number;
  transferIxOffset: number;
}): TransactionInstruction {
  return createSubmitOrderInstruction(
    {
      payer: args.payer,
      user: args.user,
      pool: args.pool,
      batch: args.batch,
      orderTicket: args.orderTicket,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      validityCtx: args.validityCtx,
    },
    {
      submitOrderArgs: {
        side: args.side,
        batchBump: args.batchBump,
        ticketBump: args.ticketBump,
        transferIxOffset: args.transferIxOffset,
        padding: [0, 0, 0, 0],
      },
    },
    args.programId,
  );
}

// ApplyPendingBalance wire format:
//   accounts: [ token_account writable, owner signer ]
//   data:
//     [0]      27   TokenInstruction::ConfidentialTransferExtension
//     [1]      8    ConfidentialTransferInstruction::ApplyPendingBalance
//     [2..10]  expected_pending_balance_credit_counter: u64 LE
//     [10..46] new_decryptable_available_balance: PodAeCiphertext (36)
export function applyPendingBalanceIx(args: {
  tokenAccount: PublicKey;
  owner: PublicKey;
  expectedPendingCreditCounter: bigint;
  newDecryptableBalance: Uint8Array;
}): TransactionInstruction {
  if (args.newDecryptableBalance.length !== 36)
    throw new Error('newDecryptableBalance must be 36 bytes');
  const data = new Uint8Array(2 + 8 + 36);
  data[0] = 27;
  data[1] = 8;
  const view = new DataView(data.buffer);
  view.setBigUint64(2, args.expectedPendingCreditCounter, true);
  data.set(args.newDecryptableBalance, 10);
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: args.tokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ConfidentialTransfer.Transfer wire format (169 bytes total):
//   accounts: [ source writable, mint, destination writable, equality_ctx, validity_ctx, range_ctx, authority signer ]
//   data:
//     [0]        27   TokenInstruction::ConfidentialTransferExtension
//     [1]         7   ConfidentialTransferInstruction::Transfer
//     [2..38]    PodAeCiphertext  new_source_decryptable (36)
//     [38..102]  PodElGamalCiphertext auditor_lo (64)
//     [102..166] PodElGamalCiphertext auditor_hi (64)
//     [166..169] equality/validity/range i8 proof offsets — all 0 with ContextStateAccount
export function confidentialTransferIx(args: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  equalityCtx: PublicKey;
  validityCtx: PublicKey;
  rangeCtx: PublicKey;
  authority: PublicKey;
  newSourceDecryptableBalance: Uint8Array;
  auditorCiphertextLo: Uint8Array;
  auditorCiphertextHi: Uint8Array;
}): TransactionInstruction {
  if (args.newSourceDecryptableBalance.length !== 36)
    throw new Error('newSourceDecryptableBalance must be 36 bytes');
  if (args.auditorCiphertextLo.length !== 64) throw new Error('auditor_lo must be 64 bytes');
  if (args.auditorCiphertextHi.length !== 64) throw new Error('auditor_hi must be 64 bytes');

  const data = new Uint8Array(2 + 36 + 64 + 64 + 3);
  data[0] = 27;
  data[1] = 7;
  data.set(args.newSourceDecryptableBalance, 2);
  data.set(args.auditorCiphertextLo, 38);
  data.set(args.auditorCiphertextHi, 102);

  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.equalityCtx, isSigner: false, isWritable: false },
      { pubkey: args.validityCtx, isSigner: false, isWritable: false },
      { pubkey: args.rangeCtx, isSigner: false, isWritable: false },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}
