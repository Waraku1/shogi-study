import { test, expect } from "@playwright/test";
test("authoritative fair-play guard survives fresh views; clocks/learning continue; finished archives are private", async ({
  browser,
}) => {
  const a = await browser.newContext(),
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
  const id = new URL(pa.url()).searchParams.get("room")!;
  await b.request.post(origin + `/api/rooms/${id}/join`, {
    headers: { Origin: origin },
  });
  await pb.goto("/?room=" + id);
  await expect(pb.getByTestId("connection")).toHaveText("Connected");
  expect(
    (await (await a.request.get(origin + "/api/play-status")).json())
      .activeRooms,
  ).toContain(id);
  await expect(
    pa.getByRole("button", { name: "Review", exact: true }),
  ).toBeDisabled();
  await pb.getByRole("checkbox", { name: "Enable Quick Learn" }).check();
  await expect(pb.getByRole("region", { name: "Study card" })).toBeVisible();
  const before = await pa.getByTestId("clocks").textContent();
  await pa.getByRole("button", { name: "Learn", exact: true }).click();
  await expect(
    pa.getByRole("heading", { name: "Learn", exact: true }),
  ).toBeVisible();
  await pa.waitForTimeout(1100);
  expect(await pa.getByTestId("clocks").textContent()).not.toBe(before);
  await pa.getByRole("button", { name: "Play", exact: true }).click();
  await pa.locator('[data-square="7g"]').click();
  await pa.locator('[data-square="7f"]').click();
  await expect(pb.getByTestId("online-record").locator("li")).toHaveCount(1);
  await expect(pb.getByRole("region", { name: "Study card" })).toHaveCount(0);
  await pa.evaluate(() => localStorage.clear());
  await pa.goto("/?review=1");
  await expect(
    pa.getByRole("heading", { name: "Review paused" }),
  ).toBeVisible();
  await expect(
    pa.getByRole("button", { name: "Import JSON", exact: true }),
  ).toHaveCount(0);
  await expect(
    pa.getByRole("button", { name: "Analyze saved position" }),
  ).toHaveCount(0);
  await pa.goto("/");
  await expect(
    pa.getByRole("button", { name: "Analyze position", exact: true }),
  ).toHaveCount(0);
  await pa
    .getByRole("button", { name: "Resume online room", exact: true })
    .click();
  await expect(pa.getByTestId("connection")).toHaveText("Connected");
  await pa.getByRole("button", { name: "Learn", exact: true }).click();
  await a.request.post(origin + `/api/rooms/${id}/resign`, {
    headers: { Origin: origin },
  });
  await expect(
    pa.getByRole("button", { name: "Review", exact: true }),
  ).toBeEnabled();
  await pa.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    pa.getByRole("button", { name: /online · 1 plies/ }),
  ).toBeVisible();
  await pa.getByRole("button", { name: /online · 1 plies/ }).click();
  await expect(pa.getByTestId("replay-sfen")).toBeVisible();
  await login(a, "charlie");
  await pa.reload();
  await expect(pa.getByText("No games saved for this profile.")).toBeVisible();
  await login(a, "alice");
  await pa.reload();
  await expect(
    pa.getByRole("button", { name: /online · 1 plies/ }),
  ).toBeVisible();
  await a.close();
  await b.close();
});
