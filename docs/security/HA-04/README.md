# Runtime isolation delivered — 23 October 2026

HA-05 is now merged on main `067382d`. This revision activates the restricted runtime contract, adds the complete role/grant/policy migration and supplies real application proofs. [Current role/capability review, operation and rollback](runtime-isolation.md). All readiness-only sections below are historical; their missing-authentication/enrollment and unchanged-runtime claims no longer describe this head.

`expense_web` is a real NOSUPERUSER/NOBYPASSRLS login, without memberships, table ownership, schema/database CREATE, DELETE/TRUNCATE or direct password/invitation-digest access. A startup guard verifies the actual current/session identities, table protection, dangerous grants and callable definer functions, rejecting a privileged deployment configuration. Separate administrator commands provision its private password; no administrator connection or fallback is present in the web process.

Seven fixed `expense_auth` functions provide bounded identity/session/current-context/eligibility and invitation operations. Their NOLOGIN/NOBYPASSRLS owner has explicit, role-only policies; functions pin search_path, qualify business tables and revoke PUBLIC EXECUTE. Real HTTP and Chromium tests use a separately provisioned runtime login without administrator environment variables. Context cleanup, company/new-value refusals, submission/idempotency/receipt, decision/history, current rights, HR lifecycle, invited signup, expiry rollback and migration down/up are exercised.

Full local `npm run test:ci` passed: **618 unit, 213 API/PostgreSQL, 19 Chromium E2E**, lint, types, exact collection, build and disposable setup/cleanup. Evidence: `docs/evidence/HA-04-Runtime-2026-10-23/`. The shared test runner still correctly labels its legacy server as privileged-bootstrap; the new HA-04 runtime suites separately provision and assert the real limited login. The 13 old readiness cases deliberately retain an old schema to prove their detection behavior. No personal database or deployed credentials were changed.

The LE-03 limited-login fixture now inherits the restricted application capabilities explicitly, so its registry policy can read the newly protected actor table without a public users policy. Its login remains NOSUPERUSER/NOBYPASSRLS; all original positive/refusal assertions remain. This is test integration only, not a change to Leandro's application routes.

The read-only inspector remains conservative: callable definer bodies still produce review flags. The seven reviewed functions and their exact trust boundary are documented separately, not hidden by weakening the inspector. Its definer inventory now includes non-system schemas, not only public.

---

Historical preparation follows.

# After HA-06 merge — 23 October 2026

Rebased on main `6cfc605`, with delivered OpenAPI v4 and management lifecycle/audit. The fixture now applies all five merged migrations, including the correctly ordered `1792749601000_hamza_management-audit.sql`. Management changes enter the no-implicit-grant inventory alongside history and submission operations/attempts.

A new actual restricted-LOGIN case proves the merged audit's positive HR append/read and negative company/actor/employee cases, no-context access refusal after transaction cleanup and no TRUNCATE. Grants are limited to the disposable fixture and revoked afterwards. **This is a targeted audit-table policy proof**, not whole-application isolation: the baseline users/companies exposure remains explicitly detected, authentication/enrollment and final runtime grants/policies remain unintegrated.

Full local `npm run test:ci` passed: **558 unit tests, 183 API/PostgreSQL tests (13 HA-04), 14 Chromium E2E**, lint, types, collection, production build and isolated setup/cleanup, Node 26.8.1/npm 12.0.2. Evidence: `docs/evidence/HA-04-After-HA06-2026-10-23/`. Fork Actions are disabled; no fresh remote CI proof. The following earlier sections retain their dated baselines; HA-06 backend and LE-02/03 are now merged.

Keep draft / In Progress: restricted authentication/session/enrollment interfaces, final company/user/note policies/grants and actual application journeys still prevent global activation. No runtime credential change, administrator fallback or live isolation claim is introduced.

---

# Current readiness update — 23 October 2026

Rebased on main `59d7709`. **LE-02, LE-03 and LE-10 are now merged**; receipt creation no longer writes outside the actor transaction, and the actual idempotency registry is available. The dated 21/22 October sections below remain historical, not current blockers.

The fixture now applies all four merged migrations, including current-account state, decision history and the two submission registry tables. It inventories those new tables under a real restricted login and proves they are inaccessible without explicit grants. No runtime grants or policy activation are inferred from the presence of those tables.

The read-only inspector additionally detects:

- Column-only SELECT/INSERT/UPDATE grants, so a table without RLS cannot disappear behind the absence of table-level CRUD grants.
- Database CREATE permission, even when CREATE on public is absent.
- Public-schema SECURITY DEFINER functions/procedures, their actual runtime EXECUTE permission, PUBLIC default EXECUTE, pinned search path and owner SUPERUSER/BYPASSRLS flags. Every callable definer remains a review blocker, including one with a pinned path and explicit EXECUTE; those facts alone cannot certify its body or trusted schemas.

Four additional real PostgreSQL cases prove the merged-table inventory/no implicit grants, column-only exposure, database CREATE and an actual privileged-definer read through an otherwise inaccessible FORCE-RLS table. The same test proves PUBLIC revocation removes access and explicit hardening still requires review. The inspector never executes application functions or reads business rows.

Full local `npm run test:ci` passed: **534 unit tests, 162 API/PostgreSQL tests (12 HA-04), 14 Chromium E2E**, lint, types, collection, production build, disposable setup and cleanup. Runtime: Node 26.8.1/npm 12.0.2. Evidence: `docs/evidence/HA-04-2026-10-23/`. This is a local integrated campaign, not a fresh remote GitHub Actions or deployed-role proof.

Remaining prerequisites: merged HA-05 enrollment/first-HR bootstrap and restricted authentication/session interfaces; final HA-06 lifecycle contracts; a reviewed role/grant/policy migration and complete application journeys under that actual role. The merged LE-03 reconciler deliberately uses a separate privileged maintenance connection; its credentials must never enter the web process. Registry rows, cached DTOs and tombstones require explicit runtime grants and policy review alongside users/companies/notes/history. Preserve LE-03's no DELETE/TRUNCATE boundary and receipt-sequence review.

The inspector is still structural and scoped to public tables and public definer routines. It does not analyze SQL bodies, trusted search-path schema ownership, invoker wrappers, views, other schemas, sequence privileges, all reachable role combinations or deployment credential separation. **No global RLS isolation or ticket completion is claimed.** Keep draft / In Progress.

