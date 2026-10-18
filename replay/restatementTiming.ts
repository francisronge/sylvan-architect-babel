/** Hold a stage's restatement of retained syntax until a step that owns the occurrence. */
import { type SyntaxNode } from '../types.ts';
import { cloneSyntaxTree } from './syntaxForest.ts';
import { type PlaybackStep, type ReplayDerivationFrame } from './types.ts';

const FIELDS = ['label', 'word', 'tokenIndex', 'silent'] as const;

const indexForest = (forest: readonly SyntaxNode[] | undefined) => {
  const nodes = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => { if (node.id) nodes.set(node.id, node); node.children?.forEach(visit); };
  (forest ?? []).forEach(visit);
  return nodes;
};

const anchorIds = (anchors: unknown): string[] => anchors && typeof anchors === 'object'
  ? Object.values(anchors as Record<string, unknown>).flat().map(String) : [];

const authoredIdOf = (node: SyntaxNode) => node.replayOrigin?.kind === 'lexical' ? String(node.replayOrigin.authoredId) : node.id;

/** Each authored occurrence's displayed children at one step, apart from its
 * derived word, which is its own pronunciation rather than new material. */
const displayedChildren = (step: PlaybackStep) => {
  const visible = new Set(step.replayVisibleNodeIds ?? []), out = new Map<string, Set<string>>();
  const visit = (node: SyntaxNode) => {
    if (node.replayOrigin?.kind !== 'word') out.set(authoredIdOf(node), new Set((node.children ?? [])
      .filter(child => visible.has(child.id) && child.replayOrigin?.kind !== 'word').map(child => child.id)));
    node.children?.forEach(visit);
  };
  if (step.replayCanvasData) visit(step.replayCanvasData);
  return out;
};

/**
 * A completed stage may restate an occurrence it keeps: the same id with a new
 * label, word or silence, such as a valued feature, an adjoined head or an
 * elided phrase. When a relation of the stage names that occurrence, the change
 * is not the stage's first step's: the occurrence, and its derived word, keep
 * their preceding form until the first step that owns the occurrence. That is
 * the moment of the first relation naming it, a structural step building it,
 * or a step that attaches new material under it, such as a head movement into
 * a receiving head. A restatement no relation names takes effect with the
 * stage's first step. Steps from the owning step on are unchanged, so a later
 * owner, such as a movement whose source keeps its form until its own moment,
 * keeps its own timing.
 */
export const retainRestatementsUntilNamingMoment = (steps: PlaybackStep[], frames: readonly ReplayDerivationFrame[]): PlaybackStep[] => {
  const pending = new Map<number, Array<{ id: string; prior: SyntaxNode; owner: number }>>();
  frames.forEach((frame, stageIndex) => {
    if (stageIndex === 0) return;
    const before = indexForest(frames[stageIndex - 1].workspaceForest), relations = frame.relations ?? [];
    for (const [id, node] of indexForest(frame.workspaceForest)) {
      const prior = before.get(id);
      if (!prior || FIELDS.every(key => prior[key] === node[key])) continue;
      const owner = relations.findIndex(relation => [...anchorIds(relation?.anchors), ...anchorIds(relation?.priorAnchors)].includes(id));
      if (owner < 0) continue;
      if (!pending.has(stageIndex)) pending.set(stageIndex, []);
      pending.get(stageIndex)!.push({ id, prior, owner });
    }
  });
  if (!pending.size) return steps;
  const owned = new Set<string>();
  let previousChildren = new Map<string, Set<string>>();
  return steps.map(step => {
    const stageIndex = Number(step.replayFrameIndex), entries = pending.get(stageIndex) ?? [];
    const children = displayedChildren(step), identity = step.replayKind === 'relation' ? step.replayRelationIdentity : undefined;
    for (const entry of entries) {
      const key = `${stageIndex}|${entry.id}`, before = previousChildren.get(entry.id);
      if (owned.has(key)) continue;
      const gains = [...children.get(entry.id) ?? []].some(child => !before?.has(child)) && before !== undefined;
      if (identity?.stageIndex === stageIndex && identity.relationIndex === entry.owner
        || step.replayKind === 'micro' && String(step.targetNodeId ?? '') === entry.id || gains) owned.add(key);
    }
    previousChildren = children;
    const waiting = new Map(entries.filter(entry => !owned.has(`${stageIndex}|${entry.id}`)).map(entry => [entry.id, entry.prior]));
    if (!waiting.size || !step.replayCanvasData) return step;
    const canvas = cloneSyntaxTree(step.replayCanvasData)!;
    const visit = (node: SyntaxNode) => {
      const origin = node.replayOrigin, own = origin?.kind === 'word' ? undefined : waiting.get(authoredIdOf(node));
      if (own) {
        const target = node as unknown as Record<string, unknown>;
        FIELDS.forEach(field => { if (own[field] === undefined) delete target[field]; else target[field] = own[field]; });
      }
      // A derived word leaf paints its owner's word, as label and word.
      const owner = origin?.kind === 'word' ? waiting.get(String(origin.ownerId)) : undefined;
      if (typeof owner?.word === 'string' && owner.word.trim()) {
        node.word = owner.word.trim();
        node.label = owner.word.trim();
        if (owner.silent === true) node.silent = true; else delete node.silent;
      }
      node.children?.forEach(visit);
    };
    visit(canvas);
    return { ...step, replayCanvasData: canvas };
  });
};
