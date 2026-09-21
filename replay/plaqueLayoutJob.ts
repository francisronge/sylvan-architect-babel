import { buildReplayPlaqueLayouts, measureStagePlaqueSpace, type StageLayoutInput } from './stageCamera.ts';
import { prepareStagePlaqueRequests } from './relations/plaquePlacement.ts';
import type { PlaqueTextMetrics, PlaqueTextStyle } from './relations/plaqueTextLayout.ts';

export type PlaqueLayoutInput = Omit<StageLayoutInput, 'measurePlaqueText' | 'measureCategoryText'>;
export type PlaqueLayoutJob = {
  input: PlaqueLayoutInput;
  categories: Map<string, number>;
  plaques: Map<string, PlaqueTextMetrics>;
};
const textKey = (text: string, style: PlaqueTextStyle) => JSON.stringify([text, style]);

/** Capture browser font metrics; allocation itself needs no DOM or font access. */
export function* measurePlaqueLayoutJob(input: StageLayoutInput): Generator<void, PlaqueLayoutJob> {
  const categories = new Map<string, number>();
  const plaques = new Map<string, PlaqueTextMetrics>();
  const measureCategoryText = input.measureCategoryText && ((text: string) => {
    if (!categories.has(text)) categories.set(text, input.measureCategoryText!(text));
    return categories.get(text)!;
  });
  const measurePlaqueText = input.measurePlaqueText && ((text: string, style: PlaqueTextStyle) => {
    const key = textKey(text, style);
    if (!plaques.has(key)) plaques.set(key, input.measurePlaqueText!(text, style));
    return plaques.get(key)!;
  });
  for (let stageIndex = 0; stageIndex < (input.plan?.frames.length ?? 0); stageIndex++) {
    const space = measureStagePlaqueSpace({ ...input, stageIndex, measureCategoryText });
    prepareStagePlaqueRequests(input.plan!.frames[stageIndex].items, space.nodes, measurePlaqueText);
    yield;
  }
  const { measureCategoryText: _category, measurePlaqueText: _plaque, ...serializable } = input;
  return { input: serializable, categories, plaques };
}

/** Missing metrics are an error, never a silent change to the browser's geometry. */
export function runPlaqueLayoutJob(job: PlaqueLayoutJob) {
  const required = <T>(map: Map<string, T>, key: string): T => {
    if (!map.has(key)) throw new Error('Missing measured text in Replay layout.');
    return map.get(key)!;
  };
  return buildReplayPlaqueLayouts({ ...job.input,
    measureCategoryText: job.categories.size ? text => required(job.categories, text) : undefined,
    measurePlaqueText: job.plaques.size ? (text, style) => required(job.plaques, textKey(text, style)) : undefined
  });
}
