export type NetworkKind = 'localnet' | 'devnet' | 'testnet' | 'mainnet' | 'unknown';

export function classifyNetwork(rpcUrl: string): NetworkKind {
  const u = rpcUrl.toLowerCase();
  if (
    u.includes('localhost') ||
    u.includes('127.0.0.1') ||
    u.includes('://0.0.0.0') ||
    u.includes('localnet.')
  ) {
    return 'localnet';
  }
  if (u.includes('devnet')) return 'devnet';
  if (u.includes('testnet')) return 'testnet';
  if (u.includes('mainnet') || u.includes('api.mainnet-beta')) return 'mainnet';
  return 'unknown';
}

export function networkLabel(kind: NetworkKind): string {
  switch (kind) {
    case 'localnet':
      return 'LOCALNET';
    case 'devnet':
      return 'DEVNET';
    case 'testnet':
      return 'TESTNET';
    case 'mainnet':
      return 'MAINNET';
    default:
      return 'NETWORK';
  }
}

export function explorerTxUrl(
  sig: string,
  kind: NetworkKind,
  rpcUrl?: string
): string | null {
  switch (kind) {
    case 'devnet':
      return `https://solscan.io/tx/${sig}?cluster=devnet`;
    case 'testnet':
      return `https://solscan.io/tx/${sig}?cluster=testnet`;
    case 'mainnet':
      return `https://solscan.io/tx/${sig}`;
    case 'localnet': {
      const url = rpcUrl ?? 'http://localhost:8899';
      return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(url)}`;
    }
    case 'unknown':
    default:
      return null;
  }
}
