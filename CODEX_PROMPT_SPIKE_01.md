# Implementation Prompt — Shogi Study / SPIKE-01

You are implementing the first bounded technical spike of a new English-language Shogi + Learning PWA. Work autonomously, favor a working end-to-end thin slice, and keep code quality high without excess architectural or audit overhead.

## Mission

Create a **locally runnable** React + TypeScript + Vite application showing a legal 9x9 Shogi board, local two-human moves, a real browser WebAssembly engine capable of making at least one legal Shogi move, and the initial analysis display for real engine candidate moves. The aim is to prove compatibility before building OAuth, multiplayer and learning functionality.

## Authoritative baseline

Read `REQUIREMENTS_v0.3.md` and `SPIKE_01_EXECUTION_CONTRACT.md` before working. Their SPIKE-01 scope and acceptance tests govern this task. Do not overwrite an existing repository or assume the remote exists. If this is an existing repository, use a dedicated `feat/spike-01-shogi-wasm` branch. Do not modify an existing production deployment or merge to main.

## Technical constraints

1. Use strict TypeScript, React, Vite, Vitest, and (if feasible) Playwright; favor a simple single-app codebase rather than a monorepo.
2. Use `tsshogi` for Shogi state, legal moves, drops, promotion, and records. Do not reimplement Shogi rules in UI components.
3. Test an officially documented Fairy-Stockfish browser WASM artifact first (`fairy-stockfish-nnue.wasm`). Upstream Shogi support does not prove a given artifact's Shogi board-size support: inspect the actual package and verify before integrating.
4. For any WebAssembly engine use a Web Worker and isolate USI commands, `info` parsing, `bestmove`, stop/dispose, timeouts and errors inside an EngineAdapter. Never block the main UI thread with computation.
5. Implement English labels and a simple accessible Shogi board. Include basic keyboard/focus/aria labels where practical. Aesthetic polish is not the priority.
6. Use an actual, observed engine result. Do not simulate an engine or hardcode `bestmove`/score values as a substitute for working integration. Test code may use mocked adapters, but the demo AI mode must use WASM.
7. No user accounts, OAuth, Cloudflare, backend, online multiplayer, paid API calls, production deployments or remote repository creation in this spike.
8. Document provenance, exact package versions and GPLv3 / MIT notices for distributed binaries and dependencies. If license compliance is unclear, record the blocker and do not publish a redistributable artifact.

## Implementation order

A. Scaffold; run and verify TypeScript/build/test commands.
B. Integrate rules and board; test legal/illegal moves, drops, promotion, captures, SFEN/USI round-trip, and record replay.
C. Inspect WASM package, worker startup requirements, required assets, memory use, single-thread/multithread availability and USI support.
D. Implement worker adapter and handshake. Prove a real `bestmove` in initial position and in a non-opening position; validate moves through tsshogi before applying.
E. Request MultiPV (if available); parse `info depth`, score, multipv, PV; display source data accurately. State score perspective and terminal-mate semantics.
F. Wire human-vs-AI play, cancel stale searches when starting/resetting a game, display errors and loading state.
G. Test 10 sequential searches, worker cancellation and disposal, build/typecheck, and basic responsiveness; record observed performance and limitations.
H. Produce a concise completion report and `docs/SPIKE_01_RESULTS.md` with versions, machine/browser, elapsed timings, file sizes, commands, pass/fail and unresolved items.

## Engineering decision handling

- If the selected npm WASM lacks working 9x9 Shogi support or fails in the browser, record concrete failure evidence; test a compliant alternative (including upstream Fairy-Stockfish variants or a YaneuraOu WASM port) within the same bounded spike where feasible.
- If threaded WASM needs COOP/COEP, implement local dev headers and document hosting implications; prefer a viable single-thread build when possible.
- Do not call any simple minimax/mock/opponent a high-performance Shogi AI. If a real engine is blocked, ship the legal board slice, mark engine integration BLOCKED, and identify the smallest next corrective action.
- No unverified claim of pro-level or superhuman Shogi strength.

## Required final response

1. Exact files changed and package versions.
2. Actual commands executed, with pass/fail results.
3. Real observed WASM USI handshake / legal move / MultiPV outcome.
4. Runtime/memory or bundle-size findings, or explicit measurement limitations.
5. License and provenance status.
6. GO / CONDITIONAL GO / NO-GO decision and the single most useful next task.

Do the work now; do not stop at a generic implementation plan.
