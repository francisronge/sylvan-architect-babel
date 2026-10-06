import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { cloneSyntaxTree, isSyntheticWorkspaceRootNode, isUnderTriangulation, markTriangulatedNodes } from './replayCompiler.ts';
import { categoryTextLayout } from './categoryTextLayout.ts';
import { buildStageCoordinateReservations } from './stageCoordinates.ts';
import { buildReplayPlaqueSchedule, stageTreeLayoutSize, type StageLayoutInput, type MeasuredStageCoordinates, type ReplayPlaqueSchedule } from './stageCamera.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';
import { prepareStagePlaqueRequests } from './relations/plaquePlacement.ts';
import type { PlaqueTextMetrics, PlaqueTextStyle } from './relations/plaqueTextLayout.ts';
import { collectTreeInkMeasurements, type TreeInkTextMetrics, type TreeInkTextStyle } from './treeInkGeometry.ts';
import { treeLabelRunKey, type TreeLabelRuns, type TreeLabelBounds } from './treeLabelRuns.ts';

export type PlaqueLayoutInput = Omit<StageLayoutInput, 'measurePlaqueText' | 'measureCategoryText' | 'measureTreeInk' | 'measureTreeLabel'>;
export type PlaqueLayoutJob = {
  input: PlaqueLayoutInput;
  inputKey: string;
  requestKey: string;
  progressStage?: number;
  measured: { categories: boolean; plaques: boolean };
  categories: Map<string, number>;
  plaques: Map<string, PlaqueTextMetrics>;
  treeInk?: Map<string, TreeInkTextMetrics | undefined>;
  treeLabels?: Map<string, TreeLabelBounds | undefined>;
};
/** Canvas ordinals survive structured clone without pretending cloned objects
 * are the renderer's original canvas identities. */
export type PlaqueLayoutResult = {
  requestKey: string;
  measurementKey: string;
  schedule: ReplayPlaqueSchedule;
  coordinates: Map<number, Map<number, TreeCoordinateReservation>>;
};
export type PlaqueLayoutProgress = PlaqueLayoutResult & { preparedStages: number[] };
export type PreparedPlaqueLayout = { schedule: ReplayPlaqueSchedule; coordinates: MeasuredStageCoordinates };
const textKey = (text: string, style: PlaqueTextStyle | TreeInkTextStyle) => JSON.stringify([text, style]);

/** Preserve exact structured-clone values and graph sharing in request receipts. */
function valueKey(value: unknown): string {
  const references = new Map<object, number>();
  const encode = (entry: unknown): unknown => {
    if (entry === undefined) return ['undefined'];
    if (typeof entry === 'number') return ['number', Object.is(entry, -0) ? '-0' : String(entry)];
    if (entry === null || typeof entry !== 'object') return entry;
    const prior = references.get(entry);
    if (prior !== undefined) return ['reference', prior];
    const id = references.size;
    references.set(entry, id);
    if (entry instanceof Map) return ['map', id, [...entry].map(([key, value]) => [encode(key), encode(value)])];
    if (entry instanceof Set) return ['set', id, [...entry].map(encode)];
    if (Array.isArray(entry)) return ['array', id, Array.from({ length: entry.length }, (_, index) =>
      index in entry ? encode(entry[index]) : ['hole'])];
    return ['object', id, Object.entries(entry).map(([key, value]) => [key, encode(value)])];
  };
  return JSON.stringify(encode(value));
}
function serializableInput(input: StageLayoutInput): PlaqueLayoutInput {
  const { measureCategoryText: _category, measurePlaqueText: _plaque, measureTreeInk: _ink, measureTreeLabel: _label, ...serializable } = input;
  return serializable;
}
function canvases(input: PlaqueLayoutInput): SyntaxNode[] {
  return [...new Set([...input.steps.flatMap(step => step.replayCanvasData ? [step.replayCanvasData] : []), input.completedCanvas])];
}
function measurementFunctions(input: StageLayoutInput) {
  return [input.measureCategoryText, input.measurePlaqueText, input.measureTreeInk, input.measureTreeLabel] as const;
}
export function measuredKey(job: Pick<PlaqueLayoutJob, 'measured' | 'categories' | 'plaques' | 'treeInk' | 'treeLabels'>) {
  return valueKey([job.measured, job.categories, job.plaques, job.treeInk, job.treeLabels]);
}
let nextRequest = 0;
const bindings = new WeakMap<PlaqueLayoutJob, {
  input: StageLayoutInput; canvases: SyntaxNode[]; functions: ReturnType<typeof measurementFunctions>; measuredKey: string;
}>();

/** Collect only font probes. No coordinate, contour, or plaque allocation runs
 * on this side of the worker boundary. Every node/canvas is a cancellation point. */
