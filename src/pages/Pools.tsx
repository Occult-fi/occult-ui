import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import WalletButton from '../components/WalletButton';
import OccultWalletModal from '../components/OccultWalletModal';
import {
  loadState,
  loadDemoSecrets,
  loadAuditorSecrets,
  type OccultState,
} from '../protocol/state';
import { executeAddLiquidity } from '../protocol/addLiquidity';
import { executeRemoveLiquidity } from '../protocol/removeLiquidity';
import { DemoWalletName } from '../wallet/DemoWalletAdapter';
import { decodePool, type PoolAccount } from '../protocol/poolAccount';
import {
  decodeConfidentialAccount,
  type ConfidentialAccount,
} from '../protocol/confidentialAccount';
import { aesDecrypt } from '../wasm/proofs';
import { loadTokenList, tokenInfo, type TokenInfo } from '../protocol/tokenList';
import {
  useProgramAccounts,
  useSlot,
  useAccountData,
} from '../hooks/useSolanaSubscriptions';
import { classifyNetwork, networkLabel } from '../protocol/network';
import '../landing.css';
import '../demo.css';
import '../pools.css';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'majors', label: 'Majors' },
  { id: 'stables', label: 'Stables' },
  { id: 'lst', label: 'LSTs' },
  { id: 'defi', label: 'DeFi' },
  { id: 'memes', label: 'Memes' },
] as const;
type CategoryId = (typeof CATEGORIES)[number]['id'];

type SortKey = 'tvl' | 'apy' | 'vol';

function shortAddr(a: string): string {
  return a.slice(0, 4) + '…' + a.slice(-4);
}

function fmtCompact(x: number): string {
  if (!isFinite(x) || x === 0) return '0';
  if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
  if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
  if (x >= 1e3) return (x / 1e3).toFixed(1) + 'K';
  if (x >= 100) return x.toFixed(0);
  if (x >= 1) return x.toFixed(2);
  return x.toFixed(4);
}

function fmtAmt(x: number, dp = 4): string {
  if (!isFinite(x)) return '—';
  if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
  if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
  if (x >= 1e3) return (x / 1e3).toFixed(2) + 'K';
  return x.toLocaleString(undefined, { maximumFractionDigits: dp });
}

type PoolView = {
  id: string;
  address: PublicKey;
  base: string;
  quote: string;
  reserveBHuman: number;
  reserveQHuman: number;
  decimalsBase: number;
  decimalsQuote: number;
  tvlUsd: number | null;
  // fee % (e.g. 0.30 for 30 bps)
  fee: number;
  apy: number;
  // 24h volume in USD millions
  vol24: number;
  util: number;
  cat: CategoryId;
  baseIsA: boolean;
  raw: PoolAccount;
};

const QUOTE_USD: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  DAI: 1,
  PYUSD: 1,
  USDS: 1,
  // Rough USD ref for volatile-quoted pools (e.g. xxx/SOL).
  SOL: 110,
};

function categorizePair(baseInfo: TokenInfo, quoteInfo: TokenInfo): CategoryId {
  const sym = baseInfo.symbol.toUpperCase();
  if (['USDC', 'USDT', 'DAI', 'PYUSD', 'USDS'].includes(sym)) return 'stables';
  if (quoteInfo.kind === 'stable' && ['USDC', 'USDT'].includes(sym)) return 'stables';
  if (['SOL', 'WBTC', 'WETH', 'BTC', 'ETH'].includes(sym)) return 'majors';
  if (sym.toLowerCase().includes('sol') && sym !== 'SOL') return 'lst';
  if (['BONK', 'WIF', 'POPCAT'].includes(sym)) return 'memes';
  if (['JUP', 'JTO', 'PYTH', 'RAY', 'ORCA'].includes(sym)) return 'defi';
  return 'majors';
}

function projectPool(
  address: PublicKey,
  pool: PoolAccount,
  tokenList: Record<string, TokenInfo>,
  currentSlot: number | null,
): PoolView {
  const aMint = pool.mintA.toBase58();
  const bMint = pool.mintB.toBase58();
  const aInfo = tokenInfo(tokenList, aMint);
  const bInfo = tokenInfo(tokenList, bMint);
  const aIsQuote = aInfo.kind === 'stable' && bInfo.kind !== 'stable';
  const baseInfo = aIsQuote ? bInfo : aInfo;
  const quoteInfo = aIsQuote ? aInfo : bInfo;
  const baseReserve = aIsQuote ? pool.reserveB : pool.reserveA;
  const quoteReserve = aIsQuote ? pool.reserveA : pool.reserveB;
  const decimalsBase = baseInfo.decimals;
  const decimalsQuote = quoteInfo.decimals;
  const reserveBHuman = Number(baseReserve) / 10 ** decimalsBase;
  const reserveQHuman = Number(quoteReserve) / 10 ** decimalsQuote;
  const tvlUsd =
    quoteInfo.kind === 'stable'
      ? reserveQHuman * 2 * (QUOTE_USD[quoteInfo.symbol] ?? 1)
      : null;

  const volA = aIsQuote ? pool.cumulativeVolumeB : pool.cumulativeVolumeA;
  const volQ = aIsQuote ? pool.cumulativeVolumeA : pool.cumulativeVolumeB;
  const volBaseHuman = Number(volA) / 10 ** decimalsBase;
  const volQuoteHuman = Number(volQ) / 10 ** decimalsQuote;
  const volQuoteUsd = volQuoteHuman * (QUOTE_USD[quoteInfo.symbol] ?? 0);
  const priceNow = reserveBHuman > 0 ? reserveQHuman / reserveBHuman : 0;
  const baseVolUsd = volBaseHuman * priceNow * (QUOTE_USD[quoteInfo.symbol] ?? 0);
  const totalVolUsd = volQuoteUsd + baseVolUsd;

  // 1 slot ≈ 0.4s → 216_000 slots/day.
  const SLOTS_PER_YEAR = 216_000 * 365;
  let apy = 0;
  if (currentSlot !== null && tvlUsd && tvlUsd > 0 && totalVolUsd > 0) {
    const elapsedSlots = Math.max(1, currentSlot - Number(pool.genesisSlot));
    const annualisedVolUsd = totalVolUsd * (SLOTS_PER_YEAR / elapsedSlots);
    const annualisedFeesUsd = (annualisedVolUsd * pool.feeBps) / 10_000;
    apy = (annualisedFeesUsd / tvlUsd) * 100;
  }

  // Extrapolation from cumulative, not a real 24h window (would need historical snapshots).
  const SLOTS_PER_DAY = 216_000;
  let vol24Usd = 0;
  if (currentSlot !== null) {
    const elapsedSlots = Math.max(1, currentSlot - Number(pool.genesisSlot));
    if (elapsedSlots <= SLOTS_PER_DAY) {
      vol24Usd = totalVolUsd;
    } else {
      vol24Usd = totalVolUsd * (SLOTS_PER_DAY / elapsedSlots);
    }
  }

  let util = 0;
  if (tvlUsd && tvlUsd > 0 && vol24Usd > 0) {
    util = Math.min(100, (vol24Usd / tvlUsd) * 100);
  }

  return {
    id: address.toBase58(),
    address,
    base: baseInfo.symbol,
    quote: quoteInfo.symbol,
    reserveBHuman,
    reserveQHuman,
    decimalsBase,
    decimalsQuote,
    tvlUsd,
    fee: pool.feeBps / 100,
    apy,
    vol24: vol24Usd / 1e6,
    util,
    cat: categorizePair(baseInfo, quoteInfo),
    baseIsA: !aIsQuote,
    raw: pool,
  };
}

