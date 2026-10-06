import { startWorkerJob } from './replayWorkerClient.ts';

type LayoutWorker = Pick<Worker, 'onmessage' | 'onerror' | 'onmessageerror' | 'postMessage' | 'terminate'>;

/** Orchard mounts many cards together. Serialize their layout workers without
 * changing Replay compilation or keeping cancelled requests alive in the queue. */
export function createLayoutWorkerQueue() {
  type Entry = { start: () => void; stop?: () => void; settled: boolean };
  const pending: Entry[] = [];
  let active: Entry | undefined, draining = false;
  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      while (!active && pending.length) {
        const entry = pending.shift()!;
        if (entry.settled) continue;
        active = entry;
        entry.start();
      }
    } finally { draining = false; }
  };
  return function startQueuedJob<Input, Result, Progress = never>(input: Input | Promise<Input>, onReady: (result: Result) => void,
    onError: (error: Error) => void, createWorker: () => LayoutWorker, onProgress?: (progress: Progress) => void): () => void {
    // A cancelled/queued request can reject before it owns the worker slot.
    // The active worker still receives that rejection through its own handler.
    if (input instanceof Promise) void input.catch(() => {});
    const finish = (callback: () => void) => {
      if (entry.settled) return;
      entry.settled = true;
      if (active === entry) active = undefined;
      try { callback(); } finally { drain(); }
    };
    const entry: Entry = { settled: false, start: () => {
      entry.stop = startWorkerJob<Input, Result, Progress>(input, result => finish(() => onReady(result)),
        error => finish(() => onError(error)), createWorker, progress => {
          if (!entry.settled) onProgress?.(progress);
        });
    } };
    pending.push(entry);
    drain();
    return () => {
      if (entry.settled) return;
      entry.settled = true;
      const index = pending.indexOf(entry);
      if (index !== -1) pending.splice(index, 1);
      if (active === entry) {
        entry.stop?.();
        active = undefined;
        drain();
      }
    };
  };
}

export const startQueuedLayoutJob = createLayoutWorkerQueue();
