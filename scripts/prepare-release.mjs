import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createNotices } from './notices.mjs';
import { verifyBrowserBuild } from './browser-source.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const run = (root, command, args) => execFileSync(command, args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
const git = (root, ...args) => run(root, 'git', args).toString().trim();
const check = (condition, message) => { if (!condition) throw new Error(message); };

async function verified(path, expected) {
  const stat = await lstat(path);
  check(stat.isFile() && !stat.isSymbolicLink(), `Not a regular file: ${path}`);
  const bytes = await readFile(path);
  check((expected.bytes === undefined || bytes.length === expected.bytes) && sha256(bytes) === expected.sha256, `SHA-256/size mismatch: ${path}`);
  return bytes;
}

async function files(root, path = '') {
  const result = [];
  for (const name of (await readdir(join(root, path))).sort()) {
    const child = join(path, name);
    const stat = await lstat(join(root, child));
    check(!stat.isSymbolicLink(), `Symlink refused: ${child}`);
    if (stat.isDirectory()) result.push(...await files(root, child));
    else { check(stat.isFile(), `Non-file refused: ${child}`); result.push(child); }
  }
  return result;
}

async function sourceInput(root, spec, offline) {
  check(/^[a-z][a-z0-9-]*$/.test(spec.name) && /^[0-9a-f]{40}$/.test(spec.commit), 'Invalid source identity');
  check(/^[0-9a-f]{64}$/.test(spec.sha256) && spec.url.startsWith('https://codeload.github.com/') && spec.url.endsWith(spec.commit), 'Invalid pinned source reference');
  const cache = join(root, 'work/release-inputs');
  await mkdir(cache, { recursive: true });
  const path = join(cache, `${spec.name}-${spec.sha256}.tar.gz`);
  let missing = false;
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') missing = true; else throw error; }
  if (missing) {
    check(!offline, `Missing source archive in offline mode: ${spec.name}`);
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(60000) });
    check(response.ok, `Source download failed (${response.status}): ${spec.name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    check(bytes.length === spec.bytes && sha256(bytes) === spec.sha256, `Source download SHA-256/size mismatch: ${spec.name}`);
    await writeFile(path, bytes, { flag: 'wx' });
  }
  await verified(path, spec);
  const members = run(root, 'tar', ['-tzf', path]).toString().split('\n');
  check(members.every(p => !p.startsWith('/') && !p.split('/').includes('..')), `Unsafe archive paths: ${spec.name}`);
  check(spec.requiredMembers.length > 0 && spec.requiredMembers.every(p => members.includes(p)), `Required source/license member missing: ${spec.name}`);
  return path;
}

/** Prepare a local review packet only. It deliberately cannot grant release approval. */
export async function prepareCandidate({ root, commit = 'HEAD', offline = false }) {
  root = resolve(root);
  check(commit === 'HEAD' || /^[0-9a-f]{40}$/.test(commit), 'Use HEAD or a full commit SHA');
  check(!git(root, 'status', '--porcelain', '--untracked-files=normal'), 'Worktree must be clean, including untracked source files');
  const head = git(root, 'rev-parse', 'HEAD');
  const revision = git(root, 'rev-parse', '--verify', `${commit}^{commit}`);
  check(revision === head, 'Candidate commit must be checked-out HEAD; build its matching source');
  check(git(root, 'check-ignore', 'work/release-candidates/probe') === 'work/release-candidates/probe', 'Candidate output must be gitignored');
  const provenance = await json(join(root, 'docs/engine-provenance.json'));
  check(JSON.stringify(Object.keys(provenance.files).sort()) === JSON.stringify(['AUTHORS', 'Copying.txt', 'stockfish.js', 'stockfish.wasm', 'stockfish.worker.js']), 'Incomplete engine asset manifest');
  const inputs = await json(join(root, 'docs/release-inputs.json'));
  check(inputs.format === 1 && inputs.sources.find(s => s.name === 'engine')?.commit === provenance.sourceCommit, 'Engine source identity mismatch');
  check(inputs.sources.some(s => s.name === 'emscripten'), 'Missing toolchain source');
  const pkg = await json(join(root, 'package.json'));
  check(pkg.private === true && pkg.releaseReadiness?.proposedLicense === 'GPL-3.0-only' && pkg.releaseReadiness?.ownerApproval === 'pending' && pkg.releaseReadiness?.publicDistribution === 'blocked', 'Candidate must retain draft license / distribution gate');
  const engine = await json(join(root, 'node_modules/fairy-stockfish-nnue.wasm/package.json'));
  check(engine.name === provenance.package && engine.version === provenance.version && engine.license === provenance.license, 'Installed engine metadata mismatch');
  for (const [name, expected] of Object.entries(provenance.files)) {
    check(!name.includes('/') && name !== '..', 'Unsafe asset path');
    // Independent checks of installed inputs AND copied build output; do not trust preparation.
    await verified(join(root, 'node_modules/fairy-stockfish-nnue.wasm', name), expected);
    await verified(join(root, 'dist/engine', name), expected);
  }
  for (const [path, expected] of Object.entries(inputs.notices)) {
    check(path.startsWith('docs/licenses/') && !path.split('/').includes('..'), 'Unsafe notice path');
    await verified(join(root, path), expected);
  }
  const license = await readFile(join(root, 'LICENSE'), 'utf8');
  const notice = await readFile(join(root, 'NOTICE'), 'utf8');
  check(license.includes('DRAFT LICENSE PROPOSAL') && license.includes('GNU GENERAL PUBLIC LICENSE') && notice.includes(provenance.sourceCommit), 'Missing draft license / source attribution');
  const runtimeNotices = await createNotices(root, provenance, inputs);
  check(await readFile(join(root, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8') === runtimeNotices, 'Built notices are stale or incomplete');
  check((await readFile(join(root, 'dist/index.html'), 'utf8')).includes('/assets/'), 'Missing built app entry');
  check(sha256(await readFile(join(root, 'dist/engine-host.js'))) === sha256(await readFile(join(root, 'public/engine-host.js'))), 'Built engine bridge is stale');
  const browser = inputs.browserRuntime ? await verifyBrowserBuild(root, inputs, revision) : null;
  const sources = [];
  for (const spec of inputs.sources) sources.push({ spec, path: await sourceInput(root, spec, offline) });
  // Verify copied toolchain notices actually match their archived upstream text.
  for (const [path, spec] of Object.entries(inputs.notices)) {
    if (!spec.upstreamPath) continue;
    const origin = sources.find(s => s.spec.name === (spec.upstreamSource ?? 'emscripten'));
    check(origin, `Missing notice source: ${path}`);
    const upstream = run(root, 'tar', ['-xOzf', origin.path, spec.upstreamPath]);
    const copy = await readFile(join(root, path));
    check(spec.excerpt ? upstream.includes(copy.subarray(0, -1)) : upstream.equals(copy), `Notice does not match toolchain source: ${path}`);
  }
  const output = join(root, 'work/release-candidates');
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(output, '.prepare-'));
  try {
    await mkdir(join(staging, 'sources'));
    await writeFile(join(staging, 'sources/project.tar'), run(root, 'git', ['archive', '--format=tar', revision]));
    for (const { spec, path } of sources) await cp(path, join(staging, `sources/${spec.name}.tar.gz`));
    await cp(join(root, 'dist'), join(staging, 'app'), { recursive: true });
    for (const path of ['LICENSE', 'NOTICE', 'docs/REL_01_RELEASE_READINESS.md', ...(browser ? ['docs/REL_02_RESULTS.md'] : [])]) {
      await cp(join(root, path), join(staging, path.split('/').at(-1)));
    }
    await cp(join(root, 'docs/licenses'), join(staging, 'licenses'), { recursive: true });
    const hashes = {};
    for (const path of await files(staging)) {
      await chmod(join(staging, path), 0o644);
      const bytes = await readFile(join(staging, path));
      hashes[path] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
    const manifest = { format: 1, releaseCommit: revision, publicDistribution: 'blocked', ownerApproval: 'pending', proposedLicense: 'GPL-3.0-only',
      distributionScope: 'browser-only; project source includes unbundled backend; no Worker artifact',
      browser, engine: provenance, sources: inputs.sources, files: hashes };
    await writeFile(join(staging, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
    const tar = run(staging, 'tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u=rwX,go=rX', '--format=ustar', '-cf', '-', '.']);
    const bytes = gzipSync(tar, { level: 9 });
    const archive = join(output, `${revision}.tar.gz`);
    const digest = sha256(bytes);
    try {
      await lstat(archive);
      check(sha256(await readFile(archive)) === digest, 'Existing candidate differs; do not overwrite an immutable packet');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const temporary = join(staging, 'candidate.tmp');
      await writeFile(temporary, bytes);
      await rename(temporary, archive);
    }
    await writeFile(`${archive}.sha256`, `${digest}  ${revision}.tar.gz\n`);
    return { commit: revision, archive: relative(root, archive), bytes: bytes.length, sha256: digest, publicDistribution: 'blocked' };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const index = args.indexOf('--commit');
    check(index < 0 || /^[0-9a-f]{40}$/.test(args[index + 1] ?? ''), '--commit requires a full commit SHA');
    check(args.every((arg, i) => arg === '--offline' || arg === '--commit' || i === index + 1 && index >= 0), 'Usage: release:prepare [--commit FULL_SHA] [--offline]');
    const result = await prepareCandidate({ root: fileURLToPath(new URL('../', import.meta.url)), commit: index < 0 ? 'HEAD' : args[index + 1], offline: args.includes('--offline') });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(`Release preparation refused: ${error.message}`); process.exitCode = 1; }
}
