// LOCAL PROFILING ONLY. Never used by the app, production config or CI server.
import fixture from "./test-worker";
import type { Env } from "./auth";
export { TestGameRoom } from "./test-worker";
export default {
  async fetch(r: Request, e: Env) {
    let rooms = 0, statements = 0;
    const env = { ...e,
      DB: new Proxy(e.DB, { get(target, key) {
        if (key === "prepare") return (sql: string) => { statements++; return target.prepare(sql); };
        const v = Reflect.get(target, key); return typeof v === "function" ? v.bind(target) : v;
      } }),
      ROOMS: new Proxy(e.ROOMS, { get(target, key) {
        if (key === "get") return (id: DurableObjectId) => {
          const stub = target.get(id);
          return new Proxy(stub, { get(s, k) {
            if (k === "fetch") return (...args: Parameters<typeof s.fetch>) => { rooms++; return s.fetch(...args); };
            const v = Reflect.get(s, k); return typeof v === "function" ? v.bind(s) : v;
          } });
        };
        const v = Reflect.get(target, key); return typeof v === "function" ? v.bind(target) : v;
      } }),
    };
    const response = await fixture.fetch(r, env);
    const result = new Response(response.body, {status: response.status,
      headers: response.headers, webSocket: response.webSocket});
    // Test-only counters; no cookie, token, email or other private data in output.
    result.headers.set("X-Local-Room-Requests", String(rooms));
    result.headers.set("X-Local-D1-Statements", String(statements));
    return result;
  },
};
