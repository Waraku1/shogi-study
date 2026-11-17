import { describe, test, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  learningItems,
  vocabularyCards,
  conceptCards,
} from "../src/features/learning/content";
import {
  LearningStore,
  normalize,
  recordReview,
  reviewQueue,
} from "../src/features/learning/store";
import {
  accountNamespace,
  guestNamespace,
  CONTENT_VERSION,
  emptyState,
  subjects,
} from "../src/features/learning/types";
describe("original learning content", () => {
  test("required totals, unique IDs/prompts/answers/examples and coverage", () => {
    expect(vocabularyCards.length).toBeGreaterThanOrEqual(100);
    expect(conceptCards.length).toBeGreaterThanOrEqual(16);
    for (const field of ["id", "prompt", "answer"] as const)
      expect(new Set(learningItems.map((i) => i[field])).size).toBe(
        learningItems.length,
      );
    expect(new Set(vocabularyCards.map((i) => i.example)).size).toBe(
      vocabularyCards.length,
    );
    expect(
      new Set(conceptCards.map((i) => i.subject)).size,
    ).toBeGreaterThanOrEqual(5);
    expect(new Set(learningItems.map(i => i.quiz?.question)).size).toBe(learningItems.length);
    for (const item of learningItems) {
      expect(item.contentVersion).toBe(CONTENT_VERSION);
      expect(subjects).toContain(item.subject);
      expect(["High school", "University"]).toContain(item.difficulty);
      expect(item.answer.length).toBeGreaterThan(15);
    }
  });
  test("every quiz has distinct options and exactly one deterministic answer", () => {
    for (const item of learningItems) {
      const q = item.quiz!;
      expect(q).toBeDefined();
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(Number.isInteger(q.correctIndex)).toBe(true);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(q.options.length);
      if (item.subject === "Vocabulary")
        expect(q.options[q.correctIndex]).toBe(item.answer);
    }
    expect(conceptCards.map((i) => i.quiz!.correctIndex)).toEqual([
      0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1,
    ]);
  });
});
describe("learning persistence and deterministic review queue", () => {
  test("defaults opt out, namespaces cannot collide", () => {
    expect(emptyState().preferences.enabled).toBe(false);
    expect(accountNamespace(guestNamespace)).not.toBe(guestNamespace);
    expect(accountNamespace("alice")).not.toBe(accountNamespace("bob"));
  });
  test("IndexedDB survives store reload and separates accounts/guest", async () => {
    const db = new IDBFactory();
    const alice = new LearningStore(accountNamespace("alice"), db);
    const s = recordReview(
      emptyState(),
      learningItems[0].id,
      "remembered",
      1000,
    );
    s.preferences = { enabled: true, subject: "Vocabulary" };
    await alice.write(s);
    alice.close();
    const reload = new LearningStore(accountNamespace("alice"), db);
    expect(await reload.read()).toEqual(s);
    expect(await new LearningStore(accountNamespace("bob"), db).read()).toEqual(
      emptyState(),
    );
    expect(await new LearningStore(guestNamespace, db).read()).toEqual(
      emptyState(),
    );
    reload.close();
  });
  test("reset only the selected profile; preferences kept", async () => {
    const db = new IDBFactory();
    const a = new LearningStore("reset-a", db),
      b = new LearningStore("reset-b", db);
    const s = recordReview(emptyState(), learningItems[1].id, "review", 2000);
    s.preferences.enabled = true;
    await a.write(s);
    await b.write(s);
    await a.write({ ...s, reviews: {} });
    expect((await a.read()).reviews).toEqual({});
    expect((await a.read()).preferences.enabled).toBe(true);
    expect(await b.read()).toEqual(s);
    a.close();
    b.close();
  });
  test("due interval, attempts, filter, ordering and tie breaks are deterministic", () => {
    let s = recordReview(emptyState(), learningItems[0].id, "review", 1000);
    s = recordReview(s, learningItems[1].id, "remembered", 1000);
    s = recordReview(s, learningItems[0].id, "review", 2000);
    expect(s.reviews[learningItems[0].id]).toMatchObject({
      attempts: 2,
      lastReviewed: 2000,
      dueAt: 302000,
    });
    expect(s.reviews[learningItems[1].id].dueAt).toBe(86401000);
    const a = reviewQueue(learningItems, s, 302000);
    expect(a[0].id).toBe(learningItems[0].id);
    expect(reviewQueue(learningItems, s, 302000).map((i) => i.id)).toEqual(
      a.map((i) => i.id),
    );
    s.preferences.subject = "Physics";
    expect(
      reviewQueue(learningItems, s, 302000).every(
        (i) => i.subject === "Physics",
      ),
    ).toBe(true);
    expect(() => recordReview(s, "unknown", "review", 0)).toThrow();
    expect(() => recordReview(s, learningItems[0].id, "review", -1)).toThrow();
  });
  test("corrupted IDB is ignored honestly, then a valid review can be saved", async () => {
    const db = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const r = db.open("shogi-study-learning", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("profiles", { keyPath: "namespace" });
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const t = r.result.transaction("profiles", "readwrite");
        t.objectStore("profiles").put({
          namespace: "corrupt",
          state: { version: 400, preferences: { enabled: true } },
        });
        t.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
    });
    const store = new LearningStore("corrupt", db);
    expect(await store.read()).toEqual(emptyState());
    expect(store.warning).toContain("Invalid");
    expect(store.mode).toBe("indexeddb");
    const good = recordReview(emptyState(), learningItems[0].id, "review", 0);
    await store.write(good);
    expect(await store.read()).toEqual(good);
    store.close();
  });
  test("bad review rows are removed without disclosing another profile", () => {
    const s = recordReview(emptyState(), learningItems[0].id, "review", 0);
    s.reviews.bad = { ...s.reviews[learningItems[0].id], dueAt: -1 };
    expect(normalize(s)).toEqual({
      state: {
        ...s,
        reviews: { [learningItems[0].id]: s.reviews[learningItems[0].id] },
      },
      corrupt: true,
    });
    expect(normalize(null).corrupt).toBe(true);
  });
  test("unavailable/throwing IDB falls back to namespaced memory with no persistence claim", async () => {
    const broken = {
      open() {
        throw new Error("Denied");
      },
    } as unknown as IDBFactory;
    const a = new LearningStore("unavailable-a", broken);
    expect(await a.read()).toEqual(emptyState());
    expect(a.mode).toBe("memory");
    expect(a.warning).toContain("will not survive a reload");
    const s = recordReview(emptyState(), learningItems[0].id, "review", 10);
    await a.write(s);
    expect(await a.read()).toEqual(s);
    expect(await new LearningStore("unavailable-b", broken).read()).toEqual(
      emptyState(),
    );
  });
  test("write transaction failure switches to memory instead of reporting durable success", async () => {
    const factory = new IDBFactory();
    const store = new LearningStore("write-fails", factory);
    await store.read();
    store.close();
    await store.write(
      recordReview(emptyState(), learningItems[0].id, "review", 10),
    );
    expect(store.mode).toBe("memory");
    expect(store.warning).toContain("memory only");
  });
});
