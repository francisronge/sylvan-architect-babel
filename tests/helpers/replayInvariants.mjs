/** Pure checks of the general Replay rules in AGENTS.md "Replay and renderer
 * safety". Each checker takes a prepared Replay (`prepareReplay` with
 * `includePlayback: true`) and returns `{ rule, frame, detail }` violations,
 * where `frame` is the 1-based Replay step or null for a whole-record fact.
 * Checkers never assert; callers decide which violations are expected. */
import * as d3 from 'd3';
import { createBindingDrawing, indexLetterLabels } from '../../components/renderer/bindingDrawing.ts';
import { labelBelongsToNode, shellLabelElement, terminalLabelElement } from '../../components/renderer/treeMeasurements.ts';
import { planIndexLetters, primitiveIndexLetters } from '../../components/renderer/indexLetters.ts';
import { applyVizIds, getNodeId } from '../../replay/displayIdentity.ts';
import { createFrameRelationResolver } from '../../replay/frameRelations.ts';
import { isRegisteredTrajectoryRelation } from '../../replay/relations/movementIdentities.ts';
import { bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import { planItemDependencyNodeIds, planItemOwnsRelationMoment, planItemRelationRefs } from '../../replay/relations/renderPlan.ts';
import { visiblePlanFrameItems } from '../../replay/relations/relationFrame.ts';
import { indexHierarchyNodesByIdAndAliases } from '../../replay/replayCanvas.ts';
import { extractDisplayedSubscriptIndex } from '../../replay/replaySurfaceNotation.ts';
import { identityLabelTarget, treeLabelRunsForStep } from '../../replay/treeLabelRuns.ts';
import { relationOwnsNonMovementTreeTransition, resolveFallbackTreeTransitionOwnership } from '../../replay/treeTransitions.ts';
import { resolveSavedInputTokens } from '../../server/babelParser/surfaceTokens.js';
import { createSvgDom, descendants, select } from './svgDom.mjs';

const violation = (rule, frame, detail) => ({ rule, frame, detail });
const isScaffold = data => data.replayLayoutOnly === true || data.replayOrigin?.kind === 'layout';
const isWorkspace = data => data.replayOrigin?.kind === 'workspace';
const trimmed = value => typeof value === 'string' ? value.trim() : '';

const frames = new WeakMap();
/** One step's canvas indexed by renderer id. `displayed` is what the frame
 * paints: visible, neither the synthetic workspace root nor layout scaffolding.
 * `parent` is a displayed node's canvas parent when that parent is displayed,
 * and null otherwise: the renderer draws an edge only between two visible
 * nodes, so syntax under a hidden new parent is drawn as a separate root. */
export function frameStructure(step) {
  if (frames.has(step)) return frames.get(step);
  const nodes = new Map(), displayed = new Set(), parent = new Map(), children = new Map();
  const visible = new Set((step.replayVisibleNodeIds ?? []).map(String));
  if (step.replayCanvasData) {
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    root.each(node => nodes.set(getNodeId(node), node));
    for (const [id, node] of nodes) if (visible.has(id) && !isWorkspace(node.data) && !isScaffold(node.data)) displayed.add(id);
    for (const id of displayed) {
      const canvasParent = nodes.get(id).parent, parentId = canvasParent && displayed.has(getNodeId(canvasParent)) ? getNodeId(canvasParent) : null;
      parent.set(id, parentId);
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(id);
    }
  }
  const structure = { nodes, visible, displayed, parent, children,
    key: JSON.stringify([...displayed].sort().map(id => [id, parent.get(id), children.get(id) ?? []])) };
  frames.set(step, structure);
  return structure;
}

const EMPTY_FRAME = { nodes: new Map(), visible: new Set(), displayed: new Set(), parent: new Map(), children: new Map() };

/** The authored node a displayed canvas node stands for. Derived word leaves
 * (`id::__leaf`) are reported with `derivedWordOf`; stabilized lexical leaves
 * (`parent::__lex_…`) stand for their authored leaf; a continued occurrence
 * shown under the id that continues it stands for its one authored alias
 * (`displayContinuedOccurrences`). */
export function authoredIdentity(node) {
  const origin = node.data.replayOrigin;
  if (origin?.kind === 'word') return { derivedWordOf: origin.ownerId };
  if (origin?.kind === 'lexical') return { id: origin.authoredId };
  if (!origin && node.data.aliasIds?.length === 1) return { id: node.data.aliasIds[0] };
  return { id: node.data.id ?? getNodeId(node) };
}

const pronunciationTables = new WeakMap();
/** The relation that establishes each authored occurrence's pronunciation in
 * its stage, as claim dispatch proves it (`pronunciationNodeIds`): the first
 * relation naming the occurrence or an ancestor. Its word may come, go or
 * change only at that relation's moment; without one, the relations naming the
 * occurrence own it. Returns `(stageIndex, authoredId) => relationIndex`, or
 * undefined. Relations are dispatched on the first lookup. */
export function pronunciationOwners(replay) {
  if (!pronunciationTables.has(replay)) pronunciationTables.set(replay, { tables: new Map() });
  const cache = pronunciationTables.get(replay), tables = cache.tables, frames = replay.replayDerivationFrames ?? [];
  return (stageIndex, id) => {
    if (!tables.has(stageIndex)) {
      cache.resolve ??= createFrameRelationResolver(frames, replay.derivationReplayPlan);
      const relations = (frames[stageIndex] ? cache.resolve(stageIndex) : []).map((relation, index) => ({
        index: Number.isInteger(relation.authoredRelationIndex) ? relation.authoredRelationIndex : index,
        pronounced: new Set(relation.pronunciationNodeIds ?? [])
      })).filter(relation => relation.pronounced.size);
      const table = new Map();
      const visit = (node, lineage) => {
        const ids = node?.id ? [String(node.id), ...lineage] : lineage;
        const owners = relations.filter(relation => ids.some(at => relation.pronounced.has(at))).map(relation => relation.index);
        if (node?.id && owners.length) table.set(String(node.id), Math.min(...owners));
        (node?.children ?? []).forEach(child => visit(child, ids));
      };
      if (relations.length) (frames[stageIndex].workspaceForest ?? []).forEach(root => visit(root, []));
      tables.set(stageIndex, table);
    }
    return tables.get(stageIndex).get(String(id));
  };
}

/** Whether the relation at `identity` may show, remove or change the word of
 * the occurrence a display node stands for: the occurrence's pronunciation
 * owner, or with none a relation whose moment owns or names it (`named`). */
export const voicesOccurrence = (pronunciation, identity, authoredId, named) => {
  const owner = pronunciation(identity.stageIndex, authoredId);
  return owner === undefined ? named : owner === identity.relationIndex;
};

const stepsOfStage = (steps, stageIndex) => steps.flatMap((step, index) => step.replayFrameIndex === stageIndex ? [index] : []);

export function checkInputUnchanged(authoredBefore, record) {
  const after = JSON.stringify(record);
  return after === authoredBefore ? [] : [violation('input-unchanged', null,
    'preparing Replay changed the authored record')];
}

export function checkNoVisibleScaffolding(replay) {
  return replay.playbackSteps.flatMap((step, index) => {
    const { nodes, visible } = frameStructure(step);
    return [...visible].filter(id => nodes.has(id) && isScaffold(nodes.get(id).data))
      .map(id => violation('no-visible-scaffolding', index + 1, `layout scaffolding ${id} is visible`));
  });
}

const sameWord = (shown, authored, initialKey) => shown === authored
  || shown.toLocaleLowerCase() === authored.toLocaleLowerCase() && authored.toLocaleLowerCase() === initialKey;

const relationMentions = relation => [relation?.anchors, relation?.priorAnchors]
  .flatMap(anchors => anchors && typeof anchors === 'object' ? Object.values(anchors).flat() : []).map(String);

/** A waiting unary root projection may stay hidden from its authored stage
 * until a later relation moment attaches its second child. The behavior
 * contract permits this display timing only when no earlier relation refers
 * to the projection; the stage itself is not rewritten. */
function isWaitingRootProjection(replay, record, stageIndex, completion, id, want) {
  if (want.parent !== null || want.children.length !== 1) return false;
  const steps = replay.playbackSteps;
  const reveal = steps.findIndex((step, index) => index > completion && frameStructure(step).displayed.has(id));
  if (reveal < 0) return false;
  const moment = steps[reveal], structure = frameStructure(moment);
  if (moment.replayKind !== 'relation' || !moment.replayRelationIdentity || (structure.children.get(id) ?? []).length < 2) return false;
  const { stageIndex: momentStage, relationIndex } = moment.replayRelationIdentity;
  const earlier = (record.derivationStages ?? []).slice(0, momentStage + 1).flatMap((stage, index) =>
    (stage.relations ?? []).filter((_relation, position) => index < momentStage || position < relationIndex));
  return momentStage > stageIndex && !earlier.some(relation => relationMentions(relation).includes(id));
}

/** The completed state of every authored stage, in authored terms. Root order
 * is not compared: separate workspaces have no authored order. */
export function checkStageCompletion(replay, record) {
  const steps = replay.playbackSteps, out = [];
  const initialKey = String(resolveSavedInputTokens(record.sentence ?? '', record.inputTokens)[0] ?? '').trim().toLocaleLowerCase();
  (record.derivationStages ?? []).forEach((stage, stageIndex) => {
    const own = stepsOfStage(steps, stageIndex);
    if (!own.length) { out.push(violation('stage-completion', null, `stage ${stageIndex + 1} has no Replay steps`)); return; }
    const frame = own.at(-1) + 1, report = detail => out.push(violation('stage-completion', frame, `stage ${stageIndex + 1}: ${detail}`));
    const expected = new Map(), duplicates = new Set();
    const visit = (node, parentId) => {
      if (!node.id || expected.has(node.id)) { duplicates.add(node.id ?? '(missing id)'); return; }
      expected.set(node.id, { parent: parentId, children: (node.children ?? []).map(child => child.id),
        label: trimmed(node.label), word: trimmed(node.word), silent: node.silent === true });
      (node.children ?? []).forEach(child => visit(child, node.id));
    };
    (stage.workspaceForest ?? []).forEach(root => visit(root, null));
    if (duplicates.size) { report(`authored forest has missing or repeated ids ${[...duplicates].join(', ')}; not comparable`); return; }
    const structure = frameStructure(steps[own.at(-1)]), shown = new Map();
    for (const id of structure.displayed) {
      const node = structure.nodes.get(id), identity = authoredIdentity(node);
      if (identity.derivedWordOf !== undefined) {
        const owner = structure.parent.get(id), ownerNode = owner && structure.nodes.get(owner);
        if (!ownerNode || authoredIdentity(ownerNode).id !== identity.derivedWordOf) report(`derived word ${id} is not under its owner ${identity.derivedWordOf}`);
        continue;
      }
      if (shown.has(identity.id)) { report(`${identity.id} is displayed twice`); continue; }
      shown.set(identity.id, id);
    }
    const authoredOf = id => id === null ? null : authoredIdentity(structure.nodes.get(id)).id;
    const waiting = new Set([...expected].filter(([id, want]) => !shown.has(id)
      && isWaitingRootProjection(replay, record, stageIndex, own.at(-1), id, want)).map(([id]) => id));
    for (const id of expected.keys()) if (!shown.has(id) && !waiting.has(id)) report(`authored ${id} is not displayed`);
    for (const id of shown.keys()) if (!expected.has(id)) report(`${id} is displayed but not authored in this stage`);
    for (const [id, want] of expected) {
      const rendered = shown.get(id);
      if (!rendered) continue;
      const node = structure.nodes.get(rendered);
      const parentId = authoredOf(structure.parent.get(rendered));
      if (parentId !== want.parent && !(parentId === null && waiting.has(want.parent))) report(`${id} is under ${parentId ?? 'no parent'}, authored under ${want.parent ?? 'no parent'}`);
      const childIds = (structure.children.get(rendered) ?? [])
        .filter(child => authoredIdentity(structure.nodes.get(child)).derivedWordOf === undefined).map(authoredOf);
      if (JSON.stringify(childIds) !== JSON.stringify(want.children)) report(`${id} shows children [${childIds}], authored [${want.children}]`);
      // A preterminal keeps its word field, but paints the word only through its derived leaf.
      const leaf = node.children?.find(child => child.data.replayOrigin?.kind === 'word' && child.data.replayOrigin.ownerId === id);
      const derived = leaf && (structure.displayed.has(getNodeId(leaf)) ? { word: trimmed(leaf.data.word), silent: leaf.data.silent === true } : { word: '' });
      const shownWord = derived ? derived.word : trimmed(node.data.word);
      if (!sameWord(shownWord, want.word, initialKey)) report(`${id} shows word "${shownWord}", authored "${want.word}"`);
      if (!sameWord(trimmed(node.data.label), want.label, initialKey)) report(`${id} shows label "${trimmed(node.data.label)}", authored "${want.label}"`);
      const silent = node.data.silent === true || derived?.silent === true;
      if (silent !== want.silent) report(`${id} is shown ${silent ? 'silent' : 'pronounced'}, authored ${want.silent ? 'silent' : 'pronounced'}`);
    }
  });
  return out;
}

/** A relation is renderable when it names a relation and authors an anchor,
 * or when normalization recorded why its authored claim cannot render. */
export const isRenderableAuthoredRelation = relation => Boolean(trimmed(relation?.relation))
  && (Boolean(relation.relationContractFailure) || Boolean(relation.anchors) && typeof relation.anchors === 'object'
    && Object.values(relation.anchors).flat().some(value => trimmed(value)));

/** The authored ids a frame displays, by renderer id, data id and alias. */
const displayedNames = structure => new Set([...structure.displayed].flatMap(id => nodeNames(structure.nodes.get(id))));

/** What a relation moment waits for: the relation's authored anchors, and the
 * parent and children of each node its moment introduces (the context a new
 * landing or parent attaches to), minus what the moment introduces itself. */
function momentNeeds(steps, index, relation) {
  const structure = frameStructure(steps[index]), before = index ? frameStructure(steps[index - 1]) : EMPTY_FRAME;
  const introduced = [...structure.displayed].filter(id => !before.displayed.has(id));
  const needs = new Set(relationMentions({ anchors: relation?.anchors }));
  introduced.forEach(id => [structure.parent.get(id), ...(structure.children.get(id) ?? [])].filter(Boolean)
    .forEach(other => nodeNames(structure.nodes.get(other)).forEach(name => needs.add(name))));
  introduced.forEach(id => nodeNames(structure.nodes.get(id)).forEach(name => needs.delete(name)));
  return needs;
}

/** Whether `id` is one of a relation's authored anchors, or an ancestor or descendant of one in its stage's forest. */
function coveredByClaim(stage, relation, id) {
  const parent = new Map();
  const visit = (node, parentId) => { parent.set(String(node.id), parentId); (node.children ?? []).forEach(child => visit(child, String(node.id))); };
  (stage.workspaceForest ?? []).forEach(root => visit(root, null));
  const lineage = start => { const ids = []; for (let at = start; at; at = parent.get(at)) ids.push(at); return ids; };
  return relationMentions({ anchors: relation?.anchors }).some(anchor => lineage(anchor).includes(id) || lineage(id).includes(anchor));
}

/**
 * Each renderable relation has exactly one moment, in its own stage. Moments
 * follow authored order, except that a relation may wait for a later relation of
 * its stage that introduces syntax it needs. A relation that plays after a
 * later authored one must have waited: from the last such relation's moment to
 * its own, some moment first displays one of its needs (`momentNeeds`) that
 * belongs to that moment's own authored claim.
 */
export function checkRelationMoments(replay, record) {
  const steps = replay.playbackSteps, out = [], moments = new Map();
  steps.forEach((step, index) => {
    if (step.replayKind !== 'relation' || !step.replayRelationIdentity) return;
    const { stageIndex, relationIndex } = step.replayRelationIdentity, key = `${stageIndex}:${relationIndex}`;
    if (!moments.has(key)) moments.set(key, []);
    moments.get(key).push(index);
    if (step.replayFrameIndex !== stageIndex)
      out.push(violation('relation-moments', index + 1, `relation ${key} plays in stage ${step.replayFrameIndex + 1}, not its own stage ${stageIndex + 1}`));
    if (!isRenderableAuthoredRelation(record.derivationStages?.[stageIndex]?.relations?.[relationIndex]))
      out.push(violation('relation-moments', index + 1, `moment for ${key}, which is not a renderable authored relation`));
  });
  (record.derivationStages ?? []).forEach((stage, stageIndex) => {
    const played = (stage.relations ?? []).flatMap((relation, relationIndex) => {
      const key = `${stageIndex}:${relationIndex}`, own = moments.get(key) ?? [];
      if (!isRenderableAuthoredRelation(relation)) return [];
      if (own.length !== 1) out.push(violation('relation-moments', own[1] === undefined ? null : own[1] + 1,
        `relation ${key} (${relation.relation}) has ${own.length} moments`));
      return own.length ? [{ key, relation, relationIndex, index: own[0] }] : [];
    }).sort((left, right) => left.index - right.index);
    played.forEach((moment, position) => {
      const overtaking = played.slice(0, position).filter(other => other.relationIndex > moment.relationIndex).at(-1);
      if (!overtaking) return;
      const needs = momentNeeds(steps, moment.index, moment.relation), shown = displayedNames(frameStructure(steps[moment.index]));
      const waited = played.slice(played.indexOf(overtaking), position).some(other => {
        const before = other.index ? displayedNames(frameStructure(steps[other.index - 1])) : new Set();
        return [...needs].some(id => shown.has(id) && !before.has(id) && coveredByClaim(stage, other.relation, id));
      });
      if (!waited) out.push(violation('relation-moments', moment.index + 1,
        `relation ${moment.key} plays after later authored relation ${overtaking.key} without waiting for syntax it introduces`));
    });
  });
  return out;
}

/** Every visible id names a node in that step's canvas (by id or alias). A
 * stale id cannot be drawn, and capture rejects the frame. */
export function checkVisibleInCanvas(replay) {
  const out = [];
  replay.playbackSteps.forEach((step, index) => {
    const ids = new Set();
    const walk = node => { if (!node) return; ids.add(String(node.id ?? '')); (node.aliasIds ?? []).forEach(alias => ids.add(String(alias))); (node.children ?? []).forEach(walk); };
    walk(step.replayCanvasData);
    for (const id of step.replayVisibleNodeIds ?? []) {
      if (!ids.has(String(id))) out.push(violation('visible-in-canvas', index + 1, `${id} is visible but absent from the canvas`));
    }
  });
  return out;
}

/** Whether a construction micro-step makes the edge from `parent` to `child`,
 * comparing the displayed structure before and after it. The step builds its
 * target, so it owns that edge when
 *   - the target is the parent: a merge or projection gathers its daughters;
 *   - the target is the child, inserted into an existing edge: one of its
 *     daughters hung from that parent before, and the target now stands there;
 *   - the target is new and replaces the child's former parent, which is gone:
 *     the dissolved parent's material regroups under the target's parent.
 * These are the attachments construction makes in
 * replay/constructionAttachments.ts: a held attachment completes at its
 * parent's merge, a wrapper takes over the edge it is inserted into, and a
 * regrouping parent's material moves at its first new child. */
function stepOwnsEdge(step, previous, current, child, parent) {
  if (step.replayKind !== 'micro') return false;
  const target = String(step.targetNodeId ?? '');
  if (parent === target) return true;
  if (child === target) return (current.children.get(child) ?? []).some(daughter => previous.parent.get(daughter) === parent);
  const before = previous.parent.get(child);
  return current.displayed.has(target) && !previous.displayed.has(target)
    && before != null && !current.displayed.has(before) && parent === current.parent.get(target);
}

/** A construction micro-step changes existing syntax only through its own
 * target. A node displayed at the preceding step stays displayed under the same
 * parent unless the step owns its new edge (`stepOwnsEdge`), or the new target
 * takes its place. Nothing is detached. */
export function checkStableConstruction(replay) {
  const steps = replay.playbackSteps, out = [];
  steps.forEach((step, index) => {
    if (index === 0 || step.replayKind !== 'micro') return;
    const previous = frameStructure(steps[index - 1]), current = frameStructure(step);
    const target = String(step.targetNodeId ?? '');
    const holds = id => { for (let at = id; at; at = current.parent.get(at)) if (at === target) return true; return false; };
    const newTarget = current.displayed.has(target) && !previous.displayed.has(target);
    for (const id of previous.displayed) {
      const before = previous.parent.get(id);
      const where = `at micro ${step.operation} (target ${target})`;
      if (!current.displayed.has(id)) {
        const replaced = newTarget && ((previous.children.get(id) ?? []).some(child => current.displayed.has(child) && holds(child))
          || current.parent.get(target) === before);
        if (!replaced) out.push(violation('stable-construction', index + 1, `${id} disappears ${where}`));
        continue;
      }
      const after = current.parent.get(id);
      if (after === before) continue;
      if (after == null) out.push(violation('stable-construction', index + 1, `${id} is detached from ${before} ${where}`));
      else if (!stepOwnsEdge(step, previous, current, id, after)) {
        out.push(violation('stable-construction', index + 1, `${id} moves from ${before} to ${after} ${where}`));
      }
    }
  });
  return out;
}

/** Each node a stage dissolves, paired with the new node of that stage that
 * structurally continues it: the same category, word, silence and lineage, the
 * same slot (the same position under the continuing parent, or a root that
 * stays a root or gains a new parent), and every daughter or its continuation
 * in order, with at most one new node inserted directly above one daughter.
 * Only unique pairings count, and none over material a relation of the stage
 * moves, copies or rewrites. This restates the rule independently of
 * replay/continuedOccurrences.ts. */
function continuedPairs(previousForest, currentForest, relations) {
  const index = forest => {
    const nodes = new Map();
    const visit = (node, parent, slot) => {
      if (node.id) nodes.set(node.id, nodes.has(node.id) ? null : { node, parent, slot });
      (node.children ?? []).forEach((child, position) => visit(child, node, position));
    };
    forest.forEach(root => visit(root, null, 0));
    return nodes;
  };
  const before = index(previousForest), after = index(currentForest);
  const subtree = node => [node.id, ...(node.children ?? []).flatMap(subtree)];
  const owned = new Set(relations.flatMap(relation => {
    const ownership = resolveFallbackTreeTransitionOwnership(relation, previousForest, currentForest);
    const anchors = [...Object.values(relation.anchors ?? {}), ...Object.values(relation.priorAnchors ?? {})].flat().map(String);
    return [
      ...(relation.recoveredMovement || relation.recoveredMovements?.length || relation.unprovenNewLandingNodeId
        || relation.anchoredCopyDisplacement || isRegisteredTrajectoryRelation(relation.relation, relation.anchors)
        || relationOwnsNonMovementTreeTransition(relation, previousForest, currentForest) ? anchors : []),
      ...(relation.recoveredMovements ?? [relation.recoveredMovement]).flatMap(movement => movement
        ? [movement.priorSourceNodeId, movement.sourceNodeId, movement.targetNodeId, movement.witnessNodeId] : []),
      ...(ownership ? [...ownership.currentNodeIds, ...ownership.priorNodeIds, ...(ownership.hostNodeIds ?? [])] : [])
    ];
  }));
  const content = node => JSON.stringify([trimmed(node.label), trimmed(node.word), node.silent === true, node.lineageId ?? '']);
  const free = node => node.children?.length && !subtree(node).some(id => owned.has(id));
  let pairs = [...before].filter(([id, at]) => at && !after.has(id) && free(at.node)).flatMap(([id, at]) => [...after]
    .filter(([other, next]) => next && !before.has(other) && free(next.node) && content(next.node) === content(at.node)
      && next.node.children.length === at.node.children.length).map(([other]) => [id, other]));
  for (;;) {
    const partner = (from, to) => pairs.some(([x, y]) => x === from && y === to);
    const continuing = new Set(pairs.map(([, y]) => y));
    const keeps = (oldId, node) => Boolean(node?.id) && (node.id === oldId ? Boolean(before.get(oldId) && after.get(oldId)) : partner(oldId, node.id));
    const fresh = node => Boolean(node?.id && after.get(node.id) && !before.has(node.id) && !continuing.has(node.id));
    const holds = ([x, y]) => {
      const old = before.get(x), next = after.get(y);
      const wrapped = old.node.children.filter((daughter, position) => !keeps(daughter.id, next.node.children[position]));
      if (wrapped.length > 1 || !wrapped.every(daughter => {
        const child = next.node.children[old.node.children.indexOf(daughter)];
        return fresh(child) && child.children?.some(grandchild => keeps(daughter.id, grandchild));
      })) return false;
      if (!old.parent) return !next.parent || fresh(next.parent);
      return keeps(old.parent.id, next.parent) && old.slot === next.slot && old.parent.children.length === next.parent.children.length;
    };
    const kept = pairs.filter(holds);
    const unique = kept.length < pairs.length ? kept
      : pairs.filter(([x, y]) => pairs.filter(([a]) => a === x).length === 1 && pairs.filter(([, b]) => b === y).length === 1);
    if (unique.length === pairs.length) return pairs;
    pairs = unique;
  }
}

/** A stage that continues a preceding occurrence under a new id paints it as
 * that occurrence: its stage's construction never builds it again, every frame
 * of the stage shows it holding each preceding daughter (directly, or through
 * the one new node inserted above it), and the preceding stage's completed
 * frame and the stage's first frame paint it under one id, so it neither tears
 * down nor jumps when the stage begins. Each daughter it keeps is likewise
 * painted under one id across that boundary and never built again. */
export function checkContinuedOccurrences(replay, record) {
  const steps = replay.playbackSteps, stages = record.derivationStages ?? [], out = [];
  const frames = replay.replayDerivationFrames ?? [];
  const resolve = createFrameRelationResolver(frames, replay.derivationReplayPlan);
  const standsFor = (structure, authored) => [...structure.displayed].filter(id => authoredIdentity(structure.nodes.get(id)).id === authored);
  stages.forEach((stage, stageIndex) => {
    if (!stageIndex || !frames[stageIndex]) return;
    const own = stepsOfStage(steps, stageIndex), last = stepsOfStage(steps, stageIndex - 1).at(-1);
    if (!own.length || last === undefined) return;
    const previousForest = stages[stageIndex - 1].workspaceForest ?? [], currentForest = stage.workspaceForest ?? [];
    const pairs = continuedPairs(previousForest, currentForest, resolve(stageIndex));
    if (!pairs.length) return;
    const daughters = new Map();
    const visit = node => { daughters.set(node.id, (node.children ?? []).map(child => child.id)); (node.children ?? []).forEach(visit); };
    previousForest.forEach(visit);
    const isNew = (structure, id) => !daughters.has(authoredIdentity(structure.nodes.get(id)).id);
    const continuation = new Map(pairs);
    for (const [from, to] of pairs) {
      const before = standsFor(frameStructure(steps[last]), from), first = standsFor(frameStructure(steps[own[0]]), to);
      if (before.length !== 1 || first.length !== 1 || before[0] !== first[0])
        out.push(violation('continued-occurrence', own[0] + 1, `${to} continues ${from} but is painted as [${first}] after [${before}]`));
      const kept = (daughters.get(from) ?? []).filter(daughter => !continuation.has(daughter));
      for (const daughter of kept) {
        const was = standsFor(frameStructure(steps[last]), daughter), is = standsFor(frameStructure(steps[own[0]]), daughter);
        if (was.length === 1 && (is.length !== 1 || is[0] !== was[0]))
          out.push(violation('continued-occurrence', own[0] + 1, `${daughter} stays in ${to}, which continues ${from}, but is painted as [${is}] after [${was}]`));
      }
      for (const index of own) {
        const step = steps[index], structure = frameStructure(step), [shown] = standsFor(structure, to);
        const built = step.replayKind === 'micro' && authoredIdentity(structure.nodes.get(step.targetNodeId) ?? { data: { id: step.targetNodeId } }).id;
        if (built === to)
          out.push(violation('continued-occurrence', index + 1, `${to} continues ${from} but is built again`));
        if (built && kept.includes(built))
          out.push(violation('continued-occurrence', index + 1, `${built} stays in ${to}, which continues ${from}, but is built again`));
        if (!shown) { out.push(violation('continued-occurrence', index + 1, `${to} continues ${from} but is not painted`)); continue; }
        for (const daughter of daughters.get(from) ?? []) {
          for (const id of standsFor(structure, continuation.get(daughter) ?? daughter)) {
            const parent = structure.parent.get(id);
            if (parent !== shown && !(parent && structure.parent.get(parent) === shown && isNew(structure, parent)))
              out.push(violation('continued-occurrence', index + 1, `${id} leaves ${to}, which continues ${from}`));
          }
        }
      }
    }
  });
  return out;
}

/** A displayed node never has a hidden, non-scaffold child, except a retained
 * occurrence that is still waiting for a new child's own construction step:
 * it was displayed at the preceding step and that child was not. */
export function checkParentAfterChildren(replay) {
  let previous = EMPTY_FRAME;
  return replay.playbackSteps.flatMap((step, index) => {
    const { nodes, displayed } = frameStructure(step), before = previous;
    previous = frameStructure(step);
    return [...displayed].flatMap(id => (nodes.get(id).children ?? [])
      .filter(child => !isScaffold(child.data) && !displayed.has(getNodeId(child))
        && !(before.displayed.has(id) && !before.displayed.has(getNodeId(child))))
      .map(child => violation('parent-after-children', index + 1, `${getNodeId(child)} is hidden under displayed ${id}`)));
  });
}

const nodeNames = node => [getNodeId(node), node.data.id, ...(node.data.aliasIds ?? [])].filter(Boolean);

const named = (node, ids) => nodeNames(node).some(name => ids.has(name));

/** A movement moment shows each landing its own transition introduces under
 * that landing's parent: the parent the landing joins is already shown or
 * appears with it, never later. */
export function checkLandingAttached(replay) {
  const out = [];
  replay.playbackSteps.forEach((step, index) => {
    if (step.replayKind !== 'relation' || !step.replayRelationIdentity) return;
    const key = `${step.replayRelationIdentity.stageIndex}:${step.replayRelationIdentity.relationIndex}`;
    const landings = new Set((step.replayRelationLinks ?? []).filter(link => link.authoredRelationKey === key && link.movementTransition === true)
      .map(link => link.targetNodeId).filter(Boolean));
    if (!landings.size) return;
    const structure = frameStructure(step);
    for (const [id, node] of structure.nodes) {
      const parent = node.parent;
      if (!structure.displayed.has(id) || !named(node, landings) || !parent || isWorkspace(parent.data)) continue;
      if (!structure.displayed.has(getNodeId(parent)))
        out.push(violation('landing-attached', index + 1, `${id} lands without its parent ${getNodeId(parent)}`));
    }
  });
  return out;
}

/** What one relation moment introduces by itself. A proved movement transition
 * (a new landing or proven relocation) owns its complete landing and lower
 * occurrence: the subtrees at its own link endpoints, whatever mark draws it.
 * A neutral relation owns only the exact rewrite the compiler proved for it.
 * Other anchors are context that must already be on screen. */
export function momentOwnership(step) {
  const { stageIndex, relationIndex } = step.replayRelationIdentity, key = `${stageIndex}:${relationIndex}`;
  const own = (step.replayRelationLinks ?? []).filter(link => link.authoredRelationKey === key);
  const movements = own.filter(link => link.movementTransition === true);
  return {
    endpoints: new Set(movements.flatMap(link => [link.sourceNodeId, link.targetNodeId, link.witnessNodeId, link.priorSourceNodeId]).filter(Boolean)),
    sources: new Set(movements.flatMap(link => [link.sourceNodeId, link.witnessNodeId, link.priorSourceNodeId]).filter(Boolean)),
    inputs: new Set(movements.length ? [] : step.replayTreeTransition?.priorNodeIds ?? []),
    rewritten: new Set(step.replayTreeTransition?.currentNodeIds ?? []),
    anchored: new Set(own.flatMap(link => (link.anchors ?? []).map(anchor => anchor.nodeId)).filter(Boolean))
  };
}

/** Whether a node first painted at a relation moment belongs to it. Besides
 * what the moment owns, it introduces the shortest new ancestor chain that
 * joins owned syntax to existing syntax (for a movement, the workspace that
 * held its source; for a rewrite, the shown workspace that held its prior
 * input), the new sisters created where a landing attaches (a new
 * parent over an existing subtree, or a receiving head's new inner head), and
 * the word a relation realizes on an occurrence already shown: its own
 * pronunciation owner's, or with none one the relation anchors (`voices`). */
function revealedByRelation(node, ownership, previous, voices) {
  const { endpoints, sources, inputs, rewritten, anchored } = ownership;
  const isOwned = candidate => named(candidate, endpoints) || named(candidate, rewritten);
  const shownBefore = candidate => previous.displayed.has(getNodeId(candidate));
  if (node.ancestors().some(ancestor => named(ancestor, endpoints))) return true;
  const origin = node.data.replayOrigin;
  if (named(node, rewritten) || origin?.kind === 'word' && rewritten.has(origin.ownerId)) return true;
  if (origin?.kind === 'word' && node.parent && shownBefore(node.parent) && voices(node.parent, anchored.has(origin.ownerId))) return true;
  const rootBefore = id => { while (previous.parent.get(id)) id = previous.parent.get(id); return id; };
  const rootsOf = ids => new Set([...previous.displayed].filter(id => !ids || named(previous.nodes.get(id), ids)).map(rootBefore));
  const sourceRoots = sources.size ? rootsOf(sources) : inputs.size && rootsOf(inputs).size ? rootsOf(inputs) : rootsOf();
  const existing = candidate => candidate.descendants().some(descendant => shownBefore(descendant)
    && sourceRoots.has(rootBefore(getNodeId(descendant))));
  for (const descendant of node.descendants()) {
    if (descendant === node || !isOwned(descendant)) continue;
    for (let current = descendant; current.parent && !shownBefore(current.parent); current = current.parent) {
      if (current.parent === node) return true;
      if (current.parent.children.some(sister => sister !== current && existing(sister))) break;
    }
  }
  return Boolean(node.parent?.children?.some(sister => sister !== node && named(sister, endpoints))
    && (node.children ?? []).filter(child => !isScaffold(child.data)).every(shownBefore));
}

/** A node first painted at step k must be earned by step k. Structural
 * micro-steps reveal only their own target (and its derived word leaf); a
 * relation moment reveals what it introduces, including the derived word of an
 * occurrence whose pronunciation it owns, or with no separate owner one its
 * authored record anchors; a stage's completed state adds nothing. */
export function checkNoEarlyReveal(replay) {
  const steps = replay.playbackSteps, out = [], pronunciation = pronunciationOwners(replay);
  let previous = EMPTY_FRAME;
  steps.forEach((step, index) => {
    const structure = frameStructure(step), target = String(step.targetNodeId ?? '');
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
    const authored = identity && replay.replayDerivationFrames?.[identity.stageIndex]?.relations?.[identity.relationIndex];
    const ownership = identity ? momentOwnership(step) : null;
    Object.values(authored?.anchors ?? {}).flat().forEach(id => ownership?.anchored.add(String(id)));
    const voices = (owner, named) => voicesOccurrence(pronunciation, identity, authoredIdentity(owner).id, named);
    for (const id of structure.displayed) {
      if (previous.displayed.has(id)) continue;
      const node = structure.nodes.get(id), origin = node.data.replayOrigin;
      if (step.replayKind === 'micro' && (id === target || origin?.kind === 'word' && origin.ownerId === target)) continue;
      if (ownership && revealedByRelation(node, ownership, previous, voices)) continue;
      out.push(violation('no-early-reveal', index + 1, `${id} appears at ${step.replayKind} ${step.operation} (target ${target})`));
    }
    previous = structure;
  });
  return out;
}

/** Each authored node of a forest by id, with its parent id and root; a repeated id maps to null. */
function locateAuthored(forest) {
  const out = new Map();
  const visit = (node, parentId, root) => {
    if (!node?.id) return;
    out.set(String(node.id), out.has(String(node.id)) ? null : { node, parentId, root });
    (node.children ?? []).forEach(child => visit(child, String(node.id), root));
  };
  (forest ?? []).forEach((root, index) => visit(root, null, index));
  return out;
}
const canonical = (value, skip = new Set()) => JSON.stringify(value, (key, field) => skip.has(key) ? undefined
  : field && typeof field === 'object' && !Array.isArray(field) ? Object.fromEntries(Object.keys(field).sort().map(name => [name, field[name]])) : field);
const OCCURRENCE_FIELDS = new Set(['id', 'silent', 'tokenIndex']);
/** The same syntax and words, whichever occurrence is pronounced or addressed. */
const sameMaterial = (left, right) => canonical(left, OCCURRENCE_FIELDS) === canonical(right, OCCURRENCE_FIELDS);

/** New syntax in a stage is built by that stage's construction steps unless
 * displacement introduces it. A relation moment may show syntax new in its
 * stage only as a proved movement, whose extent no-early-reveal bounds, or
 * when its claim names an earlier occurrence the stage displaces: removes,
 * changes (its subtree differs) or gives another parent, or re-merges as an
 * unchanged copy of its lineage beside an object that holds it, or names a
 * new occurrence whose lineage's earlier occurrence is displaced. A preceding
 * root that gains a parent is merged, not displaced. A claim that relates only
 * material merged as it was, such as an identity across conjuncts, even once
 * they are joined beneath one root, or a realization of a newly built phrase,
 * would take over that construction. Derived words are pronunciation, not
 * construction. */
export function checkRelationConstruction(replay, record) {
  const steps = replay.playbackSteps, stages = record.derivationStages ?? [], out = [];
  steps.forEach((step, index) => {
    if (index === 0 || step.replayKind !== 'relation' || !step.replayRelationIdentity || momentOwnership(step).endpoints.size) return;
    const { stageIndex, relationIndex } = step.replayRelationIdentity;
    const before = locateAuthored(stages[stageIndex - 1]?.workspaceForest), after = locateAuthored(stages[stageIndex]?.workspaceForest);
    const previous = frameStructure(steps[index - 1]), current = frameStructure(step);
    const fresh = [...current.displayed].filter(id => !previous.displayed.has(id)).filter(id => {
      const identity = authoredIdentity(current.nodes.get(id));
      return identity.derivedWordOf === undefined && !before.has(String(identity.id));
    });
    if (!fresh.length) return;
    const named = relationMentions(stages[stageIndex]?.relations?.[relationIndex]).filter(id => before.has(id));
    // A repeated id cannot be compared, so it is not reported.
    const displaced = id => {
      const was = before.get(id), now = after.get(id);
      return !was || !now || canonical(was.node) !== canonical(now.node) || Boolean(was.parentId) && was.parentId !== now.parentId;
    };
    const copies = fresh.map(id => after.get(String(authoredIdentity(current.nodes.get(id)).id))).filter(Boolean);
    const holds = (node, id) => String(node.id) === id || (node.children ?? []).some(child => holds(child, id));
    // Internal Merge puts a copy beside an object that holds its earlier
    // occurrence. Sharing a root with it, as joined conjuncts do, is not re-merge.
    const besideHolder = (copy, id) => (after.get(copy.parentId)?.node.children ?? []).some(sister => sister !== copy.node && holds(sister, id));
    const remerged = id => Boolean(before.get(id).node.lineageId) && copies.some(copy => copy.node.lineageId === before.get(id).node.lineageId
      && sameMaterial(copy.node, before.get(id).node) && besideHolder(copy, id));
    // A new occurrence the claim names continues its lineage's displaced earlier occurrence.
    const namedLineages = new Set(relationMentions(stages[stageIndex]?.relations?.[relationIndex])
      .filter(id => !before.has(id) && after.get(id)?.node.lineageId).map(id => after.get(id).node.lineageId));
    const copiesDisplaced = [...before].some(([id, was]) => was && namedLineages.has(was.node.lineageId) && displaced(id));
    if (copiesDisplaced || named.some(id => displaced(id) || remerged(id))) return;
    fresh.forEach(id => out.push(violation('relation-construction', index + 1,
      `${id} appears at relation "${step.operation}", whose claim displaces nothing the stage had`)));
  });
  return out;
}

/** A parent already on screen gains a child only at a step that owns that
 * attachment. An edge to a parent displayed at the preceding step is new when
 * the child was not displayed under it there, either because the child is new
 * or because it was a separate root or elsewhere. A construction micro-step
 * owns it as `stepOwnsEdge` says; a relation moment owns it when it introduces
 * the child, or names the child as an owned movement endpoint or proven
 * rewrite. Anything else, such as a node's projection attaching it to a
 * retained parent whose merge comes later, shows the merge before its own
 * step. A derived word leaf is its owner's pronunciation, not an attachment. */
export function checkAttachAtMerge(replay) {
  const steps = replay.playbackSteps, out = [];
  let previous = EMPTY_FRAME;
  steps.forEach((step, index) => {
    const current = frameStructure(step), target = String(step.targetNodeId ?? '');
    const ownership = step.replayKind === 'relation' && step.replayRelationIdentity ? momentOwnership(step) : null;
    for (const id of current.displayed) {
      const parent = current.parent.get(id);
      if (!parent || !previous.displayed.has(parent)) continue;
      if (previous.displayed.has(id) && previous.parent.get(id) === parent) continue;
      const node = current.nodes.get(id);
      if (node.data.replayOrigin?.kind === 'word' || stepOwnsEdge(step, previous, current, id, parent)) continue;
      if (ownership && (named(node, ownership.endpoints) || named(node, ownership.rewritten)
        || !previous.displayed.has(id) && revealedByRelation(node, ownership, previous))) continue;
      out.push(violation('attach-at-merge', index + 1,
        `${id} attaches to ${parent} at ${step.replayKind} ${step.operation} (target ${target})`));
    }
    previous = current;
  });
  return out;
}

/** A movement moment introduces its landing together with the smallest new
 * parent needed to attach it above an existing subtree. In the authored stage
 * forest that parent is the landing's only sister when the landing's parent had
 * two or more children in the preceding stage and the sister holds those
 * children in order, each slot holding the earlier child itself or a node new
 * in this stage that contains it (such as the complex another movement of the
 * stage forms on it). The landing's parent keeps its earlier id, so the sister
 * is the inserted node. Whenever the moment paints the landing, the landing and
 * that sister are painted as daughters of the landing's parent; otherwise the
 * moment shows the landing beside the earlier children instead. A new sister
 * belongs to the first such moment of its stage: no earlier step of the stage
 * paints it, so no construction step builds it. */
export function checkMovementLandingParent(replay, record) {
  const out = [], stages = record.derivationStages ?? [], introduced = new Set();
  const parents = forest => {
    const parent = new Map(), pending = (forest ?? []).map(root => [root, null]);
    while (pending.length) {
      const [node, owner] = pending.pop();
      if (!node || typeof node !== 'object') continue;
      parent.set(String(node.id ?? ''), { node, owner });
      for (const child of node.children ?? []) pending.push([child, node]);
    }
    return parent;
  };
  const childIds = node => (node?.children ?? []).map(child => String(child.id ?? ''));
  const contains = (node, id) => String(node?.id ?? '') === id || (node?.children ?? []).some(child => contains(child, id));
  replay.playbackSteps.forEach((step, index) => {
    const identity = step.replayRelationIdentity;
    if (step.replayKind !== 'relation' || !identity) return;
    const key = `${identity.stageIndex}:${identity.relationIndex}`;
    const landings = new Set((step.replayRelationLinks ?? []).filter(link => link.authoredRelationKey === key
      && link.movementTransition === true).map(link => link.targetNodeId).filter(Boolean).map(String));
    if (!landings.size) return;
    const current = parents(stages[identity.stageIndex]?.workspaceForest), previous = parents(stages[identity.stageIndex - 1]?.workspaceForest);
    const frame = frameStructure(step);
    for (const landing of landings) {
      const host = current.get(landing)?.owner, earlier = host && previous.get(String(host.id ?? ''))?.node;
      const sister = childIds(host).length === 2 ? host.children.find(child => String(child.id ?? '') !== landing) : null;
      const slots = childIds(earlier);
      if (!sister || slots.length < 2 || childIds(sister).length !== slots.length
        || !sister.children.every((child, slot) => String(child.id ?? '') === slots[slot]
          || !previous.has(String(child.id ?? '')) && contains(child, slots[slot]))) continue;
      const hostId = String(host.id), sisterId = String(sister.id);
      if (!previous.has(sisterId) && !introduced.has(`${identity.stageIndex}:${sisterId}`)) {
        introduced.add(`${identity.stageIndex}:${sisterId}`);
        const early = replay.playbackSteps.findIndex((other, otherIndex) => otherIndex < index
          && other.replayFrameIndex === identity.stageIndex && frameStructure(other).displayed.has(sisterId));
        if (early >= 0)
          out.push(violation('movement-landing-parent', early + 1, `${sisterId} is painted at ${replay.playbackSteps[early].replayKind} `
            + `${replay.playbackSteps[early].operation} before the movement moment (frame ${index + 1}) that attaches landing ${landing} under ${hostId}`));
      }
      if (!frame.displayed.has(landing)) continue;
      if (frame.parent.get(landing) !== hostId || frame.parent.get(sisterId) !== hostId)
        out.push(violation('movement-landing-parent', index + 1,
          `${sisterId} is not painted beside landing ${landing} under ${hostId} at its movement moment`));
    }
  });
  return out;
}

/** Uses the renderer's own frame selection: within a stage, the relations played
 * so far and the active moment decide which compiled marks are revealed. */
export function checkMarksAtOwningMoment(replay) {
  const steps = replay.playbackSteps, plan = replay.relationRenderPlan, out = [], moments = new Map();
  if (!plan) return out;
  steps.forEach((step, index) => {
    if (step.replayKind !== 'relation' || !step.replayRelationIdentity) return;
    const key = `${step.replayRelationIdentity.stageIndex}:${step.replayRelationIdentity.relationIndex}`;
    if (!moments.has(key)) moments.set(key, index);
  });
  const played = new Map();
  steps.forEach((step, index) => {
    const stage = step.replayFrameIndex;
    if (!played.has(stage)) played.set(stage, new Set());
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
    if (identity?.stageIndex === stage) played.get(stage).add(identity.relationIndex);
    for (const item of visiblePlanFrameItems(plan, stage, played.get(stage), identity ? identity.relationIndex : null)) {
      const refs = planItemRelationRefs(item);
      if (refs.some(ref => (moments.get(`${ref.stageIndex}:${ref.relationIndex}`) ?? Infinity) <= index)) continue;
      out.push(violation('marks-at-owning-moment', index + 1, `${item.kind}${item.familyId ? ` ${item.familyId}` : ''} for relation `
        + `${refs.map(ref => `${ref.stageIndex}:${ref.relationIndex}`).join('/')} is revealed before its owning moment`));
    }
  });
  return out;
}

const LETTER_KINDS = new Set(['quantifier-raising', 'operator-variable-binding', 'coindex', 'binding-domain']);

/** Adds one shown index letter at a label to `shown` (label → Map(letter → count)). */
export function showLetter(shown, label, letter) {
  if (!label || !letter) return shown;
  const letters = shown.get(label) ?? new Map();
  return shown.set(label, letters.set(letter, (letters.get(letter) ?? 0) + 1));
}

/** The counting step of checkOneLetterPerLabel: each letter asserted at a label
 * (label → Set(letter)) is shown there exactly once. Returns `{ label, letter,
 * count }` otherwise. A browser probe feeds it painted letters; it can see a
 * repeated letter but, without the plan, not a missing one. */
export function countLabelLetters(shown, asserted) {
  const out = [];
  for (const [label, letters] of asserted) for (const letter of letters) {
    const count = shown.get(label)?.get(letter) ?? 0;
    if (count !== 1) out.push({ label, letter, count });
  }
  return out;
}

/** Paints each frame's index letters with the production binding painters in
 * the offline SVG DOM, over the frame's displayed labels. Each letter a drawn
 * mark asserts appears exactly once at the physical label it is placed at:
 * beside it, as an inline coindex, or as a subscript written into the label.
 * Placement restates the binding refinements' label lookups, independently of
 * the letter plan. `planLetters` is the renderer's own unless a control replaces it. */
export function checkOneLetterPerLabel(replay, planLetters = planIndexLetters) {
  const plan = replay.relationRenderPlan, out = [], played = new Map();
  if (!plan) return out;
  const { Element, restore } = createSvgDom();
  try {
    replay.playbackSteps.forEach((step, index) => {
      const stage = step.replayFrameIndex;
      if (!played.has(stage)) played.set(stage, new Set());
      const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
      if (identity?.stageIndex === stage) played.get(stage).add(identity.relationIndex);
      const items = visiblePlanFrameItems(plan, stage, played.get(stage), identity ? identity.relationIndex : null);
      if (!items.some(item => LETTER_KINDS.has(item.kind))) return;
      const structure = frameStructure(step), nodes = [...structure.nodes.values()];
      const all = indexHierarchyNodesByIdAndAliases(nodes);
      const shown = indexHierarchyNodesByIdAndAliases(nodes.filter(node => structure.displayed.has(getNodeId(node))));
      const resolve = id => shown.get(id)
        ?? (all.get(id)?.descendants().some(node => structure.displayed.has(getNodeId(node))) ? all.get(id) : undefined);
      const frame = { ...plan, frames: plan.frames.map((candidate, stageIndex) => stageIndex === stage ? { ...candidate, items } : candidate) };
      const primitives = bindRelationPlanFrame(frame, stage, id => all.has(String(id)) ? { x: 0, y: 0 } : null).primitives
        .filter(primitive => primitiveIndexLetters(primitive).length && planItemDependencyNodeIds(items[primitive.itemIndex]).every(resolve));
      if (!primitives.length) return;
      const root = new Element('g'), g = select(root);
      for (const [id, runs] of treeLabelRunsForStep(replay, index, undefined, { includeRelationIndices: false })) for (const run of runs) {
        const label = new Element('text', { class: `${run.kind}-label`,
          [run.kind === 'category' ? 'data-category-node-id' : 'data-node-id']: id }, structure.nodes.get(id));
        label.text = run.text;
        root.appendChild(label);
      }
      const shell = id => id ? shellLabelElement(g, id) : null;
      const terminal = id => id ? terminalLabelElement(g, resolve(id), id) : null;
      const accepted = id => shell(id) ?? terminal(id);
      const placed = (role, { nodeId, operatorNodeId, variableNodeId, witnessNodeId, family }) => {
        if (role === 'identity') {
          const target = identityLabelTarget(resolve(nodeId), nodeId);
          const labels = g.selectAll(target?.kind === 'terminal' ? '.terminal-label' : '.category-label')
            .filter(function exactIdentityLabel() { return labelBelongsToNode(this, target?.labelId || nodeId); });
          return labels.size() === 1 ? labels.node() : null;
        }
        if (role === 'operator') return shell(operatorNodeId);
        if (role === 'variable') return (witnessNodeId && terminal(witnessNodeId)) || accepted(variableNodeId);
        return role === 'badge' && family !== 'parasitic-gap.composition' ? accepted(nodeId) : shell(nodeId);
      };
      const letterLabels = indexLetterLabels(g, resolve);
      const letterPlan = planLetters(primitives, items, { ...letterLabels, emphasisRank: item => !identity ? 1
        : planItemOwnsRelationMoment(item, identity.stageIndex, identity.relationIndex) ? 2 : 0 });
      const layer = () => g.append('g');
      const drawing = createBindingDrawing({ activeDerivationFrameIndex: stage, overlay: g, frameItems: items, g,
        operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [], activeRelationMoment: identity,
        operatorVariableBindingLayers: new Map(), operatorVariableSharedPathLayers: new Map(), bindingRelationLayers: new Map(),
        coindexRelationLayers: new Map(), parasiticGapCoindexLayers: new Map(), acceptedRootLayerBeforeNodes: layer,
        acceptedRootLayerAfterNodes: layer, acceptedLayerInHost: layer, ensureControlRelationLayer: layer, appendMarker: layer,
        relationLayerKey: item => JSON.stringify(planItemRelationRefs(item)), relationEmphasisForItem: () => null,
        decorateRelationElement() {}, resolveOverlayAnchor: resolve, terminalAmbiguities: new Map(),
        identityTerminalOwners: new Map(), identityForestLightFamilies: [], markIdentityLensOccurrences() {},
        TARGET_EMERALD: '#34d399', indexLetterPlan: letterPlan });
      const painters = { 'quantifier-raising': drawing.drawQuantifierRaising, 'operator-variable-binding': drawing.drawOperatorVariableBinding,
        'index-badge': drawing.drawIndexBadge, 'identity-lens': drawing.drawIdentityLens };
      for (const primitive of primitives) painters[primitive.type](primitive, items[primitive.itemIndex], g.append('g'), null);
      const shownLetters = new Map(), show = (label, letter) => showLetter(shownLetters, label, letter);
      for (const element of descendants(root)) {
        const attrs = element.attrs;
        if (/^(category|terminal)-label$/.test(attrs.class || '')) {
          show(element, extractDisplayedSubscriptIndex(element.text));
          for (const tspan of element.children) if ((tspan.attrs.class || '').includes('babel-identity-index')) show(element, tspan.textContent);
          continue;
        }
        if (element.tag !== 'text' || !(attrs.class || '').split(' ').includes('babel-relation-index')) continue;
        const host = element.parentNode, qrRole = attrs['data-qr-index-role'], role = attrs['data-operator-variable-index-role'];
        show(qrRole ? shell(host.parentNode.attrs[qrRole === 'lf' ? 'data-qr-lf' : 'data-qr-pronounced'])
          : role ? placed(role, { operatorNodeId: host.attrs['data-operator-variable-operator'],
            variableNodeId: host.attrs['data-operator-variable-variable'], witnessNodeId: host.attrs['data-operator-variable-witness'] })
          : attrs['data-coindex-anchor'] ? shell(attrs['data-coindex-anchor'])
          : accepted(attrs['data-control-anchor'] || attrs['data-binding-anchor'] || attrs['data-coreference-anchor'] || attrs['data-index-anchor']),
        element.textContent);
      }
      const asserted = new Map();
      for (const primitive of primitives) for (const letter of primitiveIndexLetters(primitive)) {
        const label = placed(letter.role, { nodeId: letter.nodeId, operatorNodeId: letter.nodeId, variableNodeId: primitive.variableNodeId,
          witnessNodeId: primitive.traceWitnessNodeId, family: items[letter.itemIndex].familyId });
        if (label) asserted.set(label, (asserted.get(label) ?? new Set()).add(letter.index));
      }
      for (const { label, letter, count } of countLabelLetters(shownLetters, asserted)) {
        const labelId = label.attrs['data-category-node-id'] ?? label.attrs['data-node-id'];
        out.push(violation('one-letter-per-label', index + 1, `${labelId} shows ${letter} ${count} times`));
      }
    });
  } finally { restore(); }
  return out;
}
