# Shogi Study — local MVP

English-language Shogi prototype: legal 9×9 board, two-player or human-vs-WASM play, authenticated online rooms, learning cards, and saved-game replay with real MultiPV analysis. Run the browser and optional Workers API locally; this project is not cleared for public distribution.

Tested with Node **24.22.1** and pnpm **11.25.0**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://localhost:5173**. The dev/build commands verify SHA-256 hashes and copy the pinned engine from `node_modules` into gitignored `public/engine/`. Everything runs locally after installation; no external fonts, AI APIs, or NNUE downloads are used.

For intentional no-login guest-local use without the API, run **`pnpm dev:guest`** and open **http://127.0.0.1:5174**. This separate mode has no account/online entry and rejects every `/api/` request. Local Play, Learn, archives and WASM work with loaded local assets. Normal mode permits guest analysis after an authoritative 401; unreachable, failed or invalid match-status responses block Review/engine assistance even with no prior local lease. Reconnect and Retry online status to recover. There is no URL/storage toggle to bypass this restriction and no claim that the browser can prevent external engine use.

Select a piece and a highlighted destination, or select a piece in a hand to drop it. Promotion is offered when legal. Arrow keys move board focus; Enter selects. AI mode plays White. Search presets change the time budget; playing strength has not been calibrated. Candidate previews preserve the actual game record. Undo in AI mode returns to the human’s previous turn.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm preview --port 5174
```

Browser tests use `/usr/bin/chromium` when available, `CHROMIUM_PATH` if specified, or Playwright’s installed Chromium. On another machine, `pnpm exec playwright install chromium` may be needed. The suite includes real engine searches; it does not mock the demo engine.

This artifact always uses pthreads, even with one search thread. It needs a secure context (localhost/HTTPS), WASM SIMD, `SharedArrayBuffer`, and these headers on the app and assets; Vite dev **and preview** set them:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without those capabilities or when assets fail, the app displays an engine error and keeps local two-player play usable. Reset/undo/mode changes dispose stale engine work. Stop drains a search and preserves the adapter for reuse.

See [actual results](docs/SPIKE_01_RESULTS.md), [measurement evidence](docs/SPIKE_01_EVIDENCE.json), and [licenses/provenance](docs/LICENSE_INVENTORY.md). REL-01 proposes GPL-3.0-only in a **draft** root LICENSE; owner approval is pending. Engine binaries and local `dist/` are **not committed or published**; the local build is not cleared for redistribution.

From a clean committed checkout, `pnpm release:prepare --commit "$(git rev-parse HEAD)"` builds a deterministic, gitignored review packet with exact engine/toolchain source archives, project source at that commit, notices and a hash manifest. It never publishes or approves a release. See the [release/hosting guide and Safari/device smoke steps](docs/REL_01_RELEASE_READINESS.md) for inputs, inspection, limitations and remaining approval gates.

PHASE-02 adds an online-room view and a local Workers/D1/SQLite Durable Object API. Apply both local migrations, then run `pnpm dev:api` alongside `pnpm dev`; open **http://localhost:5173**:

```sh
pnpm exec wrangler d1 execute shogi-local --local --file migrations/0001_auth.sql
pnpm exec wrangler d1 execute shogi-local --local --file migrations/0002_player_rooms.sql
```

Google sign-in intentionally blocks without configuration. `pnpm test:online` applies both migrations in the isolated test-identity harness and runs real two-context integration; it never impersonates a real Google login. See [PHASE-02 results and configuration](docs/PHASE_02_RESULTS.md).

PHASE-03: choose **Learn** (no login) for 124 original cards and mini-quizzes. **Quick Learn** in online rooms is off by default; enabling it only shows cards while waiting or while the opponent moves, and collapses them when play returns to you. Preferences and review status stay in this browser's IndexedDB, separately for each account and guest-local study. Wait for the saving indicator to clear before reloading. Reset requires confirmation and affects only the current profile. If storage is unavailable, an explicit warning labels the memory-only fallback. See [PHASE-03 results](docs/PHASE_03_RESULTS.md).

PHASE-04: **Play / Learn / Review** share one navigation. Practice games autosave as you play; finished online games save for the participant's account on this device. **Review** lists the newest 50 games for the current profile, with replay/jump, WASM candidates and independent future variations. Export or import standard-start Shogi Study JSON v1 (64 KiB / 512 plies); unsupported formats and illegal moves are rejected. Export important records before browser storage is cleared. Wait for saving to complete before reload. Unavailable storage is explicitly labeled memory only. Review and engine assistance are blocked during active online matches, including fresh views. The web manifest and icon are metadata only: there is no service worker or full-offline claim. See [PHASE-04 results and manual checks](docs/PHASE_04_RESULTS.md).

GATE-01 corrects unknown-status fair play and bounds room-status work. See [actual results](docs/GATE_01_RESULTS.md) and the [owner's local OAuth, CPU, Safari/accessibility and licensing actions](docs/GATE_01_OWNER_CHECKS.md). No release readiness is claimed.
