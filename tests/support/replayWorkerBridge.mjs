import { parentPort } from 'node:worker_threads';

// Exercise the browser worker entry point using Node's structured-clone transport.
globalThis.self = { postMessage: value => parentPort.postMessage(value) };
await import('../../replay/replay.worker.ts');
parentPort.on('message', data => self.onmessage({ data }));
