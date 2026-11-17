# SPIKE-01 actual results

Date: **2026-11-17 (Asia/Tokyo)**. Recommendation: **CONDITIONAL GO**.

REL-01 follow-up: [release-readiness results](REL_01_RESULTS.md) and [candidate/hosting guide](REL_01_RELEASE_READINESS.md). The measurements below remain the original SPIKE-01 evidence. REL-01 adds a draft GPL-3.0-only proposal (owner approval pending), verified local source packaging, retained toolchain notices and PR CI; it does not publish a release.

The local prototype meets the technical spike acceptance tests on desktop Chromium: legal board, actual WASM AI replies, real MultiPV and independently validated full variations, cancellation, and repeat searches. Redistribution remains gated by the application’s GPL integration/license decision and corresponding-source packaging. No production deployment, infrastructure change, binary release, or merge was performed.

## Implementation and test environment

Read the three governing documents in full before changes. Base: `887cd9f27ce874b298b0050c1949f3baf0610e9b`; branch: `feat/spike-01-shogi-wasm`. The governing documents remain unchanged.

React/strict TypeScript/Vite single app; deterministic tsshogi rules and records; separate classic Web Worker bridge for the upstream Emscripten factory/pthread workers; engine-neutral adapter and isolated USI parser. English accessible board, two-player play, human Black vs AI White, hands/drops/promotion, undo/new game/resign, terminal handling, time budgets, and selectable candidate/PV previews that preserve the game record. All engine moves and every PV ply are checked with tsshogi. Stale searches are discarded. No engine output adjudicates a playable position.

Debian GNU/Linux 13 x86_64, AMD EPYC 9V45 host, **3 exposed vCPUs**; Node **24.22.1**, pnpm **11.25.0**. Browser: system **Chromium 156.0.8078.79**, headless desktop 1440×1100; responsive viewport 390×844. Branded Google Chrome, Safari/WebKit, Firefox and physical mobile devices were not available/tested. This is Chrome-family evidence, not a cross-browser certification.

Exact direct packages: React **19.3.1**, React DOM **19.3.1**, tsshogi **2.3.4**, fairy-stockfish-nnue.wasm **1.1.12**, TypeScript **7.0.2**, Vite **8.3.8**, @vitejs/plugin-react **6.3.0**, Vitest **5.1.0**, @playwright/test **1.65.1**, @types/node **26.6.6**, @types/react **19.3.0**, @types/react-dom **19.3.0**. Lockfile pins transitives; license snapshot includes runtime scheduler **0.28.0**.

## Commands and outcomes

| Actual command / check | Result |
| --- | --- |
| `pnpm add -E react react-dom tsshogi` and `pnpm add -DE typescript vite @vitejs/plugin-react @types/react @types/react-dom @types/node vitest @playwright/test fairy-stockfish-nnue.wasm` | PASS; all direct versions pinned |
| `pnpm install --offline --frozen-lockfile` | PASS, already up to date |
| `pnpm engine:prepare` | PASS; pinned version and five SHA-256 hashes verified; local assets/notices prepared |
| `pnpm typecheck` | PASS; strict TypeScript |
| `pnpm test` | **34/34 PASS**: 21 rules/integration cases, 13 protocol cases |
| `pnpm build` | PASS; local build only |
| `pnpm test:browser` | **6/6 PASS**, 22.8 s final run; real browser WASM, no mocked demo engine |
| `pnpm preview --port 5174 --strictPort` + `node work/verify-preview.mjs` | PASS; built app served with isolation headers, 81 squares, human move + legal AI reply, three candidates, notices HTTP 200, zero page errors |
| `pnpm licenses list --json` | PASS; installed direct/transitive license metadata recorded |
| `git diff --check` | PASS |

Installation commands used workspace-local XDG cache/data/state paths because the environment’s home cache was not writable. The initial npm/pnpm attempts failed on that cache path; no dependency change was needed. An earlier browser run passed 4/5 and timed out in a test that polled only the most recent transcript line. The test now checks a bounded transcript range; subsequent complete runs pass. The final suite adds interactive capture/drop/promotion and actual engine terminal-token checks.

Rules tests include legal/illegal opening, side enforcement, capture of a promoted piece into an unpromoted hand piece, drops, nifu and promoted-pawn exception, dead-rank drops, pawn-drop mate, optional/mandatory promotion, pinned king exposure, check escape, mate, resignation/undo, no-legal-move loss, fourfold repetition, perpetual-check loss, SFEN/USI/replay round-trip and complete PV validation. Browser tests cover actual controls, keyboard, AI reply, variation isolation, reset, missing assets/headers and mobile overflow.

## Observed engine compatibility and performance

Full machine-readable results (all ten positions, moves and full PVs) are in [SPIKE_01_EVIDENCE.json](SPIKE_01_EVIDENCE.json). These are measured samples, not reference output or strength claims.

The **first requested artifact works for 9×9 Shogi**; no replacement engine was required. Runtime ID: `Fairy-Stockfish [commit: b2e693ef, upstream: , emscripten: 2.0.26] LB`. It is a large-board, SIMD, pthread build. The adapter loads `stockfish.js` through its actual `Stockfish()` factory, attaches `addMessageListener`, sends `usi`, waits for `usiok`, discovers actual option names, sets `USI_Variant=shogi`, `Threads=1`, `USI_Hash=16`, `Use_NNUE=false`, waits for `readyok`, then starts searches. The npm artifact reports `USI_MultiPV` maximum **500**; we request and verify **3** (and **2** after stop). Actual option names use `USI_` prefixes/underscores; the illustrative baseline commands are not used blindly.

