/**
 * Canonical occurrence identity for movement.
 *
 * When an occurrence moves, the model may let either the occurrence left at
 * the source or the landing keep the node id it had before the stage; the
 * other gets a new id, and both share a lineageId. The choice carries no
 * syntax, yet Replay reads "same id" as "same occurrence". Babel therefore
 * renames every hop to one form: the occurrence at the source keeps the
 * continuing id and the landing takes the new one.
 *
 * The renaming is a lossless permutation of id strings. Only which string
 * names which occurrence changes; labels, words, silence, lineage, relations
 * and realizations stay as authored. A hop at stage k renames stage k and every
 * later stage: forests, relation anchors and realization node ids, and the
 * priorAnchors of stages after k (priorAnchors name the stage before theirs).
 *
 * A hop at stage k is a lineage that gains an occurrence absent from stage
 * k-1 while another of its occurrences continues from stage k-1. Which
 * occurrence is the landing is decided by position, never by id: the
 * continuing occurrence whose parent changed has moved. The two moved subtrees
 * are paired node by node when they have the same shape (a full copy), and
 * otherwise by their roots and the lineages each holds once (a trace).
 *
 * The module is pure and reads the nested workspace forest, so normalization
 * and Replay preparation share it.
 */

const nodeId = node => (typeof node?.id === 'string' && node.id ? node.id : null);
const childrenOf = node => (Array.isArray(node?.children) ? node.children : []);

const indexForest = forest => {
  const index = new Map();
  const visit = (node, parent, depth) => {
    const id = nodeId(node);
    if (id) index.set(id, { node, parent: nodeId(parent), depth });
    childrenOf(node).forEach(child => visit(child, node, depth + 1));
  };
  (Array.isArray(forest) ? forest : []).forEach(root => visit(root, null, 0));
  return index;
};

const subtree = node => {
  const out = [];
  const visit = item => { out.push(item); childrenOf(item).forEach(visit); };
  visit(node);
  return out;
};

const repeatsId = forest => {
  const ids = preorder(forest).map(nodeId).filter(Boolean);
  return new Set(ids).size !== ids.length;
};

const preorder = forest => (Array.isArray(forest) ? forest : []).flatMap(subtree);

const sameShape = (a, b) => childrenOf(a).length === childrenOf(b).length
  && childrenOf(a).every((child, index) => sameShape(child, childrenOf(b)[index]));

/** The lineages a subtree holds exactly once, each with its node. */
const singleLineageNodes = nodes => {
  const byLineage = new Map();
  nodes.forEach(node => {
    if (!node.lineageId) return;
    const lineage = String(node.lineageId);
    byLineage.set(lineage, byLineage.has(lineage) ? null : node);
  });
  return byLineage;
};

const renameAnchors = (anchors, rename) => (anchors && typeof anchors === 'object' && !Array.isArray(anchors)
  ? Object.fromEntries(Object.entries(anchors).map(([role, value]) => [role,
    Array.isArray(value) ? value.map(rename) : rename(value)]))
  : anchors);

/** Applies one hop's swap to stage k and every later stage, in place. */
const renameFrom = (stages, k, map) => {
  const rename = id => (typeof id === 'string' && map.has(id) ? map.get(id) : id);
  for (let s = k; s < stages.length; s += 1) {
    const stage = stages[s];
    preorder(stage.workspaceForest).forEach(node => {
      if (nodeId(node)) node.id = rename(node.id);
      if (Array.isArray(node.aliasIds)) node.aliasIds = node.aliasIds.map(rename);
    });
    if (Array.isArray(stage.relations)) {
      stage.relations = stage.relations.map(relation => (relation && typeof relation === 'object' ? {
        ...relation,
        ...(Object.hasOwn(relation, 'anchors') ? { anchors: renameAnchors(relation.anchors, rename) } : {}),
        ...(s > k && Object.hasOwn(relation, 'priorAnchors') ? { priorAnchors: renameAnchors(relation.priorAnchors, rename) } : {})
      } : relation));
    }
    if (Array.isArray(stage.realizations)) {
      stage.realizations = stage.realizations.map(group => (group && Array.isArray(group.nodeIds)
        ? { ...group, nodeIds: group.nodeIds.map(rename) } : group));
    }
  }
};

