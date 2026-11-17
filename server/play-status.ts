import type { Env, Identity } from "./auth";
// Keep total Worker subrequests below 50, including session lookup and D1.
// Old profiles above this cap fail closed instead of scanning an unbounded set.
export const MAX_MEMBERSHIPS = 32;
const CONCURRENCY = 4;
export async function playStatus(e: Env, me: Identity) {
  const rows = await e.DB.prepare(
    "SELECT roomId,pending FROM player_rooms WHERE userId=? ORDER BY roomId LIMIT 33",
  )
    .bind(me.id)
    .all<{ roomId: string; pending: number }>();
  if (rows.results.length > MAX_MEMBERSHIPS) throw new Error("Room limit exceeded");
  const activeRooms: string[] = [];
  const remove: string[] = [];
  async function check(row: { roomId: string; pending: number }) {
    const r = await e.ROOMS.get(e.ROOMS.idFromName(row.roomId)).fetch(
      new Request("https://room/status", {
        headers: { "X-Identity": JSON.stringify(me) },
      }),
    );
    if (r.status === 404 || r.status === 403) {
      if (row.pending) activeRooms.push(row.roomId);
      else remove.push(row.roomId);
      return;
    }
    if (!r.ok) throw new Error("Cannot confirm room status");
    const s = (await r.json()) as { status: string };
    if (!["waiting", "active", "finished"].includes(s?.status))
      throw new Error("Invalid room status");
    if (s.status === "finished") remove.push(row.roomId);
    else if (row.pending || s.status === "active") activeRooms.push(row.roomId);
  }
  for (let i = 0; i < rows.results.length; i += CONCURRENCY) {
    // Await the entire batch, including on failure; no background status work.
    const batch = await Promise.allSettled(rows.results.slice(i, i + CONCURRENCY).map(check));
    if (batch.some((r) => r.status === "rejected")) throw new Error("Cannot confirm room status");
    // One confirmed active/pending room is enough to deny engine assistance.
    if (activeRooms.length) break;
  }
  if (remove.length)
    await e.DB.prepare(`DELETE FROM player_rooms WHERE userId=? AND pending=0 AND roomId IN (${remove.map(() => "?").join(",")})`)
      .bind(me.id, ...remove).run();
  return activeRooms;
}
export async function registerRoom(e: Env, me: Identity, id: string) {
  const count = await e.DB.prepare(
    "SELECT COUNT(*) AS n FROM player_rooms WHERE userId=? AND roomId<>?",
  )
    .bind(me.id, id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_MEMBERSHIPS) throw new Error("Room limit exceeded");
  await e.DB.prepare(
    "INSERT INTO player_rooms(userId,roomId,pending) VALUES(?,?,1) ON CONFLICT(userId,roomId) DO UPDATE SET pending=1",
  )
    .bind(me.id, id)
    .run();
}
export async function registered(
  e: Env,
  me: Identity,
  id: string,
  ok: boolean,
) {
  await e.DB.prepare(
    ok
      ? "UPDATE player_rooms SET pending=0 WHERE userId=? AND roomId=?"
      : "DELETE FROM player_rooms WHERE userId=? AND roomId=?",
  )
    .bind(me.id, id)
    .run();
}
