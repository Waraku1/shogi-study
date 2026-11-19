import { MAX_GAMES, validateArchive } from "./archive";
import type { GameArchive } from "./archive";
import { deleteStoredRecord } from "./delete-record";
class ArchiveConflict extends Error {}
const memoryOnly = new Set<string>();
const memory = new Map<string, Map<string, GameArchive>>();
const notice =
  "Archive storage unavailable. Records are in memory only; export them before leaving or reloading.";
export class ArchiveStore {
  mode: "indexeddb" | "memory" = "indexeddb";
  warning = "";
  private connection: Promise<IDBDatabase> | null = null;
  constructor(
    readonly namespace: string,
    private factory: IDBFactory | undefined = getFactory(),
  ) {
    if (memoryOnly.has(namespace)) this.fallback();
  }
  private fallback() {
    memoryOnly.add(this.namespace);
    this.mode = "memory";
    this.warning = notice;
  }
  private open() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.factory) {
        reject(new Error("No IndexedDB"));
        return;
      }
      const r = this.factory.open("shogi-study-games", 1);
      let blocked = false;
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore("games", {
          keyPath: ["namespace", "id"],
        });
        s.createIndex("profile", "namespace");
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => {
        blocked = true;
        reject(new Error("Blocked"));
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
  async list(): Promise<GameArchive[]> {
    if (this.mode === "memory")
      return sorted([...this.mem().values()]).map((r) => structuredClone(r));
    try {
      const db = await this.open();
      const rows = await new Promise<{ record: unknown }[]>(
        (resolve, reject) => {
          const t = db.transaction("games");
          const r = t
            .objectStore("games")
            .index("profile")
            .getAll(this.namespace);
          t.oncomplete = () => resolve(r.result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        },
      );
      const records: GameArchive[] = [];
      for (const row of rows) {
        try {
          records.push(validateArchive(row.record));
        } catch {
          this.warning = "Corrupt or unsupported saved games were ignored.";
        }
      }
      memory.set(this.namespace, new Map(records.map((r) => [r.id, r])));
      return sorted(records).slice(0, MAX_GAMES);
    } catch {
      this.fallback();
      return sorted([...this.mem().values()]).map((r) => structuredClone(r));
    }
  }
  private mem() {
    if (!memory.has(this.namespace)) memory.set(this.namespace, new Map());
    return memory.get(this.namespace)!;
  }
  async put(input: GameArchive, importing = false) {
    await this.commit(input, importing);
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("archive-saved", { detail: this.namespace }),
      );
  }
  private async commit(input: GameArchive, importing = false) {
    const record = validateArchive(input);
    if (this.mode === "memory") {
      this.insert(this.mem(), record, importing);
      return;
    }
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction("games", "readwrite", {
          durability: "strict",
        });
        const s = t.objectStore("games");
        const r = s.index("profile").getAll(this.namespace);
        let reason: Error | null = null;
        r.onsuccess = () => {
          try {
            const map = new Map<string, GameArchive>();
            for (const row of r.result) {
              try {
                map.set(row.id, validateArchive(row.record));
              } catch {
                /* corrupt rows are removed within this profile */
              }
            }
            this.insert(map, record, importing);
            s.index("profile").openCursor(this.namespace).onsuccess = (e) => {
              const c = (e.target as IDBRequest<IDBCursorWithValue | null>)
                .result;
              if (c) {
                if (!map.has(c.value.id)) c.delete();
                c.continue();
              }
            };
            for (const item of map.values())
              s.put({ namespace: this.namespace, id: item.id, record: item });
            memory.set(this.namespace, map);
          } catch (e) {
            reason = e as Error;
            t.abort();
          }
        };
        t.oncomplete = () => resolve();
        t.onerror = () => reject(reason ?? t.error);
        t.onabort = () => reject(reason ?? t.error);
      });
    } catch (e) {
      if (e instanceof ArchiveConflict) throw e;
      this.fallback();
      this.insert(this.mem(), record, importing);
    }
  }
  private insert(
    map: Map<string, GameArchive>,
    record: GameArchive,
    importing: boolean,
  ) {
    const old = map.get(record.id);
    if (importing && old && JSON.stringify(old) !== JSON.stringify(record))
      throw new ArchiveConflict(
        "Record ID conflict: original saved game was kept",
      );
    const proposed = new Map(map);
    if (!old || old.savedAt <= record.savedAt)
      proposed.set(record.id, structuredClone(record));
    const kept = sorted([...proposed.values()]).slice(0, MAX_GAMES);
    if (importing && !kept.some((r) => r.id === record.id))
      throw new ArchiveConflict(
        "Archive full: delete a saved game before importing this older record",
      );
    map.clear();
    for (const item of kept) map.set(item.id, item);
  }
  async remove(id: string) {
    if (this.mode === "memory") {
      this.mem().delete(id);
      return "memory" as const;
    }
    try {
      const db = await this.open();
      await deleteStoredRecord(db, "games", [this.namespace, id]);
    } catch (cause) {
      // Preserve the cached record/mode; reopen on retry without hiding failure.
      this.close();
      this.connection = null;
      throw new Error(
        "Saved game could not be deleted from device storage. Retry deletion or reload to check the saved record.",
        { cause },
      );
    }
    this.mem().delete(id);
    return "indexeddb" as const;
  }
  close() {
    void this.connection?.then(
      (db) => db.close(),
      () => {},
    );
  }
}
function sorted(rows: GameArchive[]) {
  return rows.sort(
    (a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id, "en"),
  );
}
function getFactory() {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
}
async function persistGame(namespace: string, record: GameArchive) {
  const store = new ArchiveStore(namespace);
  try {
    await store.put(record);
    return store.warning || "Game saved on this device.";
  } finally {
    store.close();
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();
export function saveGame(namespace: string, record: GameArchive) {
  const next = writeQueue.then(() => persistGame(namespace, record));
  writeQueue = next.catch(() => {});
  return next;
}
