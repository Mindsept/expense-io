# Live enrollment integration — 23 October 2026

The maintained implementation now lives in `src/lib/enrollment/`, the actual signup server action and invitation/signup screens. [Current contract, configuration and reproduction](../../docs/invitation-enrollment.md). This supersedes the earlier proposal-only and temporary-refusal stages below.

A current active HR issues an employee invitation bound to their company and the intended address. Two independent random capabilities are stored only by digest and sent only through the private address-delivery bridge, never to the HR browser/list. The recipient opens the private fragment link and chooses name/password. Both capabilities are checked inside the invitation-lock transaction; company, role and email come only from the invitation. Creation/consumption are atomic, with expiry rechecked after waits. An existing email is never reassigned. Automatic sign-in errors preserve the committed-account state and Next redirects propagate unchanged.

The bridge requires HTTPS outside isolated loopback tests, a private bearer and explicit TTL, with no production default duration. A bounded `.test`-only demo inbox and controlled administrator bootstrap are maintained under `scripts/hamza/`. No real email or personal database was used. HA-04 still owns runtime-role activation and its narrow SQL capabilities; no new administrator pool/fallback is added to web code.

Full local `npm run test:ci` passed: **602 unit tests, 191 API/PostgreSQL tests, 18 Chromium E2E**, lint, types, exact collection, build and disposable services/cleanup, Node 26.8.1/npm 12.0.2. Current evidence: `docs/evidence/HA-05-Live-2026-10-23/`. The actual ordered up/down/up migration preserves existing accounts. HA-06's historical upgrade fixture now selects only migrations preceding its target, so a future migration cannot accidentally become its starting state. All prior assertions remain.

Everything below is historical evidence for earlier heads. Its claims that signup is unchanged/unavailable or that all primitives are isolated no longer describe this revision.

---

# Public enrollment guard — 23 October 2026

The draft now removes domain-based affiliation and automatic first-HR creation from the actual `signup` server action. Every public request is refused before database acquisition, password hashing or authentication, including forged company/role/verified-email/token fields. The page explains invitation-only enrollment is not yet available and retains the existing-account login link; it collects no account details. Existing login/logout code is unchanged. This is a deliberate temporary refusal, **not a working invited-signup flow**. It is not merged or deployed; main's unsafe signup remains until the complete ticket is integrated.

Six unit cases cover the public action's refusal/no side effects and preservation of credential-error/navigation behavior. A real Chromium screen test covers the notice, absence of a registration form and navigation to login; existing employee/manager/HR sign-in cases still pass. Full local `npm run test:ci` passed on main `6cfc605`: **588 unit tests, 189 API/PostgreSQL tests, 15 Chromium E2E**, lint, types, exact collection, build and isolated services/cleanup, Node 26.8.1/npm 12.0.2. Evidence: `docs/evidence/HA-05-Signup-Guard-2026-10-23/`. Fresh Linux CI is tracked in PR #10.

Keep draft / In Progress. Remaining gates: Hugo's documented verification method and expiry setting (ARLA-6), Hamza's real invitation delivery/proof adapter and redemption/administration screens/actions, existing-account migration behavior and restricted pre-authentication/enrollment SQL coordinated with HA-04. The offline administrator bootstrap and SQL invitation primitives remain isolated proposals, outside automatic migrations. No real email, notification, account or personal database was touched.

Everything below records earlier campaigns before the public guard. Claims that signup was unchanged describe those historical revisions; they do not describe the current draft.

---

# Revocation and merged workflow integration — 23 October 2026

Rebased on main `6cfc605` after HA-06/OpenAPI v4. The draft now includes `revokeEmployeeInvitation(pool, actorId, invitationId)`: authenticated server IDs only, current active HR/company reloaded under a shared row lock, invitation update scoped to that company and no consumption state overwrite. Repeated revocation preserves the first database timestamp. Missing, foreign and already-consumed invitations use the same unavailable result; no account is removed, reassigned or promoted.

Three real SQL cases prove idempotent revocation and subsequent redemption refusal, disabled/demoted/foreign/consumed refusals, and two genuinely contending revoke/redeem requests with exactly one consistent terminal outcome. A pre-connection malformed-ID test is added. No invitation list or raw capability is returned by revocation.

