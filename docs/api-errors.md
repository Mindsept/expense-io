# HA-07 — HTTP error and diagnostic contract

Ticket: [ARLA-16](https://mindsept.atlassian.net/browse/ARLA-16). Contract version: 1.

## Behavior and scope

All eleven manager, HR and personal-receipt handlers now execute through `withApiHandler`. It awaits the complete handler, including database acquisition, transaction work and commit, before producing a response. A rejected promise therefore cannot escape a surrounding `try` that has already returned. Authentication, deferred route parameters, JSON reads and receipt presigning also run inside this boundary. Success bodies are unchanged; every wrapped response gains `X-Request-Id`.

The wrapper is for HTTP route handlers only. **Do not use it around server actions**: Next.js `redirect`/`notFound` exceptions represent navigation, not API failures. Auth.js's own routes are not replaced.

The legacy `respondError(error)` export remains available while Leandro migrates his two route files. It now sanitizes exceptions, but cannot catch a promise that its caller failed to await. Its diagnostic uses `operation: "legacy.api"` and `durationMs: 0` (duration unavailable, not a measured latency).

HA-07 itself does not implement authorization, RLS or atomic decisions. The partial HA-02 implementation now adds current-actor authorization and cross-company predicates; RLS and atomic decisions remain HA-04/03. Manager assignment rejects malformed JSON and absent/invalid `managerId` before business-data queries; explicit `null` and UUID strings retain their existing behavior. This narrow request-shape check prevents a parse error from silently unassigning a manager. Same-company checks are added by the partial HA-02 implementation; full cycle checks remain HA-06. HA-02 buffers assignment input before taking database locks, then authorizes the current actor before reporting input errors, preserving 401/403 precedence. See [the current-actor contract](authz-current-actor.md).

## Response contract

Errors use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html), `Content-Type: application/problem+json` and `Cache-Control: no-store`. The HTTP status is authoritative and equals the body `status`. `type` is a stable application URI identifier; it is not a URL to fetch.

