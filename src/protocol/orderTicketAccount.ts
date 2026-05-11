import { Connection, PublicKey } from '@solana/web3.js';
import { OrderTicket } from './generated/accounts/OrderTicket';

export const TicketStatus = {
  Pending: 0,
  Settled: 1,
  Claimed: 2,
} as const;
export type TicketStatusValue = (typeof TicketStatus)[keyof typeof TicketStatus];

export type OrderTicketAccount = {
  status: TicketStatusValue;
  side: number;
  pool: PublicKey;
  owner: PublicKey;
  userTokenAccount: PublicKey;
  batchId: bigint;
  submittedSlot: bigint;
};

const ORDER_TICKET_TAG = 3;

function toBigInt(x: unknown): bigint {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(x);
  return BigInt((x as { toString: () => string }).toString());
}

export function decodeOrderTicket(data: Uint8Array): OrderTicketAccount {
  if (data.length < 264) throw new Error(`ticket data too short (${data.length} bytes)`);
  if (data[0] !== ORDER_TICKET_TAG) throw new Error(`unexpected ticket tag ${data[0]}`);
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const [ticket] = OrderTicket.deserialize(buf);
  return {
    status: ticket.status as TicketStatusValue,
    side: ticket.side,
    pool: ticket.pool,
    owner: ticket.owner,
    userTokenAccount: ticket.userTokenAccount,
    batchId: toBigInt(ticket.batchId),
    submittedSlot: toBigInt(ticket.submittedSlot),
  };
}

// Returns null if the ticket has been closed (rent reclaimed after claim).
export async function fetchOrderTicket(
  connection: Connection,
  ticket: PublicKey
): Promise<OrderTicketAccount | null> {
  const acc = await connection.getAccountInfo(ticket, 'confirmed');
  if (!acc || acc.data.length === 0) return null;
  return decodeOrderTicket(acc.data);
}
