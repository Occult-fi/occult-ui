import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import Redacted from '../components/Redacted';
import WalletButton from '../components/WalletButton';
import OccultWalletModal from '../components/OccultWalletModal';
import { wasmVersion, aesDecrypt } from '../wasm/proofs';
import { decodeConfidentialAccount, type ConfidentialAccount } from '../protocol/confidentialAccount';
import {
  loadState,
  loadDemoSecrets,
  loadAuditorSecrets,
  type OccultState,
} from '../protocol/state';
import { submitOrder, type SubmitPhase } from '../protocol/submitOrder';
import { decodePool, type PoolAccount } from '../protocol/poolAccount';
import { decodeBatch, BatchStatus, type BatchAccount } from '../protocol/batchAccount';
import { deriveBatch } from '../protocol/pdas';
import { loadHistory, saveHistory, type StoredTx } from '../protocol/history';
import { classifyNetwork, networkLabel, explorerTxUrl, type NetworkKind } from '../protocol/network';
import { loadTokenList, tokenInfo, type TokenInfo } from '../protocol/tokenList';
import { executeWrap, executeUnwrap } from '../protocol/wrapper';
import {
  useAccountData,
  useProgramAccounts,
  useSlot,
  decodeSplTokenAmount,
} from '../hooks/useSolanaSubscriptions';
import { DemoWalletName } from '../wallet/DemoWalletAdapter';
import '../landing.css';
import '../demo.css';
import '../pools.css';

function DemoNav({
  batchTimeLeft,
  batchN,
  batchProgress,
  onConnect,
  networkLabel,
}: {
  batchTimeLeft: number;
  batchN: number;
  batchProgress: number;
  onConnect: () => void;
  networkLabel: string;
}) {
  return (
    <nav className="dnav">
      <div className="dnav__inner">
        <Link to="/" className="nav__brand dnav__brand">
          <span className="nav__mark" aria-hidden="true">
            <span className="nav__mark-bar" />
            <span className="nav__mark-bar" />
          </span>
          <span className="nav__name">Occult</span>
        </Link>
        <div className="dnav__tabs">
          <Link to="/demo" className="dnav__tab is-active">Trade</Link>
          <Link to="/pools" className="dnav__tab">Pools</Link>
        </div>
        <div className="dnav__center">
          <span className="dnav__chip">
            <span className="dnav__chip-dot" />
            {networkLabel}
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
          <WalletButton onOpen={onConnect} />
        </div>
      </div>
    </nav>
  );
}

type PoolView = {
  id: string;
  poolAddress: PublicKey;
  baseSymbol: string;
  quoteSymbol: string;
  baseIcon: string;
  quoteIcon: string;
  price: number | null;
  tvlUsd: number | null;
  // 0..100, pool size relative to others.
  depth: number;
  batchId: bigint;
  isPrimary: boolean;
};

