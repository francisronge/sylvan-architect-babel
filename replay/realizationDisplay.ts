/**
 * Authored realization groups drawn as their realized forms. A group says which
 * current occurrences are pronounced as which stretch of the sentence; when that
 * text is not what its pronounced leaves spell ("do" + silent past = "did"), the
 * tree alone misreads the sentence. Such a group gets the PF realization plate:
 * its contributors' words rewritten as the realized text, anchored on those
 * pronounced words, where the realized word stands (on the group's occurrences
 * when none is pronounced). A literal row keeps the plate sized to its text, so
 * it can take a nearby pocket. Replay's association state (realizationReplay.ts)
 * decides when the plate shows; this module only projects groups into plan items.
 */
import type { SurfaceRealization, SyntaxNode } from '../types.ts';
import { caselessSpelling } from '../server/babelParser/spellout.js';
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { scheduleRealizationChanges, stageRealizationChanges, type ScheduledRealizationChange } from './realizationReplay.ts';
import {
  UNOWNED_RELATION_INDEX,
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
  /** Those leaves' occurrence IDs, in the same order. */
  contributorNodeIds: string[];
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
  const members = new Set(group.nodeIds), contributors: string[] = [], contributorNodeIds: string[] = [];
  const found = new Set<string>();
  const visit = (node: SyntaxNode, silent: boolean, inGroup: boolean) => {
    const quiet = silent || node.silent === true, inside = inGroup || members.has(node.id);
    if (members.has(node.id)) found.add(node.id);
    if (node.children?.length) node.children.forEach(child => visit(child, quiet, inside));
    else if (inside && !quiet && typeof node.word === 'string' && node.word.trim() && !isNullLike(node.word)) {
      contributors.push(node.word.trim());
      contributorNodeIds.push(node.id);
    }
  };
  forest.forEach(root => visit(root, false, false));
  if (found.size !== members.size || !group.tokenIndices.length) return undefined;
  const text = realizedInputText(group.tokenIndices, sentence, tokens);
  return text && caselessSpelling(text) !== caselessSpelling(contributors.join('')) ? { text, contributors, contributorNodeIds } : undefined;
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

/** The relation form plates (or spell-out or correspondence plates) on the same syntax that
 * already show this text: in one value, or spelled across the rows of one label, piece by piece. */
const relationPlatesShowing = (items: readonly RelationPlanItem[], group: SurfaceRealization,
  forest: readonly SyntaxNode[], text: string) => {
  const domain = subtreeIds(forest, group.nodeIds), wanted = caselessSpelling(text);
  return items.filter(item => {
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
 * plate is revealed at the relation moment where Replay activates its group
 * (scheduleRealizationChanges), never first at a Stage Record.
 */
export const withRealizationDisplays = (
  plan: RelationRenderPlan,
  frames: readonly ReplayDerivationFrame[],
  { sentence, inputTokens, steps }: { sentence: string; inputTokens?: readonly string[]; steps?: readonly PlaybackStep[] }
): RelationRenderPlan => {
  if (!frames.some(frame => frame.after?.realizations?.length)) return plan;
  const tokens = resolveSavedInputTokens(sentence, inputTokens);
  const changesOf = (stageIndex: number): ScheduledRealizationChange[] => steps?.length
    ? scheduleRealizationChanges(steps, frames, stageIndex, tokens)
    : stageRealizationChanges(frames, tokens)(stageIndex).map(change => ({ ...change, stepIndex: null, diagnostics: [] }));
  /** The moment the schedule shows a change at. Without Replay steps only the
   * completed view is drawn, so its owner or latest covering relation stands for it. */
  const activation = (stageIndex: number, change: ScheduledRealizationChange): PlanStageMoment => {
    const identity = change.stepIndex === null ? undefined : steps?.[change.stepIndex]?.replayRelationIdentity;
    return { stageIndex, relationIndex: identity?.relationIndex
      ?? (steps?.length ? null : change.relationIndex ?? change.candidateRelationIndices?.at(-1) ?? null) };
  };
  /** The relation whose moment shows the plate; a plate no moment shows has no relation. */
  const momentRef = (moment: PlanStageMoment, group: SurfaceRealization): PlanRelationRef => {
    const relation = moment.relationIndex === null ? undefined : frames[moment.stageIndex].relations?.[moment.relationIndex];
    return relation ? {
      stageIndex: moment.stageIndex, relationIndex: moment.relationIndex!, relation: relation.relation, anchors: relation.anchors,
      ...(relation.priorAnchors ? { priorAnchors: relation.priorAnchors } : {}),
      ...(relation.values ? { values: relation.values } : {})
    } : { stageIndex: moment.stageIndex, relationIndex: UNOWNED_RELATION_INDEX, relation: 'Realization group',
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
        group, activatedAt: moment, relationRef: momentRef(moment, group)
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
    const stageSteps = steps?.filter(step => step.replayFrameIndex === stageIndex) ?? [];
    return shown.flatMap(({ entry, retiredAt, forest }): NodePlaquePlanItem[] => {
      const completed = { display: realizationDisplay(entry.group, forest, sentence, tokens), activatedAt: entry.activatedAt, retiredAt };
      // A retained group whose contributors the stage restates keeps its preceding
      // display until the relation moment at which Replay paints the restated words.
      const restated = entry.activatedAt.stageIndex < stageIndex && !retiredAt
        ? restatementMoment(entry.group, previousForest, forest, stageSteps, stageIndex) : undefined;
      const displays = restated ? [
        { display: realizationDisplay(entry.group, previousForest, sentence, tokens), activatedAt: entry.activatedAt, retiredAt: restated },
        { ...completed, activatedAt: restated }
      ] : [completed];
      return displays.flatMap(({ display, activatedAt, retiredAt }) => {
        if (!display) return [];
        const showing = relationPlatesShowing(relationItems, entry.group, forest, display.text);
        // Relation plates this stage introduces replace a group plate shown since
        // an earlier stage at the first of their moments, not from the stage's start.
        const replacedAt = showing.length && activatedAt.stageIndex < stageIndex
          && showing.every(item => item.appearsAtStage === stageIndex && item.relationRef.stageIndex === stageIndex)
          ? firstReached(stageSteps, ...showing.map(item => ({ stageIndex, relationIndex: item.relationRef.relationIndex })))
          : undefined;
        if (showing.length && !replacedAt) return [];
        return [realizationPlate(entry, display, activatedAt, firstReached(stageSteps, replacedAt, retiredAt))];
      });
    });
  });
  if (!frameItems.some(items => items.length)) return plan;
  return { ...plan, frames: plan.frames.map((frame, stageIndex) => frameItems[stageIndex]?.length
    ? { ...frame, items: [...frame.items, ...frameItems[stageIndex]] } : frame) };
};

const realizationPlate = (entry: { group: SurfaceRealization; activatedAt: PlanStageMoment; relationRef: PlanRelationRef }, display: RealizationDisplay,
  activatedAt: PlanStageMoment, retiredAt: PlanStageMoment | undefined): NodePlaquePlanItem => ({
  relationRef: entry.relationRef,
  familyId: 'pf.realization',
  appearsAtStage: entry.activatedAt.stageIndex,
  persistence: 'replace-previous-instance',
  backward: false,
  priorWitnessNodeIds: [],
  kind: 'node-plaque',
  anchorNodeIds: display.contributorNodeIds.length ? display.contributorNodeIds : [...entry.group.nodeIds],
  plaqueStyle: 'realization',
  rows: [{ label: '', value: display.contributors.length
    ? `${display.contributors.join(' ')} \u2192 ${display.text}` : display.text }],
  realizationRowKinds: ['literal'],
  realization: { nodeIds: [...entry.group.nodeIds], tokenIndices: [...entry.group.tokenIndices],
    activatedAt, ...(retiredAt ? { retiredAt } : {}) }
});

/** Of two retirements, the one Replay reaches first; the steps fix the stage's
 * moment order, which need not be authored order. Without steps both are
 * reached together, so either stands. */
const firstReached = (stageSteps: readonly PlaybackStep[], ...moments: Array<PlanStageMoment | undefined>) => {
  const position = (moment: PlanStageMoment) => {
    const index = stageSteps.findIndex(step => step.replayKind === 'relation'
      && step.replayRelationIdentity?.stageIndex === moment.stageIndex
      && step.replayRelationIdentity.relationIndex === moment.relationIndex);
    return index < 0 ? Infinity : index;
  };
  return moments.filter((moment): moment is PlanStageMoment => moment !== undefined)
    .reduce<PlanStageMoment | undefined>((first, moment) => !first || position(moment) < position(first) ? moment : first, undefined);
};

/** The relation moment of this stage at which Replay first paints the group's
 * restated words as the completed stage states them. Undefined when the stage
 * restates none of them, or when no later relation moment of the stage shows
 * the change (it then holds from the stage's first step). */
const restatementMoment = (group: SurfaceRealization, previousForest: readonly SyntaxNode[],
  forest: readonly SyntaxNode[], stageSteps: readonly PlaybackStep[], stageIndex: number): PlanStageMoment | undefined => {
  const members = new Set(group.nodeIds);
  const form = (node: SyntaxNode) => JSON.stringify([node.word ?? null, node.silent === true]);
  const leaves = (source: readonly SyntaxNode[]) => {
    const out = new Map<string, string>();
    const visit = (node: SyntaxNode, inside: boolean) => {
      const within = inside || members.has(node.id);
      if (node.children?.length) node.children.forEach(child => visit(child, within));
      else if (within) out.set(node.id, form(node));
    };
    source.forEach(root => visit(root, false));
    return out;
  };
  const before = leaves(previousForest);
  const restated = [...leaves(forest)].filter(([id, current]) => before.has(id) && before.get(id) !== current);
  if (!restated.length) return undefined;
  const paints = (step: PlaybackStep) => {
    const nodes = new Map<string, SyntaxNode>();
    const visit = (node: SyntaxNode) => { if (node.replayOrigin?.kind !== 'word') nodes.set(node.id, node); node.children?.forEach(visit); };
    if (step.replayCanvasData) visit(step.replayCanvasData);
    return restated.every(([id, current]) => nodes.has(id) && form(nodes.get(id)!) === current);
  };
  const first = stageSteps.findIndex(paints), identity = stageSteps[first]?.replayRelationIdentity;
  return first > 0 && stageSteps[first].replayKind === 'relation' && identity?.stageIndex === stageIndex
    ? { stageIndex, relationIndex: identity.relationIndex } : undefined;
};
