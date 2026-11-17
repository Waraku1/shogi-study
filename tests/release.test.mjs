import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { prepareCandidate, sha256 } from '../scripts/prepare-release.mjs';
import { createNotices } from '../scripts/notices.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const roots = [];
const run = (root, name, args) => execFileSync(name, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const save = async (root, path, value) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), value); };
const saveJSON = (root, path, value) => save(root, path, JSON.stringify(value, null, 2) + '\n');
const commit = root => { run(root, 'git', ['add', '.']); run(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']); };

async function fixture() {
  await mkdir(join(repo, 'work'), { recursive: true });
  const root = await mkdtemp(join(repo, 'work/rel-test-'));
  roots.push(root);
  run(root, 'git', ['init', '-q']);
  await save(root, '.gitignore', 'work/\ndist/\nnode_modules/\n');
  await save(root, 'LICENSE', 'DRAFT LICENSE PROPOSAL\nGNU GENERAL PUBLIC LICENSE\n');
  const engineCommit = 'b2e693ef1e111233ce3fb40685921708b3276ed6';
  await save(root, 'NOTICE', `GPL-3.0-only draft owner pending ${engineCommit}\n`);
  await save(root, 'docs/REL_01_RELEASE_READINESS.md', 'Build/source instructions\n');
  await saveJSON(root, 'package.json', { private: true, releaseReadiness: { proposedLicense: 'GPL-3.0-only', ownerApproval: 'pending', publicDistribution: 'blocked' } });
  await saveJSON(root, 'node_modules/fairy-stockfish-nnue.wasm/package.json', { name: 'fairy-stockfish-nnue.wasm', version: '1.1.12', license: 'GPL-3.0' });
  const provenance = { package: 'fairy-stockfish-nnue.wasm', version: '1.1.12', license: 'GPL-3.0', sourceCommit: engineCommit,
    sourceUrl: `https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/${engineCommit}`, sourceArchive: `https://github.com/fairy-stockfish/fairy-stockfish.wasm/archive/${engineCommit}.tar.gz`, files: {} };
  for (const name of ['stockfish.wasm', 'stockfish.js', 'stockfish.worker.js', 'Copying.txt', 'AUTHORS']) {
    const bytes = Buffer.from(`test fixture ${name}\n`);
    provenance.files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    await save(root, `node_modules/fairy-stockfish-nnue.wasm/${name}`, bytes);
    await save(root, `dist/engine/${name}`, bytes);
  }
  await saveJSON(root, 'docs/engine-provenance.json', provenance);
  const inputs = { format: 1, notices: {}, sources: [] };
  for (const path of ['docs/licenses/MIT.txt', 'docs/licenses/toolchain.txt']) {
    const data = Buffer.from('MIT License\n');
    await save(root, path, data); inputs.notices[path] = { sha256: sha256(data) };
  }
  for (const name of ['engine', 'emscripten']) {
    const directory = join(root, `work/${name}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'LICENSE'), 'MIT License\n');
    const bytes = gzipSync(run(directory, 'tar', ['-cf', '-', 'LICENSE']));
    const hash = sha256(bytes);
    await save(root, `work/release-inputs/${name}-${hash}.tar.gz`, bytes);
    inputs.sources.push({ name, commit: engineCommit, url: `https://codeload.github.com/example/${name}/tar.gz/${engineCommit}`, bytes: bytes.length, sha256: hash, requiredMembers: ['LICENSE'] });
  }
  inputs.notices['docs/licenses/toolchain.txt'].upstreamPath = 'LICENSE';
  await saveJSON(root, 'docs/release-inputs.json', inputs);
  await save(root, 'dist/index.html', '<script src="/assets/index.js"></script>');
  await save(root, 'dist/assets/index.js', '/* fixture */');
  await save(root, 'public/engine-host.js', '/* bridge */');
  await save(root, 'dist/engine-host.js', '/* bridge */');
  await save(root, 'dist/THIRD_PARTY_NOTICES.txt', await createNotices(root, provenance, inputs));
  commit(root);
  return { root, inputs, provenance, prepare: () => prepareCandidate({ root, offline: true }) };
}
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('local release candidate: fail closed and reproduce inputs', () => {
  test('two preparations are byte-identical and carry exact source/commit/hash evidence', async () => {
    const f = await fixture();
    const first = await f.prepare();
    const second = await f.prepare();
    expect(first).toEqual(second);
    const bytes = await readFile(join(f.root, first.archive));
    expect(sha256(bytes)).toBe(first.sha256);
    const manifest = JSON.parse(run(f.root, 'tar', ['-xOzf', first.archive, './MANIFEST.json']));
    expect(manifest.releaseCommit).toBe(run(f.root, 'git', ['rev-parse', 'HEAD']).toString().trim());
    expect(manifest.publicDistribution).toBe('blocked');
    expect(manifest.files['sources/engine.tar.gz'].sha256).toBe(f.inputs.sources[0].sha256);
    const project = run(f.root, 'tar', ['-xOzf', first.archive, './sources/project.tar']);
    expect(project.length).toBeGreaterThan(0);
    expect(run(f.root, 'git', ['status', '--porcelain']).toString()).toBe('');
    expect((await readdir(join(f.root, 'work/release-candidates'))).some(p => p.startsWith('.prepare-'))).toBe(false);
  });
  test.each(['dist/engine/stockfish.wasm', 'node_modules/fairy-stockfish-nnue.wasm/stockfish.js'])('refuses independently tampered engine asset: %s', async path => {
    const f = await fixture(); await save(f.root, path, 'tampered');
    await expect(f.prepare()).rejects.toThrow('SHA-256/size mismatch');
  });
  test('refuses a missing engine license', async () => {
    const f = await fixture(); await rm(join(f.root, 'dist/engine/Copying.txt'));
    await expect(f.prepare()).rejects.toThrow('ENOENT');
  });
  test('refuses an asset omitted from the manifest', async () => {
    const f = await fixture(); delete f.provenance.files['stockfish.wasm'];
    await saveJSON(f.root, 'docs/engine-provenance.json', f.provenance); commit(f.root);
    await expect(f.prepare()).rejects.toThrow('Incomplete engine asset manifest');
  });
  test('refuses to replace an existing differing packet for the same commit', async () => {
    const f = await fixture(); await f.prepare(); await save(f.root, 'dist/assets/index.js', 'different build');
    await expect(f.prepare()).rejects.toThrow('Existing candidate differs');
    expect((await readdir(join(f.root, 'work/release-candidates'))).some(p => p.startsWith('.prepare-'))).toBe(false);
  });
  test('refuses a wrong installed package version', async () => {
    const f = await fixture(); await saveJSON(f.root, 'node_modules/fairy-stockfish-nnue.wasm/package.json', { version: 'wrong' });
    await expect(f.prepare()).rejects.toThrow('metadata mismatch');
  });
  test.each(['missing', 'corrupted'])('refuses %s pinned source instead of trusting a URL', async how => {
    const f = await fixture(); const p = `work/release-inputs/engine-${f.inputs.sources[0].sha256}.tar.gz`;
    if (how === 'missing') await rm(join(f.root, p)); else await save(f.root, p, 'broken');
    await expect(f.prepare()).rejects.toThrow(how === 'missing' ? 'Missing source archive' : 'SHA-256/size mismatch');
  });
  test('refuses source archive with missing expected members', async () => {
    const f = await fixture(); f.inputs.sources[0].requiredMembers.push('missing/source.cpp');
    await saveJSON(f.root, 'docs/release-inputs.json', f.inputs); commit(f.root);
    await expect(f.prepare()).rejects.toThrow('Required source/license member missing');
  });
  test('refuses engine/source commit mismatch', async () => {
    const f = await fixture(); f.inputs.sources[0].commit = '0'.repeat(40);
    await saveJSON(f.root, 'docs/release-inputs.json', f.inputs); commit(f.root);
    await expect(f.prepare()).rejects.toThrow('source identity mismatch');
  });
  test('refuses missing toolchain notice', async () => {
    const f = await fixture(); await rm(join(f.root, 'docs/licenses/toolchain.txt')); commit(f.root);
    await expect(f.prepare()).rejects.toThrow('ENOENT');
  });
  test('refuses stale built notices or bridge', async () => {
    const f = await fixture(); await save(f.root, 'dist/THIRD_PARTY_NOTICES.txt', 'stale');
    await expect(f.prepare()).rejects.toThrow('notices are stale');
    await save(f.root, 'dist/THIRD_PARTY_NOTICES.txt', await createNotices(f.root, f.provenance, f.inputs));
    await save(f.root, 'dist/engine-host.js', 'stale');
    await expect(f.prepare()).rejects.toThrow('bridge is stale');
  });
  test('refuses a dirty worktree and an explicit non-HEAD source revision', async () => {
    const f = await fixture(); const old = run(f.root, 'git', ['rev-parse', 'HEAD']).toString().trim();
    await save(f.root, 'uncommitted.txt', 'dirty');
    await expect(f.prepare()).rejects.toThrow('Worktree must be clean');
    commit(f.root);
    await expect(prepareCandidate({ root: f.root, commit: old, offline: true })).rejects.toThrow('checked-out HEAD');
  });
  test('refuses a symlink in the built app', async () => {
    const f = await fixture(); await symlink(join(f.root, 'LICENSE'), join(f.root, 'dist/linked'));
    await expect(f.prepare()).rejects.toThrow('Symlink refused');
  });
  test('refuses accidental removal of the owner/distribution gate', async () => {
    const f = await fixture(); await saveJSON(f.root, 'package.json', { private: false }); commit(f.root);
    await expect(f.prepare()).rejects.toThrow('distribution gate');
  });
  test('real notices retain draft status, engine source and LLVM exception references', async () => {
    const inputs = JSON.parse(await readFile(join(repo, 'docs/release-inputs.json')));
    const provenance = JSON.parse(await readFile(join(repo, 'docs/engine-provenance.json')));
    const notices = await createNotices(repo, provenance, inputs);
    expect(notices).toContain('DRAFT LICENSE PROPOSAL');
    expect(notices).toContain(provenance.sourceCommit);
    expect(notices).toContain('LLVM Exceptions');
    expect(notices).toContain('musl');
    for (const [path, expected] of Object.entries(inputs.notices)) expect(sha256(await readFile(join(repo, path)))).toBe(expected.sha256);
  });
});
