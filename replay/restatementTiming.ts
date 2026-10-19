/** Hold a stage's restatement of retained syntax until a step that owns the occurrence. */
import { type SyntaxNode } from '../types.ts';
import { cloneSyntaxTree } from './syntaxForest.ts';
import { type DerivationReplayPlanStep, type PlaybackStep, type ReplayDerivationFrame } from './types.ts';

/** An occurrence's form goes with its structural owner; its word and input
 * address may belong to a separate realization. */
const FORM = ['label', 'silent'] as const;
const WORD = ['word', 'tokenIndex'] as const;
const STRUCTURAL_OPERATIONS = new Set(['LexicalSelect', 'Project', 'ExternalMerge']);

interface Restatement {
  id: string;
  prior: SyntaxNode;
  /** The first relation of the stage naming the occurrence. Without one, only
   * the word waits, for its realizer; the form goes with the stage's first step. */
  owner?: number;
  /** Relations whose movement carries the occurrence within its landing or lower occurrence. */
  movers: Set<number>;
  /** The first relation that realizes the occurrence's word, by naming it or an ancestor. */
  realizer?: number;
}
type Waiting = { prior: SyntaxNode; form: boolean; word: boolean };
/** The preceding stage's last displayed step: each occurrence's display node and what was shown. */
type PrecedingDisplay = { nodes: ReadonlyMap<string, SyntaxNode>; visible: ReadonlySet<string> };

const indexForest = (forest: readonly SyntaxNode[] | undefined) => {
  const nodes = new Map<string, SyntaxNode>(), parents = new Map<string, string>();
  const visit = (node: SyntaxNode, parent?: string) => {
    if (node.id) { nodes.set(node.id, node); if (parent) parents.set(node.id, parent); }
    node.children?.forEach(child => visit(child, node.id || parent));
  };
  (forest ?? []).forEach(node => visit(node));
  return { nodes, parents };
};

const subtreeIds = (node: SyntaxNode | undefined, out = new Set<string>()) => {
  if (node?.id) out.add(node.id);
  node?.children?.forEach(child => subtreeIds(child, out));
  return out;
};

const anchorIds = (anchors: unknown): string[] => anchors && typeof anchors === 'object'
  ? Object.values(anchors as Record<string, unknown>).flat().map(String) : [];

const authoredIdOf = (node: SyntaxNode) => node.replayOrigin?.kind === 'lexical' ? String(node.replayOrigin.authoredId) : node.id;
const isWordOf = (child: SyntaxNode, owner: SyntaxNode) => child.replayOrigin?.kind === 'word' && child.replayOrigin.ownerId === owner.id;

/** Each authored occurrence's displayed children at one step, by authored
 * identity, apart from its derived word, which is its own pronunciation rather
 * than new material. A generated lexical ID that spells the word changes with a
 * restated word; the authored occurrence it displays does not. */
const displayedChildren = (step: PlaybackStep) => {
  const visible = new Set(step.replayVisibleNodeIds ?? []), out = new Map<string, Set<string>>();
  const visit = (node: SyntaxNode) => {
    if (node.replayOrigin?.kind !== 'word') out.set(authoredIdOf(node), new Set((node.children ?? [])
      .filter(child => visible.has(child.id) && child.replayOrigin?.kind !== 'word').map(authoredIdOf)));
    node.children?.forEach(visit);
  };
  if (step.replayCanvasData) visit(step.replayCanvasData);
  return out;
};

/** Each authored occurrence's display node on one canvas. */
const displayNodes = (canvas: SyntaxNode | null | undefined) => {
  const out = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => {
    if (node.replayOrigin?.kind !== 'word' && node.replayOrigin?.kind !== 'workspace') out.set(authoredIdOf(node), node);
    node.children?.forEach(visit);
  };
  if (canvas) visit(canvas);
  return out;
};

const restoreFields = (node: SyntaxNode, prior: SyntaxNode, fields: readonly string[]) => {
  const target = node as unknown as Record<string, unknown>, source = prior as unknown as Record<string, unknown>;
  fields.forEach(field => { if (source[field] === undefined) delete target[field]; else target[field] = source[field]; });
};

/** The restatements of each stage that a relation of that stage names or
 * whose word it realizes, with the movements that carry them and any relation
 * that separately realizes their word. */
