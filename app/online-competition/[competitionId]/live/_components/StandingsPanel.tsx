'use client';

import type { CSSProperties } from 'react';
import { isAveragingFormat } from '@/lib/online-competition/ao5';
import type { LiveEventView, RoundRef, StandingRow } from '@/lib/online-competition/live-view';
import { EventGlyph, HEAD, MONO, fmtResult, panelLabelStyle, panelStyle } from './ui';

/** The round a standings event tab opens on: its latest opened round, else
 *  its first. */
function openingRound(event: LiveEventView): number {
  const opened = event.rounds.filter((r) => r.status !== 'closed');
  return (opened[opened.length - 1] ?? event.rounds[0])?.round ?? 1;
}

function resultText(row: StandingRow): string {
  if (!row.hasResult || row.cutOff) return '—';
  return row.value === null ? 'DNF' : fmtResult(row.value);
}

/** Judged results for one event+round, ranked. Everything on it comes
 *  from rankJudgedStandings: approved attempts as times, a judge's DNF as
 *  DNF, and nothing still pending. */
export default function StandingsPanel({
  events,
  target,
  onTarget,
  onRefresh,
  refreshing,
}: {
  events: LiveEventView[];
  target: RoundRef;
  onTarget: (ref: RoundRef) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const event = events.find((e) => e.eventId === target.eventId) ?? events[0];
  if (!event) return null;
  const round = event.rounds.find((r) => r.round === target.round) ?? event.rounds[0];
  const n = event.attempts;
  // The column count travels as a custom property: the grid template has
  // to live in theme.css, where the phone breakpoint can rewrite it.
  const gridVars = { '--oc-live-n': n } as CSSProperties;

  return (
    <section style={panelStyle}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid #1C1C21',
        }}
      >
        <span style={panelLabelStyle}>ШУУД ҮЗҮҮЛЭЛТ</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ font: `400 9px/1 ${MONO}`, color: '#6E6A62' }}>ЗӨВХӨН ШҮҮГДСЭН ДҮН</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            style={{
              border: '1px solid #2A2A31',
              background: 'transparent',
              color: '#9A958A',
              padding: '6px 9px',
              cursor: refreshing ? 'default' : 'pointer',
              font: `600 9px/1 ${MONO}`,
              letterSpacing: '.1em',
              whiteSpace: 'nowrap',
            }}
          >
            {refreshing ? '...' : 'ШИНЭЧЛЭХ'}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          padding: '13px 18px',
          borderBottom: '1px solid #1C1C21',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {events.map((e) => {
            const on = e.eventId === event.eventId;
            return (
              <button
                key={e.eventId}
                type="button"
                title={e.label}
                aria-label={e.label}
                aria-pressed={on}
                onClick={() => onTarget({ eventId: e.eventId, round: openingRound(e) })}
                style={{
                  width: 34,
                  height: 34,
                  padding: 0,
                  border: `1px solid ${on ? '#DFFF4F' : '#2A2A31'}`,
                  background: on ? '#DFFF4F' : 'transparent',
                  color: on ? '#08080A' : '#9A958A',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <EventGlyph eventId={e.eventId} size={18} color="currentColor" />
              </button>
            );
          })}
        </div>
        <span aria-hidden style={{ width: 1, height: 20, background: '#1C1C21' }} />
        <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {event.rounds.map((r) => {
            const on = r.round === round.round;
            return (
              <button
                key={r.round}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onTarget({ eventId: event.eventId, round: r.round })}
                style={{
                  border: `1px solid ${on ? '#DFFF4F' : '#2A2A31'}`,
                  background: on ? '#16161B' : 'transparent',
                  color: on ? '#F4F1EA' : '#9A958A',
                  padding: '8px 11px',
                  cursor: 'pointer',
                  font: `500 10px/1 ${MONO}`,
                  letterSpacing: '.08em',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="oc-live-st-grid"
        style={{
          ...gridVars,
          borderBottom: '1px solid #1C1C21',
          font: `500 8px/1 ${MONO}`,
          letterSpacing: '.1em',
          color: '#6E6A62',
        }}
      >
        <span>#</span>
        <span>НЭР</span>
        <span className="oc-live-st-solves oc-live-st-headsolves">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} style={{ textAlign: 'center' }}>
              {i + 1}
            </span>
          ))}
        </span>
        <span className="oc-live-st-gap" />
        <span style={{ textAlign: 'center', color: '#A8B96A' }}>{isAveragingFormat(event.format) ? 'ДУНДАЖ' : 'ДҮН'}</span>
        <span style={{ textAlign: 'center' }}>СИНГЛЭ</span>
      </div>

      {round.standings.length === 0 ? (
        <Empty closed={round.status === 'closed'} />
      ) : (
        round.standings.map((row, i) => (
          <div
            key={`${row.rank}-${row.name}-${i}`}
            className={`oc-live-st-grid oc-live-st-row${row.isMe ? ' oc-live-st-me' : ''}`}
            style={{ ...gridVars, borderBottom: '1px solid #16161B' }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                background: '#16161B',
                color: '#9A958A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                font: `700 10px/1 ${MONO}`,
              }}
            >
              {row.rank}
            </span>
            <span
              style={{
                font: `500 13px/1.2 ${HEAD}`,
                color: row.isMe ? '#DFFF4F' : '#F4F1EA',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.name}
            </span>
            <span className="oc-live-st-solves">
              {row.cells.map((c, j) => (
                <span
                  key={j}
                  style={{
                    textAlign: 'center',
                    font: `500 11px/1 ${MONO}`,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    color: c === null ? '#6E6A62' : c === 'DNF' ? '#E8543C' : row.excluded.includes(j) ? '#6E6A62' : '#F4F1EA',
                  }}
                >
                  {fmtResult(c)}
                </span>
              ))}
            </span>
            <span className="oc-live-st-gap" />
            <span
              style={{
                textAlign: 'center',
                padding: '6px 0',
                background: '#16180F',
                border: '1px solid #3A4614',
                font: `700 14px/1 ${MONO}`,
                fontVariantNumeric: 'tabular-nums',
                color: '#DFFF4F',
                whiteSpace: 'nowrap',
              }}
            >
              {resultText(row)}
            </span>
            <span
              style={{
                textAlign: 'center',
                padding: '6px 0',
                background: '#141418',
                border: '1px solid #1C1C21',
                font: `600 12px/1 ${MONO}`,
                fontVariantNumeric: 'tabular-nums',
                color: '#F4F1EA',
                whiteSpace: 'nowrap',
              }}
            >
              {fmtResult(row.best)}
            </span>
          </div>
        ))
      )}
    </section>
  );
}

function Empty({ closed }: { closed: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 13,
        padding: '56px 20px',
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 11px)',
          gridTemplateRows: 'repeat(3, 11px)',
          gap: 3,
          opacity: 0.3,
        }}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={{ border: '1px solid #6E6A62' }} />
        ))}
      </div>
      <span style={{ font: `500 14px/1 ${HEAD}`, color: '#6E6A62' }}>Шүүгдсэн дүн алга.</span>
      <span style={{ font: `400 11px/1.5 ${HEAD}`, color: '#4A4740', maxWidth: 300 }}>
        {closed ? 'Энэ раунд хараахан нээгдээгүй.' : 'Шүүгч шийдвэрлэсэн оролдлого л энд харагдана.'}
      </span>
    </div>
  );
}
