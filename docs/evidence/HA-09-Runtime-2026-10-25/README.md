# HA-09 — 25 October 2026 runtime proof

Hugo's all-eligible-HR decision was relayed directly by Hamza. Full `npm run test:ci` passed locally on Node 24.22.1, against main `9180564`: 664 unit tests, 239 real API/PostgreSQL tests, 27 Chromium E2E; lint, types, exact collection, production build, isolated services and cleanup passed. The guarded harness uses owned disposable services only. Its common bootstrap role is explicitly not RLS proof; the HA-09 runtime fixture provisions a fresh database and actual limited web/worker logins for its isolation tests.

The new fanout proof includes three active eligible HR (no two-person cap), inactive/foreign exclusion, stable replay, no self-notification or self-decision, two competing real HR HTTP decisions (200/409), one history/author intent, peers' processed inbox state, no eligible HR pending explanation, and an actual two-HR browser flow. Existing outage/retry/terminal/requeue, read-state, reassignment and lost-session tests remain enabled.

These are automated/assisted engineering results. They do not claim Leandro or another human submitted a review. No real email, personal database or deployed credential was used. Remote CI is linked from PR #9 after publishing this revision.
