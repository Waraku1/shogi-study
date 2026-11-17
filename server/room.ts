import { DurableObject } from "cloudflare:workers";
import { isUSIMove } from "../src/features/engine/usi";
import { LocalGame } from "../src/features/shogi/game";
import { identity } from "./auth";
import type { Env, Identity } from "./auth";
import { reply } from "./worker";
type State = {
  id: string;
  players: Identity[];
  moves: string[];
  moveIds: string[];
  moveTimes: number[];
  remaining: number[];
  since: number | null;
  status: "waiting" | "active" | "finished";
  result: string | null;
  seq: number;
};
export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS game(id INTEGER PRIMARY KEY,state TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,usi TEXT NOT NULL,ply INTEGER NOT NULL)",
    );
  }
  protected resolve(r: Request) {
    return identity(r, this.env);
  }
  protected duration() {
    return 600000;
  }
  private load(): State | null {
    const row = this.ctx.storage.sql
      .exec<{ state: string }>("SELECT state FROM game WHERE id=1")
      .toArray()[0];
    return row ? JSON.parse(row.state) : null;
  }
  private save(s: State) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO game VALUES(1,?)",
      JSON.stringify(s),
    );
    if (s.status === "active")
      void this.ctx.storage.setAlarm(
        (s.since ?? Date.now()) + s.remaining[s.moves.length % 2],
      );
    else void this.ctx.storage.deleteAlarm();
  }
  private game(s: State) {
    const g = new LocalGame();
    for (const m of s.moves)
      if (!g.play(m)) throw new Error("Invalid persisted history");
    return g;
  }
  private settle(s: State) {
    if (
      s.status === "active" &&
      s.since !== null &&
      Date.now() - s.since >= s.remaining[s.moves.length % 2]
    ) {
      s.remaining[s.moves.length % 2] = 0;
      s.status = "finished";
      s.result =
        (s.moves.length % 2 === 0 ? "White" : "Black") + " wins on time";
      s.since = null;
      s.seq++;
      this.save(s);
      this.broadcast(s);
    }
  }
  private snapshot(s: State) {
    return {
      type: "snapshot",
      ...s,
      players: s.players.map((p) => ({ id: p.id, displayName: p.displayName })),
      ply: s.moves.length,
      sfen: this.game(s).record.sfen,
      serverNow: Date.now(),
    };
  }
  private broadcast(s: State) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Identity;
      if (a.expiresAt <= Date.now()) ws.close(4003, "Session expired");
      else ws.send(JSON.stringify(this.snapshot(s)));
    }
  }
  async fetch(r: Request) {
    const me = JSON.parse(
      r.headers.get("X-Identity") ?? "null",
    ) as Identity | null;
    if (!me) return reply({ error: "Unauthorized" }, 401);
    const path = new URL(r.url).pathname;
    let s = this.load();
    if (path === "/create" && r.method === "POST" && !s) {
      s = {
        id: r.headers.get("X-Room")!,
        players: [me],
        moves: [],
        moveIds: [],
        moveTimes: [],
        remaining: [this.duration(), this.duration()],
        since: null,
        status: "waiting",
        result: null,
        seq: 0,
      };
      this.save(s);
      return reply(this.snapshot(s));
    }
    if (!s) return reply({ error: "Room not found" }, 404);
    this.settle(s);
    if (
      path === "/join" &&
      r.method === "POST" &&
      !s.players.some((p) => p.id === me.id)
    ) {
      if (s.players.length === 2 || s.status !== "waiting")
        return reply({ error: "Room full" }, 409);
      s.players.push(me);
      s.status = "active";
      s.since = Date.now();
      s.seq++;
      this.save(s);
      this.broadcast(s);
    }
    if (!s.players.some((p) => p.id === me.id))
      return reply({ error: "Players only" }, 403);
    // Internal participant-only fair-play probe: no history replay or private data.
    if (path === "/status" && r.method === "GET") return reply({ status: s.status });
    if (path === "/resign" && r.method === "POST" && s.status === "active") {
      s.result =
        (s.players[0].id === me.id ? "White" : "Black") +
        " wins by resignation";
      s.status = "finished";
      s.since = null;
      s.seq++;
      this.save(s);
      this.broadcast(s);
    }
    if (path === "/ws" && r.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      for (const old of this.ctx.getWebSockets(me.id))
        old.close(4001, "Replaced by reconnect");
      this.ctx.acceptWebSocket(pair[1], [me.id]);
      pair[1].serializeAttachment({
        ...me,
        cookie: r.headers.get("Cookie") ?? "",
      });
      pair[1].send(JSON.stringify(this.snapshot(s)));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return reply(this.snapshot(s));
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const a = ws.deserializeAttachment() as Identity & { cookie: string };
      const me = await this.resolve(
        new Request(this.env.APP_ORIGIN, { headers: { Cookie: a.cookie } }),
      );
      if (!me || me.id !== a.id || me.expiresAt <= Date.now()) {
        ws.close(4003, "Session expired");
        return;
      }
      const s = this.load()!;
      this.settle(s);
      if (typeof message !== "string" || message.length > 1024)
        throw new Error("Invalid event");
      const b = JSON.parse(message) as {
        type: string;
        id: string;
        ply: number;
        usi: string;
      };
      if (
        message.toString().length > 1024 ||
        b.type !== "move" ||
        !/^[-a-zA-Z0-9]{8,80}$/.test(b.id)
      )
        throw new Error("Invalid event");
      const key = me.id + ":" + b.id;
      const prior = this.ctx.storage.sql
        .exec<{ usi: string }>("SELECT usi FROM events WHERE id=?", key)
        .toArray()[0];
      if (prior) {
        if (prior.usi !== b.usi) throw new Error("Request ID conflict");
        ws.send(JSON.stringify({ ...this.snapshot(s), ack: b.id }));
        return;
      }
      if (
        s.status !== "active" ||
        s.players[s.moves.length % 2]?.id !== me.id ||
        b.ply !== s.moves.length
      )
        throw new Error("Out of turn or stale move");
      const acceptedAt = Date.now();
      const g = this.game(s);
      if (typeof b.usi !== "string" || !isUSIMove(b.usi) || !g.play(b.usi))
        throw new Error("Illegal move");
      const side = s.moves.length % 2;
      s.remaining[side] -= acceptedAt - s.since!;
      s.moves.push(b.usi);
      s.moveIds.push(crypto.randomUUID());
      s.moveTimes.push(acceptedAt);
      s.seq++;
      s.since = Date.now();
      const outcome = g.outcome;
      if (outcome) {
        s.status = "finished";
        s.result = outcome.winner
          ? outcome.winner + " wins: " + outcome.reason
          : outcome.reason;
        s.since = null;
      }
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO events VALUES(?,?,?)",
          key,
          b.usi,
          s.moves.length,
        );
        this.save(s);
      });
      this.broadcast(s);
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Move rejected",
        }),
      );
    }
  }
  async alarm() {
    const s = this.load();
    if (s) {
      this.settle(s);
      if (s.status === "active") this.save(s);
      this.broadcast(s);
    }
  }
  webSocketClose(ws: WebSocket) {
    ws.close();
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011, "Connection error");
  }
}
