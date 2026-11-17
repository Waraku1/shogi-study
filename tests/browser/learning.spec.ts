import { test, expect } from "@playwright/test";
test("standalone keyboard quiz, subject preference and reviews persist; reset requires confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Learn", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Learning cards" });
  await expect(panel.getByTestId("learning-progress")).toHaveText(
    "0 cards reviewed · 0 due",
  );
  await panel.getByLabel("Learning subject").selectOption("Vocabulary");
  await expect(panel.getByTestId("learning-title")).toHaveText("abundant");
  await panel.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await panel
    .getByRole("button", { name: "Check answer", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Correct.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Remembered", exact: true }).click();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "1 cards reviewed",
  );
  await expect(panel.getByText("Remembered — due in 1 day.", {exact:true})).toBeVisible();
  await page.reload();
  await expect(panel.getByLabel("Learning subject")).toHaveValue("Vocabulary");
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "1 cards reviewed",
  );
  await panel.getByRole("button", { name: "Reset local progress" }).click();
  await panel.getByRole("button", { name: "Cancel reset" }).click();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "1 cards reviewed",
  );
  await panel.getByRole("button", { name: "Reset local progress" }).click();
  await panel.getByRole("button", { name: "Confirm reset" }).click();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "0 cards reviewed",
  );
  await expect(panel.getByLabel("Learning subject")).toHaveValue("Vocabulary");
  await panel.getByRole("button", { name: "Dismiss cards" }).click();
  await expect(page.getByRole("region", { name: "Study card" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Open cards" }).click();
  await expect(page.getByRole("region", { name: "Study card" })).toBeVisible();
});
test("IndexedDB denied: honest memory-only fallback and no false reload persistence", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    }),
  );
  await page.goto("/?learn=1");
  const panel = page.getByRole("complementary", { name: "Learning cards" });
  await expect(panel).toContainText("will not survive a reload");
  await panel.getByRole("button", { name: "Reveal answer" }).click();
  await panel
    .getByRole("button", { name: "Review again", exact: true })
    .click();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "1 cards reviewed",
  );
  await page.reload();
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "0 cards reviewed",
  );
});
test("corrupted IndexedDB record recovers, cards fit a 390px screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?learn=1");
  await expect(page.getByTestId("learning-title")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("shogi-study-learning", 1);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const t = r.result.transaction("profiles", "readwrite");
          t.objectStore("profiles").put({
            namespace: "guest-local",
            state: {
              version: 700,
              preferences: { enabled: true },
              reviews: { private: "corrupt" },
            },
          });
          t.oncomplete = () => {
            r.result.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  const panel = page.getByRole("complementary", { name: "Learning cards" });
  await expect(panel).toContainText("Invalid or outdated");
  await expect(panel.getByTestId("learning-progress")).toContainText(
    "0 cards reviewed",
  );
  await panel.getByRole("button", { name: "Reveal answer" }).click();
  await expect(panel.getByText("private", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
