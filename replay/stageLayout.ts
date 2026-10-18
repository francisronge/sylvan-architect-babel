/** Reserve future workspace geometry without revealing or replacing current syntax. */
import { type SyntaxNode } from '../types.ts';
import { createReplayIdentityContext } from './displayIdentity.ts';
import { productionRelationRegistry } from './relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from './relationDispatch/relationRegistry.js';
import { isRegisteredTrajectoryRelation } from './relations/movementIdentities.ts';
import { PRODUCTION_RENDER_FAMILIES } from './relations/renderFamilies.ts';
import {
  cloneSyntaxTree,
  collectExactNodesByIdInForest,
  collectSubtreeNodeIds,
  findNodePathInForest
} from './syntaxForest.ts';
import { type PlaybackStep, type ReplayDerivationFrame } from './types.ts';

export const reorderWorkspaceRootsForReplay = (workspaceRoots: SyntaxNode[], preferredRootIds?: string[] | null): SyntaxNode[] => {
  if (!Array.isArray(workspaceRoots) || workspaceRoots.length <= 1)
    return workspaceRoots;
  const preferredIds = Array.isArray(preferredRootIds)
    ? preferredRootIds.map((id) => String(id || '')).filter(Boolean)
    : [];
  if (preferredIds.length === 0)
    return workspaceRoots;
  const rootsById = new Map(workspaceRoots
    .map((node) => [String(node?.id || ''), node] as const)
    .filter(([id]) => Boolean(id)));
  const ordered: SyntaxNode[] = [];
  const used = new Set<string>();
  preferredIds.forEach((id) => {
    const node = rootsById.get(id);
    if (!node || used.has(id))
      return;
    ordered.push(node);
    used.add(id);
  });
  workspaceRoots.forEach((node) => {
    const id = String(node?.id || '');
    if (id && used.has(id))
      return;
    ordered.push(node);
  });
  return ordered.length === workspaceRoots.length ? ordered : workspaceRoots;
};

const collectWorkspaceRootIds = (workspaceRoots: SyntaxNode[]): string[] => (Array.isArray(workspaceRoots) ? workspaceRoots : [])
  .map((node) => String(node?.id || ''))
  .filter(Boolean);

const collectWorkspaceRootParents = (forest: SyntaxNode[], rootIds: ReadonlySet<string>) => {
  const parents = new Map<string, SyntaxNode | null>();
  const visit = (node: SyntaxNode, parent: SyntaxNode | null) => {
    const nodeId = String(node.id || '');
    if (rootIds.has(nodeId))
      parents.set(nodeId, parent);
    (node.children || []).forEach(child => visit(child, node));
  };
  forest.forEach(root => visit(root, null));
  return parents;
};

const preservesRelativeSiblingOrder = (before: SyntaxNode[], after: SyntaxNode[]): boolean => {
  const beforeIds = collectWorkspaceRootIds(before), afterIds = collectWorkspaceRootIds(after);
  const beforeSet = new Set(beforeIds), afterSet = new Set(afterIds);
  return JSON.stringify(beforeIds.filter(id => afterSet.has(id)))
    === JSON.stringify(afterIds.filter(id => beforeSet.has(id)));
};

const replayLayoutTreeSignature = (node: SyntaxNode | null | undefined, describe: (node: SyntaxNode) => string): string => {
  // Serialize the nested structure once. Serializing each child signature
  // again at every parent makes quote escaping grow exponentially with depth.
  const shape = (current?: SyntaxNode | null): unknown => !current || typeof current !== 'object'
    ? ''
    : [describe(current), (Array.isArray(current.children) ? current.children : []).map(shape)];
  return JSON.stringify(shape(node));
};

const replayLayoutContinuitySignature = (node?: SyntaxNode | null): string => replayLayoutTreeSignature(node, replayLayoutMaterialSignature);

const replayLayoutTopologySignature = (node?: SyntaxNode | null): string => replayLayoutTreeSignature(node, current => String(current.id || ''));

