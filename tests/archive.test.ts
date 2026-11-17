import { test, expect, describe, vi, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  MAX_GAMES,
  MAX_PLIES,
  MAX_BYTES,
  parseArchive,
  exportArchive,
  validateArchive,
  replay,
  variationPosition,
} from "../src/features/review/archive";
import type { GameArchive } from "../src/features/review/archive";
import { ArchiveStore } from "../src/features/review/store";
import {
  accountNamespace,
  guestNamespace,
} from "../src/features/learning/types";
const game = (id = "record-0001", time = 1000): GameArchive => ({
  source: "shogi-study",
  version: 1,
  id,
  mode: "local",
  moves: ["7g7f", "3c3d"],
  result: { status: "unfinished", text: "Unfinished practice" },
  savedAt: time,
});
describe("bounded portable game records", () => {
  test("JSON round-trip, independent replay and variations preserve original", () => {
    const g = game();
    const special = ["7g7f", "3c3d", "8h2b+", "3a2b", "B*4e", "B*8h"];
    expect(parseArchive(exportArchive({ ...g, moves: special })).moves).toEqual(
      special,
    );
    const json = exportArchive(g);
    expect(parseArchive(json)).toEqual(g);
    expect(replay(g, 0).moves).toEqual([]);
    expect(replay(g, 2).moves).toEqual(g.moves);
    const before = replay(g).record.sfen;
    const variation = variationPosition(g, 2, ["2g2f", "8c8d"]);
    expect(variation.sfen).not.toBe(before);
    expect(exportArchive(g)).toBe(json);
    expect(replay(g).record.sfen).toBe(before);
    expect(() => variationPosition(g, 2, ["2g2f", "2f2e"])).toThrow("legality");
  });
  test("rejects invalid JSON, unsupported fields/starts/versions and sensitive metadata", () => {
    for (const s of ["no", "null", "[]"])
      expect(() => parseArchive(s)).toThrow();
    for (const patch of [
      { version: 2 },
      { source: "other" },
      { startingSFEN: "9/9/9/9/9/9/9/9/9 b - 1" },
      { cookie: "secret" },
      { email: "a@b.test" },
      { publicNames: ["a@b.test"] },
      { result: { status: "finished", text: "x", token: "secret" } },
    ])
      expect(() => validateArchive({ ...game(), ...patch })).toThrow();
  });
  test("rejects oversized, illegal, out-of-turn and malformed move lists", () => {
    for (const moves of [
      ["7g7e"],
      ["3c3d"],
      ["7g7f", "7f7e"],
      ["7g7f garbage"],
      Array(MAX_PLIES + 1).fill("7g7f"),
    ])
      expect(() => validateArchive({ ...game(), moves })).toThrow();
    expect(() => parseArchive(" ".repeat(MAX_BYTES + 1))).toThrow("exceeds");
    expect(() => replay(game(), -1)).toThrow();
    expect(() => replay(game(), 3)).toThrow();
  });
  test("online records require a finished result; fields are bounded", () => {
    expect(() => validateArchive({ ...game(), mode: "online" })).toThrow(
      "finished",
    );
    expect(
      validateArchive({
        ...game(),
        mode: "online",
        result: { status: "finished", text: "White wins by resignation" },
      }).mode,
    ).toBe("online");
    for (const patch of [
      { id: "x" },
      { savedAt: NaN },
      { result: { status: "finished", text: "x".repeat(121) } },
      { publicNames: ["a", "b", "c"] },
    ])
      expect(() => validateArchive({ ...game(), ...patch })).toThrow();
  });
});
describe("archive storage", () => {
  test("reload, namespace isolation, delete and import collision preserve original", async () => {
    const db = new IDBFactory(),
      a = new ArchiveStore(accountNamespace("archive-alice"), db);
    await a.put(game());
    a.close();
    const re = new ArchiveStore(accountNamespace("archive-alice"), db);
    expect(await re.list()).toEqual([game()]);
    expect(
      await new ArchiveStore(accountNamespace("archive-bob"), db).list(),
    ).toEqual([]);
    expect(await new ArchiveStore(guestNamespace, db).list()).toEqual([]);
    await re.put(parseArchive(exportArchive(game())), true);
    await expect(re.put({ ...game(), moves: ["2g2f"] }, true)).rejects.toThrow(
      "conflict",
    );
    expect((await re.list())[0]).toEqual(game());
    await re.remove(game().id);
    expect(await re.list()).toEqual([]);
    re.close();
  });
  test("bounded history evicts oldest, stale saves cannot replace newer records", async () => {
    const s = new ArchiveStore("archive-cap", new IDBFactory());
    for (let i = 0; i < MAX_GAMES + 2; i++)
      await s.put(game(`record-${String(i).padStart(6, "0")}`, i));
    await expect(s.put(game("older-import-001", 0), true)).rejects.toThrow(
      "Archive full",
    );
    const rows = await s.list();
    expect(rows).toHaveLength(MAX_GAMES);
    expect(rows.some((r) => r.savedAt === 0)).toBe(false);
    await s.put({ ...rows[0], savedAt: 0 });
    expect((await s.list())[0].savedAt).toBe(MAX_GAMES + 1);
    s.close();
  });
  test("corrupt stored records are skipped with a visible warning", async () => {
    const db = new IDBFactory(),
      s = new ArchiveStore("archive-corrupt", db);
    await s.put(game());
    await new Promise<void>((resolve, reject) => {
      const r = db.open("shogi-study-games", 1);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const t = r.result.transaction("games", "readwrite");
        t.objectStore("games").put({
          namespace: "archive-corrupt",
          id: "bad-record",
          record: { version: 900 },
        });
        t.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
    });
    expect(await s.list()).toEqual([game()]);
    expect(s.warning).toContain("Corrupt");
    s.close();
  });
  test("denied storage remains namespaced memory across normal view navigation", async () => {
    const broken = {
      open() {
        throw new Error("Denied");
      },
    } as unknown as IDBFactory;
    const a = new ArchiveStore("archive-memory-a", broken);
    await a.put(game());
    expect(a.warning).toContain("memory only");
    expect(await new ArchiveStore("archive-memory-a", broken).list()).toEqual([
      game(),
    ]);
    expect(await new ArchiveStore("archive-memory-b", broken).list()).toEqual(
      [],
    );
    expect(a.mode).toBe("memory");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test("fresh-page server check blocks hints even without a client lease; logout remains blocked", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ user: { id: "alice" }, activeRooms: ["room-active"] }),
      ),
  );
  const gate = await import("../src/features/review/access");
  expect((await gate.refreshAccess()).blocked).toBe(true);
  await expect(gate.assertAnalysisAllowed()).rejects.toThrow("Finish");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  expect((await gate.refreshAccess()).blocked).toBe(true);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  expect((await gate.refreshAccess()).blocked).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ user: { id: "alice" }, activeRooms: [] }),
      ),
  );
  await expect(gate.assertAnalysisAllowed()).resolves.toBeUndefined();
});
