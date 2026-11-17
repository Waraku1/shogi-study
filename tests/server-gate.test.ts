import { expect, test, vi } from "vitest";
import { playStatus, registerRoom, MAX_MEMBERSHIPS } from "../server/play-status";
import type { Env, Identity } from "../server/auth";
const me: Identity = { id: "alice", displayName: "Player", expiresAt: 9999999999999 };
function fixture(n: number, status = "waiting") {
  const rows = Array.from({ length: n }, (_, i) => ({ roomId: `room-${i}`, pending: 0 }));
  let current = 0, peak = 0, fetches = 0;
  const mutations: unknown[][] = [];
  const e = {
    DB: { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
      all: async () => ({ results: rows.slice(0, 33) }),
      first: async () => ({ n: rows.filter(r => r.roomId !== args[1]).length }),
      run: async () => { mutations.push([sql, ...args]); },
    }) }) },
    ROOMS: { idFromName: (id: string) => id, get: () => ({ fetch: async (r: Request) => {
      expect(JSON.parse(r.headers.get("X-Identity")!).id).toBe(me.id);
      fetches++; current++; peak = Math.max(peak, current);
      await new Promise(resolve => setTimeout(resolve, 1));
      current--;
      return Response.json({ status });
    } }) },
  } as unknown as Env;
  return { e, rows, mutations, counters: () => ({ peak, fetches }) };
}
test.each([0, 1, 10, 32])("status checks %i waiting memberships with bounded concurrent subrequests", async n => {
  const f = fixture(n);
  expect(await playStatus(f.e, me)).toEqual([]);
  expect(f.counters().fetches).toBe(n);
  expect(f.counters().peak).toBeLessThanOrEqual(4);
});
test("over-limit legacy memberships fail closed without fetching rooms", async () => {
  const f = fixture(128);
  await expect(playStatus(f.e, me)).rejects.toThrow("limit");
  expect(f.counters().fetches).toBe(0);
});
test("active/pending checks short-circuit safely; completed rooms use a single scoped cleanup", async () => {
  const active = fixture(32, "active");
  expect(await playStatus(active.e, me)).toHaveLength(4);
  expect(active.counters().fetches).toBe(4);
  const done = fixture(32, "finished");
  expect(await playStatus(done.e, me)).toEqual([]);
  expect(done.mutations).toHaveLength(1);
  expect(done.mutations[0][0]).toContain("userId=? AND pending=0");
  expect(done.mutations[0][1]).toBe(me.id);
  const pending = fixture(1);
  pending.rows[0].pending = 1;
  expect(await playStatus(pending.e, me)).toEqual(["room-0"]);
});
test("missing pending or failed/malformed room responses never grant clearance", async () => {
  for (const response of [new Response(null, {status: 503}), Response.json({status: "unknown"}), new Response("invalid")]) {
    const f = fixture(1);
    vi.spyOn(f.e.ROOMS, "get").mockReturnValue({fetch: async () => response} as unknown as DurableObjectStub);
    await expect(playStatus(f.e, me)).rejects.toThrow("confirm");
  }
  const f = fixture(1);
  f.rows[0].pending = 1;
  vi.spyOn(f.e.ROOMS, "get").mockReturnValue({fetch: async () => new Response(null, {status: 404})} as unknown as DurableObjectStub);
  expect(await playStatus(f.e, me)).toEqual(["room-0"]);
});
test("membership cap rejects a new room but permits recovery of an existing one", async () => {
  const f = fixture(MAX_MEMBERSHIPS);
  await expect(registerRoom(f.e, me, "new-room")).rejects.toThrow("limit");
  await expect(registerRoom(f.e, me, "room-0")).resolves.toBeUndefined();
});
