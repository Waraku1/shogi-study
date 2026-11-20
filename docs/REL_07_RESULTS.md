# REL-07 Chromium Worker debugger comparison

## Source and setup

Started the existing `chore/rel-07-worker-debugger-comparison` branch on **`3040618b574c2d763ac093206be06cba42e91464`**, the verified head of PR #16. PR #16 targets REL-05. The REL-07 pull request targets `fix/rel-06-wasm-worker-isolation` and records the exact final SHA and CI result. [Issue #17](https://github.com/Waraku1/shogi-study/issues/17) · [REL-06 evidence](REL_06_RESULTS.md)

The runner uses REL-06's completed-search, immediate-disposal protocol on a blank local page. Each trial uses a fresh Chromium process and profile on the same Linux x86-64 host. Both arms use the same Chromium executable, launch flags, pipe client, local server, production host script and pinned Fairy-Stockfish 1.1.12 files. The server supplies COOP/COEP and the page requires SharedArrayBuffer. The runner verifies the five manifest file sizes and hashes, and compares the served bridge bytes to the REL-06 source. The position is `startpos moves 7g7f 3c3d`. Both arms use Shogi, one thread, 16 MiB hash, NNUE disabled, and `go movetime 100`. The driver follows the same bestmove polling and dispose/acknowledge/native terminate sequence, with the existing two-second parent fallback.

```sh
pnpm install --frozen-lockfile
pnpm engine:prepare
node tests/diagnostics/rel-07.mjs work/rel-07/new-comparison
```

The opt-in runner alternates A and B serially for up to twelve valid trials per arm. It samples the shutdown verdict at the five-second cutoff. A separate timed post-cutoff probe runs only for a remaining Worker and explicitly detaches. Chromium tracing begins before navigation and requests stop immediately after cutoff capture. Trace transport has separate time and byte bounds. Raw traces, protocol logs and setup failures remain under ignored `work/rel-07/`. [Sanitized evidence](REL_07_EVIDENCE.json)

| Regime | CDP operation before the cutoff |
| --- | --- |
| A | The direct client explicitly attaches the driver page, then calls `Target.setAutoAttach` on the page session and again on its auto-attached host session. Both calls use `autoAttach=true`, `waitForDebuggerOnStart=false`, `flatten=true`, and a Worker-only filter. |
| B | The same client attaches only the driver page. Browser-level target discovery and enumeration observe the host and children. Every observed Worker attachment flag must be false and the command log must show zero auto-attach calls and zero manual Worker attaches. |

The private inherited Chromium pipe exposes no debugging listener. The trial correlates Worker IDs by parent link and local asset requests. Chromium sometimes leaves unattached target URLs blank. Both arms verify one host and two nested pthread Worker targets. Arm A requires automatic attachment events for all three before dispose. This compares automatic DevTools target attachment without debugger startup pauses. Playwright-specific debugger setup is outside the comparison.

## Outcomes

**No causal effect of debugger auto-attachment was demonstrated.** The retained, unresponsive host reproduced in both regimes. Arm B establishes that automatic debugger attachment is unnecessary for this symptom. The two samples are too small to establish whether attachment changes the failure probability.

| Arm | Valid | Pass | Retained host at 5 s | Invalid in measured run | Cancelled in measured run |
| --- | ---: | ---: | ---: | ---: | ---: |
| A, auto-attached | 12 | 11 | 1 (A11) | 0 | 0 |
| B, unattached | 12 | 11 | 1 (B07) | 0 | 0 |

Chromium 156.0.8078.79, CDP 1.3, Node 24.22.1, pnpm 11.25.0, Linux 6.18.57 x86-64. All 24 observed cutoff samples arrived 5000.089–5003.896 ms after dispose. In the 22 passing trials, host target destruction arrived at 2003.510–2011.483 ms in A and 2003.608–2027.279 ms in B.

The preflight stopped with two invalid attempts and 22 cancelled slots. A completed disposal but exceeded the initial trace transport wait. B returned a full trace but the initial identity check required URLs for targets Chromium exposed as anonymous. The verified run used the parent topology plus pinned asset fetches and a ten-second bound for trace completion **after** the cutoff. The cutoff remained five seconds. The original attempts and their available evidence are preserved separately. No extra confirmatory series was needed. The REL-06 no-engine control remains separate prior evidence.

## Cutoff and trace evidence

All times below are milliseconds relative to the parent's dispose send. CDP and browser clocks were sampled independently. In both cases `bestmove 4i5h ponder 2b8h` arrived before dispose, and both nested targets were gone before the cutoff.

| Event | A11, attached | B07, unattached |
| --- | ---: | ---: |
| Bestmove observed | −2.745 | −0.390 |
| Parent received disposed | 2.560 | 0.380 |
| Native parent terminate returned | 2.635 | 0.470 |
| Child targets destroyed | 6.177 / 2004.728 | 31.829 / 2001.689 |
| Host still enumerated at | 5001.948 | 5001.741 |
| Probe manually attached | 5003.567 | 5003.752 |
| Probe result | Evaluation timed out | Evaluation timed out |
| Probe detached | 5508.755 | 5505.049 |

The remaining host CDP IDs were `D92BC8B41ADDBF874F1DE696081B54F3` in A11 and `8ACF566804515857C7EE0981C802FA0E` in B07. B07 had zero auto-attach commands, zero automatic Worker session events and `attached: false` on every Worker observation, including the retained host at cutoff. The manual evaluation used a new session only after the cutoff and detached in both cases. That probe confirms an unresponsive target at the protocol boundary. Its native thread state remains unresolved.

The 24 Chromium JSON traces recorded no buffer loss. All contain driver marks for bestmove, dispose, acknowledgement and return from native terminate. Both failing traces show three initialized dedicated Worker threads. The host trace thread is the one that launched the two nested Workers. Its last observed scheduler task ended at 2004.967 ms in A11 and 2003.126 ms in B07. In each trace, a long function call on a child thread crossed dispose and ended about two seconds after it, near the delayed child destruction. The last trace event and the remaining CDP target describe different boundaries. The traces establish the ordering and sampled task activity, while native thread reclamation and the shutdown wait remain unmeasured. Trace sizes, hashes, target IDs and exact timings are in the evidence file. [Sanitized evidence](REL_07_EVIDENCE.json)

The next discriminator is a native Chromium trace or stack capture that records Worker thread shutdown and DevTools agent destruction in the same failing trial. That can investigate why the target remains after the last observed host task. REL-07 contains the diagnostic runner and evidence only.

## Regression and release status

| Command | Local result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS, browser and Worker |
| `pnpm test` | 133/133 PASS, 2.86 s |
| `pnpm build` | PASS |
| `pnpm test:browser` | 29/29 PASS, 68.11 s |
| `pnpm test:online` | 6/6 PASS, 39.9 s |

The ordinary suites ran once, serially and independently of the experimental processes. The stacked PR records final-head CI. The local results leave the diagnostic failures intact.

Public release remains **NO-GO** because Worker disposal is unresolved. Genuine Google OAuth, billed Workers/DO CPU and subrequest accounting, owner rights, the GPL grant and source delivery, and operator approvals also remain open. The owner reports Mac and physical-device checks completed. Their outcomes and evidence still need reconciliation in the release ledger. Release metadata remains `ownerApproval=pending` and `publicDistribution=blocked`.
