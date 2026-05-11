import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountInfo,
  Connection,
  GetProgramAccountsConfig,
  PublicKey,
} from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';

export function useAccountData<T>(
  account: PublicKey | null | undefined,
  decode: (data: Uint8Array) => T,
): { data: T | null; raw: AccountInfo<Buffer> | null; error: Error | null; loading: boolean } {
  const { connection } = useConnection();
  const [data, setData] = useState<T | null>(null);
  const [raw, setRaw] = useState<AccountInfo<Buffer> | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  // Stabilise inline decoders via ref so the subscription doesn't tear down on every render.
  const decodeRef = useRef(decode);
  decodeRef.current = decode;

  useEffect(() => {
    if (!account) {
      setData(null);
      setRaw(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const apply = (info: AccountInfo<Buffer> | null) => {
      if (cancelled) return;
      setRaw(info);
      if (!info || info.data.length === 0) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }
      try {
        setData(decodeRef.current(info.data));
        setError(null);
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e : new Error(String(e)));
      }
      setLoading(false);
    };
    setLoading(true);
    connection
      .getAccountInfo(account, 'confirmed')
      .then(apply)
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setLoading(false);
        }
      });
    const subId = connection.onAccountChange(
      account,
      (info) => apply(info),
      'confirmed'
    );
    return () => {
      cancelled = true;
      connection.removeAccountChangeListener(subId).catch((e) => {
        console.warn('[useAccountData] removeAccountChangeListener', e);
      });
    };
  }, [connection, account?.toBase58()]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, raw, error, loading };
}

export function useProgramAccounts<T>(
  programId: PublicKey | null | undefined,
  config: GetProgramAccountsConfig | undefined,
  decode: (account: PublicKey, data: Uint8Array) => T | null,
): { entries: T[]; error: Error | null; loading: boolean } {
  const { connection } = useConnection();
  const [entries, setEntries] = useState<Map<string, T>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const decodeRef = useRef(decode);
  decodeRef.current = decode;

  // Stringify so the effect only re-runs when the semantic filter set changes.
  const filterKey = JSON.stringify(config?.filters ?? []);
  const programKey = programId?.toBase58() ?? '';

  useEffect(() => {
    if (!programId) {
      setEntries(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;

    const upsert = (account: PublicKey, data: Uint8Array | null) => {
      if (cancelled) return;
      const key = account.toBase58();
      let decoded: T | null = null;
      try {
        decoded = data ? decodeRef.current(account, data) : null;
      } catch (e) {
        console.warn('[useProgramAccounts] decode', key, e);
        decoded = null;
      }
      setEntries((prev) => {
        const next = new Map(prev);
        if (decoded === null) next.delete(key);
        else next.set(key, decoded);
        return next;
      });
    };

    setLoading(true);
    connection
      .getProgramAccounts(programId, {
        commitment: 'confirmed',
        ...(config ?? {}),
      })
      .then((accounts) => {
        if (cancelled) return;
        const next = new Map<string, T>();
        for (const a of accounts) {
          try {
            const d = decodeRef.current(a.pubkey, a.account.data);
            if (d !== null) next.set(a.pubkey.toBase58(), d);
          } catch (e) {
            console.warn('[useProgramAccounts] initial decode', a.pubkey.toBase58(), e);
          }
        }
        setEntries(next);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setLoading(false);
        }
      });

    let subId: number | null = null;
    try {
      subId = connection.onProgramAccountChange(
        programId,
        (kAcc) => upsert(kAcc.accountId, kAcc.accountInfo.data),
        { commitment: 'confirmed', ...(config?.filters ? { filters: config.filters } : {}) }
      );
    } catch (e) {
      // Some RPC providers reject programSubscribe — fall back to the one-shot snapshot.
      console.warn('[useProgramAccounts] onProgramAccountChange failed', e);
    }

    return () => {
      cancelled = true;
      if (subId !== null) {
        connection.removeProgramAccountChangeListener(subId).catch((e) => {
          console.warn('[useProgramAccounts] removeProgramAccountChangeListener', e);
        });
      }
    };
  }, [connection, programKey, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoise: Array.from(map.values()) returns a fresh ref each render and would
  // re-trigger every consuming useEffect([entries]).
  const entriesArr = useMemo(() => Array.from(entries.values()), [entries]);
  return { entries: entriesArr, error, loading };
}

// onSlotChange fires on every processed slot — throttle to keep React renders cheap.
export function useSlot(throttleMs = 800): number | null {
  const { connection } = useConnection();
  const [slot, setSlot] = useState<number | null>(null);

  useEffect(() => {
    let last = 0;
    let cancelled = false;

    connection
      .getSlot('confirmed')
      .then((s) => {
        if (!cancelled) setSlot(s);
      })
      .catch(() => {});

    const subId = connection.onSlotChange((info) => {
      const now = Date.now();
      if (now - last < throttleMs) return;
      last = now;
      setSlot(info.slot);
    });
    return () => {
      cancelled = true;
      connection.removeSlotChangeListener(subId).catch((e) => {
        console.warn('[useSlot] removeSlotChangeListener', e);
      });
    };
  }, [connection, throttleMs]);

  return slot;
}

// SPL Token account amount: offset 64, u64 LE.
export function decodeSplTokenAmount(data: Uint8Array): bigint {
  if (data.length < 72) return 0n;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(64, true);
}

export type RawConnection = Connection;
