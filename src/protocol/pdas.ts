import { PublicKey } from '@solana/web3.js';

const POOL_SEED = new TextEncoder().encode('pool');
const VAULT_A_SEED = new TextEncoder().encode('vault_a');
const VAULT_B_SEED = new TextEncoder().encode('vault_b');
const BATCH_SEED = new TextEncoder().encode('batch');
const ORDER_SEED = new TextEncoder().encode('order');
const LP_REQ_SEED = new TextEncoder().encode('lp_req');

export function derivePool(
  programId: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, mintA.toBuffer(), mintB.toBuffer()],
    programId
  );
}

export function deriveVaultA(programId: PublicKey, pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_A_SEED, pool.toBuffer()], programId);
}

export function deriveVaultB(programId: PublicKey, pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_B_SEED, pool.toBuffer()], programId);
}

export function deriveBatch(
  programId: PublicKey,
  pool: PublicKey,
  batchId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BATCH_SEED, pool.toBuffer(), u64Le(batchId)],
    programId
  );
}

export function deriveOrderTicket(
  programId: PublicKey,
  pool: PublicKey,
  user: PublicKey,
  batchId: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORDER_SEED, pool.toBuffer(), user.toBuffer(), u64Le(batchId)],
    programId
  );
}

export function deriveLpDepositRequest(
  programId: PublicKey,
  pool: PublicKey,
  user: PublicKey,
  counter: bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LP_REQ_SEED, pool.toBuffer(), user.toBuffer(), u64Le(counter)],
    programId
  );
}

function u64Le(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, n, true);
  return out;
}
