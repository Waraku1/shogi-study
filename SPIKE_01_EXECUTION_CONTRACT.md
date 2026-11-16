# SPIKE-01 — Shogi Rules + Browser WASM AI + Analysis

Date: 2026-11-16  
Status: READY FOR IMPLEMENTATION / NO TESTS YET EXECUTED  
Goal: retire the highest technical risk before account, online multiplayer and study integrations.

## Evidence-based engine decision

First trial: `fairy-stockfish-nnue.wasm` (Fairy-Stockfish official in-browser WASM port). The upstream supports Shogi / USI and documents client-side analysis usage. **That does not establish that the chosen npm artifact works with Shogi in our target browser; the spike must verify it.**

Alternative: YaneuraOu-based WASM. A published YaneuraOu port specifies 1024 MB hash, 32 threads and cross-origin isolation. These settings make it a riskier P0 default, although a tuned/modern implementation could be stronger. Keep interface engine-neutral.

Legal: Fairy-Stockfish and YaneuraOu are GPLv3. `tsshogi` is MIT. Do not claim that a public repository alone fulfills all binary distribution, source-offer, third-party NNUE asset and derivative-work obligations. Record exact versions, source/build provenance, license texts, changes and linked dependencies. Defer the repository-wide license decision until integration/distribution boundaries are assessed.

## Scope

### In

1. Create a minimal React + TypeScript + Vite project with strict TypeScript and simple responsive 9x9 board.
2. Integrate `tsshogi` for deterministic state, rules, move generation/validation, hands, drops, promotion and SFEN/USI conversion. Do not create custom duplicate Shogi rules.
3. Local human-vs-human play with turn indicator, captures, basic undo/new game, and English piece names/tooltips.
4. Implement a Web Worker hosted WASM engine behind `EngineAdapter` with `init`, `search`, `stop`, `dispose` operations. Follow actual upstream worker packaging; inspect it before writing import code.
5. Verify USI initialization and `bestmove`, and MultiPV >= 2 if supported. Parse `info` lines for score, depth and PV. Do not pretend the engine works if worker creation/init fails.
6. Human-vs-AI mode: on legal human move, engine returns a legal `bestmove` and board updates; no main-thread freezes.
7. Lightweight analysis pane: selectable top candidate moves, reported depth and score, PV sequence in English/USI as available. If MultiPV is unavailable, label the feature unsupported rather than fabricating variations.
8. Capture startup latency, per-search elapsed wall time, engine asset size, approximate memory where measurable, and failure modes. Run desktop Chrome, then optional Safari/mobile comparison if accessible.
9. Unit tests for Shogi legality and USI parsing, and one browser smoke test for UI + engine if environment permits.
10. A short `SPIKE_01_RESULTS.md` summarizing observed outcomes, exact commands, versions, test results, source links, and blockers.

### Out

- Cloudflare provision/deployment, GitHub repository creation, live production changes, OAuth, multiplayer sockets, online clock, paid AI APIs, full curriculum, rankings, native mobile app, general board-game abstraction.

## Suggested single-app structure

```text
shogi-study/
  package.json
  pnpm-lock.yaml
  index.html
  src/
    app/
    features/
      shogi/          # board UI + tsshogi integration
      engine/         # Worker, USI parser, adapter
      analysis/       # candidate moves + PV UI
    shared/
      contracts/      # version-independent move and engine types
  public/
    engine/           # explicitly licensed WASM artifacts if appropriate
  tests/
  docs/
    SPIKE_01_RESULTS.md
    LICENSE_INVENTORY.md
```

A simple single-app layout is preferable to a monorepo in this spike. Split packages only if later backed by demonstrated need.

## Minimum engine adapter contract

```ts
type SearchPosition = { kind: 'startpos'; moves: string[] } |
                      { kind: 'sfen'; sfen: string; moves?: string[] };
type CandidateMove = {
  multiPv: number;
  firstMoveUSI: string;
  pvUSI: string[];
  depth: number;
  score: { kind: 'cp' | 'mate'; value: number; perspective: 'side-to-move' | 'black' } | null;
};
type SearchResult = { bestMoveUSI: string | null; candidates: CandidateMove[]; elapsedMs: number };
interface EngineAdapter {
  init(): Promise<void>;
  search(position: SearchPosition, options: { maxTimeMs: number; multiPv: number }): Promise<SearchResult>;
  stop(): Promise<void>;
  dispose(): void;
}
```

Treat the above as a logical interface; adapt details to the actual WASM wrapper. Keep protocol parsing in the adapter and never let UI components write USI commands directly.

## USI protocol check (illustrative only)

```text
usi
# wait for usiok
setoption name UCI_Variant value shogi
isready
# wait for readyok
usinewgame
position startpos moves 7g7f
setoption name MultiPV value 3
# verify option is supported before using
go movetime 500
# parse info depth ... multipv ... score ... pv ...
# wait for bestmove ...
```

Check actual supported options, thread mode, variants and board size first. Never assume printed example output is a test result.

## Acceptance tests

- [ ] Opening position renders 9x9 and distinguishes Black/White turn and captured-piece hands.
- [ ] A legal opening USI move, e.g. `7g7f`, updates game record; invalid movement is rejected.
- [ ] Test at least captures, drop-from-hand, nifu, promotion, prohibited king exposure, check escape, and terminal handling, including known edge cases.
- [ ] Move sequence round-trips through SFEN/USI + replay without position mismatch.
- [ ] Worker reports USI readiness and returns a legal `bestmove` for the opening and a mid-game position.
- [ ] MultiPV 2 or 3 candidates are reported *if engine supports them*; each line starts with a legal move for the analyzed position. Otherwise record a capability blocker.
- [ ] `stop` and `dispose` do not leave orphaned searches or frozen UI.
- [ ] 10 consecutive searches do not crash the page or break the next move.
- [ ] Engine asset provenance and licenses are recorded; no binary/source license violation is ignored.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm test` pass, or failures are itemized without misrepresenting completion.

## Decision rule

GO: client WASM reliably returns legal best moves and a viable search/analysis interface within a resource budget suitable for typical desktops; licensing path is documented. MultiPV may be a P1 capability if the worker is otherwise robust.

CONDITIONAL GO: client engine works but is slow/limited; use a lower-difficulty profile or an alternate engine and defer strong analysis.

NO-GO: package fails to support 9x9 Shogi, crashes, requires unsupported headers/memory or cannot be redistributed compliantly; replace engine before any multiplayer implementation.

## References

- https://www.npmjs.com/package/tsshogi
- https://github.com/fairy-stockfish/Fairy-Stockfish
- https://github.com/fairy-stockfish/fairy-stockfish.wasm
- https://www.jsdelivr.com/package/npm/fairy-stockfish-nnue.wasm
- https://github.com/yaneurao/YaneuraOu
- https://github.com/arashigaoka/YaneuraOu.wasm
