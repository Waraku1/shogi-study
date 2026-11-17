import { test, expect } from "@playwright/test";
test("explicit guest-only origin stays usable offline and exposes no online API or room entry", async ({page}) => {
  let statusRequests = 0;
  await page.route("**/api/play-status", r => { statusRequests++; return r.abort(); });
  await page.goto("/?room=not-an-offline-bypass");
  await expect(page.getByRole("button", {name: "Online rooms", exact: true})).toHaveCount(0);
  await expect(page.getByRole("status").filter({hasText: "Guest-local only"})).toBeVisible();
  await page.locator('[data-square="7g"]').click();
  await page.locator('[data-square="7f"]').click();
  await expect(page.getByText("Game saved on this device.", {exact: true})).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole("button", {name: "Review", exact: true}).click();
  await expect(page.getByRole("button", {name: /local · 1 plies/})).toBeVisible();
  expect(statusRequests).toBe(0);
  await page.context().setOffline(false);
  expect((await page.request.post("/api/rooms")).status()).toBe(404);
  expect((await page.request.get("/api/me")).status()).toBe(404);
});
