'use client';

import { useEffect, useMemo, useState } from 'react';
import { getCompetitions } from '@/lib/firebase/services/competitions';
import { getAthletes } from '@/lib/firebase/services/athletes';
import { subscribeAssignmentsByComp, type Assignment } from '@/lib/firebase/services/assignments';
import type { Competition, Athlete } from '@/lib/types';
import { WCA_EVENTS } from '@/lib/wca-events';
import { useLang, type TranslationKey } from '@/lib/i18n';

const ROLES = ['competitor', 'judge', 'scrambler', 'standby'] as const;
const ROLE_KEYS: Record<typeof ROLES[number], TranslationKey> = {
  competitor: 'admin.asg.role.competitor',
  judge: 'admin.asg.role.judge',
  scrambler: 'admin.asg.role.scrambler',
  standby: 'admin.asg.role.standby',
};
const ROLE_COLORS: Record<string, string> = {
  competitor: '#818cf8', judge: '#4ade80', scrambler: '#fbbf24', standby: 'var(--muted)',
};

export default function AssignmentsTab() {
  const { t } = useLang();
  const [comps, setComps]             = useState<Competition[]>([]);
  const [compId, setCompId]           = useState('');
  const [evId, setEvId]               = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading]         = useState(false);
  const [allAthletes, setAllAthletes] = useState<Athlete[]>([]);

  useEffect(() => {
    getCompetitions().then(setComps);
    getAthletes().then(setAllAthletes);
  }, []);

  const athleteNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    allAthletes.forEach(a => {
      m[a.id] = `${a.name || ''}${a.lastName ? ' ' + a.lastName : ''}`;
    });
    return m;
  }, [allAthletes]);

  useEffect(() => {
    if (!compId) { setAssignments([]); return; }
    setLoading(true);
    const unsub = subscribeAssignmentsByComp(
      compId,
      (data) => { setAssignments(data); setLoading(false); },
    );
    return unsub;
  }, [compId]);

  const selComp = comps.find(c => c.id === compId);
  const evList = selComp?.events ? WCA_EVENTS.filter(e => (selComp.events as Record<string,boolean>)?.[e.id]) : [];
  const filteredAsg = evId ? assignments.filter(a => a.eventId === evId) : assignments;
  const registeredAthletes = selComp?.athletes || [];
  const eventRegisteredAthletes = evId
    ? registeredAthletes.filter(a => a.events.includes(evId))
    : registeredAthletes;
  const byEvent: Record<string, Assignment[]> = {};
  for (const asg of filteredAsg) {
    if (!byEvent[asg.eventId]) byEvent[asg.eventId] = [];
    byEvent[asg.eventId].push(asg);
  }

  return (
    <div>
      <div className="card">
        <div className="card-title"><span className="title-accent" />{t('admin.asg.title')}</div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
          <div className="form-group" style={{ flex: 1, maxWidth: '340px', marginBottom: 0 }}>
            <label>{t('admin.asg.competition')}</label>
            <select value={compId} onChange={e => { setCompId(e.target.value); setEvId(''); }}>
              <option value="">{t('admin.asg.select-comp')}</option>
              {comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {compId && evList.length > 0 && (
          <div className="cao-event-tabs" style={{ marginBottom: '1rem' }}>
            <button className={`cao-ev-pill${!evId ? ' active' : ''}`} onClick={() => setEvId('')}>{t('admin.asg.all-events')}</button>
            {evList.map(ev => (
              <button key={ev.id} className={`cao-ev-pill${evId === ev.id ? ' active' : ''}`} onClick={() => setEvId(ev.id)}>
                {ev.short}
              </button>
            ))}
          </div>
        )}

        {compId && registeredAthletes.length > 0 && (
          <div style={{ marginBottom: '1rem', padding: '0.65rem 0.9rem', borderRadius: '10px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c4b5fd', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {evId ? `${t('admin.asg.registered-for')} ${WCA_EVENTS.find(e => e.id === evId)?.name || evId}` : t('admin.asg.registered')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {eventRegisteredAthletes.length === 0
                ? <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic' }}>{t('admin.asg.no-event-athletes')}</span>
                : eventRegisteredAthletes.map(a => (
                  <span key={a.id} style={{
                    padding: '0.18rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem',
                    background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)',
                    color: '#c4b5fd',
                  }}>{athleteNameMap[a.id] || a.name}</span>
                ))
              }
            </div>
          </div>
        )}

        {!compId && <div className="cao-empty-state">{t('admin.asg.empty-comp')}</div>}
        {compId && loading && <div className="spinner-row">{t('admin.loading')}<span className="spinner-ring" /></div>}
        {compId && !loading && assignments.length === 0 && (
          <div className="cao-empty-state">{t('admin.asg.empty')}</div>
        )}

        {Object.entries(byEvent).map(([eid, asgs]) => {
          const ev = WCA_EVENTS.find(e => e.id === eid);
          return (
            <div key={eid} style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#c4b5fd', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {ev?.name || eid}
              </div>
              {asgs.sort((a,b) => (a.heat||0) - (b.heat||0)).map(asg => (
                <div className="cao-heat-card" key={asg.id}>
                  <div className="cao-heat-header">
                    <span className="cao-heat-label">{t('admin.asg.heat')} {asg.heat}</span>
                  </div>
                  <div className="cao-heat-body">
                    {ROLES.map(role => {
                      const names = (asg[role] || []) as string[];
                      return (
                        <div className="cao-role-group" key={role}>
                          <div className="cao-role-title" style={{ color: ROLE_COLORS[role] }}>
                            {t(ROLE_KEYS[role])}
                          </div>
                          <div className="cao-name-list">
                            {names.length
                              ? names.map((n, i) => <div className="cao-name-tag" key={i}>{n}</div>)
                              : <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic' }}>—</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
