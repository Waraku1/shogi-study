import { test, expect } from "@playwright/test";
test("active game on another device: new authenticated browser with unreachable/invalid status fails closed", async ({browser}) => {
  const origin = "http://localhost:5173";
  const a = await browser.newContext(), b = await browser.newContext(), fresh = await browser.newContext();
  for (const [ctx, name] of [[a, "alice"], [b, "bob"], [fresh, "alice"]] as const)
    expect((await ctx.request.post(origin + "/api/test/login", {headers: {Origin: origin}, data: {name}})).ok()).toBe(true);
  const room = await (await a.request.post(origin + "/api/rooms", {headers: {Origin: origin}})).json();
  expect((await b.request.post(origin + `/api/rooms/${room.id}/join`, {headers: {Origin: origin}})).ok()).toBe(true);
  const page = await fresh.newPage();
  for (const failure of ["network", "http", "invalid"] as const) {
    await page.route("**/api/play-status", r => failure === "network" ? r.abort() : r.fulfill({status: failure === "http" ? 503 : 200, body: failure === "http" ? "Unavailable" : '{"user":{},"activeRooms":[]}'}));
    await page.goto("/?review=1");
    expect(await page.evaluate(() => localStorage.getItem("shogi-study-live-match"))).toBeNull();
    await expect(page.getByRole("heading", {name: "Review paused"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Import JSON", exact: true})).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByRole("status").filter({hasText: "Cannot confirm online status"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Analyze position", exact: true})).toHaveCount(0);
    await page.unroute("**/api/play-status");
  }
  await page.getByRole("button", {name: "Retry online status"}).click();
  await expect(page.getByRole("button", {name: "Review", exact: true})).toBeDisabled();
  expect((await (await fresh.request.get(origin + "/api/play-status")).json()).activeRooms).toContain(room.id);
  await a.request.post(origin + `/api/rooms/${room.id}/resign`, {headers: {Origin: origin}});
  await page.getByRole("button", {name: "Retry online status"}).click();
  await expect(page.getByRole("button", {name: "Review", exact: true})).toBeEnabled();
  await a.close(); await b.close(); await fresh.close();
});
test("real unauthenticated guest path and status endpoint privacy/origin/session recovery", async ({browser}) => {
  const origin = "http://localhost:5173", ctx = await browser.newContext();
  expect((await ctx.request.get(origin + "/api/play-status")).status()).toBe(401);
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("button", {name: "Analyze position", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Analyze position", exact: true}).click();
  await expect(page.locator(".candidates button")).toHaveCount(3, {timeout: 20000});
  await ctx.request.post(origin + "/api/test/login", {headers: {Origin: origin}, data: {name: "charlie"}});
  expect((await ctx.request.post(origin + "/api/rooms", {headers: {Origin: "https://evil.invalid"}})).status()).toBe(403);
  expect((await ctx.request.post(origin + "/api/play-status", {headers: {Origin: "https://evil.invalid"}})).status()).toBe(403);
  const status = await ctx.request.get(origin + "/api/play-status");
  expect(status.headers()["cache-control"]).toBe("no-store");
  expect(await status.text()).not.toMatch(/email|token|cookie|expiresAt/);
  expect((await ctx.request.post(origin + "/api/test/expire", {headers: {Origin: "https://evil.invalid"}})).status()).toBe(403);
  await ctx.request.post(origin + "/api/test/expire", {headers: {Origin: origin}});
  expect((await ctx.request.get(origin + "/api/play-status")).status()).toBe(401);
  await ctx.request.post(origin + "/api/test/logout", {headers: {Origin: origin}});
  expect((await ctx.request.get(origin + "/api/play-status")).status()).toBe(401);
  await ctx.close();
});
