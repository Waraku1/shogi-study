// Same-origin control served by the local Vite server to a nested Worker.
self.onmessage = ({ data }) => {
  self.postMessage('started');
  if (data === 2) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
};
