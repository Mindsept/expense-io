# Authentication configuration — HA-01 / ARLA-10

The shared Vitest/Playwright runners are declared in the repository manifests
and their configurations collect this ticket's suites. The README and
environment example document the required manual secret-generation step.
MATH-06 can later automate that step in the shared setup; its completion is not
a prerequisite for HA-01. No ticket closure or completed team review is claimed.

Auth.js now reads `AUTH_SECRET` from the server environment through
`src/lib/auth-config.mjs`. There is no usable fallback and no generation during
application startup. Missing, empty, whitespace-containing, shorter than 32 or
longer than 512 character values are rejected, as are the known example values
and the compromised value in the initial commit. Error messages never include
the supplied value.

These are presence and format checks, **not an entropy test**. A long public or
predictable constant is still unsafe. Provision a private value from a
cryptographically secure random generator for every independent environment.
The old value remains in Git history and must be treated as compromised; this
change does not rewrite history.

## Local setup, usable before MATH-06

With Node.js 24+ installed, from the repository root:

```sh
# Copy only on first setup; never overwrite an existing environment file.
test -f .env || cp .env.example .env
node scripts/generate-auth-secret.mjs
npm ci
# Continue with the existing database/storage setup, then npm run dev.
```

The command uses `node:crypto.randomBytes(32)` (256 random bits), stores the
base64url result, and prints only a status message. It does not require npm
packages or running infrastructure. It creates `.env` if absent; an optional
file argument selects another environment file. An absent/empty value or known
placeholder is replaced. A valid existing value is preserved byte for byte,
including on repeated invocations. An unrecognized invalid value, duplicate
assignment or multiline assignment requires an explicit operator edit; it is
never silently rotated. Symlinks are refused.

Writes are atomic and use mode `0600`; a provisioning lock prevents concurrent
writers. After an interrupted command, remove a stale `<env-file>.auth-secret.lock`
only after confirming that no provisioning command is still running. Do not
print the file, commit it or include it in support logs. `.gitignore` already
ignores `.env*` except `.env.example`. Arbitrary custom file names are not
automatically ignored. Check any custom location before committing.

Next.js environment precedence still applies: an exported `AUTH_SECRET` or a
more specific `.env.local`/mode-specific file can override `.env`. Provision the
actual source in use and remove conflicting placeholder overrides. The current
shared `.env.example` contains a deliberately rejected placeholder; the
generation step above must run before using it. The existing `make env` only
copies the example and is **not** sufficient until MATH-06 integrates this step.

## Build, deployment and rotation

Build-time server evaluation also needs valid configuration. Generate a fresh,
disposable build/test secret with the same command, or securely inject one from
the CI secret store. Do not store a fixed CI secret in the repository or copy a
build-only secret into a deployed environment. `AUTH_SECRET` is read at server
initialization, not exposed as a `NEXT_PUBLIC_*` value. Inject the deployment's
own private stable secret when starting the server.

For a trusted local/reverse-proxy deployment, `AUTH_TRUST_HOST=true` is a
non-secret switch already described by the example. Enable it only where the
request host/proxy headers are controlled. Database and storage variables keep
their existing meanings; this ticket does not change their credential handling.

To rotate after compromise, generate a new private value in the deployment's
secret store (or explicitly remove the old assignment from the chosen local
file and rerun the generator), then restart **all** application instances with
the same replacement. Do not keep the compromised value as a secondary decode
secret. Old encrypted JWT sessions become unreadable and users must sign in
again. All replicas of one environment must agree on the secret; independently
provisioned environments must not share one. A restart without rotation keeps
existing sessions valid. This does not address stale roles or deleted users;
those are HA-02's responsibility.

## Integration handoff

| Owner | Exact integration needed |
| --- | --- |
| MATH-01 | The minimum Vitest/Playwright dependencies and collection configurations are integrated through ARLA-16. Continue the remaining MATH-01 baseline/browser work; HA-01 does not claim that broader ticket is complete. The unit suite uses native Node APIs and `next-auth/jwt`, with no additional production dependency. |
| MATH-02 | Generate an independent private test `AUTH_SECRET` before the build. Supply it at runtime, together with the existing test database/storage variables and controlled `AUTH_TRUST_HOST=true`. Keep values out of logs/artifacts. For the HA-01 API suite supply `HA01_TEST_DATABASE_URL`, pointing to a migrated disposable loopback PostgreSQL database whose name ends in `_test`. |
| MATH-06 | Automate `node scripts/generate-auth-secret.mjs` immediately after creating the local environment file and before starting Next.js. The README and example already document the manual step for all modes; no Makefile/orchestration change is included here. |

The API suite owns its server lifecycle to prove restart and rotation. Run it
with one worker and without a shared `webServer` on its chosen port. Build first
for `HA01_SERVER_MODE=production` (default, port 3102). Run separately with
`HA01_SERVER_MODE=development` (port 3101); `HA01_TEST_PORT` can override the port.
It refuses an existing listener, writes only its own random test company/user,
uses real credential login against PostgreSQL, removes its fixtures, and stops
only its own process groups. It neither creates nor resets the database.

## Validation and remaining work

Use `npm ci`, then `npm run lint`, `npm run typecheck`, and `npm run test:unit`.
For the HTTP suite, build with valid configuration and run
`npm run test:api -- tests/api/hamza/HA-01` with the environment described above.
See [the recorded validation](evidence/HA-01-validation.md). This does not replace
Leandro's review or complete the broader MATH-01/02/06 work.

The negative unit fixture explicitly labeled PUBLIC/COMPROMISED reproduces the
initial commit's leaked value solely to prove rejection and works in a shallow
clone. It is not a working server secret. All actual test secrets and fixture
passwords are generated privately at execution time.

These tests do not establish tenant isolation, storage behavior, complete
browser E2E coverage, or production deployment hardening.