const collectRestatements = (frames: readonly ReplayDerivationFrame[],
  frameRelations?: (frameIndex: number) => DerivationReplayPlanStep[]) => {
  const pending = new Map<number, Restatement[]>();
  frames.forEach((frame, stageIndex) => {
    if (stageIndex === 0) return;
    const before = indexForest(frames[stageIndex - 1].workspaceForest).nodes, current = indexForest(frame.workspaceForest);
    const relations = frame.relations ?? [];
    const resolve = () => (frameRelations?.(stageIndex) ?? []).map((relation, index) => ({
      index: Number.isInteger(relation.authoredRelationIndex) ? relation.authoredRelationIndex! : index,
      pronounced: new Set(relation.pronunciationNodeIds ?? []),
      carried: (relation.recoveredMovements ?? [relation.recoveredMovement]).filter(movement => movement?.transition)
        .reduce((ids, movement) => {
          subtreeIds(current.nodes.get(movement!.targetNodeId), ids);
          return subtreeIds(current.nodes.get(movement!.sourceNodeId), ids);
        }, new Set<string>())
    }));
    let resolved: ReturnType<typeof resolve> | undefined;
    for (const [id, node] of current.nodes) {
      const prior = before.get(id);
      if (!prior || [...FORM, ...WORD].every(key => prior[key] === node[key])) continue;
      const owner = relations.findIndex(relation => [...anchorIds(relation?.anchors), ...anchorIds(relation?.priorAnchors)].includes(id));
      // Only a relation that pronounces an ancestor can own a word no relation names.
      if (owner < 0 && WORD.every(key => prior[key] === node[key])) continue;
      resolved ??= resolve();
      const lineage = [id];
      for (let parent = current.parents.get(id); parent; parent = current.parents.get(parent)) lineage.push(parent);
      const realizers = resolved.filter(relation => lineage.some(at => relation.pronounced.has(at))).map(relation => relation.index);
      if (owner < 0 && !realizers.length) continue;
      if (!pending.has(stageIndex)) pending.set(stageIndex, []);
      pending.get(stageIndex)!.push({ id, prior, ...(owner < 0 ? {} : { owner }),
        movers: new Set(resolved.filter(relation => relation.carried.has(id)).map(relation => relation.index)),
        ...(realizers.length ? { realizer: Math.min(...realizers) } : {}) });
    }
  });
  return pending;
};

/**
 * A completed stage may restate an occurrence it keeps: the same id with a new
 * label, word or silence, such as a valued feature, an adjoined head or an
 * elided phrase. When a relation of the stage names that occurrence, the change
 * is not the stage's first step's: the occurrence keeps its preceding display,
 * including whether it shows a derived word and which, until the first step
 * that owns it. That is the moment of the first relation naming it, a
 * structural step building it, a step that attaches new material under it, or
 * the moment of a movement whose landing or lower occurrence contains it, which
 * introduces that material complete. A relation that separately realizes the
 * occurrence's word, by naming it or an ancestor, keeps its word and input
 * address until that relation's moment. The Stage Record shows the completed
 * stage. A restatement no relation names takes effect with the stage's first
 * step, apart from a word that a relation pronouncing an ancestor realizes,
 * which waits for that relation. Steps from the owning step on are unchanged,
 * so a later owner, such as a movement whose source keeps its form until its
 * own moment, keeps its own timing. A structural step whose only change was a
 * derived word that now waits for its owner is not a step and is removed; the
 * caller recounts.
 */
export const retainRestatementsUntilOwningStep = (steps: PlaybackStep[], frames: readonly ReplayDerivationFrame[],
  frameRelations?: (frameIndex: number) => DerivationReplayPlanStep[]): PlaybackStep[] => {
  const pending = collectRestatements(frames, frameRelations);
  if (!pending.size) return steps;
  const released = new Map<string, { form: boolean; word: boolean }>();
  const clones = new Map<SyntaxNode, Map<string, SyntaxNode>>();
  let previousChildren = new Map<string, Set<string>>(), previousOutput: PlaybackStep | undefined;
  let preceding: PrecedingDisplay = { nodes: new Map(), visible: new Set() }, stage: number | undefined;
  const removed = new Set<PlaybackStep>();
  const timed = steps.map(step => {
    const stageIndex = Number(step.replayFrameIndex), entries = pending.get(stageIndex) ?? [];
    if (stageIndex !== stage) {
      stage = stageIndex;
      if (entries.length) preceding = { nodes: displayNodes(previousOutput?.replayCanvasData), visible: new Set(previousOutput?.replayVisibleNodeIds ?? []) };
    }
    // Children are compared from the preceding stage's last step on.
    const children = entries.length || pending.has(stageIndex + 1) ? displayedChildren(step) : new Map<string, Set<string>>();
    const relation = step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stageIndex
      ? step.replayRelationIdentity.relationIndex : undefined;
    for (const entry of entries) {
      const key = `${stageIndex}|${entry.id}`, state = released.get(key) ?? { form: entry.owner === undefined, word: false };
      const before = previousChildren.get(entry.id);
      const gains = before !== undefined && [...children.get(entry.id) ?? []].some(child => !before.has(child));
      const owns = relation !== undefined && relation === entry.owner || step.replayKind === 'micro' && String(step.targetNodeId ?? '') === entry.id || gains
        || relation !== undefined && entry.movers.has(relation);
      const complete = step.replayKind === 'macro';
      if (owns || complete) state.form = true;
      if (complete || (entry.realizer === undefined ? owns : relation === entry.realizer)) state.word = true;
      released.set(key, state);
    }
    previousChildren = children;
    const waiting = new Map<string, Waiting>(entries.flatMap(entry => {
      const state = released.get(`${stageIndex}|${entry.id}`)!;
      return state.form && state.word ? [] : [[entry.id, { prior: entry.prior, form: !state.form, word: !state.word }]];
    }));
    if (!waiting.size || !step.replayCanvasData) return previousOutput = step;
    const result = withPrecedingDisplay(step, waiting, preceding, clones);
    const target = String(step.targetNodeId ?? '');
    if (step.replayKind === 'micro' && STRUCTURAL_OPERATIONS.has(String(step.operation))
      && step.replayVisibleNodeIds?.includes(target) && !result.replayVisibleNodeIds?.includes(target)) {
      removed.add(result);
      return result;
    }
    return previousOutput = result;
  });
  return removed.size ? timed.filter(step => !removed.has(step)) : timed;
};

