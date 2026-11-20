import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

export const now = () => performance.timeOrigin + performance.now();
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Chromium's private debugging pipe has no listening port. The runner owns
// the only CDP connection, so every Target command is visible in the audit.
export class ChromiumPipe extends EventEmitter {
  commands = [];
  events = [];

  #pending = new Map();
  #nextId = 0;
  #frame = '';
  #stderr = '';
  #process;
  #exit;
  #closed = false;

  constructor(bin, flags, profile) {
    super();
    this.#process = spawn(bin, [...flags, '--user-data-dir=' + profile, 'about:blank'], {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      detached: true,
    });
    this.#exit = new Promise(resolve => {
      this.#process.once('exit', resolve);
      this.#process.once('error', resolve);
    });
    this.#process.stderr.setEncoding('utf8');
    this.#process.stderr.on('data', data => { this.#stderr = (this.#stderr + data).slice(-32000); });
    const [input, output] = this.#process.stdio.slice(3, 5);
    input.on('error', error => this.#fail(error));
    output.on('error', error => this.#fail(error));
    output.setEncoding('utf8');
    output.on('data', chunk => this.#read(chunk));
    this.#exit.then(() => this.#fail(new Error('Chromium control pipe closed')));
  }

  #read(chunk) {
    this.#frame += chunk;
    let end;
    while ((end = this.#frame.indexOf('\0')) !== -1) {
      const wire = this.#frame.slice(0, end);
      this.#frame = this.#frame.slice(end + 1);
      const message = JSON.parse(wire);
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (pending) pending(message);
      } else {
        const stamped = { epochMs: now(), ...message };
        if (message.method.startsWith('Target.')) this.events.push(stamped);
        this.emit(message.method, stamped);
      }
    }
  }

  #fail(error) {
    this.#closed = true;
    for (const settle of this.#pending.values()) settle({ error: { message: error.message } });
  }

  send(method, params = {}, sessionId, timeout = 2000) {
    if (this.#closed) return Promise.reject(new Error('Chromium control pipe closed'));
    const id = ++this.#nextId;
    const epochMs = now();
    const audit = { epochMs, id, method, sessionId };
    // Exclude bulky Runtime and trace transport payloads from protocol audits.
    if (method.startsWith('Target.')) audit.params = params;
    this.commands.push(audit);
    return new Promise((resolve, reject) => {
      const finish = message => {
        clearTimeout(timer);
        this.#pending.delete(id);
        audit.result = message.error ? message.error.message : 'OK';
        audit.completedEpochMs = now();
        if (message.error) reject(new Error(method + ': ' + message.error.message));
        else resolve(message.result);
      };
      const timer = setTimeout(() => finish({ error: { message: 'deadline exceeded' } }), timeout);
      this.#pending.set(id, finish);
      this.#process.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }

  async close(stderrFile) {
    await this.send('Browser.close', {}, undefined, 750).catch(() => {});
    const exited = await Promise.race([this.#exit.then(() => true), sleep(2000).then(() => false)]);
    if (!exited && this.#process.pid) {
      // Cleanup after the verdict and trace. The signal cannot affect either.
      try { process.kill(-this.#process.pid, 'SIGKILL'); } catch (err) {
        if (err.code !== 'ESRCH') throw err;
      }
      await this.#exit;
    }
    await writeFile(stderrFile, this.#stderr);
    return exited ? 'Browser.close' : 'process-group cleanup after capture';
  }
}

export async function stopTrace(cdp) {
  const controller = new AbortController();
  // This bounds trace transport after the shutdown verdict is already sampled.
  const timer = setTimeout(() => controller.abort(), 10000);
  const complete = once(cdp, 'Tracing.tracingComplete', { signal: controller.signal });
  try {
    const [, [{ params }]] = await Promise.all([cdp.send('Tracing.end'), complete]);
    if (!params.stream) throw new Error('Trace returned no stream');
    const deadline = now() + 10000;
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        if (now() > deadline || bytes >= 32 * 1024 * 1024) throw new Error('Trace read exceeded budget');
        const { data, eof, base64Encoded } = await cdp.send('IO.read', { handle: params.stream, size: 262144 });
        const chunk = Buffer.from(data, base64Encoded ? 'base64' : 'utf8');
        chunks.push(chunk);
        bytes += chunk.length;
        if (eof) break;
      }
    } finally {
      await cdp.send('IO.close', { handle: params.stream }).catch(() => {});
    }
    return { data: Buffer.concat(chunks), dataLoss: params.dataLossOccurred };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
