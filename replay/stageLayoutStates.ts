import * as d3 from 'd3';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './types.ts';

/** The steps stage layout plans from. The canvases of one authored stage pass
 * through a few distinct states: construction only reveals more of a canvas,
 * and only a relation that changes the tree (a movement) gives the stage a new
 * canvas. Planning sees each state built in one structural order, every new
 * node after its daughters, daughters left to right, whatever order Replay
 * shows them in; a node a relation introduces appears at that relation's own
 * step. Each real step is then painted as its state's completed layout
 * restricted to what it shows, so the order of construction steps cannot move
 * any syntax. */
export type StageLayoutStates = {
  steps: PlaybackStep[];
  /** The planning step whose canvas lays out each real step's canvas. */
  stateOf: ReadonlyMap<PlaybackStep, PlaybackStep>;
  /** Each stage's completed planning step. */
  completed: ReadonlyMap<number, PlaybackStep>;
};

const plans = new WeakMap<readonly PlaybackStep[], StageLayoutStates>();
const order = (step: PlaybackStep) => step.replayStageStepIndex ?? (step.replayKind === 'macro' ? Infinity : 0);
const hierarchy = (canvas: SyntaxNode) => { const root = d3.hierarchy(canvas); applyVizIds(root); return root; };
const isSyntax = (node: d3.HierarchyNode<SyntaxNode>) => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';

const variant = () => typeof process !== 'undefined' ? process.env.BABEL_STAGE_STATES ?? '' : '';

/** Prototype v1: one planning step per canvas state, showing everything the stage shows. */
function wholeStates(steps: readonly PlaybackStep[]): StageLayoutStates {
  const byStage = new Map<number, PlaybackStep[]>();
  for (const step of steps) {
    if (!step.replayCanvasData || step.replayFrameIndex === undefined) continue;
    byStage.set(step.replayFrameIndex, [...(byStage.get(step.replayFrameIndex) ?? []), step]);
  }
  const planned: PlaybackStep[] = [], stateOf = new Map<PlaybackStep, PlaybackStep>(), completed = new Map<number, PlaybackStep>();
  for (const [stage, frames] of [...byStage].sort(([a], [b]) => a - b)) {
    frames.sort((a, b) => order(a) - order(b));
    const shown = new Set(frames.flatMap(step => step.replayVisibleNodeIds ?? []));
    const states = new Map<string, { first: PlaybackStep; members: PlaybackStep[] }>();
    for (const step of frames) {
      const key = JSON.stringify(step.replayCanvasData);
      const state = states.get(key);
      if (state) state.members.push(step); else states.set(key, { first: step, members: [step] });
    }
    let index = 0;
    for (const { first, members } of states.values()) {
      const root = hierarchy(first.replayCanvasData!);
      const visible = root.descendants().filter(node => isSyntax(node) && shown.has(getNodeId(node))).map(getNodeId);
      const state: PlaybackStep = { ...first, replayVisibleNodeIds: visible, replayStageStepIndex: index++ };
      planned.push(state);
      const macro = members.find(step => step.replayKind === 'macro');
      let completedState = state;
      if (macro && macro !== first) {
        completedState = { ...macro, replayCanvasData: first.replayCanvasData, replayVisibleNodeIds: visible, replayStageStepIndex: index++ };
        planned.push(completedState);
      }
      if (macro) completed.set(stage, completedState);
      for (const step of members) stateOf.set(step, completedState);
    }
  }
  return { steps: planned, stateOf, completed };
}

