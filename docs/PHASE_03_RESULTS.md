# PHASE-03 — learning MVP results

Branch `feat/phase-3-learning` verified locally/remotely at **26bd32a4f636a32cd24d5e005c83f3bf950f7d9f** before changes. Implements [Issue #4](https://github.com/Waraku1/shogi-study/issues/4). Stacked PR targets `feat/phase-2-auth-online`; PRs #1 and #3 and their branches stay intact/unmerged. No server/API, database migration, infrastructure, credentials, license decision, deployment or binary publication changes.

## Functionality and content

One `QuickLearn` component and one data/storage service under `src/features/learning/` serve both the intentional guest **Learn** view and optional account-scoped online waiting panel. Cards reveal an explanatory answer; all seeded cards also offer a three-choice quiz with explicit feedback, Remembered / Review again, Next, subject selection, dismiss/reopen and confirmed profile-local progress reset. Keyboard-native buttons, radio groups, fieldset legends, labels/status messages and responsive normal-flow layout avoid covering or blocking the board.

Content version **1**: **104 original vocabulary cards**, each with a definition and original example, plus **20 original interdisciplinary cards** (4 each in mathematics, physics, chemistry, computer science, and history/philosophy including social-science reasoning). **124 cards / 124 mini-quizzes total**, with high-school/university labels. No paid-textbook extracts, external tutoring/LLM calls, generated remote recommendations or game hints. Data tests check IDs, prompts, answers, examples, quiz questions/options, subject/level/version validity and deterministic correct choices. Vocabulary quizzes test the stated academic sense, not every possible dictionary sense. This is a small original seed curriculum, not a formally calibrated course.

Quick Learn defaults **off** per account on this device. The panel body is eligible only when the authenticated user is waiting for a second player or the opponent is to move, with the socket connected. Turn, room/status or connection changes collapse/reset the card interaction; own turns and finished games show no cards. There are no learning timers or background requests, no engine advice, no clock writes and no changes to WebSocket message processing or board-disable conditions. The original online clock display timer is unchanged.

IndexedDB database `shogi-study-learning` v1 stores versioned profile records: preferences, review status/time, attempts, due time and content version. Guest namespace is distinct from JSON-encoded account/user-ID namespaces. Remembered is due in one day; Review again in five minutes. Queue order is deterministic: overdue, new, then future reviews, with due-time/ID tie breaks. Subject selection filters the same queue. Writes confirm transaction completion with strict durability; the UI labels pending saves. Wait for that indicator to clear before reload. Invalid/outdated rows are ignored with a visible message; unavailable/failed/blocked storage uses explicitly labeled, namespaced memory only, with no reload-persistence claim. No cloud sync or export. Browser storage is per-device data, not encryption or an authorization boundary against someone inspecting that browser's files/devtools.

## Actual tests and fixes

Environment: Node 24.22.1, pnpm 11.25.0, Chromium 156.0.8078.79, Debian 13. Only new dependency: **fake-indexeddb 6.2.8**, development tests only. No new runtime library.

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS, browser + Worker configurations |
| `pnpm test` | **61/61 PASS**: all original 51 plus 10 learning data/storage tests |
| `pnpm build` | PASS; final local sample app JS 321.88 kB, CSS 10.32 kB (Vite decimal sizes); unmodified WASM copied separately |
| `pnpm test:browser` | **9/9 PASS**, 28.7 s: all original six real-WASM regressions plus three learning browser tests |
| `pnpm test:online` | **2/2 PASS**, 28.1 s: original two-context Worker/D1/SQLite DO test plus learning/waiting integration |
| `pnpm test:browser --grep 'reset during analysis' --repeat-each 3` | **3/3 PASS** after fixing the cleanup race |

Learning tests cover real browser IndexedDB reload, completed preference/review saves, namespace separation across account switches in the same browser and guest-local mode, reset/cancel, corrupt records, denied storage with honest fallback, due intervals/ordering, keyboard quiz use and 390px layout. The new online test proves default-off opt-in, waiting/opponent/own-turn visibility, toggle/dismiss, disconnect/reconnect collapse, game-end collapse, clocks continuing through study, and legal moves/WS record updates without learning interference. It uses the existing explicit local test identity harness; no real Google OAuth is claimed. Original test files are unchanged.

Observed failures were corrected rather than weakening regressions: the controlled study checkbox now updates immediately while showing an asynchronous save indicator; reload tests wait for actual transaction completion; long online SFEN/invite text now wraps at 390px. The existing reset regression exposed a reproducible WASM startup-disposal race (one failure in three focused pre-fix repeats). The minimal adapter/host fix lets the disposal handshake clean up nested pthreads before host termination and tracks startup children in the project bridge. Three focused repeats and the full nine-test browser suite then passed. Upstream engine assets and their hashes remain unchanged.

CI preserves the existing base triggers and adds `feat/phase-2-auth-online`. Existing unit/browser/online commands automatically include the new learning tests. Exact implementation/test revision: **5b27183a7b4244aa8bfdb4470c3870a56704ede2**. GitHub Actions [run 44001184955](https://github.com/Waraku1/shogi-study/actions/runs/44001184955), job 133765363256, **PASS**: locked install, typecheck, all unit/release tests, build, all browser tests and both online integration tests. This results-recording follow-up changes documentation only; the implementation tested is unchanged.

## Limits and next action

**GO for continued local development of this learning slice.** No new local functional blocker is known from the tests. Storage can be cleared by the browser; writes interrupted before the saving indicator clears are not promised durable. There is no spaced-repetition model beyond fixed due intervals, quiz grading history beyond self-reported review status, cloud learning sync, content import/export or formal educational calibration. Safari, physical-device and assistive-technology QA remain manual checks; a 390px Chromium viewport is not physical-device certification.

Inherited gates remain outside PHASE-03: real Google callback/account creation/sign-out tests with development credentials, Workers Free CPU profiling, GPL/public distribution approval and production/real-device QA. Root LICENSE stays draft and public distribution stays blocked. Next useful local work: teacher/editor review of the seed content and manual keyboard/screen-reader/mobile study/play checks while the separate OAuth/CPU gates are completed.
