import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChromiumPipe, now, sleep, stopTrace } from './rel-07-cdp.mjs';

const bin = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const output = process.argv[2] ?? 'work/rel-07/comparison';
const trialsPerArm = 12;
const cutoffMs = 5000;
const flags = [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--remote-debugging-pipe',
];
const categories = ['blink', 'blink.worker', 'blink.user_timing', 'devtools.timeline', 'renderer.scheduler', 'toplevel', 'v8'];
const attachOptions = {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
  filter: [{ type: 'worker' }, { exclude: true }],
};
const sha256 = data => createHash('sha256').update(data).digest('hex');
const json = data => JSON.stringify(data, null, 2) + '\n';

async function localAssets() {
  const assets = new Map();
  const put = (path, type, data) => assets.set(path, { type, data });
  const provenance = JSON.parse(await readFile('docs/engine-provenance.json', 'utf8'));
  const hashes = {};
  for (const [name, expected] of Object.entries(provenance.files)) {
    const data = await readFile('public/engine/' + name);
    const digest = sha256(data);
    if (digest !== expected.sha256 || data.length !== expected.bytes) throw new Error('Engine pin mismatch for ' + name);
    hashes[name] = digest;
    if (name === 'stockfish.wasm') put('/engine/' + name, 'application/wasm', data);
    if (name.endsWith('.js')) put('/engine/' + name, 'text/javascript', data);
  }
  const bridge = await readFile('public/engine-host.js');
  const baselineBridge = execFileSync('git', ['show', '3040618b574c2d763ac093206be06cba42e91464:public/engine-host.js']);
  if (!bridge.equals(baselineBridge)) throw new Error('Bridge differs from the REL-06 baseline');
  put('/engine-host.js', 'text/javascript', bridge);
  put('/driver.js', 'text/javascript', await readFile('tests/diagnostics/rel-07-page.js'));
  put('/', 'text/html', Buffer.from('<!doctype html><title>REL-07</title><script src="/driver.js"></script>'));
  return { assets, hashes, bridgeHash: sha256(bridge), engine: provenance.version };
}

async function evaluate(cdp, sessionId, expression, timeout = 1000) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId, timeout);
  if (exceptionDetails) throw new Error(result.description ?? 'Page evaluation failed');
  return result.value;
}

async function workerProbe(cdp, worker) {
  const probe = { targetId: worker.targetId, startEpochMs: now() };
  let sessionId;
  try {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true }, undefined, 500));
    probe.attachedEpochMs = now();
    probe.reply = await evaluate(cdp, sessionId, 'self.location.pathname', 500);
  } catch (error) {
    probe.error = String(error);
  } finally {
    if (sessionId) {
      try {
        await cdp.send('Target.detachFromTarget', { sessionId }, undefined, 500);
        probe.detachedEpochMs = now();
      } catch (error) {
        probe.detachError = String(error);
      }
    }
  }
  return probe;
}

