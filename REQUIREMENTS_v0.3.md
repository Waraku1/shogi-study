# Shogi Learning Platform — Requirements v0.3 (Design Baseline)

Date: 2026-11-16  
Status: DESIGN BASELINE / NOT IMPLEMENTED

## 1. Product goals

An English-language web/PWA product combining (a) Shogi play, (b) optional short learning activities during opponent waiting time and outside games, and (c) post-game analysis. Target learners: high-school to university level. Target audience: a few to a few dozen users. Development and operations cash budget: USD 0.

## 2. Confirmed decisions

- Initial game: **Shogi only**. Architecture should allow future games, without implementing a generic board-game engine in MVP.
- Delivery: **Web / installable PWA**.
- Interface language: **English**.
- Account registration: **required for online games**, with OAuth proposed and provider not yet confirmed; guest local demonstration can remain available.
- AI play and analysis: **client-side WebAssembly**, no paid AI inference backend.
- Study: **English vocabulary first**, a small representative set of other-subject learning cards.
- Source repository: **public GitHub repository**. License must be resolved prior to incorporating/distributing GPL components.
- Online play: invitation-based game rooms, server-authoritative state and clock.
- Build strategy: runnable vertical slices, minimal documentation overhead, tests for rules, synchronization and protocol handling.

## 3. Priority definitions

P0: required to call the first privately accessible MVP complete.  
P1: immediate improvements after P0.  
P2: longer-term expansion.

### P0

1. Interactive 9x9 Shogi board, sides, hands, drops, promotions, legal-move validation, and end-of-game behavior.
2. Local human-vs-human play and AI play with usable difficulty presets (not yet a claim of professional strength).
3. Registration, sign-in, sign-out and protected online game identity.
4. Invitation-only 1v1 online play, legitimate move validation and authoritative clock, reconnection of ongoing games.
5. Game record persistence and move-by-move replay.
6. Optional waiting-time study cards (vocabulary plus sample other subjects); quick dismiss when opponent moves.
7. Local analysis board with replay and manually created variations; no real-time assistance in live ranked/competitive online games.
8. English UI and basic responsive design; accessible offline static shell where practical.
9. Operation on free service quotas or safe graceful failure on quota exhaustion; no payment information required.

### P1

- AI evaluation, MultiPV (best and alternatives), principal variations, candidate-move comparison, error classifications.
- Better difficulty calibration, stronger Shogi-specific engine if practical and legally compatible.
- KIF/CSA/SFEN export/import, client-side export/backup and learning spaced repetition.
- Context-sensitive templated Shogi guidance based on engine data, without paid LLM dependency.

### P2

- Further games, spectator mode, ratings, richer subject curricula, personalized study, natural-language LLM advice if a truly free and sustainable approach is demonstrated.

## 4. Proposed architecture (not yet provisioned)

- UI: React, TypeScript, Vite, responsive CSS, PWA service worker.
- Shogi rules/records: `tsshogi` (MIT), with package version pinned after local evaluation.
- Engine adapter: Web Worker + USI protocol; first trial `fairy-stockfish-nnue.wasm` (GPLv3). Alternative YaneuraOu WASM considered for higher strength after memory/performance verification.
- Client persistence: IndexedDB for learning progress, local records, optional analysis cache.
- Online API: Cloudflare Workers; users/sessions in D1; per-game authoritative state + sockets in SQLite-backed Durable Objects (pending free-tier tests).
- Identity: Google OAuth + a server-side session library are **candidates**, not approved final implementation; Worker CPU limits must be measured.
- Secrets remain server-side. No production credentials in the repository.

## 5. Data boundaries

- `User`: userId, displayName, auth-provider metadata (private server storage).
- `Game`: gameId, players, status, outcome; server-owned online state.
- `Move`: ply, USI, server timestamp, remaining clock.
- `Position`: SFEN; branch record is kept structurally separate from canonical online history.
- `Analysis`: position, engine identification/version, search budget, depth, MultiPV, score, candidate moves, PV.
- `LearningItem`: immutable content identifier, subject, level, prompt, answer/explanation, source metadata.
- `LearningProgress`: per-user per-item review state, locally stored initially.

## 6. Quality and fairness rules

- Rules cannot be decided by AI engine output; deterministic Shogi rules library is authoritative locally, and server validates online moves.
- UI must not block move notification, clock display or user input because learning panel is open.
- Do not provide candidate moves, score or recommendations for ongoing online games where they would provide unfair advantage.
- A legal Shogi position must remain valid across move -> SFEN -> import/replay cycles.
- Describe engine strength as measured/calibrated, not guaranteed 'professional-plus' until benchmarked.
- Distinguish position score's perspective (side to move / Black) explicitly in analysis UI.
- Do not persist personal account data in public static assets.

## 7. Immediate next deliverable

**SPIKE-01** — local, non-deployed proof of feasibility for legal Shogi movement, client-side WASM AI best move and MultiPV, English prototype board, and resource measurement. Full online backend and OAuth are deliberately excluded until SPIKE-01 ends.

See `SPIKE_01_EXECUTION_CONTRACT.md` and `CODEX_PROMPT_SPIKE_01.md`.
