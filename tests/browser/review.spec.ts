import { test, expect } from "@playwright/test";
const record = {
  source: "shogi-study",
  version: 1,
  id: "import-record-001",
  mode: "local",
  moves: ["7g7f", "3c3d"],
  result: { status: "finished", text: "Practice complete" },
  savedAt: 1000,
};
test("autosaved practice survives navigation/reload, replay, real WASM variation and JSON roundtrip", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-square="7g"]').click();
  await page.locator('[data-square="7f"]').click();
  await page.locator('[data-square="3c"]').click();
  await page.locator('[data-square="3d"]').click();
  await page.getByRole("button", { name: "Save game", exact: true }).click();
  await expect(
    page.getByText("Game saved on this device.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Learn", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Learn", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".move-list li")).toHaveCount(2);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: /local · 2 plies/ }).click();
  await expect(
    page.getByRole("heading", { name: "Replay · ply 0 of 2" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next move", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Replay · ply 1 of 2" }),
  ).toBeVisible();
  await page.getByLabel("Jump to ply").fill("2");
  const final = await page.getByTestId("replay-sfen").textContent();
  await page
    .getByRole("button", { name: "Analyze saved position", exact: true })
    .click();
  await expect(page.locator(".review-candidates button")).toHaveCount(3, {
    timeout: 20000,
  });
  await page.locator(".review-candidates button").first().click();
  await expect(
    page.getByRole("heading", { name: "Variation preview · 1 plies" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to saved position" }).click();
  expect(await page.getByTestId("replay-sfen").textContent()).toBe(final);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/shogi-.*\.json/);
  const json = await page.getByLabel("Game JSON", { exact: true }).inputValue();
  expect(JSON.parse(json).moves).toEqual(["7g7f", "3c3d"]);
  await page.reload();
  await page.getByRole("button", { name: /local · 2 plies/ }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  expect(await page.getByTestId("replay-sfen").textContent()).toBe(final);
  await page.getByLabel("Game JSON", { exact: true }).fill(json);
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Imported valid" }),
  ).toBeVisible();
});
test("JSON rejects malformed/oversized input; read-only replay and manifest fit 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?review=1");
  await page.getByLabel("Game JSON", { exact: true }).fill("not json");
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Malformed JSON");
  await page
    .getByLabel("Game JSON", { exact: true })
    .fill(JSON.stringify({ ...record, moves: ["7g7e"] }));
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Illegal");
  await page.getByLabel("Import JSON file").setInputFiles({
    name: "large.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(65537, 32),
  });
  await expect(page.getByRole("alert")).toContainText("exceeds");
  await page
    .getByLabel("Game JSON", { exact: true })
    .fill(JSON.stringify(record));
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await expect(page.getByTestId("replay-sfen")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await page.request.get("/manifest.webmanifest")).ok()).toBe(true);
  expect((await page.request.get("/icon.svg")).ok()).toBe(true);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((r) => r.length),
    ),
  ).toBe(0);
  await page.getByRole("button", { name: /^Delete saved game/ }).click();
  await page.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(
    page.getByRole("button", { name: /^Delete saved game/ }),
  ).toBeFocused();
  await page.getByRole("button", { name: /^Delete saved game/ }).click();
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(
    page.getByText("No games saved for this profile."),
  ).toBeVisible();
});
test("archive memory fallback is honest and a missing engine never prevents replay", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    }),
  );
  await page.route("**/engine/stockfish.wasm", (r) => r.abort());
  await page.goto("/?review=1");
  await expect(
    page.getByRole("status").filter({ hasText: "Archive storage unavailable" }),
  ).toBeVisible();
  await page
    .getByLabel("Game JSON", { exact: true })
    .fill(JSON.stringify(record));
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await page
    .getByRole("button", { name: "Analyze saved position", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Replay · ply 1 of 2" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("No games saved for this profile."),
  ).toBeVisible();
});

test("promotion choice returns keyboard focus to the board", async ({
  page,
}) => {
  await page.goto("/");
  for (const [from, to] of [
    ["7g", "7f"],
    ["3c", "3d"],
    ["8h", "2b"],
  ]) {
    await page.locator(`[data-square="${from}"]`).click();
    await page.locator(`[data-square="${to}"]`).click();
  }
  await expect(
    page.getByRole("button", { name: "Promote", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Promote", exact: true }).click();
  await expect(page.locator('[data-square="2b"]')).toBeFocused();
  await expect(page.locator('[data-square="2b"]')).toHaveAttribute(
    "aria-label",
    /Black Horse/,
  );
});
