// Opt-in diagnostics only: keep original lifecycle assertions and deadlines intact.
import type { Page, TestInfo, Worker as BrowserWorker } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { freemem, loadavg, platform, release } from 'node:os';

export async function observeLifecycle(page: Page, info: TestInfo) {
  await page.addInitScript(() => {
    const log: { ms: number; id: number; event: string; type?: string }[] = [];
    (window as unknown as { lifecycleMessages: typeof log }).lifecycleMessages = log;
    const ids = new WeakMap<Worker, number>();
    let serial = 0;
    const identify = (worker: Worker) => {
      if (!ids.has(worker)) {
        ids.set(worker, ++serial);
        worker.addEventListener('message', ({ data }) => {
          if (data.type !== 'line') log.push({ ms: performance.now(), id: ids.get(worker)!, event: 'received', type: data.type });
        });
      }
      return ids.get(worker)!;
    };
    const post = Worker.prototype.postMessage, terminate = Worker.prototype.terminate;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const data = message as { type?: string };
      if (data?.type === 'init' || data?.type === 'dispose') log.push({ ms: performance.now(), id: identify(this), event: 'sent', type: data.type });
      return Reflect.apply(post, this, [message, options]);
    };
    Worker.prototype.terminate = function (this: Worker) {
      log.push({ ms: performance.now(), id: identify(this), event: 'terminate-called' });
      return terminate.call(this);
    };
  });
  const started = performance.now();
  const events: { ms: number; event: string; url: string; count: number }[] = [];
  const samples: { ms: number; jsHeapUsed: number; jsHeapTotal: number; workers: number; hostFreeBytes: number; hostLoad1: number }[] = [];
  const track = (worker: BrowserWorker) => {
    events.push({ ms: performance.now() - started, event: 'created', url: worker.url(), count: page.workers().length });
    worker.on('close', () => events.push({ ms: performance.now() - started, event: 'closed', url: worker.url(), count: page.workers().length }));
  };
  page.on('worker', track);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pending) return;
    pending = cdp.send('Performance.getMetrics').then(({ metrics }) => {
      const get = (name: string) => metrics.find(m => m.name === name)?.value ?? 0;
      samples.push({ ms: performance.now() - started, jsHeapUsed: get('JSHeapUsedSize'), jsHeapTotal: get('JSHeapTotalSize'), workers: page.workers().length, hostFreeBytes: freemem(), hostLoad1: loadavg()[0] });
    }).catch(() => {}).finally(() => { pending = undefined; });
  }, 250);
  return async () => {
    clearInterval(timer);
    await pending;
    const browserCDP = await page.context().browser()!.newBrowserCDPSession();
    const targets = (await browserCDP.send('Target.getTargets')).targetInfos.filter(t => t.type === 'worker');
    await browserCDP.detach();
    const remainingReplies = await Promise.all(page.workers().map(async w => ({ url: w.url(), reply: await Promise.race([
      w.evaluate(() => ({ location: self.location.href })).then(value => ({ value }), error => ({ error: String(error) })),
      new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 1000)),
    ]) })));
    const result = {
      sourceSHA: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain']).toString().trim(),
      title: info.title, repeat: info.repeatEachIndex, status: info.status,
      node: process.version, os: `${platform()} ${release()}`, browser: page.context().browser()?.version(),
      remainingWorkers: page.workers().map(w => w.url()), workerTargets: targets.map(t => ({ type: t.type, url: t.url, attached: t.attached })), remainingReplies,
      bridgeMessages: await page.evaluate(() => (window as unknown as { lifecycleMessages: unknown }).lifecycleMessages), events, samples,
      limitations: 'CDP renderer JS heap is not the shared WASM heap or total browser RSS. Host free/load samples cannot attribute contention or prove a leak. Observer adds overhead; uninstrumented tests remain separate.',
    };
    mkdirSync('work/rel-04/lifecycle', { recursive: true });
    const text = JSON.stringify(result, null, 2);
    writeFileSync(`work/rel-04/lifecycle/${info.repeatEachIndex}-${info.testId}.json`, text + '\n');
    await info.attach('lifecycle-observer', { body: text, contentType: 'application/json' });
    await cdp.detach();
    page.off('worker', track);
  };
}
