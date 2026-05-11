const KEY_PREFIX = 'occult.history.';
const MAX_HISTORY = 50;

export type StoredTx = {
  id: string;
  time: string;
  // Undefined = 'swap' for back-compat with stored swaps.
  kind?: 'swap' | 'wrap' | 'unwrap';
  side: 'buy' | 'sell';
  amount: string;
  tokenIn: string;
  tokenOut: string;
  fillOut: string | null;
  fillPx: string | null;
  batch: number | null;
  status: 'idle' | 'encrypting' | 'queued' | 'settling' | 'sealed';
  sig: string;
  ticket?: string;
  // bigint serialised as string — bigint doesn't survive JSON.
  batchId?: string;
  // Optional for back-compat with pre-multi-pool history.
  pool?: string;
};

export function loadHistory(pubkey: string): StoredTx[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + pubkey);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_HISTORY) as StoredTx[];
  } catch {
    return [];
  }
}

export function saveHistory(pubkey: string, txs: StoredTx[]): void {
  try {
    const slim = txs.slice(0, MAX_HISTORY);
    localStorage.setItem(KEY_PREFIX + pubkey, JSON.stringify(slim));
  } catch {
    // localStorage quota — silently drop
  }
}

export function clearHistory(pubkey: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + pubkey);
  } catch {
    // noop
  }
}
