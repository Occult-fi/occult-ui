import { Link } from 'react-router-dom';
import '../landing.css';

export default function Soon() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 64,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
        }}
      >
        REDACTED · COMING SOON
      </div>
      <h1 style={{ fontSize: 96, fontWeight: 600, letterSpacing: '-0.04em', margin: 0 }}>
        Soon.
      </h1>
      <Link to="/" className="btn btn--ghost">
        ← Back to landing
      </Link>
    </main>
  );
}
