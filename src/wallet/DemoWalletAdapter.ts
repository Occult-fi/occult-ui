import {
  BaseSignerWalletAdapter,
  WalletConnectionError,
  WalletReadyState,
  type SupportedTransactionVersions,
  type WalletName,
} from '@solana/wallet-adapter-base';
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

export const DemoWalletName = 'Demo Account' as WalletName<'Demo Account'>;

const DEMO_ICON =
  'data:image/svg+xml;base64,' +
  btoa(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#0a0a0a" stroke="rgba(245,245,247,0.16)"/>
  <g stroke="#f5f5f7" stroke-width="2" fill="none" stroke-linecap="square">
    <rect x="14" y="22" width="36" height="22" rx="2"/>
    <path d="M22 22V18a10 10 0 0 1 20 0v4"/>
  </g>
  <circle cx="32" cy="34" r="2.5" fill="#f5f5f7"/>
</svg>`.trim());

const DEFAULT_KEYPAIR_URL = '/demo-wallets/alice.json';

export class DemoWalletAdapter extends BaseSignerWalletAdapter {
  readonly name = DemoWalletName;
  readonly url = 'https://github.com/Occult-fi/occult';
  readonly icon = DEMO_ICON;
  readonly supportedTransactionVersions: SupportedTransactionVersions = new Set(['legacy', 0]);
  readonly readyState = WalletReadyState.Loadable;

  private _keypair: Keypair | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;
  private _keypairUrl: string;

  constructor(keypairUrl: string = DEFAULT_KEYPAIR_URL) {
    super();
    this._keypairUrl = keypairUrl;
  }

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  get connected() {
    return !!this._keypair;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected) return;
      this._connecting = true;

      const res = await fetch(this._keypairUrl, { cache: 'no-cache' });
      if (!res.ok) {
        throw new WalletConnectionError(
          `Demo wallet not available at ${this._keypairUrl} (HTTP ${res.status}). ` +
            `Did you run scripts/local-init.sh in the protocol repo?`
        );
      }
      const bytes = (await res.json()) as number[];
      if (!Array.isArray(bytes) || bytes.length !== 64) {
        throw new WalletConnectionError(
          `Demo wallet file at ${this._keypairUrl} is not a valid 64-byte secret key array.`
        );
      }
      const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
      this._keypair = kp;
      this._publicKey = kp.publicKey;
      this.emit('connect', kp.publicKey);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.emit('error', err as never);
      throw err;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this._keypair = null;
    this._publicKey = null;
    this.emit('disconnect');
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this._keypair) throw new Error('Demo wallet not connected');
    if ((tx as VersionedTransaction).version !== undefined) {
      (tx as VersionedTransaction).sign([this._keypair]);
    } else {
      (tx as Transaction).partialSign(this._keypair);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    for (const tx of txs) await this.signTransaction(tx);
    return txs;
  }
}
