import { expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  StudyStore,
  validateStudy,
  studyArchive,
  studyPosition,
} from '../src/features/review/studies';
import type { StudyVariation } from '../src/features/review/studies';
import { ArchiveStore } from '../src/features/review/store';
import {
  exportArchive,
  MAX_GAMES,
  replay,
} from '../src/features/review/archive';
const branch = (
  id = 'study-variation-001',
  savedAt = 1234,
): StudyVariation => ({
  source: 'shogi-study-variation',
  version: 1,
  id,
  label: 'Alternative opening',
  anchorPly: 2,
  parent: {
    source: 'shogi-study',
    version: 1,
    id: 'original-game-001',
    mode: 'local',
    moves: ['7g7f', '3c3d', '8h2b+', '3a2b'],
    result: { status: 'finished', text: 'White wins by resignation' },
    savedAt: 1000,
  },
  moves: ['2g2f', '8c8d'],
  savedAt,
});
test('separate study snapshot survives reload, respects namespaces and leaves original archive immutable', async () => {
  const factory = new IDBFactory(),
    s = branch(),
    original = exportArchive(s.parent),
    archives = new ArchiveStore('study-alice', factory);
  await archives.put(s.parent);
  const store = new StudyStore('study-alice', factory);
  await store.put(s);
  store.close();
  const re = new StudyStore('study-alice', factory);
  expect(await re.list()).toEqual([s]);
  await expect(re.put({ ...s, moves: ['2g2f'] })).rejects.toThrow('conflict');
  expect(await new StudyStore('study-bob', factory).list()).toEqual([]);
  expect(await new StudyStore('guest-local', factory).list()).toEqual([]);
  const copy = (await re.list())[0];
  copy.parent.moves[0] = 'bad';
  copy.moves[0] = 'bad';
  expect(await re.list()).toEqual([s]);
  expect(exportArchive((await archives.list())[0])).toBe(original);
  const active = studyArchive(s);
  expect(active.moves).toEqual(['7g7f', '3c3d', '2g2f', '8c8d']);
  expect(studyPosition(s, 1).sfen).toBe(
    replay({ ...active, moves: active.moves.slice(0, 3) }).position.sfen,
  );
  await archives.remove(s.parent.id);
  expect((await re.list())[0].parent).toEqual(s.parent);
  await re.remove(s.id);
  expect(await re.list()).toEqual([]);
  re.close();
  archives.close();
});
test('study validation rejects illegal moves, invalid bounds/IDs, unsupported fields and versions', () => {
  for (const patch of [
    { moves: ['7g7e'] },
    { anchorPly: 99 },
    { moves: [] },
    { id: undefined },
    { version: 2 },
    { cookie: 'private' },
    { moves: Array(513).fill('2g2f') },
  ])
    expect(() => validateStudy({ ...branch(), ...patch })).toThrow();
  expect(() => studyPosition(branch(), 3)).toThrow('Invalid');
});
test('study retention is bounded and unavailable storage is honestly memory-only', async () => {
  const s = new StudyStore('study-cap', new IDBFactory());
  for (let i = 0; i < MAX_GAMES + 2; i++)
    await s.put(branch('study-retention-' + i, 1000 + i));
  await expect(s.put(branch('older-study-0001', 0))).rejects.toThrow('full');
  expect(await s.list()).toHaveLength(MAX_GAMES);
  expect((await s.list()).some((r) => r.savedAt === 1000)).toBe(false);
  s.close();
  const denied = {
    open() {
      throw new Error('denied');
    },
  } as unknown as IDBFactory;
  const a = new StudyStore('study-memory-a', denied);
  await a.put(branch());
  expect(a.warning).toContain('memory only');
  expect(await new StudyStore('study-memory-a', denied).list()).toEqual([
    branch(),
  ]);
  expect(await new StudyStore('study-memory-b', denied).list()).toEqual([]);
});