function checkAttachment(cdp, arm, trial, pageId, pageSession) {
  const known = new Map();
  const automatic = new Set();
  const destroyed = new Map();
  for (const { method, params, epochMs } of cdp.events) {
    if (epochMs > trial.sampleEpochMs) break;
    const target = params.targetInfo;
    if (target?.type === 'worker') {
      const record = known.get(target.targetId) ?? { attachedSeen: false };
      known.set(target.targetId, {
        ...record, ...target, attachedSeen: record.attachedSeen || target.attached,
      });
      if (method === 'Target.attachedToTarget') automatic.add(target.targetId);
    }
    if (method === 'Target.targetDestroyed') destroyed.set(params.targetId, epochMs);
  }
  for (const target of trial.remaining) {
    const recorded = known.get(target.targetId);
    if (!recorded) throw new Error('Remaining Worker was absent from discovery history');
    recorded.attachedSeen ||= target.attached;
  }
  const all = [...known.values()];
  // An unattached Chromium Worker target can have an empty URL for its
  // entire lifetime. Correlate its parent tree and the only served scripts.
  const matches = (target, path) => !target.url || target.url === trial.origin + path;
  const host = all.find(target => target.parentId === pageId && matches(target, '/engine-host.js'));
  if (!host) throw new Error('Missing host identity');
  const children = all.filter(target => target.parentId === host.targetId && matches(target, '/engine/stockfish.worker.js'));
  if (all.length !== 3 || children.length !== 2) throw new Error('Expected one host and two pinned pthread targets');
  for (const path of ['/engine-host.js', '/engine/stockfish.js', '/engine/stockfish.wasm', '/engine/stockfish.worker.js']) {
    if (!trial.requests.some(request => request.path === path)) throw new Error('Missing local fetch of ' + path);
  }
  const commands = cdp.commands.filter(command => command.epochMs <= trial.sampleEpochMs);
  const autoAttach = commands.filter(command => command.method === 'Target.setAutoAttach');
  const manualWorkerAttach = commands.some(command => command.method === 'Target.attachToTarget' && known.has(command.params.targetId));
  trial.attachment = {
    autoAttach, pageSession, manualWorkerAttach, automaticWorkerTargetIds: [...automatic],
    workers: [host, ...children].map(worker => ({
      targetId: worker.targetId, parentId: worker.parentId, url: worker.url,
      attachedSeen: worker.attachedSeen, destroyedEpochMs: destroyed.get(worker.targetId),
    })),
  };
  if (manualWorkerAttach) throw new Error('A Worker was manually attached before the cutoff');
  if (arm === 'A') {
    if (autoAttach.length !== 2 || autoAttach.some(command => command.result !== 'OK') ||
        automatic.size !== 3 || all.some(worker => !automatic.has(worker.targetId)))
      throw new Error('Missing host or pthread auto-attachment in A');
    const beforeDispose = cdp.events.filter(event => event.method === 'Target.attachedToTarget' &&
      event.params.targetInfo.type === 'worker' && event.epochMs <= trial.result.disposeEpochMs);
    if (beforeDispose.length !== 3) throw new Error('A attached a Worker too late');
  } else if (autoAttach.length || automatic.size || all.some(worker => worker.attachedSeen)) {
    throw new Error('Worker attachment detected in B before the cutoff');
  }
  for (const worker of trial.attachment.workers) {
    if (!trial.remaining.some(target => target.targetId === worker.targetId) &&
        (!worker.destroyedEpochMs || worker.destroyedEpochMs > trial.result.disposeEpochMs + cutoffMs))
      throw new Error('Ambiguous Worker destruction at the cutoff');
  }
}

