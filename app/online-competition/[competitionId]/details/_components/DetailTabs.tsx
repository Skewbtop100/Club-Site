'use client';

import { useEffect } from 'react';
import type {
  OnlineCompetitionBlock,
  OnlineCompetitionEventConfig,
  OnlineCompetitionScheduleEntry,
  OnlineCompetitionSection,
} from '@/lib/online-competition/types';
import { eventRoundRows, scheduleRows } from '@/lib/online-competition/detail-view';
import { parseVideoUrl, videoEmbedUrl } from '@/lib/online-competition/video-url';
import { WcaEventIcon, hasWcaEventIcon } from '@/lib/wca-event-icon';

// The three content tabs of the public detail page that are not ЕРӨНХИЙ.
// Layout only: every row, label and time comes from detail-view.ts, which
// is where the rules live and where they are tested.

/** The event glyph, in the 28px `.oc-v3-ev-icon` square the hub already
 *  uses for the same job — the uppercase code is the fallback for an event
 *  @cubing/icons does not publish. */
function EventIcon({ eventId }: { eventId: string }) {
  return (
    <span className="oc-v3-ev-icon" aria-hidden>
      {hasWcaEventIcon(eventId) ? <WcaEventIcon eventId={eventId} size={16} /> : eventId.slice(0, 4).toUpperCase()}
    </span>
  );
}

// ── ТӨРЛҮҮД ────────────────────────────────────────────────────────────

