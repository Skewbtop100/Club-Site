'use client';

import { useEffect, useMemo, useState } from 'react';
import type { OnlineCompetitionAdminView } from '@/lib/online-competition/types';
import { roundKey, type ScrambleRoundData } from '@/lib/online-competition/scrambles';
import { EventChips, eventLabel, roundTitle } from './shared';
import ScrambleDiagram from './ScrambleDiagram';

// ── Tab 03 · Холилт ──────────────────────────────────────────────────────
// The imported move sequences themselves, one section per round+group.
// Read-only on purpose: these are the competition's official scrambles, so
// the only way to change them is to import a corrected file on the Файл
// tab — there is no edit affordance here to hand-tamper with them.

export default function ScrambleTextTab({
  competition,
  scrambleData,
}: {
  competition: OnlineCompetitionAdminView | null;
  scrambleData: ScrambleRoundData[];
}) {
  const choices = useMemo(() => {
    const ids = [...new Set(scrambleData.map((d) => d.eventId))];
    return ids.map((eventId) => ({
      eventId,
      label: eventLabel(competition, eventId),
      count: scrambleData.filter((d) => d.eventId === eventId).length,
    }));
  }, [scrambleData, competition]);

  const [eventId, setEventId] = useState<string | null>(null);

  // Follow the data: default to the first event, and recover if the
  // selected one disappears (competition switch, fresh import).
  useEffect(() => {
    setEventId((current) =>
      current && choices.some((c) => c.eventId === current) ? current : (choices[0]?.eventId ?? null),
    );
  }, [choices]);

  const rounds = scrambleData.filter((d) => d.eventId === eventId);

  if (scrambleData.length === 0) {
    return (
      <p className="oc-sc-empty">
        Холилт импортлогдоогүй байна. &quot;Файл&quot; хэсгээс TNoodle JSON файлаа оруулна уу.
      </p>
    );
  }

  return (
    <>
      <EventChips choices={choices} value={eventId} onChange={setEventId} />

      {rounds.map((round) =>
        round.groups.map((group, gi) => (
          <section key={`${roundKey(round.eventId, round.round)}_${group.label}_${gi}`} className="oc-sc-scrsec">
            <div className="oc-sc-scrhead">
              <h3 className="oc-sc-scrtitle">
                {roundTitle(competition, round.eventId, round.round)} · Групп {group.label}
              </h3>
              <span className="oc-sc-mono">{group.scrambles.length} холилт</span>
            </div>
            {group.scrambles.map((scramble, i) => (
              <div key={i} className="oc-sc-scrrow">
                <span className="oc-sc-scrnum" aria-hidden>
                  {i + 1}
                </span>
                <span className="oc-sc-scrtext">{scramble}</span>
                {/* Cube state AFTER this scramble, so the move text can be
                    checked against a picture. Wraps under the text on
                    narrow screens (see .oc-sc-scrdiag in theme.css). */}
                <ScrambleDiagram eventId={round.eventId} scramble={scramble} />
              </div>
            ))}
          </section>
        )),
      )}
    </>
  );
}