const replayLayoutMaterialSignature = (node?: SyntaxNode | null): string => {
  if (!node || typeof node !== 'object')
    return '';
  return JSON.stringify([
    String(node.id || ''),
    String(node.label || '').trim(),
    String(node.word || '').trim(),
    node.silent === true,
    Number.isFinite(Number(node.tokenIndex)) ? Number(node.tokenIndex) : null,
    String(node.lineageId || '')
  ]);
};

/**
 * Whether a scaffold can lay out the current forest inside future topology.
 * Each current node occurs once in it with its current material and keeps its
 * current children in their order; it may gain future parents and siblings,
 * so hidden future structure never relocates an existing child before its
 * movement moment. A parent in `heldParentIds` has a new attachment that
 * construction is still holding back (constructionAttachments.ts): the
 * scaffold gives it no current child that the current forest does not.
 */
export const forestCanUseCurrentMaterialLayoutScaffold = (
  currentRoots: SyntaxNode[],
  scaffoldRoots: SyntaxNode[],
  heldParentIds?: ReadonlySet<string>
): boolean => {
  if (!Array.isArray(currentRoots) || currentRoots.length === 0)
    return false;
  if (!Array.isArray(scaffoldRoots) || scaffoldRoots.length === 0)
    return false;
  const currentNodesById = collectExactNodesByIdInForest(currentRoots);
  const scaffoldNodesById = collectExactNodesByIdInForest(scaffoldRoots);
  if (currentNodesById.size === 0)
    return false;
  return Array.from(currentNodesById.entries()).every(([nodeId, currentMatches]) => {
    const scaffoldMatches = scaffoldNodesById.get(nodeId) || [];
    return currentMatches.length === 1
      && scaffoldMatches.length === 1
      && replayLayoutMaterialSignature(currentMatches[0])
      === replayLayoutMaterialSignature(scaffoldMatches[0])
      && (currentMatches[0].children || []).every(child => scaffoldMatches[0].children?.some(candidate => candidate.id === child.id))
      && preservesRelativeSiblingOrder(currentMatches[0].children || [], scaffoldMatches[0].children || [])
      && (!heldParentIds?.has(nodeId) || (scaffoldMatches[0].children || []).every(candidate =>
        !currentNodesById.has(String(candidate.id || ''))
        || (currentMatches[0].children || []).some(child => child.id === candidate.id)));
  });
};

/**
 * Borrow only a future frame's topology. Current nodes keep their exact
 * authored material; future-only nodes are layout-only and therefore reserve
 * coordinates without appearing. Every current workspace root must have one
 * unambiguous future occurrence, including roots later wrapped by External
 * Merge.
 */
