# HA-03: atomic expense decisions in a modular monolith

Status: implemented against PO-01 decisions of 22 October 2026 and HA-02 `72b6eab` on main `a0a0ab0`. Human relecture remains required for Jira closure. The current matrix is shared with HA-02 through `expenseValidatorSql`; this document and the PR do not claim RLS activation or notification delivery.

## Context and decision

The four manager/HR approve/reject routes previously repeated a read followed by a write. A pending note must transition once, with its audit event committed in the same transaction. An invisible note must remain 404; an already decided visible note must return 409, including a repeat of the successful decision.

Keep a modular monolith: `DecideExpense` owns the transition rules through `ExpenseDecisionPort`, independently of HTTP, Next.js, PostgreSQL, storage and metrics. `PostgresExpenseDecisionAdapter` implements the port. The application service composes the domain with HA-02's `withCurrentActor` transaction. All four routes call this service and return the existing success DTO through the real LE-12 `toExpenseNote` mapper. No parallel DTO conversion is introduced.

The transaction reloads and locks the current actor through HA-02, reads the authorized expense owner under `FOR SHARE`, and updates only a note whose status is still `pending` and whose owner still matches the authorized scope. The conditional `UPDATE` serializes competing decisions on the expense row; PostgreSQL rechecks the predicate after waiting. A zero-row update is followed by an authorized visibility check to distinguish 404 from 409. Actor/owner locks prevent concurrent role or reporting-line edits from invalidating authorization before commit. The mapper, history append and optional transactional extension all execute before commit. Any failure rolls everything back.

Rejected alternatives: an unguarded read-then-update allows lost decisions; appending history after commit allows a final status without its audit event. A distributed service or broker is unnecessary for this single-database invariant. This does not solve expense creation idempotency or measure general system load.

## Approved eligibility and history contract

The PO-01/HA-02 matrix applies: a current active manager decides non-HR direct reports in the same company; a current active HR decides another HR’s note or provides recourse when a non-HR author has no active same-company manager of manager role. Self-approval is always denied. Disabled authors’ retained notes remain processable; disabled validators cannot use the application. Reassignment changes current eligibility without rewriting historical events. Choosing a notification recipient among several HR and the no-validator non-HR routing rule remain PO-01/HA-09/HA-06 work; this use case does not invent either.

Proposed for EL-06 and LE-10: `GET /api/expense-notes/{id}/history` returns:

```json
{
  "items": [
    {
      "id": "event UUID",
      "fromStatus": "pending",
      "toStatus": "approved",
      "decidedAt": "2026-10-21T12:34:56.789Z",
      "actor": { "id": "actor UUID", "displayName": "Name at decision time" }
    }
  ]
}
```

The owner, current authorized manager or current authorized HR can read history, including after a decision. The route locks the note and owner while checking visibility and reading events. An authenticated actor outside that scope gets 404, an unauthenticated actor gets 401, and a visible note with no recorded event gets `items: []`. Events are sorted by server timestamp then event UUID. No email, receipt data, storage key or exception is exposed.

Actor display name and company are snapshotted at decision time; current authorization still determines access. Renaming an actor does not rewrite the displayed author. If a note owner moves to a different company, the old company's events are not returned to the new company, even when the note itself becomes visible there. The history JSON contract remains an explicit LE-10/EL-06 integration handoff; the frontend must use this endpoint rather than direct SQL.

## Schema and deployment

Apply the new, author-prefixed migration `1792584000000_hamza_decision-history.sql` before deploying the routes. Its name was reserved with the coordinating author. No original migration changes. Existing code ignores the new table.

The table contains server-generated event UUID/time, expense/actor/company references, actor display-name snapshot and constrained pending-to-approved/rejected states. A unique expense reference enforces one terminal decision event under the current lifecycle. Reopening a note would require an explicit schema and business-rule change. Existing decided notes are not backfilled with invented authors or times.

History follows the expense lifetime through `ON DELETE CASCADE`; the actor reference prevents deleting a referenced author. No delete API is added. Retention, deletion and reopening policies remain product decisions. The down migration drops the new history table and therefore requires an appropriate backup before any real rollback; only disposable test databases were migrated here.

The table enables and forces RLS with SELECT and INSERT policies matching the approved eligibility matrix and company snapshot. There is no UPDATE/DELETE policy. HA-04 still owns runtime-role privileges and verification using the actual restricted application role. The HTTP proofs below used a disposable PostgreSQL superuser, as the existing development setup does: they prove application authorization and transaction behavior, **not** effective least-privilege RLS enforcement.

## Integration points

For HA-09, `createDecideExpenseService({ extendTransaction })` accepts an awaited callback receiving the same `PoolClient` and immutable decision event (event/expense/company/owner/actor IDs, states and UTC time). It may insert an outbox record using that transaction. It must not send notifications or call COMMIT, ROLLBACK or release itself. Its failure rolls back both status and history. No notification delivery or outbox is implemented here.

