import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, readdir, lstat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const buildRecord = 'BROWSER_BUILD.json';
const check = (ok, message) => { if (!ok) throw new Error(message); };
export const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
export function sourceIdentity(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();
  return { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain', '--untracked-files=normal') };
}
export async function installedPackage(root, name) {
  let path = join(root, 'node_modules', name, 'package.json');
  const parent = { scheduler: 'react-dom', rolldown: 'vite' }[name];
  if (parent) path = join(dirname(await realpath(join(root, 'node_modules', parent, 'package.json'))), '..', name, 'package.json');
  const pkg = await readJSON(path);
  check(pkg.name === name, `Runtime package identity mismatch: ${name}`);
  return { pkg, directory: dirname(path) };
}
export function moduleSource(id, root) {
  const helper = { '\0vite/modulepreload-polyfill.js': 'vite', '\0rolldown/runtime.js': 'rolldown' }[id];
  if (helper) return { package: helper, path: id.slice(1) };
  const marker = '/node_modules/';
  const index = id.lastIndexOf(marker);
  if (index >= 0) {
    const path = id.slice(index + marker.length);
    const parts = path.split('/');
    return { package: parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0], path };
  }
  const path = relative(root, id).replaceAll('\\', '/');
  check(path.startsWith('src/'), `Unsupported browser module: ${id}`);
  return { package: null, path };
}
export async function outputFiles(root, prefix = '') {
  const result = {};
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = join(prefix, name), stat = await lstat(join(root, path));
    check(!stat.isSymbolicLink(), `Symlink refused: ${path}`);
    if (stat.isDirectory()) Object.assign(result, await outputFiles(root, path));
    else {
      check(stat.isFile(), `Non-file refused: ${path}`);
      if (path === buildRecord) continue;
      const bytes = await readFile(join(root, path));
      result[path.replaceAll('\\', '/')] = { bytes: bytes.length, sha256: digest(bytes) };
    }
  }
  return result;
}
export async function verifyBrowserBuild(root, inputs, revision) {
  const record = await readJSON(join(root, 'dist', buildRecord));
  check(record.format === 1 && record.source?.commit === revision && record.source.dirty === false, 'Browser build source does not match clean candidate HEAD; rebuild');
  check(record.lockSha256 === digest(await readFile(join(root, 'pnpm-lock.yaml'))), 'Browser build lockfile mismatch');
  const expected = Object.keys(inputs.browserRuntime).sort();
  check(JSON.stringify(Object.keys(record.packages ?? {}).sort()) === JSON.stringify(expected), 'Browser runtime graph differs from reviewed source set');
  const observed = [...new Set((record.modules ?? []).map(m => m.package).filter(Boolean))].sort();
  check(JSON.stringify(observed) === JSON.stringify(expected), 'Browser module graph is incomplete or unsupported');
  for (const [name, spec] of Object.entries(inputs.browserRuntime)) {
    const { pkg, directory } = await installedPackage(root, name);
    check(pkg.version === spec.version && pkg.license === spec.license && record.packages[name] === spec.version, `Runtime package metadata mismatch: ${name}`);
    check(inputs.sources.some(s => s.name === spec.source), `Missing preferred source: ${name}`);
    check(inputs.notices[spec.notice], `Missing runtime notice: ${name}`);
    const installedNotice = await readFile(join(directory, spec.packageLicense));
    check(digest(installedNotice) === spec.packageLicenseSha256 &&
      installedNotice.includes(await readFile(join(root, spec.notice))), `Installed runtime license mismatch: ${name}`);
  }
  check(JSON.stringify(record.files) === JSON.stringify(await outputFiles(join(root, 'dist'))), 'Browser build output altered or incomplete');
  return record;
}
