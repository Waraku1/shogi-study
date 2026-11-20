// REL-06's completed / immediate protocol on an empty cross-origin-isolated page.
window.rel07Events = [];
window.rel07Run = async () => {
  if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function')
    throw new Error('Shared-memory isolation unavailable');

  const event = (name, detail) => {
    window.rel07Events.push({ epochMs: performance.timeOrigin + performance.now(), name, detail });
    if (['bestmove', 'dispose', 'disposed', 'terminate-return'].includes(name))
      performance.mark('rel07:' + name);
  };
  const host = new Worker('/engine-host.js', { name: 'shogi-wasm-host' });
  const received = [];
  let fallback;
  let error;

  const terminate = reason => {
    event('terminate-call', reason);
    host.terminate();
    event('terminate-return', reason);
  };
  host.onmessage = ({ data }) => {
    received.push(data);
    if (data.type === 'loaded') event('loaded', data.wasmMemoryBytes);
    if (data.type === 'error') error = data.error;
    if (data.type === 'disposed') {
      event('disposed');
      clearTimeout(fallback);
      terminate('ack');
    }
    if (/^(id name |usiok$|readyok$|bestmove )/.test(data.line ?? '')) {
      event(data.line.startsWith('bestmove ') ? 'bestmove' : 'line', data.line);
    }
  };
  host.onerror = e => { error = e.message; };

  const until = async (match, after = 0) => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (error) throw new Error(error);
      const item = received.slice(after).find(match);
      if (item) return item;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Engine handshake or result timed out');
  };
  const command = value => {
    event('command', value);
    host.postMessage({ type: 'command', command: value });
  };
  const ready = async () => {
    const after = received.length;
    command('isready');
    await until(data => data.line === 'readyok', after);
  };

  event('init');
  host.postMessage({ type: 'init' });
  await until(data => data.type === 'loaded');
  command('usi');
  await until(data => data.line === 'usiok');
  command('setoption name USI_Variant value shogi');
  command('setoption name Threads value 1');
  command('setoption name USI_Hash value 16');
  command('setoption name Use_NNUE value false');
  await ready();
  command('usinewgame');
  await ready();
  command('position startpos moves 7g7f 3c3d');
  const after = received.length;
  command('go movetime 100');
  const { line: bestmove } = await until(data => /^bestmove [1-9][a-i][1-9][a-i]\+?( |$)/.test(data.line ?? ''), after);
  event('dispose');
  fallback = setTimeout(() => terminate('fallback'), 2000);
  host.postMessage({ type: 'dispose' });
  return { bestmove, disposeEpochMs: window.rel07Events.at(-1).epochMs };
};
