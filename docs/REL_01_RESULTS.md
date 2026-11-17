# REL-01 actual results

2026-11-17 (Asia/Tokyo). Contract: [PR #1 comment](https://github.com/Waraku1/shogi-study/pull/1#issuecomment-6933205123). Starting local and remote head both verified as `419ca98ca33c79f9146f874d88530ce9122d9106`; branch `feat/spike-01-shogi-wasm`. Main remains `887cd9f27ce874b298b0050c1949f3baf0610e9b`.

Implemented a draft GPL-3.0-only licensing proposal, retained runtime/toolchain attribution, independent input/output hash checks and deterministic local source/candidate preparation. Added one minimal PR workflow: frozen pnpm install, strict typecheck, all unit/release tests, build, and real browser tests using Chrome already installed on the standard Ubuntu runner. No browser download, packet generation/upload or release/deployment step in CI. No Shogi rules, application UI, WASM adapter or existing tests were changed or weakened.

## Actual commands and evidence

Environment remains Debian 13 x86_64 / Node 24.22.1 / pnpm 11.25.0 / GNU tar 1.35 / Chromium 156.0.8078.79. Safari and physical mobile remain **NOT TESTED**.

| Executed check | Result |
| --- | --- |
| Before changes: `pnpm typecheck && pnpm test && pnpm build && pnpm test:browser` | PASS: original 34 unit tests and 6 browser tests (23.5 s) |
| `pnpm test` after REL-01 | PASS: **51/51**, including all original 34 and **17** new release/notice cases |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS; app JS/CSS byte sizes unchanged at 288,109 / 8,769; expanded notices copied separately |
| `pnpm test:browser` after changes | PASS: **6/6**, 24.1 s, real engine; ten sequential legal moves/full PVs, cancellation/disposal, failure fallback, mobile viewport, interactive captures/drops/promotion |
| Exact engine/Emscripten source downloads + SHA-256 | PASS; actual bytes retrieved from pinned codeload URLs |
| `pnpm release:prepare --commit e1a6f7bd3530890601b929107611ca5d08941099` | PASS; actual source downloads and local review packet |
| `pnpm release:prepare --offline --commit e1a6f7bd3530890601b929107611ca5d08941099` | PASS; repeated packet byte-identical to online preparation |
| `sha256sum -c e1a6f7bd3530890601b929107611ca5d08941099.tar.gz.sha256` in the candidate directory | PASS |
| Independent Python tar/hash inspection + `git get-tar-commit-id` | PASS: all **30** manifest files matched; archived project commit equals the candidate SHA |
| `git diff 419ca98 --check`; tracked binary/archive check | PASS; no `.wasm`, packet/archive or `dist/` files tracked |
| GitHub Actions [PR checks run 43986729686](https://github.com/Waraku1/shogi-study/actions/runs/43986729686) at `e1a6f7b` | PASS: clean locked install, typecheck, unit/release tests, build and Chrome browser tests; job 133716689346 completed successfully |

Engine source SHA-256: `5c10e40812e1045cb13677ff84b3cdd3fca5c381df76245cd4d8eb5312a61bea` (383,237 bytes). Emscripten source SHA-256: `732e07b20a642b3b52ca678a525eb148115f6c1b220911515a82f0b4254d5aac` (27,693,189 bytes). Exact commits, required source members, URLs and notice hashes are in `release-inputs.json`.

New tests verify identical repeated candidate bytes and exact project/source hashes, independent tampering of installed or built engine files, omitted manifest assets, missing engine license, wrong package version, missing/corrupt source, missing source members, mismatched source commit, missing toolchain notice, stale notices/worker bridge, dirty/non-HEAD source, symlinks, attempted replacement of a differing packet, and retained draft/source/LLVM-exception attribution. Their test fixtures use small synthetic inputs; actual application packaging is checked separately after committing the source.

The first actual preparation refused source retrieval (`fetch failed`) because Node's default fetch ignored this environment's configured proxy; no packet was produced. A real pinned-source fetch with Node 24 `--use-env-proxy` returned HTTP 200 / 383,237 bytes. The preparation command now enables that flag, retaining TLS verification and inherited proxy settings.

Real packet proof at **e1a6f7bd3530890601b929107611ca5d08941099**: **28,685,283 bytes**, SHA-256 **0b8f386bd303c0cff7cf19ecbac87214832bf8b41c087d4022f835a206cbdeaf**. Two preparations produced this same digest. Inspection verified bundled source archive hashes, all manifest entries, and the project's Git tar commit identity. `ownerApproval=pending` / `publicDistribution=blocked` remained set. The packet and source caches stay local under ignored `work/`; no artifacts were uploaded. A following documentation-only commit naturally produces a different packet identity; preparation must use its own checked-out full SHA.

## Licensing and remaining gates

Root LICENSE is **a review draft, not an effective project grant**. Package metadata remains private, points to that draft, proposes GPL-3.0-only and explicitly blocks public distribution. Engine GPLv3-or-later permits selection of v3; reviewed MIT/NCSA/Apache-2.0-with-LLVM-exception components have no identified license-level conflict with GPLv3, subject to retained conditions and owner/legal review. Emscripten/musl/LLVM runtime/dlmalloc notices are retained and checked against the bundled toolchain source. No NNUE weights are introduced.

The candidate bundles actual exact engine and Emscripten source archives, application source at the candidate commit, lock/build/install scripts, all retained notices and per-file hashes. That removes dependence on a bare source URL for those archives. It does not prove byte-identical engine rebuilding or exhaustive preferred-source delivery for all registry/SDK dependencies. Owner approval, source/dependency/toolchain completeness and an independent engine rebuild remain open. Hosting headers and Safari/physical-device steps are specified in [the release guide](REL_01_RELEASE_READINESS.md), not reported as validated.

**CONDITIONAL GO for review preparation only.** No public distribution decision, merge, deployment, binary/archive publication, infrastructure or account/multiplayer work occurred.

## Changed files

```text
.gitattributes
.github/workflows/pr.yml
LICENSE
NOTICE
README.md
docs/LICENSE_INVENTORY.md
docs/REL_01_RELEASE_READINESS.md
docs/REL_01_RESULTS.md
docs/SPIKE_01_RESULTS.md
docs/licenses/emscripten/Emscripten-AUTHORS.txt
docs/licenses/emscripten/Emscripten-LICENSE.txt
docs/licenses/emscripten/compiler-rt-LICENSE.TXT.txt
docs/licenses/emscripten/dlmalloc-header.txt
docs/licenses/emscripten/libcxx-LICENSE.TXT.txt
docs/licenses/emscripten/libcxxabi-LICENSE.TXT.txt
docs/licenses/emscripten/libunwind-LICENSE.TXT.txt
docs/licenses/emscripten/musl-COPYRIGHT.txt
docs/release-inputs.json
package.json
scripts/notices.mjs
scripts/prepare-engine.mjs
scripts/prepare-release.mjs
tests/release.test.mjs
vite.config.ts
```

No dependency versions or lockfile resolutions changed.