export function EventsTab({ events }: { events: OnlineCompetitionEventConfig[] }) {
  const { rows, usesLimit, usesCutoff } = eventRoundRows(events);

  return (
    <div style={{ marginTop: 22 }}>
      {/* A real <table>: this is tabular data an athlete reads across a
          row and down a column, and a screen reader should announce it
          as such. It scrolls inside its own frame on a phone — six
          columns do not fit 375px, and wrapping them would break the
          row/column reading the table exists for. */}
      <div className="oc-cd-table-wrap">
        <table className="oc-cd-table">
          <thead>
            <tr>
              <th scope="col">ТӨРӨЛ</th>
              <th scope="col">РАУНД</th>
              <th scope="col">ФОРМАТ</th>
              <th scope="col">ЛИМИТ</th>
              <th scope="col">CUTOFF</th>
              <th scope="col">ДАРААХ РАУНД</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.eventLabel !== null ? 'oc-cd-table-first' : undefined}>
                {/* Blank on every round after the first, so the event
                    reads as a group rather than a repeated label. The cell
                    still exists; an empty <td> keeps the columns aligned. */}
                <td>
                  {r.eventLabel !== null && (
                    <span className="oc-cd-table-event">
                      <EventIcon eventId={r.eventId} />
                      <span>{r.eventLabel}</span>
                    </span>
                  )}
                </td>
                <td>{r.roundLabel}</td>
                <td className="oc-cd-mono">{r.format}</td>
                <td className="oc-cd-mono">{r.limit}</td>
                <td className="oc-cd-mono">{r.cutoff}</td>
                <td className="oc-cd-table-next">{r.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Each explanation appears only when a row actually uses the
          concept — a definition of CUTOFF under a table with no cutoffs
          is a question the page raises and then fails to need. */}
      {(usesLimit || usesCutoff) && (
        <div className="oc-cd-notes">
          {usesLimit && (
            <div className="oc-cd-note">
              <span className="oc-cd-note-label">ЛИМИТ</span>
              <p className="oc-cd-note-body">Тайлалт лимитэд хүрвэл шүүгч зогсоож дүнг DNF болгоно.</p>
            </div>
          )}
          {usesCutoff && (
            <div className="oc-cd-note">
              <span className="oc-cd-note-label">CUTOFF</span>
              <p className="oc-cd-note-body">Раундын хоёрдугаар хэсэгт үлдэхийн тулд хүрэх ёстой цаг.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ХУВААРЬ ────────────────────────────────────────────────────────────

export function ScheduleTab({
  schedule,
  events,
  startAtMs,
}: {
  schedule: OnlineCompetitionScheduleEntry[];
  events: OnlineCompetitionEventConfig[];
  startAtMs: number | null;
}) {
  const { rows, storedStartsDisagree } = scheduleRows(schedule, events, startAtMs);
  // The rows render the RECOMPUTED times regardless (see scheduleRows);
  // this only tells a developer the stored document has drifted from what
  // its own durations say, which the admin editor never produces. In an
  // effect so it is said once per change, not on every render.
  useEffect(() => {
    if (storedStartsDisagree) {
      console.warn(
        'ScheduleTab: stored schedule startMin values disagree with the durations; showing the recomputed times.',
      );
    }
  }, [storedStartsDisagree]);

  return (
    <ol className="oc-cd-sched">
      {rows.map((r) => (
        <li key={r.key} className={`oc-cd-sched-row${r.kind === 'stale' ? ' oc-cd-sched-stale' : ''}`}>
          <span className="oc-cd-sched-time">{r.start === null ? '—' : `${r.start} – ${r.end}`}</span>
          {r.kind === 'round' && r.eventId ? (
            <EventIcon eventId={r.eventId} />
          ) : (
            // A neutral marker in the icon's slot for 'other' rows and for
            // a stale round — which deliberately loses its event glyph, so
            // it does not read as a round an athlete can enter.
            <span className="oc-cd-sched-marker" aria-hidden />
          )}
          <span className="oc-cd-sched-label">{r.label}</span>
          {r.note && <span className="oc-cd-sched-note">{r.note}</span>}
        </li>
      ))}
    </ol>
  );
}

// ── custom sections ────────────────────────────────────────────────────

/** One admin-authored section, blocks in array order. Receives only the
 *  blocks renderableSections kept — an empty text block or a video whose
 *  url no longer parses never reaches here. */
export function SectionTab({ section }: { section: OnlineCompetitionSection }) {
  return (
    <div className="oc-cd-blocks">
      {section.blocks.map((block) => (
        <SectionBlock key={block.id} block={block} sectionTitle={section.title} />
      ))}
    </div>
  );
}

function SectionBlock({ block, sectionTitle }: { block: OnlineCompetitionBlock; sectionTitle: string }) {
  if (block.type === 'text') {
    // The ЗААВАР treatment: pre-wrap, because the admin field is a
    // textarea and its line breaks are meaningful.
    return <p className="oc-cd-instructions-body oc-cd-block-text">{block.text}</p>;
  }

  if (block.type === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a Cloudinary
      // url of unknown dimensions, rendered at its own aspect ratio.
      <img
        src={block.imageUrl}
        // Empty, and knowingly so: image blocks have no alt-text field, so
        // there is no true description to give. The section title would be
        // repeated for every image and describe none of them.
        alt=""
        loading="lazy"
        className="oc-cd-block-img"
      />
    );
  }

  // video — parsed with the SAME function the admin editor validates
  // with, so a url the admin saw accepted is one that embeds here.
  const parsed = parseVideoUrl(block.videoUrl ?? '');
  if (!parsed) return null; // unreachable after renderableSections; kept total
  return (
    <div className="oc-cd-block-video">
      <iframe
        // Built from the parsed id only, never the raw url — nothing the
        // admin typed reaches the iframe except an id that passed the
        // strict patterns. youtube-nocookie / Vimeo dnt=1: see
        // videoEmbedUrl for the privacy reasoning.
        src={videoEmbedUrl(parsed)}
        title={`${sectionTitle} — ${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} видео`}
        loading="lazy"
        // No autoplay in the list: a video starts when the visitor asks.
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
        allowFullScreen
        // NOT no-referrer. YouTube's embed player now refuses to play
        // without a Referer (error 153); strict-origin-when-cross-origin
        // sends only the site origin, never the page path.
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