Primary PostgreSQL 16 references: [privilege inspection functions](https://www.postgresql.org/docs/16/functions-info.html), [safe SECURITY DEFINER functions and default PUBLIC EXECUTE](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

---

# Current readiness update — 22 October 2026

HA-02 and HA-03 are now merged (`61d2404`, `b6bf206`); PO-01 has approved the main access/affiliation/notification rules. HA-06/05/09 are advanced drafts. LE-02 and LE-03 remain To Do. The original inventory below is dated to its original baseline and must not be mistaken for today's delivered scope.

The inspector now reports both `current_user` and the authenticated `session_user`, their privilege flags, and memberships requiring separate review. A superuser login cannot hide behind SET ROLE: RESET ROLE can restore it. NOINHERIT membership also remains a blocker requiring explicit review. Membership flags are conservative review requirements; they do not claim a complete SET ROLE, function or column-grant audit.

Two additional real PostgreSQL tests prove privileged-login detection after SET ROLE and NOINHERIT membership detection. Full `npm run test:ci` on merged HA-02 passed: **320 units, 52 API/PostgreSQL tests (8 HA-04), 12 Chromium E2E**, lint, types, production build, isolated setup/cleanup. Current sanitized evidence: `docs/evidence/HA-04-2026-10-22/`. The older captured baseline report remains historical evidence of the previous inspector version.

Additional SQL inventory since the original baseline: `users.is_active`; current-session role/email lookup in `src/lib/current-session.ts`; HA-03 decision history; HA-06's proposed management audit/lifecycle operations; HA-05's authorized invitation issuer; HA-09's isolated decision outbox/inbox prototype. Before activation, inventory the actual merged schema, restricted session/login/enrollment capabilities and grants/policies for every table. The current-session lookup is also pre-scope SQL and must be integrated with the approved restricted authentication interface.

No application role switch or policy activation is delivered. Real database isolation remains blocked on the merged receipt/idempotence operations, secure enrollment/authentication interfaces, final lifecycle contracts and complete positive/negative flows under the real limited role. Keep this PR draft and Jira In Progress.

---

# HA-04 / ARLA-13 — RLS activation readiness

**Draft, not an isolation delivery.** Inventory baseline: main `9465225`, 21 October 2026. HA-02/03/05/06, LE-02 and LE-03 are not all integrated. This change adds a read-only structural inspector, a real limited-login PostgreSQL test fixture and this activation plan. It does not change application credentials, enable new policies, grant runtime privileges or repair authentication/signup. Keep the ticket in progress.

## Current SQL inventory and boundaries

| Operation / entry point | Current SQL and context | Activation prerequisite |
| --- | --- | --- |
| Credentials login — `src/lib/auth.ts` | Unscoped `users` lookup including password hash by email | HA-05/04 must agree a restricted pre-authentication interface; the web role cannot have broad password-hash reads |
| Public signup — `src/app/actions/auth.ts` | Unscoped user lookup, company insert/lookup by email domain, user insert | HA-05 must replace implicit domain affiliation and first-account HR promotion with an approved, atomic enrollment/bootstrap flow |
| Personal expense GET/POST — `src/app/api/expense-notes/route.ts` | Scoped note select/insert; receipt sequence allocation; receipt-key update through unscoped pool | LE-02 must remove the unscoped receipt write; preserve merged LE-01 DTO mapping |
| Personal receipt URL | Scoped expense lookup, followed by storage signing | Preserve author authorization and approved receipt scope |
| Manager/HR lists and four decision routes | Scoped expense select/update joined with users; current policies depend on users | Integrate HA-02 current actor and tenant checks, HA-03 atomic decisions/history and HA-06 approved visibility circuits |
| Manager receipt URL | Unscoped expense lookup on this main baseline | Integrate HA-02 scoped receipt authorization before enforcing runtime SQL isolation |
| HR receipt URL | Scoped expense/user lookup | Verify company and approved relation with HA-02/06 |
| HR user list and manager assignment | Unscoped users reads/update on this main baseline | Integrate HA-02 actor transaction and HA-06 serialized graph mutation |
| History — HA-03 | New decision history table and writes are not on this baseline | Inventory actual migration, read scopes and insert privileges after merge; do not invent a history contract here |
| Invitations — HA-05 | Proposal only; no approved public enrollment interface | Integrate accepted enrollment contract, token confidentiality and bootstrap boundary |
| Idempotence — LE-03 | No integrated table/operation on this baseline | Inventory actual schema, author/company checks and replay operations after merge |
| `scripts/seed.mjs` | Company/user/note insert/update and receipt-key updates through its own pool | Explicit administrative demo setup only; never give its credentials to the web process |
| SQL migrations and migration bookkeeping | DDL, extension/policy ownership and migration tracking | Separate migration identity and process; no web ownership/DDL permissions |

Existing business tables are `companies`, `users` and `expense_notes`. Only `expense_notes` has RLS. Its HR policies omit the company condition; enabling a non-superuser login alone does not repair them. Its owner/manager policies and implicit update checks must be replaced or reviewed together against the approved matrix. The receipt serial sequence also needs a least-privilege review. Future OCR job and outbox tables belong to LE-06 and HA-09: their own migrations must include privileges, policies and real-role tests. They do not block this ticket before those future features exist.

## Inspector: what it checks and what it cannot prove

With the **actual private application connection** available as `DATABASE_URL`, run:

```sh
node scripts/check-rls-readiness.mjs
```

The command opens a read-only transaction and reports the connected `current_user`, superuser/BYPASSRLS/role-creation/database-creation flags, public-schema CREATE permission and every ordinary/partitioned public table except migration bookkeeping. For each table it reports effective ownership, any table-level CRUD access, TRUNCATE access, RLS/FORCE flags and policy count. Newly added tables enter the inventory automatically. No credentials, connection URL, rows or raw connection errors are printed.

Exit codes: `1` = structural blocker(s), `2` = missing/failed private connection, `0` = structural checks passed **without proving tenant isolation**. Missing policies are flagged as an operability blocker when a table is accessible with RLS enabled; PostgreSQL would otherwise default-deny rows. A permissive or incorrect policy can still pass these structural checks.

This is deliberately not a full privilege auditor. It does not analyze policy expressions, role switching via memberships, other schemas, views, SECURITY DEFINER functions, column-only grants, sequence/function privileges or deployment credential exposure. Run with a direct runtime login, separately audit reachable roles and callable interfaces, and prove the complete flows and negative cases below. A fixture result cannot certify the web server's deployed connection.

## Activation plan after dependencies merge

1. Re-inventory the merged schema and every SQL operation above. Record the PO-01 role/visibility matrix and the accepted pre-authentication/enrollment interfaces. Do not infer HR access or managerless/self-approval rules.
2. Provision distinct migration and runtime identities through an administrator-only command. The runtime login must be `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, own no business object and have no route to the migration role. Keep its credential outside Git; the web environment must receive only that credential. Review database/schema CREATE, role memberships, PUBLIC defaults, table/column, sequence and function grants explicitly.
3. In one reviewed policy migration, revoke broad defaults and grant only the operations the runtime needs. Define table-specific SELECT/INSERT/UPDATE/DELETE policies for company and approved relations, including new values via WITH CHECK. No unrestricted `users` policy to work around recursive predicates. No TRUNCATE privilege for the runtime.
4. For login and first-account/invited enrollment, integrate the smallest approved interface from HA-05. If a SECURITY DEFINER function is needed, pin a safe search path, qualify objects, use a dedicated minimally privileged owner, revoke PUBLIC EXECUTE, validate all arguments and forbid arbitrary SQL. This proposal does not create such a function before its contract is approved.
5. Set actor context from authenticated server identity with transaction-local configuration, as `withUserScope` already does. Keep all dependent queries on that client. Verify cleanup after success and rollback, and error handling if a connection itself fails. Context remains a trust boundary controlled by the application; RLS does not authenticate a client-supplied UUID.
6. Test fresh and existing demo databases, then run the actual web process with the limited login. Read its role attributes through that connection; do not infer identity from an environment variable's name. Run the structural inspector and the acceptance matrix below.
7. Deliver the reviewed standalone administrator/bootstrap and migration commands, rollback procedure and environment-variable contract to MATH-06/02. Their orchestration work is not a prerequisite to running the proof here.

The final bootstrap command and policy migration are intentionally outstanding. A guessed script that silently grants broad authentication access would conceal the missing contract. Before activation, back up an existing demo database and rehearse recovery on a copy. On a failed rollout, stop the web process and restore the reviewed compatible app/schema state; do not restore availability by putting a superuser credential into the web process.

## Required proof before ready for review

| Scenario | Evidence still required |
| --- | --- |
| Actual server login | `rolsuper=false`, `rolbypassrls=false`, no protected-table ownership/DDL or migration-role access |
| Actor A reads/writes B directly | No foreign row returned or modified under the real runtime login; positive own-company cases succeed |
| No actor context | No business rows/actions; only approved login/enrollment interfaces available |
| Updates change scope or owner | WITH CHECK rejects new forbidden values, with a valid allowed-update counterpart |
| Full application journeys | Login, invited signup, receipt upload/read, idempotent replay, decisions/history and all three dashboards succeed under the real role |
| New policy/table | Positive and inter-company negative cases for each policy and all tables present at activation |
| Connection reuse | Commit and rollback clear actor identity on the same reused connection |
| Existing demo migration | Upgrade/recovery tested without losing or accidentally exposing prior records |

## Evidence delivered in this draft

`tests/api/hamza/HA-04/readiness.spec.ts` ran **6/6 passing** against an isolated PostgreSQL 16 instance. It provisions a real `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT` role and connects as that role (no administrator-session SET ROLE shortcut). It detects baseline users/company exposure, inventories an added table, distinguishes missing policies, flags TRUNCATE and verifies transaction-context cleanup on the same pooled connection after commit and rollback. The administrator test explicitly demonstrates the bypass problem. These tests do **not** prove final policies or application flows.

The fixture requires an explicitly supplied `HA04_TEST_ADMIN_DATABASE_URL`, a localhost PostgreSQL URL ending in `_test` and an empty public schema. It creates and drops its own role/tables; use only a disposable test database. It refuses existing tables. The private URL must not be committed or pasted into logs.

```sh
npm ci
npm run test:unit -- tests/unit/hamza/HA-04
npm run test:api -- tests/api/hamza/HA-04
npm run lint
npm run typecheck
```

The two CLI tests check missing connection handling and redaction even when malformed private configuration fails during client construction: **2/2 passed**, along with lint and TypeScript checks. `evidence/readiness-baseline.json` is a captured blocked report from the disposable bootstrap-owner connection, not a production observation. It contains no application records or secrets.

PostgreSQL semantics used by the diagnostic: [row security documentation](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) and [privilege inspection functions](https://www.postgresql.org/docs/16/functions-info.html). Superusers and BYPASSRLS roles bypass row policies; owners normally bypass unless FORCE applies. TRUNCATE is outside row security. These facts explain why a policy count alone cannot certify isolation.
