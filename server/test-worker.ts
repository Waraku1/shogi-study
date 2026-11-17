// ONLY the separate local integration config loads this entry. Production has no fixture route/resolver.
import { handle, reply } from "./worker";
import { auth } from "./auth";
import { GameRoom } from "./room";
import type { Env, Resolver } from "./auth";
export const fixtureIdentity: Resolver = async (r, e) => {
  const token = /fixture=([a-f0-9-]+)/.exec(r.headers.get("Cookie") ?? "")?.[1];
  if (!token) return null;
  const v = await e.DB.prepare(
    "SELECT id,displayName,expiresAt FROM fixture_sessions WHERE token=?",
  )
    .bind(token)
    .first<{ id: string; displayName: string; expiresAt: number }>();
  return v && v.expiresAt > Date.now() ? v : null;
};
export class TestGameRoom extends GameRoom {
  protected resolve(r: Request) {
    return fixtureIdentity(r, this.env);
  }
  protected duration() {
    return 15000;
  }
}
export default {
  async fetch(r: Request, e: Env) {
    if (
      new URL(r.url).pathname === "/api/test/oauth-probe" &&
      r.method === "POST"
    ) {
      if (r.headers.get("Origin") !== e.APP_ORIGIN) return reply({}, 403);
      return auth({
        ...e,
        GOOGLE_CLIENT_ID: "local-test-only",
        GOOGLE_CLIENT_SECRET: "local-test-only",
        BETTER_AUTH_SECRET: "test-only-secret-32-characters-long",
        ALLOWED_EMAILS: "invited@example.invalid",
      }).handler(
        new Request(e.APP_ORIGIN + "/api/auth/sign-in/social", {
          method: "POST",
          headers: { Origin: e.APP_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "google",
            callbackURL: e.APP_ORIGIN + "/",
          }),
        }),
      );
    }
    if (new URL(r.url).pathname === "/api/test/login" && r.method === "POST") {
      if (r.headers.get("Origin") !== e.APP_ORIGIN)
        return reply({ error: "Origin rejected" }, 403);
      const b = (await r.json()) as { name: string };
      if (!["alice", "bob", "charlie"].includes(b.name))
        return reply({ error: "Unknown fixture" }, 400);
      await e.DB.exec(
        "CREATE TABLE IF NOT EXISTS fixture_sessions(token TEXT PRIMARY KEY,id TEXT,displayName TEXT,expiresAt INTEGER)",
      );
      const token = crypto.randomUUID();
      await e.DB.prepare("INSERT INTO fixture_sessions VALUES(?,?,?,?)")
        .bind(token, b.name, b.name, Date.now() + 3600000)
        .run();
      return new Response(JSON.stringify({ testOnly: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `fixture=${token}; Path=/; HttpOnly; SameSite=Strict`,
        },
      });
    }
    if (new URL(r.url).pathname === "/api/test/logout" && r.method === "POST") {
      if (r.headers.get("Origin") !== e.APP_ORIGIN) return reply({}, 403);
      const token = /fixture=([a-f0-9-]+)/.exec(
        r.headers.get("Cookie") ?? "",
      )?.[1];
      await e.DB.prepare("DELETE FROM fixture_sessions WHERE token=?")
        .bind(token ?? "")
        .run();
      return reply({ ok: true });
    }
    return handle(r, e, fixtureIdentity);
  },
};
