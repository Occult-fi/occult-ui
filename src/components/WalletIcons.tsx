export function PhantomIcon() {
  return (
    <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#AB9FF2" />
      <path
        fill="#fff"
        d="M52.6 32.7h-4.4c0-9-7.3-16.2-16.2-16.2-8.8 0-16 7-16.2 15.7-.1 9 7 16.5 16 16.7h2.2c4-.3 9.5-1.4 13.7-5.3-.7 1.7-1 3.4-1 5 0 .8.6 1.4 1.4 1.4h4.5c.8 0 1.4-.6 1.4-1.4V34c0-.7-.6-1.3-1.4-1.3M21.6 33c0-1.7 1.3-3 3-3s3 1.3 3 3v4c0 1.7-1.3 3-3 3s-3-1.3-3-3zm12.4 0c0-1.7 1.3-3 3-3s3 1.3 3 3v4c0 1.7-1.3 3-3 3s-3-1.3-3-3z"
      />
    </svg>
  );
}

export function SolflareIcon() {
  return (
    <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0a0a0a" stroke="rgba(255,255,255,0.12)" />
      <defs>
        <linearGradient id="sfg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#FFD56B" />
          <stop offset="0.55" stopColor="#FC8E49" />
          <stop offset="1" stopColor="#E2477A" />
        </linearGradient>
      </defs>
      <path
        fill="url(#sfg)"
        d="M32 14c.6 5.7 3.5 10.5 9.6 12.4 6 1.9 8.4 1.5 10.4 1.6-3 1.4-7 2-10.7 4-3.7 2-6.3 5.5-7 9.5-1.4-5-3.4-7.6-7-9.5-3.5-2-7.6-2.6-10.7-4 2.5-.1 4.7.4 10.5-1.6C32 24.4 31.5 19.7 32 14"
      />
      <circle cx="32" cy="32" r="3.2" fill="#fff" />
    </svg>
  );
}

export function GenericWalletIcon() {
  return (
    <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
      <rect
        width="64"
        height="64"
        rx="14"
        fill="rgba(255,255,255,0.05)"
        stroke="rgba(255,255,255,0.12)"
      />
      <rect x="14" y="22" width="36" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="42" cy="33" r="2" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 3l10 10M13 3L3 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
        fill="none"
      />
    </svg>
  );
}
