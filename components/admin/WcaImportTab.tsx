'use client';

import { useState, useEffect, useMemo } from 'react';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/firebase/collections';
import { getAllResults } from '@/lib/firebase/services/results';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import type { Athlete, Result } from '@/lib/types';

const ACTIVE_EVENTS = new Set([
  '333','222','444','555','666','777',
  '333bf','333oh','333fm',
  'clock','minx','pyram','skewb','sq1',
  '444bf','555bf','333mbf',
]);

type RecordLevel = 'WR' | 'CR' | 'NR';
type TabKey = 'WR' | 'CR' | 'NR' | 'TR';

interface RecordRow {
  eventId: string;
  eventName: string;
  singleCs: number | null;
  averageCs: number | null;
}

interface ClubBest {
  single: number | null;
  average: number | null;
  singleAthlete: string;
  singleAthleteId: string;
  averageAthlete: string;
  averageAthleteId: string;
}

export default function WcaImportTab() {
  const [wcaData, setWcaData] = useState<Record<RecordLevel, RecordRow[]>>({ WR: [], CR: [], NR: [] });
  const [fetching, setFetching] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>('WR');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');

  const [clubResults, setClubResults] = useState<Result[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);

  useEffect(() => {
    getAllResults().then(all => setClubResults(all.filter(r => r.status === 'published' && r.source !== 'imported' && r.source !== 'import')));
    getAthletes().then(setAthletes);
  }, []);

  const athleteNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    athletes.forEach(a => { m[a.id] = (a.name || '') + (a.lastName ? ' ' + a.lastName : ''); });
    return m;
  }, [athletes]);

  const clubAthleteIds = useMemo(() => new Set(athletes.map(a => a.id)), [athletes]);

  // Club best (TR) per event
  const clubBests = useMemo(() => {
    const m: Record<string, ClubBest> = {};
    clubResults.forEach(r => {
      if (!clubAthleteIds.has(r.athleteId)) return;
      if (!m[r.eventId]) m[r.eventId] = { single: null, average: null, singleAthlete: '', singleAthleteId: '', averageAthlete: '', averageAthleteId: '' };
      const e = m[r.eventId];
      if (r.single != null && r.single > 0 && (e.single === null || r.single < e.single)) {
        e.single = r.single;
        e.singleAthlete = athleteNameMap[r.athleteId] || r.athleteName || r.athleteId;
        e.singleAthleteId = r.athleteId;
      }
      if (r.average != null && r.average > 0 && (e.average === null || r.average < e.average)) {
        e.average = r.average;
        e.averageAthlete = athleteNameMap[r.athleteId] || r.athleteName || r.athleteId;
        e.averageAthleteId = r.athleteId;
      }
    });
    return m;
  }, [clubResults, clubAthleteIds, athleteNameMap]);

  // TR rows for the Club Records tab
  const trRows = useMemo(() => {
    return WCA_EVENTS
      .filter(e => ACTIVE_EVENTS.has(e.id) && clubBests[e.id])
      .map(e => ({ eventId: e.id, eventName: e.name, best: clubBests[e.id] }));
  }, [clubBests]);

  function showMsg(type: string, text: string) {
    setMsgType(type); setMsg(text);
    setTimeout(() => setMsg(''), 6000);
  }

  function parseApiRecords(data: Record<string, { single?: number; average?: number }>): RecordRow[] {
    return WCA_EVENTS
      .filter(e => ACTIVE_EVENTS.has(e.id) && data[e.id])
      .map(e => ({
        eventId: e.id,
        eventName: e.name,
        singleCs: data[e.id]?.single ?? null,
        averageCs: data[e.id]?.average ?? null,
      }));
  }

  async function fetchRecords() {
    setFetching(true);
    try {
      const res = await fetch('https://api.worldcubeassociation.org/records');
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();
      const wr = parseApiRecords(json.world_records || {});
      const cr = parseApiRecords((json.continental_records || {})['_Asia'] || {});
      const nr = parseApiRecords((json.national_records || {})['Mongolia'] || {});
      setWcaData({ WR: wr, CR: cr, NR: nr });
      setLastFetched(new Date());
      showMsg('success', `Fetched ${wr.length} WR, ${cr.length} CR, ${nr.length} NR events`);
    } catch (err) {
      showMsg('error', `Fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setFetching(false);
  }

  async function saveToFirebase() {
    if (wcaData.WR.length === 0 && trRows.length === 0) { showMsg('warn', 'No data to save.'); return; }
    setSaving(true);
    try {
      // Build per-event documents: { single: { WR: {value}, CR: {value}, NR: {value} }, average: {...} }
      const eventMap: Record<string, Record<string, Record<string, { value: number }>>> = {};

      function addWcaRecord(level: RecordLevel, rows: RecordRow[]) {
        rows.forEach(row => {
          if (!eventMap[row.eventId]) eventMap[row.eventId] = {};
          if (row.singleCs != null) {
            if (!eventMap[row.eventId].single) eventMap[row.eventId].single = {};
            eventMap[row.eventId].single[level] = { value: row.singleCs / 100 };
          }
          if (row.averageCs != null) {
            if (!eventMap[row.eventId].average) eventMap[row.eventId].average = {};
            eventMap[row.eventId].average[level] = { value: row.averageCs / 100 };
          }
        });
      }

      addWcaRecord('WR', wcaData.WR);
      addWcaRecord('CR', wcaData.CR);
      addWcaRecord('NR', wcaData.NR);

      // Add TR records from club bests
      Object.entries(clubBests).forEach(([eventId, cb]) => {
        if (!eventMap[eventId]) eventMap[eventId] = {};
        if (cb.single != null) {
          if (!eventMap[eventId].single) eventMap[eventId].single = {};
          eventMap[eventId].single['TR'] = { value: cb.single / 100 };
        }
        if (cb.average != null) {
          if (!eventMap[eventId].average) eventMap[eventId].average = {};
          eventMap[eventId].average['TR'] = { value: cb.average / 100 };
        }
      });

      let count = 0;
      for (const [eventId, data] of Object.entries(eventMap)) {
        await setDoc(doc(db, COL.WCA_RECORDS, eventId), {
          ...data,
          fetchedAt: Timestamp.now(),
        });
        count++;
      }
      showMsg('success', `Saved records for ${count} events (WR+CR+NR+TR) to Firebase`);
    } catch (err) {
      showMsg('error', `Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setSaving(false);
  }

  useEffect(() => { fetchRecords(); }, []);

  function gapStr(recordCs: number | null, clubCs: number | null): string {
    if (recordCs === null || clubCs === null) return '—';
    if (clubCs <= recordCs) return '🏆 Record holder!';
    const diff = (clubCs - recordCs) / 100;
    return `+${diff.toFixed(2)}s`;
  }

  function isClose(recordCs: number | null, clubCs: number | null): boolean {
    if (recordCs === null || clubCs === null) return false;
    return clubCs <= recordCs * 1.1;
  }

  // Shared cell renderer for time + optional name below
  function TimeCell({ time, name, highlight }: { time: number | null; name?: string; highlight?: string }) {
    if (time == null) return <span style={{ color: 'var(--muted)' }}>—</span>;
    return (
      <div>
        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: highlight || '#a78bfa' }}>{fmtTime(time)}</span>
        {name && <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.1rem' }}>{name}</div>}
      </div>
    );
  }

  const activeWcaRows = tab !== 'TR' ? wcaData[tab as RecordLevel] : [];

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />WCA Records</div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button className="btn-sm-primary" onClick={fetchRecords} disabled={fetching}>
          {fetching ? 'Fetching…' : 'Refresh Records'}
        </button>
        <button className="btn-sm-primary" onClick={saveToFirebase} disabled={saving || (wcaData.WR.length === 0 && trRows.length === 0)}
          style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' }}>
          {saving ? 'Saving…' : 'Save All to Firebase'}
        </button>
        {lastFetched && (
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
            Last updated: {lastFetched.toLocaleTimeString()}
          </span>
        )}
      </div>

      {msg && <div className={`msg ${msgType}`} style={{ display: 'block', marginBottom: '0.8rem' }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {([
          { key: 'WR' as TabKey, label: '🌍 World Records' },
          { key: 'CR' as TabKey, label: '🌏 Asian Records' },
          { key: 'NR' as TabKey, label: '🇲🇳 Mongolia Records' },
          { key: 'TR' as TabKey, label: '🏠 Club Records (TR)' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={tab === t.key
              ? undefined
              : { background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit', padding: '0.3rem 0.8rem', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600 }
            }
            className={tab === t.key ? 'btn-sm-primary' : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TR Tab ──────────────────────────────────────────────── */}
      {tab === 'TR' && (
        trRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontSize: '0.88rem' }}>
            No club results yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th style={{ textAlign: 'right' }}>TR Single</th>
                  <th style={{ textAlign: 'right' }}>Holder</th>
                  <th style={{ textAlign: 'right' }}>TR Average</th>
                  <th style={{ textAlign: 'right' }}>Holder</th>
                </tr>
              </thead>
              <tbody>
                {trRows.map(row => (
                  <tr key={row.eventId}>
                    <td style={{ fontWeight: 600 }}>{row.eventName}</td>
                    <td style={{ textAlign: 'right' }}>
                      <TimeCell time={row.best.single} highlight="#a78bfa" />
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {row.best.singleAthlete || '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <TimeCell time={row.best.average} highlight="#a78bfa" />
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {row.best.averageAthlete || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── WR / CR / NR Tabs ──────────────────────────────────── */}
      {tab !== 'TR' && (
        activeWcaRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontSize: '0.88rem' }}>
            {fetching ? 'Loading records…' : 'No records loaded. Click "Refresh Records" to fetch.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th style={{ textAlign: 'right' }}>Single {tab}</th>
                  <th style={{ textAlign: 'right' }}>Average {tab}</th>
                  <th style={{ textAlign: 'right' }}>Our Best Single</th>
                  <th style={{ textAlign: 'right' }}>Our Best Avg</th>
                  <th style={{ textAlign: 'right' }}>Single Gap</th>
                  <th style={{ textAlign: 'right' }}>Avg Gap</th>
                </tr>
              </thead>
              <tbody>
                {activeWcaRows.map(row => {
                  const cb = clubBests[row.eventId];
                  const sClose = isClose(row.singleCs, cb?.single ?? null);
                  const aClose = isClose(row.averageCs, cb?.average ?? null);
                  const sGap = gapStr(row.singleCs, cb?.single ?? null);
                  const aGap = gapStr(row.averageCs, cb?.average ?? null);
                  const sIsRecord = cb?.single != null && row.singleCs != null && cb.single <= row.singleCs;
                  const aIsRecord = cb?.average != null && row.averageCs != null && cb.average <= row.averageCs;
                  return (
                    <tr key={row.eventId} style={(sClose || aClose) ? { background: 'rgba(124,58,237,0.06)' } : undefined}>
                      <td style={{ fontWeight: 600 }}>{row.eventName}</td>
                      <td className="time-val" style={{ textAlign: 'right' }}>{row.singleCs != null ? fmtTime(row.singleCs) : '—'}</td>
                      <td className="time-val" style={{ textAlign: 'right' }}>{row.averageCs != null ? fmtTime(row.averageCs) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <TimeCell time={cb?.single ?? null} name={cb?.singleAthlete} highlight={sIsRecord ? '#4ade80' : '#a78bfa'} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <TimeCell time={cb?.average ?? null} name={cb?.averageAthlete} highlight={aIsRecord ? '#4ade80' : '#a78bfa'} />
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: sIsRecord ? '#4ade80' : sClose ? '#fbbf24' : 'var(--muted)' }}>
                        {sGap}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: aIsRecord ? '#4ade80' : aClose ? '#fbbf24' : 'var(--muted)' }}>
                        {aGap}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
