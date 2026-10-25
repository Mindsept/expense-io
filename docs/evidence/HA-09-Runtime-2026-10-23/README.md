# Actual runtime proof — 23 October 2026

Full local `npm run test:ci` passed on Node 26.8.1: **627 unit, 228 API/PostgreSQL, 20 Chromium E2E**, lint, types, exact collection, production build and owned disposable setup/cleanup. Logs and machine-generated summary are adjacent. Base: merged HA-04 main `e5aef6322b830ae41799cc89c2a9eca663acce1b`.

The shared harness summary still correctly labels its original shared server as a privileged bootstrap baseline. The new HA-09 suite does **not** use that identity for its application/worker assertions: `notificationFixture` creates a separate random disposable database, provisions actual `expense_web` and `expense_notifications` logins, strips administrator URLs from the web/worker environments and starts an actual production server. Its six API cases and one browser case appear explicitly in these logs.

Those cases prove actual HTTP intent commit/rollback, channel outage independent of committed decision, bounded terminal failure/private explicit replay, concurrent restricted workers, uncommitted session-loss recovery, durable read state, manager reassignment/current-rights filtering, unique-HR versus unresolved multiple-HR routing, narrow grants and foreign refusals. Actual Node worker CLI execution is included. Older proposal-only suites remain collected as historical regression, not substituted for runtime proof.

The migration rollback regression passes with the newer notification migration down/up before HA-04 down/up, preserving the original eight business tables. No personal/deployed database or real notification/email was used. No shared orchestration/package/workflow file was changed.

PR #9 remains draft. Hamza explicitly left multiple-eligible-HR attribution for Hugo; no multiple-HR recipient policy is accepted by these tests. The optional explicit routing capability is only exercised with synthetic configuration. CI results do not claim human review, EL-06 acceptance or production deployment.
