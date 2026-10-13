'use client';

import { useState } from 'react';
import { saveStagedImport, syncStagedEvent } from '@/lib/firebase/services/staged-results';
import { parseWcaResults, type ParsedResultRound } from '@/lib/results-import';
import { matchClubAthlete, stagedRoundStatus, type StagedEvent } from '@/lib/staged-reveal';
import { WCA_EVENTS } from '@/lib/wca-events';
import WcaResultChip from '@/components/shared/WcaResultChip';
import { useLang } from '@/lib/i18n';
import type { Athlete, Competition } from '@/lib/types';

/**
 * "Import External Results" → staged mode: paste every round of an event
 * from the WCA results page, store the rows admin-only, and let them be
 * revealed gradually as club athletes finish each round (the rules are in
 * lib/staged-reveal.ts). Also shows each staged round's progress and the
 * manual "reveal all now" override.
 *
 * `stagedEvents` comes from ResultsEntryTab's subscription, which it also
 * uses to decide whether a saved club result needs a reveal pass.
 */
export default function StagedImportPanel({ comp, athletes, stagedEvents }: {
  comp: Competition;
  athletes: Athlete[];
  stagedEvents: Record<string, StagedEvent>;
}) {
  const { t } = useLang();
  const [text, setText]       = useState('');
  const [parsed, setParsed]   = useState<{ rounds: ParsedResultRound[]; warnings: string[] } | null>(null);
  const [msg, setMsg]         = useState('');
  const [msgType, setMsgType] = useState('');
  const [busy, setBusy]       = useState(false);

  // Club athletes registered for this competition — the pool imported names
  // are matched against (same pool saveStagedImport uses).
  const compAthleteIds = new Set((comp.athletes || []).map(a => a.id));
  const clubAthletes = athletes.filter(a => compAthleteIds.has(a.id));

  function roundLabel(eventId: string, roundId: string): string {
    const total = comp.eventConfig?.[eventId]?.rounds ?? 1;
    const n = Number(roundId);
    if (n > total) return `${t('admin.round.generic')} ${n}`;
    if (n === total) return t('admin.round.final');
    if (n === 1) return t('admin.round.first');
    return n === 2 ? t('admin.round.second') : t('admin.round.semi');
  }
  const eventShort = (eventId: string) => WCA_EVENTS.find(ev => ev.id === eventId)?.short ?? eventId;

  function parse() {
    // Only the events this competition runs — their round count decides
    // which round number "Final" means.
    const activeConfig: Record<string, { rounds: number }> = {};
    WCA_EVENTS.forEach(ev => {
      if ((comp.events as Record<string, boolean> | undefined)?.[ev.id]) {
        activeConfig[ev.id] = { rounds: comp.eventConfig?.[ev.id]?.rounds ?? 1 };
      }
    });
    const result = parseWcaResults(text, activeConfig);
    setParsed(result);
    if (result.rounds.length === 0 && result.warnings.length === 0) {
      setMsgType('error'); setMsg(t('admin.results.staged.msg.none'));
    } else {
      setMsg('');
    }
  }

  function fail(e: unknown) {
    setMsgType('error');
    setMsg(t('admin.msg.error-prefix') + (e instanceof Error ? e.message : String(e)));
  }

  async function save() {
    const rounds = parsed?.rounds ?? [];
    if (rounds.length === 0) return;
    setBusy(true);
    try {
      let revealedNow = 0;
      // One private document per event, so one save per event in the paste.
      for (const eventId of [...new Set(rounds.map(r => r.eventId))]) {
        const outcome = await saveStagedImport(comp, eventId, rounds.filter(r => r.eventId === eventId), athletes);
        revealedNow += outcome.revealed;
      }
      setText(''); setParsed(null);
      setMsgType('success');
      setMsg(t('admin.results.staged.msg.saved') + (revealedNow > 0 ? ` ${revealedNow} ${t('admin.results.staged.msg.revealed-now')}.` : ''));
    } catch (e: unknown) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function revealAll(eventId: string, round: number) {
    setBusy(true);
    try {
      const outcome = await syncStagedEvent(comp.id, eventId, [round]);
      setMsgType('success');
      setMsg(`${eventShort(eventId)} · ${roundLabel(eventId, String(round))}: ${outcome.revealed} ${t('admin.results.staged.msg.revealed-now')}.`);
    } catch (e: unknown) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const stagedRounds = WCA_EVENTS.flatMap(ev =>
    Object.entries(stagedEvents[ev.id]?.rounds || {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([roundId, rows]) => ({ eventId: ev.id, roundId, ...stagedRoundStatus(rows) })),
  );

  const actionBtn = (enabled: boolean): React.CSSProperties => ({
    padding: '0.5rem 1.2rem', borderRadius: '8px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600,
    background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.45)',
    color: enabled ? '#a78bfa' : 'rgba(167,139,250,0.4)',
  });

  return (
    <div>
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.6rem', lineHeight: 1.5 }}>
        {t('admin.results.staged.help')}
      </div>

      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setParsed(null); }}
        rows={6}
        placeholder={t('admin.results.staged.placeholder')}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          padding: '0.65rem 0.75rem', borderRadius: '8px',
          fontSize: '0.82rem', fontFamily: 'monospace', lineHeight: 1.5,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'var(--text)', outline: 'none', marginBottom: '0.5rem',
        }}
      />
      <button onClick={parse} disabled={!text.trim() || busy} style={actionBtn(!!text.trim() && !busy)}>
        {t('admin.results.staged.parse')}
      </button>

      {/* Preview */}
      {parsed && (parsed.rounds.length > 0 || parsed.warnings.length > 0) && (
        <div style={{
          marginTop: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)',
        }}>
          {parsed.rounds.length > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.3rem', opacity: 0.7 }}>
              {t('admin.comp.scrambles.preview')}
            </div>
          )}
          {parsed.rounds.map(r => {
            const matched = r.rows.filter(row => matchClubAthlete(row, clubAthletes));
            return (
              <div key={`${r.eventId}-${r.roundId}`} style={{ marginBottom: '0.4rem' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.6 }}>
                  {eventShort(r.eventId)} · {roundLabel(r.eventId, r.roundId)} · {r.rows.length} {t('admin.results.staged.rows-suffix')}
                </div>
                {matched.length > 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.7 }}>
                    {t('admin.results.staged.matched')}{' '}
                    {matched.map((row, i) => (
                      <span key={i} style={{ color: 'var(--text)', marginRight: '0.6rem', whiteSpace: 'nowrap' }}>
                        {row.name}{row.localName ? ` (${row.localName})` : ''}
                        <WcaResultChip result={{ source: 'imported', matchedClubAthleteId: 'preview' }} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {parsed.warnings.length > 0 && (
            <div style={{ marginTop: parsed.rounds.length > 0 ? '0.5rem' : 0, maxHeight: '12rem', overflowY: 'auto' }}>
              <div style={{ fontSize: '0.7rem', color: '#fbbf24', marginBottom: '0.2rem' }}>
                ⚠️ {t('admin.comp.scrambles.warnings')} ({parsed.warnings.length})
              </div>
              {parsed.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: '0.78rem', color: '#fbbf24', lineHeight: 1.5 }}>{w}</div>
              ))}
            </div>
          )}
          {parsed.rounds.length > 0 && (
            <button onClick={save} disabled={busy} style={{ ...actionBtn(!busy), marginTop: '0.6rem' }}>
              {t('admin.btn.save')}
            </button>
          )}
        </div>
      )}

      {msg && <div className={`msg ${msgType}`} style={{ display: 'block', marginTop: '0.75rem' }}>{msg}</div>}

      {/* Status per staged event/round */}
      <div style={{ marginTop: '1rem' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
          {t('admin.results.staged.status-title')}
        </div>
        {stagedRounds.length === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>{t('admin.results.staged.none')}</div>
        )}
        {stagedRounds.map(r => {
          const allOut = r.revealed >= r.total;
          return (
            <div key={`${r.eventId}-${r.roundId}`} style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem',
              padding: '0.4rem 0', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.82rem',
            }}>
              <span style={{ color: 'var(--text)', fontWeight: 600, minWidth: '9rem' }}>
                {eventShort(r.eventId)} · {roundLabel(r.eventId, r.roundId)}
              </span>
              <span style={{ color: allOut ? '#4ade80' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                {t('admin.results.staged.revealed')} {r.revealed} / {r.total}
              </span>
              {r.eliminated > 0 && (
                <span style={{ color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>
                  {t('admin.results.staged.eliminated')} {r.eliminated}
                </span>
              )}
              <button
                className="btn-xs"
                disabled={busy || allOut}
                onClick={() => revealAll(r.eventId, Number(r.roundId))}
                style={{ marginLeft: 'auto', opacity: busy || allOut ? 0.4 : 1, cursor: busy || allOut ? 'not-allowed' : 'pointer' }}
              >
                {t('admin.results.staged.reveal-all')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
