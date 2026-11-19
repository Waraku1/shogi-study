# REL-04 — smallest remaining owner checks

Use the exact PR #12 revision recorded in the [gate report](REL_04_RELEASE_GATE_REPORT.md), and record revision, OS/browser/device, steps and PASS/FAIL/NOT TESTED. Keep tokens, cookies, emails, OAuth codes, HARs and raw callback URLs out of evidence. Do not deploy or create provider resources for these steps without separate authorization.

## Safari / real VoiceOver / physical phones — NOT TESTED here

The available host is Linux; no macOS Safari/VoiceOver or physical iOS/Android test connection is available. Chromium viewport/renderer-freeze tests are separate evidence.

Use existing trusted development HTTPS or supported USB localhost forwarding for devices; plain LAN HTTP cannot satisfy WASM secure-context/shared-memory requirements. On macOS localhost, or the authorized device origin:

1. Record `isSecureContext`, `crossOriginIsolated`, `typeof SharedArrayBuffer`, COOP `same-origin` / COEP `require-corp`. Verify kanji font loads locally, both sides share wood/ink, White rotates physically, promotions are red, and fallback remains usable when the font is blocked.
2. Play legal moves/captures/drops/promotions by keyboard and touch. Switch Play/Learn/Review with a revealed/graded card; preserve current board/card/draft. Check portrait/landscape, zoom, overflow, touch targets and visible timers. With **real VoiceOver**, inspect square/owner/hand labels, focus order, quiz choices/status/errors, promotion focus return and confirmation/Cancel focus. Record announcement or keyboard defects.
3. Import and export standard-start UTF-8 KIF/CSA and existing JSON v1; replay to the same final position. Select a historical ply, analyze three candidates, make/save a different legal line, return to the original, reload and reopen the named study. Confirm original record/snapshot independence.
4. Confirm deletion, cancel and check focus return. For an actual failure/Retry test use a guest-local development profile: in DevTools/Safari Web Inspector, temporarily replace `IDBObjectStore.prototype.delete` with a function that throws `new DOMException('Local deletion probe', 'UnknownError')`; keep the original method in a local variable and restore it immediately after the probe (or reload). Failed deletion must keep confirmation/row, show an error and Retry, and never say deleted. Restore the method and Retry, then reload to confirm removal. Test both original and study separately. This deliberate synchronous fault does not claim real disk-error coverage; automated Chromium tests cover transaction abort/asynchronous request error.
5. Execute legal WASM replies/analysis, Stop, reset and active-search disposal for ten cycles. Block WASM/isolation to check honest errors and usable local play/replay. Record worker counts/memory/crashes where the device permits; do not extend a deadline to hide remaining workers.
6. Background the **physical** phone during local analysis and an online match, then restore. Verify board/card/draft, authoritative clocks, reconnect and opponent moves; active or unverifiable match status must still block assistance. Finish and check archive/review unlock. This is still required even when desktop Chromium renderer freeze/resume passes.

## Real Google OAuth — NOT TESTED here

No development credential file or the four required credential/allowlist environment bindings was available. Smallest action: the owner privately supplies an **existing development** Google web client and three authorized test accounts, using the ignored local configuration described in [GATE-01 OAuth steps 1–3](GATE_01_OWNER_CHECKS.md#google-oauth--not-tested-here). Never send secrets in chat. If such a client/account setup does not exist, retain NOT TESTED until separately authorized setup.

Use normal `pnpm dev:api` + `pnpm dev`, `http://localhost:5173`, exact callback `http://localhost:5173/api/auth/callback/google`; never fixture/guest/profile configs. Apply both local migrations. Then follow GATE-01 OAuth steps 4–8: two invited accounts, a previously unseen non-invited account, correct public identities, persistent sessions, invite return/join/reconnect, third-account/cross-origin denial, logout/expiry/WS rejection, fresh-context active/unknown fair-play and cross-account archives/progress isolation. Removing an existing email from the allowlist does not revoke sessions; provider grant revocation does not prove local-session revocation. Record those policies/results separately. No production credential use is authorized.

## Cloudflare platform CPU — UNVERIFIED

The credential-free local procedure is [GATE-01 profiling](GATE_01_OWNER_CHECKS.md#cpu--subrequests--real-workers-free-compliance-unverified). REL-04 supplies fresh local samples, not billed platform CPU. Minimum owner action is to arrange separately authorized access to an **existing development** deployment/account measurement environment; if none exists, do not provision/deploy automatically.

Measure the selected Worker and DO revisions separately: first/cold and warm HTTP `/api/me`, actual OAuth callback/session, `/api/play-status` at 0/1/10/32 memberships plus over-cap rejection, room join/WS/move/reconnect/alarm with representative history lengths. Capture per-invocation platform CPU distributions/worst cases and actual external/internal service accounting, including auth/D1 and DO-side work. Compare entry Workers Free 10 ms CPU and 50 external / 1,000 internal-service subrequests with the actual plan/configuration; DO CPU has its own 30 s default boundary. Local D1 statement counts are not a complete platform subrequest ledger. If the measured route fails, keep release blocked and fix only that route; do not silently select a paid workaround.

## Rights / publication decisions — PENDING

Complete the concise [licensing decision packet](REL_04_LICENSING_DECISION.md), confirming original-code/content/contributor rights, the combined-work/source scope, actual-revision source access and applicable operator approvals. Leave draft LICENSE, `ownerApproval=pending` and `publicDistribution=blocked` intact until explicit decisions and separate publication authorization. Independent rebuild assurance is a separate choice, not an automatic GPL prerequisite. No release archive is needed to execute this checklist now.
