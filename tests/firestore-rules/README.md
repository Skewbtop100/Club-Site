# Firestore rules tests

Security-rules tests for the club site's collections, run against the Firestore
emulator. Nothing here touches the real database.

- `users.test.mjs` — `users/{uid}`: nobody grants themselves a role, and
  `isAdmin()` (which reads that role) fails closed.
- `athlete-privacy.test.mjs` — what an athlete's data exposes: the public
  `athletes/{id}` profile, the admin/owner-only `athletes/{id}/private/identity`,
  and `users/{uid}`.
- `competition-scrambles.test.mjs` — a competition's imported WCA scrambles
  (`competitions/{id}/private/scrambles`): admin-only read and write, while
  the competition document itself stays public.
- `competition-staged-results.test.mjs` — the staged import of a past
  competition's results (`competitions/{id}/private/importedResults_{eventId}`):
  admin-only until a row is revealed as an ordinary public result.

## Running

```bash
npm run test:rules
```

That wraps `firebase emulators:exec --only firestore`, which starts a throwaway
emulator, runs every suite against `firestore.rules` as it stands in the repo,
and shuts the emulator down. Exit code is non-zero if any assertion fails.

Requirements: the `firebase` CLI on your PATH and a JDK (the Firestore emulator
is a Java process). No credentials are needed, since the emulator
authenticates nobody.

To try an edited copy of the rules without touching the deployed file:

```bash
RULES_PATH=/tmp/experiment.rules npm run test:rules
```

The online competition (ХОРОМ) and its rules tests moved to their own
repository and Firebase project.
