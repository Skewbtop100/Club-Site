'use client';

import Link from 'next/link';
import { useOnlineAuth } from '@/lib/online-competition/useOnlineAuth';
import { rejectionSummary, resolveVerification, PROFILE_HREF } from '@/lib/online-competition/verification';
import { STATUS_TONE_COLOR, verificationNoticeCopy } from '@/lib/online-competition/registration-view';

/** THE FIRST THING A NEW ATHLETE SEES.
 *
 *  A first-time athlete used to land on the hub with nothing said to them at
 *  all: signing in creates a participant document with no verification
 *  fields (upsertGoogleParticipant), no page read that state, and the only
 *  place the rule appeared was inside the registration panel — AFTER they
 *  had picked a competition and pressed БҮРТГҮҮЛЭХ. So the way to find out
 *  that a profile has to be verified was to fail at registering. This is the
 *  same rule, said on arrival.
 *
 *  Rendered by HubNav, which every hub page has, so the notice follows the
 *  athlete rather than living on one screen they might not visit. Two
 *  exceptions, both deliberate:
 *    - the PROFILE page passes suppress — the athlete is already there, and
 *      a banner telling them to go where they are is noise;
 *    - the SOLVE page renders no HubNav, so nothing appears mid-run.
 *
 *  It reads the participant document the auth context ALREADY holds — the
 *  same one the header's avatar comes from — so this costs no extra
 *  Firestore read on any page.
 *
 *  Nothing here enforces anything. The enforcement is firestore.rules
 *  (athleteVerified, in the registrations block); this is the explanation. */
export default function VerificationNotice({ suppress = false }: { suppress?: boolean }) {
  const { user, participant, loading } = useOnlineAuth();
  // Anonymous solve-page sessions are not a returning identity, and a
  // signed-out visitor has no profile to be told about — for them the hub is
  // still just a list of competitions.
  const signedIn = !!user && !user.isAnonymous;

  // While `loading`, or before the participant read lands, say NOTHING. A
  // banner that flashes "you have not filled in your profile" at an athlete
  // who has is worse than one that arrives a moment late.
  if (suppress || loading || !signedIn || participant === null) return null;

  const verification = resolveVerification(participant);
  if (verification.verified) return null;

  const status = verification.status;
  if (status === 'approved') return null; // unreachable; keeps the union honest
  const copy = verificationNoticeCopy(status, rejectionSummary(verification));
  // Rejected is the one state where something has gone wrong. Incomplete is
  // volt because it is the athlete's move; pending is muted because it is
  // nobody's.
  const tone =
    status === 'rejected' ? STATUS_TONE_COLOR.red : status === 'pending' ? STATUS_TONE_COLOR.muted : '#DFFF4F';

  return (
    <div className="oc-v3-vnotice" role="status">
      <span className="oc-v3-vnotice-label" style={{ color: tone, borderColor: tone }}>
        {copy.label}
      </span>
      <p className="oc-v3-vnotice-body">{copy.body}</p>
      <Link href={PROFILE_HREF} className="oc-v3-vnotice-action">
        {copy.action}
      </Link>
    </div>
  );
}
