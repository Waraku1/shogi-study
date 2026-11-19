import { afterEach, expect, test, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { ArchiveStore } from '../src/features/review/store';
import { StudyStore } from '../src/features/review/studies';
import type { GameArchive } from '../src/features/review/archive';
import type { StudyVariation } from '../src/features/review/studies';

const game: GameArchive = {
  source: 'shogi-study',
  version: 1,
  id: 'deletion-game-001',
  mode: 'local',
  moves: ['7g7f', '3c3d'],
  savedAt: 1000,
  result: { status: 'finished', text: 'White wins by resignation' },
};
const study: StudyVariation = {
  source: 'shogi-study-variation',
  version: 1,
  id: 'deletion-study-001',
  parent: game,
  anchorPly: 0,
  moves: ['2g2f'],
  label: 'Alternative',
  savedAt: 1001,
};
const kinds = ['game', 'study'] as const;
type Kind = (typeof kinds)[number];
const value = (kind: Kind) => (kind === 'game' ? game : study);
const make = (kind: Kind, namespace: string, factory: IDBFactory) =>
  kind === 'game'
    ? new ArchiveStore(namespace, factory)
    : new StudyStore(namespace, factory);
async function seed(kind: Kind, namespace: string, factory: IDBFactory) {
  const s = make(kind, namespace, factory);
  if (s instanceof ArchiveStore) await s.put(game);
  else await s.put(study);
  await s.list();
  s.close();
}
async function reloaded(kind: Kind, namespace: string, factory: IDBFactory) {
  // A fresh page has fresh module caches/memory-only flags, but the same IDB.
  vi.resetModules();
  const { ArchiveStore: Archive } =
    await import('../src/features/review/store');
  const { StudyStore: Study } = await import('../src/features/review/studies');
  const s =
    kind === 'game'
      ? new Archive(namespace, factory)
      : new Study(namespace, factory);
  try {
    return await s.list();
  } finally {
    s.close();
  }
}
const unavailable = () =>
  ({
    open: vi.fn(() => {
      throw new DOMException('Database unavailable', 'UnknownError');
    }),
  }) as unknown as IDBFactory;
afterEach(() => vi.restoreAllMocks());

for (const kind of kinds) {
  for (const fault of [
    'transaction abort',
    'request failure',
    'unavailable database',
  ] as const) {
    test(`${kind}: ${fault} rejects, preserves cached record and survives a fresh-page reload`, async () => {
      const factory = new IDBFactory(),
        ns = `deletion-${kind}-${fault}`;
      await seed(kind, ns, factory);
      const s = make(
        kind,
        ns,
        fault === 'unavailable database' ? unavailable() : factory,
      );
      const originalDelete = IDBObjectStore.prototype.delete;
      let errorName = 'UnknownError';
      if (fault !== 'unavailable database') {
        vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(
          function (this: IDBObjectStore, key) {
            if (fault === 'request failure') {
              errorName = 'ConstraintError';
              // Return a real failing request: duplicate primary key -> error -> abort.
              const [namespace, id] = key as string[];
              return this.add({
                namespace,
                id,
              }) as unknown as IDBRequest<undefined>;
            }
            errorName = 'AbortError';
            const request = originalDelete.call(this, key);
            request.addEventListener('success', () => this.transaction.abort());
            return request;
          },
        );
      }
      const error = await s.remove(value(kind).id).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(
        'could not be deleted from device storage',
      );
      expect(error.cause.name).toBe(errorName);
      expect(s.warning).toBe(''); // A failed delete did not switch to memory-only.
      if (s instanceof ArchiveStore) expect(s.mode).toBe('indexeddb');
      vi.restoreAllMocks();
      expect(await reloaded(kind, ns, factory)).toEqual([value(kind)]);
      // Use the original module's cache without refreshing it from persistent rows.
      const cached = make(kind, ns, unavailable());
      expect(await cached.list()).toEqual([value(kind)]);
      expect(cached.warning).toContain('memory only');
      cached.close();
      s.close();
    });
  }

  test(`${kind}: success waits past request success, persists across reload and isolates namespaces`, async () => {
    const factory = new IDBFactory(),
      ns = `deletion-success-${kind}`,
      other = ns + '-other';
    await seed(kind, ns, factory);
    await seed(kind, other, factory);
    const s = make(kind, ns, factory);
    let settled = false,
      observedRequest = false;
    const originalDelete = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
      this: IDBObjectStore,
      key,
    ) {
      const request = originalDelete.call(this, key);
      request.addEventListener('success', () => {
        observedRequest = true;
        expect(settled).toBe(false);
      });
      return request;
    });
    const result = await s.remove(value(kind).id).then((mode) => {
      settled = true;
      return mode;
    });
    expect(result).toBe('indexeddb');
    expect(observedRequest).toBe(true);
    expect(await s.list()).toEqual([]);
    expect(await reloaded(kind, ns, factory)).toEqual([]);
    expect(await reloaded(kind, other, factory)).toEqual([value(kind)]);
    s.close();
  });

  test(`${kind}: closed database failure can be retried on the same store without fallback`, async () => {
    const factory = new IDBFactory(),
      ns = `deletion-retry-${kind}`;
    await seed(kind, ns, factory);
    const s = make(kind, ns, factory);
    await s.list();
    s.close();
    await Promise.resolve();
    await expect(s.remove(value(kind).id)).rejects.toThrow('Retry deletion');
    expect(s.warning).toBe('');
    expect(await s.remove(value(kind).id)).toBe('indexeddb');
    expect(await reloaded(kind, ns, factory)).toEqual([]);
    s.close();
  });

  test(`${kind}: explicit memory-only removal does not touch earlier persistent copies`, async () => {
    const factory = new IDBFactory(),
      ns = `deletion-memory-${kind}`,
      denied = unavailable();
    await seed(kind, ns, factory);
    const s = make(kind, ns, denied);
    expect(await s.list()).toEqual([value(kind)]);
    expect(s.warning).toContain('memory only');
    const calls = vi.mocked(denied.open).mock.calls.length;
    expect(await s.remove(value(kind).id)).toBe('memory');
    expect(vi.mocked(denied.open).mock.calls).toHaveLength(calls);
    expect(await s.list()).toEqual([]);
    expect(await reloaded(kind, ns, factory)).toEqual([value(kind)]);
    s.close();
  });
}
test('deleting a study preserves its original; deleting an original preserves saved study snapshots', async () => {
  const factory = new IDBFactory(),
    ns = 'deletion-snapshot';
  const a = new ArchiveStore(ns, factory),
    s = new StudyStore(ns, factory);
  await a.put(game);
  await s.put(study);
  await s.remove(study.id);
  expect(await reloaded('game', ns, factory)).toEqual([game]);
  expect(await reloaded('study', ns, factory)).toEqual([]);
  await s.put(study);
  await a.remove(game.id);
  expect(await reloaded('game', ns, factory)).toEqual([]);
  expect(await reloaded('study', ns, factory)).toEqual([study]);
  a.close();
  s.close();
});
