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
import { bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import { planItemDependencyNodeIds, planItemOwnsRelationMoment, planItemRelationRefs } from '../../replay/relations/renderPlan.ts';
import { visiblePlanFrameItems } from '../../replay/relations/relationFrame.ts';
import { indexHierarchyNodesByIdAndAliases } from '../../replay/replayCanvas.ts';
import { extractDisplayedSubscriptIndex } from '../../replay/replaySurfaceNotation.ts';
import { identityLabelTarget, treeLabelRunsForStep } from '../../replay/treeLabelRuns.ts';
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
 * (`parent::__lex_…`) stand for their authored leaf. */
export function authoredIdentity(node) {
  const origin = node.data.replayOrigin;
  if (origin?.kind === 'word') return { derivedWordOf: origin.ownerId };
  if (origin?.kind === 'lexical') return { id: origin.authoredId };
  return { id: node.data.id ?? getNodeId(node) };
}

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
    let previous = null;
    (stage.relations ?? []).forEach((relation, relationIndex) => {
      const key = `${stageIndex}:${relationIndex}`, own = moments.get(key) ?? [];
      if (!isRenderableAuthoredRelation(relation)) return;
      if (own.length !== 1) out.push(violation('relation-moments', own[1] === undefined ? null : own[1] + 1,
        `relation ${key} (${relation.relation}) has ${own.length} moments`));
      if (!own.length) return;
      if (previous && own[0] < previous.index) out.push(violation('relation-moments', own[0] + 1,
        `relation ${key} plays before earlier authored relation ${previous.key}`));
      previous = { key, index: own[0] };
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

/** A construction micro-step changes existing syntax only through its own
 * target. A node displayed at the preceding step stays displayed under the same
 * parent unless the step's target now holds it (a merge or projection), or the
 * new target takes its place. Nothing is detached. */
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
      // When the new target replaces the old parent, that parent's material
      // may regroup under the target or the target's parent.
      const parentReplaced = newTarget && before != null && !current.displayed.has(before);
      if (after == null) out.push(violation('stable-construction', index + 1, `${id} is detached from ${before} ${where}`));
      else if (!holds(after) && !(parentReplaced && after === current.parent.get(target))) {
        out.push(violation('stable-construction', index + 1, `${id} moves from ${before} to ${after} ${where}`));
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

/** What one relation moment introduces by itself. A proved movement transition
 * (a new landing or proven relocation) owns its complete landing and lower
 * occurrence: the subtrees at its own link endpoints, whatever mark draws it.
 * A neutral relation owns only the exact rewrite the compiler proved for it.
 * Other anchors are context that must already be on screen. */
function momentOwnership(step) {
  const { stageIndex, relationIndex } = step.replayRelationIdentity, key = `${stageIndex}:${relationIndex}`;
  const own = (step.replayRelationLinks ?? []).filter(link => link.authoredRelationKey === key);
  const movements = own.filter(link => link.movementTransition === true);
  return {
    endpoints: new Set(movements.flatMap(link => [link.sourceNodeId, link.targetNodeId, link.witnessNodeId, link.priorSourceNodeId]).filter(Boolean)),
    sources: new Set(movements.flatMap(link => [link.sourceNodeId, link.witnessNodeId, link.priorSourceNodeId]).filter(Boolean)),
    rewritten: new Set(step.replayTreeTransition?.currentNodeIds ?? []),
    anchored: new Set(own.flatMap(link => (link.anchors ?? []).map(anchor => anchor.nodeId)).filter(Boolean))
  };
}

/** Whether a node first painted at a relation moment belongs to it. Besides
 * what the moment owns, it introduces the shortest new ancestor chain that
 * joins owned syntax to existing syntax (for a movement, the workspace that
 * held its source), the new sisters created where a landing attaches (a new
 * parent over an existing subtree, or a receiving head's new inner head), and
 * the word a relation realizes on an occurrence it anchors that is already shown. */
function revealedByRelation(node, ownership, previous) {
  const { endpoints, sources, rewritten, anchored } = ownership;
  const isOwned = candidate => named(candidate, endpoints) || named(candidate, rewritten);
  const shownBefore = candidate => previous.displayed.has(getNodeId(candidate));
  if (node.ancestors().some(ancestor => named(ancestor, endpoints))) return true;
  const origin = node.data.replayOrigin;
  if (named(node, rewritten) || origin?.kind === 'word' && rewritten.has(origin.ownerId)) return true;
  if (origin?.kind === 'word' && anchored.has(origin.ownerId) && node.parent && shownBefore(node.parent)) return true;
  const rootBefore = id => { while (previous.parent.get(id)) id = previous.parent.get(id); return id; };
  const sourceRoots = new Set([...previous.displayed].filter(id => sources.size ? named(previous.nodes.get(id), sources) : true).map(rootBefore));
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
 * relation moment reveals what it introduces; a stage's completed state adds nothing. */
export function checkNoEarlyReveal(replay) {
  const steps = replay.playbackSteps, out = [];
  let previous = EMPTY_FRAME;
  steps.forEach((step, index) => {
    const structure = frameStructure(step), target = String(step.targetNodeId ?? '');
    const ownership = step.replayKind === 'relation' && step.replayRelationIdentity ? momentOwnership(step) : null;
    for (const id of structure.displayed) {
      if (previous.displayed.has(id)) continue;
      const node = structure.nodes.get(id), origin = node.data.replayOrigin;
      if (step.replayKind === 'micro' && (id === target || origin?.kind === 'word' && origin.ownerId === target)) continue;
      if (ownership && revealedByRelation(node, ownership, previous)) continue;
      out.push(violation('no-early-reveal', index + 1, `${id} appears at ${step.replayKind} ${step.operation} (target ${target})`));
    }
    previous = structure;
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
        operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [], focusedRelationMoment: identity,
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
      const shownLetters = new Map(), show = (label, letter) => {
        if (!label || !letter) return;
        const letters = shownLetters.get(label) ?? new Map();
        shownLetters.set(label, letters.set(letter, (letters.get(letter) ?? 0) + 1));
      };
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
      for (const [label, letters] of asserted) for (const letter of letters) {
        const count = shownLetters.get(label)?.get(letter) ?? 0;
        const labelId = label.attrs['data-category-node-id'] ?? label.attrs['data-node-id'];
        if (count !== 1) out.push(violation('one-letter-per-label', index + 1, `${labelId} shows ${letter} ${count} times`));
      }
    });
  } finally { restore(); }
  return out;
}
