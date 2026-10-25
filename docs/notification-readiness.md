> **25 October 2026 update — supersedes the earlier multi-HR arbitration hold.** Hugo's decision, relayed by Hamza, is to notify all active eligible same-company HR except the author; the first recorded decision wins, peers see the processed note, and no eligible HR leaves a visible pending explanation. The manager circuit is unchanged. See `notifications-runtime.md` for the current implementation and proof. Earlier dated evidence below describes the historical draft state.

# Current runtime implementation — 23 October 2026

The draft now contains the real decision/assignment migration, restricted worker, transactional application composition and authenticated inbox/read-state page. See [the current runtime contract and runbook](notifications-runtime.md) and `docs/evidence/HA-09-Runtime-2026-10-23/` for actual-path proof. HA-05 and HA-04 are merged. Hamza explicitly left multiple-eligible-HR attribution for Hugo; this case stays visibly pending, without a guessed recipient. PR #9 remains draft / ARLA-18 In Progress for this precise unresolved rule and review acceptance.

Everything below is dated historical preparation. Its statements about missing runtime integration, disabled Actions and earlier test counts describe those earlier revisions only.

---

# Persistent read-state proposal — 23 October 2026

Rebased on merged HA-06/OpenAPI v4 main `6cfc605`. The isolated inbox proposal now records nullable `read_at` and returns `readAt` with each item (`null` means unread). `markDecisionInboxRead(client, actor, eventId)` marks only a currently visible item, rechecks current recipient/company/activation and note ownership, and preserves the first server timestamp on retries. Missing, malformed or no-longer-visible events return null. Delivery replay cannot reset read state or create another visible row; this is separate from the outbox delivery acknowledgement.

The candidate adds an owner UPDATE policy with WITH CHECK. **Only UPDATE(read_at), never table-wide UPDATE, may be granted by the final HA-04 runtime migration.** No live grant or worker permission is added. One actual restricted-LOGIN fixture proves own read-state updates, no-context refusal and denial of decision-metadata changes/cross-recipient writes. This narrow proof depends on fixture users-table reads and does not certify the entire runtime role or worker delivery.

Three new real SQL cases cover transactional read rollback, idempotent timestamp/re-delivery, current ownership/company/activation refusal and the column-restricted role. Full local `npm run test:ci` passed: **561 unit tests, 179 API/PostgreSQL tests (9 HA-09), 14 Chromium E2E**, lint, types, exact collection, production build and isolated setup/cleanup, Node 26.8.1/npm 12.0.2. Current proof: `docs/evidence/HA-09-Read-State-2026-10-23/`. Fork Actions remain disabled; no fresh remote CI proof.

This is the proposed EL-06 data/command contract, not a new live REST endpoint or accepted frontend integration. Keep draft / In Progress: actual migration, final restricted worker/runtime roles, observed transactional composition, supervised processing, validator attribution/HR selection and inbox/read-state UI/link authorization remain outstanding. No notification/email was sent to a real user. Earlier dated sections retain their original baselines.

---

# Integration check — 23 October 2026

Rebased on main `59d7709`, including LE-01/02/03/05/08/10. Full local `npm run test:ci` passed: **537 unit tests, 156 API/PostgreSQL tests (6 HA-09), 14 Chromium E2E**, lint, types, collection, production build, isolated setup and cleanup, on Node 26.8.1/npm 12.0.2. Current sanitized evidence: `docs/evidence/HA-09-2026-10-23/`. Earlier 22 October results below remain historical.

LE-08 now composes actual decision routes in `src/application/observed-decide-expense.ts` with `observeDecision`. Future activation of the HA-03 transactional intent extension must preserve that observer and its failure isolation, rather than replace this composition with an unobserved service. This draft still has no live hook or endpoint, and the schema remains outside automatic migrations.

Keep draft / In Progress: limited worker privileges, actual migration/composition and supervised processing, attribution/HR selection, inbox/read-state UI and current-link permissions are still missing. No real notification or email was sent. The existing E2E are integrated regressions, not notification UI acceptance. Merged receipt/idempotency work does not settle these contracts or activate global RLS.

---

# HA-09 — in-app decision notification preparation

