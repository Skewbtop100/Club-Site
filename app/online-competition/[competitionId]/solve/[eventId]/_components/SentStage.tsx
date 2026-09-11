import Link from 'next/link';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';

const GRID_PATTERN = ['volt', 'volt', 'volt', 'ink', 'volt', 'ink', 'ink', 'volt', 'ink'] as const;
const COLOR = { ink: '#1C1C21', volt: '#DFFF4F' } as const;

export default function SentStage({ ao5 }: { ao5: number | null }) {
  return (
    <div className="oc-solve-sent">
      <div className="oc-solve-sent-grid" aria-hidden>
        {GRID_PATTERN.map((tone, i) => (
          <span key={i} className="oc-solve-sent-cell" style={{ background: COLOR[tone] }} />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Deliberately not the mockup's "AO5 - ДУНДАЖ": this screen is
            reached by Mo3 and best-of rounds too, and naming the average
            there would be wrong for them. */}
        <p style={{ font: '500 9px var(--oc-font-mono), monospace', letterSpacing: '.2em', color: '#6E6A62' }}>
          AO5
        </p>
        <p className="oc-solve-ao5-value-lg">{ao5 === null ? 'DNF' : fmtCentiseconds(ao5)}</p>
      </div>

      <p style={{ font: '400 16px var(--oc-font-heading), sans-serif', color: '#F4F1EA' }}>
        Илгээгдлээ. Шүүгч хянасны дараа дүн батлагдана.
      </p>

      <span className="oc-solve-pending-pill">
        <span className="oc-solve-pending-dot" aria-hidden />
        <span style={{ font: '500 10px var(--oc-font-mono), monospace', letterSpacing: '.12em', color: '#E08A00' }}>
          ХҮЛЭЭГДЭЖ БУЙ
        </span>
      </span>

      <Link href="/online-competition/dashboard" className="oc-solve-btn-back">
        ЭХЭЛЖ ҮЗЭХ
      </Link>
    </div>
  );
}
