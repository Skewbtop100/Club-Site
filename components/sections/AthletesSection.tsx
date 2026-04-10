'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import { compareTime } from '@/lib/time-utils';
import type { Athlete, Result } from '@/lib/types';

interface Props {
  athletes: Athlete[];
  results: Result[];
  loading: boolean;
}

export default function AthletesSection({ athletes, results, loading }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const compCount: Record<string, Record<string, boolean>> = {};
    const resultCount: Record<string, number> = {};
    const best333: Record<string, number> = {};

    results.forEach((r) => {
      const key = r.athleteId;
      if (!key) return;
      if (r.eventId === '333' && r.single && r.single > 0) {
        if (!best333[key] || r.single < best333[key]) best333[key] = r.single;
      }
      resultCount[key] = (resultCount[key] || 0) + 1;
      if (r.competitionId) {
        if (!compCount[key]) compCount[key] = {};
        compCount[key][r.competitionId] = true;
      }
    });

    return {
      sorted: [...athletes].sort((a, b) => {
        const aKey = a.athleteId || a.id;
        const bKey = b.athleteId || b.id;
        const aC = compCount[aKey] ? Object.keys(compCount[aKey]).length : 0;
        const bC = compCount[bKey] ? Object.keys(compCount[bKey]).length : 0;
        if (aC !== bC) return bC - aC;
        return (resultCount[bKey] || 0) - (resultCount[aKey] || 0);
      }),
      best333,
    };
  }, [athletes, results]);

  const selectedAthlete = selectedId
    ? athletes.find((a) => (a.athleteId || a.id) === selectedId) ?? null
    : null;

  return (
    <section id="athletes" style={{ padding: '6rem 2rem', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div className="section-tag">ATHLETES</div>
          <h2 className="section-title">Club Athletes</h2>
          <p className="section-desc">Our competitive speedcubers.</p>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" />
          </div>
        ) : athletes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👤</div>
            No athletes registered yet.
          </div>
        ) : (
          <>
            <div className="athletes-grid-desktop">
              {sorted.sorted.map((a) => (
                <AthleteCard
                  key={a.id}
                  athlete={a}
                  best333={sorted.best333[a.athleteId || a.id]}
                  onClick={() => setSelectedId(a.athleteId || a.id)}
                />
              ))}
            </div>
            <MobileCarousel
              athletes={sorted.sorted}
              best333={sorted.best333}
              onSelect={(id) => setSelectedId(id)}
            />
          </>
        )}
      </div>

      {selectedAthlete && (
        <AthleteProfileModal
          athlete={selectedAthlete}
          results={results.filter((r) => r.athleteId === (selectedAthlete.athleteId || selectedAthlete.id))}
          allResults={results}
          onClose={() => setSelectedId(null)}
        />
      )}

      <style>{`
        .section-tag {
          display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
          text-transform: uppercase; color: #a78bfa;
          background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.25);
          padding: 0.28rem 0.8rem; border-radius: 999px; margin-bottom: 0.9rem;
        }
        .section-title { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; color: var(--text-primary); margin-bottom: 0.6rem; }
        .section-desc { font-size: 1rem; color: var(--muted); max-width: 580px; margin: 0 auto; line-height: 1.65; }
        .athletes-grid-desktop {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem;
        }
        .athlete-card {
          background: var(--card); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 1.4rem; text-align: center; cursor: pointer;
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .athlete-card:hover { border-color: rgba(124,58,237,0.35); box-shadow: 0 0 20px var(--glow); }
        .athlete-avatar { width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 auto 0.9rem;display:block; }
        .athlete-initials {
          width:64px;height:64px;border-radius:50%;
          background: linear-gradient(135deg,var(--accent),var(--accent2));
          display:flex;align-items:center;justify-content:center;
          font-size:1.3rem;font-weight:700;color:#fff;margin:0 auto 0.9rem;
        }
        .athlete-name { font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem; }
        .athlete-wca { font-family:monospace;font-size:.78rem;color:#a78bfa;margin-bottom:.2rem; }
        .athlete-best { font-size:.8rem;color:var(--muted); }
        .athlete-best span { color:#a78bfa;font-weight:600;font-family:monospace; }
        .spinner { width:32px;height:32px;border-radius:50%;border:3px solid rgba(124,58,237,0.2);border-top-color:var(--accent);animation:spin .8s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        .empty-state { text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.95rem; }
        .empty-icon { font-size:2.5rem;margin-bottom:.7rem;opacity:.4; }
        .mobile-carousel { display: none; }
        @media (max-width: 700px) {
          .athletes-grid-desktop { display: none; }
          .mobile-carousel { display: block; }
        }
        @media (max-width: 768px) {
          .athletes-grid-desktop { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </section>
  );
}

function AthleteCard({
  athlete,
  best333,
  onClick,
}: {
  athlete: Athlete;
  best333: number | undefined;
  onClick: () => void;
}) {
  const initials = (athlete.name || '?').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="athlete-card" onClick={onClick}>
      {athlete.imageUrl ? (
        <img className="athlete-avatar" src={athlete.imageUrl} alt={athlete.name} />
      ) : (
        <div className="athlete-initials">{initials}</div>
      )}
      <div className="athlete-name">{athlete.name || '—'}</div>
      {athlete.wcaId && <div className="athlete-wca">{athlete.wcaId}</div>}
      <div className="athlete-best">
        {best333
          ? <><span style={{ color: 'var(--muted)', fontWeight: 400 }}>Best 3x3: </span><span>{fmtTime(best333)}</span></>
          : 'No results yet'}
      </div>
    </div>
  );
}

// ── Athlete Profile Modal ────────────────────────────────────────────────────

function AthleteProfileModal({
  athlete,
  results,
  allResults,
  onClose,
}: {
  athlete: Athlete;
  results: Result[];
  allResults: Result[];
  onClose: () => void;
}) {
  const initials = (athlete.name || '?').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  // Personal bests per event
  const pbs = useMemo(() => {
    const map: Record<string, { single: number | null; average: number | null }> = {};
    results.forEach((r) => {
      if (!map[r.eventId]) map[r.eventId] = { single: null, average: null };
      const entry = map[r.eventId];
      if (r.single && r.single > 0 && (entry.single === null || r.single < entry.single))
        entry.single = r.single;
      if (r.average && r.average > 0 && (entry.average === null || r.average < entry.average))
        entry.average = r.average;
    });
    return map;
  }, [results]);

  // Competition history grouped by comp
  const history = useMemo(() => {
    const map: Record<string, { compName: string; results: Result[] }> = {};
    results.forEach((r) => {
      const cid = r.competitionId || 'unknown';
      if (!map[cid]) map[cid] = { compName: r.competitionName || cid, results: [] };
      map[cid].results.push(r);
    });
    return Object.values(map);
  }, [results]);

  // Stats
  const totalComps = new Set(results.map((r) => r.competitionId)).size;
  const totalEvents = Object.keys(pbs).length;
  const totalSolves = results.reduce((acc, r) => acc + (r.solves?.filter((s) => s && s > 0).length ?? 0), 0);

  // Medal counting: gold/silver/bronze in finals only
  const medals = useMemo(() => {
    let gold = 0, silver = 0, bronze = 0;
    const athleteId = athlete.athleteId || athlete.id;
    results.forEach((r) => {
      const sameCompEvent = allResults.filter(
        (x) => x.competitionId === r.competitionId && x.eventId === r.eventId
      );
      const maxRound = Math.max(...sameCompEvent.map((x) => x.round || 1));
      if ((r.round || 1) !== maxRound) return;
      const pool = sameCompEvent
        .filter((x) => (x.round || 1) === maxRound)
        .sort((a, b) => compareTime(
          a.average !== null ? a.average : a.single,
          b.average !== null ? b.average : b.single
        ));
      const place = pool.findIndex((x) => x.athleteId === athleteId) + 1;
      if (place === 1) gold++;
      else if (place === 2) silver++;
      else if (place === 3) bronze++;
    });
    return { gold, silver, bronze };
  }, [results, allResults, athlete]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
      animation: 'overlayIn 0.18s ease',
    }} onClick={onClose}>
      <div style={{
        position: 'relative', width: '100%', maxWidth: '680px',
        maxHeight: '90vh', background: 'var(--bg)',
        border: '1px solid rgba(124,58,237,0.25)',
        borderRadius: '16px',
        overflowY: 'auto',
        animation: 'slideIn 0.22s cubic-bezier(.4,0,.2,1)',
      }} onClick={(e) => e.stopPropagation()}>

        {/* Top bar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--nav-bg)', backdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(124,58,237,0.2)',
          padding: '0 1.5rem', height: '56px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button onClick={onClose} style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 500, fontFamily: 'inherit',
          }}>← Back</button>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Athlete Profile
          </div>
          <div style={{ width: '60px' }} />
        </div>

        <div style={{ padding: '2rem 1.8rem 3rem' }}>
          {/* Profile header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.4rem', marginBottom: '2rem' }}>
            {athlete.imageUrl ? (
              <img src={athlete.imageUrl} alt={athlete.name} style={{
                width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
              }} />
            ) : (
              <div style={{
                width: 80, height: 80, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg,var(--accent),var(--accent2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.8rem', fontWeight: 700, color: '#fff',
              }}>{initials}</div>
            )}
            <div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                {athlete.name}{athlete.lastName ? ` ${athlete.lastName}` : ''}
              </div>
              {athlete.wcaId && (
                <div style={{ fontFamily: 'monospace', fontSize: '0.88rem', color: '#a78bfa', marginBottom: '0.2rem' }}>
                  {athlete.wcaId}
                </div>
              )}
              {athlete.birthDate && (
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Born: {athlete.birthDate}</div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.6rem', marginBottom: '2rem' }}>
            {[
              { label: 'Comps', val: totalComps, style: {} },
              { label: 'Events', val: totalEvents, style: {} },
              { label: 'Solves', val: totalSolves, style: {} },
              { label: 'Gold', val: medals.gold, style: medals.gold ? { color: '#fbbf24' } : { color: 'var(--muted)' } },
              { label: 'Silver', val: medals.silver, style: medals.silver ? { color: '#94a3b8' } : { color: 'var(--muted)' } },
              { label: 'Bronze', val: medals.bronze, style: medals.bronze ? { color: '#c97c4a' } : { color: 'var(--muted)' } },
            ].map((s) => (
              <div key={s.label} style={{
                background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '10px', padding: '0.7rem 0.4rem', textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, ...s.style }}>{s.val}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.15rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Personal bests */}
          {Object.keys(pbs).length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.8rem' }}>
                Personal Bests
              </div>
              <div style={{ background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {['Event', 'Single', 'Average'].map((h) => (
                        <th key={h} style={{ padding: '0.7rem 1rem', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WCA_EVENTS.filter((ev) => pbs[ev.id]).map((ev, i, arr) => (
                      <tr key={ev.id} style={{ borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                        <td style={{ padding: '0.6rem 1rem', fontSize: '0.88rem', color: 'var(--text)' }}>{ev.name}</td>
                        <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontSize: '0.9rem', color: '#a78bfa', fontWeight: 600 }}>{fmtTime(pbs[ev.id].single)}</td>
                        <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--muted)' }}>{pbs[ev.id].average !== null ? fmtTime(pbs[ev.id].average) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Competition history */}
          {history.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.8rem' }}>
                Competition History
              </div>
              {history.map((comp) => (
                <div key={comp.compName} style={{ marginBottom: '1.2rem' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#c4b5fd', marginBottom: '0.5rem' }}>
                    {comp.compName}
                  </div>
                  <div style={{ background: 'var(--card)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          {['Event', 'Rnd', 'Single', 'Avg'].map((h) => (
                            <th key={h} style={{ padding: '0.5rem 0.8rem', textAlign: 'left', fontSize: '0.68rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {comp.results.map((r, i) => {
                          const ev = WCA_EVENTS.find((e) => e.id === r.eventId);
                          return (
                            <tr key={i} style={{ borderBottom: i < comp.results.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                              <td style={{ padding: '0.5rem 0.8rem', fontSize: '0.82rem', color: 'var(--text)' }}>{ev?.name || r.eventId}</td>
                              <td style={{ padding: '0.5rem 0.8rem', fontSize: '0.78rem', color: 'var(--muted)' }}>{r.round || 1}</td>
                              <td style={{ padding: '0.5rem 0.8rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#a78bfa', fontWeight: 600 }}>{fmtTime(r.single)}</td>
                              <td style={{ padding: '0.5rem 0.8rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--muted)' }}>{r.average !== null ? fmtTime(r.average) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.6rem' }}>🏆</div>
              No results yet. Compete in your first event!
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
      `}</style>
    </div>
  );
}

