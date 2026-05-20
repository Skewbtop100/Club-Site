'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { subscribePublishedCompetitions } from '@/lib/firebase/services/virtual-competitions';
import type { VirtualCompetition } from '@/lib/firebase/services/virtual-competitions';
import { getEvent } from '@/lib/wca-events';

const C = {
  bg:      '#0a0a0a',
  card:    '#141414',
  border:  'rgba(255,255,255,0.06)',
  borderHi:'rgba(167,139,250,0.25)',
  text:    '#e8e8ed',
  muted:   '#8b8d98',
  accent:  '#a78bfa',
} as const;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", "Fira Code", monospace';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortComps(comps: VirtualCompetition[]): VirtualCompetition[] {
  return [...comps].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'published' ? -1 : 1;
    }
    return b.date.localeCompare(a.date);
  });
}

function StatusPill({ status }: { status: string }) {
  const published = status === 'published';
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.55rem',
      borderRadius: 999,
      fontSize: '0.65rem',
      fontWeight: 800,
      letterSpacing: '0.07em',
      background: published ? 'rgba(52,211,153,0.15)' : 'rgba(100,116,139,0.2)',
      color:      published ? '#34d399'                : '#8b8d98',
    }}>
      {published ? 'НЭЭЛТТЭЙ' : 'ХААГДСАН'}
    </span>
  );
}

function EventChips({ events }: { events: string[] }) {
  const MAX_VISIBLE = 5;
  const visible = events.slice(0, MAX_VISIBLE);
  const extra = events.length - MAX_VISIBLE;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.45rem' }}>
      {visible.map((id) => {
        const ev = getEvent(id);
        return (
          <span key={id} style={{
            padding: '0.1rem 0.4rem',
            borderRadius: 4,
            fontSize: '0.62rem',
            fontWeight: 700,
            fontFamily: MONO,
            background: 'rgba(167,139,250,0.12)',
            color: C.accent,
            border: '1px solid rgba(167,139,250,0.2)',
          }}>
            {ev?.short ?? id}
          </span>
        );
      })}
      {extra > 0 && (
        <span style={{
          padding: '0.1rem 0.4rem',
          borderRadius: 4,
          fontSize: '0.62rem',
          fontWeight: 700,
          fontFamily: MONO,
          background: 'rgba(255,255,255,0.05)',
          color: C.muted,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          +{extra}
        </span>
      )}
    </div>
  );
}

function ImagePlaceholder({ name }: { name: string }) {
  const letter = name.trim()[0]?.toUpperCase() ?? '?';
  return (
    <div style={{
      width: '100%', aspectRatio: '16 / 9',
      background: 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(167,139,250,0.12) 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderBottom: `1px solid ${C.border}`,
      flexShrink: 0,
    }}>
      <span style={{
        fontSize: '3.5rem',
        fontWeight: 800,
        color: 'rgba(167,139,250,0.4)',
        fontFamily: FONT,
        userSelect: 'none',
      }}>
        {letter}
      </span>
    </div>
  );
}

function CompCard({ comp }: { comp: VirtualCompetition }) {
  const meta = [comp.date, comp.location].filter(Boolean).join(' · ');
  return (
    <Link
      href={`/timer/competitions/${comp.id}`}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
        cursor: 'pointer',
      }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.borderHi)}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
      >
        {comp.imageUrl ? (
          <img
            src={comp.imageUrl}
            alt={comp.name}
            style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <ImagePlaceholder name={comp.name} />
        )}

        <div style={{ padding: '0.85rem 1rem 1rem' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, marginBottom: '0.2rem' }}>
            {comp.name}
          </div>
          {meta && (
            <div style={{ fontSize: '0.82rem', color: C.muted, fontFamily: MONO }}>
              {meta}
            </div>
          )}
          <EventChips events={comp.events} />
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: '0.65rem',
          }}>
            <span style={{ fontSize: '0.8rem', color: C.muted, fontFamily: MONO }}>
              {comp.participantCount ?? 0} оролцогч
            </span>
            <StatusPill status={comp.status} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      <div style={{
        width: '100%', aspectRatio: '16 / 9',
        background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 100%)',
        backgroundSize: '200% 100%',
        animation: 'vc-shimmer 1.5s infinite',
      }} />
      <div style={{ padding: '0.85rem 1rem 1rem' }}>
        {[80, 55, 70].map((w, i) => (
          <div key={i} style={{
            height: i === 0 ? 18 : 13,
            width: `${w}%`,
            marginBottom: i < 2 ? '0.45rem' : 0,
            borderRadius: 4,
            background: 'rgba(255,255,255,0.05)',
            animation: 'vc-shimmer 1.5s infinite',
            animationDelay: `${i * 0.1}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompetitionsPage() {
  const [comps, setComps] = useState<VirtualCompetition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribePublishedCompetitions((data) => {
      setComps(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  const sorted = sortComps(comps);

  return (
    <div style={{
      minHeight: '100dvh',
      background: C.bg,
      fontFamily: FONT,
      color: C.text,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Sticky header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: C.bg,
        borderBottom: `1px solid ${C.border}`,
        padding: '0.75rem 1rem',
        flexShrink: 0,
      }}>
        <Link href="/timer" style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.82rem', fontWeight: 600,
          color: C.muted, textDecoration: 'none',
          transition: 'color 0.15s',
        }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = C.text)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = C.muted)}
        >
          ← Timer-руу буцах
        </Link>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem 2rem' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0 0 0.3rem', color: C.text }}>
              Тэмцээнүүд
            </h1>
            <p style={{ margin: 0, fontSize: '0.88rem', color: C.muted }}>
              Виртуал тэмцээнд оролцох
            </p>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : sorted.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '3rem 1rem',
              color: C.muted,
              fontSize: '0.9rem',
            }}>
              Зарлагдсан тэмцээн одоохондоо байхгүй
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {sorted.map((comp) => (
                <CompCard key={comp.id} comp={comp} />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes vc-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
