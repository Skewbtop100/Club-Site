import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { fmtDateTime } from './format';

export default function LiveBanner({ competition }: { competition: OnlineCompetition }) {
  return (
    <div className="oc-hub-live-banner">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="oc-hub-live-dot" aria-hidden />
          <span style={{ font: '700 10px var(--oc-font-mono), monospace', letterSpacing: '.24em', color: '#DFFF4F' }}>
            LIVE
          </span>
          <span style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.14em', color: '#8A8474' }}>
            ОДОО ЯВАГДАЖ БАЙНА
          </span>
        </div>
        <p style={{ marginTop: 10, font: '600 26px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
          {competition.name}
        </p>
        <p style={{ marginTop: 6, font: '400 11px var(--oc-font-mono), monospace', color: '#8A8474' }}>
          {fmtDateTime(competition.startAt)}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Link href={`/online-competition/${competition.id}/details`} className="oc-btn-live-cta">
          Тэмцээнд орох
        </Link>
      </div>
    </div>
  );
}