function PoolIcon({
  url,
  fallback,
  variant,
}: {
  url: string;
  fallback: string;
  variant?: 'quote';
}) {
  const [broken, setBroken] = useState(!url);
  const cls = `pools__pair-i${variant === 'quote' ? ' pools__pair-i--quote' : ''}`;
  if (broken) {
    return <span className={cls}>{fallback}</span>;
  }
  return (
    <img
      className={`${cls} pools__pair-i--img`}
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

function formatTvl(usd: number | null): string {
  if (usd === null) return '—';
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

function formatPrice(p: number | null): string {
  if (p === null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  if (p > 0) return p.toFixed(6);
  return '0';
}

function PoolSearchModal({
  open,
  pools,
  activeId,
  onClose,
  onSelect,
}: {
  open: boolean;
  pools: PoolView[];
  activeId: string | null;
  onClose: () => void;
  onSelect: (p: PoolView) => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Narrow deps: parent re-renders would otherwise wipe input mid-typing.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const ql = q.trim().toLowerCase();
  const filtered = pools.filter((p) => {
    if (!ql) return true;
    return (
      p.baseSymbol.toLowerCase().includes(ql) ||
      p.quoteSymbol.toLowerCase().includes(ql) ||
      `${p.baseSymbol}/${p.quoteSymbol}`.toLowerCase().includes(ql)
    );
  });

  return createPortal(
    <div className="wm" role="dialog" aria-modal="true">
      <div className="wm__scrim" onClick={onClose} />
      <div className="wm__card psm">
        <div className="wm__head">
          <div className="wm__head-l">
            <span className="wm__cls-bar" />
            <span>POOL DIRECTORY · {pools.length} PAIRS</span>
          </div>
          <button onClick={onClose} className="wm__close" aria-label="Close">
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" fill="none" />
            </svg>
          </button>
        </div>
        <div className="psm__search">
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M9 9l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" fill="none" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pair · SOL, USDC, JUP/USDC…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            spellCheck={false}
          />
          {q && (
            <button className="psm__clr" onClick={() => setQ('')} aria-label="Clear">
              ×
            </button>
          )}
        </div>
        <div className="psm__head">
          <span>PAIR</span>
          <span>PRICE</span>
          <span>BATCH</span>
          <span>TVL</span>
        </div>
        <div className="psm__rows">
          {filtered.length === 0 && <div className="psm__empty">No pairs match.</div>}
          {filtered.map((p) => (
            <button
              key={p.id}
              className={`psm__row ${activeId === p.id ? 'is-active' : ''}`}
              onClick={() => {
                onSelect(p);
                onClose();
              }}
            >
              <span className="psm__pair">
                <span className="pools__pair-icons" aria-hidden="true">
                  <PoolIcon url={p.baseIcon} fallback={p.baseSymbol.slice(0, 1)} />
                  <PoolIcon url={p.quoteIcon} fallback={p.quoteSymbol.slice(0, 1)} variant="quote" />
                </span>
                <span className="psm__pair-name">
                  {p.baseSymbol}/{p.quoteSymbol}
                </span>
              </span>
              <span className="psm__price">{formatPrice(p.price)}</span>
              <span className="pools__d24">#{p.batchId.toString()}</span>
              <span className="psm__tvl">{formatTvl(p.tvlUsd)}</span>
            </button>
          ))}
        </div>
        <div className="wm__strip">
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
      </div>
    </div>,
    document.body
  );
}

function Pools({
  pools,
  activeId,
  onSelect,
  loading,
}: {
  pools: PoolView[];
  activeId: string | null;
  onSelect: (p: PoolView) => void;
  loading: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const active = pools.find((p) => p.id === activeId) ?? pools[0] ?? null;

  return (
    <section className="panel pools">
      <header className="panel__head">
        <div className="panel__title">
          <span className="panel__eb" />
          <span>POOLS</span>
        </div>
        <div className="panel__sub">
          {loading
            ? 'discovering on-chain…'
            : `${pools.length} pair${pools.length === 1 ? '' : 's'} · on-chain · ZK-verified`}
        </div>
        <button className="pools__search-btn" onClick={() => setSearchOpen(true)}>
          <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M9 9l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" fill="none" />
          </svg>
          <span>Search · filter</span>
          <span className="pools__search-kbd">⌘K</span>
        </button>
      </header>
      <PoolSearchModal
        open={searchOpen}
        pools={pools}
        activeId={activeId}
        onClose={() => setSearchOpen(false)}
        onSelect={onSelect}
      />
      <div className="pools__head">
        <span>PAIR</span>
        <span>PRICE</span>
        <span>BATCH</span>
        <span>TVL</span>
        <span>DEPTH</span>
      </div>
      <div className="pools__rows">
        {pools.length === 0 && !loading ? (
          <div className="pools__empty">
            no pools found on-chain — has the bootstrap finished?
          </div>
        ) : (
          pools.map((p) => (
            <button
              key={p.id}
              className={`pools__row ${activeId === p.id ? 'is-active' : ''}`}
              onClick={() => onSelect(p)}
            >
              <span className="pools__pair">
                <span className="pools__pair-icons" aria-hidden="true">
                  <PoolIcon url={p.baseIcon} fallback={p.baseSymbol.slice(0, 1)} />
                  <PoolIcon url={p.quoteIcon} fallback={p.quoteSymbol.slice(0, 1)} variant="quote" />
                </span>
                <span className="pools__pair-name">
                  {p.baseSymbol}/{p.quoteSymbol}
                  {p.isPrimary && <span className="pools__live-dot" aria-label="live order flow" />}
                </span>
              </span>
              <span className="pools__price">{formatPrice(p.price)}</span>
              <span className="pools__d24">#{p.batchId.toString()}</span>
              <span className="pools__tvl">{formatTvl(p.tvlUsd)}</span>
              <span className="pools__depth" aria-hidden="true">
                <span className="pools__depth-bar" style={{ width: `${p.depth}%` }} />
              </span>
            </button>
          ))
        )}
      </div>
      {active && (
        <div className="pools__selected">
          <div className="pools__selected-l">
            <span className="pools__selected-k">SELECTED</span>
            <span className="pools__selected-pair">
              <span className="pools__pair-icons" aria-hidden="true">
                <PoolIcon url={active.baseIcon} fallback={active.baseSymbol.slice(0, 1)} />
                <PoolIcon
                  url={active.quoteIcon}
                  fallback={active.quoteSymbol.slice(0, 1)}
                  variant="quote"
                />
              </span>
              <span className="pools__selected-name">
                {active.baseSymbol}/{active.quoteSymbol}
              </span>
            </span>
          </div>
          <div className="pools__selected-stats">
            <span className="pools__selected-stat">
              <span className="pools__selected-k">SEALED MID</span>
              <span className="pools__selected-v">{formatPrice(active.price)}</span>
            </span>
            <span className="pools__selected-stat">
              <span className="pools__selected-k">TVL</span>
              <span className="pools__selected-v">{formatTvl(active.tvlUsd)}</span>
            </span>
            <span className="pools__selected-stat">
              <span className="pools__selected-k">BATCH</span>
              <span className="pools__selected-v">#{active.batchId.toString()}</span>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

type TxStatus = 'idle' | 'encrypting' | 'queued' | 'settling' | 'sealed';

function SwapCard({
  onSubmit,
  txStatus,
  onConnect,
  balanceA,
  balanceB,
  decimalsA,
  decimalsB,
  reserveA,
  reserveB,
  feeBps,
  symbolA,
  symbolB,
  baseIsA,
}: {
  onSubmit: (order: { side: 'buy' | 'sell'; amount: string }) => void;
  txStatus: TxStatus;
  onConnect: () => void;
  balanceA: bigint | null;
  balanceB: bigint | null;
  decimalsA: number;
  decimalsB: number;
  reserveA: bigint | null;
  reserveB: bigint | null;
  feeBps: number;
  symbolA: string;
  symbolB: string;
  baseIsA: boolean;
}) {
  const { connected } = useWallet();
  const [amount, setAmount] = useState('1.00');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const numAmount = parseFloat(amount.replace(/,/g, '')) || 0;

  // BUY pays quote, receives base. SELL pays base, receives quote.
  // payIsA tells which mint we pay from based on baseIsA layout.
  const payIsA = (side === 'buy') !== baseIsA;
  const symbolIn = payIsA ? symbolA : symbolB;
  const symbolOut = payIsA ? symbolB : symbolA;
  const balanceIn = payIsA ? balanceA : balanceB;
  const decimalsIn = payIsA ? decimalsA : decimalsB;

  // Mirrors close_batch clearing math (xy=k with fee_bps on input).
  const previewOutput = (() => {
    if (!reserveA || !reserveB || numAmount <= 0) return null;
    const decIn = payIsA ? decimalsA : decimalsB;
    const decOut = payIsA ? decimalsB : decimalsA;
    const rIn = payIsA ? reserveA : reserveB;
    const rOut = payIsA ? reserveB : reserveA;
    const inBase = BigInt(Math.round(numAmount * 10 ** decIn));
    const feeFactor = BigInt(10000 - feeBps);
    const num = inBase * feeFactor * rOut;
    const den = rIn * 10000n + inBase * feeFactor;
    if (den === 0n) return null;
    const outBase = num / den;
    return Number(outBase) / 10 ** decOut;
  })();

  const out =
    previewOutput === null
      ? '—'
      : previewOutput.toLocaleString('en-US', {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        });

  const submit = () => {
    if (txStatus !== 'idle') return;
    if (!connected) {
      onConnect();
      return;
    }
    onSubmit({ side, amount });
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
          <span className="swap__token">{symbolIn}</span>
        </div>
        <div className="swap__balance">
          BALANCE&nbsp;
          {balanceIn === null ? (
            <Redacted segments={2}>?????</Redacted>
          ) : (
            <span>{formatBaseUnits(balanceIn, decimalsIn)}</span>
          )}
        </div>
      </div>

      <div className="swap__divider"><span>≈</span></div>

      <div className="swap__field">
        <label>YOU RECEIVE</label>
        <div className="swap__input">
          <span className="swap__output">{out}</span>
          <span className="swap__token">{symbolOut}</span>
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

type Tx = {
  id: string;
  time: string;
  // undefined = 'swap' for legacy entries.
  kind?: 'swap' | 'wrap' | 'unwrap';
  side: 'buy' | 'sell';
  amount: string;
  tokenIn: string;
  tokenOut: string;
  fillOut: string | null;
  fillPx: string | null;
  batch: number | null;
  status: TxStatus;
  sig: string;
  ticket?: string;
  batchId?: bigint;
  pool?: string;
};

function shortSig(s: string) {
  return s.slice(0, 6) + '…' + s.slice(-4);
}

function MyTxs({
  txs,
  networkKind,
  rpcUrl,
}: {
  txs: Tx[];
  networkKind: NetworkKind;
  rpcUrl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!txs.length) {
    return (
      <section className="panel mytx">
        <header className="panel__head">
          <div className="panel__title">
            <span className="panel__eb" />
            <span>YOUR TRANSACTIONS</span>
          </div>
          <div className="panel__sub">session log · sealed to others, visible to you</div>
        </header>
        <div className="mytx__empty">
          <span className="mytx__empty-mark">∅</span>
          <span>No orders yet. Submit one — it'll appear here once sealed.</span>
        </div>
      </section>
    );
  }
  const COLLAPSED = 2;
  const visible = expanded ? txs : txs.slice(0, COLLAPSED);
  const hidden = txs.length - COLLAPSED;
  return (
    <section className="panel mytx">
      <header className="panel__head">
        <div className="panel__title">
          <span className="panel__eb" />
          <span>YOUR TRANSACTIONS</span>
        </div>
        <div className="panel__sub">
          {txs.length} {txs.length === 1 ? 'tx' : 'txs'} · sealed to others, visible to you
        </div>
      </header>
      <div className="mytx__head">
        <span>TIME</span>
        <span>SIDE</span>
        <span>AMOUNT</span>
        <span>FILL</span>
        <span>BATCH</span>
        <span>STATUS</span>
        <span></span>
      </div>
      <div className="mytx__rows">
        {visible.map((t) => {
          const isWrap = t.kind === 'wrap' || t.kind === 'unwrap';
          const sideKey = isWrap ? t.kind! : t.side;
          const sideLabel = isWrap ? t.kind!.toUpperCase() : t.side.toUpperCase();
          return (
          <div key={t.id} className={`mytx__row mytx__row--${t.status}`}>
            <span className="mytx__t">{t.time}</span>
            <span className={`mytx__side mytx__side--${sideKey}`}>{sideLabel}</span>
            <span className="mytx__amt">
              {t.amount} <span className="mytx__amt-tok">{t.tokenIn}</span>
            </span>
            <span className="mytx__fill">
              {isWrap ? (
                t.fillOut ? (
                  <>
                    {t.fillOut} <span className="mytx__amt-tok">{t.tokenOut}</span>
                  </>
                ) : (
                  <span className="mytx__pending">—</span>
                )
              ) : t.fillPx ? (
                `${t.fillOut} ${t.tokenOut} @ ${t.fillPx}`
              ) : (
                <span className="mytx__pending">—</span>
              )}
            </span>
            <span className="mytx__batch">{t.batch !== null && t.batch !== undefined ? `#${t.batch}` : '—'}</span>
            <span className={`mytx__status mytx__status--${t.status}`}>
              {t.status === 'sealed'
                ? '✓ sealed'
                : t.status === 'settling'
                  ? 'settling…'
                  : t.status === 'queued'
                    ? 'queued'
                    : 'encrypting…'}
            </span>
            {(() => {
              const url = explorerTxUrl(t.sig, networkKind, rpcUrl);
              if (!url) {
                return <span className="mytx__explorer mytx__explorer--local">{shortSig(t.sig)}</span>;
              }
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mytx__explorer"
                  title={`View ${shortSig(t.sig)} on Solscan`}
                  aria-label="View on explorer"
                >
                  <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
                    <path d="M5 2H2v10h10V9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="square" />
                    <path d="M8 2h4v4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="square" />
                    <path d="M7 7l5-5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="square" />
                  </svg>
                  <span className="mytx__explorer-sig">{shortSig(t.sig)}</span>
                </a>
              );
            })()}
          </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <button className="mytx__more" onClick={() => setExpanded((e) => !e)}>
          <span className="mytx__more-line" />
          <span className="mytx__more-label">
            {expanded ? 'Collapse' : `View ${hidden} more`}
            <svg
              viewBox="0 0 12 12"
              width="10"
              height="10"
              aria-hidden="true"
              style={{
                transform: expanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 200ms',
              }}
            >
              <path
                d="M3 5l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="square"
              />
            </svg>
          </span>
          <span className="mytx__more-line" />
        </button>
      )}
    </section>
  );
}

function phaseToStatus(phase: SubmitPhase): TxStatus {
  switch (phase) {
    case 'reading':
    case 'encrypting':
      return 'encrypting';
    case 'signing':
    case 'preflight':
    case 'preflight-range-verify':
      return 'queued';
    case 'submitting':
      return 'settling';
    case 'cleanup':
    case 'done':
      return 'sealed';
  }
}

function formatBaseUnits(base: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = base / divisor;
  const frac = base % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  if (fracStr.length === 0) return whole.toLocaleString('en-US');
  return `${whole.toLocaleString('en-US')}.${fracStr.slice(0, 4)}`;
}

function toBaseUnits(human: string, decimals: number): bigint {
  const cleaned = human.replace(/,/g, '').trim();
  const [whole, frac = ''] = cleaned.split('.');
  const wholeN = BigInt(whole || '0');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return wholeN * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}

// out_base = in_base * clearing_ratio_q32 / 2^32
function computeFill(
  inBase: bigint,
  clearingRatioQ32: bigint,
  outDecimals: number
): { fillOut: string; fillPx: string } {
  const outBase = (inBase * clearingRatioQ32) >> 32n;
  const divisor = 10n ** BigInt(outDecimals);
  const whole = outBase / divisor;
  const frac = outBase % divisor;
  const fracStr = frac.toString().padStart(outDecimals, '0').slice(0, 4);
  const fillOut = `${whole.toLocaleString('en-US')}.${fracStr}`;
  const ratio = Number(clearingRatioQ32) / 2 ** 32;
  return { fillOut, fillPx: ratio.toFixed(6) };
}

type TokenBalance = {
  symbol: string;
  name: string;
  native: number;
  shielded: number;
  iconUrl: string;
  // Used by WrapModal to pick the matching wrapper from state.wrappers.
  shieldedMint?: PublicKey;
};

function TokenIcon({ symbol, iconUrl }: { symbol: string; iconUrl: string }) {
  const isShielded = symbol.startsWith('sh');
  const display = isShielded ? symbol.slice(2) : symbol;
  const [broken, setBroken] = useState(!iconUrl);
  return (
    <span className={`tokicon ${isShielded ? 'is-shielded' : ''}`} aria-hidden="true">
      {broken || !iconUrl ? (
        <span className={`tokicon__core tokicon__core--${display.toLowerCase()}`}>
          {display.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          src={iconUrl}
          className={`tokicon__core tokicon__core--${display.toLowerCase()} tokicon__core--img`}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      )}
      {isShielded && <span className="tokicon__lock">▮</span>}
    </span>
  );
}

type WrapMode = 'wrap' | 'unwrap';

function WrapModal({
  open,
  mode,
  token,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: WrapMode;
  token: TokenBalance | null;
  onClose: () => void;
  onConfirm: (mode: WrapMode, token: TokenBalance, amount: number) => Promise<void> | void;
}) {
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<'input' | 'minting' | 'done'>('input');
  const [error, setError] = useState<string | null>(null);

  // Narrow deps: Demo re-renders on every poll, would wipe input mid-typing.
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setPhase('input');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'minting') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, phase]);

  if (!open || !token) return null;
  const isWrap = mode === 'wrap';
  const fromTok = isWrap ? token.symbol : `sh${token.symbol}`;
  const toTok = isWrap ? `sh${token.symbol}` : token.symbol;
  const balance = isWrap ? token.native : token.shielded;
  const numAmt = parseFloat(amount.replace(/,/g, '')) || 0;

  const submit = async () => {
    if (!numAmt) return;
    setError(null);
    setPhase('minting');
    try {
      await onConfirm(mode, token, numAmt);
      setPhase('done');
      setTimeout(onClose, 800);
    } catch (e) {
      console.error('[wrap modal]', e);
      setError(e instanceof Error ? e.message : String(e));
      setPhase('input');
    }
  };

  return (
    <div className="wm wrapm-modal" role="dialog" aria-modal="true">
      <div className="wm__scrim" onClick={() => phase !== 'minting' && onClose()} />
      <div className="wm__card wrapm">
        <div className="wm__head">
          <div className="wm__head-l">
            <span className="wm__cls-bar" />
            <span>{isWrap ? 'MINT SHIELDED · TOKEN-2022 WRAP' : 'BURN SHIELDED · UNWRAP'}</span>
          </div>
          <button onClick={onClose} className="wm__close" aria-label="Close" disabled={phase === 'minting'}>
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" fill="none" />
            </svg>
          </button>
        </div>

        {phase === 'input' && (
          <>
            <div className="wm__title">{isWrap ? `Wrap ${token.symbol}` : `Unwrap sh${token.symbol}`}</div>
            <p className="wm__sub">
              {isWrap
                ? `Convert ${token.symbol} into sh${token.symbol} — a Token-2022 wrapper the encrypted batch can hold. 1:1, redeemable any time.`
                : `Burn sh${token.symbol} to release native ${token.symbol}. 1:1, no slippage.`}
            </p>
            <div className="wrapm__flow">
              <div className="wrapm__side">
                <span className="wrapm__side-k">FROM</span>
                <div className="wrapm__side-tok">
                  <TokenIcon symbol={fromTok} iconUrl={token.iconUrl} />
                  <span>{fromTok}</span>
                </div>
                <input
                  className="wrapm__input"
                  type="text"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                  spellCheck={false}
                />
                <span className="wrapm__bal">
                  BAL{' '}
                  <button className="wrapm__max" onClick={() => setAmount(String(balance))}>
                    {balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </button>
                </span>
              </div>
              <div className="wrapm__arrow">→</div>
              <div className="wrapm__side">
                <span className="wrapm__side-k">TO</span>
                <div className="wrapm__side-tok">
                  <TokenIcon symbol={toTok} iconUrl={token.iconUrl} />
                  <span>{toTok}</span>
                </div>
                <div className="wrapm__output">
                  {numAmt ? numAmt.toLocaleString() : '0.00'}
                </div>
                <span className="wrapm__bal">RATE 1 : 1</span>
              </div>
            </div>
            <div className="wrapm__meta">
              <div className="wrapm__meta-row">
                <span>Standard</span>
                <span>{isWrap ? 'SPL → Token-2022' : 'Token-2022 → SPL'}</span>
              </div>
              <div className="wrapm__meta-row">
                <span>Network fee</span>
                <span>~0.000018 SOL</span>
              </div>
              <div className="wrapm__meta-row">
                <span>Slippage</span>
                <span>None — 1:1 mint/burn</span>
              </div>
              <div className="wrapm__meta-row">
                <span>Reversible</span>
                <span>Yes, any time</span>
              </div>
            </div>
            {error && (
              <div className="wrapm__error">
                <span className="wrapm__error-k">FAILED</span>
                <span className="wrapm__error-v">{error}</span>
              </div>
            )}
            <div className="wrapm__actions">
              <button className="wm__cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className={`btn btn--primary wrapm__go ${!numAmt ? 'is-disabled' : ''}`}
                onClick={submit}
                disabled={!numAmt}
              >
                <span>{isWrap ? `Mint sh${token.symbol}` : `Burn sh${token.symbol}`}</span>
              </button>
            </div>
          </>
        )}

        {phase === 'minting' && (
          <div className="wm__state">
            <div className="wm__title">{isWrap ? 'Minting…' : 'Burning…'}</div>
            <p className="wm__sub">
              {numAmt.toLocaleString()} {fromTok} → {toTok}. Signing locally.
            </p>
            <div className="wm__progress">
              <span /><span /><span /><span /><span /><span /><span /><span />
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="wm__state">
            <div className="wm__title">Done.</div>
            <p className="wm__sub">
              {numAmt.toLocaleString()} {toTok} now in your wallet.
            </p>
          </div>
        )}

        <div className="wm__strip">
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
      </div>
    </div>
  );
}

function Balances({
  balances,
  onWrap,
  onUnwrap,
}: {
  balances: TokenBalance[];
  onWrap: (b: TokenBalance) => void;
  onUnwrap: (b: TokenBalance) => void;
}) {
  return (
    <section className="panel bal">
      <header className="panel__head">
        <div className="panel__title">
          <span className="panel__eb" />
          <span>YOUR TOKENS</span>
        </div>
        <div className="panel__sub">
          native + shielded (Token-2022) · only shielded enters the encrypted batch
        </div>
      </header>
      <div className="bal__head">
        <span>TOKEN</span>
        <span>NATIVE</span>
        <span>SHIELDED</span>
        <span></span>
      </div>
      <div className="bal__rows">
        {balances.map((b) => (
          <div key={b.symbol} className="bal__row">
            <span className="bal__tok">
              <TokenIcon symbol={b.symbol} iconUrl={b.iconUrl} />
              <span className="bal__tok-n">{b.symbol}</span>
              <span className="bal__tok-name">{b.name}</span>
            </span>
            <span className="bal__amt">
              {b.native > 0
                ? b.native.toLocaleString(undefined, { maximumFractionDigits: 4 })
                : <span className="bal__amt-zero">—</span>}
            </span>
            <span className="bal__amt bal__amt--sh">
              {b.shielded > 0 ? (
                <>
                  <span className="bal__sh-pre">sh</span>
                  {b.shielded.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </>
              ) : (
                <span className="bal__amt-zero">—</span>
              )}
            </span>
            <span className="bal__actions">
              <button
                className="bal__btn"
                onClick={() => onWrap(b)}
                disabled={b.native <= 0}
              >
                <svg viewBox="0 0 14 14" width="11" height="11">
                  <path d="M2 7h10M9 4l3 3-3 3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="square" />
                </svg>
                wrap
              </button>
              <button
                className="bal__btn bal__btn--ghost"
                onClick={() => onUnwrap(b)}
                disabled={b.shielded <= 0}
              >
                <svg viewBox="0 0 14 14" width="11" height="11">
                  <path d="M12 7H2M5 4L2 7l3 3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="square" />
                </svg>
                unwrap
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="bal__foot">
        <span className="bal__foot-k">PROTOCOL NOTE</span>
        <span className="bal__foot-v">
          Most SPL tokens aren't Token-2022 native. Occult mints 1:1 wrappers (sh-prefix) so
          they sit inside the encrypted batch. Burn any time to redeem the underlying.
        </span>
      </div>
    </section>
  );
}

export default function Demo() {
  const { connection } = useConnection();
  const { wallet, publicKey, signTransaction, signAllTransactions } = useWallet();
  const connectedKey = publicKey?.toBase58();
  const [tokenList, setTokenList] = useState<Record<string, TokenInfo>>({});
  const [poolViews, setPoolViews] = useState<PoolView[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [activePoolId, setActivePoolId] = useState<string | null>(null);
  const [state, setState] = useState<OccultState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const networkKind: NetworkKind = state ? classifyNetwork(state.rpcUrl) : 'unknown';
  const networkLabelText = networkLabel(networkKind);

  const [batchN, setBatchN] = useState(8424);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTimeLeft, setBatchTimeLeft] = useState(15);
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [walletOpen, setWalletOpen] = useState(false);
  const [balanceA, setBalanceA] = useState<bigint | null>(null);
  const [balanceB, setBalanceB] = useState<bigint | null>(null);
  const [reserveA, setReserveA] = useState<bigint | null>(null);
  const [reserveB, setReserveB] = useState<bigint | null>(null);
  const [feeBps, setFeeBps] = useState<number>(30);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [wrapState, setWrapState] = useState<{
    open: boolean;
    mode: WrapMode;
    token: TokenBalance | null;
  }>({ open: false, mode: 'wrap', token: null });
  const [legacyUsdcBalance, setLegacyUsdcBalance] = useState<bigint | null>(null);
  type ActivePool = {
    address: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
    decimalsA: number;
    decimalsB: number;
    symbolA: string;
    symbolB: string;
    /** True when mintA is the base coin (non-stable). When false, A is
     *  the quote — used to map BUY = pay quote / receive base regardless
     *  of canonical mint-lex ordering. */
    baseIsA: boolean;
  };
  const activePool = useMemo<ActivePool | null>(() => {
    if (!state) return null;
    const mk = (
      addr: PublicKey,
      mintA: PublicKey,
      mintB: PublicKey,
      decA: number,
      decB: number,
    ): ActivePool => {
      const aInfo = tokenInfo(tokenList, mintA.toBase58());
      const bInfo = tokenInfo(tokenList, mintB.toBase58());
      const aIsQuote = aInfo.kind === 'stable' && bInfo.kind !== 'stable';
      return {
        address: addr,
        mintA,
        mintB,
        decimalsA: decA,
        decimalsB: decB,
        symbolA: aInfo.symbol,
        symbolB: bInfo.symbol,
        baseIsA: !aIsQuote,
      };
    };
    if (activePoolId && state.demoAccount?.byPool?.[activePoolId]) {
      const entry = state.demoAccount.byPool[activePoolId];
      const aInfo = tokenInfo(tokenList, entry.mintA.toBase58());
      const bInfo = tokenInfo(tokenList, entry.mintB.toBase58());
      return mk(
        new PublicKey(activePoolId),
        entry.mintA,
        entry.mintB,
        aInfo.decimals,
        bInfo.decimals,
      );
    }
    const pa = state.primaryPool;
    return mk(pa.address, pa.mintA, pa.mintB, pa.decimalsA, pa.decimalsB);
  }, [state, activePoolId, tokenList]);

  const walletAccount = useAccountData<bigint>(publicKey ?? null, () => 0n);
  const walletSolLamports = walletAccount.raw ? BigInt(walletAccount.raw.lamports) : null;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.redaction = 'outlined';
    root.dataset.density = 'spacious';
    root.dataset.ambient = 'on';
    root.dataset.classification = 'on';
    root.dataset.monoOnly = 'off';
  }, []);

  useEffect(() => {
    wasmVersion()
      .then((v) => console.log('[occult-wasm] version', v))
      .catch((e) => console.error('[occult-wasm] failed to load:', e));
  }, []);

  useEffect(() => {
    loadState()
      .then((s) => {
        console.log('[Demo] state set, demoAccount?', !!s.demoAccount, 'owner:', s.demoAccount?.owner.toBase58());
        setState(s);
      })
      .catch((e) => {
        console.error('[occult] state.json:', e);
        setStateError(String(e?.message ?? e));
      });
  }, []);

  useEffect(() => {
    if (!connectedKey) {
      setTxs([]);
      return;
    }
    const stored = loadHistory(connectedKey);
    setTxs(
      stored.map((s) => ({
        ...s,
        batchId: s.batchId !== undefined ? BigInt(s.batchId) : undefined,
      }))
    );
  }, [connectedKey]);

  useEffect(() => {
    if (!connectedKey) return;
    const serialised: StoredTx[] = txs.map((t) => ({
      ...t,
      batchId: t.batchId !== undefined ? t.batchId.toString() : undefined,
    }));
    saveHistory(connectedKey, serialised);
  }, [connectedKey, txs]);

  // Only the demo wallet has the AES key in v1 — Phantom users see "?????".
  const demoAccountReady =
    !!state?.demoAccount &&
    connectedKey === state.demoAccount.owner.toBase58();
  const activePoolEntry =
    demoAccountReady && activePool
      ? state!.demoAccount!.byPool?.[activePool.address.toBase58()]
      : undefined;
  const demoTokenAccountA = demoAccountReady
    ? (activePoolEntry?.tokenAccountA ?? state!.demoAccount!.tokenAccountA)
    : null;
  const demoTokenAccountB = demoAccountReady
    ? (activePoolEntry?.tokenAccountB ?? state!.demoAccount!.tokenAccountB)
    : null;

  const confA = useAccountData<ConfidentialAccount>(
    demoTokenAccountA,
    decodeConfidentialAccount
  );
  const confB = useAccountData<ConfidentialAccount>(
    demoTokenAccountB,
    decodeConfidentialAccount
  );

  useEffect(() => {
    if (!demoAccountReady) {
      setBalanceA(null);
      setBalanceB(null);
      return;
    }
    if (!confA.data || !confB.data) return;
    let cancelled = false;
    (async () => {
      try {
        const secrets = await loadDemoSecrets();
        const [ba, bb] = await Promise.all([
          aesDecrypt(secrets.aesKey, confA.data!.decryptableAvailableBalance),
          aesDecrypt(secrets.aesKey, confB.data!.decryptableAvailableBalance),
        ]);
        if (cancelled) return;
        setBalanceA(ba);
        setBalanceB(bb);
      } catch (e) {
        if (!cancelled) console.warn('[balance decrypt]', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    demoAccountReady,
    confA.data?.decryptableAvailableBalance,
    confB.data?.decryptableAvailableBalance,
  ]);

  const legacyAcct =
    demoAccountReady && state?.demoAccount?.legacyUsdcAccount
      ? state.demoAccount.legacyUsdcAccount
      : null;
  const legacyAmount = useAccountData<bigint>(legacyAcct, decodeSplTokenAmount);
  useEffect(() => {
    if (!legacyAcct) {
      setLegacyUsdcBalance(null);
      return;
    }
    setLegacyUsdcBalance(legacyAmount.data ?? 0n);
  }, [legacyAcct, legacyAmount.data]);

  useEffect(() => {
    if (!state) return;
    const pending = txs.filter(
      (t) => t.status !== 'sealed' && t.batchId !== undefined && t.pool
    );
    if (pending.length === 0) return;

    const uniqueBatches = new Map<
      string,
      { pool: PublicKey; batchId: bigint }
    >();
    for (const t of pending) {
      const key = `${t.pool!}/${t.batchId!.toString()}`;
      uniqueBatches.set(key, {
        pool: new PublicKey(t.pool!),
        batchId: t.batchId!,
      });
    }

    const subIds: number[] = [];
    for (const { pool, batchId } of uniqueBatches.values()) {
      const [batchPda] = deriveBatch(state.programId, pool, batchId);

      const onSettled = (batch: BatchAccount) => {
        if (batch.status !== BatchStatus.Settled) return;
        const poolEntry = state.demoAccount?.byPool?.[pool.toBase58()];
        const aMintStr = poolEntry?.mintA.toBase58();
        const bMintStr = poolEntry?.mintB.toBase58();
        const decimalsA = aMintStr
          ? tokenInfo(tokenList, aMintStr).decimals
          : state.primaryPool.decimalsA;
        const decimalsB = bMintStr
          ? tokenInfo(tokenList, bMintStr).decimals
          : state.primaryPool.decimalsB;
        setTxs((prev) =>
          prev.map((t) => {
            if (t.status === 'sealed' || t.batchId !== batchId) return t;
            if (t.pool !== pool.toBase58()) return t;
            const decimalsIn = t.side === 'buy' ? decimalsA : decimalsB;
            const decimalsOut = t.side === 'buy' ? decimalsB : decimalsA;
            const inBase = toBaseUnits(t.amount, decimalsIn);
            const { fillOut, fillPx } = computeFill(inBase, batch.clearingRatioQ32, decimalsOut);
            return { ...t, status: 'sealed', fillOut, fillPx };
          })
        );
      };

      connection.getAccountInfo(batchPda, 'confirmed').then((info) => {
        if (info && info.data.length > 0) {
          try {
            onSettled(decodeBatch(info.data));
          } catch (e) {
            console.warn('[ticket-batch initial]', e);
          }
        }
      });
      const subId = connection.onAccountChange(batchPda, (info) => {
        if (!info || info.data.length === 0) return;
        try {
          onSettled(decodeBatch(info.data));
        } catch (e) {
          console.warn('[ticket-batch update]', e);
        }
      }, 'confirmed');
      subIds.push(subId);
    }

    return () => {
      for (const id of subIds) {
        connection.removeAccountChangeListener(id).catch((e) => {
          console.warn('[ticket-batch removeListener]', e);
        });
      }
    };
  }, [state, connection, txs, tokenList]);

  useEffect(() => {
    loadTokenList().then(setTokenList).catch((e) => console.warn('[token-list]', e));
  }, []);

  const poolFilters = useMemo(
    () => ({
      filters: [
        { dataSize: 440 },
        { memcmp: { offset: 0, bytes: '2' } },
      ],
    }),
    []
  );
  const allPools = useProgramAccounts<{ address: PublicKey; account: PoolAccount }>(
    state?.programId ?? null,
    poolFilters,
    (address, data) => ({ address, account: decodePool(data) }),
  );

  useEffect(() => {
    if (!state) return;
    if (allPools.loading) return;
    const primaryAddr = state.primaryPool.address.toBase58();
    const provisional = allPools.entries.map((d) => {
      const aMint = d.account.mintA.toBase58();
      const bMint = d.account.mintB.toBase58();
      const aInfo = tokenInfo(tokenList, aMint);
      const bInfo = tokenInfo(tokenList, bMint);
      const aIsQuote = aInfo.kind === 'stable' && bInfo.kind !== 'stable';
      const baseInfo = aIsQuote ? bInfo : aInfo;
      const quoteInfo = aIsQuote ? aInfo : bInfo;
      const baseReserve = aIsQuote ? d.account.reserveB : d.account.reserveA;
      const quoteReserve = aIsQuote ? d.account.reserveA : d.account.reserveB;
      const baseHuman = Number(baseReserve) / 10 ** baseInfo.decimals;
      const quoteHuman = Number(quoteReserve) / 10 ** quoteInfo.decimals;
      const price = baseHuman > 0 ? quoteHuman / baseHuman : null;
      const tvl =
        price === null
          ? null
          : quoteInfo.kind === 'stable'
            ? quoteHuman + baseHuman * price
            : null;
      return {
        id: d.address.toBase58(),
        poolAddress: d.address,
        baseSymbol: baseInfo.symbol,
        quoteSymbol: quoteInfo.symbol,
        baseIcon: baseInfo.icon,
        quoteIcon: quoteInfo.icon,
        price,
        tvlUsd: tvl,
        depth: 0,
        batchId: d.account.currentBatchId,
        isPrimary: d.address.toBase58() === primaryAddr,
      };
    });
    const maxTvl = provisional.reduce((m, p) => Math.max(m, p.tvlUsd ?? 0), 0);
    const views: PoolView[] = provisional.map((p) => ({
      ...p,
      depth: maxTvl > 0 && p.tvlUsd !== null ? Math.max(8, (p.tvlUsd / maxTvl) * 100) : 24,
    }));
    views.sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (b.isPrimary && !a.isPrimary) return 1;
      return a.baseSymbol.localeCompare(b.baseSymbol);
    });
    setPoolViews(views);
    setPoolsLoading(false);
    setActivePoolId((cur) => cur ?? views.find((p) => p.isPrimary)?.id ?? views[0]?.id ?? null);
  }, [state, allPools.entries, allPools.loading, tokenList]);

  const activePoolSub = useAccountData<PoolAccount>(
    activePool?.address ?? null,
    decodePool
  );
  const currentBatchId = activePoolSub.data?.currentBatchId ?? null;
  const batchPda = useMemo<PublicKey | null>(() => {
    if (!state || !activePool || currentBatchId === null) return null;
    return deriveBatch(state.programId, activePool.address, currentBatchId)[0];
  }, [state, activePool, currentBatchId]);
  const openBatch = useAccountData<BatchAccount>(batchPda, decodeBatch);
  const slot = useSlot(800);

  useEffect(() => {
    if (!activePoolSub.data) return;
    const pool = activePoolSub.data;
    setReserveA(pool.reserveA);
    setReserveB(pool.reserveB);
    setFeeBps(pool.feeBps);
    setBatchN(Number(pool.currentBatchId));

    const windowSlots = pool.batchWindowSlots;
    if (openBatch.data && openBatch.data.status === BatchStatus.Open && slot !== null) {
      const slotsLeft = Math.max(0, Number(openBatch.data.openedSlot) + windowSlots - slot);
      setBatchTimeLeft(Math.ceil((slotsLeft * 400) / 1000));
      setBatchProgress(1 - slotsLeft / windowSlots);
    } else {
      setBatchTimeLeft(Math.ceil((windowSlots * 400) / 1000));
      setBatchProgress(0);
    }
  }, [activePoolSub.data, openBatch.data, slot]);

  const submit = async (order: { side: 'buy' | 'sell'; amount: string }) => {
    if (!state) {
      alert(stateError ?? 'state.json not loaded yet');
      return;
    }
    if (!publicKey || !signTransaction || !signAllTransactions) {
      alert('connect a wallet first');
      return;
    }
    if (wallet?.adapter.name !== DemoWalletName) {
      alert(
        'Real submit-order requires the user\'s ElGamal/AES secrets. ' +
          'Phantom-derived flow is on the roadmap — for now please use "Use demo account".'
      );
      return;
    }
    if (!state.demoAccount) {
      alert('demo account not exported in state.json');
      return;
    }

    if (!activePool) {
      alert('Active pool not resolved yet — wait for pools to load.');
      return;
    }

    // BUY = pay quote, receive base. SELL = pay base, receive quote.
    // side 0 (A→B) pays mint A, receives mint B. baseIsA tells us
    // which mint is base, so we flip if needed.
    const buyPaysA = !activePool.baseIsA; // A is quote → BUY pays A
    const side: 0 | 1 = order.side === 'buy' ? (buyPaysA ? 0 : 1) : buyPaysA ? 1 : 0;
    const decimals = side === 0 ? activePool.decimalsA : activePool.decimalsB;
    const amount = toBaseUnits(order.amount, decimals);

    const poolKey = activePool.address.toBase58();
    const poolEntry = state.demoAccount.byPool?.[poolKey];
    const tokenAccountA = poolEntry?.tokenAccountA ?? state.demoAccount.tokenAccountA;
    const tokenAccountB = poolEntry?.tokenAccountB ?? state.demoAccount.tokenAccountB;

    const txId = `tx-${Date.now()}`;
    const tokenIn = side === 0 ? 'A' : 'B';
    const tokenOut = side === 0 ? 'B' : 'A';
    const fresh: Tx = {
      id: txId,
      time: 'now',
      side: order.side,
      amount: order.amount,
      tokenIn,
      tokenOut,
      fillOut: null,
      fillPx: null,
      batch: batchN,
      status: 'encrypting',
      sig: '',
      pool: poolKey,
    };
    setTxs((prev) => [fresh, ...prev]);
    setTxStatus('encrypting');

    try {
      const secrets = await loadDemoSecrets();
      const sourceTokenAccount = side === 0 ? tokenAccountA : tokenAccountB;

      const result = await submitOrder(
        connection,
        { signTransaction, signAllTransactions },
        {
          state,
          pool: activePool.address,
          side,
          amount,
          payer: publicKey,
          user: publicKey,
          sourceTokenAccount,
          userElGamalKeypair: secrets.elgamalKeypair,
          userAesKey: secrets.aesKey,
        },
        (phase) => {
          const status = phaseToStatus(phase);
          setTxStatus(status);
          setTxs((p) => p.map((t) => (t.id === txId ? { ...t, status } : t)));
        }
      );

      setTxStatus('queued');
      setTxs((p) =>
        p.map((t) =>
          t.id === txId
            ? {
                ...t,
                status: 'queued',
                sig: result.mainSignature,
                batch: Number(result.batchId),
                ticket: result.ticket.toBase58(),
                batchId: result.batchId,
                pool: poolKey,
              }
            : t
        )
      );
    } catch (e) {
      console.error('[submit-order] failed', e);
      alert(`submit failed: ${e instanceof Error ? e.message : String(e)}`);
      setTxs((p) => p.filter((t) => t.id !== txId));
    } finally {
      setTimeout(() => setTxStatus('idle'), 1500);
    }
  };

  const openWallet = () => setWalletOpen(true);
  const closeWallet = () => setWalletOpen(false);

  return (
    <>
      <DemoNav
        batchTimeLeft={batchTimeLeft}
        batchN={batchN}
        batchProgress={batchProgress}
        onConnect={openWallet}
        networkLabel={networkLabelText}
      />
      <main className="dpage dpage--slim">
        <div className="dpage__grid dpage__grid--2col">
          <div className="dpage__col">
            <Pools
              pools={poolViews}
              activeId={activePoolId}
              loading={poolsLoading}
              onSelect={(p) => setActivePoolId(p.id)}
            />
          </div>
          <div className="dpage__col">
            <SwapCard
              onSubmit={submit}
              txStatus={txStatus}
              onConnect={openWallet}
              balanceA={balanceA}
              balanceB={balanceB}
              decimalsA={activePool?.decimalsA ?? 6}
              decimalsB={activePool?.decimalsB ?? 6}
              reserveA={reserveA}
              reserveB={reserveB}
              feeBps={feeBps}
              symbolA={activePool?.symbolA ?? 'A'}
              symbolB={activePool?.symbolB ?? 'B'}
              baseIsA={activePool?.baseIsA ?? false}
            />
          </div>
        </div>

        <MyTxs txs={txs} networkKind={networkKind} rpcUrl={state?.rpcUrl} />

        <Balances
          balances={(() => {
            const rows: TokenBalance[] = [];
            const seen = new Set<string>();
            const decimalsA = activePool?.decimalsA ?? 6;
            const decimalsB = activePool?.decimalsB ?? 6;
            if (activePool && state?.wrappers.length) {
              const aMint = activePool.mintA.toBase58();
              const bMint = activePool.mintB.toBase58();
              const aInfo = tokenInfo(tokenList, aMint);
              const bInfo = tokenInfo(tokenList, bMint);
              const aShielded = balanceA !== null ? Number(balanceA) / 10 ** decimalsA : 0;
              const bShielded = balanceB !== null ? Number(balanceB) / 10 ** decimalsB : 0;

              const nativeFor = (mint: PublicKey): number => {
                const w = state.wrappers.find((x) => x.shieldedMint.equals(mint));
                if (!w) return 0;
                if (w.kind === 'spl') {
                  return legacyUsdcBalance !== null
                    ? Number(legacyUsdcBalance) / 10 ** w.decimals
                    : 0;
                }
                return walletSolLamports !== null
                  ? Number(walletSolLamports) / 10 ** w.decimals
                  : 0;
              };

              rows.push({
                symbol: aInfo.symbol,
                name: aInfo.name,
                native: nativeFor(activePool.mintA),
                shielded: aShielded,
                iconUrl: aInfo.icon,
                shieldedMint: activePool.mintA,
              });
              rows.push({
                symbol: bInfo.symbol,
                name: bInfo.name,
                native: nativeFor(activePool.mintB),
                shielded: bShielded,
                iconUrl: bInfo.icon,
                shieldedMint: activePool.mintB,
              });
              seen.add(aInfo.symbol);
              seen.add(bInfo.symbol);
            }
            for (const info of Object.values(tokenList)) {
              if (seen.has(info.symbol)) continue;
              rows.push({
                symbol: info.symbol,
                name: info.name,
                native: 0,
                shielded: 0,
                iconUrl: info.icon,
              });
              seen.add(info.symbol);
            }
            return rows;
          })()}
          onWrap={(b) => setWrapState({ open: true, mode: 'wrap', token: b })}
          onUnwrap={(b) => setWrapState({ open: true, mode: 'unwrap', token: b })}
        />

        <footer className="dpage__foot">
          <span>OCCULT v0.4.2 · {networkLabelText} · DOCUMENT REF /OCC-DEMO-01</span>
          <span>Simulation. Real order submission requires the WASM proof module.</span>
        </footer>
      </main>

      <OccultWalletModal open={walletOpen} onClose={closeWallet} />

      <WrapModal
        open={wrapState.open}
        mode={wrapState.mode}
        token={wrapState.token}
        onClose={() => setWrapState((s) => ({ ...s, open: false }))}
        onConfirm={async (mode, token, amount) => {
          if (!publicKey || !signTransaction || !signAllTransactions) {
            throw new Error('Wallet not connected — click "Connect Wallet" first.');
          }
          if (!state || state.wrappers.length === 0 || !state.demoAccount) {
            throw new Error(
              'Wrappers not provisioned. Re-run scripts/local-init.sh.'
            );
          }
          const wrapper = token.shieldedMint
            ? state.wrappers.find((w) => w.shieldedMint.equals(token.shieldedMint!))
            : undefined;
          if (!wrapper) {
            throw new Error(
              `No wrapper provisioned for ${token.symbol}. Bootstrap exposes one wrapper per shielded mint.`
            );
          }
          if (wrapper.kind === 'spl' && !state.demoAccount.legacyUsdcAccount) {
            throw new Error(
              `Wrapper for ${token.symbol} is SPL-kind but demoAccount.legacyUsdcAccount is missing.`
            );
          }
          const userLegacy =
            wrapper.kind === 'sol'
              ? publicKey
              : state.demoAccount.legacyUsdcAccount!;

          const decimals = wrapper.decimals;
          const baseUnits = BigInt(Math.round(amount * 10 ** decimals));
          const secrets = await loadDemoSecrets();
          const userShielded = state.primaryPool.mintA.equals(wrapper.shieldedMint)
            ? state.demoAccount.tokenAccountA
            : state.demoAccount.tokenAccountB;
          const wallet = { signTransaction, signAllTransactions };

          // Optimistic — sig + 'sealed' assigned once the tx confirms.
          const txId = `${mode}-${Date.now()}`;
          const fromTok = mode === 'wrap' ? token.symbol : `sh${token.symbol}`;
          const toTok = mode === 'wrap' ? `sh${token.symbol}` : token.symbol;
          setTxs((prev) => [
            {
              id: txId,
              time: 'now',
              kind: mode,
              side: 'buy',
              amount: String(amount),
              tokenIn: fromTok,
              tokenOut: toTok,
              fillOut: null,
              fillPx: null,
              batch: null,
              status: 'encrypting',
              sig: '',
            },
            ...prev,
          ]);

          try {
            let sig: string;
            if (mode === 'wrap') {
              const auditor = await loadAuditorSecrets();
              sig = await executeWrap(
                connection,
                wallet,
                {
                  state,
                  wrapper,
                  user: publicKey,
                  payer: publicKey,
                  userLegacy,
                  userShielded,
                  auditorElgamalKeypair: auditor.elgamalKeypair,
                  auditorAesKey: auditor.aesKey,
                  amount: baseUnits,
                },
                (p) => console.log('[wrap]', p)
              );
            } else {
              sig = await executeUnwrap(
                connection,
                wallet,
                {
                  state,
                  wrapper,
                  user: publicKey,
                  payer: publicKey,
                  userLegacy,
                  userShielded,
                  elgamalKeypair: secrets.elgamalKeypair,
                  aesKey: secrets.aesKey,
                  amount: baseUnits,
                },
                (p) => console.log('[unwrap]', p)
              );
            }
            setTxs((prev) =>
              prev.map((t) =>
                t.id === txId
                  ? { ...t, status: 'sealed', sig, fillOut: String(amount) }
                  : t
              )
            );
          } catch (e) {
            setTxs((prev) => prev.filter((t) => t.id !== txId));
            throw e;
          }
        }}
      />
    </>
  );
}
