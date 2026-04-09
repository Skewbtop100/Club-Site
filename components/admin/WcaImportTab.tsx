'use client';

import { useState, useEffect } from 'react';
import { getCompetitions } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { importResult } from '@/lib/firebase/services/results';
import type { Athlete, Competition } from '@/lib/types';
import { fmtTime, parseTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';

interface ImportRow {
  rank: number; wcaId: string; name: string; country: string;
  single: number | null; average: number | null;
  solves: (number | null)[];
  matchedAthleteId: string;
  skip: boolean;
}

function parseWcaLine(line: string): { name: string; country: string; single: number | null; average: number | null; solves: (number | null)[] } | null {
  const parts = line.trim().split(/\s{2,}|\t/);
  if (parts.length < 4) return null;
  try {
    const name = parts[1] || '';
    const country = parts[2] || '';
    const single = parseTime(parts[4] || '') ?? null;
    const average = parseTime(parts[5] || '') ?? null;
    const solves = [6,7,8,9,10].map(i => parseTime(parts[i] || '') ?? null);
    return { name, country, single, average, solves };
  } catch { return null; }
}

export default function WcaImportTab() {
  const [comps, setComps]         = useState<Competition[]>([]);
  const [athletes, setAthletes]   = useState<Athlete[]>([]);
  const [compId, setCompId]       = useState('');
  const [evId, setEvId]           = useState('');
  const [round, setRound]         = useState(1);
  const [rawText, setRawText]     = useState('');
  const [rows, setRows]           = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg]             = useState(''); const [msgType, setMsgType] = useState('');

  useEffect(() => {
    getCompetitions().then(setComps);
    getAthletes().then(setAthletes);
  }, []);

  function showMsg(type: string, text: string) { setMsgType(type); setMsg(text); setTimeout(() => setMsg(''), 6000); }

  function parseInput() {
    const lines = rawText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const parsed: ImportRow[] = [];
    let rank = 1;
    for (const line of lines) {
      const r = parseWcaLine(line);
      if (!r) continue;
      const nameLower = r.name.toLowerCase();
      const matched = athletes.find(a => a.name.toLowerCase() === nameLower);
      parsed.push({
        rank: rank++,
        wcaId: '', name: r.name, country: r.country,
        single: r.single, average: r.average, solves: r.solves,
        matchedAthleteId: matched?.id || '',
        skip: false,
      });
    }
    setRows(parsed);
  }

  function updateRow(i: number, patch: Partial<ImportRow>) {
    setRows(prev => prev.map((r, ri) => ri === i ? { ...r, ...patch } : r));
  }

  async function doImport() {
    if (!compId || !evId) { showMsg('error', 'Select competition and event.'); return; }
    const comp = comps.find(c => c.id === compId);
    const toImport = rows.filter(r => !r.skip);
    if (toImport.length === 0) { showMsg('warn', 'No rows to import.'); return; }
    setImporting(true);
    let ok = 0; let fail = 0;
    for (const row of toImport) {
      if (!row.matchedAthleteId && !row.name) { fail++; continue; }
      const athleteId = row.matchedAthleteId || `wca_${row.wcaId || row.name.replace(/\s/g,'_')}`;
      const docId = `${compId}_${evId}_r${round}_${athleteId}`;
      try {
        await importResult(docId, {
          athleteId, athleteName: row.name,
          competitionId: compId, competitionName: comp?.name || '',
          eventId: evId, round,
          single: row.single, average: row.average, solves: row.solves,
        });
        ok++;
      } catch { fail++; }
    }
    setImporting(false);
    showMsg(fail === 0 ? 'success' : 'warn', `Imported ${ok} results${fail > 0 ? `, ${fail} failed` : ''}.`);
  }

  const selComp = comps.find(c => c.id === compId);
  const evList = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : WCA_EVENTS;

  return (
    <div className="card">
      <div className="card-title"><span className="title-accent" />WCA Import</div>

      <div className="form-grid">
        <div className="form-group">
          <label>Competition</label>
          <select value={compId} onChange={e => setCompId(e.target.value)}>
            <option value="">— Select —</option>
            {comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Event</label>
          <select value={evId} onChange={e => setEvId(e.target.value)} disabled={!compId}>
            <option value="">— Select —</option>
            {evList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Round</label>
          <select value={round} onChange={e => setRound(Number(e.target.value))}>
            {[1,2,3,4].map(r => <option key={r} value={r}>Round {r}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Paste WCA results (tab/space-separated)</label>
        <textarea
          rows={8}
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder={'1\tName Surname\tMNG\t2019GANT01\t9.45\t10.12\t9.45\t10.00\t10.37\t9.99\t—'}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
            color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.78rem',
            padding: '0.7rem 0.85rem', resize: 'vertical', minHeight: '130px', outline: 'none',
          }}
        />
      </div>
      <button className="btn-sm-primary" onClick={parseInput} style={{ marginBottom: '1rem' }}>Parse Input</button>

      {rows.length > 0 && (
        <>
          <div className="table-wrap" style={{ marginBottom: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Skip</th>
                  <th>#</th>
                  <th>Name</th>
                  <th>Country</th>
                  <th>Single</th>
                  <th>Avg</th>
                  <th>Match Athlete</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ opacity: row.skip ? 0.45 : 1 }}>
                    <td>
                      <input type="checkbox" checked={row.skip} onChange={e => updateRow(i, { skip: e.target.checked })}
                        style={{ accentColor: 'var(--accent)' }} />
                    </td>
                    <td className="td-muted">{row.rank}</td>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td className="td-muted">{row.country}</td>
                    <td className="time-val">{fmtTime(row.single)}</td>
                    <td className="time-val">{fmtTime(row.average)}</td>
                    <td>
                      <select
                        value={row.matchedAthleteId}
                        onChange={e => updateRow(i, { matchedAthleteId: e.target.value })}
                        style={{ padding: '0.22rem 0.45rem', background: 'var(--card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.78rem', outline: 'none', fontFamily: 'inherit' }}
                      >
                        <option value="">— Unmatched (import as-is) —</option>
                        {[...athletes].sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-sm-primary" onClick={doImport} disabled={importing}>
            {importing ? 'Importing…' : `Import ${rows.filter(r => !r.skip).length} Results`}
          </button>
        </>
      )}

      {msg && <div className={`msg ${msgType}`} style={{ display: 'block', marginTop: '0.8rem' }}>{msg}</div>}
    </div>
  );
}
