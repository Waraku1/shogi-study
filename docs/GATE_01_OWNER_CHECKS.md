# GATE-01 — owner-only local validation

No deployment, remote provisioning, credential ingestion or licensing approval is authorized by this plan. Record browser/OS, tested commit, steps, status codes and observations only. Do not commit/log secrets, OAuth codes, cookies, tokens, email lists, HARs or raw callback URLs.

## Google OAuth — NOT TESTED here

No `.dev.vars*` file was present. Fake auth passes are separate evidence, not Google validation. The owner must supply an **existing development** Google Web application client themselves; do not send its secret to Codex. If no such client exists, this gate stays NOT TESTED until separately authorized setup occurs.

1. In the existing development client, verify the exact authorized redirect **`http://localhost:5173/api/auth/callback/google`** and allowed local origin `http://localhost:5173`. Use localhost consistently (not 127.0.0.1). Configure the consent screen/test-user access for the two invited accounts plus a separate non-invited test account as appropriate. Do not use production credentials.
2. Locally create gitignored `.dev.vars` (permissions `chmod 600`) with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a unique random `BETTER_AUTH_SECRET` of at least 32 characters, and comma-separated `ALLOWED_EMAILS` for two invited test accounts. Enter values privately in an editor; never paste them into chat, command arguments or tracked files. `APP_ORIGIN` remains `http://localhost:5173` in the local config. Run `git check-ignore .dev.vars` before use; record only that it is ignored.
3. Stop fixture/profile servers; apply both README local migrations and run `pnpm dev:api` plus `pnpm dev`. Use the normal app, **not** `dev:guest`, `wrangler.test.json`, `wrangler.profile.json` or `/api/test/*`. Confirm `/api/test/login` cannot authenticate in the normal Worker.
4. In two separate browser profiles, sign in to the two invited accounts. Confirm Google redirects back, `/api/me` returns the expected public player identity, and reload/browser restart preserves the session. Verify session cookies are HttpOnly, SameSite and localhost-appropriate; inspect without copying values. Record pass/fail, not cookie contents. Secure cookies must be revisited for any eventual HTTPS host.
5. With a previously unseen account absent from `ALLOWED_EMAILS`, attempt signup. It must fail; verify that no playable identity or new user/account/session row is created in **local** D1. The current allowlist hook gates **new users only**: removing an existing account from the list does not revoke its existing sessions or prohibit all later sign-ins. Test and document any required revocation policy before wider use.
6. Open an invite URL in a signed-out profile. Sign in, confirm return to the same room invite (no off-origin redirect), then join with the second account. Test moves, reconnect, learning and clocks. Attempt a third participant and off-origin POST/WS upgrade; these must remain denied. During play, new-browser status failure must block Review/engine use; after finish, archive/replay/analysis should work.
7. Sign out through the UI. `/api/me` and `/api/play-status` must return 401; old-session HTTP requests and the next WS move must be rejected. Repeat with a genuinely expired development session. A known active-game lease must keep analysis blocked after sign-out/expiry. Google account sign-out is not the same as local application sign-out.
8. Separately revoke the app grant using the development Google account's third-party access controls. Verify provider-token behavior on a new login and explicitly revoke local application sessions if required. Google grant revocation does **not** prove existing application sessions are automatically invalidated; automatic provider revocation detection is not implemented or claimed. Record this distinction.

If credentials, test accounts or consent configuration are unavailable, mark the affected steps **NOT TESTED**. Remove private local credentials when done, retaining no evidence containing their values.

## CPU / subrequests — real Workers Free compliance UNVERIFIED

The Workers Free entry-Worker limit is **10 ms CPU / HTTP request**; current subrequest categories are **50 external / 1,000 internal Cloudflare-service subrequests per invocation**, not 50 total ([official change](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)). Durable Object invocations have a separate **30 s default CPU limit**, not the entry Worker's 10 ms ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)). Confirm the eventual account plan/configuration before sign-off. HTTP elapsed time is not CPU. Local aggregate workerd CPU includes D1, Durable Objects and development proxy overhead; it cannot certify either billing boundary or CPU percentiles.

Credential-free repeatable measurement on Linux:

```sh
pnpm install --frozen-lockfile
node scripts/profile-local.mjs
```

This script starts **local-only** Wrangler on 8791 (inspector 9231), uses a separate gitignored `work/gate-profile/state`, applies migrations locally, and uses fake Alice/Bob identities. REL-04 adds the first HTTP request after process startup (not an edge cold start), route-first observations, exact revision/runtime identity, internal room route names and warm wall maxima. It retains warmed 40-request batches (20 for WS/sign-in initiation), room/D1 statement counters, aggregate Linux workerd user+system CPU ticks (10 ms resolution on the tested host), and separate V8 CPU samples at requested 100 μs interval. `work/gate-profile/summary.json` and `.cpuprofile` files are local evidence; no uploads. `SHOGI_PROFILE_OUTPUT=work/rel-04/cpu` selects a fresh local-only state/output directory. Counters are fixture instrumentation, not production response headers. The real Google callback is deliberately not invoked; aggregate CPU means are not single-invocation CPU maxima.