function poolPrice(p: PoolView): number {
  if (p.reserveBHuman <= 0) return 0;
  return p.reserveQHuman / p.reserveBHuman;
}

function PoolsNav({ networkLabel: nlabel, onConnect }: { networkLabel: string; onConnect: () => void }) {
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
          <Link to="/demo" className="dnav__tab">
            Trade
          </Link>
          <Link to="/pools" className="dnav__tab is-active">
            Pools
          </Link>
        </div>
        <div className="dnav__center">
          <span className="dnav__chip">
            <span className="dnav__chip-dot" />
            {nlabel}
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

function PoolIcon({ base, quote }: { base: string; quote: string }) {
  return (
    <span className="pools__pair-icons" aria-hidden="true">
      <span className="pools__pair-i">{base.slice(0, 1).toUpperCase()}</span>
      <span className="pools__pair-i pools__pair-i--quote">
        {quote.slice(0, 1).toUpperCase()}
      </span>
    </span>
  );
}

function StatHero({ pools }: { pools: PoolView[] }) {
  const totalTvl = pools.reduce((s, p) => s + (p.tvlUsd ?? 0), 0);
  const totalVol = pools.reduce((s, p) => s + p.vol24, 0);
  const apyPools = pools.filter((p) => p.apy > 0);
  const avgApy = apyPools.length ? apyPools.reduce((s, p) => s + p.apy, 0) / apyPools.length : 0;
  return (
    <section className="ph__hero">
      <div className="ph__hero-l">
        <div className="ph__eyebrow">
          <span className="ph__eb-bar" />
          <span>LIQUIDITY · CONFIDENTIAL POOLS</span>
        </div>
        <h1 className="ph__title">Provide liquidity. Earn from sealed flow.</h1>
        <p className="ph__sub">
          Deposit both sides of a constant-product pool (x·y=k). Your position size stays
          encrypted; LP fees accrue per swap and settle to your shielded balance every batch.
        </p>
      </div>
      <div className="ph__hero-r">
        <div className="ph__kpi">
          <span className="ph__kpi-k">Total TVL</span>
          <span className="ph__kpi-v">
            {totalTvl > 0 ? `$${fmtCompact(totalTvl)}` : '—'}
          </span>
        </div>
        <div className="ph__kpi">
          <span className="ph__kpi-k">24h volume</span>
          <span className="ph__kpi-v">
            {totalVol > 0 ? `$${fmtCompact(totalVol * 1e6)}` : '—'}
          </span>
        </div>
        <div className="ph__kpi">
          <span className="ph__kpi-k">Avg APY</span>
          <span className="ph__kpi-v">{avgApy > 0 ? `${avgApy.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="ph__kpi">
          <span className="ph__kpi-k">Pools</span>
          <span className="ph__kpi-v">{pools.length}</span>
        </div>
      </div>
    </section>
  );
}

type PositionView = {
  poolView: PoolView;
  lpBalance: bigint;
  share: number;
  myBaseAmount: number;
  myQuoteAmount: number;
  valueUsd: number | null;
};

function MyPositionRow({
  position,
  onAdd,
  onRemove,
}: {
  position: PositionView;
  onAdd: (p: PoolView) => void;
  onRemove: (p: PositionView) => void;
}) {
  const { poolView: p } = position;
  return (
    <div className="mypos__row">
      <div className="mypos__l">
        <PoolIcon base={p.base} quote={p.quote} />
        <div className="mypos__pair">
          <span className="mypos__name">
            {p.base}/{p.quote}
          </span>
          <span className="mypos__age">{(position.share * 100).toFixed(4)}% of pool</span>
        </div>
      </div>
      <div className="mypos__stats">
        <div className="mypos__stat">
          <span className="mypos__k">Position</span>
          <span className="mypos__v">
            {fmtCompact(position.myBaseAmount)} {p.base} ·{' '}
            {fmtCompact(position.myQuoteAmount)} {p.quote}
          </span>
        </div>
        <div className="mypos__stat">
          <span className="mypos__k">Value</span>
          <span className="mypos__v">
            {position.valueUsd !== null
              ? `$${position.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : '—'}
          </span>
        </div>
        <div className="mypos__stat">
          <span className="mypos__k">Fees earned</span>
          <span className="mypos__v mypos__v--earn">—</span>
        </div>
        <div className="mypos__stat">
          <span className="mypos__k">IL vs HODL</span>
          <span className="mypos__v">—</span>
        </div>
      </div>
      <div className="mypos__actions">
        <button className="bal__btn bal__btn--ghost" onClick={() => onRemove(position)}>
          Withdraw
        </button>
        <button className="bal__btn" onClick={() => onAdd(p)}>
          Add
        </button>
      </div>
    </div>
  );
}

type PendingPosView = {
  poolId: string;
  poolView: PoolView;
  baseAmt: number;
  quoteAmt: number;
  estLpOut: bigint;
  submittedAt: number;
};

function MyPositions({
  positions,
  pending,
  onAdd,
  onRemove,
}: {
  positions: PositionView[];
  pending: PendingPosView[];
  onAdd: (p: PoolView) => void;
  onRemove: (p: PositionView) => void;
}) {
  if (!positions.length && !pending.length) {
    return (
      <section className="panel mypos">
        <header className="panel__head">
          <div className="panel__title">
            <span className="panel__eb" />
            <span>YOUR POSITIONS</span>
          </div>
          <div className="panel__sub">No active LP positions yet</div>
        </header>
        <div className="psm__empty">
          Deposit into any pool below to start earning fees on encrypted swap flow.
        </div>
      </section>
    );
  }
  const totalVal = positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0);
  return (
    <section className="panel mypos">
      <header className="panel__head">
        <div className="panel__title">
          <span className="panel__eb" />
          <span>YOUR POSITIONS</span>
        </div>
        <div className="panel__sub">
          {positions.length + pending.length} active{totalVal > 0 ? ` · $${totalVal.toLocaleString()} total` : ''}
        </div>
      </header>
      <div className="mypos__rows">
        {pending.map((pp) => (
          <PendingPosRow key={`pending-${pp.poolId}-${pp.submittedAt}`} pp={pp} />
        ))}
        {positions.map((pos) => (
          <MyPositionRow
            key={pos.poolView.id}
            position={pos}
            onAdd={onAdd}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  );
}

function PendingPosRow({ pp }: { pp: PendingPosView }) {
  const ageSec = Math.floor((Date.now() - pp.submittedAt) / 1000);
  const { poolView: p } = pp;
  return (
    <div className="mypos__row mypos__row--pending">
      <span className="mypos__pair">
        <PoolIcon base={p.base} quote={p.quote} />
        <span className="mypos__pair-name">{p.base}/{p.quote}</span>
        <span className="psm__cat-tag mypos__pending-tag">PENDING · {ageSec}s</span>
      </span>
      <span className="mypos__amount">
        {fmtAmt(pp.baseAmt)} {p.base} + {fmtAmt(pp.quoteAmt)} {p.quote}
      </span>
      <span className="mypos__share">finalizing…</span>
      <span className="mypos__value">≈ {pp.estLpOut.toLocaleString()} LP</span>
      <span className="mypos__age">awaiting auditor</span>
      <span></span>
    </div>
  );
}

function PoolsList({
  pools,
  onDeposit,
  onCreate,
}: {
  pools: PoolView[];
  onDeposit: (p: PoolView) => void;
  onCreate: () => void;
}) {
  const [cat, setCat] = useState<CategoryId>('all');
  const [sort, setSort] = useState<SortKey>('tvl');
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    return pools
      .filter((p) => cat === 'all' || p.cat === cat)
      .filter(
        (p) =>
          !q || `${p.base}/${p.quote}`.toLowerCase().includes(q.toLowerCase()),
      )
      .sort((a, b) =>
        sort === 'apy'
          ? b.apy - a.apy
          : sort === 'vol'
            ? b.vol24 - a.vol24
            : (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0),
      );
  }, [pools, cat, sort, q]);

  return (
    <section className="panel poolsl">
      <header className="panel__head poolsl__head">
        <div className="panel__title">
          <span className="panel__eb" />
          <span>POOL DIRECTORY</span>
        </div>
        <div className="poolsl__head-r">
          <div className="poolsl__search">
            <svg viewBox="0 0 14 14" width="12" height="12">
              <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M9 9l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
            </svg>
            <input
              type="text"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="poolsl__create" onClick={onCreate}>
            <svg viewBox="0 0 12 12" width="11" height="11">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
            </svg>
            Create pool
          </button>
        </div>
      </header>
      <div className="poolsl__filters">
        <div className="poolsl__cats">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`psm__cat ${cat === c.id ? 'is-active' : ''}`}
              onClick={() => setCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="poolsl__sort">
          <span className="poolsl__sort-k">Sort</span>
          {(
            [
              ['tvl', 'TVL'],
              ['apy', 'APY'],
              ['vol', 'Volume'],
            ] as [SortKey, string][]
          ).map(([id, lbl]) => (
            <button
              key={id}
              className={`poolsl__sort-b ${sort === id ? 'is-active' : ''}`}
              onClick={() => setSort(id)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <div className="poolsl__th">
        <span>POOL</span>
        <span>TVL</span>
        <span>24H VOL</span>
        <span>FEE</span>
        <span>APY</span>
        <span>UTIL</span>
        <span></span>
      </div>
      <div className="poolsl__rows">
        {filtered.map((p) => (
          <div key={p.id} className="poolsl__row">
            <span className="poolsl__pair">
              <PoolIcon base={p.base} quote={p.quote} />
              <span className="poolsl__pair-name">
                {p.base}/{p.quote}
              </span>
              <span className="psm__cat-tag">{p.cat}</span>
            </span>
            <span className="poolsl__tvl">
              {p.tvlUsd !== null ? `$${fmtCompact(p.tvlUsd)}` : '—'}
            </span>
            <span className="poolsl__vol">{p.vol24 > 0 ? `$${fmtCompact(p.vol24 * 1e6)}` : '—'}</span>
            <span className="poolsl__fee">{p.fee.toFixed(2)}%</span>
            <span className="poolsl__apy">{p.apy > 0 ? `${p.apy.toFixed(1)}%` : '—'}</span>
            <span className="poolsl__util">
              <span className="poolsl__util-bar">
                <span className="poolsl__util-fill" style={{ width: `${p.util}%` }} />
              </span>
              <span className="poolsl__util-v">{p.util.toFixed(2)}%</span>
            </span>
            <button className="poolsl__deposit" onClick={() => onDeposit(p)}>
              Deposit →
            </button>
          </div>
        ))}
        {!filtered.length && <div className="psm__empty">No pools match.</div>}
      </div>
    </section>
  );
}

function DepositModal({
  pool,
  baseBalance,
  quoteBalance,
  onClose,
  onConfirm,
}: {
  pool: PoolView | null;
  baseBalance: bigint;
  quoteBalance: bigint;
  onClose: () => void;
  onConfirm: (pool: PoolView, baseAmt: number, quoteAmt: number) => Promise<void>;
}) {
  const [side, setSide] = useState<'base' | 'quote'>('quote');
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<'input' | 'depositing' | 'done' | 'error'>('input');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Narrow deps to `pool` only — mixing onClose in wipes input on every parent render.
  useEffect(() => {
    if (!pool) return;
    setAmount('');
    setSide('quote');
    setPhase('input');
    setErrMsg(null);
  }, [pool]);

  useEffect(() => {
    if (!pool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [pool, onClose]);

  if (!pool) return null;

  // quote per base
  const price = poolPrice(pool);
  const numAmt = parseFloat(amount) || 0;
  const baseAmt = side === 'base' ? numAmt : price > 0 ? numAmt / price : 0;
  const quoteAmt = side === 'quote' ? numAmt : numAmt * price;
  const usdValue = quoteAmt * 2 * (QUOTE_USD[pool.quote] ?? 0);
  const tvlUsd = pool.tvlUsd ?? 0;
  const newShare = tvlUsd > 0 ? usdValue / (tvlUsd + usdValue) : 0;
  const projDaily = (usdValue * pool.apy) / 100 / 365;
  const projYear = (usdValue * pool.apy) / 100;

  if (phase === 'depositing' || phase === 'done' || phase === 'error') {
    const isDone = phase === 'done';
    const isErr = phase === 'error';
    return createPortal(
      <div className="wm" role="dialog" aria-modal="true">
        <div className="wm__scrim" onClick={onClose} />
        <div className="wm__card dpm">
          <div className="wm__head">
            <div className="wm__head-l">
              <span
                className="wm__cls-bar"
                style={isDone ? { background: '#4ade80' } : isErr ? { background: '#f87171' } : {}}
              />
              <span>
                {isDone
                  ? 'POSITION SEALED'
                  : isErr
                    ? 'DEPOSIT FAILED'
                    : `SEALING DEPOSIT · ${pool.base}/${pool.quote}`}
              </span>
            </div>
            <button onClick={onClose} className="wm__close">
              ×
            </button>
          </div>
          <div className="dpm__phase">
            <div className={`dpm__phase-icon ${isDone ? 'dpm__phase-icon--done' : ''}`}>
              {isDone ? '✓' : isErr ? '×' : <span className="dpm__spin" />}
            </div>
            <div className="dpm__phase-title">
              {isDone
                ? `${fmtAmt(baseAmt)} ${pool.base} + ${fmtAmt(quoteAmt)} ${pool.quote} deposited`
                : isErr
                  ? errMsg ?? 'Unknown error'
                  : 'Encrypting & batching'}
            </div>
            <div className="dpm__phase-sub">
              {isDone
                ? 'LP position is now confidential.'
                : isErr
                  ? 'Position not opened. No funds moved.'
                  : 'ZK proof generating · 8-tx Phase B'}
            </div>
            <button className="bal__btn dpm__done" onClick={onClose}>
              {isDone || isErr ? 'Done' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="wm" role="dialog" aria-modal="true">
      <div className="wm__scrim" onClick={onClose} />
      <div className="wm__card dpm">
        <div className="wm__head">
          <div className="wm__head-l">
            <span className="wm__cls-bar" />
            <span>
              DEPOSIT · {pool.base}/{pool.quote}
            </span>
          </div>
          <button onClick={onClose} className="wm__close">
            ×
          </button>
        </div>
        <div className="dpm__pair">
          <PoolIcon base={pool.base} quote={pool.quote} />
          <div className="dpm__pair-l">
            <div className="dpm__pair-name">
              {pool.base}/{pool.quote}
            </div>
            <div className="dpm__pair-sub">
              x·y=k · 1 {pool.base} ≈ {price < 1 ? price.toFixed(6) : price.toFixed(2)} {pool.quote}
              {' · '}Fee {pool.fee.toFixed(2)}%
            </div>
          </div>
        </div>
        <div className="dpm__cp-note">
          <span className="dpm__cp-bar" />
          <span>
            Constant-product pool. Both sides deposit at the current ratio — type one side, partner
            is calculated.
          </span>
        </div>
        {(() => {
          const baseBalHuman = Number(baseBalance) / 10 ** pool.decimalsBase;
          const quoteBalHuman = Number(quoteBalance) / 10 ** pool.decimalsQuote;
          return (
            <>
              <div className="dpm__field">
                <div className="dpm__field-h">
                  <span>{pool.base} side</span>
                </div>
                <div className="dpm__input">
                  <input
                    type="text"
                    value={
                      side === 'base' ? amount : numAmt ? baseAmt.toFixed(price < 1 ? 2 : 6) : ''
                    }
                    onChange={(e) => {
                      setSide('base');
                      setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                    }}
                    placeholder="0.00"
                  />
                  <span className="dpm__token">{pool.base}</span>
                </div>
                <div className="dpm__bal">
                  <span>
                    BALANCE&nbsp;{fmtAmt(baseBalHuman)} {pool.base}
                  </span>
                  <button
                    type="button"
                    className="dpm__max"
                    onClick={() => {
                      setSide('base');
                      setAmount(String(baseBalHuman));
                    }}
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="dpm__plus">+</div>
              <div className="dpm__field">
                <div className="dpm__field-h">
                  <span>{pool.quote} side</span>
                </div>
                <div className="dpm__input">
                  <input
                    type="text"
                    value={side === 'quote' ? amount : numAmt ? quoteAmt.toFixed(2) : ''}
                    onChange={(e) => {
                      setSide('quote');
                      setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                    }}
                    placeholder="0.00"
                  />
                  <span className="dpm__token">{pool.quote}</span>
                </div>
                <div className="dpm__bal">
                  <span>
                    BALANCE&nbsp;{fmtAmt(quoteBalHuman)} {pool.quote}
                  </span>
                  <button
                    type="button"
                    className="dpm__max"
                    onClick={() => {
                      setSide('quote');
                      setAmount(String(quoteBalHuman));
                    }}
                  >
                    MAX
                  </button>
                </div>
              </div>
            </>
          );
        })()}
        <div className="dpm__proj">
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">USD value</span>
            <span className="dpm__proj-v">
              {usdValue > 0
                ? `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </span>
          </div>
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">Pool share</span>
            <span className="dpm__proj-v">{(newShare * 100).toFixed(4)}%</span>
          </div>
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">Est. daily fees</span>
            <span className="dpm__proj-v">
              {projDaily > 0 ? `+$${projDaily.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">Est. yearly</span>
            <span className="dpm__proj-v">
              {projYear > 0 ? `+$${projYear.toFixed(0)} (${pool.apy.toFixed(1)}% APY)` : '—'}
            </span>
          </div>
        </div>
        <div className="dpm__notes">
          <div className="dpm__note">
            <span className="dpm__note-k">Confidential</span>
            <span>Your position size is hidden from other LPs and traders.</span>
          </div>
          <div className="dpm__note">
            <span className="dpm__note-k">Settlement</span>
            <span>Both legs deposit atomically next batch. Withdraw anytime, no lockup.</span>
          </div>
        </div>
        {(() => {
          const baseBalHuman = Number(baseBalance) / 10 ** pool.decimalsBase;
          const quoteBalHuman = Number(quoteBalance) / 10 ** pool.decimalsQuote;
          // Tolerance so "MAX" doesn't trip the check via 1e-12 float round-off.
          const epsilon = 1e-9;
          const baseShort = baseAmt > baseBalHuman + epsilon;
          const quoteShort = quoteAmt > quoteBalHuman + epsilon;
          const insufficientToken = baseShort
            ? pool.base
            : quoteShort
              ? pool.quote
              : null;
          return (
            <>
              {insufficientToken && (
                <div className="dpm__warn">
                  Insufficient {insufficientToken} balance — you only have{' '}
                  {(insufficientToken === pool.base ? baseBalHuman : quoteBalHuman).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 6 },
                  )}{' '}
                  {insufficientToken}.
                </div>
              )}
              <div className="dpm__cta">
                <button className="bal__btn bal__btn--ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="bal__btn dpm__confirm"
                  disabled={!numAmt || !pool || baseShort || quoteShort}
                  onClick={async () => {
                    setPhase('depositing');
                    try {
                      await onConfirm(pool, baseAmt, quoteAmt);
                      setPhase('done');
                    } catch (e) {
                      setErrMsg(e instanceof Error ? e.message : String(e));
                      setPhase('error');
                    }
                  }}
                >
                  Seal & deposit{' '}
            {usdValue
              ? `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : '—'}
                </button>
              </div>
            </>
          );
        })()}
      </div>
    </div>,
    document.body,
  );
}

function WithdrawModal({
  position,
  onClose,
  onConfirm,
}: {
  position: PositionView | null;
  onClose: () => void;
  onConfirm: (position: PositionView, pct: number) => Promise<void>;
}) {
  const [pct, setPct] = useState(100);
  const [phase, setPhase] = useState<'input' | 'withdrawing' | 'done' | 'error'>('input');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!position) return;
    setPct(100);
    setPhase('input');
    setErrMsg(null);
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [position, onClose]);

  if (!position) return null;
  const { poolView: p } = position;
  const wB = (position.myBaseAmount * pct) / 100;
  const wQ = (position.myQuoteAmount * pct) / 100;
  const wValue = ((position.valueUsd ?? 0) * pct) / 100;

  if (phase === 'withdrawing' || phase === 'done' || phase === 'error') {
    const isDone = phase === 'done';
    const isErr = phase === 'error';
    return createPortal(
      <div className="wm" role="dialog" aria-modal="true">
        <div className="wm__scrim" onClick={onClose} />
        <div className="wm__card dpm">
          <div className="wm__head">
            <div className="wm__head-l">
              <span
                className="wm__cls-bar"
                style={isDone ? { background: '#4ade80' } : isErr ? { background: '#f87171' } : {}}
              />
              <span>
                {isDone
                  ? 'WITHDRAWAL SETTLED'
                  : isErr
                    ? 'WITHDRAW FAILED'
                    : `SEALING WITHDRAWAL · ${p.base}/${p.quote}`}
              </span>
            </div>
            <button onClick={onClose} className="wm__close">
              ×
            </button>
          </div>
          <div className="dpm__phase">
            <div className={`dpm__phase-icon ${isDone ? 'dpm__phase-icon--done' : ''}`}>
              {isDone ? '✓' : isErr ? '×' : <span className="dpm__spin" />}
            </div>
            <div className="dpm__phase-title">
              {isDone
                ? `${fmtAmt(wB)} ${p.base} + ${fmtAmt(wQ)} ${p.quote} returned`
                : isErr
                  ? errMsg ?? 'Unknown error'
                  : 'Burning LP & generating proof'}
            </div>
            <div className="dpm__phase-sub">
              {isDone ? `Value $${wValue.toFixed(0)}` : isErr ? 'No funds moved.' : 'Phase B settle'}
            </div>
            <button className="bal__btn dpm__done" onClick={onClose}>
              {isDone || isErr ? 'Done' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="wm" role="dialog" aria-modal="true">
      <div className="wm__scrim" onClick={onClose} />
      <div className="wm__card dpm">
        <div className="wm__head">
          <div className="wm__head-l">
            <span className="wm__cls-bar" />
            <span>
              WITHDRAW · {p.base}/{p.quote}
            </span>
          </div>
          <button onClick={onClose} className="wm__close">
            ×
          </button>
        </div>
        <div className="dpm__pair">
          <PoolIcon base={p.base} quote={p.quote} />
          <div className="dpm__pair-l">
            <div className="dpm__pair-name">
              {p.base}/{p.quote}
            </div>
            <div className="dpm__pair-sub">
              Position {fmtAmt(position.myBaseAmount)} {p.base} + {fmtAmt(position.myQuoteAmount)}{' '}
              {p.quote}
              {position.valueUsd !== null ? ` · $${position.valueUsd.toFixed(0)}` : ''}
            </div>
          </div>
        </div>
        <div className="dpm__cp-note">
          <span className="dpm__cp-bar" />
          <span>Burns LP share — you receive both sides at the current pool ratio.</span>
        </div>
        <div className="dpm__field">
          <div className="dpm__field-h">
            <span>Withdraw amount</span>
            <span className="dpm__bal">{pct}% of LP</span>
          </div>
          <div className="wd__slider-wrap">
            <input
              type="range"
              min={1}
              max={100}
              value={pct}
              onChange={(e) => setPct(parseInt(e.target.value, 10))}
              className="wd__slider"
            />
            <div className="wd__slider-track">
              <span className="wd__slider-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="dpm__quick">
            {[25, 50, 75, 100].map((v) => (
              <button
                key={v}
                className={`dpm__quick-b ${pct === v ? 'is-active' : ''}`}
                onClick={() => setPct(v)}
              >
                {v}%
              </button>
            ))}
          </div>
        </div>
        <div className="dpm__proj">
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">{p.base} out</span>
            <span className="dpm__proj-v">{fmtAmt(wB)}</span>
          </div>
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">{p.quote} out</span>
            <span className="dpm__proj-v">{fmtAmt(wQ)}</span>
          </div>
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">USD value</span>
            <span className="dpm__proj-v">
              {wValue > 0
                ? `$${wValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </span>
          </div>
        </div>
        <div className="dpm__notes">
          <div className="dpm__note">
            <span className="dpm__note-k">Routing</span>
            <span>Both legs settle to your shielded balances on the Trade page.</span>
          </div>
          <div className="dpm__note">
            <span className="dpm__note-k">Settlement</span>
            <span>Lands next batch · atomic, no slippage.</span>
          </div>
        </div>
        <div className="dpm__cta">
          <button className="bal__btn bal__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="bal__btn dpm__confirm"
            disabled={phase !== 'input'}
            onClick={async () => {
              if (phase !== 'input') return;
              setPhase('withdrawing');
              try {
                await onConfirm(position, pct);
                setPhase('done');
              } catch (e) {
                setErrMsg(e instanceof Error ? e.message : String(e));
                setPhase('error');
              }
            }}
          >
            Seal & withdraw{' '}
            {wValue
              ? `$${wValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : '—'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CreatePoolModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (params: {
    base: string;
    quote: string;
    fee: number;
    seedBase: string;
    seedQuote: string;
  }) => Promise<void>;
}) {
  const [base, setBase] = useState('');
  const [quote, setQuote] = useState('USDC');
  const [fee, setFee] = useState(0.04);
  // CPMM requires both reserves > 0 at launch (xy=k undefined otherwise).
  const [seedBase, setSeedBase] = useState('');
  const [seedQuote, setSeedQuote] = useState('');
  const [phase, setPhase] = useState<'input' | 'creating' | 'done' | 'error'>('input');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBase('');
    setQuote('USDC');
    setFee(0.04);
    setSeedBase('');
    setSeedQuote('');
    setPhase('input');
    setErrMsg(null);
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

  // base58 length 32–44 → treat as an SPL mint address. v1 blocks pasted
  // addresses because auto-wrapping arbitrary SPL → shielded Token-2022 is roadmap.
  const looksLikeAddress = base.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(base);
  const baseAddressBlocked = looksLikeAddress;

  const numBase = parseFloat(seedBase) || 0;
  const numQuote = parseFloat(seedQuote) || 0;
  const initialPrice = numBase > 0 ? numQuote / numBase : 0;
  const seedReady = numBase > 0 && numQuote > 0 && !!base && !baseAddressBlocked;

  if (phase === 'done' || phase === 'error') {
    const isErr = phase === 'error';
    return createPortal(
      <div className="wm" role="dialog" aria-modal="true">
        <div className="wm__scrim" onClick={onClose} />
        <div className="wm__card dpm">
          <div className="wm__head">
            <div className="wm__head-l">
              <span
                className="wm__cls-bar"
                style={{ background: isErr ? '#f87171' : '#4ade80' }}
              />
              <span>{isErr ? 'POOL CREATE FAILED' : 'POOL DEPLOYED'}</span>
            </div>
            <button onClick={onClose} className="wm__close">
              ×
            </button>
          </div>
          <div className="dpm__phase">
            <div className={`dpm__phase-icon ${isErr ? '' : 'dpm__phase-icon--done'}`}>
              {isErr ? '×' : '✓'}
            </div>
            <div className="dpm__phase-title">
              {isErr
                ? errMsg ?? 'Unknown error'
                : `${base || 'TKN'}/${quote} pool created`}
            </div>
            <div className="dpm__phase-sub">
              {isErr
                ? 'No pool deployed.'
                : `Fee tier ${fee.toFixed(2)}% · ${seedBase} ${base} + ${seedQuote} ${quote}`}
            </div>
            <button className="bal__btn dpm__done" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="wm" role="dialog" aria-modal="true">
      <div className="wm__scrim" onClick={onClose} />
      <div className="wm__card dpm">
        <div className="wm__head">
          <div className="wm__head-l">
            <span className="wm__cls-bar" />
            <span>CREATE POOL</span>
          </div>
          <button onClick={onClose} className="wm__close">
            ×
          </button>
        </div>
        <div className="dpm__field">
          <div className="dpm__field-h">
            <span>Base token</span>
            <span className="dpm__bal">
              {baseAddressBlocked
                ? 'Token-2022 confidential required'
                : 'Symbol or shielded mint address'}
            </span>
          </div>
          <div className="dpm__input">
            <input
              autoFocus
              value={base}
              onChange={(e) => {
                const v = e.target.value;
                setBase(v.length >= 32 ? v : v.toUpperCase());
              }}
              placeholder="shTKN  or  Es8…JpQ (Token-2022 confidential)"
            />
          </div>
          {baseAddressBlocked && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#fbbf24',
                border: '1px solid rgba(251, 191, 36, 0.25)',
                borderRadius: 6,
                lineHeight: 1.5,
                letterSpacing: '0.04em',
              }}
            >
              Auto-deploy of a shielded mint from a legacy SPL token is on the v2
              roadmap. For v1, base must already be a Token-2022 confidential
              mint — wrap your token via the Trade page's Wrapper flow first.
            </div>
          )}
        </div>
        <div className="dpm__field">
          <div className="dpm__field-h">
            <span>Quote token</span>
          </div>
          <div className="dpm__quote-opts">
            {(['USDC', 'USDT', 'SOL'] as const).map((q) => (
              <button
                key={q}
                className={`dpm__quote-b ${quote === q ? 'is-active' : ''}`}
                onClick={() => setQuote(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="dpm__field">
          <div className="dpm__field-h">
            <span>Fee tier</span>
            <span className="dpm__bal">Per swap, paid to LPs</span>
          </div>
          <div className="dpm__quote-opts">
            {[
              { v: 0.01, l: 'Stable', h: '0.01%' },
              { v: 0.04, l: 'Standard', h: '0.04%' },
              { v: 0.05, l: 'Volatile', h: '0.05%' },
              { v: 0.1, l: 'Exotic', h: '0.10%' },
            ].map((f) => (
              <button
                key={f.v}
                className={`dpm__quote-b dpm__quote-b--col ${fee === f.v ? 'is-active' : ''}`}
                onClick={() => setFee(f.v)}
              >
                <span className="dpm__quote-bk">{f.l}</span>
                <span className="dpm__quote-bv">{f.h}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="dpm__cp-note">
          <span className="dpm__cp-bar" />
          <span>
            Constant-product (x·y=k). Both sides seed at launch — initial price = seed {quote} ÷
            seed {base || 'base'}. xy=k undefined for one-sided pools, so dual-deposit is
            required.
          </span>
        </div>
        <div className="dpm__field">
          <div className="dpm__field-h">
            <span>Seed {base || 'base'}</span>
            <span className="dpm__bal">Half the initial liquidity</span>
          </div>
          <div className="dpm__input">
            <input
              type="text"
              value={seedBase}
              onChange={(e) => setSeedBase(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
            />
            <span className="dpm__token">{base || 'TKN'}</span>
          </div>
        </div>
        <div className="dpm__plus">+</div>
        <div className="dpm__field">
          <div className="dpm__field-h">
            <span>Seed {quote}</span>
            <span className="dpm__bal">Half the initial liquidity</span>
          </div>
          <div className="dpm__input">
            <input
              type="text"
              value={seedQuote}
              onChange={(e) => setSeedQuote(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
            />
            <span className="dpm__token">{quote}</span>
          </div>
        </div>
        <div className="dpm__proj">
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">Initial price</span>
            <span className="dpm__proj-v">
              {initialPrice > 0
                ? `1 ${base || 'TKN'} = ${
                    initialPrice < 1 ? initialPrice.toFixed(6) : initialPrice.toFixed(2)
                  } ${quote}`
                : '—'}
            </span>
          </div>
          <div className="dpm__proj-r">
            <span className="dpm__proj-k">Initial k</span>
            <span className="dpm__proj-v">
              {numBase > 0 && numQuote > 0 ? (numBase * numQuote).toFixed(0) : '—'}
            </span>
          </div>
        </div>
        <div className="dpm__notes">
          <div className="dpm__note">
            <span className="dpm__note-k">Token-2022</span>
            <span>
              Base must be Token-2022 with confidential extension. Auto-wrap from legacy SPL is
              v2 roadmap.
            </span>
          </div>
          <div className="dpm__note">
            <span className="dpm__note-k">Cost</span>
            <span>≈ 0.04 SOL rent (Pool + 2 vaults + lp_mint + escrow) · live in ~5 s (7-tx orchestration).</span>
          </div>
        </div>
        <div className="dpm__cta">
          <button className="bal__btn bal__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="bal__btn dpm__confirm"
            disabled={!seedReady}
            onClick={async () => {
              setPhase('creating');
              try {
                await onConfirm({ base, quote, fee, seedBase, seedQuote });
                setPhase('done');
              } catch (e) {
                setErrMsg(e instanceof Error ? e.message : String(e));
                setPhase('error');
              }
            }}
          >
            Deploy pool
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function Pools() {
  const { connection } = useConnection();
  const { wallet, publicKey, signTransaction, signAllTransactions } = useWallet();
  const connectedKey = publicKey?.toBase58();
  const [state, setState] = useState<OccultState | null>(null);
  const [tokenList, setTokenList] = useState<Record<string, TokenInfo>>({});
  const [walletOpen, setWalletOpen] = useState(false);
  const [depositPool, setDepositPool] = useState<PoolView | null>(null);
  const [withdrawPos, setWithdrawPos] = useState<PositionView | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const depositAccts = useMemo(() => {
    if (!depositPool || !state?.demoAccount?.byPool) return null;
    const entry = state.demoAccount.byPool[depositPool.id];
    if (!entry) return null;
    return { tokenA: entry.tokenAccountA, tokenB: entry.tokenAccountB };
  }, [depositPool, state]);
  const depositConfA = useAccountData<ConfidentialAccount>(
    depositAccts?.tokenA ?? null,
    decodeConfidentialAccount,
  );
  const depositConfB = useAccountData<ConfidentialAccount>(
    depositAccts?.tokenB ?? null,
    decodeConfidentialAccount,
  );
  const [depositPlainA, setDepositPlainA] = useState<bigint | null>(null);
  const [depositPlainB, setDepositPlainB] = useState<bigint | null>(null);
  useEffect(() => {
    if (!depositPool) {
      setDepositPlainA(null);
      setDepositPlainB(null);
      return;
    }
    if (!depositConfA.data || !depositConfB.data) return;
    let cancelled = false;
    (async () => {
      try {
        const secrets = await loadDemoSecrets();
        const [a, b] = await Promise.all([
          aesDecrypt(secrets.aesKey, depositConfA.data!.decryptableAvailableBalance),
          aesDecrypt(secrets.aesKey, depositConfB.data!.decryptableAvailableBalance),
        ]);
        if (cancelled) return;
        setDepositPlainA(a);
        setDepositPlainB(b);
      } catch (e) {
        if (!cancelled) console.warn('[pools] deposit balance decrypt', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    depositPool,
    depositConfA.data?.decryptableAvailableBalance,
    depositConfB.data?.decryptableAvailableBalance,
  ]);
  const depositBaseBal = depositPool
    ? ((depositPool.baseIsA ? depositPlainA : depositPlainB) ?? 0n)
    : 0n;
  const depositQuoteBal = depositPool
    ? ((depositPool.baseIsA ? depositPlainB : depositPlainA) ?? 0n)
    : 0n;

  useEffect(() => {
    loadState()
      .then(setState)
      .catch((e) => console.warn('[pools] state.json', e));
    loadTokenList()
      .then(setTokenList)
      .catch((e) => console.warn('[pools] token-list', e));
  }, []);

  const poolFilters = useMemo(
    () => ({
      filters: [
        { dataSize: 376 },
        { memcmp: { offset: 0, bytes: '2' } },
      ],
    }),
    [],
  );
  const allPools = useProgramAccounts<{ address: PublicKey; account: PoolAccount }>(
    state?.programId ?? null,
    poolFilters,
    (address, data) => ({ address, account: decodePool(data) }),
  );

  const slot = useSlot(2_000);
  const pools = useMemo<PoolView[]>(() => {
    if (!state) return [];
    return allPools.entries.map((d) => projectPool(d.address, d.account, tokenList, slot));
  }, [state, allPools.entries, tokenList, slot]);

  const demoReady =
    !!state?.demoAccount && connectedKey === state.demoAccount.owner.toBase58();
  const lpAccountByPool = useMemo<Map<string, PublicKey>>(() => {
    if (!demoReady) return new Map();
    const out = new Map<string, PublicKey>();
    for (const [poolKey, entry] of Object.entries(state!.demoAccount!.byPool)) {
      if (entry.tokenAccountLp) out.set(poolKey, entry.tokenAccountLp);
    }
    return out;
  }, [demoReady, state]);

  const [lpBalances, setLpBalances] = useState<Map<string, bigint>>(new Map());
  // Poll-per-pool: can't call useAccountData in a loop.
  useEffect(() => {
    if (!demoReady || lpAccountByPool.size === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const secrets = await loadDemoSecrets();
        const next = new Map<string, bigint>();
        for (const [poolKey, acct] of lpAccountByPool) {
          try {
            const info = await connection.getAccountInfo(acct, 'confirmed');
            if (!info) continue;
            const conf: ConfidentialAccount = decodeConfidentialAccount(info.data);
            const plain = await aesDecrypt(secrets.aesKey, conf.decryptableAvailableBalance);
            next.set(poolKey, plain);
          } catch (e) {
            console.warn('[pools] lp balance', poolKey, e);
          }
        }
        if (!cancelled) setLpBalances(next);
      } catch (e) {
        if (!cancelled) console.warn('[pools] secrets', e);
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [demoReady, lpAccountByPool, connection]);

  // Drop pending optimistic positions once the real LP balance arrives
  // on chain for the same pool.
  useEffect(() => {
    setPendingPositions((prev) =>
      prev.filter((p) => {
        const bal = lpBalances.get(p.poolId);
        return !bal || bal === 0n;
      }),
    );
  }, [lpBalances]);

  const positions = useMemo<PositionView[]>(() => {
    if (!demoReady) return [];
    const out: PositionView[] = [];
    for (const p of pools) {
      const bal = lpBalances.get(p.id);
      if (!bal || bal === 0n) continue;
      const lpSupply = p.raw.lpSupply ?? 0n;
      if (lpSupply === 0n) continue;
      // Token-2022 u48 ceiling fits inside Number for ratio math.
      const share = Number(bal) / Number(lpSupply);
      const myBaseAmount = p.reserveBHuman * share;
      const myQuoteAmount = p.reserveQHuman * share;
      const valueUsd = p.tvlUsd !== null ? p.tvlUsd * share : null;
      out.push({
        poolView: p,
        lpBalance: bal,
        share,
        myBaseAmount,
        myQuoteAmount,
        valueUsd,
      });
    }
    return out;
  }, [demoReady, pools, lpBalances]);

  // Re-entrancy guards.
  const depositInFlightRef = useRef(false);
  const withdrawInFlightRef = useRef(false);

  // Optimistic pending-deposit positions — shown in MyPositions
  // immediately after submit. Cleared when the corresponding lp_balance
  // arrives (after auditor finalize + apply).
  type PendingPos = {
    poolId: string;
    poolView: PoolView;
    baseAmt: number;
    quoteAmt: number;
    estLpOut: bigint;
    submittedAt: number;
  };
  const [pendingPositions, setPendingPositions] = useState<PendingPos[]>([]);

  const handleDeposit = async (pool: PoolView, baseAmt: number, quoteAmt: number) => {
    if (depositInFlightRef.current) return;
    depositInFlightRef.current = true;
    try {
    if (!state || !publicKey || !signTransaction || !signAllTransactions) {
      throw new Error('wallet not connected');
    }
    if (wallet?.adapter.name !== DemoWalletName) {
      throw new Error('AddLiquidity needs the demo wallet (auditor secret access in v1).');
    }
    if (!state.demoAccount) throw new Error('demoAccount missing in state.json');
    const entry = state.demoAccount.byPool[pool.id];
    if (!entry?.tokenAccountLp) {
      throw new Error('alice has no LP-token account on this pool — re-run bootstrap');
    }

    const [secrets, auditor] = await Promise.all([
      loadDemoSecrets(),
      loadAuditorSecrets(),
    ]);

    // Decimals are mint-bound: when baseIsA is false, decimalsA = quote-side decimals.
    const userTokenA = entry.tokenAccountA;
    const userTokenB = entry.tokenAccountB;
    const amountAHuman = pool.baseIsA ? baseAmt : quoteAmt;
    const amountBHuman = pool.baseIsA ? quoteAmt : baseAmt;
    const decimalsA = pool.baseIsA ? pool.decimalsBase : pool.decimalsQuote;
    const decimalsB = pool.baseIsA ? pool.decimalsQuote : pool.decimalsBase;
    const amountA = BigInt(Math.round(amountAHuman * 10 ** decimalsA));
    const amountB = BigInt(Math.round(amountBHuman * 10 ** decimalsB));

    const result = await executeAddLiquidity(
      connection,
      { signTransaction, signAllTransactions },
      {
        programId: state.programId,
        pool: pool.address,
        user: publicKey,
        payer: publicKey,
        userTokenA,
        userTokenB,
        userLp: entry.tokenAccountLp,
        amountA,
        amountB,
        slippageBps: 50,
        userElGamalKeypair: secrets.elgamalKeypair,
        userAesKey: secrets.aesKey,
        auditorElGamalPubkey: auditor.elgamalKeypair.slice(0, 32),
      },
      (p) => console.log('[add-liq]', p),
    );
    console.log('[add-liq] request submitted — waiting for auditor finalize', result);
    // Optimistic pending card — MyPositions shows it immediately, auto-
    // removed when lp_balance arrives via the lpBalances poll.
    setPendingPositions((prev) => [
      ...prev.filter((p) => p.poolId !== pool.id),
      {
        poolId: pool.id,
        poolView: pool,
        baseAmt,
        quoteAmt,
        estLpOut: result.lpOutEstimate,
        submittedAt: Date.now(),
      },
    ]);
    } finally {
      depositInFlightRef.current = false;
    }
  };
  const handleWithdraw = async (position: PositionView, pct: number) => {
    if (withdrawInFlightRef.current) return;
    withdrawInFlightRef.current = true;
    try {
    if (!state || !publicKey || !signTransaction || !signAllTransactions) {
      throw new Error('wallet not connected');
    }
    if (wallet?.adapter.name !== DemoWalletName) {
      throw new Error('RemoveLiquidity needs the demo wallet (single-key v1).');
    }
    if (!state.demoAccount) throw new Error('demoAccount missing');
    const entry = state.demoAccount.byPool[position.poolView.id];
    if (!entry?.tokenAccountLp) throw new Error('alice has no LP account on this pool');

    const [secrets, auditor] = await Promise.all([loadDemoSecrets(), loadAuditorSecrets()]);
    const lpAmount = (position.lpBalance * BigInt(pct)) / 100n;
    if (lpAmount === 0n) throw new Error('lp_amount = 0');

    const result = await executeRemoveLiquidity(
      connection,
      { signTransaction, signAllTransactions },
      {
        programId: state.programId,
        pool: position.poolView.address,
        user: publicKey,
        payer: publicKey,
        userTokenA: entry.tokenAccountA,
        userTokenB: entry.tokenAccountB,
        userLp: entry.tokenAccountLp,
        lpAmount,
        slippageBps: 50,
        userElGamalKeypair: secrets.elgamalKeypair,
        userAesKey: secrets.aesKey,
        auditorElGamalKeypair: auditor.elgamalKeypair,
        auditorAesKey: auditor.aesKey,
      },
      (p) => console.log('[remove-liq]', p),
    );
    console.log('[remove-liq] done', result);
    } finally {
      withdrawInFlightRef.current = false;
    }
  };
  const handleCreate = async (params: {
    base: string;
    quote: string;
    fee: number;
    seedBase: string;
    seedQuote: string;
  }) => {
    console.log('[pools] create', params);
    throw new Error(
      'CreatePool from UI not yet wired — backend orchestrates init-pool + init-vault×2 + set-reserves + fund-pool-vault×2 + init-lp-mint (7 tx). v1 path is the bootstrap script.',
    );
  };

  const networkKind = state ? classifyNetwork(state.rpcUrl) : 'unknown';
  const nlabel = networkLabel(networkKind);

  return (
    <>
      <PoolsNav networkLabel={nlabel} onConnect={() => setWalletOpen(true)} />
      <main className="dpage dpage--slim">
        <StatHero pools={pools} />
        <MyPositions
          positions={positions}
          pending={pendingPositions}
          onAdd={(p) => setDepositPool(p)}
          onRemove={(pos) => setWithdrawPos(pos)}
        />
        <PoolsList
          pools={pools}
          onDeposit={(p) => setDepositPool(p)}
          onCreate={() => setCreateOpen(true)}
        />
        <footer className="dpage__foot">
          <span>OCCULT v0.4.2 · {nlabel} · POOLS</span>
          <span>
            {connectedKey ? `Connected ${shortAddr(connectedKey)}` : 'Liquidity simulation'}
          </span>
        </footer>
      </main>

      <OccultWalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />

      <DepositModal
        pool={depositPool}
        baseBalance={depositBaseBal}
        quoteBalance={depositQuoteBal}
        onClose={() => setDepositPool(null)}
        onConfirm={handleDeposit}
      />
      <WithdrawModal
        position={withdrawPos}
        onClose={() => setWithdrawPos(null)}
        onConfirm={handleWithdraw}
      />
      <CreatePoolModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onConfirm={handleCreate}
      />
    </>
  );
}
