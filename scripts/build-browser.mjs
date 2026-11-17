import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecord, digest, installedPackage, moduleSource, outputFiles, readJSON, sourceIdentity } from './browser-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const inputs = await readJSON(join(root, 'docs/release-inputs.json'));
const source = sourceIdentity(root), modules = [];
await build({ root, plugins: [{ name: 'browser-source-evidence', generateBundle(_options, bundle) {
  for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk')
    for (const [id, module] of Object.entries(chunk.modules)) if (module.renderedLength > 0)
      modules.push(moduleSource(id, root));
} }] });
if (JSON.stringify(sourceIdentity(root)) !== JSON.stringify(source)) throw new Error('Source identity changed during browser build');
const names = [...new Set(modules.map(m => m.package).filter(Boolean))].sort();
if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs.browserRuntime).sort())) throw new Error('Browser dependency graph changed; review source inputs');
const packages = {};
for (const name of names) {
  const { pkg } = await installedPackage(root, name);
  if (pkg.version !== inputs.browserRuntime[name].version) throw new Error(`Unreviewed browser runtime version: ${name}`);
  packages[name] = pkg.version;
}
const record = { format: 1, source, lockSha256: digest(await readFile(join(root, 'pnpm-lock.yaml'))), packages,
  modules: modules.sort((a,b) => a.path.localeCompare(b.path, 'en')), files: await outputFiles(join(root, 'dist')) };
await writeFile(join(root, 'dist', buildRecord), JSON.stringify(record, null, 2) + '\n');