export const buildCurrentMaterialLayoutScaffold = (
  currentRoots: SyntaxNode[],
  futureRoots: SyntaxNode[],
  allowedFutureOccurrenceIds: ReadonlySet<string> = new Set()
): SyntaxNode[] | null => {
  if (!Array.isArray(currentRoots) || currentRoots.length === 0)
    return null;
  if (!Array.isArray(futureRoots) || futureRoots.length === 0)
    return null;
  const currentNodesById = collectExactNodesByIdInForest(currentRoots);
  if (currentNodesById.size === 0)
    return null;
  if (Array.from(currentNodesById.values()).some((matches) => matches.length !== 1))
    return null;
  const currentTopology = JSON.stringify(currentRoots.map((root) => replayLayoutTopologySignature(root)));
  const futureTopology = JSON.stringify(futureRoots.map((root) => replayLayoutTopologySignature(root)));
  if (currentTopology === futureTopology)
    return null;
  const findExactPaths = (roots: SyntaxNode[], targetNodeId: string): number[][] => {
    const paths: number[][] = [];
    const visit = (node: SyntaxNode, path: number[]) => {
      if (String(node.id || '') === targetNodeId)
        paths.push(path);
      (Array.isArray(node.children) ? node.children : []).forEach((child, childIndex) => {
        visit(child, [...path, childIndex]);
      });
    };
    roots.forEach((root, rootIndex) => visit(root, [rootIndex]));
    return paths;
  };
  const getNodeAtPath = (roots: SyntaxNode[], path: number[]): SyntaxNode | null => {
    let current = roots[path[0]] || null;
    for (let index = 1; current && index < path.length; index += 1) {
      current = (Array.isArray(current.children) ? current.children : [])[path[index]] || null;
    }
    return current;
  };
  const replaceNodeAtPath = (roots: SyntaxNode[], path: number[], replacement: SyntaxNode): SyntaxNode[] => {
    // These skeleton nodes belong to this build and have no external readers.
    const nextRoots = roots;
    if (path.length === 1) {
      nextRoots[path[0]] = replacement;
      return nextRoots;
    }
    let parent = nextRoots[path[0]];
    for (let index = 1; index < path.length - 1; index += 1) {
      parent = (parent.children || [])[path[index]];
    }
    const children = Array.isArray(parent.children) ? [...parent.children] : [];
    children[path[path.length - 1]] = replacement;
    parent.children = children;
    return nextRoots;
  };
  const identity = createReplayIdentityContext([...currentRoots, ...futureRoots]);
  let placeholderIndex = 0;
  const buildLayoutOnlySkeleton = (futureNode: SyntaxNode): SyntaxNode => {
    const originalNodeId = String(futureNode.id || '');
    const next: SyntaxNode = { ...futureNode };
    delete next.children;
    if (Array.isArray(futureNode.children)) {
      next.children = futureNode.children.map(buildLayoutOnlySkeleton);
    }
    if (originalNodeId && currentNodesById.has(originalNodeId)) {
      placeholderIndex += 1;
      next.replayOrigin = { kind: 'layout', authoredId: originalNodeId };
      next.id = identity.allocate(`__babel_future_layout_${placeholderIndex}__${originalNodeId}`, next.replayOrigin);
      delete next.aliasIds;
      delete next.lineageId;
      delete next.tokenIndex;
    }
    (next as any).replayLayoutOnly = true;
    return next;
  };
  const graftCurrentMaterial = (currentNode: SyntaxNode, futureNode: SyntaxNode): SyntaxNode => {
    const { children: _children, ...material } = currentNode;
    const next = cloneSyntaxTree(material)!;
    delete (next as any).replayLayoutOnly;
    const currentChildren = Array.isArray(currentNode.children) ? currentNode.children : [];
    const futureChildren = Array.isArray(futureNode.children) ? futureNode.children : [];
    if (currentChildren.length === 0 || futureChildren.length === 0) {
      if (_children)
        next.children = currentChildren.map(child => cloneSyntaxTree(child)!);
      return next;
    }
    const childMatches = currentChildren.map((currentChild) => ({
      currentChild,
      paths: findExactPaths(futureChildren, String(currentChild.id || ''))
    }));
    if (childMatches.some(({ paths }) => paths.length !== 1 || paths[0].length !== 1)
      || !preservesRelativeSiblingOrder(currentChildren, futureChildren)) {
      next.children = currentChildren.map((child) => cloneSyntaxTree(child) || child);
      return next;
    }
    let scaffoldChildren = futureChildren.map(buildLayoutOnlySkeleton);
    childMatches
      .sort((left, right) => right.paths[0].length - left.paths[0].length)
      .forEach(({ currentChild, paths }) => {
        const futureMatch = getNodeAtPath(futureChildren, paths[0]);
        if (!futureMatch)
          return;
        scaffoldChildren = replaceNodeAtPath(scaffoldChildren, paths[0], graftCurrentMaterial(currentChild, futureMatch));
      });
    next.children = scaffoldChildren;
    return next;
  };
  const rootMatches = currentRoots.map((currentRoot) => ({
    currentRoot,
    paths: findExactPaths(futureRoots, String(currentRoot.id || ''))
  }));
  if (rootMatches.some(({ paths }) => paths.length !== 1))
    return null;
  let scaffold = futureRoots.map(buildLayoutOnlySkeleton);
  rootMatches
    .sort((left, right) => right.paths[0].length - left.paths[0].length)
    .forEach(({ currentRoot, paths }) => {
      const futureMatch = getNodeAtPath(futureRoots, paths[0]);
      if (!futureMatch)
        return;
      // One unchanged retained tree needs no recursive child grafting. Keeping
      // this fast path at the sole root also preserves placeholder allocation order.
      const retainedTree = rootMatches.length === 1
        && replayLayoutContinuitySignature(currentRoot) === replayLayoutContinuitySignature(futureMatch);
      scaffold = replaceNodeAtPath(scaffold, paths[0], retainedTree ? cloneSyntaxTree(currentRoot)! : graftCurrentMaterial(currentRoot, futureMatch));
    });
  const containsUnauthorizedFutureOccurrence = Array.from(collectExactNodesByIdInForest(scaffold).values())
    .flat().some(node => node.replayOrigin?.kind === 'layout'
      && !allowedFutureOccurrenceIds.has(node.replayOrigin.authoredId || ''));
  if (containsUnauthorizedFutureOccurrence)
    return null;
  return forestCanUseCurrentMaterialLayoutScaffold(currentRoots, scaffold) ? scaffold : null;
};

