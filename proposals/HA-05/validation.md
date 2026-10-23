> Historical campaign from 21 October. For the current public signup guard and 23 October results, see [README.md](README.md) and `docs/evidence/HA-05-Signup-Guard-2026-10-23/`. The invitation flow is still incomplete; the current draft refuses public enrollment.

# HA-05 draft validation — 21 October 2026

Base: `9465225` on `Mindsept/expense-io/main`. Node `v26.8.1`, npm `12.0.2`,
tracked Vitest `5.0.5`, Playwright `1.64.1`, PostgreSQL `16-alpine`.

This evidence applies to the isolated proposal, **not the live signup route**.
No approved identity-proof adapter, issuer authorization, administered bootstrap,
restricted-role/RLS integration, HTTP signup contract or browser flow is
implemented. The existing domain-based affiliation and first-RH behavior remain
unchanged and unsafe. This PR remains draft pending the decisions listed in
[the proposal](README.md).

## Results obtained

| Command/check | Actual result |
| --- | --- |
| `npm ci` | Exit 0; no dependency or lockfile changes. Existing 8 affected-package audit result remains outside this ticket. |
| `npm run lint` | Exit 0. |
| `npm run typecheck` | Exit 0. |
| `npm run test:unit -- tests/unit/hamza/HA-05` | 13 passed: token generation/digest, input/token validation before DB acquisition, and bounded connection-failure messages. |
| `npm run test:unit` | 151 passed, including the 13 new candidate tests and all 138 baseline tests. |
| `npm run test:api -- tests/api/hamza/HA-05` | 9 PostgreSQL integration tests passed through Playwright, without a browser or HTTP server. |
| `npm run build` with a private generated `AUTH_SECRET` | Exit 0. Candidate files are not imported by the application. |
| `git diff --check` | Exit 0. |
| Post-test cleanup | No remaining `ha05_*` schemas; dedicated test container and network stopped/removed. |

The SQL cases prove successful explicit-company employee creation with hashed
password/token; exactly one consumer for simultaneous redemption; refusal of
expired, revoked, wrong-identity and forged invitations; no reassignment of an
existing account; rollback after an injected failure between account insertion
and invitation consumption; and expiry rechecking after insertion begins.

They use real PostgreSQL locks, constraints, transactions and deliberately
installed test-only triggers. The concurrency test confirms through
`pg_stat_activity` that both consumers are waiting for the invitation row lock
before releasing them, so a sequential schedule cannot supply the evidence.
The expiry test deterministically changes expiry
inside a test trigger to prove that consumption re-reads it; it is not a claim
about production time synchronization. The test role owns the schema, so these
results do not establish HA-04's least-privilege/RLS behavior.

## Reproduction

From the repository root, use only the explicitly disposable fixture project.
Its credentials below are public, local-test-only values; they are not runtime
secrets or suitable for another environment. The database port is loopback-only
and data is held in temporary storage.

```sh
npm ci
npm run lint
npm run typecheck
npm run test:unit
docker compose -p expense-ha05-proposal-test -f tests/fixtures/hamza/HA-05/compose.yml up -d --wait
HA05_TEST_DATABASE_URL=postgres://expense_ha05_test:local-disposable-test-only@127.0.0.1:55414/expense_ha05_test npm run test:api -- tests/api/hamza/HA-05
docker compose -p expense-ha05-proposal-test -f tests/fixtures/hamza/HA-05/compose.yml down
```

The integration suite checks loopback and the `_test` database suffix before
writing. It creates a random `ha05_<uuid>` schema, copies the existing table
definitions into it (PostgreSQL 16 supplies UUID generation without a global
extension), applies only the candidate invitation table there, and drops that
schema afterwards. It never truncates, resets or migrates the application's
public tables. If a run is interrupted, inspect/remove only its own test schema
or stop the dedicated disposable fixture project; never run the application's
`make clean` for this test.

For the build check, provision the ignored local secret using
`node scripts/generate-auth-secret.mjs`, then run `npm run build`. No raw
invitation token, password, cookie or generated auth secret is committed or
printed by the candidate. All capabilities/passwords used in tests are generated
at execution time and consumed only in memory.

## Acceptance still not demonstrated

- The deployed signup no longer trusts an asserted email domain or assigns RH.
- The chosen proof genuinely establishes affiliation under PO-01's policy.
- The inviter/administrator has current authority, and token delivery is safe.
- The future enrollment and bootstrap work under HA-04's restricted roles.
- Approved signup/login screens correctly preserve account-created state,
  framework navigation, and uncertain-commit recovery.
- Legacy identities/domains migrate without unintended affiliation changes.

Those are explicit remaining gates, not failures hidden by skipped tests. The
candidate tests are collected and executed; no `skip` or expected-failure marker
is used to label the full ticket complete.
