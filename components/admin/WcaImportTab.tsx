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

// Events we care about (skip retired/special ones)
const ACTIVE_EVENTS = new Set([
  '333','222','444','555','666','777',
  '333bf','333oh','333fm',
  'clock','minx','pyram','skewb','sq1',
  '444bf','555bf','333mbf',
]);

type RecordLevel = 'WR' | 'CR' | 'NR';
type RecordTab = 'WR' | 'CR' | 'NR';

interface RecordRow {
  eventId: string;
  eventName: string;
  singleCs: number | null;  // centiseconds from API
  averageCs: number | null;
}

interface ClubBest {
  single: number | null;  // centiseconds (from our results)
  average: number | null;
  singleAthlete: string;
  averageAthlete: string;
}

export default function WcaImportTab() {
  const [wcaData, setWcaData] = useState<Record<RecordLevel, RecordRow[]>>({ WR: [], CR: [], NR: [] });
  const [fetching, setFetching] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<RecordTab>('WR');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');

  // Club data
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

  // Club best per event (only club athletes)
  const clubBests = useMemo(() => {
    const m: Record<string, ClubBest> = {};
    clubResults.forEach(r => {
      if (!clubAthleteIds.has(r.athleteId)) return;
      if (!m[r.eventId]) m[r.eventId] = { single: null, average: null, singleAthlete: '', averageAthlete: '' };
      const e = m[r.eventId];
      if (r.single != null && r.single > 0 && (e.single === null || r.single < e.single)) {
        e.single = r.single;
        e.singleAthlete = athleteNameMap[r.athleteId] || r.athleteName || r.athleteId;
      }
      if (r.average != null && r.average > 0 && (e.average === null || r.average < e.average)) {
        e.average = r.average;
        e.averageAthlete = athleteNameMap[r.athleteId] || r.athleteName || r.athleteId;
      }
    });
    return m;
  }, [clubResults, clubAthleteIds, athleteNameMap]);

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
    if (wcaData.WR.length === 0) { showMsg('warn', 'Fetch records first.'); return; }
    setSaving(true);
    try {
      // Build per-event documents matching existing WcaRecordDoc shape
      // { single: { WR: { value: seconds }, CR: { value }, NR: { value } }, average: { ... } }
      const eventMap: Record<string, {
        single?: Record<string, { value: number }>;
        average?: Record<string, { value: number }>;
      }> = {};

      function addRecord(level: RecordLevel, rows: RecordRow[]) {
        rows.forEach(row => {
          if (!eventMap[row.eventId]) eventMap[row.eventId] = {};
          if (row.singleCs != null) {
            if (!eventMap[row.eventId].single) eventMap[row.eventId].single = {};
            eventMap[row.eventId].single![level] = { value: row.singleCs / 100 }; // convert to seconds
          }
          if (row.averageCs != null) {
            if (!eventMap[row.eventId].average) eventMap[row.eventId].average = {};
            eventMap[row.eventId].average![level] = { value: row.averageCs / 100 };
          }
        });
      }

      addRecord('WR', wcaData.WR);
      addRecord('CR', wcaData.CR);
      addRecord('NR', wcaData.NR);

      // Write each event document
      let count = 0;
      for (const [eventId, data] of Object.entries(eventMap)) {
        await setDoc(doc(db, COL.WCA_RECORDS, eventId), {
          ...data,
          fetchedAt: Timestamp.now(),
        });
        count++;
      }
      showMsg('success', `Saved records for ${count} events to Firebase`);
    } catch (err) {
      showMsg('error', `Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setSaving(false);
  }

  // Auto-fetch on mount
  useEffect(() => { fetchRecords(); }, []);

  const activeRows = wcaData[tab];

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

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />WCA Records</div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button className="btn-sm-primary" onClick={fetchRecords} disabled={fetching}>
          {fetching ? 'Fetching…' : 'Refresh Records'}
        </button>
        <button className="btn-sm-primary" onClick={saveToFirebase} disabled={saving || wcaData.WR.length === 0}
          style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' }}>
          {saving ? 'Saving…' : 'Save to Firebase'}
        </button>
        {lastFetched && (
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
            Last updated: {lastFetched.toLocaleTimeString()}
          </span>
        )}
      </div>

      {msg && <div className={`msg ${msgType}`} style={{ display: 'block', marginBottom: '0.8rem' }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '1rem' }}>
        {([
          { key: 'WR' as RecordTab, label: '🌍 World Records' },
          { key: 'CR' as RecordTab, label: '🌏 Asian Records' },
          { key: 'NR' as RecordTab, label: '🇲🇳 Mongolia Records' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={tab === t.key ? 'btn-sm-primary' : 'btn-sm-outline'}
            style={tab === t.key ? {} : {
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit',
              padding: '0.3rem 0.8rem', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Records Table */}
      {activeRows.length === 0 ? (
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
              {activeRows.map(row => {
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
                      {cb?.single != null ? (
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: sIsRecord ? '#4ade80' : '#a78bfa' }}>
                          {fmtTime(cb.single)}
                        </span>
                      ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      {cb?.singleAthlete && <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{cb.singleAthlete}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {cb?.average != null ? (
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: aIsRecord ? '#4ade80' : '#a78bfa' }}>
                          {fmtTime(cb.average)}
                        </span>
                      ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      {cb?.averageAthlete && <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{cb.averageAthlete}</div>}
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
      )}
    </div>
  );
}