/** Preserve a detached object's first parent slot through later head wrappers.
 * A relocation outside that slot or a changed sibling order ends lookahead. */
const retainFirstAttachmentSlots = (forest: SyntaxNode[], attachments: ReadonlyMap<string, SyntaxNode>): SyntaxNode[] | null => {
  if (!attachments.size)
    return forest;
  let layout = forest;
  for (const [id, originalParent] of attachments) {
    const byId = collectExactNodesByIdInForest(layout);
    const parents = byId.get(String(originalParent.id || '')) || [];
    const matches = byId.get(id) || [];
    if (parents.length !== 1 || matches.length !== 1)
      return null;
    const parent = parents[0];
    const slot = (parent.children || []).findIndex(child => collectExactNodesByIdInForest([child]).has(id));
    if (slot < 0)
      return null;
    const children = [...(parent.children || [])];
    children[slot] = matches[0];
    if (!preservesRelativeSiblingOrder(originalParent.children || [], children))
      return null;
    if (parent.children?.[slot] === matches[0])
      continue;
    const replace = (node: SyntaxNode): SyntaxNode => node === parent
      ? { ...node, children }
      : { ...node, ...(node.children ? { children: node.children.map(replace) } : {}) };
    layout = layout.map(replace);
  }
  return layout;
};

/**
 * Reserve the next unambiguous parent layout. Exact retained subtrees use it
 * directly. Detached workspace objects may also borrow a later wrapper after
 * their current-stage versions have been substituted back into that scaffold.
 */
