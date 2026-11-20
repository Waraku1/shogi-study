import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { CDPSession, Page } from '@playwright/test';

type Cell = {
  phase: 'startup' | 'idle' | 'active' | 'completed' | 'control';
  action: 'immediate' | 'drain' | 'host-close';
  detailed: boolean;
};
type Event = { epochMs: number; event: string; [key: string]: unknown };

// One fresh page per trial. Serial groups cancel the remaining trials in a cell
// on its first failure while allowing the other comparisons to proceed.
const cells: Cell[] = [
  { phase: 'startup', action: 'immediate', detailed: true },
  { phase: 'idle', action: 'immediate', detailed: true },
  { phase: 'active', action: 'immediate', detailed: true },
  { phase: 'active', action: 'drain', detailed: true },
  { phase: 'completed', action: 'immediate', detailed: true },
  { phase: 'active', action: 'host-close', detailed: true },
  { phase: 'control', action: 'immediate', detailed: true },
  { phase: 'control', action: 'host-close', detailed: true },
  { phase: 'active', action: 'immediate', detailed: false },
];

const epoch = () => performance.timeOrigin + performance.now();
const isolationHeaders = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('CDP deadline exceeded')), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeWorker(cdp: CDPSession, targetId: string, events: Event[]) {
  let sessionId: string | undefined;
  let receive: ((event: { sessionId: string; message: string }) => void) | undefined;
  try {
    // Use an explicitly detachable probe. A stalled Runtime.evaluate can
    // outlive the observation deadline without holding the Playwright fixture.
    ({ sessionId } = await bounded(cdp.send('Target.attachToTarget', { targetId, flatten: false }), 500));
    events.push({ epochMs: epoch(), event: 'probe-attached', targetId, sessionId });
    const result = new Promise<unknown>(resolve => {
      receive = event => {
        if (event.sessionId !== sessionId) return;
        const msg = JSON.parse(event.message);
        if (msg.id === 1) resolve(msg.error ?? msg.result);
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
    });
    await bounded(cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'self.location.pathname', returnByValue: true } }),
    }), 500);
    return await bounded(result, 500);
  } catch (error) {
    return { error: String(error) };
  } finally {
    if (receive) cdp.off('Target.receivedMessageFromTarget', receive);
    if (sessionId) {
      try {
        await bounded(cdp.send('Target.detachFromTarget', { sessionId }), 500);
        events.push({ epochMs: epoch(), event: 'probe-detached', targetId, sessionId });
      } catch (error) {
        events.push({ epochMs: epoch(), event: 'probe-detach-error', targetId, error: String(error) });
      }
    }
  }
}

function hostObserver() {
  const id = new URL(self.location.href).searchParams.get('rel06');
  const send = self.postMessage.bind(self);
  const close = self.close.bind(self);
  const emit = (event: string, data: Record<string, unknown> = {}) => {
    send({ type: 'rel06', epochMs: performance.timeOrigin + performance.now(), event, id, ...data });
  };
  self.addEventListener('message', event => {
    const { type, command } = (event as MessageEvent).data;
    emit('host-receive', { typeReceived: type, command });
  });
  self.postMessage = (data: { type: string; line?: string }) => {
    if (data.type !== 'line' || /^(bestmove |readyok$|usiok$)/.test(data.line ?? ''))
      emit('host-send', { typeSent: data.type, line: data.line });
    send(data);
  };
  self.close = () => {
    emit('host-close');
    close();
  };
  const NativeWorker = Worker;
  let sequence = 0;
  self.Worker = class extends NativeWorker {
    private childId: string;
    constructor(url: URL | string, options?: WorkerOptions) {
      super(url, options);
      this.childId = id + '/C' + ++sequence;
      emit('child-create', { childId: this.childId, url: String(url) });
    }
    terminate() {
      emit('child-terminate-call', { childId: this.childId });
      super.terminate();
      emit('child-terminate-return', { childId: this.childId });
    }
  };
  emit('host-boot');
}

// Two native nested Workers, one blocked on shared memory. Their script
// origins and explicit terminate/ack/close order match the engine topology.
const controlHost = `
let children = [];
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    const ready = [1, 2].map(id => new Promise(resolve => {
      const worker = new Worker('/tests/diagnostics/rel-06-child.js?id=' + id);
      children.push(worker);
      worker.onmessage = resolve;
      worker.postMessage(id);
    }));
    await Promise.all(ready);
    self.postMessage({type: 'loaded'});
  } else if (data.type === 'dispose') {
    for (const child of children) child.terminate();
    self.postMessage({type: 'disposed'});
    self.close();
  }
};
`;

