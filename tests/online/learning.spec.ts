import { test, expect } from "@playwright/test";
test("Quick Learn is optional, scoped to accounts and waiting turns; clocks and WS play keep working", async ({
  browser,
}) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    b = await browser.newContext();
  const origin = "http://localhost:5173";
  const login = async (ctx: typeof a, name: string) => {
    expect(
      (
        await ctx.request.post(origin + "/api/test/login", {
          headers: { Origin: origin },
          data: { name },
        })
      ).ok(),
    ).toBe(true);
  };
  await login(a, "alice");
  await login(b, "bob");
  const pa = await a.newPage(),
    pb = await b.newPage();
  await pa.goto("/?room=");
  await pa.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(pa.getByTestId("connection")).toHaveText("Connected");
  const panel = pa.getByRole("complementary", { name: "Quick Learn" });
  const cards = panel.getByRole("region", { name: "Study card" });
  await expect(
    panel.getByRole("checkbox", { name: "Enable Quick Learn" }),
  ).not.toBeChecked();
  await expect(cards).toHaveCount(0);
  await panel.getByRole("checkbox").check();
  await expect(cards).toBeVisible();
  await panel.getByLabel("Learning subject").selectOption("Vocabulary");
  await panel.getByRole("button", { name: "Reveal answer" }).click();
  await panel.getByRole("button", { name: "Remembered", exact: true }).click();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "1 cards reviewed",
  );
  await panel.getByRole("button", { name: "Dismiss cards" }).click();
  await expect(cards).toHaveCount(0);
  await panel.getByRole("button", { name: "Open cards" }).click();
  await panel.getByRole("checkbox").uncheck();
  await pageReload();
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(cards).toHaveCount(0);
  await panel.getByRole("checkbox").check();
  await pageReload();
  await expect(cards).toBeVisible();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "1 cards reviewed",
  );
  const id = new URL(pa.url()).searchParams.get("room")!;
  expect(
    (
      await b.request.post(origin + `/api/rooms/${id}/join`, {
        headers: { Origin: origin },
      })
    ).ok(),
  ).toBe(true);
  await pb.goto("/?room=" + id);
  await expect(pb.getByTestId("connection")).toHaveText("Connected");
  await expect(cards).toHaveCount(0);
  const bp = pb.getByRole("complementary", { name: "Quick Learn" });
  await bp.getByRole("checkbox").check();
  await expect(bp.getByRole("region", { name: "Study card" })).toBeVisible();
  const clock = await pa.getByTestId("clocks").textContent();
  await pa.waitForTimeout(1100);
  expect(await pa.getByTestId("clocks").textContent()).not.toBe(clock);
  await bp.getByRole("button", { name: "Reveal answer" }).click();
  await pa.locator('[data-square="7g"]').click();
  await pa.locator('[data-square="7f"]').click();
  await expect(pb.getByTestId("online-record").locator("li")).toHaveCount(1);
  await expect(bp.getByRole("region", { name: "Study card" })).toHaveCount(0);
  await expect(cards).toBeVisible();
  // A second socket replaces the UI socket; study must collapse while disconnected.
  await pa.evaluate(
    (id) =>
      new Promise<void>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/api/rooms/${id}/ws`);
        ws.onmessage = () => {
          ws.close();
          resolve();
        };
      }),
    id,
  );
  await expect(pa.getByTestId("connection")).toHaveText("Disconnected");
  await expect(cards).toHaveCount(0);
  await pa.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(pa.getByTestId("connection")).toHaveText("Connected");
  await expect(cards).toBeVisible();
  expect(
    await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await pb.locator('[data-square="3c"]').click();
  await pb.locator('[data-square="3d"]').click();
  await expect(pa.getByTestId("online-record").locator("li")).toHaveCount(2);
  await expect(cards).toHaveCount(0);
  await login(a, "bob");
  await pa.reload();
  await expect(pa.getByText("Signed in as bob", { exact: true })).toBeVisible();
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "0 cards reviewed",
  );
  await login(a, "alice");
  await pa.reload();
  await expect(
    pa.getByText("Signed in as alice", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("checkbox")).toBeChecked();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "1 cards reviewed",
  );
  await pa.goto("/?learn=1");
  await expect(pa.getByTestId("learning-progress")).toContainText(
    "0 cards reviewed",
  );
  await pa.goto("/?room=" + id);
  await expect(pa.getByTestId("connection")).toHaveText("Connected");
  await pa.getByRole("button", { name: "Resign online game" }).click();
  await expect(
    pa.getByRole("heading", { name: "White wins by resignation" }),
  ).toBeVisible();
  await expect(cards).toHaveCount(0);
  await expect(
    pa.getByRole("button", { name: "Analyze position" }),
  ).toHaveCount(0);
  await a.close();
  await b.close();
  async function pageReload() {
    await expect(panel.getByRole("checkbox")).toBeEnabled();
    await expect(panel.getByText("Saving learning changes…", {exact:true})).toHaveCount(0);
    await pa.reload();
    await expect(pa.getByTestId("connection")).toHaveText("Connected");
  }
});
