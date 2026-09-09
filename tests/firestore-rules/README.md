# Firestore rules tests

Security-rules tests for the online-competition collections, run against the
Firestore emulator. Nothing here touches the real database.

- `participants.test.mjs` — `onlineParticipants/{uid}`, the athlete profile document.
- `competitions.test.mjs` — `onlineCompetitions/{competitionId}`, the draft guard.

## Running

```bash
npm run test:rules
```

That wraps `firebase emulators:exec --only firestore`, which starts a throwaway
emulator, runs both suites against `firestore.rules` as it stands in the repo,
and shuts the emulator down. Exit code is non-zero if any assertion fails.

Requirements: the `firebase` CLI on your PATH and a JDK (the Firestore emulator
is a Java process). `.firebaserc` supplies the project id; no credentials are
needed, since the emulator authenticates nobody.

To try an edited copy of the rules without touching the deployed file:

```bash
RULES_PATH=/tmp/experiment.rules npm run test:rules
```

Deliberately **not** wired into any CI pipeline — there isn't one. This is a
script to run by hand before `firebase deploy --only firestore`.

## What it covers

### `competitions.test.mjs` — 20 assertions over `onlineCompetitions/{competitionId}`

A competition is created as a `draft` and must not be publicly visible until an
admin moves it on. The rule is:

```
allow read: if isAdmin() || resource.data.status != 'draft';
```

| Group | Asserts |
| --- | --- |
| 1–3 | A draft is unreadable by id to anonymous and signed-in non-admin clients; a club admin may read it. |
| 4–7 | Every non-draft status stays publicly readable, including the pre-migration `'active'` string. |
| 8, 8b | A doc with **no** `status` field is *not* publicly readable — the deliberate price of the guard (see below). Admins still read it. |
| 9–9c | An **unfiltered** list is refused for non-admins. This is the assertion the feature rests on. |
| 10–11b | `where('status','==','draft')` is refused; `where('status','!=','draft')` — the exact query `fetchAllCompetitions` issues — is allowed and returns no draft. |
| 12–14 | Writes are admin-only, unchanged by this work. |
| 15–16 | A draft's `scrambles` subcollection **is** still readable by any signed-in user (recorded gap, see below); its `roundState` is not. |

#### Why this rule is not a copy of the `virtualCompetitions` one

`virtualCompetitions` (firestore.rules) guards drafts with an extra clause:

```
allow read: if isAdmin() || !('status' in resource.data) || status != 'draft';
```

That middle clause **silently defeats the guard on list queries**. Because the
rule permits documents lacking the field, Firestore can no longer statically
prove an unfiltered query is safe — and rather than refusing it, it allows the
query and returns the drafts. Verified against the emulator: with that clause,
an anonymous `getDocs()` of the whole collection succeeds and includes every
draft. Direct `get()` of a draft is still correctly denied, which is what makes
it easy to miss.

`onlineCompetitions` therefore omits the clause. The cost is case 8: a doc with
no `status` field is unreadable rather than public. That is theoretical (every
doc `toFirestoreDoc` writes has a status, and the type declares it required) and
costs nothing on the public list, which uses an inequality filter that skips
field-less docs regardless.

**`virtualCompetitions` still has this hole.** It is a separate, club-side
feature with its own admin UI that reads drafts through the client SDK, so
fixing it needs its own change and its own tests — not done here.

#### Recorded gap: subcollections

The guard is on the competition document only. `scrambles` is
`allow read: if isSignedIn()` and does not consult its parent, so a signed-in
athlete who knows a draft's id can read its scrambles (case 15, asserted as
ALLOW so the gap is a tested fact rather than an oversight). Left open
deliberately: closing it costs a `get()` of the parent on every scramble read,
and a draft has no rounds opened and so no scrambles to leak.
`roundState`, `qualifiers` and `scrambleData` are `if false` for every client.

### `participants.test.mjs` — 33 assertions over `onlineParticipants/{uid}`
The rules there are subtle for one
reason worth knowing before you read the tests: **every client write is a merge or
update, so `request.resource.data` is the full resulting document**, not the
payload. An existing `profileStatus` is carried forward whether the client
mentioned it or not, which means the rules cannot tell "explicitly wrote
`approved`" from "left `approved` alone". They instead forbid the value from
*changing* to `approved`, which is the only case that grants anything.

| Group | Asserts |
| --- | --- |
| 1–2 | An `incomplete` athlete may submit, and a `rejected` one may resubmit (`profileStatus: 'pending'`). |
| 3, 3b, 3c | An `approved` athlete cannot change a reviewed identity field while omitting `profileStatus` — by merge write, by `updateDoc`, or by deleting `profileStatus` outright. |
| 4 | An `approved` athlete **may** edit identity when the write also carries `profileStatus: 'pending'` — an edit sends them back to the review queue rather than being blocked. |
| 5a–5e | `profileStatus` may not change to `approved` from `pending`, `rejected` or `incomplete`; nor may an `approved` athlete keep `approved` while changing identity. An unchanged `approved` with no identity change is allowed — that case is indistinguishable from the sign-in upsert (see N1). |
| 6a–6e | A client may not write, change or erase any admin-owned field: `approvedPhotoUrl`, the `approved*` identity snapshot, or `stats`. |
| E1–E6 | Each reviewed field individually — `lastName`, `firstName`, `dateOfBirth`, `gender`, `citizenship`, `photoUrl` — is guarded on its own. |
| E7 | `photoPublicId` is *not* reviewed and stays freely editable. |
| N1–N4 | The sign-in upsert (`upsertGoogleParticipant`: `displayName` / `photoURL` / `email` / `createdAt`) keeps working on an `approved` doc, a `pending` doc, a brand-new doc, and with a null Google avatar. Every one of these was denied before the rules were fixed. |

Note `photoUrl` (the submitted verification photo, reviewed) is a different field
from `photoURL` (the Google avatar the sign-in upsert syncs, not reviewed). The
casing is the whole difference, and N4 exists to pin it down.

Admin SDK writes — approval/rejection and the `stats` recompute — bypass rules
entirely and are therefore out of scope here.
