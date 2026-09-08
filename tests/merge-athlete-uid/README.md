# Merge tool fixture test — `scripts/merge-athlete-uid.mjs`

Runs the **real merge script** against the Firestore emulator over a synthetic
fixture, then asserts the end state. 84 assertions.

## Running

```bash
npm run test:merge
```

Same shape as `npm run test:rules`: `firebase emulators:exec --only firestore`
starts a throwaway emulator, runs the suite, and shuts it down. Non-zero exit if
any assertion fails.

Requirements: the `firebase` CLI on your PATH and a JDK (the Firestore emulator
is a Java process). No credentials — the emulator authenticates nobody.

**This cannot touch production.** `emulators:exec` sets `FIRESTORE_EMULATOR_HOST`
for this process and every child it spawns, which is what firebase-admin routes
on; the suite refuses to start if that variable is missing. The merge script is
invoked as a real child process, so what is tested is the shipped code path, not
a re-implementation.

Deliberately **not** wired into CI — there isn't one. Run it by hand before
using the merge tool for real.

## The fixture

Four athletes: **OLD** (approved, full profile, two-event `stats`), **NEW**
(fresh — Google fields only, plus one leftover `stats` key), and two
**bystanders** who must come through untouched.

| Category | Fixture |
| --- | --- |
| B registrations | 2 under OLD, one carrying a `results.333` object |
| C submissions | 3 on OLD, 1 on a bystander |
| D season points | athlete doc for OLD, plus one for a bystander |
| E notifications | 3 on OLD (2 unread, 1 read), 1 on a bystander |
| F qualifiers | `uids: [OTHER1, OLD, OTHER2]` — OLD at **index 1 of 3** |
| G groupAssignments | `{ OTHER1: 0, OLD: 2, OTHER2: 1 }` |

## What it asserts

**Pure functions (17)** — `replaceUidInArray` and `rekeyAssignments`, exported
from the script. These cover the branches the fixture cannot easily reach: old
uid absent, at index 0, last, the only entry, an already-migrated document, an
empty/missing container, a falsy group index (`0`), and that neither input is
mutated.

**Fixture, after one `--commit` run (56)** — grouped 1–8: the qualifiers array
keeps its length and *position* (placement order, so appending would be wrong);
the assignments map loses the old key and gains the new one carrying the same
group index, with both bystanders' entries intact; every submission and
notification carries the new uid and none the old, with read/unread preserved;
registrations move with their `results` object and leave nothing behind; the
season doc moves with `displayName`/`photoURL` refreshed from the new account;
the merged profile takes `uid`/`email`/`displayName`/`photoURL` from NEW and
everything else from OLD including `createdAt`, with `stats` **replaced**
wholesale rather than deep-merged; the old doc is tombstoned but still exists;
and both bystander participant docs are byte-identical in every field.

**Idempotency (8)** — two further runs:

- **Run 2** repeats the merge on an already-merged athlete. It must abort on the
  `mergedInto` guard, exit non-zero, and leave the world byte-identical.
- **Run 3** clears the tombstone first, reproducing the state an *interrupted*
  run leaves behind, and re-runs with `--resume`. This is what exercises the
  "already migrated" skip branches inside the F and G transactions — without it,
  a resumed run's most delicate path would be untested. It must exit 0 and change
  nothing but the re-applied tombstone.

## Why the script exports two functions

`replaceUidInArray` and `rekeyAssignments` were lifted out of the commit path so
their branches could be tested directly; the script uses them for both planning
and committing, so the tested code is the used code. Importing the script does
not start a merge — `main()` runs only when it is invoked directly.