Full local `npm run test:ci` passed: **582 unit tests, 189 API/PostgreSQL tests (19 HA-05), 14 Chromium E2E**, lint, types, exact collection, production build and isolated setup/cleanup, Node 26.8.1/npm 12.0.2. HA-05 contributes 26 unit and 19 SQL cases. Current proof: `docs/evidence/HA-05-Revocation-2026-10-23/`. Earlier sections/results retain their explicit baselines. Fork Actions remain disabled, so there is no fresh remote CI claim.

Keep draft / In Progress. Issuance/redemption/revocation/bootstrap are executable isolated preparation. Verified-email proof/delivery/TTL, actual signup and invitation-administration UI/actions, legacy-account handling and restricted enrollment access still need integration. The live public signup remains unchanged and vulnerable; no email or real user account was created.

---

# Integration and controlled bootstrap — 23 October 2026

Rebased onto main `59d7709` after merged LE-01/02/03/05/08/10. This draft now also delivers an **isolated administrator bootstrap proposal**, implementing PO-01's already-approved company/first-HR direction without choosing the outstanding invitation email-proof method or TTL.

`bootstrap-company.mjs` creates an explicitly named company and one active first HR in one transaction, hashes the password before taking a connection, and never adopts an existing company/account. The email domain does not select affiliation: the operator explicitly chooses the company, and the first HR email can have another domain. Unique-key conflicts or an insertion failure roll the entire transaction back. Existing accounts retain their company/role. A real restricted LOGIN cannot invoke the primitive: both current and session SQL identities must have SUPERUSER or BYPASSRLS and must be identical, without SET ROLE. Required table privileges remain explicit; no grants or schema changes are made.

The offline CLI `bootstrap-company-cli.mjs` requires explicit `--apply`, a separately injected private `HA05_BOOTSTRAP_DATABASE_URL` and at most 16 KiB JSON on stdin. It never reads .env or falls back to the web DATABASE_URL. Keys are exactly `companyName`, `companyDomain`, `name`, `email`, `password`; the domain is an explicit lowercase DNS-shaped legacy schema value, not an email affiliation rule. Current validation bounds are proposal guards, not a new accepted identity/normalization policy. The operator must establish the first HR's identity through the controlled administrative procedure; this primitive does not verify an address itself.

```sh
# Inject the dedicated administrator URL privately, outside the web environment.
# Supply a private JSON file (permissions 0600) with a privately generated password.
node proposals/HA-05/bootstrap-company-cli.mjs --apply < /absolute/private/bootstrap-input.json
```

The CLI targets qualified public tables; no search-path-derived business table is used. The internal schema option is validated and used only for private fixture testing. Output contains outcome/opaque IDs/next sign-in step, never email/password/hash or a raw exception. Successful creation is separate from login. No privileged connection is added to any web action or runtime configuration. The application role must never receive the administrator URL.

Full local `npm run test:ci` passed: **557 unit tests, 166 API/PostgreSQL tests (16 HA-05), 14 Chromium E2E**, lint, types, collection, production build, disposable setup and cleanup, Node 26.8.1/npm 12.0.2. HA-05 contributes 25 unit and 16 SQL cases. Five added SQL cases prove the administrator bootstrap, two genuinely overlapping requests waiting on the company relation, existing-email protection, full rollback and a real restricted login's refusal. Nine added units cover invalid/forged input, schema identifier refusal and the separate CLI credential boundary. CLI command transport is checked for its refusal boundary; the successful business primitive is exercised only in a synthetic private schema, not a live administrative deployment.

Evidence: `docs/evidence/HA-05-2026-10-23/`. An initial integrated run hit the existing macOS owned-process `kill EPERM` failure (555 pass/1 fail), preserved in `bootstrap-initial-verify.log` and `bootstrap-initial-summary.json`. That unchanged process test passed in a targeted diagnostic and the final complete run. No runner assertion was weakened; the observed local process-cleanup instability is not declared resolved by this ticket. No fresh remote Actions or Node 24 claim is made.

