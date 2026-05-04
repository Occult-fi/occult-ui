import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Redacted from '../components/Redacted';
import '../landing.css';

// ---------------------------------------------------------------------------
// Top nav
// ---------------------------------------------------------------------------
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`nav ${scrolled ? 'nav--scrolled' : ''}`}>
      <div className="nav__inner">
        <a href="#top" className="nav__brand">
          <span className="nav__mark" aria-hidden="true">
            <span className="nav__mark-bar" />
            <span className="nav__mark-bar" />
          </span>
          <span className="nav__name">Occult</span>
        </a>
        <div className="nav__links">
          <a href="#problem">Problem</a>
          <a href="#how">How it works</a>
          <a href="#tech">Technology</a>
          <Link to="/demo" className="nav__cta">
            <span>Launch Demo</span>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="square" />
            </svg>
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------
function Hero() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="hero" id="top">
      <div className="hero__ambient" aria-hidden="true">
        <div className="hero__grid" />
        <div className="hero__glow" />
        <div className="hero__scan" />
      </div>

      <div className="hero__chrome">
        <div className="hero__classification">
          <span className="hero__cls-bar" />
          <span className="hero__cls-text">CLASSIFIED · BATCH AUCTION PROTOCOL</span>
          <span className="hero__cls-bar" />
        </div>
      </div>

      <div className={`hero__content ${armed ? 'is-armed' : ''}`}>
        <h1 className="hero__title">
          <span className="hero__line">Trade</span>
          <span className="hero__line">without being</span>
          <span className="hero__line hero__line--seen">
            <span className="hero__seen-text">seen.</span>
            <span className="hero__seen-bar" aria-hidden="true" />
          </span>
        </h1>

        <p className="hero__sub">
          A confidential batch auction AMM on Solana. Order amounts are encrypted on-chain,
          settled in batches, and never visible to the mempool, validators, or other traders.
        </p>

        <div className="hero__cta">
          <Link to="/demo" className="btn btn--primary">
            <span>Try Demo</span>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M5 3l5 5-5 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="square" />
            </svg>
          </Link>
          <a href="https://github.com/Occult-fi/occult" className="btn btn--ghost" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path fill="currentColor" d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.1.75-.24.75-.53v-2c-3.06.66-3.7-1.3-3.7-1.3-.5-1.27-1.22-1.6-1.22-1.6-1-.69.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.2 3.2.92.1-.71.38-1.2.7-1.48-2.45-.27-5.02-1.22-5.02-5.43 0-1.2.43-2.18 1.13-2.95-.11-.27-.49-1.4.11-2.92 0 0 .92-.3 3.02 1.13a10.5 10.5 0 0 1 5.5 0c2.1-1.42 3.02-1.13 3.02-1.13.6 1.52.22 2.65.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.22-2.57 5.15-5.02 5.42.39.34.74 1 .74 2.02v3c0 .29.2.64.76.53A11 11 0 0 0 12 1.27" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>

        <div className="hero__meta">
          <div className="hero__meta-row">
            <span className="hero__meta-k">PROTOCOL</span>
            <span className="hero__meta-v">OCCULT v0.4.2</span>
          </div>
          <div className="hero__meta-row">
            <span className="hero__meta-k">CHAIN</span>
            <span className="hero__meta-v">Solana · Devnet</span>
          </div>
          <div className="hero__meta-row">
            <span className="hero__meta-k">EPOCH</span>
            <span className="hero__meta-v">
              <Redacted segments={2}>614,239</Redacted>
            </span>
          </div>
          <div className="hero__meta-row">
            <span className="hero__meta-k">VOLUME 24H</span>
            <span className="hero__meta-v">
              <Redacted segments={3}>$48.2M</Redacted>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Problem section
// ---------------------------------------------------------------------------
type Row = { address: string; asset: string; amount: string; time: string };

