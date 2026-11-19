import { test, expect } from '@playwright/test';

test('Chromium renderer freeze/resume preserves board, learning and saved research', async ({ page }) => {
  await page.goto('/');
  for (const [from, to] of [['7g', '7f'], ['3c', '3d']]) {
    await page.locator(`[data-square="${from}"]`).click();
    await page.locator(`[data-square="${to}"]`).click();
  }
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  const sfen = await page.getByTestId('sfen').textContent();
  const card = await page.getByTestId('learning-title').textContent();
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  async function freezeResume() {
    // Actual renderer lifecycle suspension. This is not physical OS backgrounding.
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  }
  await freezeResume();
  expect(await page.getByTestId('sfen').textContent()).toBe(sfen);
  await expect(page.getByTestId('learning-title')).toHaveText(card!);
  await expect(page.getByRole('button', { name: 'Remembered', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: /local · 2 plies/ }).click();
  await page.getByRole('button', { name: 'Start study variation', exact: true }).click();
  await page.locator('[data-square="2g"]').click();
  await page.locator('[data-square="2f"]').click();
  await page.getByLabel('Study name').fill('Restored study');
  await page.getByRole('button', { name: 'Save study variation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Study variation saved on this device.' })).toBeVisible();
  const branch = await page.getByTestId('replay-sfen').textContent();
  await freezeResume();
  expect(await page.getByTestId('replay-sfen').textContent()).toBe(branch);
  await page.reload();
  await page.getByRole('button', { name: 'Restored study · 1 branch plies', exact: true }).click();
  expect(await page.getByTestId('replay-sfen').textContent()).toBe(branch);
});
