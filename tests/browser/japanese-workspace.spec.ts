import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const original = {
  source: 'shogi-study',
  version: 1,
  id: 'research-original-001',
  mode: 'local',
  moves: ['7g7f', '3c3d', '8h2b+', '3a2b', 'B*4e', 'B*8h'],
  result: { status: 'finished', text: 'White wins by resignation' },
  savedAt: 1234,
};
async function importOriginal(page: import('@playwright/test').Page) {
  await page.goto('/?review=1');
  await page
    .getByLabel('Game JSON', { exact: true })
    .fill(JSON.stringify(original));
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Replay · ply 0 of 6' }),
  ).toBeVisible();
}
test('kanji pieces share wood and ink; White rotates physically; promotions and font load are accessible', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() =>
    document.fonts.load(
      '600 28px "Shogi Study Mincho"',
      '歩香桂銀金角飛玉王と杏圭全馬龍',
    ),
  );
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (f) => f.family === 'Shogi Study Mincho' && f.status === 'loaded',
      ),
    ),
  ).toBe(true);
  await expect(page.locator('[data-square="7g"] .piece')).toHaveText('歩');
  await expect(page.locator('[data-square="7c"] .piece')).toHaveText('歩');
  await expect(page.locator('[data-square="5i"] .piece')).toHaveText('玉');
  await expect(page.locator('[data-square="5a"] .piece')).toHaveText('王');
  const styles = await page.evaluate(() => {
    const a = getComputedStyle(
      document.querySelector('[data-square="7g"] .piece')!,
    );
    const b = getComputedStyle(
      document.querySelector('[data-square="7c"] .piece')!,
    );
    return {
      a: {
        background: a.backgroundImage,
        color: a.color,
        transform: a.transform,
      },
      b: {
        background: b.backgroundImage,
        color: b.color,
        transform: b.transform,
      },
      whiteLetter: getComputedStyle(
        document.querySelector('[data-square="7c"] .piece span')!,
      ).transform,
    };
  });
  expect(styles.a.background).toBe(styles.b.background);
  expect(styles.a.color).toBe(styles.b.color);
  expect(styles.a.transform).toBe('none');
  expect(styles.b.transform).toBe('matrix(-1, 0, 0, -1, 0, 0)');
  expect(styles.whiteLetter).toBe('none');
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  expect(
    await page
      .locator('.board-help')
      .evaluate((e) => getComputedStyle(e).color),
  ).toBe('rgb(82, 97, 75)');
  await page.locator('[data-square="7g"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.locator('[data-square="3c"]').click();
  await page.locator('[data-square="3d"]').click();
  await page.locator('[data-square="8h"]').click();
  await page.locator('[data-square="2b"]').click();
  await expect(
    page.getByRole('button', { name: 'Promote', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(page.locator('[data-square="2b"]')).toBeFocused();
  await expect(page.locator('[data-square="2b"] .piece')).toHaveText('馬');
  expect(
    await page
      .locator('[data-square="2b"] .piece')
      .evaluate((e) => getComputedStyle(e).color),
  ).toBe('rgb(163, 35, 24)');
  await expect(
    page.getByRole('button', {
      name: 'Drop Black Bishop, 1 in hand',
      exact: true,
    }),
  ).toContainText('角');
});
test('loaded guest board and learning operate simultaneously and retain card/game state across panels at desktop and 390px', async ({
  page,
}) => {
  mkdirSync('work/japanese', { recursive: true });
  await page.goto('/');
  await page.locator('[data-square="7g"]').click();
  await page.locator('[data-square="7f"]').click();
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(
    page.getByRole('grid', { name: 'Shogi board, 9 by 9' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Study card' })).toBeVisible();
  const title = await page.getByTestId('learning-title').textContent();
  await page
    .getByRole('button', { name: 'Reveal answer', exact: true })
    .click();
  await page.getByRole('button', { name: 'Remembered', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Remembered — due in 1 day.' }),
  ).toBeVisible();
  await page.locator('[data-square="3c"]').click();
  await page.locator('[data-square="3d"]').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.move-list li')).toHaveCount(2);
  const sfen = await page.getByTestId('sfen').textContent();
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.getByTestId('learning-title')).toHaveText(title!);
  await expect(
    page.getByRole('button', { name: 'Remembered', exact: true }),
  ).toBeDisabled();
  expect(await page.getByTestId('sfen').textContent()).toBe(sfen);
  await page.screenshot({
    path: 'work/japanese/desktop-workspace.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByText('Learning cards beside the board', { exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Study card' })).toBeHidden();
  await page.getByRole('grid').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'work/japanese/mobile-workspace.png',
    fullPage: true,
  });
  await expect(page.getByRole('grid')).toBeVisible();
});
test('font fallback keeps Japanese pieces and legal play usable without external font requests', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (/fonts\.googleapis|fonts\.gstatic/.test(r.url()))
      external.push(r.url());
  });
  await page.route('**/fonts/*.ttf', (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('[data-square="7g"] .piece')).toHaveText('歩');
  expect(
    await page
      .locator('[data-square="7g"] .piece')
      .evaluate((e) => getComputedStyle(e).fontFamily),
  ).toContain('Yu Mincho');
  await page.locator('[data-square="7g"]').click();
  await page.locator('[data-square="7f"]').click();
  await expect(
    page.getByRole('heading', { name: 'White to move', exact: true }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect((await page.request.get('/fonts/OFL.txt')).ok()).toBe(true);
});
test('KIF and CSA file exports reimport into the exact legal main line and final position', async ({
  page,
}) => {
  await importOriginal(page);
  await page.getByRole('button', { name: 'End', exact: true }).click();
  const end = await page.getByTestId('replay-sfen').textContent();
  for (const format of ['KIF', 'CSA']) {
    const event = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export selected ' + format, exact: true })
      .click();
    const downloaded = await event,
      path = await downloaded.path();
    const text = readFileSync(path!, 'utf8');
    expect(text).toContain(format === 'KIF' ? '投了' : '%TORYO');
    await page.getByLabel('Record format').selectOption(format.toLowerCase());
    await page.getByLabel('Game record text', { exact: true }).fill(text);
    await page
      .getByRole('button', { name: 'Import ' + format, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Replay · ply 0 of 6' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'End', exact: true }).click();
    expect(await page.getByTestId('replay-sfen').textContent()).toBe(end);
  }
});
test('historical research cancels stale searches; alternative lines persist independently and preserve original archives', async ({
  page,
}) => {
  await importOriginal(page);
  await page.getByLabel('Jump to ply').fill('2');
  const anchor = await page.getByTestId('replay-sfen').textContent();
  await page
    .getByRole('button', { name: 'Analyze saved position', exact: true })
    .click();
  await page.getByRole('button', { name: 'Beginning', exact: true }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('.review-candidates button')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Replay · ply 0 of 6' }),
  ).toBeVisible();
  await page.getByLabel('Jump to ply').fill('2');
  await page
    .getByRole('button', { name: 'Start study variation', exact: true })
    .click();
  await page.locator('[data-square="2g"]').click();
  await page.locator('[data-square="2f"]').click();
  await page.locator('[data-square="8c"]').click();
  await page.locator('[data-square="8d"]').click();
  await page.getByLabel('Study name').fill('Rook-pawn plan');
  const branch = await page.getByTestId('replay-sfen').textContent();
  await page
    .getByRole('button', { name: 'Analyze saved position', exact: true })
    .click();
  await expect(page.locator('.review-candidates button')).toHaveCount(3, {
    timeout: 20000,
  });
  await expect(page.getByTestId('review-pv')).toContainText(/[▲△]/);
  const fileHeader = await page.locator('.files').boundingBox();
  const boardWithRanks = await page.locator('.board-with-ranks').boundingBox();
  expect(fileHeader?.width).toBe(boardWithRanks?.width);
  mkdirSync('work/japanese', { recursive: true });
  await page
    .locator('section[aria-label="Game replay"]')
    .screenshot({ path: 'work/japanese/historical-study.png' });
  await page
    .getByRole('button', { name: 'Save study variation', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Study variation saved on this device.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Export selected JSON', exact: true })
    .click();
  expect(
    JSON.parse(
      await page.getByLabel('Game JSON', { exact: true }).inputValue(),
    ),
  ).toEqual(original);
  await page
    .getByRole('button', { name: 'Return to original game', exact: true })
    .click();
  expect(await page.getByTestId('replay-sfen').textContent()).toBe(anchor);
  await page
    .getByRole('button', { name: 'Resume draft variation', exact: true })
    .click();
  expect(await page.getByTestId('replay-sfen').textContent()).toBe(branch);
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  expect(await page.getByTestId('replay-sfen').textContent()).toBe(branch);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  expect(await page.getByTestId('replay-sfen').textContent()).toBe(branch);
  await page.reload();
  await page
    .getByRole('button', {
      name: 'Rook-pawn plan · 2 branch plies',
      exact: true,
    })
    .click();
  expect(await page.getByTestId('replay-sfen').textContent()).toBe(branch);
  await page
    .getByRole('button', { name: 'Return to original game', exact: true })
    .click();
  await expect(
    page.getByLabel('Original move sequence').getByRole('button'),
  ).toHaveCount(6);
  await page
    .getByRole('button', { name: 'Export selected JSON', exact: true })
    .click();
  expect(
    JSON.parse(await page.getByLabel('Game JSON', { exact: true }).inputValue())
      .moves,
  ).toEqual(original.moves);
});
