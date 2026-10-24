/**
 * Authored realization groups drawn as their realized forms. A group says which
 * current occurrences are pronounced as which stretch of the sentence; when that
 * text is not what its pronounced leaves spell ("do" + silent past = "did"), the
 * tree alone misreads the sentence. Such a group gets the PF realization plate:
 * its contributors' words rewritten as the realized text, anchored on the group's
 * occurrences. Replay's association state (realizationReplay.ts) decides when the
 * plate shows; this module only projects groups into plan items.
 */
import type { SurfaceRealization, SyntaxNode } from '../types.ts';
import { caselessSpelling } from '../server/babelParser/spellout.js';
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { stageRealizationChanges, type RealizationChange } from './realizationReplay.ts';
import {
  STAGE_RECORD_RELATION_INDEX,
  type NodePlaquePlanItem,
  type PlanRelationRef,
  type PlanStageMoment,
  type RelationPlanItem,
  type RelationRenderPlan
} from './relations/renderPlan.ts';
import { isNullLike } from './replaySurfaceNotation.ts';
import type { PlaybackStep, ReplayDerivationFrame } from './types.ts';

export type RealizationDisplay = {
  /** The stretch of the sentence the group realizes; separate stretches are joined by an ellipsis. */
  text: string;
  /** The words of the group's pronounced leaves, in tree order. */
  contributors: string[];
};

const groupKey = (group: SurfaceRealization) => JSON.stringify([
  [...group.nodeIds].sort(), [...group.tokenIndices].sort((a, b) => a - b)]);


/** The sentence text at these word-list positions, located in order in the sentence itself. */
export const realizedInputText = (tokenIndices: readonly number[], sentence: string, tokens: readonly string[]): string => {
  const source = String(sentence || '').normalize('NFC');
  const spans: Array<[number, number] | undefined> = [];
  let cursor = 0;
  for (const token of tokens) {
    const start = source.indexOf(token.normalize('NFC'), cursor);
    if (start < 0) { spans.length = 0; break; }
    spans.push([start, cursor = start + token.normalize('NFC').length]);
  }
  const positions = [...new Set(tokenIndices)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const position of positions) {
    const run = runs.at(-1);
    if (run && run.at(-1) === position - 1) run.push(position);
    else runs.push([position]);
  }
  return runs.map(run => spans.length === tokens.length
    ? source.slice(spans[run[0]]![0], spans[run.at(-1)!]![1])
    : run.map(position => tokens[position] ?? '').join(' ')).join(' … ');
};

/** What the plate shows for one group of a stage, or nothing when the pronounced
 * leaves already spell the realized text, or a group node is not in the forest. */
export const realizationDisplay = (
  group: SurfaceRealization,
  forest: readonly SyntaxNode[],
  sentence: string,
  tokens: readonly string[]
): RealizationDisplay | undefined => {
  const members = new Set(group.nodeIds), contributors: string[] = [];
  const found = new Set<string>();
  const visit = (node: SyntaxNode, silent: boolean, inGroup: boolean) => {
    const quiet = silent || node.silent === true, inside = inGroup || members.has(node.id);
    if (members.has(node.id)) found.add(node.id);
    if (node.children?.length) node.children.forEach(child => visit(child, quiet, inside));
    else if (inside && !quiet && typeof node.word === 'string' && node.word.trim() && !isNullLike(node.word)) {
      contributors.push(node.word.trim());
    }
  };
  forest.forEach(root => visit(root, false, false));
  if (found.size !== members.size || !group.tokenIndices.length) return undefined;
  const text = realizedInputText(group.tokenIndices, sentence, tokens);
  return text && caselessSpelling(text) !== caselessSpelling(contributors.join('')) ? { text, contributors } : undefined;
};

const subtreeIds = (forest: readonly SyntaxNode[], roots: readonly string[]) => {
  const wanted = new Set(roots), ids = new Set<string>();
  const visit = (node: SyntaxNode, inside: boolean) => {
    const within = inside || wanted.has(node.id);
    if (within) ids.add(node.id);
    node.children?.forEach(child => visit(child, within));
  };
  forest.forEach(root => visit(root, false));
  return ids;
};

const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings)
    : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];

/** A relation's form plate (or spell-out or correspondence plate) on the same syntax already
 * shows this text: in one value, or spelled across the rows of one label, piece by piece. */
const shownByRelation = (items: readonly RelationPlanItem[], group: SurfaceRealization,
  forest: readonly SyntaxNode[], text: string) => {
  const domain = subtreeIds(forest, group.nodeIds), wanted = caselessSpelling(text);
  return items.some(item => {
    if (item.kind !== 'node-plaque' || item.realization
      || !['realization', 'spellout-label', 'correspondence'].includes(item.plaqueStyle)
      || ![...subtreeIds(forest, item.anchorNodeIds)].some(id => domain.has(id))) return false;
    const pieces = new Map<string, string>();
    item.rows.forEach(row => pieces.set(row.label, (pieces.get(row.label) ?? '') + row.value));
    return [...strings([item.title, item.rows, item.nativeContent]), ...pieces.values()]
      .some(value => caselessSpelling(value) === wanted);
  });
};

/**
 * Adds a realization plate to every plan frame whose stage holds a group whose
 * text its leaves do not spell, unless a relation's plate already shows it. Each
 * plate is revealed at the moment Replay activates its group: the owning
 * relation's moment, or the Stage Record when no single relation owns it or
 * when that moment cannot show it. Without Replay steps only the completed
 * view is drawn, so the owner stands for the moment.
 */
