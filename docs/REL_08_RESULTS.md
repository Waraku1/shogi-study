# REL-08 Native Chromium Worker shutdown

**STOP — NATIVE TRACE NOT AVAILABLE.** The Linux runner can match live dedicated Worker targets to OS tasks and sample their wait channels. It could not show a symbolized Worker shutdown stack or internal DevTools agent teardown. The mechanism behind the retained target remains unresolved. The feasibility gate stopped the experiment before any real-WASM trial. [Issue #19](https://github.com/Waraku1/shogi-study/issues/19)

The existing `chore/rel-08-native-worker-shutdown` branch and PR #18 both started at `1f92faefddf09f4684483e0952843f53a70b4094`. The branch adds the diagnostic evidence and CI base trigger. The REL-07 harness, application, original five-second assertion, and engine bytes remain unchanged. [PR #18](https://github.com/Waraku1/shogi-study/pull/18)

## Feasibility gate

The runner used Debian 13 Chromium `156.0.8078.79` (`156.0.8078.79-1~deb13u1`, CDP 1.3, Chromium revision `a21ce95c24ce3964416f09ae1862f53f319eb4d0`) on Linux 6.18.57 x86-64. The ELF is stripped and has build ID `052c8f04af4a1e885c8bd7ec2b3ba8c33662622f`. The nonprivileged runner had no matching separate debug file and no `gdb`, `lldb`, `eu-stack` or `perf` executable. An own-process software `perf_event_open` with kernel and hypervisor events excluded returned `EPERM`. No privileged diagnostics or host setting changes were used.

Two short controls used the REL-07 private CDP pipe with a blank page and an idle host JavaScript Worker owning one child. Each Worker remained unattached. Before disposal, `SystemInfo.getProcessInfo` listed the renderer OS PID. The trace event `TracingSessionIdForWorker` carried each exact CDP `workerId` and `workerThreadId` alongside the renderer PID. Those IDs matched `/proc/<pid>/task/<tid>` directly. Parent IDs identified the host and child, even though the discovery URLs were blank. This mapping was proven in both no-engine controls. The REL-07 failure thread attribution remains from that run's trace and topology, with no contemporaneous `/proc` snapshot.

Both Worker tasks exposed `comm`, state `S`, `wchan=__futex_wait` and `/proc/.../syscall` before disposal. Kernel `stack` reads returned `EACCES`. A one-second, `strace -k` futex-only probe attached and detached from both test-owned Workers before dispose. It showed pending futex calls and yielded no usable Chromium stack. Both CDP targets were destroyed and both task entries had disappeared by the snapshot about 303 ms after `terminate()` returned in each control. These are control observations under a syscall observer, separate from any real-WASM shutdown verdict.

The second control added `devtools`, `shutdown`, DevTools target rundown, and Worker scheduler tracing, plus targeted Chromium stderr verbosity for the Worker and DevTools agent files. The trace contained renderer-route cleanup, page DevTools messages, and script metadata. It exposed no Worker-thread shutdown transition or Worker agent destruction path. The stderr probe yielded no matching lifecycle message. `Target.targetDestroyed` confirms removal from CDP discovery, and task disappearance confirms the sampled OS task is absent. A futex wait identifies the kernel wait channel without identifying the owning Chromium function or isolate state. [Sanitized capability evidence](REL_08_EVIDENCE.json)

| REL-08 native experiment | Count |
| --- | ---: |
| Maximum valid completed-search trials | 12 |
| Started / valid / failed / invalid real-WASM trials | 0 / 0 / 0 / 0 |
| Real-WASM slots unused after the gate closed | 12 |
| No-engine feasibility controls, outside the trial count | 2 |

## Upstream diagnostic handoff

Suggested title is “Dedicated Worker target retained and unresponsive after nested Worker teardown and parent terminate returns.”

1. Check out `1f92faefddf09f4684483e0952843f53f70b4094`. Use Chromium `156.0.8078.79`, Node 24 and pnpm 11.25.0. Prepare the pinned Fairy-Stockfish 1.1.12 files locally. The existing runner verifies all five file sizes and hashes and the production host script. [Pinned hashes and launch flags](REL_08_EVIDENCE.json)

   ```sh
   pnpm install --frozen-lockfile
   pnpm engine:prepare
   CHROMIUM_PATH=/usr/bin/chromium node tests/diagnostics/rel-07.mjs work/rel-07/upstream-repro
   ```

2. The standalone harness serves a COOP/COEP loopback page, makes a dedicated host with two pthread Workers, and configures Shogi, one thread, 16 MiB hash, and NNUE disabled. It searches `startpos moves 7g7f 3c3d` with `go movetime 100`. After `bestmove`, the page sends dispose, receives acknowledgement, and calls native `terminate()`. Expected result is zero Worker targets at five seconds. The historical REL-07 reproduction runs up to 12 trials per attachment regime and writes output locally. REL-08 did not run it.

3. REL-07 observed one failure in each of 12 valid trials per regime. Both returned `bestmove 4i5h ponder 2b8h`, acknowledged disposal, and returned from parent `terminate()`. The two children were destroyed before cutoff in each case. The unattached failure had zero auto-attach commands and events and `attached: false` on all Worker observations through cutoff. A separate post-cutoff evaluation timed out in each retained target.

| REL-07 failed trial | Host CDP target ID | Still enumerated after dispose | Child targets destroyed after dispose |
| --- | --- | ---: | ---: |
| A11, auto-attached | `D92BC8B41ADDBF874F1DE696081B54F3` | 5001.948 ms | 6.177 / 2004.728 ms |
| B07, unattached | `8ACF566804515857C7EE0981C802FA0E` | 5001.741 ms | 31.829 / 2001.689 ms |

Ask Chromium maintainers to correlate Blink Worker-thread shutdown and backing-thread exit with the browser dedicated Worker host, renderer agent disconnect, and DevTools agent host destruction in the **same retained-target trial**. Capture target token, PID, TID, and timing from before the completed search through the unchanged cutoff. Include `disabled-by-default-devtools.timeline` to carry the target token and OS TID. Use a supported symbolized build or source instrumentation visible on both sides. Prefer the unattached regime within a 12-valid-trial native capture limit. Capture the target verdict before intrusive stack attachment. Compare one passing shutdown against the first divergent event in the failure. The retained CDP target alone leaves an OS thread leak, a vacant isolate, and the code responsible unclassified. [REL-07 failure traces and target timings](REL_07_EVIDENCE.json)

**Recommended decision.** Request that bounded upstream investigation, using this packet and a symbolized capture environment. Keep public distribution blocked. The intermittent target count affects test reliability. Resource retention and player impact in production remain unmeasured. Engine reuse could reduce disposal frequency while leaving shutdown on exit and when fair-play requires disposal unverified. A production containment change is unsupported by the available evidence.

## Regression and release status

The existing suites ran serially with the capability controls stopped.

| Command | Local result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | 133/133 PASS |
| `pnpm build` | PASS |
| `pnpm test:browser` | 29/29 PASS |
| `pnpm test:online` | Initial startup failed with `ENOENT` for Wrangler's default config directory before any test ran. The same command with workspace-local `XDG_CONFIG_HOME` passed 6/6. |

The stacked PR records final-head CI. [REL-07 passing CI](https://github.com/Waraku1/shogi-study/actions/runs/44694500073) · [REL-06 failed CI](https://github.com/Waraku1/shogi-study/actions/runs/44689090892)

Public release remains **NO-GO**, with `ownerApproval=pending` and `publicDistribution=blocked`. Worker disposal is unresolved. Real Google OAuth, billed Workers/Durable Objects CPU and subrequest accounting, copyright and contributor rights, GPL grant and corresponding-source access, and operator approvals remain open. The owner reports completing Mac and physical-device checks. Actual outcomes and device/VoiceOver evidence still need to be recorded in the release ledger. [Owner checks](REL_04_OWNER_CHECKS.md)
