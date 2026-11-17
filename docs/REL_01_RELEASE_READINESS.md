# REL-01 — local distribution candidate, not a release

Contract: [PR #1 comment](https://github.com/Waraku1/shogi-study/pull/1#issuecomment-6933205123). Continue from `419ca98ca33c79f9146f874d88530ce9122d9106`; preserve SPIKE-01 functionality. Nothing here authorizes merging, deployment, artifact upload or binary publication.

## Proposed licensing

**GPL-3.0-only is the proposed whole-application path. Copyright-owner approval is pending.** Root `LICENSE` contains a clearly marked draft and the GPLv3 text; it is not an effective project grant. `package.json` remains private, uses `SEE LICENSE IN LICENSE`, and explicitly records the proposed SPDX identifier and blocked distribution. Approval must be recorded by the owner before replacing the draft with an effective grant. No legal sign-off is claimed.

The engine permits GPLv3 or later, so selecting v3 only for the application is a conservative candidate path. The reviewed MIT, NCSA and Apache-2.0-with-LLVM-exception runtime terms show no identified license-level conflict with GPLv3, provided their attribution/conditions are retained. This does not settle ownership, derivative-work boundaries or complete binary provenance. Original dependency rights are unchanged. See `NOTICE` and [LICENSE_INVENTORY.md](LICENSE_INVENTORY.md).

## Prepare and inspect locally

Prerequisites: Node 24.22.1, pnpm 11.25.0, Git and **GNU tar** (tested 1.35), Linux. Preparation requires a clean checkout at the exact candidate commit; `work/`, `dist/` and installed dependencies are ignored. No production credentials are used.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:browser
pnpm release:prepare --commit "$(git rev-parse HEAD)"
```

The last command rebuilds locally, independently checks installed AND built engine file sizes/SHA-256 against `docs/engine-provenance.json`, verifies notices against `docs/release-inputs.json` and upstream source text, downloads pinned source archives if absent, and verifies their size/hash and required source/license members. Node's `--use-env-proxy` honors configured HTTP(S)/NO_PROXY settings without disabling TLS validation. A missing, corrupt, mismatching, dirty or incomplete input aborts preparation. A changed upstream archive encoding also fails closed; review a new hash instead of silently accepting it.

Output: gitignored `work/release-candidates/<full-commit>.tar.gz` and `.sha256`. The packet contains:

- `sources/project.tar`: `git archive` of that exact application commit, including preferred TS/React source, lockfile, tests, preparation/build scripts, workflow and all tracked documentation/notices.
- `sources/engine.tar.gz`: actual complete upstream source at **b2e693ef1e111233ce3fb40685921708b3276ed6**, including Makefiles, glue, license and authors.
- `sources/emscripten.tar.gz`: actual Emscripten **2.0.26**, commit **5af6a110ee58ca4a6885fbcad830c92207fefea2**, including its vendored musl, LLVM runtime, pthread/JS glue and allocator sources/notices.
- `app/`: local built candidate including the unmodified engine, generated complete runtime notices and worker bridge; `licenses/`, draft `LICENSE`, `NOTICE`, this guide and `MANIFEST.json` with commit identities and per-file hashes.

Archives are bundled, not merely linked. Downloads verified equivalent source availability at preparation time; retaining the actual bytes avoids depending on a remote URL's continued availability for this packet. Source caches live under `work/release-inputs/`. Once populated, `pnpm release:prepare --offline` requires those exact cached bytes and fails if unavailable. No date, local path or random staging ID enters the packet; file order, modes, tar ownership/mtime and gzip are normalized. Running twice at the same commit with the same inputs must yield the same SHA-256. An existing different packet is not overwritten.

```sh
cd work/release-candidates
sha256sum -c *.sha256
tar -tzf <full-commit>.tar.gz
tar -xOzf <full-commit>.tar.gz ./MANIFEST.json
```

The SHA file uses archive basenames: run the checksum check from the candidate directory. Extract only into a new local review directory. `MANIFEST.json` always says **publicDistribution: blocked / ownerApproval: pending**. This command cannot approve or publish a release. Never upload these review packets as CI artifacts or GitHub releases under REL-01.

## Build/source instructions and limits

Application: extract `sources/project.tar`, run the locked install, `pnpm build` and the test commands above. All package versions/integrities are in `pnpm-lock.yaml`; runtime dependency notices are retained. This is a reproducible source/install recipe with registry dependencies, not a fully offline vendored npm/toolchain distribution. Availability of every transitive preferred upstream source and a complete dependency source delivery still require review before public distribution.

Engine: extract the engine source into its own directory. The tagged publish workflow selects `embedded_nnue=no`; its Makefiles default to SIMD, pthreads, classical fallback and minified JS. Install/activate the official **Emscripten SDK 2.0.26** (see that SDK's installation instructions), source `emsdk_env.sh`, and use GNU make plus the SDK's Node/Python and Java for Closure:

```sh
emcc --version  # must be 2.0.26
make -C src emscripten_build ARCH=wasm embedded_nnue=no wasm_simd=yes \
  EM_COMMIT=b2e693ef EM_UPSTREAM= EM_EMSCRIPTEN=2.0.26
```

The explicit identity variables replace Git/emsdk probes absent in a source tarball. Makefile copying appends `worker-postamble.js` to the pthread worker. Compare all three resulting runtime files against the pinned engine hashes. **This independent rebuild and byte equality have not been demonstrated.** The SDK installer/compiler/Binaryen/Closure are general build tools, not automatically proven to be linked runtime components; their exact build provenance/availability and any further applicable notices need a release review. The packaged Emscripten sources cover the identified vendored linked-runtime code; a symbol-level linkage inventory for this opaque npm binary remains unverified. No NNUE weights are included or downloaded.

## Hosting and manual compatibility checks

AI requires a **secure context** (localhost or HTTPS), WebAssembly SIMD, shared memory and nested/pthread workers. Serve the document and same-origin worker/WASM assets with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Use correct JS/WASM MIME types, same-origin assets, and no incompatible embedding/opener policy. Dev **and** preview already set the headers. One search thread still uses pthreads; there is no non-shared-memory build. Runtime errors display an honest error and no fabricated analysis; local two-player remains usable. If an AI turn cannot continue, select **Local two-player** (this starts a new game). Reset/undo/mode change disposes stale work; Stop preserves the adapter for reuse. Hosting configuration is guidance only; no host is provisioned by REL-01.

Safari on macOS: use `pnpm dev` on localhost, or `pnpm build` + `pnpm preview --port 5174`. In Web Inspector, record browser/OS, `isSecureContext`, `crossOriginIsolated`, `typeof SharedArrayBuffer`, load/worker errors and displayed engine memory/startup. Move `7g7f`, switch to AI and repeat; verify a legal White reply, three candidate buttons, a variation preview, Undo, Stop and New game. Repeat ten AI replies. Record pass/fail and timing, not assumed equivalence with Chromium.

Physical iOS/Android: use an **existing** trusted HTTPS development endpoint with those headers, or a developer-controlled USB localhost forward supported by the device. A plain LAN HTTP address is not a secure context. Do not provision/deploy an endpoint as part of this task. Test portrait/landscape, tap moves/drops/promotion, AI reply, analysis, ten repeats and Stop/reset; background/restore once. Note device, OS/browser, reload/crash, responsiveness and memory observations. If no suitable endpoint is available, record **NOT TESTED**.

Also test failure deliberately using developer tools to block `stockfish.wasm`: Analyze should show an error, produce no candidates, and local moves should still work. Chromium automation covers this and missing isolation. **Safari/WebKit and physical mobile are not validated by viewport emulation.**

## Release gate

**CONDITIONAL GO as a review candidate only.** Owner approval of the license proposal, complete corresponding-source/dependency/toolchain review and independent engine rebuild remain open. Safari/real-device checks and suitable eventual host headers remain unverified. No public distribution decision is made by the script, tests or this document. [GPL source delivery guidance](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites) and [GPLv3 §6](https://www.gnu.org/licenses/gpl-3.0.html#section6) govern a future release; simply having a public repository or passing hashes is insufficient.

## GATE-01 follow-up source gaps

REL-01 packets/measurements predate accounts, Workers, learning and archives. They do not clear the current MVP. Use the **exact reviewed final GATE-01 SHA recorded in its PR**, not `fc0ce62` or an older candidate; a future candidate must start from a clean checkout of that revision. No GATE-01 packet is generated or approved.

Bounded outstanding items (not a new full audit):

- Owner: approve/reject the draft GPL-3.0-only whole-app proposal, confirm rights to original learning/UI/icon/server code and resolve integration scope. Root LICENSE/private/blocked-distribution flags remain unchanged.
- Backend additions: installed metadata reports Better Auth **1.7.25 MIT**, Drizzle ORM **0.45.4 Apache-2.0**, Wrangler **4.162.0 MIT OR Apache-2.0**; fake-indexeddb **6.2.8 Apache-2.0** is test-only. Retain applicable notices/Apache conditions and match exact preferred upstream/transitive sources and license evidence to `pnpm-lock.yaml`; metadata labels alone are not corresponding-source proof. The REL-01 dependency snapshot predates these additions and must not be represented as current/full coverage.
- The project source archive recipe includes tracked server/auth/schema/migrations, learning content/storage, archive/review and build/test/profile sources at the chosen SHA. The existing **app/** packet is a browser build, not a complete Worker/backend distribution. Before distributing a backend artifact, supply its exact build recipe/configuration, migration/schema sources and corresponding dependency sources; secrets/local data are never source-delivery inputs. No backend artifact was built for distribution here.
- Original engine/Emscripten pinned sources and notices still apply. Independent pinned-SDK rebuild/byte comparison and the unresolved compiler/linked-runtime source/provenance scope remain open. New code does not resolve those facts. Do not add NNUE weights or assert a hash check proves reproducibility.
- Determine/retain the actual current corresponding-source delivery set and applicable dependency/build-tool notices alongside any authorized binary or hosted delivery. The recipe's engine/Emscripten archives plus public Git/npm links are not proof of complete preferred-source delivery for all current components. No source archive upload, binary publication, host or legal approval is authorized by GATE-01.

## REL-02 clarification (current preparation)

[REL-02 results](REL_02_RESULTS.md) supersede the above open-ended source/rebuild checklist for the current **browser-only** candidate. Preparation now retains pinned preferred React/React DOM, Scheduler, tsshogi, Vite helper and Rolldown runtime sources and missing helper MIT notices, in addition to engine/Emscripten sources. General-purpose compiler/SDK/Docker/Node build tools are distinct from linked/generated runtime code; GPLv3 §1 permits exclusions for qualifying unmodified tools not part of the work. No whole SDK or unselected backend npm graph is indiscriminately bundled. Better Auth/Drizzle are not browser payloads; a future conveyed backend executable needs its own scoped review.

`pnpm build` records the clean source commit, lock hash, actual rendered browser modules, runtime versions and output hashes in `dist/BROWSER_BUILD.json`. Candidate preparation rejects stale/dirty-source builds, changed runtime graphs, altered/extra output files, missing preferred archives and mismatching notices. Rebuild after committing changes, then prepare from that same clean HEAD. The manifest explicitly declares the browser-only scope; all inputs and candidate files remain local/gitignored and distribution stays blocked.

**GPLv3 §1/6 requires Corresponding Source and an appropriate source-delivery method, not an automatic byte-identical hash result or an independent rebuild test.** Matching hashes are optional assurance; a functional rebuild is useful evidence of buildability, not a substitute for the required preferred sources/scripts/notices. REL-02's one Docker build attempt could not start because the writable-layer copy exhausted disk; rebuilt-engine functionality and hash comparison are NOT TESTED. See its exact digest/commands. This does not establish a legal source failure. The earlier recommendation to rebuild before clearing redistribution is an assurance recommendation, not a statement that the GPL independently requires byte equality. Owner approval and any unresolved source/provenance assessment still precede distribution.