export function* measurePlaqueLayoutJob(input: StageLayoutInput): Generator<void, PlaqueLayoutJob> {
  const inputKey = valueKey(serializableInput(input));
  const snapshot = structuredClone(serializableInput(input));
  const sourceCanvases = canvases(input), functions = measurementFunctions(input);
  const assertCurrent = () => {
    if (functions.some((fn, index) => fn !== measurementFunctions(input)[index]))
      throw new Error('Replay layout input changed during measurement.');
  };
  const categories = new Map<string, number>(), plaques = new Map<string, PlaqueTextMetrics>();
  // Styled-label bounds own the complete ink path, including their conservative
  // fallback. Legacy font envelopes are never consumed alongside that path.
  const treeInk = input.measureTreeInk && !input.measureTreeLabel
    ? new Map<string, TreeInkTextMetrics | undefined>() : undefined;
  const treeLabels = input.measureTreeLabel ? new Map<string, TreeLabelBounds | undefined>() : undefined;
  const measureCategoryText = input.measureCategoryText && ((text: string) => {
    if (!categories.has(text)) categories.set(text, functions[0]!(text));
    return categories.get(text)!;
  });
  const measurePlaqueText = input.measurePlaqueText && ((text: string, style: PlaqueTextStyle) => {
    const key = textKey(text, style);
    if (!plaques.has(key)) plaques.set(key, functions[1]!(text, style));
    return plaques.get(key)!;
  });
  const measureTreeInk = treeInk && ((text: string, style: TreeInkTextStyle) => {
    const key = textKey(text, style);
    if (!treeInk!.has(key)) treeInk!.set(key, functions[2]!(text, style));
    return treeInk!.get(key);
  });
  const measureTreeLabel = input.measureTreeLabel && ((run: TreeLabelRuns) => {
    const key = treeLabelRunKey(run);
    if (!treeLabels!.has(key)) treeLabels!.set(key, functions[3]!(run));
    return treeLabels!.get(key);
  });
  const seen = new Set<SyntaxNode>();
  for (const canvas of canvases(snapshot)) {
    const pending = [canvas];
    while (pending.length) {
      assertCurrent();
      const node = pending.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      const layout = categoryTextLayout(node.label || '', measureCategoryText);
      layout.lines.forEach(line => measureCategoryText?.(line));
      collectTreeInkMeasurements(node.label || '', node.word, measureCategoryText, measureTreeInk);
      pending.push(...node.children ?? []);
      assertCurrent();
      yield;
    }
    for (const runs of snapshot.treeLabelRuns?.get(canvas)?.values() ?? []) {
      assertCurrent();
      runs.forEach(run => measureTreeLabel?.(run));
      assertCurrent();
      yield;
    }
  }
  // Plaque text depends on the current hierarchy, not its coordinates. Probe
  // every current subset and the complete canvas: merged scenes union their
  // visibility, while a theta predicate follows the unpruned unary hierarchy.
  for (let stageIndex = 0; stageIndex < (snapshot.plan?.frames.length ?? 0); stageIndex++) {
    const steps = snapshot.steps.filter(step => step.replayFrameIndex === stageIndex && step.replayCanvasData);
    const scenes = [...steps.map(step => ({ canvas: step.replayCanvasData!, visible: step.replayVisibleNodeIds })),
      ...[...new Set(steps.map(step => step.replayCanvasData!)), snapshot.completedCanvas].map(canvas => ({ canvas, visible: undefined }))];
    for (const { canvas, visible } of scenes) {
      assertCurrent();
      const root = d3.hierarchy(cloneSyntaxTree(canvas)!);
      applyVizIds(root);
      if (snapshot.abstractionMode) markTriangulatedNodes(root, snapshot.protectedNodeIds ?? new Set());
      const ids = visible && new Set(visible);
      const nodes = root.descendants().filter(node => !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
        && (!ids || ids.has(getNodeId(node))));
      prepareStagePlaqueRequests(snapshot.plan!.frames[stageIndex].items, nodes as d3.HierarchyPointNode<SyntaxNode>[], measurePlaqueText);
      assertCurrent();
      yield;
    }
  }
  assertCurrent();
  if (inputKey !== valueKey(serializableInput(input))
    || canvases(input).some((canvas, index) => canvas !== sourceCanvases[index]))
    throw new Error('Replay layout input changed during measurement.');
  const measured = { categories: Boolean(measureCategoryText), plaques: Boolean(measurePlaqueText) };
  const fields = { input: snapshot, inputKey, measured, categories, plaques,
    ...(treeInk ? { treeInk } : {}), ...(treeLabels ? { treeLabels } : {}) };
  const job: PlaqueLayoutJob = { ...fields, requestKey: String(++nextRequest) };
  bindings.set(job, { input, canvases: sourceCanvases, functions, measuredKey: measuredKey(job) });
  return job;
}

