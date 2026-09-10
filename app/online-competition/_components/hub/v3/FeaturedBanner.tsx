import Link from 'next/link';
import type { OnlineCompetition } from '@/lib/online-competition/types';
import { fmtTime } from './util';

/** The hub's featured-competition banner — the first thing on the page,
 *  above УДАХГҮЙ БОЛОХ ТЭМЦЭЭН.
 *
 *  Read-and-display only. Which competition reaches here (and whether one
 *  does at all) is pickFeatured's decision, made from `featured` and
 *  `featuredUntil`; this component never re-decides. In particular it does
 *  NOT hide itself when the copy is empty — an empty heading is a banner
 *  with no eyebrow, not a banner that should not exist, and the two must
 *  not be confused (see the header comment in featured.ts).
 *
 *  Deliberately NOT LiveHero. That is the currently-live competition's
 *  hero, with its own eyebrow rule, its year-splitting title and its fixed
 *  "Бүртгүүлэх" CTA. This one is admin-authored end to end — the eyebrow,
 *  the CTA label and the artwork are all fields — so sharing a component
 *  would mean one of them constantly overriding the other's values. */
export default function FeaturedBanner({ competition }: { competition: OnlineCompetition }) {
  const heading = (competition.featuredHeading ?? '').trim();
  // The one fallback the brief asks for: an admin who features a
  // competition without writing a CTA still gets a working button.
  const cta = (competition.featuredCtaLabel ?? '').trim() || 'Дэлгэрэнгүй';
  const bannerUrl = competition.bannerUrl ?? null;

  const meta = [
    competition.events.length > 0 ? `${competition.events.length} төрөл` : null,
    // The spec's meta line is "{registered} / {limit} тамирчин", but the
    // registered half is NOT PUBLICLY READABLE: registrations live at
    // onlineParticipants/{uid}/registrations, whose rule is
    // `allow read: if isSignedIn()` on the individual document, with no
    // collection-group rule — so an anonymous hub visitor cannot count
    // them, and a signed-in one cannot query across uids either. LiveHero
    // hit the same wall and resolved it the same way: show the capacity
    // the competition actually declares rather than invent a count.
    // ∞ for unlimited, matching the admin list's ТАМИРЧИН column.
    `${competition.participantLimit ?? '∞'} тамирчин`,
    competition.startAt ? fmtMonthDay(competition.startAt.toMillis()) : null,
    competition.startAt ? fmtTime(competition.startAt) : null,
  ].filter(Boolean) as string[];

  return (
    <section
      className="oc-v3-feat"
      // Inline because the url is per-competition data, not a theme value.
      // No url and the CSS's own #0D0D10 shows through — a plain dark
      // block, never a hidden banner.
      style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
    >
      {/* The gradient sits in its own layer rather than being stacked into
          background-image, so the artwork above can be swapped by the
          inline style without restating the gradient every render. */}
      <div className="oc-v3-feat-scrim" aria-hidden />

      <div className="oc-v3-feat-body">
        <div className="oc-v3-feat-content">
          {heading && <p className="oc-v3-feat-eyebrow">{heading.toUpperCase()}</p>}
          <h2 className="oc-v3-feat-title">{competition.name}</h2>
          {meta.length > 0 && (
            <p className="oc-v3-feat-meta">
              {/* Each segment is its own element so the separator can be
                  dropped by CSS when the line wraps on a narrow screen —
                  a leading "·" on a wrapped row reads as a bullet list
                  that has lost its first item. */}
              {meta.map((part) => (
                <span key={part} className="oc-v3-feat-meta-part">
                  {part}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="oc-v3-feat-cta-wrap">
          <Link href={`/online-competition/${competition.id}/details`} className="oc-v3-feat-cta">
            {cta}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** "09.12" — the meta line's date. Not util.ts's fmtDate, which is the
 *  full "2026-09-12" the hero and table rows use; the banner's line is
 *  already long and the year is carried by the competition name. */
function fmtMonthDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}
