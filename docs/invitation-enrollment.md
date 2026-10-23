# HA-05: explicit invitation enrollment

Implements PO-01's company-bound, verified-address, expiring, single-use invitation direction. The implementation verifies possession through a private link delivered to the intended address. No form field can assert verified identity, company or role. The operational expiry is required configuration; the tests' one-hour value is a fixture, not a default product decision. Document the deployed delivery method and chosen expiry with PO-01 before operating a real environment.

## Application behavior

An active HR opens **RH → Gérer les invitations**, submits an address and can revoke unused invitations. Current HR role, activity and company are reloaded under a database lock. The list contains only the current company's 100 newest invitations and no raw capability. Ordinary invitations always create employees; HR role changes remain HA-06.

The mail bridge receives two independent 256-bit secrets, while PostgreSQL stores only their SHA-256 digests. It must deliver the link **only to the requested address**, never to a public response, HR list or log. Possession of that private link supplies the address proof; it must not be forwarded. Both secrets share the invitation's server expiry and revocation/consumption state. A private `#invitation.proof` fragment keeps capabilities out of HTTP request URLs and referrers; opening the form clears it from the current browser history entry.

Signup hashes a bounded password before holding a transaction, locks the invitation, checks both capabilities, then atomically inserts the account and consumes the invitation. Expiry is checked again after insert/lock waits. Parallel consumption creates at most one account. A valid invitation for another company never transfers an existing email/account. No domain rule or public first-HR creation remains.

Account creation commits before automatic login. A credential-provider error shows **Compte créé** and a login link, hides the creation form, and does not repeat enrollment. Framework redirects are preserved. An uncertain failure tells the user to try login before another enrollment attempt; there is no automatic retry or reassignment.

## Required private configuration

- Existing `AUTH_URL`: canonical application origin, HTTPS outside an explicitly isolated loopback test.
- `ENROLLMENT_INVITATION_TTL_SECONDS`: explicitly chosen integer, 60–604800 seconds. No default is selected. The bound is a technical guard, not an assertion that PO approved a particular duration.
- `ENROLLMENT_DELIVERY_URL`: private HTTPS mail-bridge endpoint, without embedded credentials, query or fragment. No client-supplied URL is read; redirects are refused.
- `ENROLLMENT_DELIVERY_BEARER`: separately provisioned private bridge bearer (at least 32 characters), never a browser variable.

The bridge accepts authenticated POST JSON `{ type: "expense-io.enrollment.v1", to, link, expiresAt }` and returns **202** only when it takes responsibility for private delivery to `to`. Other responses/timeouts are bounded failures; the action attempts to revoke the issued invitation. An ambiguous timeout may have delivered an unusable link, so the UI never promises success or returns its secrets. If revocation also fails, expiry still limits that invitation; inspect its state before retrying. No decision-notification/outbox dependency is introduced.

Production credentials and provider integration belong to environment configuration. Without valid configuration, issuing an invitation fails closed. No real email is sent by tests, CI or the administrator bootstrap.

## Reproducible controlled demonstration

Use only a separately configured disposable loopback `_test` database and a dedicated application port, never the personal/development database. After applying migrations to that test target and creating its synthetic first HR, provide the configuration above privately. Use an explicit fixture TTL such as 3600 and a fresh private bearer. For the test bridge:

```sh
# All environment values are provided privately; no .env is loaded by this command.
ARLA_TEST_ENV=isolated node scripts/hamza/enrollment-demo-inbox-cli.mjs --isolated
```

`ENROLLMENT_DEMO_PORT` must be an explicit dedicated unoccupied port. `AUTH_URL` must point to the dedicated loopback application, not port 3000. Set `ENROLLMENT_DELIVERY_URL` to that bridge's `/enrollment`. The bridge accepts only synthetic addresses ending `.test`, stores at most 100 messages in memory and never sends SMTP or writes files/DB. Its authenticated GET `/enrollment` is the **private test operator inbox**; use the bearer privately, open the synthetic recipient link, and never publish that JSON. Stop the process to discard messages. This controlled delivery demonstrates the real app flow; it does not certify a real provider's delivery.

Create the synthetic HR/company only through the separate administrator command:

```sh
node scripts/hamza/enrollment-bootstrap-cli.mjs --apply < /absolute/private/bootstrap-input.json
```

It requires dedicated private `HA05_BOOTSTRAP_DATABASE_URL`, does not read `.env` or fall back to web `DATABASE_URL`, and checks the actual privileged administrator identity. JSON keys: `companyName`, `companyDomain`, `name`, `email`, `password`. The company/domain are explicitly selected, not inferred from the HR email. Both inserts roll back on conflict/failure. Output contains opaque IDs and next sign-in step, never the password or email. Never expose administrator credentials to the web process.

## Existing data, migration and HA-04 handoff

`1792764000000_hamza_enrollment-invitations.sql` follows the HA-06 audit migration. It adds invitation state without rewriting or affiliating existing users, companies, notes or history. Existing users continue signing in. Historical domain-based memberships are not retroactively certified by this change; review ambiguous accounts administratively without automatically moving them or erasing their history. An existing-email redemption directs the user to login.

The ordered runner test upgrades an existing database, rolls the invitation table back and upgrades again while preserving its users. Before an operational rollback, stop invitation issuance and invalidate outstanding links; down removes invitation state, not accounts/history. Restore the old application only with a separate explicit security decision: its old domain-based signup is unsafe.

HA-04 owns the final limited web role, pre-authentication/session/enrollment SQL entry points, grants and policies across the complete schema. The current application does not introduce a privileged credential fallback or switch an existing environment's role. Its new invitation table has RLS enabled/forced and no broad runtime grants; HA-04 must grant only the necessary narrow capabilities and prove all real paths. The HTTP/SQL/browser tests here use isolated bootstrap fixtures and do not claim whole-application RLS.

## Actual verification

`npm run test:ci`: 602 unit, 191 API/PostgreSQL, 18 Chromium E2E; lint, typecheck, exact collection, production build and isolated setup/cleanup passed locally. Proof: `docs/evidence/HA-05-Live-2026-10-23/`. SQL cases cover contention, rollback, expiry/revocation/forged identity, current issuer authorization, bootstrap and migration preservation. Real browser cases cover HR issuance → private delivery → recipient signup/sign-in, HR revocation refusal and provider failure. No tests are skipped or weakened. CI on the published head is linked in PR #10.
