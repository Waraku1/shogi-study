# Japanese board, shared workspace and historical research

Base: **31350667a12e5cb419caef435d0f897b837172f2**, the validated REL-02 head of [PR #11](https://github.com/Waraku1/shogi-study/pull/11), whose checks passed in [run 44075330001](https://github.com/Waraku1/shogi-study/actions/runs/44075330001). The initial local worktree was clean; development branches and open PRs were inspected before choosing this base rather than public main. Work is isolated on `feat/japanese-study-workspace`, stacked on `chore/rel-02-source-verification`. No Idea Grove input, existing-branch edits, merge, deployment, credential configuration or infrastructure changes.

## Implementation and rationale

| Files / area | Result and reason |
| --- | --- |
| `Board.tsx`, `game.ts` presentation, `styles.css`, `workspace.css` | Shared kanji/wood rendering for local, online, replay and previews; entire White piece rotates; red promoted lettering. 玉/王 is a fixed side convention, never a skill indicator. English piece/owner labels, roving keyboard focus and promotion focus remain. |
| `public/fonts/`, `font-provenance.json`, subset script, NOTICE/license inputs | Locally served Mincho font with verified OFL permission, deterministic renamed subset and hash checks. No font-service dependency or new npm dependency. |
| `App.tsx`, `Online.tsx` | Retained local game, research draft and QuickLearn component state; adjacent learning on desktop, native collapsible panel below the mobile board. Learn from Review retains that historical/study board. Online sockets/clocks keep running and Quick Learn remains opt-in and limited to waiting/opponent turns. Room URLs retain the real room ID across Learn navigation. |
| `notation.ts` | Position-aware legal-move adapter over pinned tsshogi; USI remains canonical. Previous-move context crosses the history/PV boundary, and numbering uses the actual historical ply. |
| `record-io.ts` | Existing JSON v1 plus standard-start UTF-8 KIF/CSA. tsshogi parsing is followed by independent LocalGame legality checks. No stored-archive schema migration; imported private metadata/comments are discarded. |
| `Review.tsx`, `studies.ts` | Select/jump to any original ply, analyze, manually continue another legal line, return/resume, save/open/delete/export studies. Separate bounded/profile-scoped IndexedDB avoids rewriting original games; each study includes an immutable original snapshot. Position changes cancel/invalidate engine work. |
| `engine/adapter.ts` | Disposal immediately asks the existing bridge to terminate every owned worker, avoiding an early-stop/start race. Graceful reusable `stop()` stays separate. Engine/glue/worker bytes and provenance pins are unchanged. |
| `shared/contracts/rating.ts`, rating contract | Separate authoritative online and local-AI evidence, calibration/uncertainty models, proposed provisional evidence thresholds. No rating API/table, estimate, leaderboard or official rank is introduced. |

The existing **124 original learning cards/quizzes**, LearningStore, archive v1 storage, server authentication/rooms, rules and engine artifact are retained. Studies use `shogi-study-variations` v1, at most 50 per namespace, with transaction completion before a success message. Unavailable storage explicitly means memory only. Saving edits creates a new study; an ID conflict cannot silently replace a saved line. Snapshots remain usable if the original archive is later deleted. Backup exports flatten one study into a standalone JSON/KIF main line; they do not serialize the whole study collection/tree.

## Japanese notation matrix

All cases below are asserted in `tests/japanese.test.ts`; UI usage is also exercised in browser/online tests.

| Case | Expected evidence |
| --- | --- |
| Side markers, coordinates, numbering | `1. ▲７六歩`, `2. △３四歩`; White-to-move start at ply 42 retains 42 |
| Same destination and PV boundary | `▲２二角成 → △同　銀`, including a PV beginning with the recapture |
| Drops | `▲４五角打`, `△８八角打`; explicit 打 also when a same-type board move competes |
| Promotion choice / forced promotion | `▲２二角不成`, `▲５一歩成`; illegal last-rank nonpromotion rejected |
| Promoted types | と / 成香 / 成桂 / 成銀 / 馬 / 龍 in notation; traditional single-character abbreviated board glyphs |
| Side-relative disambiguation | Both Black and White 右/左; 直, 引, 上, 寄 and horse movement |
| Combined qualifiers | 銀右上 / 銀左上 / 銀右引; White 銀右上 uses White's perspective |
| Terminals | 投了, 切れ負け, 詰み, 千日手, 引き分け; terminal history uses next move number |
| Validation / interchange | Illegal moves rejected without changing the position; KIF/CSA/JSON preserve legal sequence and final SFEN; terminal mappings retained |

Known v1 English result descriptions map to their terminal events. Unknown result prose exports as **中断** instead of an invented verified result. KIF/CSA import supports a single standard-start main line, 64 KiB / 512 plies, UTF-8 only. Custom starts, embedded branches, invalid encodings, oversize and illegal moves are rejected. Shift-JIS and tree interchange remain outside this slice.

## Historical analysis and variation matrix

| Action | Actual automated evidence |
| --- | --- |
| Reconstruct original | Every ply of a capture/promotion/drop fixture independently matches replay SFEN; original JSON is unchanged |
| Analyze historical/study position | Real browser WASM returns three candidates, evaluation/depth and complete legally validated Japanese PVs |
| Select another ply during search | Jump remains operable; stale result cannot appear; owned engine work is disposed |
| Create/continue alternative | Browser selects original ply 2, plays `2g2f`, `8c8d`, analyzes and saves the two-ply branch |
| Return / resume / panel switch | Original anchor SFEN restored; draft SFEN restored; Learn keeps the research board; Review restores the same draft |
| Persist / reload / isolate | Real browser reload opens named study; fake IndexedDB verifies profile isolation, immutable snapshots and no overwrite of original archive |
| Limits / failure recovery | Illegal branch/bounds/version/extra fields rejected, 50-study retention, ID conflicts, honest memory-only fallback, original deletion leaves snapshot usable |
| Fair play | Real two-context Workers test keeps Review/research/analysis unavailable in active play; fresh account with unreachable status fails closed; finishing unlocks archived review |

## Actual verification

Local commands ran serially against Node 24.22.1 / pnpm 11.25.0 and Chromium. `pnpm test:online` uses real local Wrangler/D1/SQLite Durable Objects and test-only identity endpoints, **not Google OAuth**.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; lock/dependencies unchanged |
| `pnpm typecheck` | PASS; browser and Worker TypeScript |
| `pnpm test` | **120/120 PASS**, 13 files; 3.88 s |
| `pnpm build` | PASS; JS 378.40 kB / CSS 14.44 kB; separate unchanged pinned WASM and 30,016-byte font |
| `pnpm test:browser` | **19/19 PASS**, 57.8 s after final stylesheet-order correction |
| `pnpm test:online` | **6/6 PASS**, 45.5 s |
| Focused unchanged active-search/reset regression | **5/5 repeated PASS**, 39.6 s, after worker-disposal fix |
| Git whitespace check | PASS |

The full PR CI check passed on implementation commit `a533afc514e4593055c073ecba93996d81b2d147` in [run 44320264416](https://github.com/Waraku1/shogi-study/actions/runs/44320264416): locked install, both typechecks, unit/release, build, browser and online integration. The subsequent stylesheet-order correction passed the full local browser suite above; the PR reports final-head CI separately.

All 91 existing unit/release tests remain, plus 29 focused tests. The original 14 browser and 5 online tests remain; five browser and one online workspace tests were added. Four obsolete alphabetic/USI **presentation expectations** in the existing browser suite were updated to exact kanji/Japanese strings; no legal-move, lifecycle or fair-play assertion was weakened.

The unchanged reset/dispose regression initially exposed an orphan pthread during an early stop/start race; the adapter correction above fixes it. A duplicate React key discovered in browser output was fixed with separate practice/review keys. Visual inspection also corrected stretched replay file labels and selected-navigation hover contrast; a geometry assertion now checks header/board alignment. The workspace stylesheet loads after base styles so intended mobile sizing/contrast apply; computed board-help color is asserted. Font loading/failure, matching piece colors, full White rotation, red promotion, keyboard/promotion focus, 390 px overflow, collapsible learning, real KIF/CSA downloads and browser reimports are covered.

Raw local logs and regenerated screenshots are in gitignored `work/japanese/`. Durable visual evidence from the Chromium tests: [desktop](images/japanese-desktop.png), [390 px mobile](images/japanese-mobile.png), [historical study with real WASM candidates](images/japanese-study.png). These are actual captures, not design mockups. Run `pnpm test:browser` to regenerate them locally. Safari/macOS, VoiceOver, physical mobile and real assistive-technology checks are **NOT TESTED** here; Chromium viewport/keyboard checks do not substitute for them.

## Font, ratings and remaining gates

The official Noto Serif JP source and unchanged SIL OFL-1.1 were inspected at Google Fonts commit `7af0d90b4d532ffa4b041937b560c6df4e7b1e95`. OFL allows embedding, modification, redistribution and commercial use subject to its conditions; the renamed subset retains full license/copyright, including Adobe's embedded copyright. The complete license is also served beside it and included in generated notices. [Exact sources/hashes/rebuild](font-provenance.json). Fallbacks use installed Yu Mincho/Hiragino/Noto Serif/serif; the font-failure test confirms legal play still works. Glyph appearance under fallback depends on installed fonts.

[The separate rating implementation contract](RATING_IMPLEMENTATION_CONTRACT.md) specifies authoritative exactly-once results, privacy/consent, provisional rules, uncertainty, abuse controls, independent online/local-AI calibration and held-out validation before any estimated kyu/dan display. Current code awards no numeric rating or rank. Browser archives are not authoritative rating evidence.

**CONDITIONAL GO for continued local development.** No new functional blocker is known in the tested environment. Application/engine distribution remains blocked: root GPL proposal is still a draft awaiting the owner's decision; no licensing approval or engine rebuild is claimed. Prior real OAuth, platform CPU, Safari/accessibility and physical-device gates remain. The prior independent engine build did not reach compilation; that limitation is unchanged. No release packet for this new revision was prepared or published.

Next actions: review this stacked change and the notation/research matrices; perform the existing [owner OAuth/CPU/device checks](GATE_01_OWNER_CHECKS.md), including this shared workspace on Safari/VoiceOver and a physical phone; decide the application license/source-delivery scope before distribution. Implement rated play only under a separately authorized/calibrated iteration.