export const inferFutureLayoutScaffold = (
  workspaceRoots: SyntaxNode[],
  frames: ReplayDerivationFrame[],
  currentFrameIndex: number
): SyntaxNode[] | null => {
  if (!Array.isArray(workspaceRoots) || workspaceRoots.length === 0)
    return null;
  const seeksComposedWorkspaceLayout = workspaceRoots.length > 1;
  const candidates: Array<{
    forest: SyntaxNode[];
    allowedOccurrenceIds: Set<string>;
  }> = [];
  const allowedFutureOccurrenceIds = new Set<string>();
  const currentRootIds = new Set(collectWorkspaceRootIds(workspaceRoots));
  const firstAttachments = new Map<string, SyntaxNode>();
  const currentRootSignatures = new Map(workspaceRoots.map(root => [root, replayLayoutContinuitySignature(root)]));
  const currentForestSignature = JSON.stringify(workspaceRoots.map(root => currentRootSignatures.get(root)));
  const currentTopologySignature = JSON.stringify(workspaceRoots.map(replayLayoutTopologySignature));
  for (let futureFrameIndex = currentFrameIndex + 1; futureFrameIndex < frames.length; futureFrameIndex += 1) {
    const futureFrame = frames[futureFrameIndex];
    let futureRoots = Array.isArray(frames[futureFrameIndex]?.workspaceForest)
      ? frames[futureFrameIndex].workspaceForest
      : [];
    // Each detached object reserves its first attachment independently. A
    // later wrapper around one head must not stop looking ahead for other
    // objects that are still detached. Contract those later wrappers in the
    // layout copy only; current material is grafted back below.
    const attachmentLayout = retainFirstAttachmentSlots(futureRoots, firstAttachments);
    if (!attachmentLayout)
      break;
    futureRoots = attachmentLayout;
    const futureNodesById = collectExactNodesByIdInForest(futureRoots);
    const futureParents = collectWorkspaceRootParents(futureRoots, currentRootIds);
    futureParents.forEach((parent, id) => {
      if (parent && !firstAttachments.has(id))
        firstAttachments.set(id, parent);
    });
    const preservesCurrentSubtrees = workspaceRoots.every(root => {
      const matches = futureNodesById.get(String(root.id || '')) || [];
      return matches.length === 1 && replayLayoutContinuitySignature(matches[0]) === currentRootSignatures.get(root);
    });
    const preservesCurrentTopology = currentTopologySignature === JSON.stringify(futureRoots.map((root) => replayLayoutTopologySignature(root)));
    const addsOnlyOuterWrapper = workspaceRoots.every((currentRoot) => {
      const currentRootId = String(currentRoot?.id || '');
      if (!currentRootId)
        return false;
      return futureNodesById.get(currentRootId)?.length === 1
        && !futureRoots.some((futureRoot) => String(futureRoot?.id || '') === currentRootId);
    });
    const futureIntroducesTrajectory = (Array.isArray(futureFrame?.relations) ? futureFrame.relations : [])
      .some((relation) => isRegisteredTrajectoryRelation(relation?.relation, relation?.anchors));
    const futureIntroducesCrossWorkspaceTrajectory = (Array.isArray(futureFrame?.relations) ? futureFrame.relations : []).some((relation) => {
      const entry = findRelationRegistryEntry(productionRelationRegistry, String(relation?.relation || ''));
      return Boolean(entry && PRODUCTION_RENDER_FAMILIES[entry.id]?.trajectoryKind === 'sideward');
    });
    if (futureIntroducesCrossWorkspaceTrajectory)
      break;
    if (seeksComposedWorkspaceLayout) {
      (Array.isArray(futureFrame?.relations) ? futureFrame.relations : [])
        .filter((relation) => isRegisteredTrajectoryRelation(relation?.relation, relation?.anchors))
        .forEach((relation) => {
          (['pronouncedCopy', 'higherCopy'] as const).forEach((role) => {
            const authoredValue = relation?.anchors?.[role];
            const targetIds = Array.isArray(authoredValue) ? authoredValue : [authoredValue];
            targetIds.forEach((targetId) => {
              const normalizedTargetId = String(targetId || '');
              if (!normalizedTargetId)
                return;
              allowedFutureOccurrenceIds.add(normalizedTargetId);
              const targetMatches = futureNodesById.get(normalizedTargetId) || [];
              if (targetMatches.length === 1) {
                collectExactNodesByIdInForest([targetMatches[0]]).forEach((_nodes, nodeId) => {
                  allowedFutureOccurrenceIds.add(nodeId);
                });
              }
            });
          });
        });
    }
    if (futureIntroducesTrajectory
      && !preservesCurrentSubtrees
      && !addsOnlyOuterWrapper
      && !preservesCurrentTopology
      && !seeksComposedWorkspaceLayout)
      break;
    if (preservesCurrentSubtrees) {
      const futureForestSignature = JSON.stringify(futureRoots.map((root) => replayLayoutContinuitySignature(root)));
      if (futureForestSignature !== currentForestSignature) {
        candidates.push({ forest: futureRoots, allowedOccurrenceIds: new Set(allowedFutureOccurrenceIds) });
      }
      continue;
    }
    if (preservesCurrentTopology)
      continue;
    if (!workspaceRoots.every(root => futureNodesById.get(String(root.id || ''))?.length === 1))
      break;
    candidates.push({ forest: futureRoots, allowedOccurrenceIds: new Set(allowedFutureOccurrenceIds) });
  }
  // Only the last valid candidate survives the forward scan. Construct it
  // first, falling back through earlier candidates if its material is invalid.
  // Each candidate retains the occurrence permissions from its own stage.
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const scaffold = buildCurrentMaterialLayoutScaffold(workspaceRoots, candidate.forest, candidate.allowedOccurrenceIds);
    if (scaffold)
      return scaffold;
  }
  return null;
};