[ARLA-18](https://mindsept.atlassian.net/browse/ARLA-18), updated after [PO-01, 22 October 2026](https://mindsept.atlassian.net/browse/ARLA-6). In-app notifications are retained for attribution to a validator and acceptance/refusal to the author. Emails are secondary. The old assumption that scope/channel/recipient are wholly undecided is obsolete.

**Draft, not a live notification delivery feature.** Executable database preparation is under `proposals/HA-09`, outside automatic migrations and without application imports. No notification is sent to a real user. The dormant console adapter still emits only minimal simulated diagnostics; it is not the in-app channel.

## Concrete decision-channel preparation

`enqueueDecisionNotification(client, event)` consumes HA-03's actual recorded decision event and must run on its existing transaction client through `extendTransaction`. The SQL cross-checks real history, expense owner/company and terminal status. An event ID deduplicates intent creation and never rewinds an acknowledged event. Decision, history and intent therefore share commit/rollback when composed correctly.

`PostgresInAppNotificationAdapter` implements the existing `NotificationPort`. It writes an inbox row using current recipient/expense ownership and company; no email, receipt URL or expense payload is copied. The primary key `(event_id, recipient_id)` makes retry/replay produce one visible row. It performs no network call or console logging.

`deliverOneDecisionNotification(pool, policy)` reserves one pending event with `FOR UPDATE SKIP LOCKED`, increments attempts, writes the inbox and acknowledges in one transaction. This database-only channel needs no long-lived lease: connection death releases PostgreSQL's reservation and rolls back uncommitted delivery. Statement and idle-transaction timeouts bound each attempt. A savepoint preserves attempt/error state after delivery failure without undoing the already committed business decision. Explicit bounded retry policy controls delay and terminal failure; there is no implicit production default. Failures store only static `delivery_failed`, not raw exceptions or private payloads.

`requeueFailedDecisionNotification` is a proposed operator capability that checks current active same-company HR rights, resets only failed events and refuses acknowledged ones. Its final operator/UI/SQL-role contract remains to integrate. `readDecisionInbox` returns at most 50 current-recipient rows and rechecks activation, company and expense ownership. A stale identity/company cannot expose prior-company messages. A notification never grants receipt/decision access; the target route must still enforce current rights.

For this in-app database channel, inbox insertion and acknowledgement are atomic and a unique key prevents visible duplicates. A future external provider would require its own idempotency capability and at-least-once analysis; this prototype promises nothing about external delivery.

## Work still required

- Wire the decision extension into the actual application after HA-04 provides the narrow web/worker SQL capabilities. The candidate schema enables/forces RLS and supplies author-read/intent-append policies, but deliberately includes no guessed worker grant/policy. Current tests use disposable privileged bootstrap access and do not prove RLS.
- Implement attribution notifications, including changes of manager/role/availability through HA-05/06. PO-01 must choose among multiple HR recipients. This proposal implements only the settled author-on-decision channel, not validator assignment.
- Agree and implement EL-06's real inbox/read-state/link contract and current-validator checks after reassignment. There is no live HTTP endpoint, unread-state UI, worker daemon/start-stop command or shared orchestration hook in this draft.
- Finalize actual retry/retention/operator policy and the real-role positive/negative SQL tests together with the eventual migration. Never provide the migration login to a worker.
- Keep verified-email invitation delivery separate; this prototype does not establish an email identity-proof adapter.

## Executed proof

Full `npm run test:ci` on the HA-02/HA-03/main stack passed: **348 unit tests, 65 API/PostgreSQL tests, 12 Chromium E2E**, lint, types, collection, production build, disposable preparation and cleanup. Current sanitized evidence is in `docs/evidence/HA-09-2026-10-22/`.

Six real PostgreSQL cases use the actual `DecideExpense`/Postgres adapter and private schema: joint rollback before delivery; committed decision while the worker is stopped; duplicate intent/delivery; two overlapping workers with a real held reservation; bounded failure and authorized replay; connection death after inbox insert before acknowledgement; and current recipient/company/activation filtering. The production civil-date parser is loaded when exercising the real adapter outside the application composition. The private schema is dropped after tests; no real account or delivery channel is involved.

Reproduction: `npm ci && npm run test:ci`. The suite consumes the shared explicitly isolated CI marker/connection, checks loopback and `_test`, and has no personal database fallback. These backend and existing-browser regression results do not certify an unimplemented notification UI or restricted worker role. Keep Jira In Progress and the PR draft.
