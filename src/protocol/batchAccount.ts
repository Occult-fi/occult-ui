import { Connection, PublicKey } from '@solana/web3.js';
import { Batch } from './generated/accounts/Batch';

export const BatchStatus = {
  Open: 0,
  Settling: 1,
  Settled: 2,
} as const;
export type BatchStatusValue = (typeof BatchStatus)[keyof typeof BatchStatus];

export type BatchAccount = {
  status: BatchStatusValue;
  side: number;
  pool: PublicKey;
  batchId: bigint;
  openedSlot: bigint;
  closedSlot: bigint;
  totalInDecrypted: bigint;
  totalOutCredited: bigint;
  clearingRatioQ32: bigint;
  orderCount: number;
};

const BATCH_TAG = 2;

function toBigInt(x: unknown): bigint {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(x);
  return BigInt((x as { toString: () => string }).toString());
}

export function decodeBatch(data: Uint8Array): BatchAccount {
  if (data.length < 192) throw new Error(`batch data too short (${data.length} bytes)`);
  if (data[0] !== BATCH_TAG) throw new Error(`unexpected batch tag ${data[0]}`);
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const [batch] = Batch.deserialize(buf);
  return {
    status: batch.status as BatchStatusValue,
    side: batch.side,
    pool: batch.pool,
    batchId: toBigInt(batch.batchId),
    openedSlot: toBigInt(batch.openedSlot),
    closedSlot: toBigInt(batch.closedSlot),
    totalInDecrypted: toBigInt(batch.totalInDecrypted),
    totalOutCredited: toBigInt(batch.totalOutCredited),
    clearingRatioQ32: toBigInt(batch.clearingRatioQ32),
    orderCount: batch.orderCount,
  };
}

export async function fetchBatch(
  connection: Connection,
  batch: PublicKey
): Promise<BatchAccount | null> {
  const acc = await connection.getAccountInfo(batch, 'confirmed');
  if (!acc) return null;
  return decodeBatch(acc.data);
}
