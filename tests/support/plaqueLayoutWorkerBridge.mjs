import { parentPort } from 'node:worker_threads';
globalThis.self = { postMessage: value => parentPort.postMessage(value) };
await import('../../replay/plaqueLayout.worker.ts');
parentPort.on('message', data => self.onmessage({ data }));
