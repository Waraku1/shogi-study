import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

test('local board, keyboard, record, real AI reply and candidate preview', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  await expect(page.getByRole('heading', { name: 'Black to move', exact: true })).toBeVisible();
  await expect(page.getByLabel('White captured pieces')).toContainText('No captured pieces');
  await page.locator('[data-square="7g"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-square="7f"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'White to move', exact: true })).toBeVisible();
  await expect(page.locator('.move-list')).toContainText('7g7f');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-square="7g"]')).toHaveAttribute('aria-label', '7g Black Pawn');
  await page.selectOption('#mode', 'ai');
  await page.locator('[data-square="7g"]').click();
  await page.locator('[data-square="7f"]').click();
  await expect(page.locator('.move-list li')).toHaveCount(2, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Black to move', exact: true })).toBeVisible();
  await expect(page.locator('.candidates button')).toHaveCount(3);
  const recordBefore = await page.getByTestId('sfen').textContent();
  await page.locator('.candidates button').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Variation · ply 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.getByRole('heading', { name: 'Variation · ply 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to game', exact: false }).click();
  expect(await page.getByTestId('sfen').textContent()).toBe(recordBefore);
  await page.getByRole('button', { name: 'Undo turn' }).click();
  await expect(page.locator('.move-list li')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('interactive captures, promotion, hand drops, illegal selection and resignation', async ({ page }) => {
  await page.goto('/');
  const move = async (from: string, to: string) => {
    await page.locator(`[data-square="${from}"]`).click();
    await page.locator(`[data-square="${to}"]`).click();
  };
  await move('7g', '7e');
  await expect(page.locator('.move-list li')).toHaveCount(0);
  await move('7g', '7f');
  await move('3c', '3d');
  await move('8h', '2b');
  await expect(page.getByRole('dialog', { name: 'Choose promotion' })).toBeVisible();
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(page.locator('[data-square="2b"]')).toHaveAttribute('aria-label', /Black Horse/);
  await expect(page.getByLabel('Black captured pieces')).toContainText('B ×1');
  await move('3a', '2b');
  await page.getByLabel('Black captured pieces').getByRole('button').click();
  await page.locator('[data-square="4e"]').click();
  await expect(page.locator('.move-list')).toContainText('B*4e');
  await expect(page.getByLabel('Black captured pieces')).toContainText('No captured pieces');
  await page.getByLabel('White captured pieces').getByRole('button').click();
  await page.locator('[data-square="8h"]').click();
  await expect(page.locator('.move-list')).toContainText('B*8h');
  await page.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'White wins', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Black to move', exact: true })).toBeVisible();
});

test('real WASM handshake, opening and midgame, 10 searches, full legal PVs, stop and dispose', async ({ page, browserName }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const adapterPath = '/src/features/engine/adapter.ts';
    const gamePath = '/src/features/shogi/game.ts';
    const { WasmEngineAdapter } = await import(adapterPath);
    const { LocalGame, isLegalUSI, validatePV, positionFromSFEN } = await import(gamePath);
    const engine = new WasmEngineAdapter();
    await engine.init();
    const initialWasmMemoryBytes = engine.diagnostics.wasmMemoryBytes;
    const game = new LocalGame();
    const searches = [];
    const gaps: number[] = [];
    let last = performance.now();
    const heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 10);
    for (let index = 0; index < 10; index++) {
      const searched = await engine.search({ kind: 'startpos', moves: game.moves }, { maxTimeMs: 200, multiPv: 3 });
      searches.push({ index, sfen: game.record.sfen, moves: game.moves, ...searched, wasmMemoryBytes: engine.diagnostics.wasmMemoryBytes,
        bestMoveLegal: !!searched.bestMoveUSI && isLegalUSI(game.position, searched.bestMoveUSI),
        allPVsLegal: searched.candidates.every((candidate: { pvUSI: string[] }) => validatePV(game.position, candidate.pvUSI)),
      });
      if (!searched.bestMoveUSI || !game.play(searched.bestMoveUSI)) throw new Error('Invalid engine move');
    }
    const midgame = new LocalGame();
    const midgameMoves = ['7g7f','3c3d','8h2b+','3a2b','B*4e','B*8h','2g2f','8b3b','3i3h','5a6b','5i6h','6b7b'];
    for (const move of midgameMoves) if (!midgame.play(move)) throw new Error('Invalid midgame fixture ' + move);
    const sfenResult = await engine.search({ kind: 'sfen', sfen: midgame.record.sfen }, { maxTimeMs: 500, multiPv: 3 });
    const midgameResult = { ...sfenResult, sfen: midgame.record.sfen,
      bestMoveLegal: isLegalUSI(midgame.position, sfenResult.bestMoveUSI),
      allPVsLegal: sfenResult.candidates.every((c: { pvUSI: string[] }) => validatePV(midgame.position, c.pvUSI)),
    };
    // Warm search: wait for `go` in the adapter transcript, then stop it.
    const beforeStopSearch = engine.transcript.length;
    const searching = engine.search({ kind: 'startpos', moves: [] }, { maxTimeMs: 10000, multiPv: 3 });
    const stopDeadline = performance.now() + 5000;
    while (!engine.transcript.slice(beforeStopSearch).includes('> go movetime 10000')) {
      if (performance.now() > stopDeadline) throw new Error('Search did not start');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    await new Promise(resolve => setTimeout(resolve, 80));
    const stopStarted = performance.now();
    await engine.stop();
    const stopMs = performance.now() - stopStarted;
    const stopped = await searching;
    const afterStop = await engine.search({ kind: 'startpos', moves: [] }, { maxTimeMs: 100, multiPv: 2 });
    const mateSFEN = '3lkl3/4R4/4G4/9/9/9/9/9/4K4 w - 1';
    const terminal = await engine.search({ kind: 'sfen', sfen: mateSFEN }, { maxTimeMs: 100, multiPv: 3 });
    const deterministicMate = new LocalGame(positionFromSFEN(mateSFEN)).outcome;
    clearInterval(heartbeat);
    const diagnostics = engine.diagnostics;
    const transcript = [...engine.transcript];
    engine.dispose();
    let disposedRejects = false;
    try { await engine.search({ kind: 'startpos', moves: [] }, { maxTimeMs: 100, multiPv: 1 }); } catch { disposedRejects = true; }
    return { diagnostics, initialWasmMemoryBytes, searches, midgameResult, stopMs, stopped, afterStop, terminal, deterministicMate, disposedRejects,
      heartbeatMaxGapMs: Math.max(...gaps), heartbeatTicks: gaps.length, transcript,
      browser: navigator.userAgent, crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency,
      jsHeap: 'memory' in performance ? {
        usedJSHeapSize: (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize,
        totalJSHeapSize: (performance as unknown as { memory: { totalJSHeapSize: number } }).memory.totalJSHeapSize,
      } : null };
  });
  expect(browserName).toBe('chromium');
  expect(result.crossOriginIsolated).toBe(true);
  expect(result.transcript).toContain('usiok');
  expect(result.transcript).toContain('readyok');
  expect(result.transcript.some(line => /Unknown option|No such|not supported|ERROR/i.test(line))).toBe(false);
  expect(result.diagnostics.multiPvMax).toBeGreaterThanOrEqual(3);
  expect(result.searches).toHaveLength(10);
  for (const search of result.searches) {
    expect(search.bestMoveLegal).toBe(true);
    expect(search.allPVsLegal).toBe(true);
    expect(search.candidates).toHaveLength(3);
    expect(new Set(search.candidates.map((c: { firstMoveUSI: string }) => c.firstMoveUSI)).size).toBe(3);
  }
  expect(result.midgameResult.bestMoveLegal).toBe(true);
  expect(result.midgameResult.allPVsLegal).toBe(true);
  expect(result.midgameResult.candidates).toHaveLength(3);
  expect(result.afterStop.candidates).toHaveLength(2);
  expect(result.terminal.bestMoveUSI).toBeNull();
  expect(result.terminal.terminal).toBeTruthy();
  expect(result.deterministicMate).toEqual({ reason: 'Checkmate', winner: 'black' });
  expect(result.disposedRejects).toBe(true);
  expect(result.stopMs).toBeLessThan(2000);
  expect(result.heartbeatTicks).toBeGreaterThan(50);
  expect(result.heartbeatMaxGapMs).toBeLessThan(500);
  await expect.poll(() => page.workers().length).toBe(0);
  mkdirSync('work', { recursive: true });
  writeFileSync('work/engine-measurements.json', JSON.stringify(result, null, 2) + '\n');
});

test('reset during analysis, stop during preparation, and disposal of an active search', async ({ page }) => {
  await page.goto('/');
  await page.selectOption('#budget', '1500');
  await page.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect(page.locator('.move-list li')).toHaveCount(0);
  await expect(page.locator('.candidates button')).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/features/engine/adapter.ts';
    const { WasmEngineAdapter } = await import(modulePath);
    const adapter = new WasmEngineAdapter();
    const pending = adapter.search({ kind: 'startpos', moves: [] }, { maxTimeMs: 1000, multiPv: 3 }).then(() => 'resolved', (e: Error) => e.name);
    await adapter.stop();
    const preparationStopped = await pending;
    const afterStop = await adapter.search({ kind: 'startpos', moves: [] }, { maxTimeMs: 100, multiPv: 1 });
    const beforeDispose = adapter.transcript.length;
    const active = adapter.search({ kind: 'startpos', moves: [] }, { maxTimeMs: 10000, multiPv: 1 }).then(() => false, () => true);
    const disposeDeadline = performance.now() + 5000;
    while (!adapter.transcript.slice(beforeDispose).includes('> go movetime 10000')) {
      if (performance.now() > disposeDeadline) throw new Error('Search did not start');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    adapter.dispose();
    return { preparationStopped, afterStop, activeRejected: await active };
  });
  expect(result.preparationStopped).toBe('AbortError');
  expect(result.afterStop.bestMoveUSI).toBeTruthy();
  expect(result.activeRejected).toBe(true);
  await expect.poll(() => page.workers().length).toBe(0);
  await page.waitForTimeout(1700);
  await expect(page.locator('.move-list li')).toHaveCount(0);
  await expect(page.locator('.candidates button')).toHaveCount(0);
});

test('missing isolation or missing WASM gives an honest error and usable local board', async ({ page }) => {
  await page.route('**/engine/stockfish.wasm', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Engine unavailable', { timeout: 20000 });
  await expect(page.locator('.candidates button')).toHaveCount(0);
  await page.locator('[data-square="7g"]').click();
  await page.locator('[data-square="7f"]').click();
  await expect(page.locator('.move-list li')).toHaveCount(1);
  await expect.poll(() => page.workers().length).toBe(0);
  await page.unrouteAll();
  await page.route('**/*', async route => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['cross-origin-opener-policy'];
    delete headers['cross-origin-embedder-policy'];
    await route.fulfill({ response, headers });
  });
  await page.goto('/');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await page.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('cross-origin isolation');
  expect(page.workers()).toHaveLength(0);
});

test('mobile viewport: no horizontal overflow; board and engine remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  await page.locator('[data-square="7g"]').click();
  await page.locator('[data-square="7f"]').click();
  await page.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await expect(page.locator('.candidates button')).toHaveCount(3, { timeout: 20000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/mobile-prototype.png', fullPage: true });
});
