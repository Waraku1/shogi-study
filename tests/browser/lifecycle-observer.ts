// Opt-in local diagnostics; original assertions and deadlines are untouched.
import type { Page, TestInfo, Worker as BrowserWorker } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { freemem, loadavg, platform, release } from 'node:os';

export async function observeLifecycle(page: Page, info: TestInfo) {
  const now = () => performance.timeOrigin + performance.now();
  const browserCDP = await page.context().browser()!.newBrowserCDPSession();
  const targetEvents: unknown[] = [];
  browserCDP.on('Target.targetCreated', e => targetEvents.push({ epochMs: now(), event: 'created', ...e }));
  browserCDP.on('Target.targetInfoChanged', e => targetEvents.push({ epochMs: now(), event: 'changed', ...e }));
  browserCDP.on('Target.targetDestroyed', e => targetEvents.push({ epochMs: now(), event: 'destroyed', ...e }));
  await browserCDP.send('Target.setDiscoverTargets', { discover: true });
  await page.addInitScript(probe => {
    const log: unknown[] = [];
    (window as unknown as { lifecycleMessages: unknown[] }).lifecycleMessages = log;
    const now = () => performance.timeOrigin + performance.now();
    const NativeWorker = window.Worker;
    let serial = 0;
    window.Worker = class extends NativeWorker {
      readonly traceId = 'H' + ++serial;
      acknowledged = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        const resolved = new URL(url, location.href);
        const id = 'H' + (serial + 1);
        if (resolved.pathname === '/engine-host.js') resolved.searchParams.set('rel05Host', id);
        super(resolved, options);
        log.push({ epochMs: now(), id: this.traceId, event: 'constructed', url: resolved.href });
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'disposed') this.acknowledged = true;
          if (data.type === '__rel05') log.push(data);
          else if (data.type !== 'line') log.push({ epochMs: now(), id: this.traceId, event: 'received', type: data.type });
        });
      }
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const data = message as { type?: string };
        if (data?.type === 'init' || data?.type === 'dispose') log.push({ epochMs: now(), id: this.traceId, event: 'sent', type: data.type });
        Reflect.apply(NativeWorker.prototype.postMessage, this, [message, options]);
      }
      terminate() {
        log.push({ epochMs: now(), id: this.traceId, event: 'terminate-called' });
        if (probe === 'host-owned' && this.acknowledged) {
          log.push({ epochMs: now(), id: this.traceId, event: 'controlled-skip-hard-terminate' });
          return;
        }
        super.terminate();
        log.push({ epochMs: now(), id: this.traceId, event: 'terminate-returned' });
      }
    };
    const timeout = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const deadline = delay === 2000 && new Error().stack?.includes('/features/engine/adapter.ts');
      if (!deadline || typeof handler !== 'function') return timeout(handler, delay, ...args);
      log.push({ epochMs: now(), event: 'adapter-deadline-scheduled', delay });
      return timeout(() => { log.push({ epochMs: now(), event: 'adapter-deadline-fired', delay }); handler(...args); }, delay);
    }) as typeof window.setTimeout;
  }, process.env.SHOGI_LIFECYCLE_PROBE ?? 'none');
  // Prefix only the project bridge, never any pinned upstream engine asset.
  await page.route('**/engine-host.js?rel05Host=*', async route => {
    const response = await route.fetch();
    const prefix = `(() => {
      const probe = ${JSON.stringify(process.env.SHOGI_LIFECYCLE_PROBE ?? 'none')};
      const id = new URL(self.location.href).searchParams.get('rel05Host');
      const nativePost = self.postMessage.bind(self), nativeClose = self.close.bind(self);
      const emit = (event, extra = {}) => nativePost({type:'__rel05', epochMs:performance.timeOrigin+performance.now(), id, event, ...extra});
      let pendingAck;
      const pause = () => { emit('controlled-pause'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); emit('controlled-resume'); };
      self.postMessage = (...args) => {
        const data = args[0];
        if (data.type !== 'line') emit('host-post', {messageType:data.type});
        if (data.type === 'disposed' && probe === 'close-before-ack') { pendingAck = args; return; }
        nativePost(...args);
        if (data.type === 'disposed' && (probe === 'early-ack' || probe === 'host-owned')) pause();
      };
      self.close = () => { emit('host-close'); nativeClose(); if (pendingAck) { nativePost(...pendingAck); pause(); } };
      self.addEventListener('message', event => {
        const data=event.data;
        emit('host-receive', {messageType:data.type});
        if (probe !== 'drain-search' || data.type !== 'dispose' || data.drained) return;
        const e=eval('engine');
        if (!e) return;
        event.stopImmediatePropagation();
        let stopped=false, done=false;
        emit('controlled-drain-start');
        e.addMessageListener(line => {
          if (done) return;
          if (line.startsWith('bestmove ')) { stopped=true; emit('controlled-bestmove'); e.postMessage('isready'); }
          else if (stopped && line === 'readyok') {
            done=true; emit('controlled-readyok');
            setTimeout(() => self.dispatchEvent(new MessageEvent('message', {data:{type:'dispose',drained:true}})),0);
          } else if (!stopped && line.startsWith('info ')) e.postMessage('stop');
        });
        e.postMessage('stop');
      });
      let serial = 0;
      const Native = self.Worker;
      self.Worker = class extends Native {
        constructor(...args) { super(...args); this.traceChild='C'+(++serial); emit('child-created',{child:this.traceChild,url:String(args[0])}); }
        terminate() { emit('child-terminate-called',{child:this.traceChild}); super.terminate(); emit('child-terminate-returned',{child:this.traceChild}); }
      };
      emit('host-boot');
    })();\n`;
    await route.fulfill({ response, body: prefix + await response.text() });
  });
  const events: unknown[] = [], samples: unknown[] = [];
  const track = (worker: BrowserWorker) => {
    events.push({ epochMs: now(), event: 'created', url: worker.url(), count: page.workers().length });
    worker.on('close', () => events.push({ epochMs: now(), event: 'closed', url: worker.url(), count: page.workers().length }));
  };
  page.on('worker', track);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pending) return;
    pending = cdp.send('Performance.getMetrics').then(({ metrics }) => {
      const get = (name: string) => metrics.find(m => m.name === name)?.value ?? 0;
      samples.push({ epochMs: now(), jsHeapUsed: get('JSHeapUsedSize'), jsHeapTotal: get('JSHeapTotalSize'), workers: page.workers().length, hostFreeBytes: freemem(), hostLoad1: loadavg()[0] });
    }).catch(() => {}).finally(() => { pending = undefined; });
  }, 250);
  return async () => {
    clearInterval(timer);
    await pending;
    const targets = (await browserCDP.send('Target.getTargets')).targetInfos.filter(t => t.type === 'worker');
    const remaining = page.workers();
    const remainingReplies = await Promise.all(remaining.map(async w => ({ url: w.url(), reply: await Promise.race([
      w.evaluate(() => ({ location: self.location.href })).then(value => ({ value }), error => ({ error: String(error) })),
      new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 1000)),
    ]) })));
    const result = {
      sourceSHA: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
      probe: process.env.SHOGI_LIFECYCLE_PROBE ?? 'none',
      dirty: !!execFileSync('git', ['status', '--porcelain']).toString().trim(),
      title: info.title, repeat: info.repeatEachIndex, status: info.status,
      node: process.version, os: `${platform()} ${release()}`, browser: page.context().browser()?.version(),
      capturedEpochMs: now(), remainingWorkers: remaining.map(w => w.url()), workerTargets: targets, remainingReplies,
      bridgeMessages: await page.evaluate(() => (window as unknown as { lifecycleMessages: unknown }).lifecycleMessages), events, targetEvents, samples,
      limitations: 'Opt-in bridge prefix and passive observers affect scheduling. Target enumeration/worker replies are independent of Playwright handle count. Renderer heap excludes shared WASM/total browser RSS.',
    };
    const output = process.env.SHOGI_LIFECYCLE_OUTPUT ?? 'work/rel-05/capture';
    mkdirSync(output, { recursive: true });
    const text = JSON.stringify(result, null, 2);
    writeFileSync(`${output}/${info.repeatEachIndex}-${info.testId}.json`, text + '\n');
    await info.attach('lifecycle-observer', { body: text, contentType: 'application/json' });
    await cdp.detach();
    await browserCDP.detach();
    page.off('worker', track);
  };
}