Keep draft / In Progress. Review and integrate this offline bootstrap with the complete enrollment rollout; remaining work is approved verified-email proof/delivery/TTL, actual signup pages/actions, invitation administration, legacy account handling and restricted enrollment SQL. The live public signup vulnerability is still open. No real account, email or notification was created/sent by this work. Existing browser regressions do not certify the proposed enrollment UI. Dated 22 October evidence below remains historical.

---

# HA-05 — controlled invitation enrollment proposal

[ARLA-14](https://mindsept.atlassian.net/browse/ARLA-14), updated 22 October 2026 after [PO-01](https://mindsept.atlassian.net/browse/ARLA-6). **Draft, not the live signup implementation.** Invitation affiliation and controlled first-HR bootstrap are approved product directions. The former claim that the product has not chosen affiliation is obsolete.

## Executable preparation

The candidate SQL remains outside `migrations/` and no application route/action imports this directory. A cryptographically random 256-bit one-time capability is stored only by SHA-256 digest. Enrollment locks the invitation, validates exact trusted verified-email binding and expiry/revocation/consumption, inserts one account and consumes the invitation in one transaction. Expiry is rechecked against the database clock after lock/insert waits. Password hashing happens before obtaining a connection. An existing email never reassigns or promotes an account; successful enrollment is separate from sign-in.

New `issueEmployeeInvitation(pool, actorId, { email, ttlSeconds })` reloads and locks the authenticated issuer's current HR role, active state and company. The company/issuer are derived from that row, not client fields. A disabled or demoted issuer is refused. Its SQL stores issuer, intended email, digest and server expiry atomically. The raw capability is returned once as private data for a future controlled delivery adapter; it is never logged or emailed by this proposal. The issuing adapter must pass the authenticated server ID, never an actor ID from a form.

The executable subset creates ordinary employee invitations; further role assignment uses the approved HR lifecycle capability from HA-06. It does not claim the full invitation administration UI. TTL is required explicitly: no default product expiry is invented. The current 60-second to seven-day input bound is a proposal guardrail, not an accepted operational setting. Exact email matching/normalization and approved identity proof remain integration contracts.

## Required before activation

1. Implement and review the verified-address proof/delivery adapter. `verifiedEmail` is a trusted internal command precondition, not a self-declared signup field. Possession of an address alone does not grant company affiliation: the authorized company's invitation is also required.
2. Review and integrate the isolated administrator bootstrap above with the complete signup rollout, with no public promotion based on domain. HR invitation/manager/role controls must use current rights; last-active-HR removal is guarded by HA-06.
3. Replace the public signup action/pages with the accepted invitation flow, and test real screens, delivery failures, account-created/sign-in-failed state, existing-account handling and concurrent redemption.
4. Integrate HA-04's restricted pre-authentication/enrollment capability. There is no administrator credential fallback, grant, privileged function or RLS activation in this prototype.
5. Agree actual TTL, verification method, normalization, invitation administration and legacy account migration. Do not silently transfer existing accounts to a new company or rewrite their history.

**The existing public signup action is still unchanged and vulnerable to domain-based affiliation/first-HR creation.** This draft must not be described as fixing that live path. The separate HA-02 change revokes inactive accounts but does not repair signup affiliation.

## Proof and reproduction

Base: merged HA-02/main `61d2404`. `npm ci` and full `npm run test:ci` passed: **334 unit tests, 55 API/SQL tests, 12 Chromium E2E**, lint, types, production build, disposable setup and cleanup. HA-05 contributes 16 unit cases and 11 SQL integration cases, including actual queued single-use contention, expiry/revocation/wrong identity, duplicate-account protection, rollback and expiry recheck, active-HR issuance and disabled/demoted issuer refusal. These are SQL prototype cases, not an HTTP signup or email delivery proof.

The SQL suite creates and drops a random private schema in an explicitly selected loopback `_test` database. It includes HA-02's activation-column migration in that private copy. Shared CI already maps its explicit `HA05_TEST_DATABASE_URL`. The optional dedicated Compose fixture remains available in `tests/fixtures/hamza/HA-05`; no personal database or shared orchestration is changed.

Current sanitized CI evidence: `docs/evidence/HA-05-2026-10-22/`. Keep this PR draft and Jira In Progress until the complete live signup flow and required human review are delivered.
