import { Connection, PublicKey } from '@solana/web3.js';

// ConfidentialTransferAccount extension layout (spl-token-2022-interface 2.1.0):
//     0   approved                                   PodBool   (1)
//     1   elgamal_pubkey                             [u8; 32]
//    33   pending_balance_lo                         PodElGamalCiphertext (64)
//    97   pending_balance_hi                         PodElGamalCiphertext (64)
//   161   available_balance                          PodElGamalCiphertext (64)
//   225   decryptable_available_balance              PodAeCiphertext (36)
//   261   allow_confidential_credits                 PodBool (1)
//   262   allow_non_confidential_credits             PodBool (1)
//   263   pending_balance_credit_counter             PodU64 (8)
//   271   maximum_pending_balance_credit_counter     PodU64 (8)
//   279   expected_pending_balance_credit_counter    PodU64 (8)
//   287   actual_pending_balance_credit_counter      PodU64 (8)
const EXT_TYPE_CONFIDENTIAL_TRANSFER_ACCOUNT = 5;

// 165 bytes Account base, then 1 byte AccountType discriminator,
// then TLV extensions: each = 2-byte type + 2-byte length + N-byte data.
const ACCOUNT_TYPE_OFFSET = 165;

export type ConfidentialAccount = {
  approved: boolean;
  elgamalPubkey: Uint8Array;
  availableBalance: Uint8Array;
  decryptableAvailableBalance: Uint8Array;
  pendingBalanceLo: Uint8Array;
  pendingBalanceHi: Uint8Array;
  pendingCreditCounter: bigint;
  actualPendingCreditCounter: bigint;
};

export function decodeConfidentialAccount(data: Uint8Array): ConfidentialAccount {
  if (data.length <= ACCOUNT_TYPE_OFFSET) {
    throw new Error(
      `token account too small (${data.length} bytes) — expected Token-2022 with extensions`
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = ACCOUNT_TYPE_OFFSET + 1;
  while (cursor + 4 <= data.length) {
    const extType = view.getUint16(cursor, true);
    const extLen = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (extType === EXT_TYPE_CONFIDENTIAL_TRANSFER_ACCOUNT) {
      const ext = data.subarray(cursor, cursor + extLen);
      const extView = new DataView(ext.buffer, ext.byteOffset, ext.byteLength);
      return {
        approved: ext[0] !== 0,
        elgamalPubkey: ext.slice(1, 33),
        pendingBalanceLo: ext.slice(33, 97),
        pendingBalanceHi: ext.slice(97, 161),
        availableBalance: ext.slice(161, 225),
        decryptableAvailableBalance: ext.slice(225, 261),
        pendingCreditCounter: extView.getBigUint64(263, true),
        actualPendingCreditCounter: extView.getBigUint64(287, true),
      };
    }
    cursor += extLen;
  }
  throw new Error(
    'ConfidentialTransferAccount extension not found — the token account is not approved for confidential transfers'
  );
}

export async function fetchConfidentialAccount(
  connection: Connection,
  account: PublicKey
): Promise<ConfidentialAccount> {
  const acc = await connection.getAccountInfo(account, 'confirmed');
  if (!acc) throw new Error(`account ${account.toBase58()} not found`);
  return decodeConfidentialAccount(acc.data);
}
