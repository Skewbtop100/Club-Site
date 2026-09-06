'use client';

import type { OnlineSubmission, OnlineSubmissionStatus } from '@/lib/online-competition/types';
import { fmtCentiseconds } from '@/lib/online-competition/time-utils';
import EmptyBlock from '../../_components/hub/v3/EmptyBlock';

// Same three status tones the admin review dashboard and the rest of v3
// already use.
const TONE: Record<OnlineSubmissionStatus, { border: string; color: string; label: string }> = {
  pending: { border: '#DFFF4F', color: '#DFFF4F', label: 'ХҮЛЭЭГДЭЖ БУЙ' },
  approved: { border: '#4FD07A', color: '#4FD07A', label: 'БАТЛАГДСАН' },
  rejected: { border: '#E8543C', color: '#E8543C', label: 'ТАТГАЛЗСАН' },
};

export default function RecentSubmissions({ submissions }: { submissions: OnlineSubmission[] }) {
  return (
    <div className="oc-v3-card">
      <div className="oc-v3-card-head">
        <span className="oc-v3-label">Сүүлийн тайлалтууд</span>
        <span className="oc-v3-season">{submissions.length}</span>
      </div>

      {submissions.length === 0 ? (
        <EmptyBlock text="Тайлалт алга." />
      ) : (
        submissions.map((s) => {
          const tone = TONE[s.status] ?? TONE.pending;
          // A DNF (self-reported or judge-assigned) has no meaningful time
          // to print, and a rejected solve's time no longer counts — both
          // read dimmed rather than as a headline result.
          const isDnf = s.isDnf || s.penalty === 'DNF';
          const timeText = isDnf ? 'DNF' : fmtCentiseconds(s.reportedTime);
          const timeColor = isDnf || s.status === 'rejected' ? '#4A4740' : s.status === 'approved' ? '#F4F1EA' : '#DFFF4F';

          return (
            <div key={s.id ?? `${s.competitionId}-${s.event}-${s.round}`} className="oc-v3-sub-row">
              <span
                style={{
                  font: '600 12px var(--oc-font-mono), monospace',
                  color: '#F4F1EA',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.event.toUpperCase()}
                <span style={{ color: '#4A4740' }}> · Р{s.round}</span>
              </span>

              <span
                style={{
                  font: '400 10px var(--oc-font-mono), monospace',
                  color: '#6E6A62',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.competitionId}
              </span>

              <span
                style={{
                  border: `1px solid ${tone.border}`,
                  color: tone.color,
                  padding: '5px 7px',
                  font: '600 8px var(--oc-font-mono), monospace',
                  letterSpacing: '.12em',
                  whiteSpace: 'nowrap',
                }}
              >
                {tone.label}
                {s.penalty === '+2' ? ' +2' : ''}
              </span>

              <span className="oc-v3-sub-time" style={{ color: timeColor }}>
                {timeText}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
