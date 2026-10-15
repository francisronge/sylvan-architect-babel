/** Syntax traversal, identity lookup, and material comparison shared by Replay compilation. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import {
  authoredWord,
  isLeafNode,
  isPronouncedLeaf,
  isSilentWordLeaf
} from '../server/babelParser/nodePronunciation.js';
import { type SyntaxNode } from '../types.ts';
import { isReplayDisplayChild } from './displayIdentity.ts';
import { isNotationSurface } from './replaySurfaceNotation.ts';
import { type HierNode, type PlaybackStep } from './types.ts';

export type PendingSourceSyntaxNode = SyntaxNode & {
  replayPriorInheritedSilence?: boolean;
};

/** A protected prior source inherits its preceding context, while keeping its own authored fields. */
export const replayEffectiveSilence = (node: SyntaxNode, inherited: boolean): boolean => (node as any).replayLayoutOnly ? inherited
  : ((node as PendingSourceSyntaxNode).replayPriorInheritedSilence ?? inherited)
  || node.silent === true || (node as any).ghost === true;

export const cloneSyntaxForest = (forest: SyntaxNode[] = []): SyntaxNode[] => forest
  .map((root) => cloneSyntaxTree(root))
  .filter((root): root is SyntaxNode => Boolean(root));

const AUTHORED_SYNTAX_NODE_FIELDS = ['id', 'label', 'word', 'tokenIndex', 'silent', 'lineageId', 'surfaceSpan', 'refId'] as const;

/**
 * Keeps only the contract fields of an authored node. Renderer metadata such
 * as `ghost`, `replayLayoutOnly`, `aliasIds` and `__vizId` can then originate
 * only inside Replay; an authored key with one of those names is inert.
 */
export const projectAuthoredSyntaxNode = (node: SyntaxNode): SyntaxNode => {
  const next: Record<string, unknown> = {};
  AUTHORED_SYNTAX_NODE_FIELDS.forEach((field) => {
    if (Object.hasOwn(node, field))
      next[field] = (node as unknown as Record<string, unknown>)[field];
  });
  if (Array.isArray(node.children)) {
    next.children = node.children
      .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
      .map(projectAuthoredSyntaxNode);
  }
  return next as unknown as SyntaxNode;
};

export const cloneSyntaxTree = (node?: SyntaxNode | null): SyntaxNode | null => {
  if (!node || typeof node !== 'object')
    return null;
  const serialized = JSON.stringify(node);
  if (!serialized)
    return null;
  return JSON.parse(serialized) as SyntaxNode;
};

export const findExactNodesByIdInForest = (forest: SyntaxNode[], targetNodeId: string): SyntaxNode[] => {
  const normalizedTargetNodeId = String(targetNodeId || '');
  if (!normalizedTargetNodeId)
    return [];
  const matches: SyntaxNode[] = [];
  const visit = (node?: SyntaxNode | null) => {
    if (!node || typeof node !== 'object')
      return;
    if (String(node.id || '') === normalizedTargetNodeId)
      matches.push(node);
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(forest) ? forest : []).forEach(visit);
  return matches;
};

export const collectExactNodesByIdInForest = (forest: SyntaxNode[]): Map<string, SyntaxNode[]> => {
  const nodesById = new Map<string, SyntaxNode[]>();
  const visit = (node?: SyntaxNode | null) => {
    if (!node || typeof node !== 'object')
      return;
    const nodeId = String(node.id || '');
    if (nodeId) {
      const matches = nodesById.get(nodeId) || [];
      matches.push(node);
      nodesById.set(nodeId, matches);
    }
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(forest) ? forest : []).forEach(visit);
  return nodesById;
};

export const collectExactSubtreeNodeIds = (node: SyntaxNode): Set<string> => {
  const nodeIds = new Set<string>();
  const visit = (candidate: SyntaxNode) => {
    const nodeId = String(candidate.id || '');
    if (nodeId)
      nodeIds.add(nodeId);
    (Array.isArray(candidate.children) ? candidate.children : []).forEach(visit);
  };
  visit(node);
  return nodeIds;
};

export type ExactForestNodeLocation = {
  node: SyntaxNode;
  parent: SyntaxNode | null;
  parentId: string;
  childIndex: number;
  rootIndex: number;
  depth: number;
};

