import type { CandidateMove, EngineAdapter, EngineDiagnostics, SearchPosition, SearchResult } from '../../shared/contracts/engine';
import { isUSIMove, parseInfo, parseOption, positionCommand } from './usi';
import type { USIOption } from './usi';

type Waiter = { matches: (line: string) => boolean; resolve: (line: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type ActiveSearch = {
  candidates: Map<number, CandidateMove>;
  started: number;
  promise: Promise<SearchResult>;
  resolve: (result: SearchResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class WasmEngineAdapter implements EngineAdapter {
  diagnostics: EngineDiagnostics | null = null;
  readonly transcript: string[] = [];
  private worker: Worker | null = null;
  private initializing: Promise<void> | null = null;
  private waiters = new Set<Waiter>();
  private options: USIOption[] = [];
  private active: ActiveSearch | null = null;
  private disposed = false;
  private failure: Error | null = null;
  private searching = false;
  private stopRequested = false;
  private idle: Promise<void> | null = null;
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownSent = false;

  init(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Engine disposed'));
    if (this.failure) return Promise.reject(this.failure);
    return this.initializing ??= this.initialize();
  }

  private async initialize(): Promise<void> {
    const started = performance.now();
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      throw new Error('This engine requires cross-origin isolation (COOP/COEP) and SharedArrayBuffer. Use the local Vite server.');
    }
    this.worker = new Worker('/engine-host.js', { name: 'shogi-wasm-host' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'disposed') {
        if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
        this.worker?.terminate();
        this.worker = null;
      } else if (this.disposed) {
        return;
      } else if (data.type === 'error') this.fail(new Error(data.error));
      else if (data.type === 'loaded') {
        this.diagnostics = { name: '', startupMs: 0, wasmMemoryBytes: data.wasmMemoryBytes, multiPvMax: 1, options: [] };
        this.line('__loaded');
      } else if (data.type === 'line') {
        if (data.wasmMemoryBytes && this.diagnostics) this.diagnostics.wasmMemoryBytes = data.wasmMemoryBytes;
        this.line(String(data.line));
      }
    };
    this.worker.onerror = event => this.fail(new Error(`WASM worker failed: ${event.message}`));
    this.worker.onmessageerror = () => this.fail(new Error('WASM worker message could not be decoded'));
    try {
      const loaded = this.waitFor(line => line === '__loaded');
      this.worker.postMessage({ type: 'init' });
      await loaded;
      await this.commandUntil('usi', 'usiok');
      const variant = this.findOption('USI_Variant', 'UCI_Variant');
      if (!variant || !/(?:\bvar |\bdefault )shogi(?: |$)/.test(variant.line)) throw new Error('WASM artifact does not advertise Shogi');
      this.send(`setoption name ${variant.name} value shogi`);
      this.setOption(['Threads'], '1');
      this.setOption(['USI_Hash', 'Hash'], '16');
      this.setOption(['Use_NNUE', 'Use NNUE'], 'false');
      await this.commandUntil('isready', 'readyok');
      this.send('usinewgame');
      this.diagnostics!.startupMs = performance.now() - started;
      this.diagnostics!.multiPvMax = this.findOption('USI_MultiPV', 'MultiPV')?.max ?? 1;
      this.diagnostics!.options = this.options.map(option => option.line);
    } catch (error) {
      // dispose already rejected callers; let its worker shutdown handshake clean
      // up pending pthreads instead of terminating their host mid-initialization.
      if (!this.disposed) this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async search(position: SearchPosition, options: { maxTimeMs: number; multiPv: number }): Promise<SearchResult> {
    if (this.searching) throw new Error('A search is already running');
    this.searching = true;
    this.stopRequested = false;
    let markIdle!: () => void;
    this.idle = new Promise<void>(resolve => { markIdle = resolve; });
    try {
      await this.init();
      if (this.stopRequested) throw new DOMException('Search stopped', 'AbortError');
      const command = positionCommand(position);
      if (!Number.isInteger(options.maxTimeMs) || options.maxTimeMs < 1 || options.maxTimeMs > 10000) throw new Error('Search time must be 1–10000 ms');
      if (!Number.isInteger(options.multiPv) || options.multiPv < 1) throw new Error('MultiPV must be a positive integer');
      this.setOption(['USI_MultiPV', 'MultiPV'], String(Math.min(options.multiPv, this.diagnostics!.multiPvMax)));
      await this.commandUntil('isready', 'readyok');
      if (this.stopRequested) throw new DOMException('Search stopped', 'AbortError');
      this.send(command);
      let resolve!: ActiveSearch['resolve'];
      let reject!: ActiveSearch['reject'];
      const promise = new Promise<SearchResult>((yes, no) => { resolve = yes; reject = no; });
      this.active = {
        candidates: new Map(), started: performance.now(), promise, resolve, reject,
        timer: setTimeout(() => this.fail(new Error('Engine search timed out')), options.maxTimeMs + 5000),
      };
      this.send(`go movetime ${options.maxTimeMs}`);
      return await promise;
    } finally { this.searching = false; markIdle(); this.idle = null; }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const active = this.active;
    if (!active) { await this.idle; return; }
    this.send('stop');
    const timer = setTimeout(() => this.fail(new Error('Engine did not acknowledge stop')), 2000);
    try { await active.promise; } finally { clearTimeout(timer); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectPending(new Error('Engine disposed'));
    const worker = this.worker;
    if (worker) {
      this.shutdownTimer = setTimeout(() => { worker.terminate(); if (this.worker === worker) this.worker = null; }, 2000);
      // Disposal discards every owner of this heap. The bridge terminates its
      // children directly without allocator teardown. Do not wait for a USI
      // stop/bestmove race: an early stop can be reset by the starting search,
      // and killing only the host at the deadline can orphan its pthread.
      // stop() remains the separate, reusable graceful-search operation.
      this.shutdown();
    }
  }

  private shutdown(): void {
    if (this.shutdownSent) return;
    this.shutdownSent = true;
    this.worker?.postMessage({ type: 'dispose' });
  }

  private send(command: string): void {
    if (this.disposed) throw new Error('Engine disposed');
    if (this.failure) throw this.failure;
    if (!this.worker) throw new Error('Engine has not loaded');
    this.transcript.push(`> ${command}`);
    this.worker.postMessage({ type: 'command', command });
  }

  private waitFor(matches: Waiter['matches']): Promise<string> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { matches, resolve, reject, timer: setTimeout(() => this.fail(new Error('USI initialization/readiness timed out')), 15000) };
      this.waiters.add(waiter);
    });
  }
  private commandUntil(command: string, response: string): Promise<string> {
    const ready = this.waitFor(line => line === response);
    try { this.send(command); } catch (error) { this.fail(error as Error); }
    return ready;
  }
  private findOption(...names: string[]): USIOption | undefined { return this.options.find(option => names.includes(option.name)); }
  private setOption(names: string[], value: string): void {
    const option = this.findOption(...names);
    if (option) this.send(`setoption name ${option.name} value ${value}`);
  }
  private line(line: string): void {
    if (this.disposed) return;
    this.transcript.push(line);
    if (this.transcript.length > 1000) this.transcript.splice(0, this.transcript.length - 1000);
    if (line.startsWith('id name ') && this.diagnostics) this.diagnostics.name = line.slice(8);
    const option = parseOption(line);
    if (option) this.options.push(option);
    for (const waiter of this.waiters) {
      if (waiter.matches(line)) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve(line);
      }
    }
    const active = this.active;
    if (!active) return;
    const info = parseInfo(line);
    if (info) active.candidates.set(info.multiPv, info);
    if (line.startsWith('bestmove ')) {
      const token = line.trim().split(/\s+/)[1];
      if (!isUSIMove(token) && !['resign', 'win', '(none)', '0000'].includes(token)) {
        this.fail(new Error(`Invalid bestmove received: ${token}`));
        return;
      }
      clearTimeout(active.timer);
      this.active = null;
      active.resolve({ bestMoveUSI: isUSIMove(token) ? token : null,
        terminal: token === 'resign' || token === 'win' ? token : isUSIMove(token) ? null : 'none',
        candidates: [...active.candidates.values()].sort((a, b) => a.multiPv - b.multiPv),
        elapsedMs: performance.now() - active.started });
    }
  }
  private rejectPending(error: Error): void {
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.waiters.clear();
    if (this.active) { clearTimeout(this.active.timer); this.active.reject(error); this.active = null; }
  }
  private fail(error: Error): void {
    this.failure ??= error;
    this.rejectPending(error);
    this.worker?.terminate();
    this.worker = null;
  }
}