function ProblemRow({
  kind,
  address,
  asset,
  amount,
  time,
  redacting,
  redacted,
}: Row & { kind: 'public' | 'occult'; redacting?: boolean; redacted?: boolean }) {
  return (
    <div className={`txrow txrow--${kind}`}>
      <div className="txrow__cell txrow__cell--time">{time}</div>
      <div className="txrow__cell txrow__cell--addr">
        <span className="txrow__dot" />
        {address}
      </div>
      <div className="txrow__cell txrow__cell--asset">
        <span className="txrow__pair">{asset}</span>
      </div>
      <div className="txrow__cell txrow__cell--amount">
        {kind === 'occult' ? (
          <span className={`txrow__amount-wrap ${redacting ? 'is-redacting' : ''} ${redacted ? 'is-redacted' : ''}`}>
            <span className="txrow__amount">{amount}</span>
            <span className="txrow__bar" aria-hidden="true">
              <span className="txrow__bar-seg" style={{ flexGrow: 2 }} />
              <span className="txrow__bar-seg" style={{ flexGrow: 3 }} />
              <span className="txrow__bar-seg" style={{ flexGrow: 1.5 }} />
            </span>
          </span>
        ) : (
          <span className="txrow__amount">{amount}</span>
        )}
      </div>
      <div className="txrow__cell txrow__cell--status">
        {kind === 'occult' ? (
          <span className="txrow__status txrow__status--ok">SEALED</span>
        ) : (
          <span className="txrow__status txrow__status--warn">VISIBLE</span>
        )}
      </div>
    </div>
  );
}

