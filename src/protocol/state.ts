import { PublicKey } from '@solana/web3.js';

export type WrapperInfo = {
  address: PublicKey;
  kind: 'spl' | 'sol';
  legacyMint: PublicKey;
  shieldedMint: PublicKey;
  // SystemProgram pubkey sentinel when kind === 'sol' (no SPL account on source side).
  escrowLegacy: PublicKey;
  escrowShielded: PublicKey;
  decimals: number;
  // SystemProgram pubkey sentinel when kind === 'sol'.
  legacyTokenProgram: PublicKey;
};

export type OccultState = {
  programId: PublicKey;
  rpcUrl: string;
  auditorElGamalPubkey: Uint8Array;
  primaryPool: {
    address: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
    decimalsA: number;
    decimalsB: number;
  };
  wrappers: WrapperInfo[];
  // Back-compat alias for the first wrapper.
  wrapper?: WrapperInfo;
  demoAccount?: {
    owner: PublicKey;
    tokenAccountA: PublicKey;
    tokenAccountB: PublicKey;
    legacyUsdcAccount?: PublicKey;
    byPool: Record<
      string,
      {
        mintA: PublicKey;
        mintB: PublicKey;
        tokenAccountA: PublicKey;
        tokenAccountB: PublicKey;
        lpMint?: PublicKey;
        tokenAccountLp?: PublicKey;
      }
    >;
  };
};

export async function loadState(): Promise<OccultState> {
  // Cache-bust required: state.json regenerates on every local-init.sh run.
  const res = await fetch(`/state.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `state.json not available (HTTP ${res.status}). Did the localnet bootstrap finish?`
    );
  }
  const j = await res.json();
  const primary = j.primaryPool ?? j.pool;
  if (!primary) {
    throw new Error('state.json: missing `primaryPool` (or legacy `pool`) field');
  }
  console.log('[state] loaded keys:', Object.keys(j), 'demoAccount?', !!j.demoAccount);
  return {
    programId: new PublicKey(j.programId),
    rpcUrl: j.rpcUrl,
    auditorElGamalPubkey: base64Decode(j.auditorElGamalPubkey ?? primary.auditorElGamalPubkey),
    primaryPool: {
      address: new PublicKey(primary.address),
      mintA: new PublicKey(primary.mintA),
      mintB: new PublicKey(primary.mintB),
      decimalsA: primary.decimalsA,
      decimalsB: primary.decimalsB,
    },
    wrappers: parseWrappers(j),
    wrapper: parseWrappers(j)[0],
    demoAccount: j.demoAccount
      ? {
          owner: new PublicKey(j.demoAccount.owner),
          tokenAccountA: new PublicKey(j.demoAccount.tokenAccountA),
          tokenAccountB: new PublicKey(j.demoAccount.tokenAccountB),
          legacyUsdcAccount: j.demoAccount.legacyUsdcAccount
            ? new PublicKey(j.demoAccount.legacyUsdcAccount)
            : undefined,
          byPool: parseByPool(j.demoAccount.byPool),
        }
      : undefined,
  };
}

export async function loadDemoSecrets(): Promise<{
  elgamalKeypair: Uint8Array;
  aesKey: Uint8Array;
}> {
  const t = Date.now();
  const [eg, aes] = await Promise.all([
    fetch(`/demo-wallets/alice.elgamal.json?t=${t}`, { cache: 'no-store' }).then((r) => r.json()),
    fetch(`/demo-wallets/alice.aes.json?t=${t}`, { cache: 'no-store' }).then((r) => r.json()),
  ]);
  if (!Array.isArray(eg) || eg.length !== 64)
    throw new Error('alice.elgamal.json: expected 64-byte secret-key array');
  if (!Array.isArray(aes) || aes.length !== 16)
    throw new Error('alice.aes.json: expected 16-byte key array');
  return {
    elgamalKeypair: Uint8Array.from(eg),
    aesKey: Uint8Array.from(aes),
  };
}

export async function loadAuditorSecrets(): Promise<{
  elgamalKeypair: Uint8Array;
  aesKey: Uint8Array;
}> {
  const t = Date.now();
  const [eg, aes] = await Promise.all([
    fetch(`/demo-wallets/auditor.elgamal.json?t=${t}`, { cache: 'no-store' }).then((r) => r.json()),
    fetch(`/demo-wallets/auditor.aes.json?t=${t}`, { cache: 'no-store' }).then((r) => r.json()),
  ]);
  if (!Array.isArray(eg) || eg.length !== 64)
    throw new Error('auditor.elgamal.json: expected 64-byte secret-key array');
  if (!Array.isArray(aes) || aes.length !== 16)
    throw new Error('auditor.aes.json: expected 16-byte key array');
  return {
    elgamalKeypair: Uint8Array.from(eg),
    aesKey: Uint8Array.from(aes),
  };
}

function parseWrappers(j: {
  wrapper?: unknown;
  wrappers?: unknown;
}): WrapperInfo[] {
  const list: WrapperInfo[] = [];
  if (Array.isArray(j.wrappers)) {
    for (const w of j.wrappers) list.push(coerceWrapper(w));
  } else if (j.wrapper) {
    list.push(coerceWrapper(j.wrapper));
  }
  return list;
}

function coerceWrapper(raw: unknown): WrapperInfo {
  const w = raw as {
    address: string;
    kind?: string;
    legacyMint: string;
    shieldedMint: string;
    escrowLegacy: string;
    escrowShielded: string;
    decimals: number;
    legacyTokenProgram: string;
  };
  return {
    address: new PublicKey(w.address),
    kind: w.kind === 'sol' ? 'sol' : 'spl',
    legacyMint: new PublicKey(w.legacyMint),
    shieldedMint: new PublicKey(w.shieldedMint),
    escrowLegacy: new PublicKey(w.escrowLegacy),
    escrowShielded: new PublicKey(w.escrowShielded),
    decimals: w.decimals,
    legacyTokenProgram: new PublicKey(w.legacyTokenProgram),
  };
}

function parseByPool(
  raw: unknown,
): NonNullable<OccultState['demoAccount']>['byPool'] {
  const out: ReturnType<typeof parseByPool> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [pool, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as {
      mintA: string;
      mintB: string;
      tokenAccountA: string;
      tokenAccountB: string;
      lpMint?: string;
      tokenAccountLp?: string;
    };
    out[pool] = {
      mintA: new PublicKey(e.mintA),
      mintB: new PublicKey(e.mintB),
      tokenAccountA: new PublicKey(e.tokenAccountA),
      tokenAccountB: new PublicKey(e.tokenAccountB),
      lpMint: e.lpMint ? new PublicKey(e.lpMint) : undefined,
      tokenAccountLp: e.tokenAccountLp ? new PublicKey(e.tokenAccountLp) : undefined,
    };
  }
  return out;
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
