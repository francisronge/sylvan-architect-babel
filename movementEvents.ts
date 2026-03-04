import { MovementEvent, SyntaxNode } from './types';

export interface MovementIndexMaps {
  movedByNodeId: Map<string, string>;
  traceByNodeId: Map<string, string>;
}

export interface ResolvedMovementEventLink {
  movementIndex: string;
  sourceAnchorId: string;
  movedAnchorId: string;
  traceAnchorId?: string;
  stepIndex?: number;
  operation?: MovementEvent['operation'];
  note?: string;
}

export const EMPTY_MOVEMENT_INDEX_MAPS: MovementIndexMaps = {
  movedByNodeId: new Map(),
  traceByNodeId: new Map()
};

const NULL_SURFACE_RE = /^(∅|Ø|ε|null|epsilon)$/i;
const TRACE_SURFACE_RE = /^(t(?:race)?(?:[_-]?[a-z0-9]+)?|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\})$/i;

const indexToLetter = (index: number): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  if (index < alphabet.length) return alphabet[index];
  const base = alphabet[index % alphabet.length];
  const cycle = Math.floor(index / alphabet.length);
  return `${base}${cycle}`;
};

const collectLeafNodes = (root: SyntaxNode): SyntaxNode[] => {
  const leaves: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      leaves.push(node);
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return leaves;
};

const resolveLeafSurface = (node: SyntaxNode): string =>
  String(node.word || node.label || '').trim();

const pickLexicalAnchor = (node: SyntaxNode): SyntaxNode | null => {
  const leaves = collectLeafNodes(node);
  if (leaves.length === 0) return null;

  return (
    leaves.find((leaf) => {
      const surface = resolveLeafSurface(leaf);
      return surface.length > 0 && !NULL_SURFACE_RE.test(surface) && !TRACE_SURFACE_RE.test(surface);
    }) ||
    leaves.find((leaf) => {
      const surface = resolveLeafSurface(leaf);
      return surface.length > 0 && !NULL_SURFACE_RE.test(surface);
    }) ||
    leaves[0]
  );
};

const pickTraceAnchor = (node: SyntaxNode): SyntaxNode | null => {
  const leaves = collectLeafNodes(node);
  if (leaves.length === 0) return null;

  return (
    leaves.find((leaf) => TRACE_SURFACE_RE.test(resolveLeafSurface(leaf))) ||
    leaves.find((leaf) => NULL_SURFACE_RE.test(resolveLeafSurface(leaf))) ||
    leaves[0]
  );
};

const isHeadTargetNode = (node: SyntaxNode): boolean => {
  const label = String(node.label || '').trim().toLowerCase();
  return label === 'c' || label === 't' || label === 'infl' || label === 'i';
};

const pickDistinctLeafAnchor = (node: SyntaxNode, avoidNodeId?: string): SyntaxNode | null => {
  const leaves = collectLeafNodes(node);
  if (leaves.length === 0) return null;
  const avoid = String(avoidNodeId || '').trim();

  const preferred = leaves.find((leaf) => {
    const id = String(leaf.id || '').trim();
    if (!id || (avoid && id === avoid)) return false;
    const surface = resolveLeafSurface(leaf);
    return surface.length > 0 && !NULL_SURFACE_RE.test(surface) && !TRACE_SURFACE_RE.test(surface);
  });
  if (preferred) return preferred;

  return leaves.find((leaf) => {
    const id = String(leaf.id || '').trim();
    return Boolean(id) && (!avoid || id !== avoid);
  }) || null;
};

const buildNodeIndex = (root: SyntaxNode): Map<string, SyntaxNode> => {
  const byId = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => {
    const id = String(node.id || '').trim();
    if (id) byId.set(id, node);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return byId;
};

export const resolveMovementEventLinks = (
  tree: SyntaxNode,
  movementEvents?: MovementEvent[]
): ResolvedMovementEventLink[] => {
  if (!movementEvents || movementEvents.length === 0) return [];

  const nodeById = buildNodeIndex(tree);
  const links: ResolvedMovementEventLink[] = [];
  const seenPairs = new Set<string>();
  let nextIndex = 0;

  movementEvents.forEach((event) => {
    const toNode = nodeById.get(String(event.toNodeId || '').trim());
    const fromNode = nodeById.get(String(event.fromNodeId || '').trim());
    if (!toNode || !fromNode) return;

    const traceNode = event.traceNodeId ? nodeById.get(String(event.traceNodeId).trim()) : undefined;
    const fromLexicalAnchor = pickLexicalAnchor(fromNode);
    let movedAnchor = pickLexicalAnchor(toNode) || fromLexicalAnchor || toNode;
    const traceAnchor = traceNode ? pickTraceAnchor(traceNode) : pickTraceAnchor(fromNode);
    const preferLexicalSource = isHeadTargetNode(toNode);
    let sourceAnchor = preferLexicalSource
      ? (fromLexicalAnchor || traceAnchor || movedAnchor)
      : (traceAnchor || fromLexicalAnchor || movedAnchor);

    // If both sides collapse to the same lexical leaf, widen anchors to preserve a drawable arc.
    if (sourceAnchor?.id && movedAnchor?.id && sourceAnchor.id === movedAnchor.id) {
      const sourceDistinct =
        pickDistinctLeafAnchor(fromNode, movedAnchor.id) ||
        (traceNode ? pickDistinctLeafAnchor(traceNode, movedAnchor.id) : null) ||
        (fromNode.id && fromNode.id !== movedAnchor.id ? fromNode : null);
      if (sourceDistinct) {
        sourceAnchor = sourceDistinct;
      }

      const movedDistinct =
        pickDistinctLeafAnchor(toNode, sourceAnchor?.id) ||
        (toNode.id && toNode.id !== sourceAnchor?.id ? toNode : null);
      if (movedDistinct) {
        movedAnchor = movedDistinct;
      }

      if (sourceAnchor?.id && movedAnchor?.id && sourceAnchor.id === movedAnchor.id) {
        if (fromNode.id && toNode.id && fromNode.id !== toNode.id) {
          sourceAnchor = fromNode;
          movedAnchor = toNode;
        }
      }
    }

    if (!movedAnchor?.id || !sourceAnchor?.id) return;

    const pairKey = `${sourceAnchor.id}->${movedAnchor.id}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);

    const movementIndex = indexToLetter(nextIndex);
    nextIndex += 1;

    const rawStep = Number(event.stepIndex);
    const stepIndex = Number.isInteger(rawStep) && rawStep >= 0 ? rawStep : undefined;

    links.push({
      movementIndex,
      sourceAnchorId: sourceAnchor.id,
      movedAnchorId: movedAnchor.id,
      traceAnchorId: traceAnchor?.id || undefined,
      stepIndex,
      operation: event.operation,
      note: event.note
    });
  });

  return links;
};

export const buildMovementIndexMaps = (
  tree: SyntaxNode,
  movementEvents?: MovementEvent[]
): MovementIndexMaps => {
  const links = resolveMovementEventLinks(tree, movementEvents);
  if (links.length === 0) return EMPTY_MOVEMENT_INDEX_MAPS;

  const movedByNodeId = new Map<string, string>();
  const traceByNodeId = new Map<string, string>();

  links.forEach((link) => {
    movedByNodeId.set(link.movedAnchorId, link.movementIndex);
    if (link.traceAnchorId) {
      traceByNodeId.set(link.traceAnchorId, link.movementIndex);
    }
  });

  return { movedByNodeId, traceByNodeId };
};
