import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, moduleSource, verifyBrowserBuild } from '../scripts/browser-source.mjs';

const roots = [], revision = 'a'.repeat(40);
const save = async (root, path, bytes) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), bytes); };
async function fixture() {
  const root = await mkdtemp('/tmp/shogi-source-test-'); roots.push(root);
  const license = 'MIT test license\n', lock = 'locked packages\n', js = 'export const answer = 42;\n';
  await save(root, 'node_modules/tsshogi/package.json', JSON.stringify({ name:'tsshogi', version:'2.3.4', license:'MIT' }));
  await save(root, 'node_modules/tsshogi/LICENSE', license);
  await save(root, 'docs/licenses/MIT.txt', license);
  await save(root, 'pnpm-lock.yaml', lock);
  await save(root, 'dist/assets/app.js', js);
  const inputs = { sources:[{ name:'tsshogi' }], notices:{ 'docs/licenses/MIT.txt':{ sha256:digest(license) } },
    browserRuntime:{ tsshogi:{ version:'2.3.4', license:'MIT', source:'tsshogi', notice:'docs/licenses/MIT.txt', packageLicense:'LICENSE', packageLicenseSha256:digest(license) } } };
  const record = { format:1, source:{ commit:revision, dirty:false }, lockSha256:digest(lock), packages:{ tsshogi:'2.3.4' },
    modules:[{package:'tsshogi',path:'tsshogi/dist/index.js'},{package:null,path:'src/main.tsx'}],
    files:{ 'assets/app.js':{ bytes:Buffer.byteLength(js),sha256:digest(js) } } };
  const write = () => save(root, 'dist/BROWSER_BUILD.json', JSON.stringify(record));
  await write(); return { root, inputs, record, write, verify:() => verifyBrowserBuild(root, inputs, revision) };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });

test('accepts matching clean source, reviewed runtime, license and exact output', async () => {
  const f = await fixture(); expect((await f.verify()).source.commit).toBe(revision);
});
test.each(['dirty','revision','lock'])('rejects stale source/build evidence: %s', async kind => {
  const f = await fixture();
  if(kind==='dirty') f.record.source.dirty=true;
  if(kind==='revision') f.record.source.commit='b'.repeat(40);
  if(kind==='lock') await save(f.root,'pnpm-lock.yaml','changed lock');
  await f.write(); await expect(f.verify()).rejects.toThrow(kind==='lock'?'lockfile':'source');
});
test.each(['changed','missing','extra-worker'])('rejects modified or unrecorded distribution files: %s', async kind => {
  const f = await fixture();
  if(kind==='changed') await save(f.root,'dist/assets/app.js','altered');
  if(kind==='missing') await rm(join(f.root,'dist/assets/app.js'));
  if(kind==='extra-worker') await save(f.root,'dist/worker.js','backend');
  await expect(f.verify()).rejects.toThrow('output altered');
});
test('rejects unreviewed runtime imports, omitted sources and license tampering', async () => {
  const f = await fixture();
  f.record.modules.push({ package:'better-auth',path:'better-auth/dist/index.js' });
  await f.write(); await expect(f.verify()).rejects.toThrow('module graph');
  f.record.modules.pop(); await f.write();
  f.inputs.sources=[]; await expect(f.verify()).rejects.toThrow('preferred source');
  f.inputs.sources=[{name:'tsshogi'}];
  await save(f.root,'node_modules/tsshogi/LICENSE','changed');
  await expect(f.verify()).rejects.toThrow('license mismatch');
});
test('distinguishes injected runtimes from build-only tool packages and rejects unknown virtual code', () => {
  expect(moduleSource('\0rolldown/runtime.js','/app').package).toBe('rolldown');
  expect(moduleSource('\0vite/modulepreload-polyfill.js','/app').package).toBe('vite');
  expect(moduleSource('/app/node_modules/.pnpm/react@19/node_modules/react/index.js','/app').package).toBe('react');
  expect(() => moduleSource('\0unknown/runtime','/app')).toThrow('Unsupported');
});
test('every declared browser runtime has pinned preferred sources and hashed notices', async () => {
  const root = fileURLToPath(new URL('../',import.meta.url));
  const inputs = JSON.parse(await readFile(join(root,'docs/release-inputs.json')));
  expect(Object.keys(inputs.browserRuntime).sort()).toEqual(['react','react-dom','rolldown','scheduler','tsshogi','vite']);
  for (const spec of Object.values(inputs.browserRuntime)) {
    const source = inputs.sources.find(s=>s.name===spec.source);
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(source.requiredMembers.some(m=>m.endsWith('/LICENSE'))).toBe(true);
    expect(digest(await readFile(join(root,spec.notice)))).toBe(inputs.notices[spec.notice].sha256);
  }
});