async function runTrial(origin, arm, index, requests) {
  const id = arm + String(index).padStart(2, '0');
  const prefix = join(output, id);
  const profile = await mkdtemp(join(tmpdir(), 'rel07-chromium-'));
  const cdp = new ChromiumPipe(bin, flags, profile);
  const trial = { id, arm, index, origin, outcome: 'INVALID', requests: [] };
  const requestStart = requests.length;
  let tracing = false;
  let pageSession;
  try {
    trial.version = await cdp.send('Browser.getVersion');
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetId: pageId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: pageSession } = await cdp.send('Target.attachToTarget', { targetId: pageId, flatten: true }));
    const attachErrors = [];
    if (arm === 'A') {
      cdp.on('Target.attachedToTarget', ({ sessionId, params }) => {
        // Page auto-attaches the host. Its session auto-attaches both pthreads.
        if (sessionId === pageSession && params.targetInfo.type === 'worker') {
          void cdp.send('Target.setAutoAttach', attachOptions, params.sessionId).catch(error => attachErrors.push(String(error)));
        }
      });
      await cdp.send('Target.setAutoAttach', attachOptions, pageSession);
    }
    await cdp.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      traceConfig: { includedCategories: categories, recordMode: 'recordUntilFull', traceBufferSizeInKb: 16384 },
    });
    tracing = true;
    const nav = await cdp.send('Page.navigate', { url: origin + '/' }, pageSession);
    if (nav.errorText) throw new Error(nav.errorText);
    const pageDeadline = now() + 5000;
    while (!(await evaluate(cdp, pageSession, "typeof window.rel07Run === 'function'").catch(() => false))) {
      if (now() > pageDeadline) throw new Error('Isolated driver unavailable');
      await sleep(25);
    }
    trial.result = await evaluate(cdp, pageSession, 'window.rel07Run()', 15000);
    await sleep(Math.max(0, trial.result.disposeEpochMs + cutoffMs - now()));
    const { targetInfos } = await cdp.send('Target.getTargets', {}, undefined, 750);
    trial.sampleEpochMs = now();
    trial.remaining = targetInfos.filter(target => target.type === 'worker');
    if (trial.sampleEpochMs - trial.result.disposeEpochMs > cutoffMs + 100)
      throw new Error('Late cutoff sample');
    trial.pageEvents = await evaluate(cdp, pageSession, 'window.rel07Events');
    trial.requests = requests.slice(requestStart);
    if (attachErrors.length) throw new Error(attachErrors.join('; '));
    checkAttachment(cdp, arm, trial, pageId, pageSession);
    trial.outcome = trial.remaining.length ? 'FAIL' : 'PASS';
  } catch (error) {
    trial.error = String(error);
  } finally {
    // Submit Tracing.end before the post-cutoff probe. The buffering/stream
    // transport can continue while the separately bounded probe runs.
    const trace = tracing ? stopTrace(cdp).catch(error => ({ error: String(error) })) : undefined;
    trial.preProbeAudit = { commands: [...cdp.commands], events: [...cdp.events] };
    trial.probes = [];
    for (const worker of trial.remaining ?? []) trial.probes.push(await workerProbe(cdp, worker));
    if (trace) {
      try {
        const { data, dataLoss, error } = await trace;
        if (error) throw new Error(error);
        await writeFile(prefix + '.trace.json', data);
        trial.trace = { path: prefix + '.trace.json', sha256: sha256(data), bytes: data.length, dataLoss };
        if (dataLoss !== false) throw new Error('Tracing did not report a complete buffer');
      } catch (error) {
        trial.traceError = String(error);
        trial.outcome = 'INVALID';
      }
    }
    trial.cleanup = await cdp.close(prefix + '.stderr.log');
    trial.commands = cdp.commands;
    trial.events = cdp.events;
    await writeFile(prefix + '.json', json(trial));
    await rm(profile, { recursive: true, force: true });
  }
  console.log(id, trial.outcome, trial.result?.bestmove ?? '', trial.error ?? trial.traceError ?? '', trial.probes.map(probe => probe.error ?? probe.reply));
  return { id, arm, outcome: trial.outcome };
}

// Reserve a distinct evidence directory. Earlier runs remain available even
// after an invalid setup attempt.
await mkdir('work/rel-07', { recursive: true });
await mkdir(output);
const { assets, ...pins } = await localAssets();
const requests = [];
const server = createServer((req, res) => {
  const asset = assets.get(req.url);
  if (!asset || req.method !== 'GET') {
    res.writeHead(404).end();
    return;
  }
  requests.push({ epochMs: now(), path: req.url });
  res.writeHead(200, {
    'Content-Type': asset.type, 'Content-Length': asset.data.length, 'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  res.end(asset.data);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const summary = {
  baseline: '3040618b574c2d763ac093206be06cba42e91464',
  headAtRun: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, architecture: process.arch,
  bin, flags, categories, cutoffMs, planned: trialsPerArm * 2,
  ...pins, trials: [],
};
try {
  for (let index = 1; index <= trialsPerArm; index++) {
    for (const arm of ['A', 'B']) {
      summary.trials.push(await runTrial(origin, arm, index, requests));
      await writeFile(join(output, 'run.json'), json(summary));
    }
    // Diagnose a failed isolation/trace setup before spending the full budget.
    if (summary.trials.some(trial => trial.outcome === 'INVALID')) break;
  }
} finally {
  server.close();
}
process.exitCode = summary.trials.some(trial => trial.outcome !== 'PASS') ? 1 : 0;
