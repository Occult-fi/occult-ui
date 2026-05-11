import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export default function WalletButton({ onOpen }: { onOpen: () => void }) {
  const { publicKey, disconnect, connected, connecting } = useWallet();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const short = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : '';

  const onClick = () => {
    if (!connected) {
      onOpen();
    } else {
      setOpen((v) => !v);
    }
  };

  const copy = async () => {
    if (publicKey) await navigator.clipboard.writeText(publicKey.toBase58());
    setOpen(false);
  };

  const onDisconnect = async () => {
    setOpen(false);
    try {
      await disconnect();
    } catch {
      // noop
    }
  };

  return (
    <div className="connect" ref={wrapRef}>
      <button
        className={`btn btn--ghost dnav__connect ${connected ? 'is-connected' : ''}`}
        onClick={onClick}
      >
        <span className={`dnav__connect-dot ${connected ? 'is-on' : ''}`} />
        <span>{connecting ? 'Connecting…' : connected ? short : 'Connect'}</span>
      </button>
      {connected && open && (
        <div className="connect__menu">
          <button onClick={copy} className="connect__menu-item">
            Copy address
          </button>
          <button onClick={onDisconnect} className="connect__menu-item">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