/** The next hop of stage k not yet handled, or null. */
const nextHop = (prev, cur, forest, handled) => {
  const byLineage = new Map();
  for (const node of preorder(forest)) {
    const id = nodeId(node);
    if (!id || !node.lineageId) continue;
    const lineage = String(node.lineageId);
    if (!byLineage.has(lineage)) byLineage.set(lineage, []);
    byLineage.get(lineage).push(id);
  }
  for (const [lineage, ids] of byLineage) {
    if (handled.has(`lineage:${lineage}`)) continue;
    const fresh = ids.filter(id => !prev.has(id)), continuing = ids.filter(id => prev.has(id));
    if (!fresh.length || !continuing.length) continue;
    if (fresh.every(id => handled.has(id))) { handled.add(`lineage:${lineage}`); continue; }
    return { lineage, fresh, continuing };
  }
  return null;
};

/**
 * Source and landing of a hop, by position, or `{ undecided }` with the reason.
 * A continuing occurrence that changed parent is the landing when a new
 * occurrence stands under its old parent; with none there (a free root merged,
 * or its old parent rebuilt), nothing shows which occurrence is the source, so
 * the hop keeps its authored ids.
 */
const hopEnds = (hop, prev, cur, born, chainHead) => {
  const moved = hop.continuing.filter(id => cur.get(id).parent !== prev.get(id).parent);
  if (moved.length > 1) return { undecided: 'several-moved' };
  if (moved.length === 1) {
    const [landing] = moved;
    const oldParent = prev.get(landing).parent;
    const atOldParent = oldParent ? hop.fresh.filter(id => cur.get(id).parent === oldParent) : [];
    return atOldParent.length === 1 ? { source: atOldParent[0], landing } : { undecided: 'no-source-slot' };
  }
  // Nothing continuing moved: the mover is the chain's latest landing, or else
  // the highest continuing occurrence, most recently introduced first.
  const head = chainHead.get(hop.lineage);
  const source = hop.continuing.includes(head) ? head
    : [...hop.continuing].sort((a, b) => cur.get(a).depth - cur.get(b).depth || (born.get(b) ?? 0) - (born.get(a) ?? 0))[0];
  const landing = [...hop.fresh].sort((a, b) => cur.get(a).depth - cur.get(b).depth)[0];
  return { source, landing };
};

/** Source/landing node pairs of one hop: a full copy pairs node by node, a trace by root and single lineages. */
const pairOccurrences = (sourceNode, landingNode) => {
  const sourceNodes = subtree(sourceNode), landingNodes = subtree(landingNode);
  if (sameShape(sourceNode, landingNode)) return sourceNodes.map((node, index) => [node, landingNodes[index]]);
  const pairs = [[sourceNode, landingNode]];
  const landingByLineage = singleLineageNodes(landingNodes.slice(1));
  for (const [lineage, node] of singleLineageNodes(sourceNodes.slice(1))) {
    if (node && landingByLineage.get(lineage)) pairs.push([node, landingByLineage.get(lineage)]);
  }
  return pairs;
};

/**
 * Renames every movement hop so the occurrence at the source keeps the
 * continuing id. Returns `{ stages, swappedHops, renames }`: `stages` is the
 * input array itself when no hop needed renaming, and otherwise a renamed copy
 * (the input is never changed). `renames` lists each applied swap as
 * `{ stageIndex, map }`, in order, so derived structures of a stage can follow;
 * `undecided` lists the hops left as authored, with the reason.
 * `keep: 'landing'` gives every hop the other convention instead; tests use it
 * to show that Replay does not depend on the choice.
 */