async function setup(page: Page, cell: Cell) {
  await page.route('**/__rel06/index.html', route => route.fulfill({
    contentType: 'text/html',
    headers: isolationHeaders,
    body: '<!doctype html><title>REL-06 Worker lifecycle</title>',
  }));
  if (cell.detailed && cell.phase !== 'control') {
    await page.route('**/engine-host.js?rel06=*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: '(' + hostObserver.toString() + ')();\n' + await response.text() });
    });
  }
  if (cell.phase === 'control') {
    await page.route('**/__rel06/host.js?rel06=*', route => route.fulfill({
      contentType: 'text/javascript',
      headers: isolationHeaders,
      body: '(' + hostObserver.toString() + ')();\n' + controlHost,
    }));
  }
  await page.goto('/__rel06/index.html');
}

async function exercise(page: Page, cell: Cell, id: string) {
  return await page.evaluate(async ({ phase, action, id }) => {
    if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') throw new Error('Missing cross-origin isolation');
    const events: Event[] = [];
    (window as unknown as { rel06Events: Event[] }).rel06Events = events;
    const log = (event: string, data: Record<string, unknown> = {}) => {
      events.push({ epochMs: performance.timeOrigin + performance.now(), event, id, ...data });
    };
    const url = (phase === 'control' ? '/__rel06/host.js' : '/engine-host.js') + '?rel06=' + id;
    const host = new Worker(url, { name: 'shogi-wasm-host' });
    log('host-create', { url });
    const received: { type: string; line?: string }[] = [];
    let fallback: ReturnType<typeof setTimeout> | undefined;
    function terminate(reason: string) {
      log('host-terminate-call', { reason });
      host.terminate();
      log('host-terminate-return', { reason });
    }
    host.onmessage = ({ data }) => {
      if (data.type === 'rel06') {
        events.push(data);
        return;
      }
      received.push(data);
      if (data.type === 'disposed') {
        log('parent-ack');
        clearTimeout(fallback);
        if (action === 'host-close') log('host-owns-close');
        else terminate('ack');
      } else if (data.type === 'loaded') log('parent-loaded');
      else if (data.type === 'error') log('host-error', { error: data.error });
      else if (/^(bestmove |readyok$|usiok$)/.test(data.line ?? '')) log('engine-line', { line: data.line });
    };
    host.onerror = event => log('worker-error', { error: event.message });
    const send = (type: string, command?: string) => {
      log('parent-send', { typeSent: type, command });
      host.postMessage({ type, command });
    };
    const until = async (label: string, match: (msg: typeof received[number]) => boolean, after = 0, timeout = 5000) => {
      const end = performance.now() + timeout;
      while (performance.now() < end) {
        const msg = received.slice(after).find(match);
        if (msg) return msg;
        if (events.some(event => event.event === 'host-error' || event.event === 'worker-error'))
          throw new Error('Worker failed during ' + label);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error('Missing ' + label);
    };
    const line = (prefix: string) => (value: { line?: string }) => value.line?.startsWith(prefix) === true;
    const ready = async (timeout?: number) => {
      const after = received.length;
      send('command', 'isready');
      await until('readyok', line('readyok'), after, timeout);
    };
    send('init');
    if (phase !== 'startup') await until('loaded', msg => msg.type === 'loaded');
    if (phase !== 'startup' && phase !== 'control') {
      send('command', 'usi');
      await until('usiok', line('usiok'));
      send('command', 'setoption name USI_Variant value shogi');
      send('command', 'setoption name Threads value 1');
      send('command', 'setoption name USI_Hash value 16');
      send('command', 'setoption name Use_NNUE value false');
      await ready();
      send('command', 'usinewgame');
      await ready();
    }
    let bestmove: string | undefined;
    if (phase === 'active' || phase === 'completed') {
      send('command', 'position startpos moves 7g7f 3c3d');
      const start = received.length;
      send('command', phase === 'active' ? 'go movetime 10000' : 'go movetime 100');
      if (phase === 'completed') {
        bestmove = (await until('bestmove', line('bestmove '), start)).line;
      } else {
        const info = await until('positive-depth search output', msg => /^info depth [1-9]\d* /.test(msg.line ?? ''), start);
        log('search-observed', { line: info.line });
        if (received.slice(start).some(line('bestmove '))) throw new Error('Search already completed');
        if (action === 'drain') {
          send('command', 'stop');
          bestmove = (await until('stopped bestmove', line('bestmove '), start, 2000)).line;
          await ready(2000);
        }
      }
    }
    const disposeEpochMs = performance.timeOrigin + performance.now();
    fallback = setTimeout(() => terminate('fallback'), 2000);
    send('dispose');
    return { disposeEpochMs, bestmove, crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer };
  }, { ...cell, id });
}

for (const cell of cells) {
  const label = [cell.phase, cell.action, cell.detailed ? 'detailed' : 'minimal'].join('-');
  test.describe(label, () => {
    test.describe.configure({ mode: 'serial' });
    for (let trial = 1; trial <= 3; trial++) {
      test('trial ' + trial, async ({ page, browser, browserName }) => {
        expect(browserName).toBe('chromium');
        const id = label + '-' + trial;
        const cdp = await browser.newBrowserCDPSession();
        const timeline: Event[] = [];
        const known = new Map<string, { url: string; attached: boolean }>();
        type WorkerInfo = { targetId: string; url: string; type: string; attached: boolean; parentId?: string };
        const target = (event: string, { targetInfo }: { targetInfo: WorkerInfo }) => {
          if (targetInfo.type !== 'worker') return;
          const previous = known.get(targetInfo.targetId);
          known.set(targetInfo.targetId, targetInfo);
          timeline.push({ epochMs: epoch(), event, ...targetInfo });
          if ((!previous || previous.attached !== targetInfo.attached) && (previous || targetInfo.attached))
            timeline.push({ epochMs: epoch(), event: targetInfo.attached ? 'target-attached' : 'target-detached', targetId: targetInfo.targetId });
        };
        cdp.on('Target.targetCreated', e => target('target-created', e));
        cdp.on('Target.targetInfoChanged', e => target('target-changed', e));
        cdp.on('Target.targetDestroyed', ({ targetId }) => {
          if (known.has(targetId)) timeline.push({ epochMs: epoch(), event: 'target-destroyed', targetId });
        });
        let result: Awaited<ReturnType<typeof exercise>> | undefined;
        let remaining: WorkerInfo[] = [];
        let handles: string[] = [];
        let verdict = 'PASS';
        let error: string | undefined;
        const replies: unknown[] = [];
        const getWorkers = async () => (await bounded(cdp.send('Target.getTargets'), 750)).targetInfos.filter(t => t.type === 'worker');
        try {
          await cdp.send('Target.setDiscoverTargets', { discover: true });
          await setup(page, cell);
          result = await exercise(page, cell, id);
          do {
            remaining = await getWorkers();
            handles = page.workers().map(worker => worker.url());
            if (!remaining.length && !handles.length) break;
            if (epoch() >= result.disposeEpochMs + 5000) {
              for (const worker of remaining) replies.push({ targetId: worker.targetId, response: await probeWorker(cdp, worker.targetId, timeline) });
              throw new Error('Worker targets or Playwright handles remained at the five-second deadline');
            }
            await new Promise(resolve => setTimeout(resolve, 25));
          } while (true);
          expect([...known.values()].some(worker => worker.url.includes('rel06=' + id))).toBe(true);
        } catch (failure) {
          verdict = 'FAIL';
          error = String(failure);
          if (!result) {
            remaining = await getWorkers().catch(() => []);
            handles = page.workers().map(worker => worker.url());
          }
          throw failure;
        } finally {
          const pageEvents = await bounded(page.evaluate(() => (
            window as unknown as { rel06Events?: Event[] }
          ).rel06Events ?? []), 750).catch(() => []);
          mkdirSync('work/rel-06/cases', { recursive: true });
          writeFileSync('work/rel-06/cases/' + id + '.json', JSON.stringify({
            id, cell, trial, browser: browser.version(), verdict, error, result, remaining, handles, replies, timeline, pageEvents,
          }, null, 2) + '\n');
          await bounded(cdp.detach(), 750).catch(() => {});
        }
      });
    }
  });
}
