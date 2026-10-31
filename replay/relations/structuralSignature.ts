import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../../types.ts';
import { readCategoryLabel } from '../categoryLabel.ts';

/**
 * Name-free structural facts about one authored relation in its own stage.
 *
 * The signature reads only the tree: which nodes the anchors name, how those
 * nodes sit relative to one another, and what changed between the previous
 * stage and this one. Relation names, anchor-role names and value literals are
 * carried as text only. Text is compared with other authored text for exact
 * identity (a value entry named like an anchor entry, a literal equal to a
 * label annotation or to the words a subtree pronounces); no word is looked up
 * or interpreted.
 */

export type StructuralNodeFacts = {
  id: string;
  resolved: boolean;
  /** The id occurs at more than one position; such an anchor cannot own a mark. */
  duplicate: boolean;
  shape?: 'terminal' | 'nonterminal';
  label?: string;
  /** Projection level only where the label marks it (XP, X′, X⁰); bare category letters stay unmarked. */
  level?: 'head' | 'bar' | 'phrase' | 'unmarked';
  /** Category letters without projection level or annotations, for identity comparison only. */
  category?: string;
  annotations?: string[];
  hasWord?: boolean;
  silent?: boolean;
  rootId?: string;
  parentId?: string | null;
  childCount?: number;
  terminalCount?: number;
  pronounced?: string;
  /** Every terminal in the subtree is unpronounced now. */
  whollySilent?: boolean;
  lineageId?: string;
  lineageOccurrences?: number;
  /** A projection whose parent has its category and its explicitly marked phrase or bar level:
   * the lower segment of a two-segment category. */
  segmentOfParent?: boolean;
  /** Same category letters as the parent, whatever the level notation. */
  sameCategoryAsParent?: boolean;
  parent?: { id: string; label: string; level?: StructuralNodeFacts['level']; category?: string; childCount: number; isNew?: boolean };
  change?: StructuralNodeChange;
};

export type StructuralNodeChange = {
  /** The id does not occur in the previous stage. */
  isNew: boolean;
  parentIsNew: boolean;
  /** The node existed before under a different parent (rebracketing or attachment). */
  parentChanged: boolean;
  /** The node existed before and gained a sister it did not have. */
  newSister: boolean;
  labelChanged: boolean;
  annotationsAdded: string[];
  wordChanged: boolean;
  silenceChanged: boolean;
  /** Something inside the subtree changed while the node itself kept its id. */
  subtreeChanged: boolean;
  lineageGained: boolean;
  realizationChanged: boolean;
  /** Terminals in the subtree that were pronounced in the previous stage and are silent now. */
  silencedTerminals: string[];
  /** Terminals in the subtree that were silent in the previous stage and are pronounced now. */
  voicedTerminals: string[];
  /** Terminals in the subtree whose authored word changed. */
  rewordedTerminals: string[];
  /** Silenced terminals inside an occurrence (up to this node) whose lineage has another current occurrence. */
  silencedChainMembers: string[];
};

export type StructuralPairRelation =
  | 'same'
  | 'different-workspace'
  | 'contains'
  | 'contained-by'
  | 'sisters'
  | 'c-commands'
  | 'c-commanded-by'
  | 'unrelated';

export type StructuralValueFacts = {
  key: string;
  items: string[];
  isArray: boolean;
  /** The contract pairs a values entry with the anchor entry of the same name. */
  pairsWithAnchor?: string;
  lengthMatchesPairedAnchor?: boolean;
  /** Per item: anchored node ids whose label annotations contain the exact literal. */
  annotationOf: string[][];
  /** Per item: anchored node ids whose pronounced words equal the exact literal. */
  pronouncedBy: string[][];
  /** Per item: the literal contains no letter or digit. */
  symbolic: boolean[];
};