export const indexExactForestNodeLocations = (forest: SyntaxNode[]): Map<string, ExactForestNodeLocation | null> => {
  const locations = new Map<string, ExactForestNodeLocation | null>();
  const visit = (
    node: SyntaxNode,
    parent: SyntaxNode | null,
    childIndex: number,
    rootIndex: number,
    depth: number
  ) => {
    const nodeId = String(node.id || '');
    if (nodeId) {
      const location = {
        node,
        parent,
        parentId: String(parent?.id || ''),
        childIndex,
        rootIndex,
        depth
      };
      locations.set(nodeId, locations.has(nodeId) ? null : location);
    }
    (Array.isArray(node.children) ? node.children : []).forEach((child, index) => {
      visit(child, node, index, rootIndex, depth + 1);
    });
  };
  forest.forEach((root, rootIndex) => visit(root, null, rootIndex, rootIndex, 0));
  return locations;
};

export const syntaxNodeMaterialSignature = (node: SyntaxNode): string => {
  const material = { ...node };
  delete material.children;
  return JSON.stringify(material);
};

export const getReplayVisibleNodeIdSet = (step?: PlaybackStep | null): Set<string> => new Set((Array.isArray(step?.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
  .map((nodeId) => String(nodeId || ''))
  .filter(Boolean));

export const getSyntaxNodeSurface = (node?: SyntaxNode | null): string => {
  if (!node)
    return '';
  return String(node.word || node.label || '').trim();
};

export const collectForestNodesById = (forest: SyntaxNode[]): Map<string, SyntaxNode> => {
  const out = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => {
    const id = String(node?.id || '');
    if (id)
      out.set(id, node);
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(visit);
  };
  forest.forEach(visit);
  return out;
};

export const collectSubtreeNodeIds = (node?: SyntaxNode | null): string[] => {
  if (!node || typeof node !== 'object')
    return [];
  const ids: string[] = [];
  const visit = (current: SyntaxNode) => {
    if ((current as any)?.replayLayoutOnly)
      return;
    const nodeId = String(current?.id || '');
    if (nodeId)
      ids.push(nodeId);
    const children = Array.isArray(current?.children) ? current.children : [];
    children.forEach(visit);
  };
  visit(node);
  return ids;
};

export const collectLeafSyntaxNodes = (root?: SyntaxNode | null): SyntaxNode[] => {
  if (!root || typeof root !== 'object')
    return [];
  const leaves: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      leaves.push(node);
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return leaves;
};

export const countOvertLeafSyntaxNodes = (root?: SyntaxNode | null): number => collectLeafSyntaxNodes(root).filter((leaf) => isLexicalLeaf(leaf)).length;

export const collectReplayOvertTokenMultisetKey = (forest: SyntaxNode[] = []): string => {
  const tokens = forest
    .flatMap((root) => collectLeafSyntaxNodes(root))
    .filter((leaf) => isLexicalLeaf(leaf))
    .map((leaf) => normalizeToken(authoredWord(leaf)))
    .filter(Boolean)
    .sort();
  return tokens.join('|');
};

const collectReplayOvertTokenSequence = (root?: SyntaxNode | null): string[] => collectLeafSyntaxNodes(root)
  .filter((leaf) => (leaf as any)?.replayLayoutOnly !== true && isLexicalLeaf(leaf))
  .map((leaf) => normalizeToken(authoredWord(leaf)))
  .filter(Boolean);

export const collectReplayRootStructuralKey = (forest: SyntaxNode[] = []): string => forest
  .map((root) => {
    const label = String(root?.label || '').trim().toUpperCase();
    const tokens = collectReplayOvertTokenSequence(root).join(' ');
    return label && tokens ? `${label}|${tokens}` : '';
  })
  .filter(Boolean)
  .join('||');

export const collectReplayContinuitySubtreeSignatures = (forest: SyntaxNode[], minimumOvertTokens = 2): Map<SyntaxNode, string> => {
  const signatures = new Map<SyntaxNode, string>();
  // Continuity carries already-built structure, not merely its spoken yield.
  // Display words duplicate their owner's material and do not add syntax.
  const visit = (node: SyntaxNode): {
    tokens: string[];
    shape: unknown;
  } => {
    const children = Array.isArray(node.children) ? node.children : [];
    const descendants = children.map(child => ({ node: child, ...visit(child) }));
    const tokens = children.length > 0
      ? descendants.flatMap(child => child.tokens)
      : (node as any).replayLayoutOnly !== true && isLexicalLeaf(node)
        ? [normalizeToken(authoredWord(node))].filter(Boolean) : [];
    const label = String(node.label || '').trim().toUpperCase();
    const shape = [label, normalizeToken(authoredWord(node)), node.silent === true,
      descendants.filter(child => !(child.node as any).replayLayoutOnly && !isReplayDisplayChild(child.node, node.id))
        .map(child => child.shape)];
    signatures.set(node, label && tokens.length >= minimumOvertTokens ? JSON.stringify(shape) : '');
    return { tokens, shape };
  };
  forest.forEach(visit);
  return signatures;
};

export const collectUniqueReplayContinuitySubtrees = (forest: SyntaxNode[] = []): Map<string, SyntaxNode> => {
  const candidates = new Map<string, SyntaxNode[]>();
  const signatures = collectReplayContinuitySubtreeSignatures(forest);
  const visit = (node: SyntaxNode) => {
    const signature = signatures.get(node);
    if (signature) {
      const entries = candidates.get(signature) || [];
      entries.push(node);
      candidates.set(signature, entries);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  forest.forEach(visit);
  const unique = new Map<string, SyntaxNode>();
  candidates.forEach((nodes, signature) => {
    if (nodes.length === 1)
      unique.set(signature, nodes[0]);
  });
  return unique;
};

export const hasBranchingSyntaxSubtree = (root?: SyntaxNode | null): boolean => {
  if (!root || typeof root !== 'object')
    return false;
  let branching = false;
  const visit = (node: SyntaxNode) => {
    if (branching)
      return;
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length > 1) {
      branching = true;
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return branching;
};

const pickOvertLeafNode = (root?: SyntaxNode | null): SyntaxNode | null => collectLeafSyntaxNodes(root).find((leaf) => isPronouncedLeaf(leaf)) || null;

export const findNodePathInForest = (forest: SyntaxNode[], targetNodeId: string): number[] | null => {
  const visit = (node: SyntaxNode, path: number[]): number[] | null => {
    if (String(node.id || '') === targetNodeId)
      return path;
    const children = Array.isArray(node.children) ? node.children : [];
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const found = visit(children[childIndex], [...path, childIndex]);
      if (found)
        return found;
    }
    return null;
  };
  for (let rootIndex = 0; rootIndex < forest.length; rootIndex += 1) {
    const found = visit(forest[rootIndex], [rootIndex]);
    if (found)
      return found;
  }
  return null;
};

export const getNodeAtForestPath = (forest: SyntaxNode[], path: number[] | null): SyntaxNode | null => {
  if (!Array.isArray(path) || path.length === 0)
    return null;
  let current: SyntaxNode | null = forest[path[0]] || null;
  if (!current)
    return null;
  for (let index = 1; index < path.length; index += 1) {
    const children = Array.isArray(current.children) ? current.children : [];
    current = children[path[index]] || null;
    if (!current)
      return null;
  }
  return current;
};

export const findNodeByIdInForest = (forest: SyntaxNode[], targetNodeId: string): SyntaxNode | null => {
  const normalizedTargetNodeId = String(targetNodeId || '');
  if (!normalizedTargetNodeId)
    return null;
  const visit = (node: SyntaxNode): SyntaxNode | null => {
    if (String(node.id || '') === normalizedTargetNodeId)
      return node;
    if ((Array.isArray(node.aliasIds) ? node.aliasIds : []).some((aliasId) => String(aliasId || '') === normalizedTargetNodeId)) {
      return node;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const found = visit(child);
      if (found)
        return found;
    }
    return null;
  };
  for (const root of forest) {
    const found = visit(root);
    if (found)
      return found;
  }
  return null;
};

export const findExactNodeByIdInForest = (forest: SyntaxNode[], targetNodeId: string): SyntaxNode | null => {
  const normalizedTargetNodeId = String(targetNodeId || '');
  if (!normalizedTargetNodeId)
    return null;
  const visit = (node: SyntaxNode): SyntaxNode | null => {
    if (String(node.id || '') === normalizedTargetNodeId)
      return node;
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const found = visit(child);
      if (found)
        return found;
    }
    return null;
  };
  for (const root of forest) {
    const found = visit(root);
    if (found)
      return found;
  }
  return null;
};

export const findParentNodeIdInForest = (forest: SyntaxNode[], targetNodeId: string): string => {
  const normalizedTargetNodeId = String(targetNodeId || '');
  if (!normalizedTargetNodeId)
    return '';
  const visit = (node: SyntaxNode, parentId: string): string => {
    if (String(node.id || '') === normalizedTargetNodeId
      || (Array.isArray(node.aliasIds) ? node.aliasIds : []).some((aliasId) => String(aliasId || '') === normalizedTargetNodeId))
      return parentId;
    const ownId = String(node.id || '');
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const found = visit(child, ownId || parentId);
      if (found)
        return found;
    }
    return '';
  };
  for (const root of forest) {
    const found = visit(root, '');
    if (found)
      return found;
  }
  return '';
};

export const resolvedRelationLinkKey = (link?: ResolvedRelationLink | null): string => [
  String(link?.relationIndex || '').trim(),
  String(link?.operation || '').trim(),
  String(link?.sourceNodeId || ''),
  String(link?.targetNodeId || ''),
  String(link?.witnessNodeId || ''),
  String(link?.chainId || '')
].join('|');

export const subtreeHasOvertYield = (node?: SyntaxNode | null): boolean => Boolean(pickOvertLeafNode(node));

export const resolveNodeLabel = (node: HierNode): string => node.data.label || node.data.word || '';

export const normalizeToken = (value: string): string => {
  return value
    .trim()
    .normalize('NFC')
    .toLowerCase()
    .normalize('NFC')
    .replace(/^<|>$/g, '')
    .replace(/^⟨|⟩$/g, '')
    .replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
};

/** An unpronounced leaf whose authored surface is notation rather than retained lexical content. */
export const isNotationLeaf = (node?: SyntaxNode | null): boolean => isLeafNode(node) && !isPronouncedLeaf(node) && isNotationSurface(getSyntaxNodeSurface(node));

/** A leaf carrying lexical content: pronounced, or a silent copy whose retained word is not notation. */
export const isLexicalLeaf = (node?: SyntaxNode | null): boolean => isPronouncedLeaf(node) || (isSilentWordLeaf(node) && !isNotationSurface(authoredWord(node)));

export const hasSilentOrGhostAncestor = (node: HierNode | null): boolean => {
  const path: SyntaxNode[] = [];
  let current: HierNode | null = node;
  while (current) {
    path.push(current.data);
    current = current.parent;
  }
  return path.reverse().reduce((silent, data) => replayEffectiveSilence(data, silent), false);
};

export const isPronouncedHierLeaf = (node: HierNode): boolean => isPronouncedLeaf(node.data) && !hasSilentOrGhostAncestor(node);

export const collectOvertLeafNodeIdsInOrder = (root?: SyntaxNode | null): string[] => {
  if (!root || typeof root !== 'object')
    return [];
  const overtIds: string[] = [];
  const visit = (node: SyntaxNode) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      const nodeId = String(node?.id || '');
      if (nodeId && isLexicalLeaf(node))
        overtIds.push(nodeId);
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return overtIds;
};

export const collectPronouncedLeafNodeIdsInOrder = (root?: SyntaxNode | null): string[] => {
  if (!root || typeof root !== 'object')
    return [];
  const pronouncedIds: string[] = [];
  const visit = (node: SyntaxNode, silentAncestor: boolean) => {
    const silent = replayEffectiveSilence(node, silentAncestor);
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      const nodeId = String(node?.id || '');
      if (!silent && nodeId && isPronouncedLeaf(node))
        pronouncedIds.push(nodeId);
      return;
    }
    children.forEach((child) => visit(child, silent));
  };
  visit(root, false);
  return pronouncedIds;
};

export const collectSyntaxSubtreeNodeIds = (root?: SyntaxNode | null): string[] => {
  if (!root || typeof root !== 'object')
    return [];
  const ids: string[] = [];
  const visit = (node: SyntaxNode) => {
    const nodeId = String(node?.id || '');
    if (nodeId)
      ids.push(nodeId);
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return ids;
};

export const collectReplayCanvasNodes = (root?: SyntaxNode | null): SyntaxNode[] => {
  if (!root || typeof root !== 'object')
    return [];
  const nodes: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    nodes.push(node);
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return nodes;
};

