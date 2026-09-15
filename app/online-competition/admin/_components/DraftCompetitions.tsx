'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ADMIN_COMPETITIONS, draftRows, type DraftRow } from '@/lib/online-competition/draft-list';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';

// ── Шинэ тэмцээн — зарлагдаагүй тэмцээнүүд ───────────────────────────────
// Competitions not yet announced, each with how far along it is, and the
// way in to create another. Values from design-mockups/Khorom Admin.dc.html
// (the "Шинэ тэмцээн" screen). What counts as unannounced and what the bar
// measures are decided in lib/online-competition/draft-list.ts.
//
// Reads the same admin-competitions list as Тэмцээнүүд; creating and editing
// are the existing editor, reached by link — nothing here writes.
//
// Styles are inline; the properties that change on hover (row background,
// button border and ink) live in theme.css's .oc-adm-draft-* rules instead,
// since an inline value would outrank the :hover rule. Below 640px the same
// classes restack the row.

const MONO = 'var(--oc-font-mono), monospace';
const HEADING = 'var(--oc-font-heading), sans-serif';
const COLUMNS = 'minmax(0,1.6fr) 132px 52px minmax(0,1fr) 110px';

export default function DraftCompetitions() {
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-competitions');
      if (!res.ok) throw new Error(`admin-competitions answered ${res.status}`);
      const data = (await res.json()) as { competitions?: OnlineCompetitionAdminView[] };
      setRows(draftRows(data.competitions ?? []));
    } catch (err) {
      console.error('DraftCompetitions: loading competitions failed:', err);
      setError('Тэмцээнүүдийг ачаалж чадсангүй — энэ нь ноорог байхгүй гэсэн үг биш.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ font: `600 16px/1.2 ${HEADING}`, color: '#F4F1EA' }}>Зарлагдаагүй тэмцээнүүд</span>
          <span style={{ font: `400 10px/1.5 ${MONO}`, letterSpacing: '.1em', color: '#6E6A62' }}>
            НООРОГ · БҮРЭН БАТАЛГААЖААГҮЙ
          </span>
        </div>
        {/* The existing create form, unchanged. */}
        <Link
          href={`${ADMIN_COMPETITIONS}/new`}
          className="oc-adm-draft-new"
          style={{
            border: 'none',
            color: '#08080A',
            padding: '13px 18px',
            font: `700 12px/1 ${HEADING}`,
            letterSpacing: '.04em',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          + Шинэ тэмцээн
        </Link>
      </div>

      {error ? (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <p style={{ font: `500 13px ${HEADING}`, color: '#E8543C' }}>{error}</p>
          <button type="button" className="oc-sc-btn" onClick={load}>
            ДАХИН АЧААЛАХ
          </button>
        </div>
      ) : rows === null ? (
        <p style={{ font: `400 13px ${HEADING}`, color: '#6E6A62' }}>Ачааллаж байна...</p>
      ) : rows.length === 0 ? (
        <div
          style={{
            border: '1px dashed #1C1C21',
            padding: '56px 16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <span style={{ font: `500 13px/1.4 ${HEADING}`, color: '#9A958A' }}>Зарлагдаагүй тэмцээн алга.</span>
          <span style={{ font: `400 12px/1.6 ${HEADING}`, color: '#6E6A62' }}>
            Шинэ тэмцээн үүсгэхэд ноорог болж энд харагдана. Зарласан тэмцээнүүд Тэмцээнүүд хуудсанд байна.
          </span>
        </div>
      ) : (
        <div style={{ border: '1px solid #1C1C21', background: '#0D0D10' }}>
          <div
            className="oc-adm-draft-head"
            style={{
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: 12,
              alignItems: 'center',
              padding: '12px 18px',
              borderBottom: '1px solid #1C1C21',
              font: `500 8px/1 ${MONO}`,
              letterSpacing: '.14em',
              color: '#6E6A62',
            }}
          >
            <span>ТЭМЦЭЭН</span>
            <span>ЭХЛЭХ</span>
            <span>ТӨРӨЛ</span>
            <span>БЭЛЭН БАЙДАЛ</span>
            <span />
          </div>
          {rows.map((d) => (
            <div
              key={d.id}
              className="oc-adm-draft-row"
              style={{
                display: 'grid',
                gridTemplateColumns: COLUMNS,
                gap: 12,
                alignItems: 'center',
                padding: '14px 18px',
                borderBottom: '1px solid #16161B',
              }}
            >
              <div className="oc-adm-draft-name" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                {/* Line-height 1.4: these clip for the ellipsis, and a
                    shorter line box cuts Cyrillic descenders. */}
                <span
                  style={{ font: `500 14px/1.4 ${HEADING}`, color: '#F4F1EA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {d.name}
                </span>
                <span
                  title={d.tag}
                  style={{
                    font: `400 9px/1.4 ${MONO}`,
                    letterSpacing: '.12em',
                    color: d.tagColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d.tag}
                </span>
              </div>
              <span style={{ font: `500 11px/1 ${MONO}`, fontVariantNumeric: 'tabular-nums', color: '#9A958A', whiteSpace: 'nowrap' }}>
                {d.dateLabel}
              </span>
              <span style={{ font: `500 12px/1 ${MONO}`, color: '#9A958A', whiteSpace: 'nowrap' }}>
                {d.eventCount}
                <span className="oc-adm-draft-unit"> төрөл</span>
              </span>
              <div className="oc-adm-draft-bar" style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={d.total}
                  aria-valuenow={d.met}
                  aria-label={d.doneLabel}
                  style={{ height: 3, background: '#1C1C21' }}
                >
                  <div style={{ width: d.pct, height: '100%', background: d.barColor }} />
                </div>
                <span style={{ font: `400 9px/1 ${MONO}`, letterSpacing: '.1em', color: '#6E6A62' }}>{d.doneLabel}</span>
              </div>
              <Link
                href={d.editHref}
                className="oc-adm-draft-open"
                style={{
                  justifySelf: 'end',
                  background: 'transparent',
                  padding: '8px 11px',
                  font: `600 9px/1 ${MONO}`,
                  letterSpacing: '.1em',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                ҮРГЭЛЖЛҮҮЛЭХ
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
