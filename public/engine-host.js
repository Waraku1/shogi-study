/* Local, classic-worker bridge for the upstream Emscripten factory and pthread packaging.
 * The unmodified upstream files are prepared locally, never committed here. */
let engine;
// The factory can create pthread workers before its ready promise resolves.
// Keep those handles so disposal during startup also terminates every child.
const children = new Set();
const NativeWorker = self.Worker;
self.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); children.add(this); }
  terminate() { children.delete(this); super.terminate(); }
};
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      importScripts('/engine/stockfish.js');
      engine = await Stockfish({
        locateFile: file => new URL('/engine/' + file, self.location.origin).href,
        mainScriptUrlOrBlob: new URL('/engine/stockfish.js', self.location.origin).href,
      });
      engine.addMessageListener(line => self.postMessage({ type: 'line', line,
        wasmMemoryBytes: line.startsWith('bestmove ') ? engine.HEAPU8.buffer.byteLength : undefined }));
      self.postMessage({ type: 'loaded', wasmMemoryBytes: engine.HEAPU8.buffer.byteLength });
    } else if (data.type === 'command') {
      if (!engine) throw new Error('Engine has not loaded');
      engine.postMessage(data.command);
    } else if (data.type === 'dispose') {
      engine?.terminate();
      for (const child of children) child.terminate();
      self.postMessage({ type: 'disposed' });
      self.close();
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error) });
  }
};
self.addEventListener('unhandledrejection', event => {
  self.postMessage({ type: 'error', error: String(event.reason) });
});
