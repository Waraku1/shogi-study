import { playStatus, registerRoom, registered } from "./play-status";
import { auth, configured, identity } from "./auth";
import type { Env, Resolver } from "./auth";
export { GameRoom } from "./room";
export const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  });
export async function handle(r: Request, e: Env, resolve: Resolver = identity) {
  try {
    const u = new URL(r.url);
    if (r.method !== "GET" || r.headers.get("Upgrade") === "websocket")
      if (r.headers.get("Origin") !== e.APP_ORIGIN)
        return reply({ error: "Origin rejected" }, 403);
    if (u.pathname.startsWith("/api/auth/")) {
      if (!configured(e))
        return reply(
          {
            error:
              "Google login blocked: configure credentials, secret and invitation allowlist",
          },
          503,
        );
      if (r.method === "POST" && u.pathname.endsWith("/sign-in/social")) {
        const b = (await r.clone().json()) as {
          callbackURL?: string;
          provider?: string;
        };
        if (
          b.provider !== "google" ||
          (b.callbackURL &&
            new URL(b.callbackURL, e.APP_ORIGIN).origin !== e.APP_ORIGIN)
        )
          return reply({ error: "Invalid login redirect" }, 400);
      }
      return auth(e).handler(r);
    }
    const me = await resolve(r, e);
    if (u.pathname === "/api/me")
      return me
        ? reply({ user: { id: me.id, displayName: me.displayName } })
        : reply({ error: "Sign in required" }, 401);
    if (!me) return reply({ error: "Sign in required" }, 401);
    if (u.pathname === "/api/play-status" && r.method === "GET")
      return reply({
        user: { id: me.id, displayName: me.displayName },
        activeRooms: await playStatus(e, me),
      });
    if (u.pathname === "/api/rooms" && r.method === "POST") {
      const id = crypto.randomUUID();
      await registerRoom(e, me, id);
      const stub = e.ROOMS.get(e.ROOMS.idFromName(id));
      const created = await stub.fetch(
        new Request("https://room/create", {
          method: "POST",
          headers: { "X-Identity": JSON.stringify(me), "X-Room": id },
        }),
      );
      await registered(e, me, id, created.ok);
      return created;
    }
    const match =
      /^\/api\/rooms\/([a-f0-9-]{36})\/(join|snapshot|ws|resign)$/.exec(
        u.pathname,
      );
    if (!match) return reply({ error: "Not found" }, 404);
    const headers = new Headers(r.headers);
    headers.set("X-Identity", JSON.stringify(me));
    headers.set("X-Room", match[1]);
    const joining = match[2] === "join" && r.method === "POST";
    if (joining) await registerRoom(e, me, match[1]);
    const response = await e.ROOMS.get(e.ROOMS.idFromName(match[1])).fetch(
      new Request("https://room/" + match[2], { method: r.method, headers }),
    );
    if (
      !joining &&
      ((match[2] === "snapshot" && response.ok) ||
        (match[2] === "ws" && response.status === 101))
    ) {
      // Backfill membership when an existing local room is resumed.
      await registerRoom(e, me, match[1]);
      await registered(e, me, match[1], true);
    }
    if (joining) await registered(e, me, match[1], response.ok);
    return response;
  } catch {
    return reply({ error: "Request rejected" }, 400);
  }
}
export default { fetch: (r: Request, e: Env) => handle(r, e) };
