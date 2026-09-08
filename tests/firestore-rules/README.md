# Firestore rules tests — `onlineParticipants`

Security-rules tests for the online-competition athlete profile document,
run against the Firestore emulator. Nothing here touches the real database.

## Running

```bash
npm run test:rules
```

That wraps `firebase emulators:exec --only firestore`, which starts a throwaway
emulator, runs the suite against `firestore.rules` as it stands in the repo, and
shuts the emulator down. Exit code is non-zero if any assertion fails.

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

27 assertions over `onlineParticipants/{uid}`. The rules there are subtle for one
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
