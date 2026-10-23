# HA-02 — current accounts and approved authorization

Ticket: [ARLA-11](https://mindsept.atlassian.net/browse/ARLA-11). Product rules: [PO-01, decisions of 22 October 2026](https://mindsept.atlassian.net/browse/ARLA-6).

## Behavior

Every owned operation reloads the authenticated actor inside its transaction. Deleted or disabled accounts receive 401; a current incompatible role receives 403; an invisible resource receives 404. Session reads also reload current role/email and invalidate disabled/deleted identities, covering pages, navigation and other authors' authenticated routes without editing those routes. Login refuses inactive accounts. An old signed JWT cannot preserve previous privileges. A browser page already open may still display its old labels until refreshed; every subsequent server request uses current rights.

The new `users.is_active` column defaults existing accounts to true and preserves their rows, notes and history. HA-06 supplies authorized lifecycle mutations and the last-active-HR guard; this ticket provides enforcement, not a public deactivation endpoint. Migration ordering places the column before HA-03 history.

| Operation | Approved eligibility |
| --- | --- |
| Own receipt | Current active owner, including after decision |
| Manager list, receipt, decision | Same-company direct report; author is not HR and is never the acting manager |
| HR list, receipt, decision | Another HR in the same company, or a non-HR author with no active same-company manager of manager role; never self |
| Existing HR directory/assignment | Current HR and same-company eligible target; selected manager must be active and have manager role |
| Role change or manager reassignment | Next request uses the new role/relation; notes/history are retained |
| Inactive author | Cannot use the application; its retained notes remain visible to an eligible active validator |

`expenseValidatorSql` is the single owned SQL eligibility predicate for lists, receipts and decisions. It is also the integration contract for HA-03/06. The existing shared LE-12 mapper now maps the two approval lists; no competing converter is introduced. Pending lists remain arrays, preserving the established response shape.

All eligible HR may authorize a peer's note; this is eligibility, not a choice of a notification assignee among multiple HR. That selection remains PO-01/HA-09. When nobody is eligible, the note remains pending and is not silently routed to another company or its author. A visible explanation/no-validator state is an HA-06/frontend integration, not a completed UI in this ticket.

## Transactions, current rights and errors

`withCurrentActor` accepts only the authenticated user ID, reads company, role and activation state from PostgreSQL and holds the actor row `FOR SHARE` through commit. It passes a frozen actor and the existing scoped client. Author row locks stabilize role/company/manager relations for receipt and decision operations. Incomplete assignment bodies are buffered before starting a database transaction; current authorization still takes precedence over input errors.

Assignment candidate rows are locked in UUID order with `FOR UPDATE NOWAIT`. Waiting after locking a subordinate could otherwise invert the order used by a manager's actor/author reads. Only candidate-query PostgreSQL `55P03` becomes the static retryable 409 `manager_assignment_busy`; rollback releases acquired locks. Other failures retain the sanitized technical-error contract. HA-06 adds company graph serialization and complete cycle prevention separately. No automatic retry is performed.

A session database failure becomes a fixed error before Auth.js logging, without forwarding the raw SQL/connection exception. HTTP diagnostics retain the HA-07 allowlist. Disabled/deleted sessions return the normal unauthenticated Auth.js representation (`null`). Session claims submitted in an update request cannot set role/company.

## Integration and remaining boundaries

- HA-03 must consume this eligibility predicate for atomic pending decisions and history. HA-06 must use it for role/lifecycle workflows, author metadata and no-validator explanations. Their own acceptance is separate from this enforcement change.
- Leandro's routes can adopt `withCurrentActor` for the same transaction-level snapshot; current session revocation already applies when they call `auth()`. Do not open nested scopes or trust client role/company fields.
- RLS remains HA-04. These application checks and fixture credentials do not prove database isolation. Existing signup affiliation and public first-HR creation remain HA-05, and receipt/idempotence orchestration remains LE-02/03.
- No rule for selecting among several HR recipients, account recovery, deletion/reopening or a second approval stage is invented.
- Migrations must run before deploying the auth callback: login and every authenticated request now require `is_active`.

## Validation, 22 October 2026

Baseline: main `a0a0ab0` with the merged shared test/CI foundation. Commands: `npm ci`, then `npm run test:ci`, which performs lint, types, units, collection, disposable PostgreSQL/S3 setup, migration/seed, production build, API, Chromium E2E and cleanup. Generated credentials remain private and are redacted in `.ci-output/`.

The HA-02 real HTTP suite covers two companies, forged role/company inputs, deleted/disabled accounts, refreshed signed sessions, HR-peer/self decisions, active/inactive managers, historical cross-company links, retained inactive-author notes, blank receipts, invalid manager selection, streamed bodies and concurrent role/relation changes. A disposable schema separately proves activation-column upgrade/rollback preserves existing rows. No production database is used.

Exact executed counts and the successful summary are recorded in `docs/evidence/HA-02-2026-10-22/` after the campaign. Human relecture remains required before Jira closure; no automated check is represented as a human approval.