export const canonicalizeMovementIdentity = (inputStages, { keep = 'source' } = {}) => {
  if (!Array.isArray(inputStages) || inputStages.length < 2) return { stages: inputStages, swappedHops: 0, renames: [], undecided: [] };
  // A stage that repeats an id (only unvalidated output can) names no
  // occurrence exactly, so the analysis keeps its authored ids.
  if (inputStages.some(stage => repeatsId(stage?.workspaceForest))) return { stages: inputStages, swappedHops: 0, renames: [], undecided: [] };
  let stages = inputStages;
  const renames = [], undecided = [];
  const born = new Map();
  const chainHead = new Map();
  preorder(stages[0]?.workspaceForest).forEach(node => { if (nodeId(node)) born.set(node.id, 0); });
  for (let k = 1; k < stages.length; k += 1) {
    const handled = new Set();
    for (;;) {
      const prev = indexForest(stages[k - 1]?.workspaceForest), cur = indexForest(stages[k]?.workspaceForest);
      const hop = nextHop(prev, cur, stages[k]?.workspaceForest, handled);
      if (!hop) break;
      const ends = hopEnds(hop, prev, cur, born, chainHead);
      if (ends.undecided) {
        handled.add(`lineage:${hop.lineage}`);
        undecided.push({ stageIndex: k, lineage: hop.lineage, reason: ends.undecided });
        continue;
      }
      const pairs = pairOccurrences(cur.get(ends.source).node, cur.get(ends.landing).node);
      const map = new Map();
      for (const [atSource, atLanding] of pairs) {
        const sourceId = nodeId(atSource), landingId = nodeId(atLanding);
        // The continuing id moves to the side `keep` names.
        const [take, give] = keep === 'landing' ? [landingId, sourceId] : [sourceId, landingId];
        if (!sourceId || !landingId || prev.has(take) || !prev.has(give)) continue;
        map.set(sourceId, landingId).set(landingId, sourceId);
      }
      if (map.size && stages === inputStages) {
        // Copy on the first rename and read the hop again from the copy. Each
        // stage is copied alone: a caller may share one node object between
        // stages, and renaming it in one stage must not rename the other.
        stages = inputStages.map(stage => structuredClone(stage));
        continue;
      }
      handled.add(`lineage:${hop.lineage}`);
      // Every new occurrence of the lineage belongs to this hop, including an
      // intermediate one when the stage moves it twice, and so does all it contains.
      [ends.source, ends.landing, ...hop.fresh].map(id => cur.get(id).node).flatMap(subtree)
        .forEach(node => { if (nodeId(node)) handled.add(node.id); });
      for (const [, atLanding] of pairs) if (atLanding.lineageId && nodeId(atLanding)) chainHead.set(String(atLanding.lineageId), atLanding.id);
      if (!map.size) continue;
      renameFrom(stages, k, map);
      renames.push({ stageIndex: k, map });
      for (const [lineage, id] of chainHead) if (map.has(id)) chainHead.set(lineage, map.get(id));
      for (const [a, b] of map) if (handled.has(a)) handled.add(b);
    }
    preorder(stages[k]?.workspaceForest).forEach(node => { if (nodeId(node) && !born.has(node.id)) born.set(node.id, k); });
  }
  return { stages, swappedHops: renames.length, renames, undecided };
};

/**
 * The renamed ids of stage `stageIndex`, as `{ authoredId: canonicalId }`, for
 * structures derived from that stage (an analysis's final tree).
 */
export const stageIdRenames = (renames, stageIndex) => {
  const applicable = renames.filter(rename => rename.stageIndex <= stageIndex);
  const out = {};
  for (const id of new Set(applicable.flatMap(rename => [...rename.map.keys()]))) {
    const canonical = applicable.reduce((current, rename) => rename.map.get(current) ?? current, id);
    if (canonical !== id) out[id] = canonical;
  }
  return out;
};

/** A copy of a tree with `renames` applied to its node ids, or the tree itself when none apply. */
export const renameTreeIds = (node, renames) => {
  if (!node || !renames || !Object.keys(renames).length) return node;
  const rename = id => (typeof id === 'string' && Object.hasOwn(renames, id) ? renames[id] : id);
  const visit = item => ({
    ...item,
    ...(Object.hasOwn(item, 'id') ? { id: rename(item.id) } : {}),
    ...(Array.isArray(item.aliasIds) ? { aliasIds: item.aliasIds.map(rename) } : {}),
    ...(Array.isArray(item.children) ? { children: item.children.map(visit) } : {})
  });
  return visit(node);
};
