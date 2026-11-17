# Shogi Study — SPIKE-01

Local English-language Shogi prototype: legal 9×9 board, two-player or human-vs-WASM play, and real MultiPV analysis with independent variation previews. No accounts, backend, deployment, or online play.

Tested with Node **24.22.1** and pnpm **11.25.0**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://localhost:5173**. The dev/build commands verify SHA-256 hashes and copy the pinned engine from `node_modules` into gitignored `public/engine/`. Everything runs locally after installation; no external fonts, AI APIs, or NNUE downloads are used.

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

PHASE-02 adds an online-room view and a local Workers/D1/SQLite Durable Object API. Run `pnpm exec wrangler d1 execute shogi-local --local --file migrations/0001_auth.sql`, then `pnpm dev:api` alongside `pnpm dev`; open **http://localhost:5173**. Google sign-in intentionally blocks without configuration. `pnpm test:online` starts the isolated test-identity harness and runs real two-context integration; it never impersonates a real Google login. See [PHASE-02 results and configuration](docs/PHASE_02_RESULTS.md).