export type StructuralSignature = {
  anchorEntries: Array<{ key: string; ids: string[]; isArray: boolean }>;
  priorAnchorEntries: Array<{ key: string; ids: string[]; isArray: boolean; resolved: boolean[] }>;
  /** Distinct current anchor ids in authored order. */
  anchorIds: string[];
  nodes: Record<string, StructuralNodeFacts>;
  pairs: Array<{ a: string; b: string; relation: StructuralPairRelation }>;
  /** The anchored nodes' roots. */
  workspaceCount: number;
  /** One anchored node properly dominates every other anchored node. */
  containerIds: string[];
  /** Exactly two anchored nodes are sisters and form the whole of one parent. */
  forkParentId?: string;
  /** An anchored node is the parent of two other anchored sisters. */
  anchoredForkParentId?: string;
  values: StructuralValueFacts[];
  stage: {
    hasPrior: boolean;
    newNodeCount: number;
    rootCountBefore: number;
    rootCountAfter: number;
  };
};

type IndexedNode = {
  node: SyntaxNode;
  parentId: string | null;
  rootId: string;
  depth: number;
  ancestors: string[];
  silent: boolean;
};

export type StructureIndex = {
  byId: Map<string, IndexedNode>;
  counts: Map<string, number>;
  lineages: Map<string, number>;
  roots: string[];
};

export const indexStructure = (forest: readonly SyntaxNode[] | undefined): StructureIndex => {
  const byId = new Map<string, IndexedNode>();
  const counts = new Map<string, number>();
  const lineages = new Map<string, number>();
  const roots: string[] = [];
  const visit = (node: SyntaxNode, parentId: string | null, rootId: string, ancestors: string[], silent: boolean) => {
    const id = String(node?.id ?? '');
    const effectiveSilent = silent || node?.silent === true;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (node?.lineageId) lineages.set(node.lineageId, (lineages.get(node.lineageId) ?? 0) + 1);
    if (!byId.has(id)) byId.set(id, { node, parentId, rootId, depth: ancestors.length, ancestors, silent: effectiveSilent });
    (Array.isArray(node?.children) ? node.children : []).forEach(child =>
      visit(child, id, rootId, [...ancestors, id], effectiveSilent));
  };
  (Array.isArray(forest) ? forest : []).forEach(root => {
    roots.push(String(root?.id ?? ''));
    visit(root, null, String(root?.id ?? ''), [], false);
  });
  return { byId, counts, lineages, roots };
};

/** Bracketed annotations in a label, as authored text. */
export const labelAnnotations = (label?: string): string[] => [...String(label ?? '').matchAll(/\[([^\[\]]*)\]/gu)]
  .flatMap(match => match[1].split(/[,;]/u)).map(item => item.trim()).filter(Boolean);

const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim();

const pronouncedWords = (index: StructureIndex, id: string): string => {
  const entry = index.byId.get(id);
  if (!entry) return '';
  const words: string[] = [];
  const visit = (node: SyntaxNode, silent: boolean) => {
    const quiet = silent || node.silent === true;
    const children = Array.isArray(node.children) ? node.children : [];
    if (!children.length) {
      if (!quiet && node.word?.trim()) words.push(node.word.trim());
      return;
    }
    children.forEach(child => visit(child, quiet));
  };
  visit(entry.node, entry.silent);
  return words.join(' ');
};

const terminalCount = (node: SyntaxNode): number => {
  const children = Array.isArray(node.children) ? node.children : [];
  return children.length ? children.reduce((sum, child) => sum + terminalCount(child), 0) : 1;
};

const subtreeShape = (node: SyntaxNode): unknown[] => [
  node.id, node.label, node.word ?? '', node.silent === true,
  (Array.isArray(node.children) ? node.children : []).map(subtreeShape)
];
const subtreeFingerprint = (node: SyntaxNode): string => JSON.stringify(subtreeShape(node));

export const dominates = (index: StructureIndex, upper: string, lower: string): boolean =>
  upper !== lower && Boolean(index.byId.get(lower)?.ancestors.includes(upper));

