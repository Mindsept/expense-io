# HA-04 runtime isolation and capability review

This implementation follows merged HA-05 (`067382d`), HA-06 and LE-02/03. It separates the web login from migration/bootstrap administration and verifies actual PostgreSQL identities at Node startup. It does not modify a user's personal database or `.env` as part of code delivery.

## Runtime identities

`1792764001000_hamza_runtime-isolation.sql` creates `expense_web` and `expense_identity`, both NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOINHERIT, with no memberships. Neither owns public business tables. `expense_identity` is NOLOGIN and owns only the private `expense_auth` schema/functions. Its role-only users/invitation policies support the reviewed functions, never a web query. Row locks require an UPDATE privilege/policy even for `SELECT FOR SHARE`; the identity owner receives only a name-column locking privilege with `WITH CHECK (false)`, not permission to rewrite a user.

The web role starts NOLOGIN until the separate administrator command provisions a private password. It cannot alter schema/policies, SET ROLE to the identity owner, read password hashes directly, read invitation digests, delete/truncate business rows or insert companies/users directly. Initial company/HR creation, seed, migration and maintenance use a separate administrator process. No administrator URL may enter the web environment.

## Reviewed SECURITY DEFINER boundary

All seven functions live in `expense_auth`, have explicit argument types, fixed `search_path=pg_catalog,pg_temp`, qualified `public` relations, a non-login/non-bypass owner and no PUBLIC EXECUTE. The web login gets only the schema USAGE and these functions' EXECUTE. No function accepts arbitrary SQL, schema/table identifiers, client role or client company.

| Function | Narrow reason and behavior |
| --- | --- |
| `current_actor()` | Resolves the active actor/company/role from transaction-local server identity without recursively querying users through its own web policy. |
| `credentials(text)` | Pre-authentication lookup of one active address and password hash for Auth.js verification; table-wide/password-column access is not granted. |
| `session_identity(uuid)` | Refreshes one signed-session identity's current role/address/activity before scoped business access. |
| `can_validate(uuid)` | Returns one boolean using the approved current company/direct-manager/HR-recourse rules; inactive authors remain processable and self-approval is false. |
| `issue_invitation(uuid,text,int,text,text)` | Locks/reloads the current active HR, derives their company and inserts an employee invitation with validated digests/explicit expiry. The actor ID comes from server authentication. |
| `revoke_invitation(uuid,uuid)` | Locks/reloads active HR rights, scopes revocation to their company and preserves the first timestamp; consumed/foreign invitations are unavailable. |
| `redeem_invitation(text,text,text,text)` | Locks one invitation and checks both private capabilities; only employee/company/email from that row are inserted. Creation/consumption and final expiry check share one transaction. The exception block rolls back an insert when expiry changes. Existing email never transfers. Password hashing happens before connection/lock acquisition in TypeScript. |

The startup guard allows only these named callable definer functions with the expected owner/path/ACL. Unknown callable definers, PUBLIC execution, privileged/login owners, direct password/digest access or dangerous grants prevent startup. The read-only inventory intentionally still reports definer review flags: metadata alone cannot review a body. Other non-system definer schemas are now inventoried too.

The actor ID/context is a **trusted server boundary**, not a cryptographic identity supplied by PostgreSQL. As the ticket requires, RLS supplements application authorization; possession of the web SQL credentials is not treated as an untrusted end-user session. HTTP form/query fields never become actor/company/role authority.

## Tables and grants

| Table | Runtime scope and mutations |
| --- | --- |
| companies | Read only the active actor's current company; no creation/update. |
| users | Current-company public identity columns only, including inactive authors needed for retained notes. HR may change only role/activity/manager, with company `WITH CHECK`; employees may lock visible rows but cannot update them. No password hash, company transfer or direct enrollment. |
| expense_notes | Own notes or currently eligible validator, always current company. Own pending complete-receipt insert only. Only status is updatable, by an eligible non-owner validator. Owner row locks remain possible without allowing self-decision. |
| decision history | Existing owner/eligible-validator scope and actor/company `WITH CHECK`; append-only fields, database ID/time defaults, no rewrite/delete. |
| management changes | Active HR/company read/append, matching current actor and same-company target; no rewrite/delete. |
| submission operations | Active owner/company scope, bounded insert/update columns, no identity/company/expiry rewrite. Completed result/note references must belong to that owner. No delete/truncate. |
| submission attempts | Active owner/company scope with composite operation ownership; only lifecycle state/time updates. No web cleanup privilege. |
| enrollment invitations | Active HR/current-company list of safe columns only. Issuance, revocation and proof redemption go through the narrow functions; no web digest read or direct mutation. |

