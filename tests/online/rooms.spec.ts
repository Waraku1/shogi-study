import { test, expect } from "@playwright/test";
test("real Worker/D1/SQLite DO: two contexts, authoritative moves, retries, reconnect, privacy, resignation and timeout", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  const origin = "http://localhost:5173";
  expect(
    (
      await a.request.post("http://localhost:8788/api/test/login", {
        headers: { Origin: origin },
        data: { name: "alice" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await a.request.post("http://localhost:8788/api/auth/sign-in/social", {
        headers: { Origin: origin },
        data: { provider: "google" },
      })
    ).status(),
  ).toBe(503);
  const probe = await a.request.post(origin + "/api/test/oauth-probe", {
    headers: { Origin: origin },
  });
  expect(probe.status()).toBe(200);
  expect((await probe.json()).url).toContain("accounts.google.com");
  const login = async (ctx: typeof a, name: string) =>
    expect(
      (
        await ctx.request.post(origin + "/api/test/login", {
          headers: { Origin: origin },
          data: { name },
        })
      ).ok(),
    ).toBe(true);
  await login(a, "alice");
  await login(b, "bob");
  await login(c, "charlie");
  const pa = await a.newPage(),
    pb = await b.newPage();
  await pa.goto("/?room=");
  await pb.goto("/?room=");
  await expect(pa.getByText("Signed in as alice")).toBeVisible();
  await pa.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    pa.getByText("Waiting for opponent", { exact: true }),
  ).toBeVisible();
  const url = await pa.getByRole("link").getAttribute("href");
  const id = new URLSearchParams(url!.slice(1)).get("room")!;
  await pb.getByLabel("Invite code").fill(id);
  await pb.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(pa.getByTestId("connection")).toHaveText("Connected");
  await expect(pb.getByTestId("connection")).toHaveText("Connected");
  const third = await c.request.post(origin + `/api/rooms/${id}/join`, {
    headers: { Origin: origin },
  });
  expect(third.status()).toBe(409);
  expect(
    (await a.request.get(origin + `/api/rooms/${id}/snapshot`)).status(),
  ).toBe(200);
  const before = await pa.getByTestId("online-sfen").textContent();
  const ws = async (page: typeof pa, events: unknown[]) =>
    page.evaluate(
      async ({ id, events }) => {
        return await new Promise<unknown[]>((resolve) => {
          const s = new WebSocket(`ws://${location.host}/api/rooms/${id}/ws`);
          const answers: unknown[] = [];
          let index = 0;
          s.onmessage = (e) => {
            const v = JSON.parse(e.data);
            answers.push(v);
            if (index < events.length) s.send(JSON.stringify(events[index++]));
            else {
              resolve(answers);
              s.close();
            }
          };
        });
      },
      { id, events },
    );
  const bad = await ws(pb, [
    { type: "move", id: "bad-turn-001", ply: 0, usi: "3c3d" },
  ]);
  expect(JSON.stringify(bad)).toContain("Out of turn");
  const spoof = await ws(pb, [
    {
      type: "move",
      id: "spoof-turn-001",
      ply: 0,
      usi: "7g7f",
      userId: "alice",
      side: "black",
    },
  ]);
  expect(JSON.stringify(spoof)).toContain("Out of turn");
  const illegal = await ws(pa, [
    { type: "move", id: "bad-move-001", ply: 0, usi: "7g7e" },
  ]);
  expect(JSON.stringify(illegal)).toContain("Illegal move");
  const event = { type: "move", id: "opening-retry-001", ply: 0, usi: "7g7f" };
  const moved = await ws(pa, [event, event]);
  expect(JSON.stringify(moved)).toContain("opening-retry-001");
  const snapshot = await (
    await a.request.get(origin + `/api/rooms/${id}/snapshot`)
  ).json();
  expect(snapshot.moves).toEqual(["7g7f"]);
  expect(snapshot.moveIds).toHaveLength(1);
  expect(snapshot.moveIds[0]).toMatch(/^[a-f0-9-]{36}$/);
  expect(snapshot.sfen).not.toBe(before);
  expect(JSON.stringify(snapshot)).not.toMatch(/email|cookie|expiresAt/);
  await pa.reload();
  await expect(pa.getByTestId("online-sfen")).toHaveText(snapshot.sfen);
  await expect(
    pa.getByRole("button", { name: "Analyze position" }),
  ).toHaveCount(0);
  await pb.reload();
  await expect(pb.getByTestId("connection")).toHaveText("Connected");
  await pb.locator('[data-square="3c"]').click();
  await pb.locator('[data-square="3d"]').click();
  await expect(pa.getByTestId("online-record").locator("li")).toHaveCount(2);
  await pa.getByRole("button", { name: "Resign online game" }).click();
  await expect(
    pb.getByRole("heading", { name: "White wins by resignation" }),
  ).toBeVisible();
  const fresh = await (
    await a.request.post(origin + "/api/rooms", { headers: { Origin: origin } })
  ).json();
  await b.request.post(origin + `/api/rooms/${fresh.id}/join`, {
    headers: { Origin: origin },
  });
  await new Promise((r) => setTimeout(r, 15500));
  const timed = await (
    await a.request.get(origin + `/api/rooms/${fresh.id}/snapshot`)
  ).json();
  expect(timed.result).toBe("White wins on time");
  const blocked = await a.request.post(origin + "/api/auth/sign-in/social", {
    headers: { Origin: origin },
    data: { provider: "google" },
  });
  expect(blocked.status()).toBe(503);
  const csrf = await a.request.post(origin + "/api/rooms", {
    headers: { Origin: "https://evil.invalid" },
  });
  expect(csrf.status()).toBe(403);
  const stale = await ws(pb, [
    { type: "move", id: "stale-ply-001", ply: 0, usi: "3c3d" },
  ]);
  expect(JSON.stringify(stale)).toContain("Out of turn");
  const closed = await pa.evaluate(
    async (id) =>
      await new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/api/rooms/${id}/ws`);
        ws.onmessage = async () => {
          ws.onmessage = null;
          await fetch("/api/test/logout", { method: "POST" });
          ws.onclose = (e) => resolve(e.code);
          ws.send(
            JSON.stringify({
              type: "move",
              id: "revoked-session-001",
              ply: 2,
              usi: "2g2f",
            }),
          );
        };
      }),
    id,
  );
  expect(closed).toBe(4003);
  await a.request.post(origin + "/api/test/logout", {
    headers: { Origin: origin },
  });
  expect(
    (await a.request.get(origin + `/api/rooms/${id}/snapshot`)).status(),
  ).toBe(401);
  await a.close();
  await b.close();
  await c.close();
});
