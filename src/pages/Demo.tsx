import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import Redacted from '../components/Redacted';
import '../landing.css';
import '../demo.css';

// ---------------------------------------------------------------------------
// Demo nav
// ---------------------------------------------------------------------------
function DemoNav({
  batchTimeLeft,
  batchN,
  batchProgress,
}: {
  batchTimeLeft: number;
  batchN: number;
  batchProgress: number;
}) {
  const { connected } = useWallet();
  return (
    <nav className="dnav">
      <div className="dnav__inner">
        <Link to="/" className="nav__brand dnav__brand">
          <span className="nav__mark" aria-hidden="true">
            <span className="nav__mark-bar" />
            <span className="nav__mark-bar" />
          </span>
          <span className="nav__name">Occult</span>
          <span className="dnav__divider">/</span>
          <span className="dnav__crumb">DEMO</span>
        </Link>
        <div className="dnav__center">
          <span className="dnav__chip">
            <span className="dnav__chip-dot" />
            DEVNET
          </span>
          <span className="dnav__batch">
            <span className="dnav__batch-k">BATCH</span>
            <span className="dnav__batch-v">#{batchN}</span>
          </span>
          <span className="dnav__batch">
            <span className="dnav__batch-k">CLEARS IN</span>
            <span className="dnav__batch-v">{String(batchTimeLeft).padStart(2, '0')}s</span>
          </span>
          <span
            className="dnav__progress"
            aria-hidden
            style={{ ['--p' as string]: batchProgress } as React.CSSProperties}
          >
            <span
              className="dnav__progress-fill"
              style={{ width: `${(1 - batchProgress) * 100}%` }}
            />
          </span>
        </div>
        <div className="dnav__right">
          <Link to="/" className="dnav__back">
            ← Landing
          </Link>
          <WalletMultiButton className={`btn btn--ghost dnav__connect ${connected ? 'is-connected' : ''}`} />
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Encrypted orderbook
// ---------------------------------------------------------------------------
function Orderbook() {
  const bids = [
    { px: '142.84', w: 38 },
    { px: '142.83', w: 64 },
    { px: '142.82', w: 22 },
    { px: '142.81', w: 88 },
    { px: '142.80', w: 47 },
  ];
  const asks = [
    { px: '142.86', w: 41 },
    { px: '142.87', w: 26 },
    { px: '142.89', w: 78 },
    { px: '142.91', w: 33 },
    { px: '142.93', w: 55 },
  ].reverse();

  return (
    <section className="panel ob">
      <header className="panel__head">
        <div className="panel__title">
          <span className="panel__eb" />
          <span>ENCRYPTED ORDERBOOK</span>
        </div>
        <div className="panel__sub">SOL/USDC · sizes sealed</div>
      </header>
      <div className="ob__cols">
        <span>PRICE</span>
        <span>SIZE</span>
        <span>DEPTH</span>
      </div>
      <div className="ob__side ob__side--asks">
        {asks.map((r, i) => (
          <div key={i} className="ob__row ob__row--ask">
            <span className="ob__px">{r.px}</span>
            <span className="ob__sz">
              <span className="ob__sz-bar" style={{ width: `${r.w}%` }}>
                <span style={{ flexGrow: 2 }} />
                <span style={{ flexGrow: 3 }} />
                <span style={{ flexGrow: 1.5 }} />
              </span>
            </span>
            <span className="ob__depth">
              <span
                className="ob__depth-fill ob__depth-fill--ask"
                style={{ width: `${r.w}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      <div className="ob__mid">
        <span className="ob__mid-px">142.85</span>
        <span className="ob__mid-lbl">SEALED MID · ZK-VERIFIED</span>
        <span className="ob__mid-spread">spread 0.014%</span>
      </div>
      <div className="ob__side ob__side--bids">
        {bids.map((r, i) => (
          <div key={i} className="ob__row ob__row--bid">
            <span className="ob__px">{r.px}</span>
            <span className="ob__sz">
              <span className="ob__sz-bar" style={{ width: `${r.w}%` }}>
                <span style={{ flexGrow: 2 }} />
                <span style={{ flexGrow: 3 }} />
                <span style={{ flexGrow: 1.5 }} />
              </span>
            </span>
            <span className="ob__depth">
              <span
                className="ob__depth-fill ob__depth-fill--bid"
                style={{ width: `${r.w}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Swap card
// ---------------------------------------------------------------------------
type TxStatus = 'idle' | 'encrypting' | 'queued' | 'settling' | 'sealed';

function SwapCard({ onSubmit, txStatus }: { onSubmit: () => void; txStatus: TxStatus }) {
  const { connected } = useWallet();
  const [amount, setAmount] = useState('104.00');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const numAmount = parseFloat(amount.replace(/,/g, '')) || 0;
  const out = (numAmount * 142.85).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const submit = () => {
    if (txStatus !== 'idle') return;
    if (!connected) {
      alert('Connect wallet to submit a real order. (Demo simulates the flow until WASM proofs land.)');
    }
    onSubmit();
  };

  const label = {
    idle: connected
      ? side === 'buy'
        ? 'ENCRYPT & SUBMIT BID'
        : 'ENCRYPT & SUBMIT ASK'
      : 'CONNECT WALLET',
    encrypting: 'ENCRYPTING…',
    queued: 'QUEUED IN BATCH',
    settling: 'SETTLING…',
    sealed: '✓ SEALED',
  }[txStatus];

  return (
    <section className="panel swap">
      <header className="panel__head">
        <div className="panel__title">
          <span className="panel__eb" />
          <span>SUBMIT ORDER</span>
        </div>
        <div className="swap__sides">
          <button
            className={`swap__side ${side === 'buy' ? 'is-active' : ''}`}
            onClick={() => setSide('buy')}
          >
            BUY
          </button>
          <button
            className={`swap__side ${side === 'sell' ? 'is-active' : ''}`}
            onClick={() => setSide('sell')}
          >
            SELL
          </button>
        </div>
      </header>

      <div className="swap__field">
        <label>{side === 'buy' ? 'YOU PAY' : 'YOU SELL'}</label>
        <div className="swap__input">
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            spellCheck={false}
          />
          <span className="swap__token">{side === 'buy' ? 'USDC' : 'SOL'}</span>
        </div>
        <div className="swap__balance">
          BALANCE&nbsp;
          <Redacted segments={2}>12,840.00</Redacted>
        </div>
      </div>

      <div className="swap__divider"><span>≈</span></div>

      <div className="swap__field">
        <label>YOU RECEIVE</label>
        <div className="swap__input">
          <span className="swap__output">
            {side === 'buy'
              ? (numAmount / 142.85).toLocaleString('en-US', {
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4,
                })
              : out}
          </span>
          <span className="swap__token">{side === 'buy' ? 'SOL' : 'USDC'}</span>
        </div>
        <div className="swap__balance">AT BATCH CLEARING PRICE · NOT FRONT-RUNNABLE</div>
      </div>

      <div className="swap__meta">
        <div className="swap__meta-row">
          <span>Mode</span>
          <span>Batch auction · uniform price</span>
        </div>
        <div className="swap__meta-row">
          <span>Encryption</span>
          <span>ZK ElGamal (Curve25519)</span>
        </div>
        <div className="swap__meta-row">
          <span>Slippage</span>
          <span>None — sealed at clearing</span>
        </div>
        <div className="swap__meta-row">
          <span>Network fee</span>
          <span>~0.000041 SOL</span>
        </div>
      </div>

      <button
        className={`swap__submit ${txStatus !== 'idle' ? 'is-active' : ''}`}
        onClick={submit}
      >
        <span
          className="swap__submit-fill"
          style={{
            transform:
              txStatus === 'encrypting'
                ? 'scaleX(0.3)'
                : txStatus === 'queued'
                  ? 'scaleX(0.6)'
                  : txStatus === 'settling'
                    ? 'scaleX(0.9)'
                    : txStatus === 'sealed'
                      ? 'scaleX(1)'
                      : 'scaleX(0)',
          }}
        />
        <span className="swap__submit-label">{label}</span>
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function Demo() {
  const [batchN, setBatchN] = useState(8424);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTimeLeft, setBatchTimeLeft] = useState(15);
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.redaction = 'outlined';
    root.dataset.density = 'spacious';
    root.dataset.ambient = 'on';
    root.dataset.classification = 'on';
    root.dataset.monoOnly = 'off';
  }, []);

  // Batch ticker
  useEffect(() => {
    const start = Date.now();
    const DURATION = 15000;
    const i = setInterval(() => {
      const elapsed = (Date.now() - start) % DURATION;
      const p = elapsed / DURATION;
      setBatchProgress(p);
      setBatchTimeLeft(Math.ceil((DURATION - elapsed) / 1000));
      if (elapsed < 100) {
        setBatchN((n) => n + 1);
      }
    }, 80);
    return () => clearInterval(i);
  }, []);

  const submit = () => {
    setTxStatus('encrypting');
    setTimeout(() => setTxStatus('queued'), 900);
    setTimeout(() => setTxStatus('settling'), 2200);
    setTimeout(() => setTxStatus('sealed'), 3300);
    setTimeout(() => setTxStatus('idle'), 5400);
  };

  return (
    <>
      <DemoNav batchTimeLeft={batchTimeLeft} batchN={batchN} batchProgress={batchProgress} />
      <main className="dpage dpage--slim">
        <div className="dpage__grid dpage__grid--2col">
          <div className="dpage__col">
            <Orderbook />
          </div>
          <div className="dpage__col">
            <SwapCard onSubmit={submit} txStatus={txStatus} />
          </div>
        </div>

        <footer className="dpage__foot">
          <span>OCCULT v0.4.2 · DEVNET · DOCUMENT REF /OCC-DEMO-01</span>
          <span>Simulation. Real order submission requires the WASM proof module.</span>
        </footer>
      </main>
    </>
  );
}
