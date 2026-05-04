import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

export type RedactedProps = {
  children: ReactNode;
  segments?: number | 'auto';
  width?: string | number;
  hoverable?: boolean;
  sealed?: boolean;
  style?: CSSProperties;
};

/**
 * Segmented redaction bar — the protocol's signature visual element.
 * On hover (when not sealed) wipes briefly to reveal the underlying text,
 * then re-redacts after 1.4s.
 */
export default function Redacted({
  children,
  segments = 3,
  width,
  hoverable = true,
  sealed = false,
  style = {},
}: RedactedProps) {
  const [revealed, setRevealed] = useState(false);
  const text = String(children ?? '');

  const segs = useMemo<number | string[]>(() => {
    if (segments === 'auto') {
      const parts = text.split(/(\s+)/).filter((p) => p.trim().length);
      if (parts.length > 1) return parts;
      return Math.max(2, Math.min(5, Math.ceil(text.length / 6)));
    }
    return segments;
  }, [text, segments]);

  const segCount = Array.isArray(segs) ? segs.length : (segs as number);

  useEffect(() => {
    if (!revealed || sealed) return;
    const t = setTimeout(() => setRevealed(false), 1400);
    return () => clearTimeout(t);
  }, [revealed, sealed]);

  const styleWithCount = { ...style, ['--seg-count' as string]: segCount, width } as CSSProperties;

  return (
    <span
      className={`redacted ${revealed ? 'is-revealed' : ''} ${sealed ? 'is-sealed' : ''}`}
      onMouseEnter={() => hoverable && !sealed && setRevealed(true)}
      style={styleWithCount}
    >
      <span className="redacted__text">{children}</span>
      <span className="redacted__bars" aria-hidden="true">
        {Array.isArray(segs)
          ? segs.map((p, i) => (
              <span
                key={i}
                className="redacted__bar"
                style={{ flexGrow: (p as string).length || 1 }}
              />
            ))
          : Array.from({ length: segs as number }).map((_, i) => (
              <span key={i} className="redacted__bar" />
            ))}
      </span>
    </span>
  );
}
