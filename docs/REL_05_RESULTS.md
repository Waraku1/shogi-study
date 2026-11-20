# REL-05 — correlated WASM shutdown failure

**Classification: CAUSE STILL UNRESOLVED.** A failing original regression now has independently captured CDP target and shutdown evidence. No application-side corrective change is proven; no speculative adapter/bridge change is shipped. **CONDITIONAL GO for local technical investigation only; public release remains NO-GO.** Refs [Issue #13](https://github.com/Waraku1/shogi-study/issues/13).

## Source and scope

Existing branch `fix/rel-05-wasm-worker-lifecycle` was fetched/switched at exact required base **9b7a6fb45f5c18c011c3d6a5e649f52b86b5aaad**, with a clean worktree. PR #12 and earlier branches remain unchanged. This new PR targets `feat/japanese-study-workspace`; final head and exact-head CI are recorded in its PR evidence.

Read the full issue and all six specified evidence/implementation/test files. Runtime inputs throughout the investigation are the unchanged baseline `adapter.ts`, `engine-host.js` and pinned Fairy-Stockfish 1.1.12 assets. Captures truthfully record baseline HEAD plus `dirty=true` for the diagnostic working tree. No root license, backend, dependencies, binary, feature or legacy assertion/deadline changes.

Only the opt-in observer, CI base trigger and these results/evidence change. `lifecycle-observer.ts` correlates window host IDs H1/H2, host URL query IDs/CDP parent-target IDs, child IDs C1/C2, init/dispose/ack/close, native termination calls and the existing adapter fallback timer using independently sampled epoch timestamps. A routed prefix instruments only the project bridge; upstream engine bytes remain unmodified. Browser target-created/changed/destroyed events, final enumeration and bounded runtime evaluation are captured **before fixture teardown**. No always-on production logging, secrets or heap snapshots. Instrumentation affects scheduling; it is not itself a release behavior fix.

## Bounded reproduction and preserved evidence

Linux 6.18.57 x86_64, Node 24.22.1, pnpm 11.25.0, Chromium 156.0.8078.79; serial, one test worker. Original five-second zero-worker assertion stays intact.

```sh
SHOGI_OBSERVE_LIFECYCLE=1 SHOGI_LIFECYCLE_OUTPUT=work/rel-05/pre-reset \
  pnpm exec playwright test tests/browser/spike.spec.ts \
  -g 'reset during analysis' --repeat-each=20 --max-failures=1
```

**13 attempts executed: 12 PASS, attempt 13 FAIL; remaining seven not run.** Stopped on the first failure with correlated evidence, within the 20-reset budget. No pre-fix full-handshake repeat series was needed after this capture (0/10 budget used). Additional controlled probes below executed six cases, for **19 total diagnostic invocations**, separately labeled rather than presented as ordinary reliability repeats.

[Sanitized failing timeline and series counts](REL_05_EVIDENCE.json) retain target identity, liveness result, observation/capture metadata and hashes of raw traces/reports. Raw `work/rel-05/pre-reset/`, `pre-reset-results/` and each `probe-*-results/` directory was preserved before another test run could overwrite Playwright output. REL-03/04 original evidence is untouched. Playwright's extra summary “error was not a part of any test” is its recorded **maximum-failures stop notification**, not a second unreported test failure.

## Failing attempt timeline

Times are milliseconds relative to first window host construction; independent clocks can differ slightly. H1 is the UI reset/startup host; H2 is the subsequent explicit adapter/search host.

| Relative ms | Observed event |
| --- | --- |
| 0 / 29.45 | H1 constructed / init reaches host |
| 67.24 / 92.17 | Parent requests H1 disposal / host receives it; H1 subsequently closes normally |
| 149.65 / 173.66 | H2 constructed / init reaches host |
| 267.26 / 765.91 | H2 creates pthread children C1 / C2 |
| 1044.51–1045.09 | Adapter schedules existing 2 s fallback and sends dispose; H2 receives it |
| 1046.93–1048.47 | Both child `terminate()` calls enter and return |
| 1048.48 / 1050.47 | Host posts disposed acknowledgement / parent receives it |
| 1050.48–1050.50 | Parent calls native host `terminate()` and returns; acknowledgement cancels fallback, which never fires |
| 1052.40 / 3051.17 | Independent CDP destroys C1 / C2 targets |
| At original 5 s assertion deadline | Playwright still reports H2; original test fails |
| Before teardown, capture completes at 6993.21 | Independent `Target.getTargets` still contains the same H2 target, attached; bounded Worker evaluation times out rather than responding |

H2 target ID **E95ABA4C9AF4E2451E1913F9D30BB5B0** and parent/child IDs are retained in the evidence. No target-destroyed event was observed for H2 during capture. This is **more than a lone Playwright list entry**: the browser independently retained an unresponsive host target after the children closed. It does **not** prove an OS thread/memory leak, that JavaScript remains executing, or a specific V8/WASM/Chromium internal wait. A target can be stuck in shutdown. Host-close diagnostic delivery can be interrupted by parent termination, so its absence alone cannot establish that close was never invoked.

## Narrow scheduling probes — hypotheses remain unproven

Each probe used the original real-WASM reset test with its unchanged assertions and stop-on-first-failure. Select with `SHOGI_LIFECYCLE_PROBE=<name>` alongside the opt-in observer/output flags. The intentional 200 ms pause is **test-only** and does not extend an assertion deadline.

| Probe | Actual outcome / implication |
| --- | --- |
| `early-ack`: pause host task for 200 ms after posting acknowledgement | **First case FAIL**, two planned cases cancelled; same retained H2 target and unresponsive evaluation |
| `close-before-ack`: close first, then acknowledge/pause | **First case FAIL**, two cancelled; merely reordering close/ack is not a demonstrated cure |
| `host-owned`: skip parent hard termination after ack; let host resume/close after the pause | **First case FAIL**, two cancelled; simple removal of eager parent termination is not a demonstrated cure |
| `drain-search`: test-only Stop, reassert Stop on info until bestmove, isready barrier, then dispatch real dispose | **3/3 PASS**, 25.6 s; preliminary observation only. Two idle/startup H1 hosts waited for a bestmove that could not arrive and required the existing 2 s hard fallback. This is not a safe, complete production fix. |

The pause probes intentionally alter scheduling and cannot alone prove the mechanism of the original unpaused failure. Three drain passes cannot establish reliability or justify shipping a new shutdown protocol, especially with the observed idle/startup flaw. No startup guard, timer extension, forced target removal, bypassed assertion, engine replacement or speculative disposal change is included. The exact native shutdown/blocking cause remains open. Next scoped work should isolate nested pthread/host shutdown and browser target teardown independently of React, retain liveness evidence at failure, and handle idle/startup as well as active searches before proposing a runtime change.

## Complete regressions

| Check | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS, dependencies/lock unchanged |
| `pnpm typecheck` | PASS, browser and Worker |
| `pnpm test` | **133/133 PASS**, 2.50 s |
| `pnpm build` | PASS; ordinary local build, pinned assets unchanged |
| `pnpm test:browser` | **29/29 PASS**, 1.1 min; exact duration in evidence JSON |
| `pnpm test:online` | **6/6 PASS**, 37.8 s; real local Workers/D1/SQLite DO with test identities |

The ordinary full suite runs **without** the observer/probe environment flags. All original 133 unit, 29 browser and six online tests are preserved, with no edits to `spike.spec.ts` or other legacy pass/fail assertions. Full regression results do not erase the failed reliability experiment. The minimum post-fix independent repeat requirement is not claimed as fulfilled: **there is no runtime fix**. CI retains every existing base trigger and adds `feat/japanese-study-workspace`; final-head CI is reported in the new stacked PR after its actual run.

## Disposition and independent release gates

**CAUSE STILL UNRESOLVED; CONDITIONAL GO for bounded local technical progress only.** This PR improves evidence and makes the failing lifecycle state independently reviewable. It does not close the disposal reliability gate or assert zero failure probability.

**Public release NO-GO.** Genuine Google OAuth callbacks/sessions, billed-platform Workers CPU/accounting, macOS Safari/real VoiceOver, physical iOS/Android, GPL owner/contributor/content rights decisions and actual-revision corresponding-source delivery remain NOT TESTED/PENDING as applicable. Existing [owner checks](REL_04_OWNER_CHECKS.md) and [licensing decision packet](REL_04_LICENSING_DECISION.md) remain authoritative. No production credentials/data/resources, deployment, merge, license grant or binary publication occurred; distribution flags remain blocked/pending.