/** The outside position of a reserved component depends on its attachment,
 * not on the later order of heads inside it. A component that splits before
 * that attachment cannot supply a reliable earlier placement. */
const inferReservedComponentOrder = (
  components: SyntaxNode[],
  frames: ReplayDerivationFrame[],
  stage: number
): string[] | null => {
  if (!components.some(component => 'replayLayoutOnly' in component && component.replayLayoutOnly === true))
    return null;
  const ids = components.map(component => component.id);
  const candidates = frames.map((frame, index) => index < stage ? null
    : collectExactNodesByIdInForest(frame.workspaceForest || []));
  const first = candidates.findIndex(nodes => nodes && ids.every(id => nodes.get(id)?.length === 1));
  if (first < 0)
    return null;
  for (const component of components) {
    const material = [...collectExactNodesByIdInForest([component])]
      .filter(([, nodes]) => nodes.some(node => !('replayLayoutOnly' in node && node.replayLayoutOnly === true) && !node.replayOrigin))
      .map(([id]) => id);
    for (let index = first; index < frames.length; index++) {
      const matches = candidates[index]?.get(component.id);
      if (matches?.length !== 1)
        return null;
      if (!frames[index].workspaceForest?.some(root => root.id === component.id))
        break;
      const contents = collectExactNodesByIdInForest(matches);
      if (material.some(id => contents.get(id)?.length !== 1))
        return null;
    }
  }
  return inferFutureWorkspaceRootOrder(components, frames, Math.max(stage, first - 1), true);
};

/** Independent workspace components can reserve their future side without
 * changing selection order or borrowing future parents and branch heights. */
export const orderDetachedReplayWorkspaces = (steps: PlaybackStep[], frames: ReplayDerivationFrame[]): PlaybackStep[] => {
  const orders = new Map<number, Map<string, number> | null>();
  const canvases = new Map<number, Map<SyntaxNode, SyntaxNode>>();
  return steps.map(step => {
    const canvas = step.replayCanvasData, stage = step.replayFrameIndex;
    if (!canvas || canvas.replayOrigin?.kind !== 'workspace' || stage == null
      || (canvas.children?.length || 0) < 2)
      return step;
    if (!orders.has(stage)) {
      const order = inferFutureWorkspaceRootOrder(frames[stage]?.workspaceForest || [], frames, stage, true);
      orders.set(stage, order ? new Map(order.map((id, index) => [id, index])) : null);
    }
    const order = orders.get(stage);
    if (!order)
      return step;
    const cache = canvases.get(stage) || new Map<SyntaxNode, SyntaxNode>();
    canvases.set(stage, cache);
    if (!cache.has(canvas)) {
      // A reserved component may already contain several detached roots. Use
      // its outer attachment to place that component; internal head movement
      // cannot put an unrelated loose root on the opposite side of it.
      const componentOrder = inferReservedComponentOrder(canvas.children!, frames, stage);
      const componentSlots = componentOrder && new Map(componentOrder.map((id, index) => [id, index]));
      const components = canvas.children!.map(child => {
        const slots = componentSlots ? [componentSlots.get(child.id)!]
          : [...collectExactNodesByIdInForest([child]).keys()].flatMap(id => order.has(id) ? [order.get(id)!] : []);
        return { child, first: Math.min(...slots), last: Math.max(...slots) };
      }).sort((a, b) => a.first - b.first);
      const distinct = components.every((item, index) => Number.isFinite(item.first)
        && (!index || components[index - 1].last < item.first));
      const children = distinct ? components.map(item => item.child) : canvas.children!;
      cache.set(canvas, children.every((child, index) => child === canvas.children![index])
        ? canvas : { ...canvas, children });
    }
    const ordered = cache.get(canvas)!;
    return ordered === canvas ? step : { ...step, replayCanvasData: ordered };
  });
};

