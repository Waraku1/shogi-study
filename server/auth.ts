import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  ALLOWED_EMAILS?: string;
}
export type Identity = { id: string; displayName: string; expiresAt: number };
export type Resolver = (request: Request, env: Env) => Promise<Identity | null>;
export const configured = (e: Env) =>
  !!(
    e.GOOGLE_CLIENT_ID &&
    e.GOOGLE_CLIENT_SECRET &&
    e.BETTER_AUTH_SECRET &&
    e.BETTER_AUTH_SECRET.length >= 32 &&
    e.ALLOWED_EMAILS
  );
export function auth(e: Env) {
  if (!configured(e))
    throw new Error(
      "Google login blocked: credentials/secret/allowlist are not configured",
    );
  return betterAuth({
    database: drizzleAdapter(drizzle(e.DB), { provider: "sqlite", schema }),
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.APP_ORIGIN,
    trustedOrigins: [e.APP_ORIGIN],
    session: { cookieCache: { enabled: false } },
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: e.GOOGLE_CLIENT_ID!,
        clientSecret: e.GOOGLE_CLIENT_SECRET!,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            if (
              !e
                .ALLOWED_EMAILS!.split(",")
                .map((s) => s.trim().toLowerCase())
                .includes(u.email.toLowerCase())
            )
              throw new Error("Registration is invitation only");
            return {
              data: { ...u, name: "Player-" + crypto.randomUUID().slice(0, 8) },
            };
          },
        },
      },
    },
  });
}
export const identity: Resolver = async (r, e) => {
  if (!configured(e)) return null;
  const s = await auth(e).api.getSession({ headers: r.headers });
  return s
    ? {
        id: s.user.id,
        displayName: s.user.name,
        expiresAt: s.session.expiresAt.getTime(),
      }
    : null;
};
