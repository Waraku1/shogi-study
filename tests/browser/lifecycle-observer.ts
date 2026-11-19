// Opt-in diagnostics only: keep original lifecycle assertions and deadlines intact.
import type { Page, TestInfo, Worker } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { freemem, loadavg, platform, release } from 'node:os';

export async function observeLifecycle(page: Page, info: TestInfo) {
  const started = performance.now();
  const events: { ms: number; event: string; url: string; count: number }[] = [];
  const samples: { ms: number; jsHeapUsed: number; jsHeapTotal: number; workers: number; hostFreeBytes: number; hostLoad1: number }[] = [];
  const track = (worker: Worker) => {
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
    const result = {
      sourceSHA: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain']).toString().trim(),
      title: info.title, repeat: info.repeatEachIndex, status: info.status,
      node: process.version, os: `${platform()} ${release()}`, browser: page.context().browser()?.version(),
      remainingWorkers: page.workers().map(w => w.url()), events, samples,
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
