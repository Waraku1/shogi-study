import {
  MAX_BYTES,
  MAX_GAMES,
  MAX_PLIES,
  replay,
  validateArchive,
} from './archive';
import type { GameArchive } from './archive';

export type StudyVariation = {
  source: 'shogi-study-variation';
  version: 1;
  id: string;
  label: string;
  parent: GameArchive;
  anchorPly: number;
  moves: string[];
  savedAt: number;
};
export function studyArchive(
  study: Pick<StudyVariation, 'parent' | 'anchorPly' | 'moves'>,
): GameArchive {
  return {
    ...study.parent,
    mode: 'local',
    moves: [...study.parent.moves.slice(0, study.anchorPly), ...study.moves],
    result: { status: 'unfinished', text: 'Study variation' },
  };
}
export function validateStudy(input: unknown): StudyVariation {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid study variation');
  const s = input as StudyVariation;
  if (
    Object.keys(s).some(
      (k) =>
        ![
          'source',
          'version',
          'id',
          'label',
          'parent',
          'anchorPly',
          'moves',
          'savedAt',
        ].includes(k),
    ) ||
    s.source !== 'shogi-study-variation' ||
    s.version !== 1 ||
    typeof s.id !== 'string' ||
    !/^[-a-zA-Z0-9]{8,80}$/.test(s.id) ||
    typeof s.label !== 'string' ||
    !s.label.trim() ||
    s.label.length > 80 ||
    /[\x00-\x1f\x7f]/.test(s.label) ||
    !Number.isSafeInteger(s.savedAt) ||
    s.savedAt < 0 ||
    s.savedAt > 8640000000000000
  )
    throw new Error('Invalid study fields');
  const parent = validateArchive(s.parent);
  if (
    !Number.isInteger(s.anchorPly) ||
    s.anchorPly < 0 ||
    s.anchorPly > parent.moves.length ||
    !Array.isArray(s.moves) ||
    !s.moves.length ||
    s.anchorPly + s.moves.length > MAX_PLIES
  )
    throw new Error('Invalid study branch bounds');
  const clean = { ...s, parent, moves: [...s.moves] };
  validateArchive(studyArchive(clean)); // includes independent legality checks, not just USI syntax
  if (new TextEncoder().encode(JSON.stringify(clean)).length > MAX_BYTES)
    throw new Error('Study exceeds 64 KiB');
  return clean;
}
export function studyPosition(
  study: Pick<StudyVariation, 'parent' | 'anchorPly' | 'moves'>,
  ply = study.moves.length,
) {
  if (!Number.isInteger(ply) || ply < 0 || ply > study.moves.length)
    throw new Error('Invalid study ply');
  return replay(studyArchive({ ...study, moves: study.moves.slice(0, ply) }))
    .position;
}
const memories = new Map<string, Map<string, StudyVariation>>(),
  memoryOnly = new Set<string>();
class StudyWriteError extends Error {}
const sorted = (rows: StudyVariation[]) =>
  rows.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id, 'en'));
const factory = () => {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
};
export class StudyStore {
  warning = '';
  private connection: Promise<IDBDatabase> | null = null;
  constructor(
    readonly namespace: string,
    private idb = factory(),
  ) {
    if (memoryOnly.has(namespace)) this.fallback();
  }
  private mem() {
    if (!memories.has(this.namespace)) memories.set(this.namespace, new Map());
    return memories.get(this.namespace)!;
  }
  private fallback() {
    memoryOnly.add(this.namespace);
    this.warning =
      'Study storage unavailable. Variations are in memory only; export them before leaving or reloading.';
  }
  private open() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.idb) {
        reject(new Error('No IndexedDB'));
        return;
      }
      const r = this.idb.open('shogi-study-variations', 1);
      let blocked = false;
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore('variations', {
          keyPath: ['namespace', 'id'],
        });
        s.createIndex('profile', 'namespace');
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => {
        blocked = true;
        reject(new Error('Blocked'));
      };
      r.onsuccess = () => {
        if (blocked) {
          r.result.close();
          return;
        }
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
    }));
  }
  async list(): Promise<StudyVariation[]> {
    if (memoryOnly.has(this.namespace))
      return structuredClone(sorted([...this.mem().values()]));
    try {
      const db = await this.open();
      const rows = await new Promise<{ variation: unknown }[]>(
        (resolve, reject) => {
          const t = db.transaction('variations'),
            r = t
              .objectStore('variations')
              .index('profile')
              .getAll(this.namespace);
          t.oncomplete = () => resolve(r.result);
          t.onerror = t.onabort = () => reject(t.error);
        },
      );
      const valid: StudyVariation[] = [];
      for (const row of rows) {
        try {
          valid.push(validateStudy(row.variation));
        } catch {
          this.warning =
            'Corrupt or unsupported study variations were ignored.';
        }
      }
      memories.set(
        this.namespace,
        new Map(
          sorted(valid)
            .slice(0, MAX_GAMES)
            .map((s) => [s.id, s]),
        ),
      );
      return structuredClone([...this.mem().values()]);
    } catch {
      this.fallback();
      return structuredClone(sorted([...this.mem().values()]));
    }
  }
  async put(input: StudyVariation) {
    const study = validateStudy(input);
    const insert = (map: Map<string, StudyVariation>) => {
      const old = map.get(study.id);
      if (old && JSON.stringify(old) !== JSON.stringify(study))
        throw new StudyWriteError(
          'Study ID conflict: saved variation was kept',
        );
      map.set(study.id, structuredClone(study));
      const retained = sorted([...map.values()]).slice(0, MAX_GAMES);
      if (!retained.some((s) => s.id === study.id)) {
        map.delete(study.id);
        throw new StudyWriteError(
          'Study storage full: delete a variation before saving this older record',
        );
      }
      map.clear();
      retained.forEach((s) => map.set(s.id, s));
    };
    if (memoryOnly.has(this.namespace)) {
      insert(this.mem());
      return;
    }
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('variations', 'readwrite', {
            durability: 'strict',
          }),
          s = t.objectStore('variations'),
          r = s.index('profile').getAll(this.namespace);
        let reason: unknown;
        r.onsuccess = () => {
          try {
            const map = new Map<string, StudyVariation>();
            for (const row of r.result) {
              try {
                const v = validateStudy(row.variation);
                map.set(v.id, v);
              } catch {
                /* scoped corrupt rows removed below */
              }
            }
            insert(map);
            s.index('profile').openCursor(this.namespace).onsuccess = (e) => {
              const c = (e.target as IDBRequest<IDBCursorWithValue | null>)
                .result;
              if (c) {
                if (!map.has(c.value.id)) c.delete();
                c.continue();
              }
            };
            if (map.has(study.id))
              s.put({
                namespace: this.namespace,
                id: study.id,
                variation: study,
              });
            t.oncomplete = () => {
              memories.set(this.namespace, map);
              resolve();
            };
          } catch (e) {
            reason = e;
            t.abort();
          }
        };
        t.onerror = t.onabort = () => reject(reason ?? t.error);
      });
    } catch (e) {
      if (e instanceof StudyWriteError) throw e;
      this.fallback();
      insert(this.mem());
    }
  }
  async remove(id: string) {
    this.mem().delete(id);
    if (memoryOnly.has(this.namespace)) return;
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('variations', 'readwrite');
        t.objectStore('variations').delete([this.namespace, id]);
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(t.error);
      });
    } catch {
      this.fallback();
    }
  }
  close() {
    void this.connection?.then(
      (db) => db.close(),
      () => {},
    );
  }
}
