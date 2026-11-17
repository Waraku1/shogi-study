import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createNotices } from './notices.mjs';

const root = new URL('../', import.meta.url);
const provenance = JSON.parse(await readFile(new URL('docs/engine-provenance.json', root), 'utf8'));
const packageRoot = new URL('node_modules/fairy-stockfish-nnue.wasm/', root);
const pkg = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
if (pkg.version !== provenance.version) throw new Error('Unexpected engine version; review provenance before changing it.');
const target = new URL('public/engine/', root);
await mkdir(target, { recursive: true });
for (const [filename, expected] of Object.entries(provenance.files)) {
  const bytes = await readFile(new URL(filename, packageRoot));
  if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new Error(`Engine integrity check failed: ${filename}`);
  }
  await writeFile(new URL(filename, target), bytes);
}
const inputs = JSON.parse(await readFile(new URL('docs/release-inputs.json', root), 'utf8'));
const notices = await createNotices(fileURLToPath(root), provenance, inputs);
await writeFile(new URL('public/THIRD_PARTY_NOTICES.txt', root), notices);
console.log(`Prepared unmodified ${provenance.package}@${pkg.version} for local testing (GPLv3; see docs/LICENSE_INVENTORY.md).`);
