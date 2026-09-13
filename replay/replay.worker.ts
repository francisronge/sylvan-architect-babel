import { prepareReplay, type ReplayPreparationInput } from './prepareReplay.ts';

self.onmessage = (event: MessageEvent<ReplayPreparationInput>) => {
  try {
    self.postMessage({ result: prepareReplay(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
