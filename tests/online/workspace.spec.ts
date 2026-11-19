import { test, expect } from '@playwright/test';
test('online board, clocks, Japanese history and optional learning stay synchronized; research remains blocked until finish', async ({
  browser,
}) => {
  const origin = 'http://localhost:5173';
  const a = await browser.newContext(),
    b = await browser.newContext();
  for (const [ctx, name] of [
    [a, 'alice'],
    [b, 'bob'],
  ] as const)
    expect(
      (
        await ctx.request.post(origin + '/api/test/login', {
          headers: { Origin: origin },
          data: { name },
        })
      ).ok(),
    ).toBe(true);
  const pa = await a.newPage(),
    pb = await b.newPage();
  await pa.goto('/?room=');
  await pa.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(pa.getByTestId('connection')).toHaveText('Connected');
  const id = new URL(pa.url()).searchParams.get('room')!;
  await b.request.post(origin + '/api/rooms/' + id + '/join', {
    headers: { Origin: origin },
  });
  await pb.goto('/?room=' + id);
  await expect(pb.getByTestId('connection')).toHaveText('Connected');
  await pa.getByRole('button', { name: 'Learn', exact: true }).click();
  expect(new URL(pa.url()).searchParams.get('room')).toBe(id);
  await expect(
    pa.getByRole('heading', { name: 'Learn', exact: true }),
  ).toBeVisible();
  await expect(pa.getByRole('grid')).toBeVisible();
  await pa.getByRole('checkbox', { name: 'Enable Quick Learn' }).check();
  await expect(pa.getByRole('region', { name: 'Study card' })).toHaveCount(0);
  await pa.locator('[data-square="7g"]').click();
  await pa.locator('[data-square="7f"]').click();
  await expect(pb.getByTestId('online-record').locator('li')).toHaveText([
    '1. ▲７六歩',
  ]);
  await expect(pa.getByRole('region', { name: 'Study card' })).toBeVisible();
  const before = await pa.getByTestId('clocks').textContent();
  const beforeSeconds = before!.match(/\d+(?=s)/g)!.map(Number);
  // UI ticks every 250 ms and rounds seconds upward; poll the actual decrease.
  await expect
    .poll(
      async () =>
        Number(
          (await pa.getByTestId('clocks').textContent())!.match(
            /\d+(?=s)/g,
          )![1],
        ),
      { timeout: 3000 },
    )
    .toBeLessThan(beforeSeconds[1]);
  expect(
    Number(
      (await pa.getByTestId('clocks').textContent())!.match(/\d+(?=s)/g)![0],
    ),
  ).toBe(beforeSeconds[0]);
  await pb.locator('[data-square="3c"]').click();
  await pb.locator('[data-square="3d"]').click();
  await expect(pa.getByTestId('online-record').locator('li')).toHaveText([
    '1. ▲７六歩',
    '2. △３四歩',
  ]);
  await expect(pa.getByRole('region', { name: 'Study card' })).toHaveCount(0);
  await expect(
    pa.getByRole('button', { name: 'Review', exact: true }),
  ).toBeDisabled();
  await expect(
    pa.getByRole('button', { name: 'Analyze position', exact: true }),
  ).toHaveCount(0);
  const fresh = await browser.newContext();
  await fresh.request.post(origin + '/api/test/login', {
    headers: { Origin: origin },
    data: { name: 'alice' },
  });
  const pc = await fresh.newPage();
  await pc.route('**/api/play-status', (r) => r.abort());
  await pc.goto('/?review=1');
  await expect(
    pc.getByRole('heading', { name: 'Review paused' }),
  ).toBeVisible();
  await expect(
    pc.getByRole('button', { name: 'Start study variation', exact: true }),
  ).toHaveCount(0);
  await expect(
    pc.getByRole('button', { name: 'Analyze saved position', exact: true }),
  ).toHaveCount(0);
  await fresh.close();
  await a.request.post(origin + '/api/rooms/' + id + '/resign', {
    headers: { Origin: origin },
  });
  await expect(
    pa.getByRole('button', { name: 'Review', exact: true }),
  ).toBeEnabled();
  await pa.getByRole('button', { name: 'Review', exact: true }).click();
  await pa.getByRole('button', { name: /online · 2 plies/ }).click();
  await expect(
    pa.getByRole('button', { name: 'Start study variation', exact: true }),
  ).toBeVisible();
  await expect(pa.getByLabel('Original move sequence')).toContainText(
    '▲７六歩',
  );
  await a.close();
  await b.close();
});