/** Planning and allocation both run here, with strict native-metric lookups. */
export function runPlaqueLayoutJob(job: PlaqueLayoutJob, onProgress?: (progress: PlaqueLayoutProgress) => void): PlaqueLayoutResult {
  if (job.inputKey !== valueKey(job.input)) throw new Error('Replay layout job input changed.');
  const required = <T>(map: Map<string, T>, key: string): T => {
    if (!map.has(key)) throw new Error('Missing measured text in Replay layout.');
    return map.get(key)!;
  };
  // The validated job owns immutable run descriptors. Layout revisits them in
  // many frames; serialize each descriptor once within this execution only.
  const labelKeys = new WeakMap<TreeLabelRuns, string>();
  const labelKey = (run: TreeLabelRuns) => {
    let key = labelKeys.get(run);
    if (key === undefined) { key = treeLabelRunKey(run); labelKeys.set(run, key); }
    return key;
  };
  const input: StageLayoutInput = { ...job.input,
    measureCategoryText: job.measured.categories ? text => required(job.categories, text) : undefined,
    measureTreeLabel: job.treeLabels ? run => required(job.treeLabels!, labelKey(run)) : undefined,
    measureTreeInk: job.treeInk ? (text, style) => required(job.treeInk!, textKey(text, style)) : undefined,
    measurePlaqueText: job.measured.plaques ? (text, style) => required(job.plaques, textKey(text, style)) : undefined
  };
  const stages = new Map<number, ReadonlyMap<SyntaxNode, TreeCoordinateReservation>>();
  const indices = new Set([...(input.plan?.frames ?? []).map((_, index) => index), ...input.steps.flatMap(step =>
    Number.isInteger(step.replayFrameIndex) && step.replayCanvasData ? [step.replayFrameIndex!] : [])]);
  const sizeForStage = (index: number) => stageTreeLayoutSize(input.steps, index, input.width, input.height, input.layoutGroups);
  for (const stageIndex of [...indices].sort((a, b) => a - b)) {
    const size = sizeForStage(stageIndex);
    stages.set(stageIndex, size ? buildStageCoordinateReservations(input.steps, stageIndex, size, sizeForStage,
      input.direction, input.measureCategoryText, input.measureTreeInk, input.treeLabelRuns, input.measureTreeLabel) : new Map());
  }
  const ordinals = new Map(canvases(job.input).map((canvas, index) => [canvas, index]));
  const coordinates = new Map([...stages].map(([stageIndex, reservations]) => [stageIndex,
    new Map([...reservations].map(([canvas, points]) => {
      const ordinal = ordinals.get(canvas);
      if (ordinal === undefined) throw new Error('Unknown prepared Replay canvas.');
      return [ordinal, points] as const;
    }))]));
  const measurementKey = measuredKey(job);
  const target = job.progressStage;
  const targetGroup = target === undefined ? [] : input.layoutGroups?.find(group => group.includes(target)) ?? [target];
  let delivered = false;
  const publish = (schedule: ReplayPlaqueSchedule, preparedStages: number[]) => {
    if (!onProgress || delivered || !targetGroup.length || !targetGroup.every(stage => preparedStages.includes(stage))) return;
    delivered = true;
    onProgress({ requestKey: job.requestKey, measurementKey, coordinates,
      schedule: { stages: [...schedule.stages], steps: new Map(schedule.steps) }, preparedStages });
  };
  // A stage with no relation items cannot acquire a plaque from another stage.
  // Its complete coordinates are already fixed, including all future syntax.
  const emptyStages = (input.plan?.frames ?? []).flatMap((frame, index) => frame.items.length ? [] : [index]);
  if (targetGroup.length && targetGroup.every(stage => emptyStages.includes(stage))) {
    const emptySchedule: ReplayPlaqueSchedule = { stages: [], steps: new Map() };
    for (const stage of emptyStages) {
      const layout = new Map(); emptySchedule.stages[stage] = layout;
      input.steps.forEach((step, index) => { if (step.replayFrameIndex === stage) emptySchedule.steps.set(index, layout); });
    }
    publish(emptySchedule, emptyStages);
  }
  const preparedStages: number[] = [];
  const schedule = buildReplayPlaqueSchedule(input, stages, (schedule, stage) => {
    preparedStages.push(stage); publish(schedule, [...preparedStages]);
  });
  return { requestKey: job.requestKey, measurementKey, schedule, coordinates };
}

