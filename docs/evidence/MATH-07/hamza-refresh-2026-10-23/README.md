# Current dependency requalification — 23 October 2026

PR #16 is integrated with merged main `e5aef63`, preserving the actual enrollment/RLS application and every existing assertion. The former Next/config 16.3.8 candidate is superseded by the published, aligned **16.4.3** pair; existing sharp 0.35.5 and source-map-js 1.2.2 overrides and Node 24.22.1/npm 11.19.1 target remain. No unrelated direct dependency or business code is changed. The lock delta after the prior PR head is limited to 12 members of the Next/config/SWC family, listed in `lock-changes.json`.

## Why the former qualification is no longer sufficient

Fresh audits of the exact former PR head `5233134` manifest/lock both exit 1 and report Next as one critical-severity package through three distinct current advisories. The former zero-production-alert claim describes its dated run only:

* [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r): App Router + at least one Server Action can be vulnerable to CPU exhaustion; this application uses both, so the prerequisite is present. No exploit was run.
* [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw): Linux/glibc image optimization issue. The maintainer documents sharp >=0.35.5 as a workaround, already pinned here; no `next/image` application import or SVG optimization option was found. This conditional exposure is not claimed as a demonstrated exploit.
* [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr): affected cache-component functions returning typed arrays. No `use cache` or cacheComponents setting was found in this tree; the framework update is still applied.

The maintainer identifies 16.4.1 as patched for these advisories; the aligned 16.4.3 candidate is confirmed in the registry and [official release](https://github.com/vercel/next.js/releases/tag/v16.4.3). Registry version/engine/peer outputs and the prior audits, original exit codes and lock hash are retained as `prior-*`. No `latest`, force fix or major downgrade was used.

## Actual checks

Clean `npm ci` and full `npm run test:ci` pass: **618 unit, 213 API/PostgreSQL, 19 Chromium E2E**, lint/types, exact collection, production build and disposable cleanup. This local run actually used **Node 26.8.1 / npm 11.19.1**: the attempted npx runtime wrapper did not select Node 24 locally, and no Node-24 local proof is claimed. The pinned Node 24.22.1 Linux result must be checked separately in GitHub Actions for this new revision. The package engine warning is retained in the installation output and does not substitute for the actual runtime.

Both fresh audits of the updated lock exit **0**, reporting **zero vulnerabilities**, including production. The former braces advisory is not returned by this current registry snapshot; that does not retroactively accept the earlier proposed exception or guarantee future audit results. Current metadata, command exit codes, actual dependency paths, lock hash and all suite logs are adjacent. Native sharp 0.35.5 / librsvg 2.63.2 processes a synthetic PNG successfully on macOS ARM64 (`native-sharp.json`). Historical evidence remains dated; it is not presented as proof on this revision.

The shared harness baseline remains honestly labelled privileged bootstrap. HA-04's dedicated actual restricted-login suites are included in this run; the global fixture label is not rewritten to pretend otherwise. No personal/deployed database, real receipt or real notification was used. Full notification runtime remains independently draft #9 and is not included in this branch.

Release acceptance by Hugo and confirmation/qualification of the actual deployment OS remain delivery responsibilities. A successful source merge or CI does not claim those actions occurred. Reproduce the full suite and native checks on that delivery target before release. Reverting versioned manifests is possible if a regression appears, but reverting to a vulnerable framework is not a durable security fix.
