import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const original = {
  source: 'shogi-study',
  version: 1,
  id: 'deletion-browser-001',
  mode: 'local',
  moves: ['7g7f', '3c3d'],
  savedAt: 1000,
  result: { status: 'finished', text: 'White wins by resignation' },
};
type Kind = 'game' | 'study';
type Fault = 'abort' | 'request error' | 'database unavailable';
type FaultWindow = Window & {
  restoreDeletion?: () => void;
  releaseDeletion?: () => void;
  deleteRequestSucceeded?: boolean;
};
const gameButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Delete saved game ' + original.id,
    exact: true,
  });
const studyButton = (page: Page) =>
  page.getByRole('button', { name: /^Delete study variation / });
const targetButton = (page: Page, kind: Kind) =>
  kind === 'game' ? gameButton(page) : studyButton(page);
const dialog = (page: Page, kind: Kind) =>
  page.getByRole('alertdialog', {
    name: kind === 'game' ? 'Delete saved game' : 'Delete study variation',
    exact: true,
  });
const confirmName = (kind: Kind) =>
  kind === 'game' ? 'Confirm deletion' : 'Confirm study deletion';
const retryName = (kind: Kind) =>
  kind === 'game' ? 'Retry deletion' : 'Retry study deletion';

async function seed(page: Page) {
  await page.goto('/?review=1');
  await page
    .getByLabel('Game JSON', { exact: true })
    .fill(JSON.stringify(original));
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await page
    .getByRole('button', { name: 'Start study variation', exact: true })
    .click();
  await page.locator('[data-square="2g"]').click();
  await page.locator('[data-square="2f"]').click();
  await page.getByLabel('Study name').fill('Deletion study');
  await page
    .getByRole('button', { name: 'Save study variation', exact: true })
    .click();
  await expect(studyButton(page)).toBeVisible();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /Study variation saved|Study storage unavailable/ }),
  ).toBeVisible();
}
async function inject(page: Page, kind: Kind, fault: Fault) {
  await page.evaluate(
    ({ name, fault }) => {
      const win = window as FaultWindow;
      const nativeDelete = IDBObjectStore.prototype.delete;
      const nativeTransaction = IDBDatabase.prototype.transaction;
      win.restoreDeletion = () => {
        IDBObjectStore.prototype.delete = nativeDelete;
        IDBDatabase.prototype.transaction = nativeTransaction;
      };
      if (fault === 'database unavailable') {
        IDBDatabase.prototype.transaction = function (
          this: IDBDatabase,
          stores,
          mode,
          options,
        ) {
          if (mode === 'readwrite' && stores === name) this.close();
          return nativeTransaction.call(this, stores, mode, options);
        };
      } else {
        IDBObjectStore.prototype.delete = function (this: IDBObjectStore, key) {
          if (this.name !== name) return nativeDelete.call(this, key);
          if (fault === 'request error') {
            // Native asynchronous ConstraintError, followed by transaction rollback.
            const [namespace, id] = key as string[];
            return this.add({
              namespace,
              id,
            }) as unknown as IDBRequest<undefined>;
          }
          const request = nativeDelete.call(this, key);
          request.addEventListener('success', () => this.transaction.abort());
          return request;
        };
      }
    },
    { name: kind === 'game' ? 'games' : 'variations', fault },
  );
}
async function attempt(page: Page, kind: Kind) {
  await targetButton(page, kind).click();
  await dialog(page, kind)
    .getByRole('button', { name: confirmName(kind), exact: true })
    .click();
}
async function failed(page: Page, kind: Kind) {
  await expect(dialog(page, kind).getByRole('alert')).toContainText(
    'could not be deleted from device storage',
  );
  await expect(
    dialog(page, kind).getByRole('button', {
      name: retryName(kind),
      exact: true,
    }),
  ).toBeEnabled();
  await expect(targetButton(page, kind)).toBeVisible();
  await expect(
    page.getByRole('status').filter({
      hasText:
        /Study variation deleted\.|Saved game deleted from this device\./,
    }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /(?:Archive|Study) storage unavailable/ }),
  ).toHaveCount(0);
}
async function verifyRemaining(page: Page, kind: Kind, sfen: string | null) {
  await page.reload();
  await expect(targetButton(page, kind)).toHaveCount(0);
  if (kind === 'game') {
    await expect(
      page.getByText('No games saved for this profile.'),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: 'Deletion study · 1 branch plies',
        exact: true,
      })
      .click();
    expect(await page.getByTestId('replay-sfen').textContent()).toBe(sfen);
  } else {
    await expect(gameButton(page)).toBeVisible();
    await page.getByRole('button', { name: /local · 2 plies/ }).click();
    await page
      .getByRole('button', { name: 'Export selected JSON', exact: true })
      .click();
    expect(
      JSON.parse(
        await page.getByLabel('Game JSON', { exact: true }).inputValue(),
      ),
    ).toEqual(original);
  }
}
for (const kind of ['game', 'study'] as const) {
  for (const fault of [
    'abort',
    'request error',
    'database unavailable',
  ] as const) {
    test(`${kind}: ${fault} shows no false success, survives reload and retries after recovery`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await seed(page);
      const sfen = await page.getByTestId('replay-sfen').textContent();
      await inject(page, kind, fault);
      await attempt(page, kind);
      await failed(page, kind);
      expect(await page.getByTestId('replay-sfen').textContent()).toBe(sfen);
      await dialog(page, kind)
        .getByRole('button', {
          name: kind === 'game' ? 'Cancel deletion' : 'Cancel study deletion',
          exact: true,
        })
        .click();
      await expect(targetButton(page, kind)).toBeFocused();
      await page.reload(); // Fault hooks are page-local; persistent rows must return.
      await expect(gameButton(page)).toBeVisible();
      await expect(studyButton(page)).toBeVisible();
      await inject(page, kind, fault);
      await attempt(page, kind);
      await failed(page, kind);
      await page.evaluate(() => (window as FaultWindow).restoreDeletion!());
      await dialog(page, kind)
        .getByRole('button', { name: retryName(kind), exact: true })
        .click();
      await expect(dialog(page, kind)).toHaveCount(0);
      await expect(targetButton(page, kind)).toHaveCount(0);
      await verifyRemaining(page, kind, sfen);
      expect(errors).toEqual([]);
    });
  }
  test(`${kind}: request success alone keeps confirmation pending until the transaction commits`, async ({
    page,
  }) => {
    await seed(page);
    const sfen = await page.getByTestId('replay-sfen').textContent();
    await page.evaluate(
      (name) => {
        const win = window as FaultWindow,
          nativeDelete = IDBObjectStore.prototype.delete;
        let released = false;
        win.releaseDeletion = () => {
          released = true;
        };
        IDBObjectStore.prototype.delete = function (this: IDBObjectStore, key) {
          const request = nativeDelete.call(this, key);
          if (this.name === name)
            request.addEventListener('success', () => {
              win.deleteRequestSucceeded = true;
              // Keep a real transaction alive with queued reads until the test releases it.
              const pump = () => {
                this.get(key).onsuccess = () => {
                  if (!released) pump();
                };
              };
              pump();
            });
          return request;
        };
      },
      kind === 'game' ? 'games' : 'variations',
    );
    await attempt(page, kind);
    await expect
      .poll(() =>
        page.evaluate(() => (window as FaultWindow).deleteRequestSucceeded),
      )
      .toBe(true);
    await expect(dialog(page, kind)).toBeVisible();
    await expect(
      dialog(page, kind).getByRole('button', {
        name: confirmName(kind),
        exact: true,
      }),
    ).toBeDisabled();
    await expect(targetButton(page, kind)).toBeVisible();
    await expect(
      page.getByRole('status').filter({
        hasText:
          /Study variation deleted\.|Saved game deleted from this device\./,
      }),
    ).toHaveCount(0);
    await page.evaluate(() => (window as FaultWindow).releaseDeletion!());
    await expect(dialog(page, kind)).toHaveCount(0);
    await verifyRemaining(page, kind, sfen);
  });
}
test('explicit memory-only deletion reports session removal for both stores', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await seed(page);
  for (const kind of ['study', 'game'] as const) {
    await attempt(page, kind);
    await expect(dialog(page, kind)).toHaveCount(0);
    await expect(
      page
        .getByRole('status')
        .filter({
          hasText:
            kind === 'game' ? 'Saved game removed' : 'Study variation removed',
        })
        .filter({
          hasText:
            /removed from this session only\. Device storage was not changed/,
        }),
    ).toBeVisible();
    await expect(targetButton(page, kind)).toHaveCount(0);
  }
  await page.reload();
  await expect(gameButton(page)).toHaveCount(0);
  await expect(studyButton(page)).toHaveCount(0);
});