/** Standard c-command: neither dominates the other, and the first branching
 * node above `a` dominates `b`. */
export const cCommands = (index: StructureIndex, a: string, b: string): boolean => {
  const left = index.byId.get(a), right = index.byId.get(b);
  if (!left || !right || a === b || left.rootId !== right.rootId) return false;
  if (dominates(index, a, b) || dominates(index, b, a)) return false;
  for (let i = left.ancestors.length - 1; i >= 0; i -= 1) {
    const ancestor = index.byId.get(left.ancestors[i])!;
    if ((ancestor.node.children?.length ?? 0) >= 2) return right.ancestors.includes(left.ancestors[i]);
  }
  return false;
};

export const pairRelation = (index: StructureIndex, a: string, b: string): StructuralPairRelation => {
  if (a === b) return 'same';
  const left = index.byId.get(a), right = index.byId.get(b);
  if (!left || !right || left.rootId !== right.rootId) return 'different-workspace';
  if (dominates(index, a, b)) return 'contains';
  if (dominates(index, b, a)) return 'contained-by';
  if (left.parentId !== null && left.parentId === right.parentId) return 'sisters';
  if (cCommands(index, a, b)) return 'c-commands';
  if (cCommands(index, b, a)) return 'c-commanded-by';
  return 'unrelated';
};

/** Explicit level notation only: XP, X′ and X⁰. A bare category is unmarked,
 * since Bare Phrase Structure labels every projection with its head's category. */
const markedLevel = (label?: string): StructuralNodeFacts['level'] => {
  const shape = readCategoryLabel(label);
  if (!shape) return undefined;
  if (shape.kind !== 'head') return shape.kind;
  const bare = String(label ?? '').replace(/\s*\[[^\]]*\]/gu, '').split(/[:,(]/u, 1)[0].trim();
  return /(?:⁰|°|\^?0)$/u.test(bare) ? 'head' : 'unmarked';
};

const subtreeTerminalIds = (node: SyntaxNode): string[] => {
  const children = Array.isArray(node.children) ? node.children : [];
  return children.length ? children.flatMap(subtreeTerminalIds) : [String(node.id)];
};

const terminalChanges = (current: StructureIndex, prior: StructureIndex, id: string) => {
  const silencedTerminals: string[] = [], voicedTerminals: string[] = [], rewordedTerminals: string[] = [];
  const silencedChainMembers: string[] = [];
  const anchorDepth = current.byId.get(id)!.ancestors.length;
  for (const terminal of subtreeTerminalIds(current.byId.get(id)!.node)) {
    const now = current.byId.get(terminal), before = prior.byId.get(terminal);
    if (!now || !before) continue;
    if (!before.silent && now.silent && before.node.word?.trim()) {
      silencedTerminals.push(terminal);
      const occurrences = [...now.ancestors.slice(anchorDepth), terminal].map(other => current.byId.get(other)?.node.lineageId);
      if (occurrences.some(lineage => lineage && (current.lineages.get(lineage) ?? 0) > 1)) silencedChainMembers.push(terminal);
    }
    if (before.silent && !now.silent && now.node.word?.trim()) voicedTerminals.push(terminal);
    if ((before.node.word ?? '') !== (now.node.word ?? '')) rewordedTerminals.push(terminal);
  }
  return { silencedTerminals, voicedTerminals, rewordedTerminals, silencedChainMembers };
};

const realizationKeys = (realizations: readonly SurfaceRealization[] | undefined, id: string): string[] =>
  (realizations ?? []).filter(group => group.nodeIds?.includes(id))
    .map(group => JSON.stringify([[...group.nodeIds].sort(), group.tokenIndices ?? (group as { text?: unknown }).text]));

const flatten = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value.map(String) : value === undefined ? [] : [String(value)];

