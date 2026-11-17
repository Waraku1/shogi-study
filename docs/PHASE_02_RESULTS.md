# PHASE-02 actual results

Starting branch `feat/phase-2-auth-online` and remote verified at REL-01 `fc0ce620798897a2e4b919b8610209957079198f`. Implements [Issue #2](https://github.com/Waraku1/shogi-study/issues/2); stacked PR targets `feat/spike-01-shogi-wasm`, dependent on unmerged PR #1. No deployment, remote resources, credentials, licensing approval, binary release or main merge.

## Implemented

Workers API + Better Auth 1.7.25 (current registry stable when checked), Drizzle ORM 0.45.4 / D1 account, session, account-provider and verification schema. Google OAuth redirect flow with origin/redirect checks, explicit configuration gate, email allowlist at registration, server-created pseudonyms, HttpOnly server sessions with cookie cache disabled. Opponents see only public user IDs/display names. No passwords or public profile lookup. `.dev.vars*` is ignored.

SQLite-backed Durable Object per room, creator Black / invited second identity White, Hibernation WebSocket acceptance and attachments, duplicate-connection replacement, current server-side session revalidation for moves, logout/revocation handling, persisted authoritative history and clock, move IDs/ordered sequence, idempotent retries with conflicting-ID rejection, stale/out-of-turn/illegal event rejection, snapshots on reconnect. Worker replaces internal identity headers from validated session; client identities, boards, results and clocks have no authority. Durable Object SQL operations after asynchronous session validation reload the current persisted state and commit synchronously. Server uses the existing tsshogi integration for every move and terminal/repetition/perpetual-check decisions.

MVP clock: **10-minute sudden death**, starting when White joins. Server timestamps and Durable Object alarms adjudicate timeout without server polling; browser intervals only animate the display. Tests shorten the control to 15 seconds in a separate test class. Resignation is authenticated and server-owned. Byo-yomi deferred.

English online view: login state, Google redirect/sign-out, create/join and invite URL, player colors, board/hands/promotions, connection state/reconnect, clocks/result and move record. Reload retrieves the exact snapshot. The online view has no engine advice; entering it unmounts/disposes the local engine view, and returning to local practice is disabled while an online game is active. Local two-player/WASM modes retain their original tests.

## Actual local verification

Node 24.22.1, pnpm 11.25.0, Wrangler **4.162.0**, workerd **1.20261113.1**, Workers types **5.20261115.1**, Chromium **156.0.8078.79**, Debian 13. Native workerd/esbuild builds explicitly allowed in `pnpm-workspace.yaml`. No remote Wrangler operations used. In this sandbox XDG cache/config/data/state paths were set under workspace to avoid the unwritable home cache.

- `pnpm install --frozen-lockfile`: PASS.
- `pnpm typecheck`: PASS (browser and separate Worker TypeScript configuration).
- `pnpm test`: **51/51 PASS**, all original rules, protocol and release tests retained.
- `pnpm build`: PASS; WASM assets and isolation headers preserved.
- `pnpm test:browser`: **6/6 PASS**, including actual engine bestmoves/MultiPV, repeated searches, disposal, captures/drops/promotion and viewport checks.
- `pnpm exec wrangler d1 execute shogi-local --local --config wrangler.test.json --file migrations/0001_auth.sql`: PASS (8 local schema commands).
- `pnpm test:online`: **1/1 PASS**, 25.7 s final run; actual two-browser-context integration over local Wrangler/Miniflare D1 and SQLite DO, not mocked transport/storage. Exercises test-only sessions, room creation/join, third-user denial, private snapshot projection, illegal/out-of-turn/spoofed/stale events, duplicate retry with one accepted move, exact SFEN after reload, synchronized legal reply, resignation, alarm timeout, CSRF origin rejection, revoked-session socket closure and missing-config login blocking. Also runs the actual production entry locally: it rejects test login and blocks missing Google configuration. Better Auth authorization-URL generation with dummy settings returns a Google URL; no Google callback/token exchange was performed.

An initial online run caught missing snapshot restoration after reload; this was fixed, then the integration passed. Tests use a separate `server/test-worker.ts` entry and `wrangler.test.json`; the normal `server/worker.ts` entry has no test login route, fixture resolver or short clock. Test identities are deliberately not public authentication. The PR workflow covers both regression and online commands on the stacked target.

## Local configuration and limits

For normal local API: apply migration as in README, `pnpm dev:api` plus `pnpm dev`, open `http://localhost:5173` (the configured origin). Rooms require authenticated users. For reproducible credential-free demonstration run `pnpm test:online`; it injects alice/bob sessions only through the explicit local harness. To inspect that harness manually run `pnpm exec wrangler dev --local --config wrangler.test.json --port 8787` alongside Vite; POST `/api/test/login` with `{"name":"alice"}` or `bob` from the same-origin local browser/test client. The UI does not label fixtures as Google users. Do not use the test config for deployment.

Later manual credential work (not performed): configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a random >=32-character `BETTER_AUTH_SECRET`, and comma-separated `ALLOWED_EMAILS` in ignored local vars; register exact callback `http://localhost:5173/api/auth/callback/google` for local testing. `APP_ORIGIN` must match the app. No actual credentials are in source. Production D1 IDs, bindings, HTTPS/same-origin assets and deployment remain unprovisioned; UUIDs in configs are local placeholders. Full-page OAuth redirects are used because COOP/COEP can disrupt cross-origin popup communication. Real callback/cookie behavior, Safari/mobile and production hibernation/restart behavior remain manual checks; WebSocket disconnect/reconnect and persisted snapshots are tested locally.

Official docs checked: [Google](https://www.better-auth.com/docs/authentication/google), [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle), [DO hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Local runtime/bundling is compatible with this Better Auth adapter; **Free-plan OAuth CPU compatibility is not established**. The documented Free HTTP budget is 10 ms CPU; real token exchange/session-path cold/warm CPU must be profiled with test credentials before rollout. No password hashing is enabled. If callbacks exceed that budget, retain the session/room interfaces and evaluate a bounded alternative identity adapter/free-compatible authorization flow before any rollout; do not claim paid capacity or successful real OAuth. Replay cost grows with game length; load/CPU calibration, rate limiting and long-game retention are future hardening, not demonstrated here.

Root license remains draft and public distribution blocked. New server/tool dependencies have not been cleared for a release; REL-01 source/notice delivery would need extension before distribution. REL-01 results are not rewritten as approval.

**CONDITIONAL GO for continued local development.** Next: use development Google credentials to test invite-only account creation, callback/session/sign-out and measure Free-budget CPU, then add focused callback/allowlist failure integration before any provisioning or rollout. No real Google OAuth, deployment, production resource use or exhaustive rules/security/load certification is claimed.
