'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useLang } from '@/lib/i18n';
import { fmtTime } from '@/lib/time-utils';
import { WCA_EVENTS } from '@/lib/wca-events';
import AthleteProfileOverlay from '@/components/shared/AthleteProfileOverlay';
import type { Athlete, Result } from '@/lib/types';

interface Props {
  athletes: Athlete[];
  results: Result[];
  loading: boolean;
}

export default function AthletesSection({ athletes, results, loading }: Props) {
  const { t } = useLang();
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
          <div className="section-tag">{t('section-tag.athletes')}</div>
          <h2 className="section-title">{t('section-title.athletes')}</h2>
          <p className="section-desc">{t('section-desc.athletes')}</p>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" />
          </div>
        ) : athletes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👤</div>
            {t('athletes.no-athletes')}
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
        <AthleteProfileOverlay
          athlete={selectedAthlete}
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
        .section-title { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; color: var(--text-primary); margin-bottom: 0.6rem; text-align: center; display: block; border-bottom: none; padding-bottom: 0; text-transform: none; letter-spacing: normal; }
        .section-title::before { display: none; }
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
          #athletes { padding: 1rem 0.75rem; }
          #athletes > div { max-width: none; padding: 0; }
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
  const { t } = useLang();
  const fullName = `${athlete.name || ''}${athlete.lastName ? ' ' + athlete.lastName : ''}`;
  const initials = (fullName || '?').split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="athlete-card" onClick={onClick}>
      {athlete.imageUrl ? (
        <img className="athlete-avatar" src={athlete.imageUrl} alt={fullName} />
      ) : (
        <div className="athlete-initials">{initials}</div>
      )}
      <div className="athlete-name">{fullName || '—'}</div>
      {athlete.wcaId && <div className="athlete-wca">{athlete.wcaId}</div>}
      <div className="athlete-best">
        {best333
          ? <><span style={{ color: 'var(--muted)', fontWeight: 400 }}>{t('athletes.best-333')}</span><span>{fmtTime(best333)}</span></>
          : t('athletes.no-results')}
      </div>
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