/** One step with each waiting occurrence painted as the preceding stage's last
 * step displayed it: its own fields, and with its word the derived word leaves
 * it showed then. A derived word that the stage adds stays on the canvas
 * as hidden layout, so the occurrence keeps its place when the word appears. */
const withPrecedingDisplay = (step: PlaybackStep, waiting: ReadonlyMap<string, Waiting>, preceding: PrecedingDisplay,
  clones: Map<SyntaxNode, Map<string, SyntaxNode>>): PlaybackStep => {
  const original = step.replayCanvasData!;
  // Steps that shared a canvas keep sharing one while they wait for the same parts.
  const signature = JSON.stringify([...waiting].map(([id, part]) => [id, part.form, part.word]));
  const cached = clones.get(original)?.get(signature);
  const canvas = cached ?? cloneSyntaxTree(original)!;
  const shown = step.replayVisibleNodeIds ?? [], visible = new Set(shown);
  const visit = (node: SyntaxNode) => {
    const own = node.replayOrigin?.kind === 'word' ? undefined : waiting.get(authoredIdOf(node));
    if (own) {
      if (!cached) restoreFields(node, own.prior, [...(own.form ? FORM : []), ...(own.word ? WORD : [])]);
      if (own.word) precedingWords(node, preceding.nodes.get(authoredIdOf(node)), own.prior, visible, preceding.visible, !cached);
    }
    node.children?.forEach(visit);
  };
  visit(canvas);
  if (!cached) clones.set(original, (clones.get(original) ?? new Map()).set(signature, canvas));
  const kept = new Set(shown);
  return { ...step, replayCanvasData: canvas, replayVisibleNodeIds: shown.filter(id => visible.has(id))
    .concat([...visible].filter(id => !kept.has(id))) };
};

/** Give a waiting terminal the derived word leaves its preceding display had:
 * the same leaves with their earlier text, a removed word restored, and a new
 * word hidden. Visibility and silence follow the occurrence as displayed now,
 * as a materialized word leaf does. An occurrence that has, or
 * had, other children is not a terminal here; its children are construction's. */
const precedingWords = (node: SyntaxNode, preceding: SyntaxNode | undefined, prior: SyntaxNode, visible: Set<string>,
  precedingVisible: ReadonlySet<string>, edit: boolean) => {
  if ([node, preceding].some(owner => owner?.children?.some(child => !isWordOf(child, owner)))) return;
  const current = (node.children ?? []).filter(child => isWordOf(child, node));
  if (!preceding) {
    // Without the preceding display, only the text of the same leaves is restored.
    const word = typeof prior.word === 'string' ? prior.word.trim() : '';
    if (edit && word) current.forEach(child => {
      child.word = word; child.label = word;
      if (node.silent === true) child.silent = true; else delete child.silent;
    });
    return;
  }
  const earlier = (preceding.children ?? []).filter(child => isWordOf(child, preceding));
  const shown = visible.has(node.id);
  current.filter(child => !earlier.some(word => word.id === child.id)).forEach(child => visible.delete(child.id));
  earlier.forEach(word => {
    if (edit) {
      const { silent: _silent, ...earlierWord } = cloneSyntaxTree(word)!;
      const restored = { ...earlierWord, ...(node.silent === true ? { silent: true } : {}), replayOrigin: { kind: 'word' as const, ownerId: node.id } };
      const index = (node.children ?? []).findIndex(child => child.id === word.id);
      if (index >= 0) node.children![index] = restored;
      else node.children = [...node.children ?? [], restored];
    }
    if (shown && precedingVisible.has(word.id)) visible.add(word.id); else visible.delete(word.id);
  });
};
