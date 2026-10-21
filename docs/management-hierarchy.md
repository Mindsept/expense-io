# OpenAPI integration delivered — 23 October 2026

The delivered contract is now `docs/openapi/expense-io.v4.json` (4.0.0). It includes both actual HA-06 routes, strict lifecycle/routing schemas, the shared optional author metadata, and the static `manager_cycle` / `last_active_hr` 409 variants. The shared validator reads v4; exact route, method and unique-operation checks remain in place for all 17 files. The superseded HA-06 proposal was removed rather than kept as a second source of truth.

Real HTTP checks validate lifecycle success, malformed/forged fields, anonymous/wrong-role/foreign refusals, last-HR protection, lock contention, current-owner routing and safe malformed-ID failure. Mutations of real DTOs and private author fields are refused by the schema. No test is skipped or relaxed.

Migration `1792749601000_hamza_management-audit.sql` is ordered **after** merged LE-03. Its earlier unpublished filename would fail the migration runner's strict ordering on an existing database and has been replaced before merge. A real node-pg-migrate test migrates the pre-HA-06 schema, creates synthetic existing notes/history, upgrades, rolls back this one migration and reapplies it, preserving the business snapshot throughout. Only private disposable schemas are used; no developer database is migrated.

Full local `npm run test:ci` passed: **556 unit tests, 170 API/PostgreSQL tests (18 HA-06), 14 Chromium E2E**, lint, types, exact collection, production build, disposable setup and cleanup. Runtime: Node 26.8.1/npm 12.0.2. Current proof: `docs/evidence/HA-06-OpenAPI-2026-10-23/`. Earlier failed inventory evidence in `docs/evidence/HA-06-2026-10-23/` is historical and resolved by this version. GitHub's Actions page reports that fork workflows are disabled; no fresh remote CI/Node-24 success is claimed.

Backend workflow contract for EL-06:

| Author situation | Eligible current validator / displayed result |
| --- | --- |
| Non-HR with active same-company direct manager | Direct manager; no self-approval |
| Non-HR without such a manager, active HR available | Same-company HR recourse |
| HR with another active same-company HR | Peer HR; no self-approval |
| HR without another active HR | Pending, explicit no-peer explanation |
| Non-HR without any active validator | Explicit unresolved routing reason; no fabricated approval or assignee |
| Note already decided | Recorded status; no second decision |

This merges the approved backend independently of EL-06 controls/waiting-state UI, HA-05 affiliation, HA-04 runtime isolation and HA-09 notifications. Selection among multiple HR for notification attribution and the no-validator non-HR product rule remain PO work. A backend merge and green automated tests are not human relecture or complete product acceptance; do not mark the whole ticket Done on that basis.

---

# HA-06 — organization and lifecycle, 22 October 2026

[ARLA-15](https://mindsept.atlassian.net/browse/ARLA-15), following [PO-01](https://mindsept.atlassian.net/browse/ARLA-6). This backend delivery is independently validated. Frontend integration and the remaining routing/notification-assignment decisions remain separate and are not claimed complete.

## Delivered backend

Manager assignments reject direct, indirect, concurrent and historical cycles and invalid cross-company ancestry. Explicit null removes an edge and can repair a historical cycle. A pure iterative graph rule stays independent of HTTP and PostgreSQL. Selected managers must be active, same-company managers. All current graph/lifecycle writers use the same company transaction advisory lock before candidate row locks. Candidate locks use NOWAIT; a conflicting manager actor/author read produces a retryable static busy 409 and rolls back acquired locks. No automatic retry is performed.

`PUT /api/hr/users/{id}/access` accepts only optional `role: employee|manager|hr_admin` and `isActive: boolean`, at least one present. Only a current active same-company HR can call it. Role/company claims in a submitted object cannot authorize a change. Promotion to HR clears that user's reporting edge. Deactivation preserves the user, expense notes and historical decisions; it does not delete or transfer accounts. HA-02 revokes access/current role on the next request.

Demoting or deactivating the last active HR is a 409 `last_active_hr`, with an actionable replacement message. The count and mutation share the company serialization protocol, including concurrent self-demotions: exactly one can succeed when two HR remain. Future organization writers and privileged enrollment/bootstrap interfaces must adopt this protocol before integration. A raw administrator SQL command is outside this application-level guard; HA-04 owns restricted SQL capabilities.

`management_changes` records actor/target UUIDs, server time and before/after role, activation and manager state in the same transaction. No-op updates create no extra event. An audit failure aborts the mutation. IDs are snapshots rather than deletion-blocking user FKs; company deletion cascades only this company's audit. No hard-delete API is introduced. Policies are delivered with the table, but real restricted-role privileges and negative SQL proof remain HA-04. Self-demotion appends its audit while original HR rights still exist, before the mutation; rollback covers both.

Approval lists consume LE-12's existing mapper and optional `author: { id, displayName }` extension. They expose no author email. The approved eligibility predicate comes from HA-02 and is shared with HA-03: manager direct reports, peer HR, same-company HR recourse, never self-approval. Reassignment moves pending-note eligibility without rewriting previous decisions.

`GET /api/expense-notes/{id}/validation-status` is an owner-only contract for EL-06. It returns `{ status, validation: { kind, reasonCode, message } }` from current rows, not simulated state. Reasons include `direct_manager`, `peer_hr`, `hr_recourse`, `no_other_active_hr`, `routing_policy_pending`, and `already_decided`. For an HR with no active peer, the note remains pending with an explicit French explanation. For a non-HR with no validator, the unresolved rule is reported explicitly. It does not choose which of several HR receives a notification.

## Remaining integration

- Elyes must wire role/activation controls, the waiting explanation/status endpoint and busy/last-HR conflicts into the UI. Keep the prior displayed state after failure; re-read current state after success. Existing UI files are owned separately and are not edited here.
- PO-01 must settle notification assignment among several eligible HR and the no-validator non-HR case. Eligibility is implemented; no arbitrary recipient, second approval stage or self-approval exception is added.
- HA-05 must integrate invitation/bootstrap affiliation and use the same lifecycle capability boundaries. HA-04 must inventory the new table/policies and validate runtime/worker roles.
- Existing orphaned or cyclic data is not silently repaired. Inventory it, choose explicit repairs with the owner, preserve decisions/history and rehearse recovery on a backup before rollout. Explicit edge removal is available now.
- Migration `1792749601000_hamza_management-audit.sql` must run before this code. HA-03's earlier history migration must be integrated first on an existing database; fresh databases run both in numeric order.

## Executed evidence

On the integrated HA-02/HA-03/CI stack, full `npm run test:ci` passed: 363 unit tests, 74 PostgreSQL/API tests and 12 Chromium E2E, plus lint, types, collection, production build, disposable setup and cleanup. New real cases prove lifecycle changes, role refresh, no-op audit deduplication, concurrent last-HR protection, wrong-role/company/field refusal, actual waiting reasons, author metadata and rollback when audit insertion fails. Existing graph races and assignment/manager-read contention still pass. These dated logs remain in `docs/evidence/HA-06-2026-10-22/`; the current campaign is documented above.

These are backend and existing browser regression proofs, not acceptance of the unimplemented new frontend controls or actual RLS. Human relecture and full product/frontend acceptance remain required before declaring the whole ticket complete.
