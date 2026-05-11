export type TokenInfo = {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  // Used to order pool pairs as "SOL/USDC" regardless of mint_a lex order.
  kind?: 'stable' | 'volatile';
};

let tokenListCache: Record<string, TokenInfo> | null = null;
let inflight: Promise<Record<string, TokenInfo>> | null = null;

export async function loadTokenList(): Promise<Record<string, TokenInfo>> {
  if (tokenListCache) return tokenListCache;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch(`/token-list.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`[token-list] /token-list.json not found (HTTP ${res.status}) — pools will show placeholder symbols`);
      tokenListCache = {};
      return tokenListCache;
    }
    tokenListCache = (await res.json()) as Record<string, TokenInfo>;
    return tokenListCache;
  })();
  return inflight;
}

export function tokenInfo(
  list: Record<string, TokenInfo>,
  mint: string
): TokenInfo {
  const hit = list[mint];
  if (hit) return hit;
  return {
    symbol: mint.slice(0, 4).toUpperCase(),
    name: `Unknown (${mint.slice(0, 6)}…)`,
    decimals: 6,
    icon: '',
  };
}
