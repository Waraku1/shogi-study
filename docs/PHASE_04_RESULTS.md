# PHASE-04 — integrated local MVP

Implements [Issue #6](https://github.com/Waraku1/shogi-study/issues/6) on `feat/phase-4-mvp-integration`, based on `c2b404100e38c62695dd6f7e1fbaaef228b1acbd`. Exact implementation/test revision: **06fa702c8cb16b0129fd25c186f40d1379a25231**. This results file is a documentation-only follow-up. The stacked PR targets `feat/phase-3-learning`; older PRs and branches remain unchanged and unmerged.

## Delivered behavior and limits

- **Play / Learn / Review / Online rooms** navigation preserves practice state and keeps the mounted online socket and clocks running while learning or reviewing. Practice moves/undo/results autosave with a stable game ID; Save game also saves explicitly. Finished participant online games save locally with public names only. Review refreshes after pending saves finish. Saving, failure and memory-only states are visible; wait for saving before reload.
- IndexedDB `shogi-study-games` v1 retains the newest **50 games per guest/account namespace**. A transactional update rejects conflicting imported IDs without overwriting the original; an older import that would immediately be evicted is rejected visibly. Browser storage can be cleared; export important records. Failed/denied storage uses namespaced memory with an explicit warning, preserved through SPA navigation but not reload. Account namespaces prevent in-app mixing, not access by someone inspecting the browser's files/devtools.
- `GameArchive` **source shogi-study / version 1** accepts standard-start USI only, **512 plies / 65,536 UTF-8 bytes** maximum. Every move is replayed legally through tsshogi. Unsupported fields, private metadata fields, malformed/illegal/oversized records, unfinished online records and starting SFEN are rejected. Optional names are bounded public labels; imported result text is unverified. There is no KIF/CSA support or archive synchronization to the server.
- Review has list/select, start/end/previous/next/jump, JSON file/text import, downloadable export and confirmed deletion. A read-only replay is independently reconstructed. Actual browser WASM MultiPV search provides candidates/scores and full legal future variations; exploring never rewrites the saved record. Engine/asset failure keeps replay available with an honest error.
- Active online play disables Review and practice engine assistance, including fresh URLs without a local lease. Authenticated `/api/play-status` checks participant membership against authoritative room snapshots. Migration `0002_player_rooms.sql` adds only a local D1 membership registry; creation/join registers pending membership before the room operation. Resuming an existing room backfills membership. Lookups and registrations are bounded to 128 memberships; unresolved pending rooms fail closed. A browser lease protects known active matches across reload/logout/offline status failures; analysis checks status before and after search. This is a UI fair-play restriction, not protection against a user modifying the client or running a separate engine. Pre-migration rooms must be resumed to backfill membership in an existing local database.
- Turn announcements, promotion focus return, deletion confirmation/cancel focus, responsive Review controls and wrapping improve keyboard/mobile use. The original board navigation remains intact. The manifest and original SVG icon are metadata only: **no service worker, authenticated API caching, full-offline or installability claim**.

Editorial check: all **124 original cards / 124 quizzes** remain, with stable IDs/content version and learning progress. Programmatic checks cover whitespace/choices and a sampled ten-answer factual key alongside existing data checks. The concrete subject mismatch for opportunity cost is corrected to **Economics**. No other concrete factual correction was established. A human teacher/editor should still calibrate difficulty labels, vocabulary senses, distractor clarity and disciplinary coverage; this is not an expert-validated curriculum.

## Actual local verification

Environment: Node 24.22.1, pnpm 11.25.0, Chromium 156.0.8078.79, Debian 13. No new dependencies, binary changes or lockfile changes.

| Command | Actual outcome |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; lockfile already current |
| `pnpm typecheck` | PASS, browser and Worker TypeScript |
| `pnpm test` | **71/71 PASS** (61 existing plus 10 archive/editorial tests), final run 3.26 s |
| `pnpm build` | PASS; app JS 340.16 kB / CSS 11.37 kB, pinned unmodified WASM copied separately |
| `pnpm test:browser` | **13/13 PASS**, 37.0 s (all nine existing plus four Review/accessibility tests) |
| `pnpm test:browser --grep 'reset during analysis' --repeat-each 5` | **5/5 PASS**, 38.0 s |
| `pnpm test:online` | **3/3 PASS**, final run 39.9 s (all two existing plus one integrated Review test); real local Worker/D1/SQLite Durable Objects and two Chromium contexts |
| `git diff --check` | PASS |

Original test files are unchanged. New coverage includes illegal/drop/promotion archives, bounds/corruption/conflicts/retention, guest/account separation, reload and import/export round-trip, replay/variation isolation, unavailable storage/engine, 390px layout, keyboard promotion and deletion focus, fresh-view fair-play restrictions, clocks/Quick Learn/moves across navigation, finished archives and account switching. Browser-only tests run without the optional API; they exercise guest-local fallback. Online tests use the explicit local test identity harness, not Google OAuth.

Defects found and fixed: hidden duplicate practice-board DOM interfered with unchanged online selectors; invisible practice now retains React state without rendering a second board. Delayed autosaves now notify the Review list. A full archive no longer reports success for an immediately evicted older import. The unchanged reset regression exposed another upstream pthread disposal race: the adapter drains/stops active search and the bridge terminates all tracked children without calling allocator cleanup after killing their owners. Five focused reset repetitions and the full browser suite pass; upstream engine bytes/hashes remain unchanged. Room timeout settlement now broadcasts even when triggered by a status lookup.

CI retains all earlier PR base triggers and adds `feat/phase-3-learning`. GitHub Actions [run 44036052557](https://github.com/Waraku1/shogi-study/actions/runs/44036052557), job 133879065642, **PASS** at `6ada9ec246125582d4f127f58bccfbd5b5afc539`: locked install, both typechecks, all unit/release tests, build, browser and online suites. [Stacked PR #7](https://github.com/Waraku1/shogi-study/pull/7) targets `feat/phase-3-learning`. This CI-results follow-up changes documentation only; implementation is unchanged.

## Manual QA and remaining gates

For local review, apply both migrations listed in README, start `pnpm dev:api` and `pnpm dev`, then:

1. Play two practice moves, wait for Saved, switch Learn → Play, then reload and select the game in Review. Replay/jump, analyze, explore/return from a variation, export, delete and import the JSON. Confirm the original move record remains intact. Try malformed/illegal input and denied browser storage.
2. With the local test harness, join an online game in two contexts. Enable Quick Learn; navigate Learn → Play and observe clocks/moves. A fresh `?review=1` must be blocked during play. Resign/finish, then review the saved game and switch accounts to verify separation. Real Google login needs separate authorized development credentials.
3. At 390px and desktop width, use keyboard board navigation, promotion and deletion/cancel; check focus returns and board/timers remain unobscured. Chromium automated smoke passes. **Safari, screen readers and physical iOS/Android have not been tested in PHASE-04**; these steps remain manual QA, not a claim of completion.

**GO for continued local development.** No known local functional blocker remains in the tested paths. Public release remains blocked by inherited gates: real invite-only Google callback/sign-out testing and Workers Free 10 ms CPU measurements, real Cloudflare integration, owner-approved GPL decision and complete source/toolchain/reproduction review, and Safari/mobile/assistive-technology QA. Root LICENSE remains an unapproved draft; distribution is blocked. No deployment, cloud provisioning, credential change, binary publication or licensing approval occurred. Next: review this stacked PR and run the manual/device QA plus development OAuth/CPU validation before authorizing any staged deployment.
