import { learningItems } from "./content";
import { CONTENT_VERSION, emptyState, subjects } from "./types";
import type { LearningState, Review, LearningItem } from "./types";
const known = new Set(learningItems.map((i) => i.id));
const memory = new Map<string, LearningState>();
const copy = (s: LearningState): LearningState => structuredClone(s);
export function normalize(value: unknown): {
  state: LearningState;
  corrupt: boolean;
} {
  const blank = emptyState();
  if (value === undefined) return { state: blank, corrupt: false };
  if (!value || typeof value !== "object")
    return { state: blank, corrupt: true };
  const s = value as LearningState;
  if (
    s.version !== 1 ||
    !s.preferences ||
    typeof s.preferences.enabled !== "boolean" ||
    !["All", ...subjects].includes(s.preferences.subject) ||
    !s.reviews ||
    typeof s.reviews !== "object" ||
    Array.isArray(s.reviews)
  )
    return { state: blank, corrupt: true };
  const result: LearningState = { ...blank, preferences: { ...s.preferences } };
  let corrupt = false;
  for (const [id, r] of Object.entries(s.reviews)) {
    if (
      !known.has(id) ||
      !r ||
      r.contentVersion !== CONTENT_VERSION ||
      !["remembered", "review"].includes(r.status) ||
      !Number.isFinite(r.lastReviewed) ||
      r.lastReviewed < 0 ||
      !Number.isFinite(r.dueAt) ||
      r.dueAt < r.lastReviewed ||
      !Number.isInteger(r.attempts) ||
      r.attempts < 1
    ) {
      corrupt = true;
      continue;
    }
    result.reviews[id] = {
      status: r.status,
      lastReviewed: r.lastReviewed,
      dueAt: r.dueAt,
      attempts: r.attempts,
      contentVersion: r.contentVersion,
    };
  }
  return { state: result, corrupt };
}
export function recordReview(
  state: LearningState,
  id: string,
  status: Review["status"],
  now: number,
): LearningState {
  if (!known.has(id) || !Number.isFinite(now) || now < 0)
    throw new Error("Invalid review");
  return {
    ...state,
    reviews: {
      ...state.reviews,
      [id]: {
        status,
        lastReviewed: now,
        dueAt: now + (status === "remembered" ? 86400000 : 300000),
        attempts: (state.reviews[id]?.attempts ?? 0) + 1,
        contentVersion: CONTENT_VERSION,
      },
    },
  };
}
export function reviewQueue(
  items: readonly LearningItem[],
  state: LearningState,
  now: number,
): LearningItem[] {
  return items
    .filter(
      (i) =>
        state.preferences.subject === "All" ||
        i.subject === state.preferences.subject,
    )
    .slice()
    .sort((a, b) => {
      const x = state.reviews[a.id],
        y = state.reviews[b.id];
      const rank = (r: Review | undefined) => (!r ? 1 : r.dueAt <= now ? 0 : 2);
      return (
        rank(x) - rank(y) ||
        (x?.dueAt ?? 0) - (y?.dueAt ?? 0) ||
        a.id.localeCompare(b.id, "en")
      );
    });
}
export class LearningStore {
  private connection: Promise<IDBDatabase> | null = null;
  mode: "indexeddb" | "memory" = "indexeddb";
  warning = "";
  constructor(
    readonly namespace: string,
    private factory: IDBFactory | undefined = safeFactory(),
  ) {}
  private fallback() {
    this.mode = "memory";
    this.warning =
      "Learning storage unavailable. Changes are in memory only and will not survive a reload.";
  }
  private open(): Promise<IDBDatabase> {
    if (!this.factory)
      return Promise.reject(new Error("IndexedDB unavailable"));
    return (this.connection ??= new Promise((resolve, reject) => {
      const r = this.factory!.open("shogi-study-learning", 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains("profiles"))
          r.result.createObjectStore("profiles", { keyPath: "namespace" });
      };
      let refused = false;
      r.onblocked = () => {
        refused = true;
        reject(new Error("IndexedDB blocked"));
      };
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        if (refused) {
          r.result.close();
          return;
        }
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
    }));
  }
  async read(): Promise<LearningState> {
    try {
      const db = await this.open();
      const raw = await new Promise<unknown>((resolve, reject) => {
        const t = db.transaction("profiles", "readonly");
        const r = t.objectStore("profiles").get(this.namespace);
        t.oncomplete = () => resolve(r.result === undefined ? undefined : (r.result?.state ?? null));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      const { state, corrupt } = normalize(raw);
      if (corrupt)
        this.warning =
          "Invalid or outdated local learning data was ignored. New reviews can still be saved.";
      memory.set(this.namespace, copy(state));
      return state;
    } catch {
      this.fallback();
      return copy(memory.get(this.namespace) ?? emptyState());
    }
  }
  async write(state: LearningState): Promise<void> {
    const checked = normalize(state);
    if (checked.corrupt) throw new Error("Invalid learning state");
    memory.set(this.namespace, copy(checked.state));
    if (this.mode === "memory") return;
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction("profiles", "readwrite", {durability:"strict"});
        t.objectStore("profiles").put({
          namespace: this.namespace,
          state: checked.state,
        });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
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
function safeFactory(): IDBFactory | undefined {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
}