export const buildWorkspaceRootSideHints = (workspaceRoots: SyntaxNode[], preferredRootIds?: string[] | null): Map<string, number> => {
  const orderedRootIds = (Array.isArray(preferredRootIds) && preferredRootIds.length > 0
    ? preferredRootIds
    : collectWorkspaceRootIds(workspaceRoots))
    .map((id) => String(id || ''))
    .filter(Boolean);
  const hints = new Map<string, number>();
  orderedRootIds.forEach((rootId, index) => {
    hints.set(rootId, index);
  });
  return hints;
};

/** Outer projections can change a root's immediate parent without changing
 * its first attachment or its order beside roots already merged with it. */
const preservesFirstRootAttachments = (forest: SyntaxNode[], attachments: ReadonlyMap<string, SyntaxNode>): boolean => {
  const nodes = collectExactNodesByIdInForest(forest);
  for (const [id, originalParent] of attachments) {
    const parents = nodes.get(String(originalParent.id || ''));
    if (parents?.length !== 1 || nodes.get(id)?.length !== 1)
      return false;
    const descendants = collectSubtreeNodeIds(parents[0]);
    if (!descendants.includes(id))
      return false;
    const sisters = (originalParent.children || []).map(child => String(child.id || ''))
      .filter(childId => attachments.get(childId)?.id === originalParent.id);
    const sisterIds = new Set(sisters);
    if (JSON.stringify(descendants.filter(childId => sisterIds.has(childId))) !== JSON.stringify(sisters))
      return false;
  }
  return true;
};