```json
{
  "type": "urn:expense-io:problem:conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "This expense has already been decided.",
  "error": "This expense has already been decided.",
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

The temporary `error: string` extension equals `detail`, so existing screens keep displaying readable messages. New clients may switch on `type` and use `detail` for display. Removing `error` requires a coordinated client change; this ticket does not remove it.

| `ApiError` code | HTTP | Meaning |
| --- | --- | --- |
| `validation` | 400 | Required input fields or formats are invalid |
| `invalid_json` | 400 | The request body is not a valid JSON object |
| `invalid_manager_assignment` | 400 | `managerId` is absent or is neither a UUID nor explicit null |
| `unauthenticated` | 401 | No authenticated session |
| `forbidden` | 403 | An authenticated actor's role cannot use this operation |
| `not_found` | 404 | Missing or non-visible resource; same public message |
| `conflict` | 409 | Expense already decided |
| `invalid_manager` | 409 | Selected manager cannot be assigned under the current rules |
| `idempotency_conflict` | 409 | Same scoped intention key with different validated content |
| `idempotency_in_progress` | 409 | Another attempt currently owns the submission lease |
| `idempotency_expired` | 409 | Seven-day replay window expired; inspect history before a new intention |
| `payload_too_large` / `ocr_image_too_large` | 413 | Actual body/file bytes or image dimensions exceed the bound |
| `unsupported_ocr_media` | 415 | OCR image formats only; PDF unsupported |
| `request_timeout` / `request_aborted` | 408 / 499 | Body reading deadline or cancellation |
| `ocr_failure` / `ocr_busy` / `ocr_timeout` | 502 / 503 / 504 | Failed engine, bounded capacity/wait, or active deadline |
| `manager_cycle` | 409 | Assignment would create or join a management cycle |
| `manager_assignment_busy` | 409 | A candidate is locked by another operation; retry the assignment |
| `technical_failure` | 500 | Unexpected application/infrastructure failure |

Only typed codes select reviewed, static details. Never put caught exception messages, SQL, submitted input or credentials in a detail. Add a reviewed code to this shared catalog when a consumer needs a new validation message; do not create a second error schema or treat arbitrary exceptions as 400. `readJsonObject` maps JSON syntax/non-object bodies to 400 and lets I/O failures become 500.

## Correlation and diagnostics

Incoming `X-Request-Id` is accepted only when it is a 36-character UUID with a recognized version/variant, then normalized to lowercase. Missing or invalid values are replaced with a fresh UUID. The same ID appears in the response header, problem body and one structured log record. The raw URL, query string and caller's invalid ID are never logged.

Each wrapped request logs exactly the allowlisted fields: `level`, `operation`, `status`, `requestId`, `durationMs`, `result`. Operations are static route labels, not IDs or URLs; malformed labels become `unknown.api`. Duration uses `performance.now()` and includes failed work. `result` is `success`, `client_error` or `server_error`; levels are respectively `info`, `warn` or `error`.

Bodies, authentication data, cookies, tokens, receipt keys/content, user/company IDs, SQL, connection URLs, exception messages/stacks and causes are deliberately excluded. This sacrifices raw stack diagnostics in this common channel; maintainers can correlate the operation, time and status without centralizing business data. Request IDs are correlation metadata, never an authorization decision.

### LE-08 observation extension

`HttpObserver = (event: HttpDiagnostic) => void | Promise<void>` is an optional fourth argument to `withApiHandler`. The immutable event contains only the fields above. Leandro can keep his adapter in his own module and pass it from his routes. Existing structured logs also cover Hamza's routes without changing `lib/errors.ts`, `lib/db.ts` or the future decision use case.

```ts
return withApiHandler(request, 'expense-notes.list', async () => {
  // Authenticate, validate and await the complete use case here.
  return Response.json(result)
}, observeHttp)
```

The callback is invoked synchronously, so adapters must keep synchronous work short. Returned promises are not awaited; both synchronous throws and promise rejections are isolated from the response. This is best-effort telemetry, not a durable queue. Slow synchronous code can still delay execution. No monitoring platform is required.

## Consumer handoff

**Leandro — exactly two files still to adopt the wrapper:**

- `src/app/api/expense-notes/route.ts`: migrate both GET and POST. Put authentication, validation, `withUserScope`, storage and final SQL inside `withApiHandler`. The GET currently returns its transaction without awaiting it in a `try`; replacing that boundary is necessary. Preserve successful array/201 DTOs and use typed errors for early failures.
- `src/app/api/expense-notes/receipt-suggestion/route.ts`: wrap POST, including authentication, form-data reading and `suggestFields`. Preserve the success suggestion DTO and use the shared typed validation contract.

Add route-level tests for late promise rejection and known errors in those tickets. The legacy helper alone does not migrate early `{ error }` responses, request correlation or success metrics. These consumers' adoption is part of their acceptance and the final end-to-end review, not a dependency preventing HA-07 publication.

**Elyes:** existing `error` rendering still works. Prefer `detail`/`type` for new flows, show the correlation ID when useful for support, and never assume 403 means the user is logged out. A missing session is now consistently 401 on Hamza's routes.

**Mathis / MATH-01:** this ticket includes the minimum shared runner integration needed to validate its code from a clean checkout. Vitest 5.0.5 and Playwright 1.64.1 are pinned dev dependencies; `test:unit` collects only `tests/unit/**/*.test.ts` with the `@/` alias, while `test:api` collects `tests/api/**/*.spec.ts`, one worker, with traces off and ignored output. The shared Playwright configuration has no server or URL fallback: HA-07 expects its explicit external test server, while HA-01 owns its own server lifecycle. Full CI, browser projects, team fixtures and the rest of MATH-01 remain separate work.

## Validation evidence — 21 October 2026

Base commit: `265924bc7274047989e708ab635c2854d376230f`. Local Node `v26.8.1`, npm `12.0.2`. A clean `npm ci` installed the checked-in lockfile and test runners without external tooling or links. All 522 pre-existing package entries in the lockfile are unchanged; the additions support the test runners (Playwright is also an existing optional Next.js peer). Newer PostCSS/nanoid/source-map-js versions required by Vite are nested under Vite, preserving the application's existing versions. `npm ls --all` validated the dependency graph.

- **81 Vitest tests passed** in two files: the response contract, redaction and correlation, collector/logging failures, immutable response headers, all eleven handlers' session/authentication behavior, real `withUserScope` with failure doubles at acquire/BEGIN/context/query/COMMIT/ROLLBACK, direct SQL, receipt presigning, deferred params, malformed/stream-failed JSON, assignment shape and accepted null/UUID, success DTOs.
- **7 Playwright API tests passed** against a production Next server and real PostgreSQL 16: three genuine credential logins (no hand-forged cookies), 400/401/403/404/409/500, unchanged DB state on rejected requests, and successful manager list DTO. A malformed route UUID deliberately provokes a real PostgreSQL rejection after `await`; it proves the exception boundary, not input-ID validation.
- **Server log inspection passed:** ten structured records cover all seven statuses; the real SQL failure has its correlation ID and no SQL, invalid path value, test password or connection URL appears in the log.
- `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`: passed from the clean installation. Unit and API collection commands also found the expected 81 and 7 cases.

The HTTP environment used a separate Compose project, loopback-only PostgreSQL port 55416, database `expense_io_ha07_test`, and application port 3116. The API test requires explicit `HA07_TEST_BASE_URL`, `HA07_TEST_DATABASE_URL`, `HA07_TEST_PASSWORD`, checks the local `_test` target before any fixture write, and deletes only its own UUID-scoped fixtures. Secrets, session state and raw logs are not committed; generated test reports are ignored.

Reproduction from the checkout root:

```sh
npm ci
npm run lint
npm run typecheck
npm exec -- vitest list
npm run test:unit
npm run build
npm run test:api -- tests/api/hamza/HA-07 --list
npm run test:api -- tests/api/hamza/HA-07
```

Before collecting/running the API suite, initialize a dedicated local `_test` PostgreSQL database with the existing migration and start the built application against it. Privately inject `HA07_TEST_BASE_URL`, `HA07_TEST_DATABASE_URL` and a generated disposable `HA07_TEST_PASSWORD`; none has a fallback. The application needs matching `DATABASE_URL` and local Auth.js trusted-host configuration. Once HA-01 is integrated, also provide a private generated `AUTH_SECRET` for build/start, following `docs/authentication-configuration.md`; never copy the former public constant or expose credentials in logs. The API suite sets up its own UUID-scoped fixtures and signs in through Auth.js; it does not need the seed script, S3, or pre-created accounts.

No browser E2E suite exists on the base commit; this ticket changes no UI and adds HTTP/database tests instead. Storage and connection/commit fault injection are route-level tests using doubles, not a claim of tested real S3 outages. The existing dependency audit findings remain assigned to HA-08/MATH-07; adding runners is not a dependency-remediation claim. Shared CI, final consumer adoption and independent human review remain separate follow-up work.

### LE-05 consumer adoption

Both personal route files now use withApiHandler, including OCR early failures.
Actual streamed bytes are bounded before formData. OCR refreshes the current
actor before reading and before admission, and never converts an engine failure
into an empty 200. See [resource limits](ocr-resource-limits.md) and OpenAPI v3.
Earlier handoff paragraphs above describe the HA-07 publication baseline.