export type StructuralSignatureInput = {
  relation: Pick<DerivationStageRelation, 'anchors' | 'priorAnchors' | 'values'>;
  currentForest: readonly SyntaxNode[];
  priorForest?: readonly SyntaxNode[];
  currentRealizations?: readonly SurfaceRealization[];
  priorRealizations?: readonly SurfaceRealization[];
  currentIndex?: StructureIndex;
  priorIndex?: StructureIndex;
};

export const structuralSignature = (input: StructuralSignatureInput): StructuralSignature => {
  const current = input.currentIndex ?? indexStructure(input.currentForest);
  const prior = input.priorForest ? (input.priorIndex ?? indexStructure(input.priorForest)) : undefined;
  const anchors = input.relation.anchors ?? {};
  const anchorEntries = Object.entries(anchors).map(([key, value]) => ({ key, ids: flatten(value), isArray: Array.isArray(value) }));
  const priorAnchorEntries = Object.entries(input.relation.priorAnchors ?? {}).map(([key, value]) => {
    const ids = flatten(value);
    return { key, ids, isArray: Array.isArray(value), resolved: ids.map(id => Boolean(prior?.byId.has(id))) };
  });
  const anchorIds = [...new Set(anchorEntries.flatMap(entry => entry.ids))];
  const nodes: Record<string, StructuralNodeFacts> = {};
  for (const id of anchorIds) {
    const entry = current.byId.get(id);
    if (!entry) { nodes[id] = { id, resolved: false, duplicate: false }; continue; }
    const { node } = entry;
    const children = Array.isArray(node.children) ? node.children : [];
    const shape = readCategoryLabel(node.label);
    const parent = entry.parentId ? current.byId.get(entry.parentId)?.node : undefined;
    const parentShape = parent ? readCategoryLabel(parent.label) : undefined;
    const level = markedLevel(node.label), parentLevel = parent ? markedLevel(parent.label) : undefined;
    const facts: StructuralNodeFacts = {
      id, resolved: true, duplicate: (current.counts.get(id) ?? 0) > 1,
      shape: children.length ? 'nonterminal' : 'terminal',
      label: node.label,
      ...(shape ? { level, ...(shape.head ? { category: shape.head } : {}) } : {}),
      annotations: labelAnnotations(node.label),
      hasWord: Boolean(node.word?.trim()),
      silent: entry.silent,
      rootId: entry.rootId,
      parentId: entry.parentId,
      childCount: children.length,
      terminalCount: terminalCount(node),
      pronounced: pronouncedWords(current, id),
      whollySilent: subtreeTerminalIds(node).every(terminal => current.byId.get(terminal)?.silent || !current.byId.get(terminal)?.node.word?.trim()),
      ...(node.lineageId ? { lineageId: node.lineageId, lineageOccurrences: current.lineages.get(node.lineageId) ?? 0 } : {}),
      segmentOfParent: Boolean(children.length && shape?.head && parentShape && !shape.compound && !parentShape.compound
        && shape.head === parentShape.head && (level === 'phrase' || level === 'bar') && level === parentLevel),
      sameCategoryAsParent: Boolean(shape?.head && parentShape && !shape.compound && !parentShape.compound
        && shape.head === parentShape.head),
      ...(parent ? { parent: {
        id: String(parent.id), label: parent.label, ...(parentShape ? { level: parentLevel, ...(parentShape.head ? { category: parentShape.head } : {}) } : {}),
        childCount: parent.children?.length ?? 0, ...(prior ? { isNew: !prior.byId.has(String(parent.id)) } : {})
      } } : {})
    };
    if (prior) {
      const before = prior.byId.get(id);
      const sisters = (index: StructureIndex, parentId: string | null | undefined) => parentId
        ? (index.byId.get(parentId)?.node.children ?? []).map(child => String(child.id)).filter(other => other !== id) : [];
      const beforeSisters = new Set(sisters(prior, before?.parentId));
      facts.change = {
        isNew: !before,
        parentIsNew: Boolean(entry.parentId && !prior.byId.has(entry.parentId)),
        parentChanged: Boolean(before && before.parentId !== entry.parentId),
        newSister: Boolean(before && sisters(current, entry.parentId).some(other => !beforeSisters.has(other))),
        labelChanged: Boolean(before && before.node.label !== node.label),
        annotationsAdded: before ? labelAnnotations(node.label).filter(item => !labelAnnotations(before.node.label).includes(item)) : [],
        wordChanged: Boolean(before && (before.node.word ?? '') !== (node.word ?? '')),
        silenceChanged: Boolean(before && before.silent !== entry.silent),
        subtreeChanged: Boolean(before && subtreeFingerprint(before.node) !== subtreeFingerprint(node)),
        lineageGained: Boolean(node.lineageId && (current.lineages.get(node.lineageId) ?? 0) > (prior.lineages.get(node.lineageId) ?? 0)),
        realizationChanged: JSON.stringify(realizationKeys(input.currentRealizations, id))
          !== JSON.stringify(realizationKeys(input.priorRealizations, id)),
        ...terminalChanges(current, prior, id)
      };
    }
    nodes[id] = facts;
  }
  const resolvedIds = anchorIds.filter(id => nodes[id].resolved);
  const pairs: StructuralSignature['pairs'] = [];
  for (let i = 0; i < resolvedIds.length; i += 1) for (let j = i + 1; j < resolvedIds.length; j += 1) {
    pairs.push({ a: resolvedIds[i], b: resolvedIds[j], relation: pairRelation(current, resolvedIds[i], resolvedIds[j]) });
  }
  const containerIds = resolvedIds.length >= 2
    ? resolvedIds.filter(id => resolvedIds.every(other => other === id || dominates(current, id, other))) : [];
  const forkCandidates = resolvedIds.length === 2 && pairs[0]?.relation === 'sisters'
    ? current.byId.get(resolvedIds[0])?.parentId : undefined;
  const forkParent = forkCandidates ? current.byId.get(forkCandidates)?.node : undefined;
  const anchoredForkParentId = resolvedIds.find(parentId => {
    const children = (current.byId.get(parentId)?.node.children ?? []).map(child => String(child.id));
    return children.length === 2 && resolvedIds.length === 3 && children.every(child => resolvedIds.includes(child));
  });
  const anchorKeys = new Set(anchorEntries.map(entry => entry.key));
  const values: StructuralValueFacts[] = Object.entries(input.relation.values ?? {}).map(([key, value]) => {
    const items = flatten(value);
    const paired = anchorKeys.has(key) ? key : undefined;
    return {
      key, items, isArray: Array.isArray(value),
      ...(paired ? {
        pairsWithAnchor: paired,
        lengthMatchesPairedAnchor: anchorEntries.find(entry => entry.key === paired)!.ids.length === items.length
      } : {}),
      annotationOf: items.map(item => resolvedIds.filter(id => (nodes[id].annotations ?? []).some(annotation => fold(annotation) === fold(item)))),
      pronouncedBy: items.map(item => resolvedIds.filter(id => fold(nodes[id].pronounced ?? '') !== '' && fold(nodes[id].pronounced ?? '') === fold(item))),
      symbolic: items.map(item => !/[\p{L}\p{N}]/u.test(item))
    };
  });
  return {
    anchorEntries,
    priorAnchorEntries,
    anchorIds,
    nodes,
    pairs,
    workspaceCount: new Set(resolvedIds.map(id => nodes[id].rootId)).size,
    containerIds,
    ...(forkParent && (forkParent.children?.length ?? 0) === 2 ? { forkParentId: String(forkParent.id) } : {}),
    ...(anchoredForkParentId ? { anchoredForkParentId } : {}),
    values,
    stage: {
      hasPrior: Boolean(prior),
      newNodeCount: prior ? [...current.byId.keys()].filter(id => !prior.byId.has(id)).length : current.byId.size,
      rootCountBefore: prior?.roots.length ?? 0,
      rootCountAfter: current.roots.length
    }
  };
};
