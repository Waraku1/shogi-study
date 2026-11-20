# REL-06 Worker shutdown isolation

**CAUSE STILL UNRESOLVED.** The standalone harness reproduced the retained host with an active search and after `bestmove`. In both failures the child targets disappeared, the host target remained past five seconds and a separate CDP session received no response from it. The results do not establish a source-level defect that a runtime patch can correct. See [Issue #15](https://github.com/Waraku1/shogi-study/issues/15) and [sanitized evidence](REL_06_EVIDENCE.json).

## Baseline and environment

Verified PR #14 open at `7e61b21e25c43b8e9a21e778a3ed866de91ad2e1` on `fix/rel-05-wasm-worker-lifecycle`, targeting `feat/japanese-study-workspace` at PR #12 head `9b7a6fb45f5c18c011c3d6a5e649f52b86b5aaad`. Started `fix/rel-06-wasm-worker-isolation` on the verified PR #14 head with a clean worktree. The new stacked PR records the final commit and CI run.

Linux 6.18.57 x86_64, Node 24.22.1, pnpm 11.25.0 and Chromium 156.0.8078.79. Frozen install and engine preparation passed. Verified the sizes and SHA-256 hashes of all five files in the Fairy-Stockfish 1.1.12 provenance manifest, including the loaded JS, WASM and pthread script. The harness confirmed COOP/COEP isolation and SharedArrayBuffer in each trial.

Verified the nine preserved REL-05 evidence hashes, opened the original raw Playwright trace and checked the raw failing observer JSON. Attempt 13 failed the five-second assertion with one handle. The correlated H2 host received dispose, invoked both child terminations, acknowledged disposal and received native termination from the parent. The two child CDP targets disappeared. H2 target `E95ABA4C9AF4E2451E1913F9D30BB5B0` remained and its evaluation timed out.

## Bounded matrix

```sh
pnpm exec playwright test -c playwright.rel-06.config.ts
```

The opt-in config uses an empty local page, the production host script and real pinned WASM. It drives the Worker protocol directly with the app's engine options and acknowledgement handling. A browser CDP session observes target IDs and parent IDs independently of Playwright's worker list. Detailed cases add diagnostic messages to the local host response. The minimal case serves the exact production bridge and observes parent messages and browser targets. The no-engine control starts two nested Workers, one of which waits on shared memory. Each trial uses a fresh page, and each cell stops after its first failure. Cases vary only the relevant shutdown actions. Startup and idle never wait for a bestmove. The drain case sends Stop only after positive-depth output from the active search, then awaits bestmove and readyok with separate bounded waits.

| Phase | Action | Pass | Fail | Cancelled |
| --- | --- | ---: | ---: | ---: |
| Startup before loaded | Immediate | 3 | 0 | 0 |
| Ready, idle | Immediate | 3 | 0 | 0 |
| Active, observed positive depth | Immediate, detailed | 3 | 0 | 0 |
| Active, observed positive depth | Stop → bestmove → isready → dispose | 3 | 0 | 0 |
| Completed | Dispose after bestmove | 2 | 1 | 0 |
| Active, observed positive depth | Let host close after ack | 3 | 0 | 0 |
| Generic nested Workers | Immediate | 3 | 0 | 0 |
| Generic nested Workers | Let host close after ack | 3 | 0 | 0 |
| Active, observed positive depth | Immediate, minimal | 0 | 1 | 2 |
| **Valid trials** | **27 planned, 25 executed** | **23** | **2** | **2** |

The initial runs include four additional invalid control attempts and eight cancelled control slots. Two attempts lacked isolation headers on the synthetic host response. In the next two attempts the nested script requests bypassed the page route. Serving the child script through Vite corrected that setup error. The six corrected control trials executed in a separate serial run. Raw failure traces, setup logs, reports and probe events are under ignored `work/rel-06/`.

## Failure evidence and causal boundary

Times are milliseconds relative to the parent dispose send. Browser and CDP clocks were sampled independently. A target-destroyed event records browser target removal.

| Event | Completed, detailed trial 3 | Active, minimal trial 1 |
| --- | ---: | ---: |
| State observed before dispose | `bestmove 8h2b ponder 3a2b` at −2.80 ms | Positive-depth info just before dispose |
| Child terminate calls returned | 1.58 / 1.60 | Exact host response served, parent/CDP observation only |
| Parent received disposed | 1.68 | 2.35 |
| Parent native terminate returned | 1.74 | 2.45 |
| Child targets destroyed | 10.45 / 2005.22 | 4.03 / 2002.18 |
| Host target still enumerated at five-second check | `9AE81350459DD4B83E9AB5EAD0ADB97D` | `C7FCFAACA0C9E6E7B76A376DBAF41904` |
| Separate probe session attached / detached | 5013.69 / 5515.65 | 5007.99 / 5510.43 |
| Worker evaluation result | 500 ms deadline exceeded | 500 ms deadline exceeded |

The completed failure establishes that an active USI search is unnecessary for this symptom. The minimal failure removes the diagnostic host prefix as a prerequisite. Both failures reproduced outside React and the game UI. Most initialized cases, including the generic shared-memory control, retained one child target for about two seconds even after the terminate calls returned. The generic hosts subsequently disappeared in all six valid trials. The delay alone therefore fails to distinguish the retained-host case. These samples leave open browser/debugger teardown timing and the engine's thread state. Unresponsive CDP confirms the symptom at the browser target boundary. Native execution and resource reclamation remain unmeasured.

The active drain and host-owned close cells each passed three cases. Both sample sets are limited to active searches. The completed-search failure leaves the underlying shutdown mechanism unproven, so this branch contains diagnostics only. The smallest remaining discriminating experiment is to compare the completed-search case with and without automatic Worker debugger attachment and capture Chromium shutdown tracing for the retained host. Keep the same pinned engine and five-second cutoff for that comparison.

## Regression and publication status

An independent ten-trial run of the original reset test with observer flags off yielded **9 PASS / 1 FAIL**. Trial 3 reported one Playwright Worker at the unchanged five-second assertion. The raw trace is preserved. Target liveness for that observer-disabled trial was not sampled. The standalone trials above provide the independent CDP evidence.

| Command | Local result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS, browser and Worker |
| `pnpm test` | 133/133 PASS, 2.89 s |
| `pnpm build` | PASS, JS 380.33 kB and CSS 14.44 kB |
| `pnpm test:browser` | 29/29 PASS, 66.12 s |
| `pnpm test:online` | 6/6 PASS, 40.5 s |

The standalone diagnostics run only with the separate config. The ordinary regressions preserve the established test counts, assertions and timeouts. Final-head CI is recorded in the stacked PR, with its workflow trigger extended to the REL-05 base branch.

**Public release NO-GO.** Worker disposal remains unresolved, and the separate gates remain genuine Google OAuth, billed Workers/DO CPU and subrequest accounting, Safari and real VoiceOver, physical iOS/Android, and owner rights, GPL source delivery and operator approvals. Release metadata continues to record `ownerApproval=pending` and `publicDistribution=blocked`. [Owner checks](REL_04_OWNER_CHECKS.md) · [licensing decisions](REL_04_LICENSING_DECISION.md)