For interactive profiling, run `pnpm exec wrangler dev --local --config wrangler.profile.json --persist-to work/gate-profile/state --port 8791 --inspector-port 9231`, open DevTools with Wrangler's `d` command / its inspector link, select **Profiler**, start recording, issue one controlled route/batch, stop and save locally. Load the script's `.cpuprofile` files for comparison. Do not profile while the script owns that port/inspector.

Route matrix: `/api/me` guest + session; `/api/play-status` with 0/1/10/32 waiting memberships and over-cap legacy rejection; room join; WS upgrade; fake sign-in initiation. For the **real callback**, use only the owner's authorized normal local setup and isolate one callback's CPU sample without retaining codes/tokens. Record cold and warm behavior, per-request CPU/billing boundaries, D1/auth/room subrequests and worst observed CPU, not just means. Local samples, fixture identities and rejected unconfigured callbacks cannot stand in for this measurement.

Status work is bounded to 32 room probes in batches of four, plus session and registry D1 operations and at most one cleanup statement. Active/pending detection may stop early. The membership primary key `(userId,roomId)` already indexes the lookup. No cached clearance can authorize unknown status. A legacy profile above 32 is blocked without room probes; to recover, the owner must inspect only that user's **local** registry/room snapshots, resume/finish known rooms and remove only authoritatively finished/nonparticipant rows. An unresolved pending row must not be cleared merely to enable analysis. Keep the local DB backup private; do not blindly delete all memberships or reset a lease during active play.

Before any later authorization to host, establish the real 10 ms gate for the actual Worker/auth runtime and DO requests at representative history lengths, including the real callback. If it exceeds budget, keep release blocked and target that measured route; do not select a paid workaround as part of GATE-01.

## macOS Safari / VoiceOver / physical mobile — NOT TESTED here

Use current Safari on macOS with localhost; record OS/browser and commit. For device access use an **existing** trusted HTTPS development endpoint or supported USB localhost forwarding with the required headers. Plain LAN HTTP is not a secure context. Do not provision/deploy one for this checklist.

- Confirm document and engine asset COOP `same-origin` / COEP `require-corp`; record `isSecureContext`, `crossOriginIsolated`, `typeof SharedArrayBuffer` and engine/worker errors. Play legal AI replies and three candidates, replay a saved game, explore/return from a variation, Stop/reset ten times. Shared memory is still required even for one thread.
- Block the WASM asset and repeat without isolation: honest engine error, no fabricated candidates, usable local board/replay. Restore the environment. Manifest/icon metadata exists; there is **no service worker, authenticated API cache or full-offline/installability claim**. Normal API-unreachable mode must block assistance; intentional offline guest work uses `pnpm dev:guest` at the separate origin `http://127.0.0.1:5174` (no online API), with all local assets loaded.
- Enable Safari's keyboard focus setting and macOS keyboard navigation. Tab/Shift-Tab through Play/Learn/Review and Online, arrow through board squares, Enter to select/drop, promote and verify focus returns to the destination. Check visible focus, read-only replay, quiz radio group/feedback, delete/reset confirmation and cancel focus return. No keyboard trap or obscured timers/board.
- With **real VoiceOver**, verify navigation/heading/region order, square/piece/hand labels, turn/check/game-over/status/error announcements, quiz choices and feedback, pending-save warnings, promotion and deletion confirmation. Check announcements do not drown clock/play interaction. Record observed defects; no simulated screen-reader PASS.
- On physical iOS Safari and Android Chrome, test portrait/landscape, tap move/drop/promotion, Learn while clocks run, background/restore, room reconnect, guest/account archive isolation, JSON import/export and reload persistence. Check focus/zoom/overflow/touch targets, engine memory/crashes and ten AI/reset cycles. Viewport emulation is not a substitute.

## Licensing owner decision — pending, distribution blocked

Owner must approve or reject **GPL-3.0-only** for the whole application and confirm ownership/integration scope. Do not replace the draft root LICENSE based on tests. Resolve the compact [REL-01 follow-up gaps](REL_01_RELEASE_READINESS.md#gate-01-follow-up-source-gaps) before any distribution decision. No fresh exhaustive audit or release archive generation was performed here.

REL-04 supplies the current [concise device/OAuth handoff](REL_04_OWNER_CHECKS.md), [owner license decision packet](REL_04_LICENSING_DECISION.md) and [gate report](REL_04_RELEASE_GATE_REPORT.md). Historical measurements remain historical evidence.
