import { afterEach, expect, test, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
}
test("unknown fresh authentication fails closed, unlike authoritative guest 401", async () => {
  storage();
  const gate = await import("../src/features/review/access");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  expect((await gate.refreshAccess()).blocked).toBe(true);
  await expect(gate.assertAnalysisAllowed()).rejects.toThrow("Cannot confirm");
  for (const response of [() => new Response("proxy failed", {status: 502}),
    () => Response.json({user: {}, activeRooms: []}),
    () => Response.json({user: {id: "alice"}, activeRooms: [null]})]) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response()));
    expect((await gate.refreshAccess()).blocked).toBe(true);
  }
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, {status: 401})));
  expect((await gate.refreshAccess()).namespace).toBe("guest-local");
  await expect(gate.assertAnalysisAllowed()).resolves.toBeUndefined();
});
test("a stale unauthenticated response cannot override a newer active room observation", async () => {
  storage();
  let resolve!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>(r => { resolve = r; })));
  const gate = await import("../src/features/review/access");
  const check = gate.refreshAccess();
  gate.observeOnline("alice", "active", "remote-room");
  resolve(new Response(null, {status: 401}));
  expect((await check).blocked).toBe(true);
});
