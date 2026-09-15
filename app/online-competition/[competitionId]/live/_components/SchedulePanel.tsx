'use client';

import type { CSSProperties } from 'react';
import type { RoundRowState } from '@/lib/online-competition/live-view';
import type { RoundStatus } from '@/lib/online-competition/rounds';
import {
  DashedBox,
  DoneBox,
  EventGlyph,
  LockedBox,
  MONO,
  QualifiedStartButton,
  StartButton,
  panelLabelStyle,
  panelStyle,
  solveHref,
} from './ui';

export interface ScheduleItem {
  key: string;
  eventId: string;
  /** "3x3x3 · Раунд 1" */
  label: string;
  round: number;
  status: RoundStatus;
  scheduledAt: string | null;
  qualified: boolean | null;
  state: RoundRowState;
  /** For an open round that is not this viewer's to solve: why. */
  viewNote: string;
}

/** The athlete's other rounds: events they registered for, rounds they
 *  have reached (roundsReached), in configured order. The page does not
 *  render this at all when there are none. */
export default function SchedulePanel({
  items,
  competitionId,
  onSelect,
}: {
  items: ScheduleItem[];
  competitionId: string;
  /** Makes an open round the current one. */
  onSelect: (eventId: string) => void;
}) {
  return (
    <section style={panelStyle}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid #1C1C21',
        }}
      >
        <span style={panelLabelStyle}>ХУВААРЬ</span>
        <span style={{ font: `400 9px/1.3 ${MONO}`, color: '#6E6A62' }}>РАУНД НЭЭГДМЭГЦ ТОВЧ ИДЭВХЖИНЭ</span>
      </div>

      {items.map((item) => (
        <Row key={item.key} item={item} competitionId={competitionId} onSelect={onSelect} />
      ))}
    </section>
  );
}

function timeLabel(item: ScheduleItem): string {
  if (item.status === 'live') return 'ЯВАГДАЖ БУЙ';
  if (item.status === 'done') return 'ДУУССАН';
  return item.scheduledAt ? `${item.scheduledAt}-Д` : 'НЭЭГДЭЭГҮЙ';
}

function Row({
  item,
  competitionId,
  onSelect,
}: {
  item: ScheduleItem;
  competitionId: string;
  onSelect: (eventId: string) => void;
}) {
  const selectable = item.state === 'open' || item.state === 'open-done';
  const headStyle: CSSProperties = {
    border: 'none',
    background: 'transparent',
    padding: 0,
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    minWidth: 0,
    width: '100%',
  };
  const head = (
    <>
      <EventGlyph eventId={item.eventId} size={20} color={item.state === 'finished' ? '#6E6A62' : '#F4F1EA'} />
      <span
        style={{
          flex: 1,
          font: `600 13px/1.2 ${MONO}`,
          color: '#F4F1EA',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.label}
      </span>
      <span style={{ font: `400 9px/1 ${MONO}`, letterSpacing: '.1em', color: '#6E6A62', whiteSpace: 'nowrap', flex: 'none' }}>
        {timeLabel(item)}
      </span>
    </>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 11,
        padding: '14px 16px',
        borderBottom: '1px solid #16161B',
        borderLeft: `2px solid ${item.status === 'live' ? '#3A4614' : '#1C1C21'}`,
        background: '#0D0D10',
      }}
    >
      {selectable ? (
        <button type="button" onClick={() => onSelect(item.eventId)} style={{ ...headStyle, cursor: 'pointer' }}>
          {head}
        </button>
      ) : (
        <div style={headStyle}>{head}</div>
      )}
      <RowBody item={item} competitionId={competitionId} />
    </div>
  );
}

function RowBody({ item, competitionId }: { item: ScheduleItem; competitionId: string }) {
  switch (item.state) {
    case 'finished':
      return <DoneBox label="ДУУССАН" />;
    case 'open':
      // Round 2+ the athlete qualified into gets the outlined variant, as
      // in the mockup; everything else the plain volt button.
      return item.round > 1 && item.qualified === true ? (
        <QualifiedStartButton href={solveHref(competitionId, item.eventId)} note="ТА ШАЛГАРСАН" />
      ) : (
        <StartButton href={solveHref(competitionId, item.eventId)} label="Эвлүүлэлтээ эхлэх" compact />
      );
    case 'open-done':
      return <DoneBox label="ОРОЛДЛОГО ДУУССАН" />;
    case 'open-view':
      return <DashedBox label="ЯВАГДАЖ БУЙ" note={item.viewNote} center />;
    case 'notqualified':
      // Unreachable: roundsReached lists no round the athlete missed the
      // cut for. Such a round is left out of the schedule, not labelled.
      return null;
    case 'notopen':
      return <LockedBox label="НЭЭГДЭЭГҮЙ" extra={item.qualified === true ? 'ТА ШАЛГАРСАН' : null} center />;
  }
}