// ── Mobile carousel ──────────────────────────────────────────────────────────

const PAGE_SIZE = 6;

function MobileCarousel({
  athletes,
  best333,
  onSelect,
}: {
  athletes: Athlete[];
  best333: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const totalPages = Math.ceil(athletes.length / PAGE_SIZE);

  useEffect(() => {
    if (totalPages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % totalPages), 4000);
    return () => clearInterval(id);
  }, [totalPages]);

  const pageAthletes = athletes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function onTouchStart(e: React.TouchEvent) { startX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    const diff = startX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) < 40) return;
    if (diff > 0) setPage((p) => Math.min(p + 1, totalPages - 1));
    else setPage((p) => Math.max(p - 1, 0));
  }

  return (
    <div className="mobile-carousel">
      <div
        ref={trackRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}
      >
        {pageAthletes.map((a) => (
          <AthleteCard
            key={a.id}
            athlete={a}
            best333={best333[a.athleteId || a.id]}
            onClick={() => onSelect(a.athleteId || a.id)}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '1.2rem' }}>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              style={{
                width: i === page ? 20 : 8, height: 8, borderRadius: 999, border: 'none', padding: 0,
                background: i === page ? 'var(--accent)' : 'rgba(255,255,255,0.2)',
                cursor: 'pointer', transition: 'all 0.25s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
