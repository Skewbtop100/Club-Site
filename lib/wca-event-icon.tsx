'use client';

interface WcaEventIconProps {
  eventId: string;
  size?: number;
  className?: string;
}

// Bridge our internal event IDs → @cubing/icons CSS class names.
// Most match (333, 222, …, pyram, skewb, sq1, clock, minx); the
// blindfolded events differ — internally we use the older WCA
// shorthand `333bld/444bld/555bld`, but cubing-icons publishes them
// as `event-333bf/event-444bf/event-555bf`.
const EVENT_ICON_MAP: Record<string, string> = {
  '333':    'event-333',
  '222':    'event-222',
  '444':    'event-444',
  '555':    'event-555',
  '666':    'event-666',
  '777':    'event-777',
  '333oh':  'event-333oh',
  '333bld': 'event-333bf',
  '444bld': 'event-444bf',
  '555bld': 'event-555bf',
  '333mbf': 'event-333mbf',
  '333fm':  'event-333fm',
  'pyram':  'event-pyram',
  'skewb':  'event-skewb',
  'sq1':    'event-sq1',
  'clock':  'event-clock',
  'minx':   'event-minx',
};

export function WcaEventIcon({ eventId, size = 24, className = '' }: WcaEventIconProps) {
  const iconClass = EVENT_ICON_MAP[eventId] ?? 'event-333';
  return (
    <span
      className={`cubing-icon ${iconClass} ${className}`}
      style={{
        fontSize: `${size}px`,
        lineHeight: 1,
        display: 'inline-block',
      }}
      aria-label={eventId}
    />
  );
}