function Problem() {
  const ref = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState(0);
  const occultData = useRef<Row[]>([
    { address: '8xK4...d2Ae', asset: 'SOL → USDC', amount: '14,820.50', time: 'T-04' },
    { address: 'Lq7s...nP1k', asset: 'JUP → USDC', amount: '892,400.00', time: 'T-03' },
    { address: '3Mw9...vRhT', asset: 'USDC → SOL', amount: '62,000.00', time: 'T-02' },
    { address: 'Vk2j...bX8e', asset: 'WBTC → USDC', amount: '1,250,000.00', time: 'T-01' },
  ]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && phase === 0) {
            setTimeout(() => setPhase(1), 600);
            setTimeout(() => setPhase(2), 1700);
          }
        });
      },
      { threshold: 0.4 }
    );
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [phase]);

  const replay = () => {
    setPhase(0);
    setTimeout(() => setPhase(1), 100);
    setTimeout(() => setPhase(2), 1200);
  };

  return (
    <section className="section problem" id="problem" ref={ref}>
      <div className="section__head">
        <div className="section__eyebrow">
          <span className="eyebrow__bar" />
          <span>01 / THE PROBLEM</span>
        </div>
        <h2 className="section__title">
          Every order on a public AMM<br />
          is a public announcement.
        </h2>
        <p className="section__lead">
          Size, direction, and intent — all broadcast to the mempool the instant you sign.
          Front-runners read it. MEV bots act on it. Your execution suffers for it.
        </p>
      </div>

      <div className="compare">
        <div className="compare__col">
          <div className="compare__label">
            <span className="compare__chip compare__chip--bad">PUBLIC AMM</span>
            <span className="compare__caption">Anyone with an RPC can read every detail.</span>
          </div>
          <div className="ledger">
            <div className="ledger__head">
              <span>TIME</span><span>WALLET</span><span>PAIR</span><span>AMOUNT</span><span>STATE</span>
            </div>
            {occultData.current.map((r, i) => (
              <ProblemRow key={i} kind="public" {...r} />
            ))}
          </div>
        </div>

        <div className="compare__col">
          <div className="compare__label">
            <span className="compare__chip compare__chip--good">OCCULT</span>
            <span className="compare__caption">
              Same trades. Amounts encrypted before they reach the chain.
              <button onClick={replay} className="compare__replay">↻ replay</button>
            </span>
          </div>
          <div className="ledger ledger--occult">
            <div className="ledger__head">
              <span>TIME</span><span>WALLET</span><span>PAIR</span><span>AMOUNT</span><span>STATE</span>
            </div>
            {occultData.current.map((r, i) => (
              <ProblemRow
                key={i}
                kind="occult"
                {...r}
                redacting={phase === 1}
                redacted={phase === 2}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------
type IconKind = 'encrypt' | 'batch' | 'verify';

function StepIcon({ kind }: { kind: IconKind }) {
  if (kind === 'encrypt') {
    return (
      <svg viewBox="0 0 64 64" className="stepicon">
        <rect x="14" y="28" width="36" height="24" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <path d="M22 28v-8a10 10 0 0 1 20 0v8" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <circle cx="32" cy="40" r="2" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'batch') {
    return (
      <svg viewBox="0 0 64 64" className="stepicon">
        <rect x="10" y="14" width="44" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <rect x="10" y="29" width="44" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <rect x="10" y="44" width="44" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <line x1="20" y1="22" x2="20" y2="29" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
        <line x1="32" y1="22" x2="32" y2="29" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
        <line x1="44" y1="22" x2="44" y2="29" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" className="stepicon">
      <circle cx="32" cy="32" r="18" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M22 32l8 8 14-16" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function DiagramFor({ kind }: { kind: IconKind }) {
  if (kind === 'encrypt') {
    return (
      <div className="diag">
        <div className="diag__row">
          <span className="diag__lbl">PLAINTEXT</span>
          <span className="diag__val diag__val--mono">14820.50 USDC</span>
        </div>
        <div className="diag__arrow">↓ ELGAMAL</div>
        <div className="diag__row">
          <span className="diag__lbl">CIPHERTEXT</span>
          <span className="diag__val diag__val--mono">0x9f3a…c712</span>
        </div>
      </div>
    );
  }
  if (kind === 'batch') {
    return (
      <div className="diag">
        <div className="diag__batch">
          <span className="diag__cell" />
          <span className="diag__cell" />
          <span className="diag__cell" />
          <span className="diag__cell" />
          <span className="diag__cell" />
          <span className="diag__cell" />
        </div>
        <div className="diag__arrow">↓ T+400ms</div>
        <div className="diag__row">
          <span className="diag__lbl">CLEARING</span>
          <span className="diag__val diag__val--mono">uniform price</span>
        </div>
      </div>
    );
  }
  return (
    <div className="diag">
      <div className="diag__row">
        <span className="diag__lbl">PROOF</span>
        <span className="diag__val diag__val--mono">π = (A, B, C)</span>
      </div>
      <div className="diag__arrow">↓ VERIFY</div>
      <div className="diag__row diag__row--ok">
        <span className="diag__lbl">CHAIN STATE</span>
        <span className="diag__val">VALID · SEALED</span>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps: { n: string; icon: IconKind; title: string; body: string }[] = [
    {
      n: '01',
      icon: 'encrypt',
      title: 'Submit encrypted',
      body: 'Your order is encrypted client-side using ZK ElGamal. Only the ciphertext touches the network. Validators see a commitment — never a number.',
    },
    {
      n: '02',
      icon: 'batch',
      title: 'Settle in batches',
      body: 'Orders accumulate inside a fixed-window batch. At close, a uniform clearing price is computed homomorphically — no order learns of any other.',
    },
    {
      n: '03',
      icon: 'verify',
      title: 'Verifiable, not visible',
      body: 'Each settlement emits a zero-knowledge proof of correctness. The chain knows the batch was solved correctly. It does not know what was inside it.',
    },
  ];

  return (
    <section className="section how" id="how">
      <div className="section__head">
        <div className="section__eyebrow">
          <span className="eyebrow__bar" />
          <span>02 / MECHANISM</span>
        </div>
        <h2 className="section__title">Three primitives.<br />No middlemen.</h2>
        <p className="section__lead">
          Occult runs entirely on Solana. No off-chain solvers, no relayer network,
          no trusted operators. The protocol is the only party that handles plaintext —
          and even it never persists one.
        </p>
      </div>

      <div className="steps">
        {steps.map((s) => (
          <article key={s.n} className="step">
            <div className="step__head">
              <span className="step__n">{s.n}</span>
              <span className="step__icon"><StepIcon kind={s.icon} /></span>
            </div>
            <h3 className="step__title">{s.title}</h3>
            <p className="step__body">{s.body}</p>
            <div className="step__diag">
              <DiagramFor kind={s.icon} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live swap demo (animated)
// ---------------------------------------------------------------------------
type SwapPhase = 'idle' | 'typing' | 'signing' | 'broadcast' | 'sealed';

function toUsdc(amt: string) {
  const n = parseFloat(amt.replace(/,/g, '')) || 0;
  return (n * 142.7).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LiveAmount({ phase, amount }: { phase: SwapPhase; amount: string }) {
  if (phase === 'idle' || phase === 'typing') {
    return <span className="logrow__plain">{amount || '—'}</span>;
  }
  if (phase === 'signing') {
    return <span className="logrow__plain logrow__plain--fading">{amount}</span>;
  }
  return (
    <span className={`logrow__bar logrow__bar--anim ${phase === 'sealed' ? 'is-sealed' : ''}`} aria-hidden>
      <span style={{ flexGrow: 2 }} />
      <span style={{ flexGrow: 3 }} />
      <span style={{ flexGrow: 1.5 }} />
    </span>
  );
}

function LogRow({
  time,
  wallet,
  pair,
  sealed,
  live,
  phase,
  amount,
}: {
  time: string;
  wallet: string;
  pair: string;
  sealed?: boolean;
  live?: boolean;
  phase?: SwapPhase;
  amount?: string;
}) {
  return (
    <div className={`logrow ${live ? 'logrow--live' : ''}`}>
      <span className="logrow__time">{time}</span>
      <span className="logrow__wallet">{wallet}</span>
      <span className="logrow__pair">{pair}</span>
      <span className="logrow__amount">
        {live ? (
          <LiveAmount phase={phase ?? 'idle'} amount={amount ?? ''} />
        ) : (
          <span className="logrow__bar" aria-hidden>
            <span style={{ flexGrow: 2 }} />
            <span style={{ flexGrow: 3 }} />
            <span style={{ flexGrow: 1.5 }} />
          </span>
        )}
      </span>
      <span className={`logrow__state ${sealed ? 'is-sealed' : live && phase === 'sealed' ? 'is-sealed' : ''}`}>
        {live
          ? phase === 'sealed'
            ? 'SEALED'
            : phase === 'broadcast'
              ? 'PENDING'
              : phase === 'signing'
                ? 'SIGNING'
                : '—'
          : 'SEALED'}
      </span>
    </div>
  );
}

function SwapDemo() {
  const [phase, setPhase] = useState<SwapPhase>('idle');
  const [amount, setAmount] = useState('');
  const target = '14,820.50';
  const ref = useRef<HTMLElement | null>(null);
  const ranOnce = useRef(false);

  const run = () => {
    setPhase('typing');
    setAmount('');
    let i = 0;
    const typer = setInterval(() => {
      i++;
      setAmount(target.slice(0, i));
      if (i >= target.length) {
        clearInterval(typer);
        setTimeout(() => setPhase('signing'), 500);
        setTimeout(() => setPhase('broadcast'), 1400);
        setTimeout(() => setPhase('sealed'), 2400);
        setTimeout(() => {
          setPhase('idle');
          setAmount('');
        }, 5200);
      }
    }, 60);
  };

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !ranOnce.current) {
            ranOnce.current = true;
            setTimeout(run, 400);
          }
        });
      },
      { threshold: 0.35 }
    );
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  return (
    <section className="section demo" id="demo" ref={ref}>
      <div className="section__head">
        <div className="section__eyebrow">
          <span className="eyebrow__bar" />
          <span>03 / DEMO</span>
        </div>
        <h2 className="section__title">Watch a swap disappear.</h2>
        <p className="section__lead">
          A simulated trade. The amount is visible to you — the user — until it's signed.
          The instant the transaction is sealed, the public log redacts.
        </p>
      </div>

      <div className="demo__wrap">
        <div className="demo__card">
          <div className="demo__card-head">
            <span className="demo__pair">SOL / USDC</span>
          </div>

          <div className="demo__field">
            <label>YOU PAY</label>
            <div className="demo__input">
              <span className="demo__amount">{amount || '104.00'}</span>
              <span className="demo__token">SOL</span>
            </div>
          </div>

          <div className="demo__divider"><span>≈</span></div>

          <div className="demo__field">
            <label>YOU RECEIVE</label>
            <div className="demo__input">
              <span className="demo__amount demo__amount--out">
                {amount ? toUsdc(amount) : '14,840.80'}
              </span>
              <span className="demo__token">USDC</span>
            </div>
          </div>

          <button
            className={`demo__submit ${phase !== 'idle' ? 'is-active' : ''}`}
            onClick={run}
          >
            <span
              className="demo__submit-fill"
              style={{
                transform:
                  phase === 'signing' || phase === 'broadcast'
                    ? 'scaleX(1)'
                    : phase === 'sealed'
                      ? 'scaleX(1)'
                      : 'scaleX(0)',
              }}
            />
            <span className="demo__submit-label">
              {phase === 'idle' && 'SWAP'}
              {phase === 'typing' && 'DRAFTING…'}
              {phase === 'signing' && 'ENCRYPTING…'}
              {phase === 'broadcast' && 'BROADCASTING…'}
              {phase === 'sealed' && '✓ SEALED'}
            </span>
          </button>
        </div>

        <div className="demo__log">
          <div className="demo__log-head">
            <span>PUBLIC LEDGER · what the chain sees</span>
          </div>
          <div className="demo__log-rows">
            <LogRow time="T-04" wallet="8xK4…d2Ae" pair="SOL/USDC" sealed />
            <LogRow time="T-03" wallet="Lq7s…nP1k" pair="JUP/USDC" sealed />
            <LogRow time="T-00" wallet="YOU" pair="SOL/USDC" live phase={phase} amount={amount} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tech section
// ---------------------------------------------------------------------------
function Tech() {
  const items = [
    { k: '01', title: 'Native Rust', body: 'Built directly on Solana\'s BPF runtime. No EVM, no transpilation, no abstraction tax. ~7k CU per swap submit.' },
    { k: '02', title: 'Token-2022', body: 'Confidential transfer extensions handle the encrypted balance arithmetic. Standards-compliant from day one.' },
    { k: '03', title: 'ZK ElGamal', body: 'Additively homomorphic encryption. Sums of ciphertexts are sums of plaintexts. Batch settlement is a single addition.' },
    { k: '04', title: 'No external infrastructure', body: 'Zero off-chain components. No solvers, no relayers, no oracles. The Solana validator set is the only trust assumption.' },
  ];
  return (
    <section className="section tech" id="tech">
      <div className="section__head">
        <div className="section__eyebrow">
          <span className="eyebrow__bar" />
          <span>04 / TECHNOLOGY</span>
        </div>
        <h2 className="section__title">Built on primitives,<br />not abstractions.</h2>
      </div>

      <div className="tech__grid">
        {items.map((it) => (
          <div key={it.k} className="tech__cell">
            <div className="tech__k">{it.k}</div>
            <div className="tech__title">{it.title}</div>
            <p className="tech__body">{it.body}</p>
          </div>
        ))}
      </div>

      <div className="tech__signature">
        <div className="tech__sig-row">
          <span className="tech__sig-k">PROGRAM ID</span>
          <span className="tech__sig-v">4vTNEf7b…cz4Gq</span>
        </div>
        <div className="tech__sig-row">
          <span className="tech__sig-k">AUDIT</span>
          <span className="tech__sig-v">In review · OtterSec, Zellic</span>
        </div>
        <div className="tech__sig-row">
          <span className="tech__sig-k">LICENSE</span>
          <span className="tech__sig-v">Apache 2.0</span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <span className="nav__mark" aria-hidden="true">
            <span className="nav__mark-bar" />
            <span className="nav__mark-bar" />
          </span>
          <span>Occult</span>
        </div>
        <div className="footer__links">
          <a href="https://occult.finance">occult.finance</a>
          <span className="footer__sep">·</span>
          <a href="https://github.com/Occult-fi/occult">GitHub</a>
          <span className="footer__sep">·</span>
          <a href="#">Docs</a>
          <span className="footer__sep">·</span>
          <a href="#">Whitepaper</a>
        </div>
        <div className="footer__legal">
          © 2026 OCCULT LABS · DOCUMENT REF /OCC-LP-04
        </div>
      </div>
      <div className="footer__redaction" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span /><span />
      </div>
    </footer>
  );
}

export default function Landing() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.redaction = 'outlined';
    root.dataset.density = 'spacious';
    root.dataset.ambient = 'on';
    root.dataset.classification = 'on';
    root.dataset.monoOnly = 'off';
  }, []);

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <SwapDemo />
        <Tech />
      </main>
      <Footer />
    </>
  );
}
