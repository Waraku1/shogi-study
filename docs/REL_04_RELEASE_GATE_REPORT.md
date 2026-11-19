# REL-04 — release gate report

**NO-GO for first public release.** Feasible local validation is complete, but the intermittent disposal observation, real OAuth, actual-platform CPU/accounting, Apple/physical-device accessibility and owner rights/source-delivery decisions remain open. A green regression run is not release clearance.

## Frozen baseline and exact revisions

[PR #12](https://github.com/Waraku1/shogi-study/pull/12) was verified open/unmerged on `feat/japanese-study-workspace` at expected **8337b793bf0868b14890a2840142cdd322877575**, stacked on PR #11 **31350667a12e5cb419caef435d0f897b837172f2**. Initial worktree was clean. Existing [REL-03 CI 44424498263](https://github.com/Waraku1/shogi-study/actions/runs/44424498263) remains successful and unchanged. Read REL-03/REL-02 results, owner procedures and release metadata before starting.

REL-04 diagnostic revision **3e78bb8e14dd7b36049155456106739ecd48dc4a** adds opt-in lifecycle observation, local-only profiling counters/metadata and a Chromium renderer restoration test. Follow-up diagnostic revision **134393ea91a9564435ee73287d248b32d2630938** adds independent browser-target/worker-reply checks and passive bridge-message/termination observation. These revisions change **no application/engine behavior or pinned engine bytes**. Existing assertions and five-second worker deadline are unchanged. Final report revision/CI are identified in PR #12; report-only changes do not alter the measured runtime. No new engine is rebuilt/replaced.

## WASM investigation — observation reproduced, cause unresolved

Original REL-03 failure log, JSON, screenshot and trace remain in `work/rel-03/browser-first-failure/` and `browser-first.log`; their hashes are retained in [REL-04 evidence](REL_04_EVIDENCE.json). New failure traces/JSON remain in gitignored `work/rel-04/lifecycle-results/`; they were copied before subsequent test runs.

Bounded series on Linux 6.18.57 x86_64, Node 24.22.1, pnpm 11.25.0, Chromium 156.0.8078.79, one test worker:

| Series / exact test | Outcome |
| --- | --- |
| First observer, full handshake/opening/midgame/10 searches/Stop/dispose, 5 repeats | **5/5 PASS** |
| First observer, reset/preparation Stop/active disposal, 5 repeats | **4 PASS / 1 FAIL**; one `engine-host.js` handle remained after the unchanged 5 s deadline |
| Follow-up observer, same two tests, 3 repeats each | **6/6 PASS**, 44.2 s; no worker handles or independent browser worker targets remained |
| Combined bounded experiment | **15 PASS / 1 FAIL**, not a reliability PASS |
| Subsequent ordinary full browser regression, without observer flag | **29/29 PASS**; does not erase the bounded failure |

The failed observed case peaked at five worker handles during overlapping reset/new initialization, then closed four, leaving one host handle at the deadline. Independent target liveness/bridge-message probes were added afterward; the six cases with those extra probes did **not** reproduce the failure. Consequently the failure cannot be classified as a demonstrated live OS worker leak, stale automation handle, resource-contention effect or harmless timing delay. Instrumentation changes timing and is not proof of a cause. No speculative runtime correction or extended deadline was applied.

Eight full-search observations reported initial WASM heaps of **134,217,728 bytes (128 MiB)**. Warm heaps stayed constant within each ten-search series: either that size or **161,087,488 bytes (153.625 MiB)** after growth. Renderer JS heap peaks across the 16 observed cases were **8,685,184–12,534,476 bytes**. Those are separate measurements; JS heap excludes shared WASM/other processes and no forced GC or OS reclamation proof is claimed. The host had at least 8,333,508,608 free bytes in samples; that alone does not establish absence/presence of contention. Observed Stop times were **0.43–0.84 ms**, heartbeat maximum gaps **27.15–49.56 ms**. No monotonic warm WASM growth was seen within the measured sequences; this does not settle the retained-worker observation.

Reproduce without changing assertions:

```sh
SHOGI_OBSERVE_LIFECYCLE=1 pnpm exec playwright test tests/browser/spike.spec.ts \
  -g 'real WASM handshake|reset during analysis' --repeat-each=5
```

Run serially with profiling/full browser/online tests. Per-case worker create/close events, renderer memory/load samples, remaining URLs, target/reply results and passive bridge messages are saved under `work/rel-04/lifecycle/` and attached to the local Playwright JSON. The two preserved series use separate copied result directories. No runtime-leak fix is claimed; if another failure occurs, retain its target/message evidence before changing implementation.

## Environment and authentication

The existing browser regressions actually verify Japanese pieces/orientation/uniform colors/red promotion/local font/fallback, simultaneous learning/state/focus, JSON/KIF/CSA round trips, historical WASM studies/reload and deletion abort/error/unavailable/Retry/Cancel flows. A new Chromium **renderer** freeze/resume test preserves board/revealed card/study state and reloads the saved study. This does not simulate real VoiceOver or prove physical OS background/restore behavior.

| Gate | Actual status / reason |
| --- | --- |
| macOS Safari and real VoiceOver | **NOT TESTED**: Linux host; neither macOS Safari nor VoiceOver available |
| Physical iOS Safari / Android Chrome, OS background/restore | **NOT TESTED**: no connected/authorized device environment or device bridges available |
| Genuine Google authorization/callback, invited/non-invited accounts, real sessions/logout/expiry/invite reconnect/account isolation | **NOT TESTED**: no `.dev.vars*` and none of the four required development credential/allowlist environment bindings available; no secret values requested/read into evidence |
| Local fixture identity/online safeguards | **6/6 PASS**; test-only sessions and real local Workers/D1/SQLite DO, not real Google OAuth |

Inspected `server/auth.ts` and normal/test/profile configs: normal authentication requires client ID/secret, >=32-character app secret and allowlist; invitation filtering applies at user creation. Allowlist removal is not session revocation, and provider-grant revocation is not proof of local-session invalidation. [Smallest owner actions and full feature checklist](REL_04_OWNER_CHECKS.md) reuse existing GATE-01 procedures, with no request for chat secrets or new remote resources.

## Actual local CPU / request measurements

Ran the existing credential-free profiling procedure with isolated `SHOGI_PROFILE_OUTPUT=work/rel-04/cpu`. Source **3e78bb8e14dd7b36049155456106739ecd48dc4a**; metadata accurately says `dirty=true` because report/observer edits were in progress. Both measured profiling program hashes equal that committed revision (recorded in evidence); application runtime remains baseline 8337b79. Linux local Wrangler **4.162.0**, workerd **1.20261113.1**, compatibility date 2026-11-01 / nodejs_compat. Profiling did not overlap browser experiments.

First application HTTP request after local profile process startup, before fixture logins: `/api/me` **401**, **28.969 ms wall**, **10 ms aggregate workerd CPU** (one 10 ms tick), zero room/D1 counters. This is a local process-first observation, not an edge cold start. Each route also records its first observation after setup; those are **not** independently cold isolates.

Warm sequential batches: 40 requests per row except WS/fake initiation (20), following route-first observation and three warmups; a separate equal-size profiled batch samples V8 at requested 100 μs. Server log confirms **795 application HTTP requests total**, including fixture setup and first/warm/profile phases. Actual local HTTP and DO route names/counters are captured; cookies/tokens are not included in summaries.

| HTTP route / case | DO routes; max room / D1-statement counters | Wall p50 / p95 / max ms | Aggregate CPU mean ms |
| --- | --- | --- | --- |
| `/api/me`, guest | none; 0 / 0 | 3.235 / 6.200 / 7.038 | 2.75 |
| `/api/me`, fixture session | none; 0 / 1 | 3.793 / 5.752 / 9.411 | 3.25 |
| `/api/play-status`, 0 waiting | none; 0 / 2 | 4.538 / 7.604 / 11.173 | 4.00 |
| Same, 1 waiting | `/status`; 1 / 2 | 5.442 / 11.131 / 15.270 | 5.50 |
| Same, 10 waiting | `/status`; 10 / 2 | 10.490 / 17.269 / 18.099 | 10.00 |
| Same, 32 waiting | `/status`; 32 / 2 | 22.590 / 28.358 / 30.849 | 20.25 |
| Existing-participant join | `/join`; 1 / 4 | 6.467 / 13.303 / 15.245 | 6.00 |
| WS upgrade | `/ws`; 1 / 4 | 6.461 / 13.358 / 13.358 | 6.00 |
| Fake sign-in initiation | none; 0 / 1 | 4.923 / 14.460 / 14.460 | 5.00 |
| 128 legacy memberships rejected 400 | none; 0 / 2 | 3.656 / 7.573 / 11.105 | 3.25 |

The 32-room batch is the worst observed aggregate mean and warm wall maximum; it is **not** a 20.25 ms billed entry-Worker request. Aggregate Linux user+system ticks include local Worker/DO/D1/proxy processing; 10 ms granularity cannot establish individual CPU percentiles/maxima. Separate V8 non-idle estimates/raw samples and route-first observations are retained in `work/rel-04/cpu/` and the sanitized evidence. D1 statement counters are not an exhaustive platform subrequest ledger. DO `/create` occurs 32 times in setup; move/alarm/history CPU and real Google callback CPU are not profiled here.

Current official categories checked: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) / [2026 subrequests change](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/): Free entry HTTP **10 ms CPU**, **50 external / 1,000 internal Cloudflare-service subrequests**, not 50 total. [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) specify a separate **30 s default CPU boundary**. GATE-01 owner procedure is corrected accordingly. Actual account/configuration, edge cold behavior, real-auth subrequests and per-invocation platform CPU remain **UNVERIFIED**. No production compliance claim, deployment, provider-resource creation or paid workaround.

