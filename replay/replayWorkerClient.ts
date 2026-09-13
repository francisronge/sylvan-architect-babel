import type { PreparedReplay, ReplayPreparationInput } from './prepareReplay.ts';

type PreparationWorker = Pick<Worker, 'onmessage' | 'onerror' | 'onmessageerror' | 'postMessage' | 'terminate'>;

/** One worker per preparation; completion, failure and cancellation all release it. */
export const startReplayPreparation = (
  input: ReplayPreparationInput,
  onReady: (result: PreparedReplay) => void,
  onError: (error: Error) => void,
  createWorker: () => PreparationWorker = () => new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' })
): (() => void) => {
  let worker: PreparationWorker | undefined;
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
  };
  const fail = (error: Error) => {
    if (!active) return;
    dispose();
    onError(error);
  };
  try {
    worker = createWorker();
    worker.onmessage = ({ data }: MessageEvent<{ result?: PreparedReplay; error?: string }>) => {
      if (!active) return;
      if (!data.result) {
        fail(new Error(data.error || 'Replay preparation returned no result.'));
        return;
      }
      dispose();
      onReady(data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'Replay preparation failed.'));
    };
    worker.onmessageerror = () => fail(new Error('Replay preparation could not be read.'));
    worker.postMessage(input);
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  }
  return dispose;
};
