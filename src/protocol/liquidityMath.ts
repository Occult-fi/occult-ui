export const MINIMUM_LIQUIDITY = 1000n;

export function u128Sqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

export function computeLpOut(
  amountA: bigint,
  amountB: bigint,
  reserveA: bigint,
  reserveB: bigint,
  lpSupply: bigint,
): { lpOut: bigint; newSupply: bigint } {
  if (amountA <= 0n || amountB <= 0n) {
    throw new Error('amount_a and amount_b must be > 0');
  }
  if (lpSupply === 0n) {
    if (reserveA === 0n && reserveB === 0n) {
      const root = u128Sqrt(amountA * amountB);
      if (root <= MINIMUM_LIQUIDITY) {
        throw new Error('first deposit too small (need > sqrt(MIN_LIQUIDITY))');
      }
      const lp = root - MINIMUM_LIQUIDITY;
      return { lpOut: lp, newSupply: lp };
    }
    if (reserveA === 0n || reserveB === 0n) {
      throw new Error('pool single-sided (corrupt state)');
    }
    const v = u128Sqrt(reserveA * reserveB);
    const fromA = (amountA * v) / reserveA;
    const fromB = (amountB * v) / reserveB;
    const lp = fromA < fromB ? fromA : fromB;
    return { lpOut: lp, newSupply: v + lp };
  }
  if (reserveA === 0n || reserveB === 0n) {
    throw new Error('lp_supply > 0 but a reserve is 0');
  }
  const fromA = (amountA * lpSupply) / reserveA;
  const fromB = (amountB * lpSupply) / reserveB;
  const lp = fromA < fromB ? fromA : fromB;
  return { lpOut: lp, newSupply: lpSupply + lp };
}

export function applySlippage(lpOut: bigint, slippageBps: number): bigint {
  const factor = BigInt(10_000 - slippageBps);
  return (lpOut * factor) / 10_000n;
}
