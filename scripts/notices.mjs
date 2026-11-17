import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createNotices(root, provenance, inputs) {
  let text = await readFile(join(root, 'NOTICE'), 'utf8');
  text += `\nEngine source: ${provenance.sourceUrl}\nSource archive: ${provenance.sourceArchive}\n`;
  for (const path of ['LICENSE', ...Object.keys(inputs.notices).sort()]) {
    text += `\n\n=== ${path} ===\n${await readFile(join(root, path), 'utf8')}`;
  }
  return text;
}
