# SPIKE-01 license inventory

Status after REL-01: **GPL-3.0-only proposed; copyright-owner approval and redistribution review pending**. Root `LICENSE` is explicitly a draft, not an effective grant. `package.json` remains private with `SEE LICENSE IN LICENSE` and an explicit blocked-distribution flag. This PR contains source, evidence, and notices; local candidate archives/binaries remain gitignored and unpublished. Third-party licenses are unchanged.

| Component | Pinned version | License / use |
| --- | --- | --- |
| tsshogi | 2.3.4 | MIT; rules and records |
| React / React DOM | 19.3.1 / 19.3.1 | MIT; browser UI |
| scheduler | 0.28.0 | MIT; React runtime dependency |
| fairy-stockfish-nnue.wasm | 1.1.12 | npm `GPL-3.0`; upstream source says GPL version 3 or later; local engine |
| TypeScript / Vite / React plugin | 7.0.2 / 8.3.8 / 6.3.0 | Apache-2.0 / MIT / MIT; development tools |
| Vitest / Playwright Test | 5.1.0 / 1.65.1 | MIT / Apache-2.0; development tools |

The [dependency license snapshot](DEPENDENCY_LICENSES.json) records installed direct/transitive tool dependencies, including MPL-2.0 (Lightning CSS), ISC and BSD-3-Clause. Exact dependency resolution/integrity is pinned in `pnpm-lock.yaml`. This metadata scan is not a legal compatibility determination. Tool packages are not bundled into the app.

Unmodified license/credit texts are in [licenses/](licenses/): tsshogi, React, React DOM, scheduler, engine GPLv3 and engine AUTHORS. Preparation copies the engine GPL/credits beside the local WASM and generates `/THIRD_PARTY_NOTICES.txt` with runtime MIT notices and source links. The UI links those notices. No third-party font or image assets are fetched.

REL-01 also retains Emscripten 2.0.26's LICENSE/AUTHORS, musl COPYRIGHT, compiler-rt/libc++/libc++abi/libunwind licenses (including LLVM exceptions and legacy notices), and the dlmalloc license comment in `licenses/emscripten/`. Emscripten glue/pthreads/JS filesystem uses MIT/NCSA terms and Node MIT portions. musl uses MIT/per-file notices; LLVM runtime uses Apache-2.0 WITH LLVM-exception plus legacy permissive notices; dlmalloc carries its public-domain/CC0 dedication. A conservative superset is retained because a symbol-level link map for the npm binary is unavailable. These terms present no identified license-level conflict with GPLv3, subject to their conditions and owner/legal review.

Exact source archives and notice hashes are pinned in [release-inputs.json](release-inputs.json). The local candidate command bundles retrieved engine and Emscripten sources, checks every retained toolchain notice against those sources, independently checks installed and built engine assets, and records the application's exact release commit. This verifies source availability and preserves the bytes locally; it does not establish byte-for-byte engine reproducibility or exhaustive preferred-source delivery for all npm/build dependencies. [Release guide and remaining gates](REL_01_RELEASE_READINESS.md).

## Engine provenance

- Official [npm artifact](https://www.npmjs.com/package/fairy-stockfish-nnue.wasm/v/1.1.12), exact file hashes and tarball integrity in [engine-provenance.json](engine-provenance.json). Preparation refuses a mismatching version or hash. Upstream files are unmodified; `public/engine-host.js` is the separate project bridge using the factory’s public API.
- npm `gitHead`, upstream tag `1.1.12`, and runtime ID agree on **b2e693ef1e111233ce3fb40685921708b3276ed6**. [Corresponding source](https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/b2e693ef1e111233ce3fb40685921708b3276ed6) / [source archive](https://github.com/fairy-stockfish/fairy-stockfish.wasm/archive/b2e693ef1e111233ce3fb40685921708b3276ed6.tar.gz).
- The [tagged publish workflow](https://github.com/fairy-stockfish/fairy-stockfish.wasm/blob/b2e693ef1e111233ce3fb40685921708b3276ed6/.github/workflows/ci.yml) publishes its `no-embedded-nnue` artifact, built with `make -C .. emscripten_build ARCH=wasm embedded_nnue=no`. [Build flags](https://github.com/fairy-stockfish/fairy-stockfish.wasm/blob/b2e693ef1e111233ce3fb40685921708b3276ed6/src/emscripten/Makefile) use pthreads, SIMD, memory growth, and a 128 MiB initial / 2 GiB maximum WASM heap. [Docker configuration](https://github.com/fairy-stockfish/fairy-stockfish.wasm/blob/b2e693ef1e111233ce3fb40685921708b3276ed6/src/emscripten/docker-compose.yml) pins Emscripten **2.0.26**, also reported by the running binary. We did not independently rebuild the artifact or demonstrate byte-for-byte reproducibility.
- Runtime explicitly disables `Use_NNUE` and reports **classical evaluation enabled**. No `.nnue` asset is supplied or downloaded. The binary contains a default network filename string; that alone is not evidence of embedded weights. Adding any weights requires a separate license/provenance assessment.
- tsshogi’s npm `gitHead`: **bec83166c011eb662ee963f04ddb3fe2eb584c99**; [source](https://github.com/sunfish-shogi/tsshogi/tree/bec83166c011eb662ee963f04ddb3fe2eb584c99).

## Before any binary release or hosted distribution

Have the copyright owner approve or reject the draft GPL-3.0-only proposal and resolve the application/adapter integration boundary. Review the local packet's corresponding-source completeness, dependency preferred sources, exact SDK/compiler provenance and linked-library scope, and independently rebuild the engine before clearing redistribution. Source links and a public repository alone are not a blanket GPL compliance claim. Do not add NNUE weights without their own provenance.

There is a documented path for local feasibility, but redistribution is **not cleared**. Generated `public/engine/`, notices and `dist/` remain gitignored; no binary/source release, production deployment, or infrastructure change was performed.
