import { test,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
test('bundled renamed Mincho font and OFL notice match reviewed provenance',async()=>{
  const spec=JSON.parse(await readFile(new URL('docs/font-provenance.json',root),'utf8'));
  expect(spec.license).toBe('OFL-1.1');
  expect(spec.upstreamCommit).toMatch(/^[a-f0-9]{40}$/);
  for(const [path,sha] of Object.entries(spec.assets))
    expect(createHash('sha256').update(await readFile(new URL(path,root))).digest('hex')).toBe(sha);
  const font=await readFile(new URL('public/fonts/shogi-study-mincho.ttf',root));
  expect(font.readUInt32BE(0)).toBe(0x00010000);
  expect(font.includes(Buffer.from('ShogiStudyMincho-SemiBold','utf16le').swap16())).toBe(true);
  expect(font.includes(Buffer.from('SIL OPEN FONT LICENSE Version 1.1','utf16le').swap16())).toBe(true);
});
test('font permissions/copyright accompany the asset and runtime notices',async()=>{
  const text=await readFile(new URL('public/fonts/OFL.txt',root),'utf8');
  expect(text).toContain('Copyright 2012 Google');
  expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
  expect(text).toContain('bundled, embedded,');
  expect(text).toContain('redistributed and/or sold with any software');
  expect(text).toBe(await readFile(new URL('docs/licenses/NotoSerifJP-OFL.txt',root),'utf8'));
  const notice=await readFile(new URL('NOTICE',root),'utf8');
  expect(notice).toContain('2017-2024');
  expect(notice).toContain('Adobe');
});
