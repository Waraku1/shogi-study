import type { Env, Identity } from "./auth";
export async function playStatus(e: Env, me: Identity) {
  const rows = await e.DB.prepare(
    "SELECT roomId,pending FROM player_rooms WHERE userId=? LIMIT 129",
  )
    .bind(me.id)
    .all<{ roomId: string; pending: number }>();
  if (rows.results.length > 128) throw new Error("Room limit exceeded");
  const activeRooms: string[] = [];
  for (const row of rows.results) {
    const r = await e.ROOMS.get(e.ROOMS.idFromName(row.roomId)).fetch(
      new Request("https://room/snapshot", {
        headers: { "X-Identity": JSON.stringify(me) },
      }),
    );
    if (r.status === 404 || r.status === 403) {
      if (row.pending) activeRooms.push(row.roomId);
      else
        await e.DB.prepare(
          "DELETE FROM player_rooms WHERE userId=? AND roomId=?",
        )
          .bind(me.id, row.roomId)
          .run();
      continue;
    }
    if (!r.ok) throw new Error("Cannot confirm room status");
    const s = (await r.json()) as { status: string };
    if (s.status === "finished")
      await e.DB.prepare("DELETE FROM player_rooms WHERE userId=? AND roomId=?")
        .bind(me.id, row.roomId)
        .run();
    else if (row.pending || s.status === "active") activeRooms.push(row.roomId);
  }
  return activeRooms;
}
export async function registerRoom(e: Env, me: Identity, id: string) {
  const count = await e.DB.prepare(
    "SELECT COUNT(*) AS n FROM player_rooms WHERE userId=? AND roomId<>?",
  )
    .bind(me.id, id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= 128) throw new Error("Room limit exceeded");
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