For LE-08, `createDecideExpenseService({ observe })` accepts an optional observer with an immutable diagnostic: `operation: 'DecideExpense'`, monotone `durationMs`, `result: 'success' | 'conflict' | 'denied' | 'error'`, and optional validated UUID `requestId`. Results include authentication, conflict, history and commit failures; success is emitted only after commit. A safe structured log is emitted by default. The event contains no actor/tenant/expense IDs, received payload, SQL, exception or secret. Synchronous observer exceptions and rejected promises are isolated; asynchronous completion is not awaited. A synchronous observer must remain short because its synchronous work still runs on the request thread.

HA-07's `withApiHandler` now optionally supplies its frozen `{ requestId }` context to the callback. Existing zero-argument handlers remain compatible. The four routes pass that server-generated/validated correlation ID to the decision service. LE-08 can use the service composition seam or consume its structured event without editing the domain, `lib/db.ts` or `lib/errors.ts`.

## Reproduction and evidence

Validated on 2026-10-21 against the exact ancestors above, with locked dependencies installed by `npm ci`, PostgreSQL 16, and a production Next server. No package manifest, lockfile, shared runner config or Leandro-owned source changed.

Run `npm ci`, `npm run lint`, `npm run typecheck`, and `npm run test:unit`. Set a private stable `AUTH_SECRET` as documented in HA-01 before `npm run build`; do not use a checked-in value. For the HTTP proofs, create a separate loopback PostgreSQL database ending in `_test`, apply migrations with `DATABASE_URL` pointing to it, then start the built app against that same database. Set `AUTH_TRUST_HOST=true` for this local server. Never use a development or production database for these fixture-writing tests.

The HA-03 suite requires `HA03_TEST_BASE_URL` (loopback app URL), `HA03_TEST_DATABASE_URL` (the same loopback `_test` database), and a private `HA03_TEST_PASSWORD` for generated fixtures. Run:

```sh
npm run test:api -- tests/api/hamza/HA-03
```

The HA-02/HA-07 regression suites use their respective `HA02_TEST_*` and `HA07_TEST_*` variables pointing to the same disposable app/database; see their suite guards and existing documentation. Receipt URL tests require local dummy S3 configuration; no real receipt upload or external notification is performed.

Actual results:

- Clean `npm ci`, lint, typecheck and production build: passed.
- Full unit collection: **194 passed across 7 files**, including **25 HA-03 tests**.
- HA-03 real HTTP/PostgreSQL collection: **12 passed**. All four routes preserve the exact shared success DTO and append one event. A held expense-row lock establishes overlapping approve/reject requests at the PostgreSQL UPDATE; releasing it produces exactly one 200, one 409, one final status and one matching event. A repeated winner returns 409 without another event.
- The same suite proves hidden foreign resources stay 404 without writes, an injected history constraint failure leaves the note pending with no event, real authenticated history access follows owner/manager/HR scope, actor name is snapshotted, and moving an owner to a different company does not disclose prior-company events.
- HA-02 and HA-07 HTTP regressions: **24 passed**, including owner-reassignment and manager-role races against the extracted adapter.
- Application-log inspection: 34 decision diagnostics (10 success, 4 conflict, 18 denied, 2 error), all correlated with HTTP diagnostics and restricted to the documented fields; no test secret, database URL/password, injected constraint name, SQL or receipt key found.
- Unit tests independently prove domain transitions, zero-row outcome classification, transactional extension ordering/failure, commit failure classification, observer receipt and thrown/rejected/never-completing collector isolation.
- Migration up/down/up and `git diff --check`: passed on the disposable setup.

No browser journey, general load benchmark, production migration, notification delivery, restricted-role RLS proof or complete MATH-01 CI integration is claimed. The isolated server and database are removed after validation. Leandro's review, PO-01 decisions, HA-02 final scope, LE-10 contract acceptance and MATH-01 validation ownership remain explicit handoffs.

## Revalidation after PO-01, 22 October 2026

Rebased on HA-02 `72b6eab`, which includes main `a0a0ab0` and the actual CI foundation. Both the PostgreSQL adapter and authorized history endpoint now consume the shared approved eligibility predicate. History policies also reject inactive actors and self-decisions, and implement peer-HR and inactive-manager recourse.

Full `npm run test:ci` passed on Node 26.8.1: **343 unit tests, 59 API/PostgreSQL tests and 12 Chromium E2E**, including lint, types, collection, production build, migrations/fixtures and cleanup. The 15 HA-03 API cases include peer-HR decisions with real history and inactive-author/manager recourse in addition to the original concurrency, repeated conflict, rollback, DTO and snapshot proofs. The original dated evidence above remains historical, not the current count. The production diagnostics remain field-limited and no external notification is sent.

Sanitized current summaries and test logs are in `docs/evidence/HA-03-2026-10-22/`. HA-04 still owns actual restricted-role verification; these HTTP tests use the disposable bootstrap role. Human relecture, LE-10/EL-06 integration and notification implementation are not claimed by an automated test.

The shared eligibility helper also treats a historical self-manager link as an unavailable validator: self remains denied and same-company HR recourse works, with one real history event. The PostgreSQL history policies use the same condition. This case is included in the current 59 API count.