export const withRealizationDisplays = (
  plan: RelationRenderPlan,
  frames: readonly ReplayDerivationFrame[],
  { sentence, inputTokens, steps }: { sentence: string; inputTokens?: readonly string[]; steps?: readonly PlaybackStep[] }
): RelationRenderPlan => {
  if (!frames.some(frame => frame.after?.realizations?.length)) return plan;
  const tokens = resolveSavedInputTokens(sentence, inputTokens);
  const changesOf = stageRealizationChanges(frames, tokens);
  const groupsOn = (step: PlaybackStep | undefined, positions: ReadonlySet<number>) => JSON.stringify((step?.replayRealizations ?? [])
    .filter(group => group.tokenIndices.some(position => positions.has(position))).map(groupKey).sort());
  /** The step attaching a change shows the stage's completed association on its input positions. */
  const activation = (stageIndex: number, change: RealizationChange): PlanStageMoment => {
    const relationIndex = change.relationIndex;
    if (relationIndex === null || !steps?.length) return { stageIndex, relationIndex };
    const positions = new Set([...change.before, ...change.after].flatMap(group => group.tokenIndices));
    const moment = steps.find(step => step.replayKind === 'relation' && step.replayFrameIndex === stageIndex
      && step.replayRelationIdentity?.stageIndex === stageIndex && step.replayRelationIdentity.relationIndex === relationIndex);
    const record = steps.find(step => step.replayKind === 'macro' && step.replayFrameIndex === stageIndex);
    return moment && record && groupsOn(moment, positions) === groupsOn(record, positions)
      ? { stageIndex, relationIndex } : { stageIndex, relationIndex: null };
  };
  const ownerRef = (stageIndex: number, owner: number | null, group: SurfaceRealization): PlanRelationRef => {
    const relation = owner === null ? undefined : frames[stageIndex].relations?.[owner];
    return relation ? {
      stageIndex, relationIndex: owner!, relation: relation.relation, anchors: relation.anchors,
      ...(relation.priorAnchors ? { priorAnchors: relation.priorAnchors } : {}),
      ...(relation.values ? { values: relation.values } : {})
    } : { stageIndex, relationIndex: STAGE_RECORD_RELATION_INDEX, relation: 'Stage Record',
      anchors: { realization: [...group.nodeIds] } };
  };
  type Held = { group: SurfaceRealization; activatedAt: PlanStageMoment; relationRef: PlanRelationRef };
  let held = new Map<string, Held>();
  const frameItems = frames.map((frame, stageIndex) => {
    const changes = changesOf(stageIndex);
    const retired = new Map<string, PlanStageMoment>(), established = new Map<string, Held>();
    for (const change of changes) {
      const moment = activation(stageIndex, change);
      change.before.forEach(group => retired.set(groupKey(group), moment));
      change.after.forEach(group => established.set(groupKey(group), {
        group, activatedAt: moment, relationRef: ownerRef(stageIndex, change.relationIndex, group)
      }));
    }
    const current = frame.after?.realizations ?? [];
    const previousForest = frames[stageIndex - 1]?.workspaceForest ?? [];
    const shown = [
      ...[...held.values()].map(entry => ({ entry, retiredAt: retired.get(groupKey(entry.group)),
        forest: retired.has(groupKey(entry.group)) ? previousForest : frame.workspaceForest })),
      ...current.filter(group => !held.has(groupKey(group))).flatMap(group => {
        const entry = established.get(groupKey(group));
        return entry ? [{ entry, retiredAt: undefined, forest: frame.workspaceForest }] : [];
      })
    ];
    held = new Map(current.flatMap(group => {
      const entry = held.get(groupKey(group)) ?? established.get(groupKey(group));
      return entry ? [[groupKey(group), entry] as const] : [];
    }));
    const relationItems = plan.frames[stageIndex]?.items ?? [];
    return shown.flatMap(({ entry, retiredAt, forest }): NodePlaquePlanItem[] => {
      const display = realizationDisplay(entry.group, forest, sentence, tokens);
      if (!display || shownByRelation(relationItems, entry.group, forest, display.text)) return [];
      const rewrite = display.contributors.length > 0;
      return [{
        relationRef: entry.relationRef,
        familyId: 'pf.realization',
        appearsAtStage: entry.activatedAt.stageIndex,
        persistence: 'replace-previous-instance',
        backward: false,
        priorWitnessNodeIds: [],
        kind: 'node-plaque',
        anchorNodeIds: [...entry.group.nodeIds],
        plaqueStyle: 'realization',
        rows: [{ label: rewrite ? display.contributors.join(' ') : '', value: display.text }],
        realizationRowKinds: [rewrite ? 'rewrite' : 'literal'],
        realization: { nodeIds: [...entry.group.nodeIds], tokenIndices: [...entry.group.tokenIndices],
          activatedAt: entry.activatedAt, ...(retiredAt ? { retiredAt } : {}) }
      }];
    });
  });
  if (!frameItems.some(items => items.length)) return plan;
  return { ...plan, frames: plan.frames.map((frame, stageIndex) => frameItems[stageIndex]?.length
    ? { ...frame, items: [...frame.items, ...frameItems[stageIndex]] } : frame) };
};