export function stageLayoutStates(steps: readonly PlaybackStep[]): StageLayoutStates {
  const cached = plans.get(steps);
  if (cached) return cached;
  if (variant() === 'v1') { const result = wholeStates(steps); plans.set(steps, result); return result; }
  const byStage = new Map<number, PlaybackStep[]>();
  for (const step of steps) {
    if (!step.replayCanvasData || step.replayFrameIndex === undefined) continue;
    byStage.set(step.replayFrameIndex, [...(byStage.get(step.replayFrameIndex) ?? []), step]);
  }
  const planned: PlaybackStep[] = [], stateOf = new Map<PlaybackStep, PlaybackStep>(), completed = new Map<number, PlaybackStep>();
  let previousVisible = new Set<string>();
  for (const [stage, frames] of [...byStage].sort(([a], [b]) => a - b)) {
    frames.sort((a, b) => order(a) - order(b));
    const shown = new Set(frames.flatMap(step => step.replayVisibleNodeIds ?? []));
    const states = new Map<string, PlaybackStep[]>();
    for (const step of frames) {
      const key = JSON.stringify(step.replayCanvasData);
      states.set(key, [...(states.get(key) ?? []), step]);
    }
    const stateIndex = new Map<PlaybackStep, number>();
    [...states.values()].forEach((members, index) => members.forEach(step => stateIndex.set(step, index)));
    // The step at which each node first shows: a relation introduces what it
    // first shows; any other node belongs to the state it first shows in.
    const firstShown = new Map<string, PlaybackStep>();
    for (const step of frames) for (const id of step.replayVisibleNodeIds ?? [])
      if (!previousVisible.has(id) && !firstShown.has(id)) firstShown.set(id, step);
    let index = 0, visible = new Set<string>();
    const emit = (template: PlaybackStep, canvas: SyntaxNode, ids: Iterable<string>, fields: Partial<PlaybackStep> = {}) => {
      const step: PlaybackStep = { ...template, ...fields, replayCanvasData: structuredClone(canvas),
        replayVisibleNodeIds: [...ids], replayStageStepIndex: index++ };
      planned.push(step);
      return step;
    };
    [...states.values()].forEach((members, state) => {
      const canvas = members[0].replayCanvasData!, root = hierarchy(canvas);
      const real = new Set(root.descendants().filter(node => isSyntax(node) && shown.has(getNodeId(node))).map(getNodeId));
      visible = new Set([...(state ? visible : previousVisible)].filter(id => real.has(id)));
      let last: PlaybackStep | undefined;
      const introduce = (step: PlaybackStep) => {
        [...real].filter(id => firstShown.get(id) === step).forEach(id => visible.add(id));
        last = emit(step, canvas, [...visible]);
      };
      // Nodes first shown in this state, each once its daughters stand.
      const construct = () => root.eachAfter(node => {
        const id = getNodeId(node), first = firstShown.get(id);
        if (!real.has(id) || visible.has(id) || !first || stateIndex.get(first) !== state || first.replayKind === 'relation') return;
        const daughters = (node.children ?? []).filter(child => real.has(getNodeId(child))).map(getNodeId);
        if (daughters.some(child => !visible.has(child))) return;
        visible.add(id);
        last = emit(members[0], canvas, [...visible], { replayKind: 'micro', targetNodeId: id, sourceNodeIds: daughters,
          operation: !daughters.length ? 'LexicalSelect' : daughters.length === 1 ? 'Project' : 'ExternalMerge',
          replayRelationIdentity: undefined, replayTreeTransition: undefined, replayPendingAttachmentNodeIds: undefined });
      });
      // The step that gives the stage a new canvas opens its state with what it shows first.
      const opener = members[0].replayKind === 'macro' ? undefined : members[0];
      if (opener && (state || opener.replayKind === 'relation')) introduce(opener);
      construct();
      for (const step of members) {
        if (step === opener || step.replayKind !== 'relation' || ![...real].some(id => firstShown.get(id) === step)) continue;
        introduce(step);
        construct();
      }
      const macro = members.find(step => step.replayKind === 'macro');
      if (macro) last = emit(macro, canvas, macro.replayVisibleNodeIds ?? [...visible]);
      last ??= emit(members[0], canvas, [...visible]);
      if (macro) completed.set(stage, last);
      for (const step of members) stateOf.set(step, last);
    });
    const macro = frames.find(step => step.replayKind === 'macro');
    previousVisible = new Set(macro?.replayVisibleNodeIds ?? frames.at(-1)?.replayVisibleNodeIds ?? []);
  }
  const result = { steps: planned, stateOf, completed };
  plans.set(steps, result);
  return result;
}