export const inferFutureWorkspaceRootOrder = (
  workspaceRoots: SyntaxNode[],
  frames: ReplayDerivationFrame[],
  currentFrameIndex: number,
  allowInterveningProjections = false
): string[] | null => {
  if (!Array.isArray(workspaceRoots) || workspaceRoots.length <= 1)
    return null;
  const currentRoots = workspaceRoots
    .map((root, index) => ({
      root,
      id: String(root?.id || ''),
      originalIndex: index
    }))
    .filter(({ id }) => Boolean(id));
  const currentRootIds = new Set(currentRoots.map(({ id }) => id));
  if (currentRootIds.size <= 1)
    return null;
  const comparePaths = (left: number[], right: number[]): number => {
    const limit = Math.min(left.length, right.length);
    for (let index = 0; index < limit; index += 1) {
      if (left[index] !== right[index])
        return left[index] - right[index];
    }
    return left.length - right.length;
  };
  let bestPreferredOrder: string[] | null = null;
  let bestMergedRoots = -1;
  let bestDepthScore = -1;
  const firstAttachments = new Map<string, SyntaxNode>();
  let previousParents = new Map<string, SyntaxNode | null>();
  for (let futureFrameIndex = currentFrameIndex + 1; futureFrameIndex < frames.length; futureFrameIndex += 1) {
    const futureRoots = Array.isArray(frames[futureFrameIndex]?.workspaceForest)
      ? frames[futureFrameIndex].workspaceForest
      : [];
    const futureForestNodeIds = new Set(futureRoots.flatMap((root) => collectSubtreeNodeIds(root)));
    if (!currentRoots.every(({ id }) => futureForestNodeIds.has(id))) {
      break;
    }
    const futureParents = collectWorkspaceRootParents(futureRoots, currentRootIds);
    if (allowInterveningProjections) {
      const exactNodes = collectExactNodesByIdInForest(futureRoots);
      if (currentRoots.some(({ id }) => exactNodes.get(id)?.length !== 1)
        || !preservesFirstRootAttachments(futureRoots, firstAttachments))
        break;
      futureParents.forEach((parent, id) => {
        if (parent && !firstAttachments.has(id))
          firstAttachments.set(id, parent);
      });
    }
    else {
      if ([...previousParents].some(([id, parent]) => parent !== null
        && (futureParents.get(id)?.id !== parent.id
          || !preservesRelativeSiblingOrder(parent.children || [], futureParents.get(id)?.children || []))))
        break;
      previousParents = futureParents;
    }
    const rootMembership = currentRoots.map(({ id, originalIndex, root: currentRoot }) => {
      let futureRootIndex = -1;
      let localPath: number[] | null = null;
      futureRoots.some((futureRoot, index) => {
        const pathWithinRoot = findNodePathInForest([futureRoot], id);
        if (!pathWithinRoot)
          return false;
        futureRootIndex = index;
        localPath = pathWithinRoot;
        // A unary workspace can keep its ID while gaining an outside sister.
        // Its current material occupies the retained child's side, rather than
        // the future parent slot that contains both independent components.
        const child = currentRoot.children?.length === 1 ? currentRoot.children[0] : undefined;
        const future = child && collectExactNodesByIdInForest([futureRoot]).get(id);
        const retainedChild = child && future?.length === 1 && future[0].children?.some(node => node.id === child.id);
        const containsOutsideRoot = retainedChild && currentRoots.some(entry => {
          if (entry.id === id)
            return false;
          const path = findNodePathInForest([futureRoot], entry.id);
          return path && path.length > pathWithinRoot.length && pathWithinRoot.every((part, i) => path[i] === part);
        });
        if (child && containsOutsideRoot)
          localPath = findNodePathInForest([futureRoot], child.id);
        return true;
      });
      return { id, originalIndex, futureRootIndex, localPath };
    });
    if (rootMembership.some(({ futureRootIndex, localPath }) => futureRootIndex < 0 || !localPath)) {
      break;
    }
    const groupedByFutureRoot = new Map<number, number>();
    rootMembership.forEach(({ futureRootIndex }) => {
      groupedByFutureRoot.set(futureRootIndex, (groupedByFutureRoot.get(futureRootIndex) || 0) + 1);
    });
    const mergedRoots = currentRoots.length - groupedByFutureRoot.size;
    if (mergedRoots <= 0)
      continue;
    const preferredOrder = [...rootMembership]
      .sort((left, right) => {
        if (left.futureRootIndex !== right.futureRootIndex) {
          return left.futureRootIndex - right.futureRootIndex;
        }
        const pathOrder = comparePaths(left.localPath || [], right.localPath || []);
        if (pathOrder !== 0)
          return pathOrder;
        return left.originalIndex - right.originalIndex;
      })
      .map(({ id }) => id);
    const depthScore = rootMembership.reduce((total, entry) => total + (entry.localPath?.length || 0), 0);
    if (preferredOrder.length !== currentRoots.length)
      break;
    if (mergedRoots > bestMergedRoots
      || (mergedRoots === bestMergedRoots && depthScore > bestDepthScore)) {
      bestPreferredOrder = preferredOrder;
      bestMergedRoots = mergedRoots;
      bestDepthScore = depthScore;
    }
  }
  return bestPreferredOrder;
};

export const collectNextFramePendingRootSubtreeIds = (workspaceRoots: SyntaxNode[], nextFrame?: ReplayDerivationFrame | null): Set<string> => {
  const currentRootIds = new Set((Array.isArray(workspaceRoots) ? workspaceRoots : [])
    .map((node) => String(node?.id || ''))
    .filter(Boolean));
  const nextRoots = Array.isArray(nextFrame?.workspaceForest) ? nextFrame.workspaceForest : [];
  return new Set(nextRoots
    .filter((node) => {
      const nodeId = String(node?.id || '');
      return Boolean(nodeId) && !currentRootIds.has(nodeId);
    })
    .flatMap((node) => collectSubtreeNodeIds(node)));
};
