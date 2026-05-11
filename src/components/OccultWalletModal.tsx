import { useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Adapter, WalletName } from '@solana/wallet-adapter-base';
import { CloseIcon, GenericWalletIcon } from './WalletIcons';
import { DemoWalletName } from '../wallet/DemoWalletAdapter';

type Phase = 'select' | 'connecting' | 'connected' | 'error';

function shortAddr(a: string) {
  return a.slice(0, 4) + '…' + a.slice(-4);
}

function WalletIcon({ adapter, size = 32 }: { adapter?: Adapter | null; size?: number }) {
  if (!adapter?.icon) return <GenericWalletIcon />;
  return (
    <img
      src={adapter.icon}
      alt={adapter.name}
      width={size}
      height={size}
      style={{ display: 'block', borderRadius: 12 }}
    />
  );
}

function blurbFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('phantom')) return 'Most-used Solana wallet. Browser & mobile.';
  if (n.includes('solflare')) return 'Native Solana wallet with hardware support.';
  return 'Solana wallet adapter';
}

export default function OccultWalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    wallets: adapterWallets,
    select,
    connect,
    connecting,
    connected,
    publicKey,
    wallet: activeWallet,
    disconnect,
  } = useWallet();

  const [phase, setPhase] = useState<Phase>('select');
  const [error, setError] = useState<string | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);

  // Demo Account is rendered separately at the bottom — exclude here.
  const wallets = useMemo(() => {
    const order = ['Phantom', 'Solflare'];
    const sorted = adapterWallets
      .filter((w) => w.adapter.name !== DemoWalletName)
      .sort((a, b) => {
        const ai = order.indexOf(a.adapter.name);
        const bi = order.indexOf(b.adapter.name);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    return sorted.slice(0, 2);
  }, [adapterWallets]);

  const demoWallet = useMemo(
    () => adapterWallets.find((w) => w.adapter.name === DemoWalletName),
    [adapterWallets]
  );

  useEffect(() => {
    if (!open) return;
    setPhase(connected ? 'connected' : 'select');
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, connected]);

  useEffect(() => {
    if (!open) return;
    if (connecting) setPhase('connecting');
    else if (connected) setPhase('connected');
  }, [connecting, connected, open]);

  const onPick = async (name: WalletName) => {
    setError(null);
    setPhase('connecting');
    try {
      select(name);
      // connect() may be a no-op until the selected wallet finishes registering.
      await Promise.resolve();
      await connect();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase('error');
    }
  };

  const onCopy = async () => {
    if (publicKey) await navigator.clipboard?.writeText(publicKey.toBase58());
  };

  const onCancel = async () => {
    try {
      await disconnect();
    } catch {
      // noop
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="wm" role="dialog" aria-modal="true" aria-label="Connect wallet">
      <div className="wm__scrim" onClick={onClose} />
      <div className="wm__card">
        <div className="wm__head">
          <div className="wm__head-l">
            <span className="wm__cls-bar" />
            <span className="wm__cls">SECURE CHANNEL · WALLET HANDSHAKE</span>
          </div>
          <button
            ref={closeBtn}
            onClick={onClose}
            className="wm__close"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {phase === 'select' && (
          <>
            <div className="wm__title">Connect a wallet</div>
            <p className="wm__sub">
              Occult never sees your seed phrase. Signing happens locally; only the
              encrypted ciphertext leaves your device.
            </p>
            <div className="wm__list">
              {wallets.length === 0 ? (
                <div className="wm__opt" style={{ cursor: 'default' }}>
                  <span className="wm__opt-body">
                    <span className="wm__opt-name">No wallets detected</span>
                    <span className="wm__opt-blurb">
                      Install Phantom or Solflare to continue.
                    </span>
                  </span>
                </div>
              ) : (
                wallets.map((w) => {
                  const detected = w.readyState === 'Installed';
                  return (
                    <button
                      key={w.adapter.name}
                      className="wm__opt"
                      onClick={() => onPick(w.adapter.name as WalletName)}
                    >
                      <span className="wm__opt-icon"><WalletIcon adapter={w.adapter} /></span>
                      <span className="wm__opt-body">
                        <span className="wm__opt-name">{w.adapter.name}</span>
                        <span className="wm__opt-blurb">{blurbFor(w.adapter.name)}</span>
                      </span>
                      <span className="wm__opt-tag">
                        {detected ? 'Detected' : 'Loadable'}
                      </span>
                      <span className="wm__opt-chev" aria-hidden="true">
                        <svg viewBox="0 0 16 16" width="14" height="14">
                          <path
                            d="M5 3l5 5-5 5"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            fill="none"
                            strokeLinecap="square"
                          />
                        </svg>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {demoWallet && (
              <button
                className="wm__demo"
                onClick={() => onPick(demoWallet.adapter.name as WalletName)}
              >
                <span className="wm__demo-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="12" height="12">
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      fill="none"
                      strokeLinecap="square"
                    />
                  </svg>
                </span>
                <span>
                  Use demo account
                  <span className="wm__demo-sub">no install · pre-funded localnet</span>
                </span>
              </button>
            )}

            <div className="wm__foot">
              <span className="wm__foot-k">By connecting, you accept the</span>
              <a href="#" className="wm__foot-a">
                terms of service
              </a>
              <span className="wm__foot-k">and</span>
              <a href="#" className="wm__foot-a">
                privacy policy
              </a>
            </div>
          </>
        )}

        {phase === 'connecting' && (
          <div className="wm__state">
            <div className="wm__state-icon">
              <WalletIcon adapter={activeWallet?.adapter ?? null} size={48} />
            </div>
            <div className="wm__title">
              Opening {activeWallet?.adapter.name ?? 'wallet'}…
            </div>
            <p className="wm__sub">Confirm the handshake in your wallet extension.</p>
            <div className="wm__progress" aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span /><span />
            </div>
            <div className="wm__steps">
              <div className="wm__step is-active">
                <span className="wm__step-dot" />
                <span>Awaiting signature</span>
              </div>
              <div className="wm__step">
                <span className="wm__step-dot" />
                <span>Deriving session key</span>
              </div>
              <div className="wm__step">
                <span className="wm__step-dot" />
                <span>Establishing channel</span>
              </div>
            </div>
            <button className="wm__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}

        {phase === 'connected' && publicKey && (
          <div className="wm__state">
            <div className="wm__state-icon">
              <WalletIcon adapter={activeWallet?.adapter ?? null} size={48} />
            </div>
            <div className="wm__title">Channel established</div>
            <p className="wm__sub">
              Connected to {activeWallet?.adapter.name ?? 'wallet'}. Address visible only to you.
            </p>
            <div className="wm__addr">
              <span className="wm__addr-k">PUBLIC KEY</span>
              <span className="wm__addr-v">{shortAddr(publicKey.toBase58())}</span>
              <button className="wm__addr-copy" onClick={onCopy}>
                copy
              </button>
            </div>
            <div className="wm__actions">
              <button className="btn btn--primary" onClick={onClose}>
                <span>Continue</span>
              </button>
              <button
                className="btn btn--ghost"
                onClick={async () => {
                  try {
                    await disconnect();
                  } catch {
                    /* noop */
                  }
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="wm__state">
            <div className="wm__state-icon">
              <WalletIcon adapter={activeWallet?.adapter ?? null} size={48} />
            </div>
            <div className="wm__title">Could not connect</div>
            <p className="wm__sub">{error ?? 'The wallet rejected the handshake.'}</p>
            <div className="wm__actions">
              <button className="btn btn--primary" onClick={() => setPhase('select')}>
                <span>Try again</span>
              </button>
              <button className="btn btn--ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        <div className="wm__strip" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
      </div>
    </div>
  );
}
