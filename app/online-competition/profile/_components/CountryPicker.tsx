'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES, countryName, flagUrl } from '@/lib/online-competition/countries';

// ── Country picker ───────────────────────────────────────────────────────
// Stores the ISO 3166-1 alpha-2 code (lowercase), never the display name —
// see the header of lib/online-competition/countries.ts. Callers hand in
// and receive a code; the Mongolian name is a render-time lookup, so the
// stored value is stable even if a name is later reworded.
//
// Inline styles throughout: the club site's unlayered
// `* { margin: 0; padding: 0 }` reset outranks Tailwind's layered spacing
// utilities, so class-based padding silently does nothing in this tree.

const FLAG_STYLE: React.CSSProperties = {
  width: 22,
  height: 15,
  border: '1px solid #2A2A31',
  flex: 'none',
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
  backgroundColor: '#0A0A0C',
};

function Flag({ code }: { code: string }) {
  return (
    <span
      aria-hidden
      style={{ ...FLAG_STYLE, backgroundImage: code ? `url(${flagUrl(code)})` : undefined }}
    />
  );
}

export default function CountryPicker({
  value,
  onChange,
  editable,
}: {
  /** ISO alpha-2 code, lowercase. '' when nothing is chosen yet. */
  value: string;
  onChange: (code: string) => void;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(false);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    // A stale filter would greet the next open with a half-empty list.
    setQuery('');
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q));
  }, [query]);

  // Read-only: the same flag + name, with nothing that looks clickable.
  //
  // .oc-v3-value goes on the BLOCK container, not on the inner span. It is
  // the read-only mirror of .oc-v3-input (same padding, same box) and every
  // other read-only field is a <p> carrying it, which fills its grid column
  // naturally. A <span> here is a flex ITEM, so the box shrank to the text
  // and the country cell rendered visibly smaller than its neighbours.
  if (!editable) {
    return (
      <div
        className="oc-v3-value"
        style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}
      >
        {value ? <Flag code={value} /> : null}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? countryName(value) : '—'}
        </span>
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          border: `1px solid ${open || hover ? '#DFFF4F' : '#2A2A31'}`,
          background: '#08080A',
          color: '#F4F1EA',
          // Padding and font deliberately match .oc-v3-input rather than the
          // mockup's 11px/line-height-1: the field has to be the same HEIGHT
          // as ОВОГ / НЭР / ТӨРСӨН ОГНОО beside it. var(--oc-font-heading)
          // rather than the literal 'Geologica' for the reason theme.css
          // records: the literal silently falls back to the system sans on
          // any machine without the font installed; the next/font variable
          // is what makes the self-hosted file apply.
          padding: 12,
          cursor: 'pointer',
          font: '500 13px var(--oc-font-heading), sans-serif',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {value ? <Flag code={value} /> : null}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value ? countryName(value) : 'Улс сонгох'}
          </span>
        </span>
        <span
          aria-hidden
          style={{
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '5px solid #6E6A62',
            flex: 'none',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 30,
            border: '1px solid #2A2A31',
            background: '#0D0D10',
            boxShadow: '0 18px 40px -14px rgba(0,0,0,.9)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder="Улс хайх"
            onChange={(e) => setQuery(e.target.value)}
            style={{
              border: 'none',
              borderBottom: '1px solid #1C1C21',
              background: '#08080A',
              color: '#F4F1EA',
              padding: '12px 13px',
              font: '500 12px var(--oc-font-heading), sans-serif',
              outline: 'none',
            }}
          />

          {matches.length === 0 ? (
            <p style={{ padding: '20px 13px', font: '500 11px var(--oc-font-heading), sans-serif', color: '#6E6A62' }}>
              Улс олдсонгүй.
            </p>
          ) : (
            <div style={{ maxHeight: 232, overflowY: 'auto' }}>
              {matches.map((c) => {
                const selected = c.code === value;
                const hovered = hoverRow === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      onChange(c.code);
                      close();
                    }}
                    onMouseEnter={() => setHoverRow(c.code)}
                    onMouseLeave={() => setHoverRow(null)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      border: 'none',
                      borderBottom: '1px solid #16161B',
                      padding: '11px 13px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      font: '500 12px var(--oc-font-heading), sans-serif',
                      background: selected || hovered ? '#16161B' : 'transparent',
                      color: selected ? '#DFFF4F' : hovered ? '#F4F1EA' : '#9A958A',
                    }}
                  >
                    <Flag code={c.code} />
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
