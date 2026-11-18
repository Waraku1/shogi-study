# Future ratings — bounded implementation contract

This iteration adds only `src/shared/contracts/rating.ts`: separate online-result and local-AI evidence types, rating/calibration/uncertainty structures, evidence-count rules and an explicitly uncalibrated local estimate. No production table, API, rank display, official strength claim, rating number or cloud resource is created.

## Proposed scope for a separately authorized iteration

- One opt-in online pool, identified by time control, rules version and model version. Choose/document an uncertainty-aware model (for example Glicko-2) after offline calibration; do not silently mix pools or choose arbitrary kyu/dan cutoffs. Seed means/deviations and inactivity policy require a versioned model decision.
- The authoritative room server emits a stable terminal event once. An append-only match-result ledger records pseudonymous participant IDs, explicit consent from both players, pool, terminal reason/winner, finished time, adjudication status and model version. Reject self-play, unknown participants, unfinished rooms, duplicated room/event IDs and unverified client imports. Undo/correction is an explicit compensating event, not a silent ledger edit.
- Apply the two participant rating updates and a unique event-id marker atomically. Reconnect/retry/timeout and repeated notifications must not double count. Store uncertainty, games, distinct opponents, last processed event and calibration ID; retain result history sufficient to reproduce/correct each update. Test simultaneous finalization and migration/replay before any deployment.
- Initial proposed provisional thresholds: at least **20 eligible games against 5 distinct opponents** in one pool. Below either threshold display provisional evidence only. Passing thresholds is **not** a calibrated estimate or official rank. Repeated pairings, collusion and anomaly review may require stricter caps; decide these from observed data, not from a client trust flag.
- Calibrate on an authorized, representative cohort, with held-out validation, documented sample size, model/error metrics, uncertainty coverage and population drift. Any kyu/dan mapping must identify a specific cohort/organization/time-control scale, validation methodology, mapping version, wide confidence/range where appropriate and clear **estimated, unofficial** labeling. A rank from one federation is not interchangeable with another.
- Keep local-AI estimates separate from online ratings. Log only opt-in local evidence with pinned engine/evaluation identity, search budget/threads, assistance flag and sufficient device context for comparability. Calibrate separately across hardware/engine settings; never award online points for AI games, analysis-assisted play, imported records or self-reported outcomes. Until validation exists the current foundation returns `estimate=null`, `kyuDanRange=null`, confidence unknown.

## Privacy and abuse constraints

Use pseudonymous public IDs, not email, cookies, OAuth tokens or IP addresses in rating/result records. Consent, retention/export/deletion and abuse-investigation access need an owner decision. Keep raw private anti-abuse evidence separate with restricted access and a bounded retention policy. Do not introduce invasive device fingerprinting in this slice. Browser archives/IndexedDB are editable and are never authoritative rating input. Source tags in TypeScript are contracts, not proof of server provenance; a hostile client can fabricate them.

Preserve current no-engine-assistance controls in active online play. Ratings need server-authoritative outcomes, replay validation, session/participant authorization, same-origin protections, rate limits and a clearly scoped collusion/rematch policy. These do not promise prevention of external engines. Handling disconnects, abandoned rooms, disputes and abuse reversals must be specified before a rated pool launches.

## Acceptance criteria for that future iteration

1. Reviewed schema/migrations and model version; mathematical fixtures against an independent reference implementation.
2. Real two-account local integration: consent, finish, retries, simultaneous finalization, isolation, cross-pool rejection, timeout/disconnect and exactly-once atomic updates.
3. Reject client-forged/imported/local-AI results and duplicate or incomplete events; verify privacy/retention and server access controls.
4. Demonstrate calibrated uncertainty with held-out data before displaying estimated strength. Kyu/dan remains absent until its separate mapping is validated and approved for display.
5. Run all Shogi/WASM/online/learning/archive/research regressions and the existing release gates. No merge/deploy or production infrastructure without separate authorization.

New calibration data collection, cloud resources, credentials, rated leaderboards and model deployment are outside the present task. This contract does not supersede pending GPL, OAuth, Workers CPU or device/accessibility validation.
