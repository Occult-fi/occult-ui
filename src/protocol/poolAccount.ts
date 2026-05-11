import { Connection, PublicKey } from '@solana/web3.js';
import { Pool, poolBeet } from './generated/accounts/Pool';

export type PoolAccount = {
  authority: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  auditorElGamalPubkey: Uint8Array;
  reserveA: bigint;
  reserveB: bigint;
  currentBatchId: bigint;
  lastSettledBatchId: bigint;
  batchWindowSlots: number;
  batchSize: number;
  feeBps: number;
  // Default Pubkey when InitLpMint hasn't run.
  lpMint: PublicKey;
  lpEscrowShielded: PublicKey;
  lpSupply: bigint;
  genesisSlot: bigint;
  cumulativeVolumeA: bigint;
  cumulativeVolumeB: bigint;
  depositVaultA: PublicKey;
  depositVaultB: PublicKey;
};

const POOL_SIZE = 440;
const POOL_TAG = 1;

function toBigInt(x: unknown): bigint {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(x);
  return BigInt((x as { toString: () => string }).toString());
}

export function decodePool(data: Uint8Array): PoolAccount {
  if (data.length < POOL_SIZE) throw new Error(`pool data too short (${data.length} bytes)`);
  if (data[0] !== POOL_TAG) throw new Error(`unexpected pool tag ${data[0]}`);
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const [pool] = Pool.deserialize(buf);
  return {
    authority: pool.authority,
    mintA: pool.mintA,
    mintB: pool.mintB,
    vaultA: pool.vaultA,
    vaultB: pool.vaultB,
    auditorElGamalPubkey: new Uint8Array(pool.auditorElgamalPubkey),
    reserveA: toBigInt(pool.reserveA),
    reserveB: toBigInt(pool.reserveB),
    currentBatchId: toBigInt(pool.currentBatchId),
    lastSettledBatchId: toBigInt(pool.lastSettledBatchId),
    batchWindowSlots: pool.batchWindowSlots,
    batchSize: pool.batchSize,
    feeBps: pool.feeBps,
    lpMint: pool.lpMint,
    lpEscrowShielded: pool.lpEscrowShielded,
    lpSupply: toBigInt(pool.lpSupply),
    genesisSlot: toBigInt(pool.genesisSlot),
    cumulativeVolumeA: u128FromLeBytes(pool.cumulativeVolumeA),
    cumulativeVolumeB: u128FromLeBytes(pool.cumulativeVolumeB),
    depositVaultA: pool.depositVaultA,
    depositVaultB: pool.depositVaultB,
  };
}

function u128FromLeBytes(arr: number[]): bigint {
  let n = 0n;
  for (let i = 15; i >= 0; i--) n = (n << 8n) | BigInt(arr[i]);
  return n;
}

export async function fetchPool(
  connection: Connection,
  pool: PublicKey
): Promise<PoolAccount> {
  const acc = await connection.getAccountInfo(pool, 'confirmed');
  if (!acc) throw new Error(`pool account ${pool.toBase58()} not found`);
  return decodePool(acc.data);
}

export type DiscoveredPool = {
  address: PublicKey;
  account: PoolAccount;
};

export async function discoverAllPools(
  connection: Connection,
  programId: PublicKey
): Promise<DiscoveredPool[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: 'confirmed',
    filters: [
      { dataSize: poolBeet.byteSize },
      // base58 '2' = [0x01] = Pool tag
      { memcmp: { offset: 0, bytes: '2' } },
    ],
  });
  const pools: DiscoveredPool[] = [];
  for (const a of accounts) {
    try {
      pools.push({ address: a.pubkey, account: decodePool(a.account.data) });
    } catch (e) {
      console.warn('[discoverAllPools] skip', a.pubkey.toBase58(), e);
    }
  }
  pools.sort((a, b) => (a.address.toBase58() < b.address.toBase58() ? -1 : 1));
  return pools;
}