Local transaction settings are cleared on commit/rollback. If rollback itself fails, the connection is discarded instead of returned to the pool. SQL privileges additionally prevent rewriting protected metadata even when a row is visible. Existing approved application checks, lifecycle locks, last-HR protection and domain validation remain in place.

Future OCR job and notification outbox/inbox tables are not automatically protected by this migration. Their owners must add grants, policies and actual-role refusal tests together. The web process never inherits the maintenance/migration account. LE-03 maintenance/reconciliation remains a separate privileged operator command; its credentials are excluded from the web environment.

## Provision and operate

1. Stop web processes. Run the repository's migrations with the **separate administrator/migration connection**. Review any existing role mismatch; the migration refuses unsafe attributes/memberships or business ownership rather than silently adopting them.
2. Provision a separately generated private runtime password (at least 32 bytes) using a protected one-line input file. Supply only the dedicated administrator URL to this command:

```sh
node scripts/rls/provision-runtime-cli.mjs --apply < /absolute/private/runtime-password.txt
```

The command requires private `HA04_ADMIN_DATABASE_URL`, never reads `.env`, never falls back to web `DATABASE_URL`, verifies an actual administrator session without SET ROLE and does not print the password/URL. Never commit the input or environment values.

3. Configure **only** the `expense_web` private `DATABASE_URL` in the web process, alongside normal Auth/S3/invitation settings. Remove administrator/migration/bootstrap URLs. Starting with the old superuser configuration now fails with a bounded diagnostic instead of silently bypassing RLS.
4. Run the read-only inventory and smoke the actual login, invited signup, receipt/idempotent submission, all roles' queues, decision/history and role changes. Startup checks are a guard, not a replacement for these flows. Mathis can wire the independent commands into shared local setup without changing this SQL contract.

The shared CI runner's explicitly named generated loopback `_test`/`expense_test` fixture remains a documented privileged-bootstrap baseline. Its exception requires that exact test user/current+session identity, isolated marker, generated project name and loopback test target. It is unavailable to a real deployment or to the HA-04 `expense_web` proof server. This preserves other owners' existing isolated suites without pretending they alone prove isolation. The HA-04 suites provision a new random database in the reserved CI cluster, use the real web login and strip administrator settings from the child process.

## Safe rollback

Stop web processes before a rollback. `down` removes web grants (including column grants) and the authentication schema/functions, leaving RLS enabled and preserving all business records. Web queries fail closed. Global NOLOGIN owner-role definitions are retained because PostgreSQL roles are cluster-wide. Reapplying `up` reinstates the capability set without altering users, notes, history, operations or invitation state; the actual migration runner proves down/up and data equality. Do not restore the old privileged web configuration to bypass a failed rollout.

## Actual proof and limits

Full local `npm run test:ci`: **618 unit, 213 API/PostgreSQL and 19 Chromium E2E**, plus lint, types, exact collection, production build and isolated setup/cleanup. Evidence: `docs/evidence/HA-04-Runtime-2026-10-23/`. Nine new real-runtime SQL/HTTP cases and one real Chromium path cover the actual login flags/ownership, no-context access, tenant/refused new values, schema/password/role denial, receipt/idempotency, decision/history/current-rights revocation, HR self-demotion, invitation contention/identity preservation, expiry rollback, connection reuse after commit/rollback, unsafe privilege/definer detection and real migration recovery. The older readiness cases still demonstrate detection of an intentionally insecure historical schema.

This proves the tested PostgreSQL 16 application configuration. No personal database or deployed secret was modified, and no real email was sent. Deployments must actually apply/provision the role and retain the documented process separation; metadata or a green privileged-bootstrap banner cannot establish that by itself.

Primary PostgreSQL 16 references: [policy semantics, new-value checks and row locks](https://www.postgresql.org/docs/16/sql-createpolicy.html), [row security and role/table-owner boundaries](https://www.postgresql.org/docs/16/ddl-rowsecurity.html), [safe SECURITY DEFINER functions](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

The first Linux run passed all 213 API/SQL cases but reported an E2E teardown FATAL during forced database removal. The fixture now waits for all owned clients to disconnect and drops the owned DB normally; it fails explicitly if they remain. No assertion, runtime permission or application behavior was relaxed. The complete local rerun passed; the revised published head is checked by Linux CI before merge.
