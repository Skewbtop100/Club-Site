'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
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
          athletes={athletes}
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
        .embla { overflow: hidden; }
        .embla__container { display: flex; }
        .embla__slide {
          flex: 0 0 100%; min-width: 0;
          display: flex; flex-direction: column; gap: 0.75rem;
        }
        .athlete-dot {
          height: 8px; border-radius: 999px; border: none; padding: 0; cursor: pointer;
          background: rgba(255,255,255,0.2); width: 8px;
          transition: width 0.3s ease, background 0.3s ease;
        }
        .athlete-dot-active {
          width: 20px; background: var(--accent);
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
// Matches RecordsSection's MobileRecordsCarousel pattern exactly (same Embla
// setup, same autoplay timing/behavior, cards stacked vertically per slide
// instead of a 2-column grid) — this was previously a hand-rolled swipe
// handler with an instant array-slice swap and no transition at all, which
// felt jerky next to Records' smooth carousel on the same page.

const CARDS_PER_SLIDE = 2;
const AUTO_INTERVAL = 6000;

function MobileCarousel({
  athletes,
  best333,
  onSelect,
}: {
  athletes: Athlete[];
  best333: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const [selectedSnap, setSelectedSnap] = useState(0);

  // Build slides: array of 2-card groups
  const slides = useMemo(() => {
    const s: Athlete[][] = [];
    for (let i = 0; i < athletes.length; i += CARDS_PER_SLIDE) {
      s.push(athletes.slice(i, i + CARDS_PER_SLIDE));
    }
    return s;
  }, [athletes]);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, duration: 30 },
    [Autoplay({ delay: AUTO_INTERVAL, stopOnInteraction: false, stopOnMouseEnter: true })],
  );

  const onEmblaSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedSnap(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onEmblaSelect();
    emblaApi.on('select', onEmblaSelect);
    return () => { emblaApi.off('select', onEmblaSelect); };
  }, [emblaApi, onEmblaSelect]);

  const scrollTo = useCallback((idx: number) => {
    emblaApi?.scrollTo(idx);
  }, [emblaApi]);

  return (
    <div className="mobile-carousel">
      <div className="embla" ref={emblaRef}>
        <div className="embla__container">
          {slides.map((group, si) => (
            <div key={si} className="embla__slide">
              {group.map((a) => (
                <AthleteCard
                  key={a.id}
                  athlete={a}
                  best333={best333[a.athleteId || a.id]}
                  onClick={() => onSelect(a.athleteId || a.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {slides.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '1.2rem' }}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              className={`athlete-dot${i === selectedSnap ? ' athlete-dot-active' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