## Regression evidence and release decision

| Check | Result |
| --- | --- |
| Frozen install, browser/Worker typecheck | **PASS**, lock/dependencies unchanged |
| Unit/release suite | **133/133 PASS**, 2.73 s |
| Ordinary local build | **PASS**, same JS 380.33 kB / CSS 14.44 kB as REL-03 |
| Full Chromium browser suite | **29/29 PASS**, 1.1 min, including renderer restoration |
| Real local online integration | **6/6 PASS**, 39.1 s |
| Bounded lifecycle reliability | **15/16 PASS; gate remains unresolved** |
| Local resource profile | **Completed**; billed-platform compliance **UNVERIFIED** |

Raw logs live in gitignored `work/rel-04/`; [sanitized evidence](REL_04_EVIDENCE.json) preserves revision/environment, both lifecycle series, memory/responsiveness, route/cold/warm CPU samples and original failure hashes. Final-head CI is reported in PR #12 after the actual run, separately from baseline CI. No assertions were relaxed, engine bytes replaced or completed product features redesigned.

Minimum remaining release steps:

1. Resolve the retained-worker observation with target/bridge evidence at a failing attempt; only isolate/correct a demonstrated defect, then rerun affected and full regressions. Passing retries alone do not close this gate.
2. Owner executes the [Safari/VoiceOver/physical-device and real OAuth checklist](REL_04_OWNER_CHECKS.md) using existing authorized development resources and privately supplied credentials/accounts. These are the genuinely environment/owner-blocked steps; test identities/emulation do not replace them.
3. With separate authorization for access to an existing development platform environment, establish actual Worker/DO CPU and external/internal request accounting, including cold, real auth and representative room history. If no such environment exists, provisioning/deployment requires separate authorization; do not infer compliance from local means.
4. Owner decides original code/content/contributor rights, proposed GPL-3.0-only grant and combined-work/source delivery using the [concise decision packet](REL_04_LICENSING_DECISION.md); address selected backend conveyance and applicable operator/contract approvals. Independent rebuilding/byte identity is optional assurance, not an automatic GPL obligation.
5. Only after gates/decisions and separate publication authorization, select the exact release revision and verify its actual object/source/notices/access mechanism. REL-04 does **not** prepare/publish a release artifact. Root LICENSE and `ownerApproval=pending` / `publicDistribution=blocked` stay unchanged.

**GO for continued bounded local investigation; NO-GO for public release / release gate closure.** Earlier PRs remain unmerged/unchanged, and no production data, credentials, infrastructure or root licensing decision was modified.
