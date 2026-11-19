# REL-03 — deletion consistency

Baseline verified locally and on GitHub: [PR #12](https://github.com/Waraku1/shogi-study/pull/12), `feat/japanese-study-workspace`, **f2253352816d2510d156cedb6dc6759125c48400**. No subsequent commits were present; the initial worktree was clean. The PR's read-only review identifies early cache removal, swallowed IndexedDB failures and false study-deletion success. Parent PR #11 remains at `31350667a12e5cb419caef435d0f897b837172f2` and is unchanged.

## Correction / changed files

- `src/features/review/delete-record.ts`: shared deletion transaction, requesting strict durability. Request success alone is insufficient; only transaction completion without an error resolves. Request failure/abort/unavailable database reject. This is IndexedDB transaction-level confirmation, not a physical power-loss guarantee.
- `src/features/review/store.ts` and `studies.ts`: persistent deletion updates the cache only after commit. Failure preserves the cached row and storage mode, exposes an error with its original cause, and discards the failed connection so Retry can reopen it. No failed persistent delete silently becomes successful memory-only removal. Namespace keys/schema and original snapshots are unchanged.
- `src/features/review/Review.tsx`: confirmation stays open on failure with an accessible error and **Retry deletion / Retry study deletion**, or Cancel with focus restoration. Pending deletes retain the row and disable duplicate confirmation/cancel until the transaction settles. Success removes only the confirmed row; failed deletion keeps the selected replay/draft. Asynchronous results are scoped to the originating store/profile.
- `tests/deletion.test.ts`: 13 storage regressions, including actual fake-indexeddb transaction rollback after request success, asynchronous request errors, unavailable/closed databases, retry, fresh-module reload, cache preservation, namespace isolation, and original/study snapshot independence.
- `tests/browser/deletion.spec.ts`: nine real Chromium checks for both confirmation flows: all three failure modes, reload, retry/cancel/focus, no false success or fallback, a live transaction held pending after request success, and truthful memory-only removal.
- `docs/REL_03_RESULTS.md`: this bounded evidence and release-gate record. These are the only seven changed files in REL-03.

No board, engine, learning, notation, import/export, authentication/server, fair-play, dependency/lock, license or workflow changes. All existing tests are retained without edits.

## Explicit memory-only semantics

Both `remove()` methods return `indexeddb` only for a confirmed persistent transaction, or `memory` when the profile was **already** in memory-only mode. In the latter mode removal affects the current session cache only: it does not attempt persistent deletion or erase an earlier device copy. The UI explicitly says **“removed from this session only. Device storage was not changed; earlier saved copies may reappear after reload.”**

StudyStore's existing cache-only behavior is retained. ArchiveStore now consistently honors its already-declared memory-only mode rather than attempting a hidden IndexedDB deletion in that mode. The prior warning and new confirmation/success text make this boundary visible. Save/list fallback semantics are otherwise unchanged; deletion failure itself never enters fallback.

## Actual checks

Node **24.22.1**, pnpm **11.25.0**, local Chromium. Commands run in the requested order; browser/online suites run serially because they share a port.

| Check | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; unchanged lock/dependencies |
| `pnpm typecheck` | PASS; browser and Worker |
| `pnpm test` before build | **133/133 PASS**, 14 files, 2.69 s |
| `pnpm build` | PASS; JS 380.33 kB / CSS 14.44 kB; engine/font pins unchanged |
| First `pnpm test` after build | **133/133 PASS**, 2.59 s |
| Second `pnpm test` after build | **133/133 PASS**, 2.44 s |
| New deletion browser suite | **9/9 PASS**, 20.4 s |
| Full `pnpm test:browser` | **28/28 PASS**, 63.5 s on final rerun; initial failure and focused repeats below |
| Full `pnpm test:online` | **6/6 PASS**, 38.2 s; real local Workers/D1/SQLite DO and test identities, not Google OAuth |

The 13 new storage tests extend the existing 120; the nine browser tests extend the existing 19. Negative tests replace a delete request with a native duplicate-key request to produce a real asynchronous ConstraintError/abort; they also abort an actual successful delete request's transaction and make the database unavailable/closed. Browser pending tests keep a real IndexedDB transaction alive with queued reads and verify no success before release/commit. These are controlled fault injections, not claims of testing every browser/physical-storage failure.

The first full browser attempt was **27 passed / 1 failed**: the unchanged real-WASM lifecycle test saw one remaining worker after its five-second disposal deadline. Its legal moves/PVs passed; this does not erase the disposal failure. Engine, bridge and existing test bytes are unchanged from the reviewed baseline. Three isolated repetitions of that exact test then **passed (3/3, 25.7 s)** without changes or relaxed assertions. The initial trace/JSON/log are retained locally in `work/rel-03/browser-first-failure/` and `browser-first.log`; final full-suite/CI results are reported separately. The intermittent observation's root cause is not established by a passing rerun.

Raw local evidence: gitignored `work/rel-03/{install,typecheck,unit-1,build,unit-2,unit-3,browser,online}.log`. Final commit and exact-head CI evidence are recorded in PR #12 after the actual CI run; no intermediate commit is presented as final-head validation.

## Integration recommendation / remaining release gates

**GO for technical integration of the bounded deletion correction, contingent on green final-head CI recorded in PR #12.** This does not approve public distribution, merge, deployment or a license. The single local WASM disposal timeout above remains an unresolved intermittent observation; no engine fix or root-cause claim is included in REL-03. Preserve its evidence and diagnose it against the reviewed baseline if it recurs.

Existing gates remain, with **no new successful verification claimed**:

1. **Licensing / source delivery:** owner approval or rejection of the draft application GPL-3.0-only grant, combined-work/source scope and chosen source-delivery method. Prior OFL/font and third-party findings are unchanged. The previous independent engine rebuild never reached compilation; rebuilding/functionality/output comparison remain NOT TESTED. No release packet for this revision was prepared or published.
2. **Real Google OAuth:** owner must run the secure development callback/session/logout checks with their development credentials; test-only local identities are not Google OAuth validation.
3. **Actual Workers CPU compliance:** owner must measure the deployed-platform CPU and service-lookup budget under the existing GATE-01 procedure when separately authorized. Local Workers integration does not establish platform CPU compliance.
4. **Safari / accessibility / physical devices:** owner must exercise Safari/VoiceOver and physical phones, including Japanese glyphs, board/learning, review, confirmation/error/retry and persistence. These environments are NOT TESTED here; Chromium viewport/keyboard checks are not substitutes.

See [owner procedures](GATE_01_OWNER_CHECKS.md) and [corresponding-source limits](REL_02_RESULTS.md). No new production resources, credentials, artifact publication, merge or deployment.
