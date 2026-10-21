# HA-01 validation — 21 October 2026

The minimum shared runners are now integrated through ARLA-16. This final
validation uses a clean `npm ci` from the tracked manifest/lockfile, without
external packages or symlinks. The manual secret setup is usable independently;
MATH-06's later automation is a separate handoff. This record does not close
MATH-01/02/06 or replace Leandro's review.

Base: `059b2d8` on `Mindsept/expense-io/main`, including ARLA-17 and ARLA-16.
The ARLA-10 PR commit contains the authentication implementation and tests
validated together with that base. Runtime: Node `v26.8.1`, npm `12.0.2`, macOS
arm64. The repository's declared Node baseline remains 24+. PostgreSQL used the
existing project's `postgres:16-alpine` image.

## Results actually obtained

| Check | Result |
| --- | --- |
| `npm ci` | Exit 0. Vitest 5.0.5 and Playwright 1.64.1 installed from the lockfile, with no temporary links. Existing audit still reports 8 affected packages; qualification belongs to HA-08. |
| Installed dependency verification | All 476 installed package versions match the lockfile; `npm ls --all` exits 0. |
| `npm run lint` | Exit 0. |
| `npm run typecheck` | Exit 0 after the clean install. |
| `npm run build` | Exit 0, Next.js 16.3.5 production build, private build-only secret in ignored `.env`. |
| `npm run test:unit` | 102 tests passed: 21 HA-01 configuration/provisioning/rotation tests and 81 HA-07 regression tests. |
| HA-01 API suite, production | 3 tests passed: real PostgreSQL credentials, wrong password, authenticated expense list, same-secret restart, different-secret rotation and subsequent login; empty and example-placeholder configuration rejected. |
| HA-01 API suite, development | The same 3 tests passed against `next dev`. |
| HA-07 API regression, combined code | 7 tests passed against the production server with the new authentication configuration: correlated 401, role 403, hidden resource 404, state conflict 409, malformed JSON/assignment 400, sanitized PostgreSQL 500, and unchanged authorized success representation. |
| `.env`, `.env.local`, `.env.production` ignore check | All ignored; no private value staged. |
| `git diff --check` | Exit 0. |

The API fixture used a separate Compose project `expense-ha01-auth-test`,
loopback-only port 55410 and database `expense_ha01_test`, with temporary
in-memory PostgreSQL storage. It applied the existing migration, created only
its own company/user/expense rows, and cleaned them up. Final fixture counts
were zero. The server processes and Compose project were stopped after
validation. No existing development database was modified. No browser,
receipt-upload or complete E2E suite was exercised.

## Reproducing

The shared test configuration already collects `tests/unit/**/*.test.ts` and
`tests/api/**/*.spec.ts`; no local runner installation is needed:

```sh
npm ci
npm run lint
npm run typecheck
npm run test:unit
node scripts/generate-auth-secret.mjs
NEXT_TELEMETRY_DISABLED=1 npm run build
```

For HA-01 HTTP checks, prepare a separately migrated disposable PostgreSQL
instance, then set `HA01_TEST_DATABASE_URL` privately to its loopback URL and
`*_test` database. The suite starts/stops its own servers and does not reset
the database:

```sh
HA01_SERVER_MODE=production npm run test:api -- tests/api/hamza/HA-01
HA01_SERVER_MODE=development npm run test:api -- tests/api/hamza/HA-01
```

For the HA-07 regression, run a separate production server with a private
`AUTH_SECRET`, `AUTH_TRUST_HOST=true` and the same disposable database. Set
`HA07_TEST_BASE_URL`, `HA07_TEST_DATABASE_URL` and a private generated
`HA07_TEST_PASSWORD` as required by that suite, then run:

```sh
npm run test:api -- tests/api/hamza/HA-07
```

The combined-code validation used ports 3102 (HA-01 production), 3101 (HA-01
development) and 3107 (HA-07 production). Login cookies remain in memory;
runtime secrets and fixture passwords are generated independently and are not
logged or committed. Production runtime secrets differed from the build-only
value, proving that the build did not pin the runtime key.

These tests do not prove entropy of arbitrary operator input, tenant isolation,
role revocation, RLS, storage behavior, or safety of unrelated error handlers.
The README and example now require manual provisioning; automating that step
in the Makefile remains a MATH-06 handoff, without blocking use of this change.
