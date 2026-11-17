# GATE-01 — targeted local release validation

Implements [Issue #8](https://github.com/Waraku1/shogi-study/issues/8) on `chore/mvp-release-validation`, starting at **1be1b43dcede0aa6d0d906e8b0c89ff09313dd7b**. Exact implementation/test revision: **40d12944f52fecfc327bc302263c5eba9f765639**. Results-only follow-ups do not change that implementation. The new PR targets `feat/phase-4-mvp-integration`; earlier PRs/branches are untouched and unmerged.

## Corrections and local proof

Unknown online status now **fails closed** even on a fresh authenticated browser without a lease. Network/timeout, HTTP/proxy failure, invalid JSON and malformed identity/room data cannot grant Review or engine access. An authoritative 401 permits unauthenticated guest-local use unless a known active-game lease requires confirmation. Stale 401 responses cannot override a newer active observation. Retry online status permits recovery; no URL/localStorage override exists. The UI states that external engine use cannot be prevented by the browser.

For intentional API-free guest use, `pnpm dev:guest` serves a separate **http://127.0.0.1:5174** origin. This explicit compile mode hides online/account entry, uses only guest storage, disables the proxy and rejects `/api/*`; it is not selected by a failed request or URL. Loaded local Play/Learn/Review assets work without the API. There is still no full-offline reload/installability claim. Existing 13 browser tests now start this explicit guest server rather than relying on the old fail-open fallback; their test bodies/assertions are unchanged. Normal-mode authoritative 401 plus actual WASM search is separately tested in online integration.

Status queries now cap membership at **32**, query at most 33 rows via the existing `(userId,roomId)` primary key, check four rooms concurrently, stop after confirmed active/pending detection, and perform at most one scoped cleanup statement. Unknown/failed room responses and over-cap legacy accounts remain blocked. The participant-only internal `/status` response avoids history/SFEN reconstruction. Room loading reads persisted state once instead of twice. Migration 0002 is unchanged/idempotent; old-room resume/backfill and public-only status responses remain intact. See the owner checklist for bounded legacy/pending recovery; do not delete uncertain memberships to enable analysis.

## Actual local CPU and latency

`node scripts/profile-local.mjs` completed on Node **24.22.1**, pnpm **11.25.0**, Linux, local Wrangler **4.162.0**. It uses isolated gitignored state, real local D1/SQLite DOs and fake sessions only. Each row below has 40 warmed sequential requests, except WS/fake sign-in (20). CPU is **aggregate Linux workerd process user+system time**, measured without the profiler, divided by requests; 10 ms tick granularity. It includes local Worker/DO/D1/proxy work, not production per-request billing. Separate V8 samples and all raw local profiles are under `work/gate-profile/`; sanitized summaries are committed in [GATE_01_CPU.json](GATE_01_CPU.json).

| Route / memberships | Room requests / D1 statements observed | Wall p50 / p95 ms | Aggregate CPU mean ms |
| --- | --- | --- | --- |
| `/api/me`, guest | 0 / 0 | 3.599 / 6.035 | 2.75 |
| `/api/me`, fixture session | 0 / 1 | 4.148 / 6.734 | 3.50 |
| `/api/play-status`, 0 waiting | 0 / 2 | 4.984 / 8.644 | 4.75 |
| Same, 1 waiting | 1 / 2 | 5.999 / 15.048 | 5.75 |
| Same, 10 waiting | 10 / 2 | 11.279 / 22.296 | 11.50 |
| Same, 32 waiting (new limit) | 32 / 2 | 25.908 / 35.880 | 24.00 |
| Same, 128 legacy, rejected 400 | 0 / 2 | 4.122 / 9.223 | 4.00 |
| Existing-participant room join | 1 / 4 | 8.751 / 19.700 | 8.25 |
| WS upgrade | 1 / 4 | 8.175 / 11.444 | 8.50 |
| Fake sign-in initiation, not callback | 0 / 1 | 6.996 / 13.017 | 7.00 |

A single earlier bounded implementation run before removing the duplicate state SQL read measured 13 ms / 27.5 ms aggregate means at 10/32 rooms, versus 11.5 / 24 ms afterward. This is a local observation, not a statistical improvement guarantee or a comparison to the full original PHASE-04 implementation. Instrumented unit tests also prove concurrency <=4, early blocking after the first active batch, one cleanup for 32 finished memberships and zero room probes for over-limit input.

**Workers Free 10 ms CPU compliance: UNVERIFIED / release blocker.** Aggregate local means exceed 10 ms at 10/32 rooms, but include multiple independent runtime requests; they cannot prove either billed single-request failure or compliance. Actual OAuth session/callback CPU, cold-start behavior, real platform request accounting and per-request maxima remain unmeasured. The bounded fixture status path uses 34 subrequests at 32 waiting rooms (35 with cleanup); the real auth resolver's additional work must be measured against the remaining 50-request budget. No paid workaround or remote measurement is claimed. Reproducible DevTools steps and the full route matrix are in [owner checks](GATE_01_OWNER_CHECKS.md#cpu--subrequests--real-workers-free-compliance-unverified).

## Actual automated checks

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS, no dependency/lockfile changes |
| `pnpm typecheck` | PASS, browser and Worker; server-focused tests checked with Worker types |
| `pnpm test` | **81/81 PASS**, original 71 unchanged plus 10 targeted tests; final run 2.60 s |
| `pnpm build` | PASS, JS 340.51 kB / CSS 11.37 kB; unchanged pinned WASM separately prepared |
| `pnpm test:browser` | **14/14 PASS**, original 13 unchanged plus explicit guest-only offline/API-boundary test; 42.4 s |
| `pnpm test:online` | **5/5 PASS**, original 3 unchanged plus 2 gate tests; 44.3 s |
| `node scripts/profile-local.mjs` | PASS, actual local CPU/latency/counters above; real callback excluded |
| `git diff --check` | PASS |

New tests cover remote active play + new authenticated context with unavailable/invalid status and no lease, recovery after finish, genuine guest 401 + legal WASM candidates, guest-only loaded-page offline navigation, origin rejection, public-only/no-store status, fixture expiry, membership limit/recovery, unknown room responses and stale auth races. Existing online regressions retain two-context authoritative moves, timers/alarms, privacy, session revocation/WS rejection, retries/reconnect, learning and archives. Fixture expiry/revocation is not a real Google session claim. COOP/COEP, upstream engine bytes and all 124 cards remain unchanged.

CI adds the `feat/phase-4-mvp-integration` base trigger while retaining all previous bases. [PR #9](https://github.com/Waraku1/shogi-study/pull/9) GitHub Actions [run 44053277819](https://github.com/Waraku1/shogi-study/actions/runs/44053277819), job 133936125878, **PASS** at `f6b5a28f8e300676df73e16f3209fe105b7293a7`: locked install, browser/Worker typecheck, all unit/release tests, build, browser and online suites. This follow-up records CI evidence only; the tested implementation is unchanged.

## Gates and exact owner actions

| Gate | Status |
| --- | --- |
| Targeted fair-play fix + existing local MVP regressions | **PASS** |
| Bounded lookup / measured local fixture subrequests | **PASS** within the measured matrix |
| Real Google callback, allowlist, two accounts, persistence, sign-out/provider revocation | **NOT TESTED**, no development credential files present |
| Real Workers Free CPU / full real-auth subrequest compliance | **UNVERIFIED**, release blocker |
| Safari/VoiceOver and physical iOS/Android | **NOT TESTED**, environments unavailable |
| GPL owner decision / complete corresponding-source evidence / engine rebuild | **PENDING**, distribution blocked |

**GO for continued local development only; NO-GO for release readiness.** The owner must (1) review this stacked PR; (2) privately configure an existing development Google web client with the exact localhost callback and run the eight OAuth checks; (3) measure actual auth/callback/room CPU and request accounting with the provided Profiler route matrix; (4) execute the Safari, real VoiceOver and physical-device checklist; and (5) approve/reject GPL-3.0-only and resolve the bounded source/rebuild gaps in REL-01. [Exact manual instructions](GATE_01_OWNER_CHECKS.md) include privacy, local setup and recovery details. Root LICENSE remains draft. No merge, deployment, remote resources, credential configuration/ingestion, binary publication or licensing approval occurred.
