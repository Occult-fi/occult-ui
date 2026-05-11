import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from './instructions';

const TOKEN_INSTR_CT_EXT = 27;
const CT_INSTR_TRANSFER = 7;

export function confidentialTransferIx(args: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  equalityCtx: PublicKey;
  validityCtx: PublicKey;
  rangeCtx: PublicKey;
  authority: PublicKey;
  authoritySigner: boolean;
  newSourceDecryptable: Uint8Array;
  auditorCiphertextLo: Uint8Array;
  auditorCiphertextHi: Uint8Array;
}): TransactionInstruction {
  if (args.newSourceDecryptable.length !== 36) throw new Error('newSourceDecryptable must be 36');
  if (args.auditorCiphertextLo.length !== 64) throw new Error('auditor_lo must be 64');
  if (args.auditorCiphertextHi.length !== 64) throw new Error('auditor_hi must be 64');
  const data = new Uint8Array(2 + 36 + 64 + 64 + 3);
  data[0] = TOKEN_INSTR_CT_EXT;
  data[1] = CT_INSTR_TRANSFER;
  data.set(args.newSourceDecryptable, 2);
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
      { pubkey: args.authority, isSigner: args.authoritySigner, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}