| Measurement | Final measured sample |
| --- | --- |
| Full adapter initialization | **692.5 ms**; independent built-UI smoke: **943 ms** |
| Ten sequential 200 ms searches | **200.2–210.9 ms**, mean **204.0 ms**; 10 legal bestmoves applied, no crashes |
| Opening | `bestmove 7g7f`; candidates `7g7f`, `6i6h`, `2h6h`, depths 10/10/9; every full PV legal |
| Non-opening SFEN, after 12 legal moves including captures/drops | `bestmove 7i8h` in **502.4 ms** at 500 ms budget; three legal full PVs, depths 13/13/12 |
| Mate fixture | Actual `bestmove resign`, no candidates, **0.46 ms**; tsshogi independently confirms checkmate |
| Stop active 10-second search | **0.49 ms** acknowledgment; following search returns two legal candidates |
| Main-thread heartbeat during stress run | **269 ticks**, largest gap **30.9 ms**; 10 ms requested interval |
| WASM linear memory | Initial **134,217,728 bytes (128 MiB)**; then **161,087,488 bytes (153.625 MiB)**, stable across the ten searches |
| Main page `performance.memory` | Approx. **12.1 MiB used / 16.6 MiB allocated JS heap**, Chromium-specific coarse measurement |

Stop during preparation rejects that pending search with AbortError and allows a following search. Stop during active search drains bestmove. Dispose rejects an active search and subsequent use. Browser tests confirm **zero remaining page workers** after disposal and asset failure. Reset during loading cannot later populate a new game with stale moves/candidates. These bounded tests do not establish long-duration leak freedom.

The engine always needs `SharedArrayBuffer`/cross-origin isolation even with one **search** thread; that is not a single-threaded WASM build. Dev and preview set COOP `same-origin` and COEP `require-corp`. Missing headers produce an explicit error before worker creation; missing WASM produces an explicit error with no fabricated candidates. Both preserve legal local two-player play. No non-threaded fallback is bundled. Initial and warmed startup were not separated into a statistical benchmark. WASM heap measurements exclude total browser process, worker, GPU and OS overhead; no total-RSS/mobile memory claim is made.

Scores retain raw centipawns, side-to-move perspective, bounds and each line’s own depth; final candidate depths/scores may differ when the time limit interrupts an iteration. For this engine’s **USI** output, positive mate means the analyzed side mates, negative means it is being mated, distance is **plies**, and mate 0 means already checkmated (verified against tagged `src/uci.cpp`). The UI never substitutes fabricated scores or recommendations. Playing strength and time-budget presets are uncalibrated; no professional-strength claim.

## Local asset sizes and license status

Uncompressed engine: WASM **1,636,293 bytes**, factory JS **64,273 bytes**, pthread JS **3,321 bytes** = **1,703,887 bytes** runtime assets; with upstream GPL/credits, **1,744,658 bytes**. WASM gzip via Node zlib defaults: **494,143 bytes**, not a measured network transfer. App JS **288,109 bytes**, CSS **8,769 bytes**; Vite reports approximately **89.33 kB / 2.87 kB gzip**. Engine assets are copied separately, not included in the app JS figure.

tsshogi/React/scheduler MIT notices and unmodified engine GPLv3/AUTHORS texts are retained. [LICENSE_INVENTORY.md](LICENSE_INVENTORY.md) and [engine-provenance.json](engine-provenance.json) record exact source/tag/build workflow and hashes. Upstream’s tagged publish workflow selects its no-embedded-NNUE build; this app explicitly uses classical evaluation and supplies/downloads no NNUE weights. The engine was **not independently rebuilt**. The repository license, integration boundary, corresponding-source delivery and linked-toolchain notices still require a release review. Public source visibility alone is not treated as compliance. Engine binaries and `dist/` are gitignored and not published.

## Decision and remaining work

**CONDITIONAL GO for continuing local development.** There is no engine compatibility blocker on the tested desktop. Before distributing/hosting: resolve the GPL-compatible project license and verified corresponding-source/notices package. Future hosting must preserve isolation headers. Next compatibility checks should use Safari and real modest-memory/mobile hardware; the current mobile result is only a Chromium viewport test. No fallback without shared memory, strength calibration, exhaustive rules certification, entering-king declaration UI, full PWA/offline shell or multiplayer is claimed by this spike.

**Single most useful next task:** settle the application’s GPL integration/license decision and prepare a verified corresponding-source + notices bundle for this exact engine artifact. Account, online-game and study integrations remain outside this spike.

## Exact changed-file inventory

Modified: `README.md`. Added files:

```text
.gitattributes
.gitignore
index.html
package.json
pnpm-lock.yaml
tsconfig.json
vite.config.ts
playwright.config.ts
public/engine-host.js
scripts/prepare-engine.mjs
src/main.tsx
src/app/App.tsx
src/app/styles.css
src/features/shogi/Board.tsx
src/features/shogi/game.ts
src/features/engine/adapter.ts
src/features/engine/usi.ts
src/shared/contracts/engine.ts
tests/shogi.test.ts
tests/usi.test.ts
tests/browser/spike.spec.ts
docs/SPIKE_01_RESULTS.md
docs/SPIKE_01_EVIDENCE.json
docs/LICENSE_INVENTORY.md
docs/DEPENDENCY_LICENSES.json
docs/engine-provenance.json
docs/licenses/tsshogi-MIT.txt
docs/licenses/React-MIT.txt
docs/licenses/React-DOM-MIT.txt
docs/licenses/Scheduler-MIT.txt
docs/licenses/Fairy-Stockfish-GPL-3.0.txt
docs/licenses/Fairy-Stockfish-AUTHORS.txt
```