/** Accept only this still-current request; never seed a global geometry cache
 * with cloned canvas identities or silently recompute rejected worker output. */
export function bindPlaqueLayoutResult(input: StageLayoutInput, job: PlaqueLayoutJob, result: PlaqueLayoutResult): PreparedPlaqueLayout {
  const binding = bindings.get(job), currentCanvases = canvases(input);
  if (!binding || binding.input !== input || result.requestKey !== job.requestKey || result.measurementKey !== binding.measuredKey
    || measuredKey(job) !== binding.measuredKey || valueKey(serializableInput(input)) !== job.inputKey
    || binding.functions.some((fn, index) => fn !== measurementFunctions(input)[index])
    || currentCanvases.length !== binding.canvases.length || currentCanvases.some((canvas, index) => canvas !== binding.canvases[index]))
    throw new Error('Replay layout result no longer matches its input.');
  if (!(result.coordinates instanceof Map) || !result.schedule || !Array.isArray(result.schedule.stages) || !(result.schedule.steps instanceof Map))
    throw new Error('Invalid prepared Replay layout.');
  const coordinates = new Map<number, Map<SyntaxNode, TreeCoordinateReservation>>();
  for (const [stageIndex, reservations] of result.coordinates) {
    if (!Number.isInteger(stageIndex) || stageIndex < 0 || !(reservations instanceof Map)) throw new Error('Invalid prepared Replay stage.');
    const stage = new Map<SyntaxNode, TreeCoordinateReservation>();
    for (const [ordinal, points] of reservations) {
      const canvas = currentCanvases[ordinal];
      if (!Number.isInteger(ordinal) || !canvas || !(points instanceof Map)
        || !input.steps.some(step => step.replayFrameIndex === stageIndex && step.replayCanvasData === canvas))
        throw new Error('Invalid prepared Replay canvas.');
      const root = d3.hierarchy<SyntaxNode>(canvas); applyVizIds(root);
      const ids = new Set<string>(root.descendants().map(getNodeId));
      if (ids.size !== points.size || [...ids].some(id => !points.has(id))
        || [...points.values()].some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)))
        throw new Error('Incomplete prepared Replay coordinates.');
      stage.set(canvas, points);
    }
    coordinates.set(stageIndex, stage);
  }
  for (const step of input.steps) if (step.replayCanvasData && Number.isInteger(step.replayFrameIndex)
    && !coordinates.get(step.replayFrameIndex!)?.has(step.replayCanvasData))
    throw new Error('Missing prepared Replay coordinates.');
  return { schedule: result.schedule, coordinates };
}

/** A progress message certifies whole stages, never individual frames whose
 * later plaques could still change their shared camera. */
export function bindPlaqueLayoutProgress(input: StageLayoutInput, job: PlaqueLayoutJob, progress: PlaqueLayoutProgress): PreparedPlaqueLayout {
  if (!Array.isArray(progress.preparedStages) || !progress.preparedStages.length
    || new Set(progress.preparedStages).size !== progress.preparedStages.length
    || progress.preparedStages.some(stage => !Number.isInteger(stage) || stage < 0
      || !input.plan?.frames[stage] || !(progress.schedule?.stages[stage] instanceof Map)
      || input.steps.some((step, index) => step.replayFrameIndex === stage && !(progress.schedule.steps.get(index) instanceof Map))))
    throw new Error('Incomplete prepared Replay stage progress.');
  return bindPlaqueLayoutResult(input, job, progress);
}

/** Completion may add later stages, but cannot revise geometry already shown. */
export function completePlaqueLayoutResult(input: StageLayoutInput, job: PlaqueLayoutJob, result: PlaqueLayoutResult,
  early?: { progress: PlaqueLayoutProgress; layout: PreparedPlaqueLayout }): PreparedPlaqueLayout {
  const layout = bindPlaqueLayoutResult(input, job, result);
  if (!early) return layout;
  if (valueKey(result.coordinates) !== valueKey(early.progress.coordinates)
    || early.progress.preparedStages.some(stage => valueKey(result.schedule.stages[stage]) !== valueKey(early.progress.schedule.stages[stage]))
    || [...early.progress.schedule.steps].some(([index, placements]) => valueKey(result.schedule.steps.get(index)) !== valueKey(placements)))
    throw new Error('Completed Replay layout changed a prepared stage.');
  const schedule = { stages: [...layout.schedule.stages], steps: new Map(layout.schedule.steps) };
  for (const stage of early.progress.preparedStages) schedule.stages[stage] = early.layout.schedule.stages[stage];
  for (const [index, placements] of early.layout.schedule.steps) schedule.steps.set(index, placements);
  return { schedule, coordinates: early.layout.coordinates };
}
