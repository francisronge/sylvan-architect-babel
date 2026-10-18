/** Index letters as the production binding painters draw them, for the
 * duplicate-glyph invariant. Each Replay step paints its tree labels and its
 * revealed binding marks (operator-variable, quantifier raising, index badges
 * and identity coindexing) into the offline SVG DOM, then lists every painted
 * letter with the occurrence label it is drawn in or beside. Geometry is not
 * read: the painters' later screen refinements position letters, but never add
 * or remove them. This follows paintRelationScene's primitive loop
 * (components/renderer/relationScene.ts); when that loop changes how it calls
 * the binding painters, such as PR #75's index-letter ownership, update it here. */
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../../replay/displayIdentity.ts';
import { bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import { projectVisibleAnchorSetOrganization } from '../../replay/relations/relationFrame.ts';
import {
  isPlanItemRevealed, planItemDependencyNodeIds, planItemOwnsRelationMoment, resolveDisplayedTrajectoryAttachments
} from '../../replay/relations/renderPlan.ts';
import { projectThetaGrid } from '../../replay/relations/thetaGridComposition.ts';
import { indexHierarchyNodesByIdAndAliases, isSyntheticWorkspaceRootNode } from '../../replay/replayCanvas.ts';
import { isWordlessCategoryLeaf, shouldExpandPreterminalLeaf } from '../../replay/replaySurfaceNotation.ts';
import { createBindingDrawing } from '../../components/renderer/bindingDrawing.ts';
import { createSvgDom, descendants, select } from './svgDom.mjs';

// Families paintRelationScene hands to their own scheduled drawings before it
// reaches the binding painters; their letters are outside this census.
const SCHEDULED = new Set(['lf.reconstruction', 'cooper-storage.ledger', 'accord.link', 'accord.strong-npi', 'focus.f-projection',
  'multidominance.shared-node', 'argument-sharing.domains', 'anti-locality.paths', 'improper-movement.landing', 'intervention.blocked-path',
  'pf.fission', 'pf.impoverishment', 'pf.local-dislocation', 'theta.grid', 'focus.prominence']);

function paintStep(prepared, stepIndex, Element) {
  const step = prepared.playbackSteps[stepIndex];
  const stage = step.replayFrameIndex, plan = prepared.relationRenderPlan, canvas = step.replayCanvasData;
  if (!canvas || stage === undefined || !plan?.frames[stage]) return { glyphs: [] };
  const tree = d3.hierarchy(canvas); applyVizIds(tree);
  const all = tree.descendants(), visible = new Set(step.replayVisibleNodeIds ?? all.map(getNodeId));
  const nodes = all.filter(node => visible.has(getNodeId(node)) && !isSyntheticWorkspaceRootNode(node));
  const visibleAliases = indexHierarchyNodesByIdAndAliases(nodes), allAliases = indexHierarchyNodesByIdAndAliases(all);
  const resolve = id => visibleAliases.get(id) || (() => {
    const anchor = allAliases.get(id);
    return anchor?.descendants().some(node => visible.has(getNodeId(node))) ? anchor : undefined;
  })();
  const root = new Element('g');
  for (const node of nodes) {
    const id = getNodeId(node);
    if (node.children?.length || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data)) {
      const label = new Element('text', { class: 'category-label', 'data-category-node-id': id }, node);
      label.text = String(node.data.label || '');
      root.appendChild(label);
    }
    if (!node.children?.length && !isWordlessCategoryLeaf(node.data)) {
      const label = new Element('text', { class: 'terminal-label', 'data-node-id': id, 'data-default-label': node.data.word || '' }, node);
      label.text = String(node.data.word || node.data.label || '');
      root.appendChild(label);
    }
  }
  const played = new Set();
  for (let index = 0; index <= stepIndex; index++) {
    const identity = prepared.playbackSteps[index].replayRelationIdentity;
    if (prepared.playbackSteps[index].replayKind === 'relation' && identity?.stageIndex === stage) played.add(identity.relationIndex);
  }
  const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
  const active = identity?.stageIndex === stage ? identity.relationIndex : null;
  const focused = identity && Number.isInteger(identity.stageIndex) && Number.isInteger(identity.relationIndex) ? identity : null;
  const frameItems = projectVisibleAnchorSetOrganization(plan.frames[stage].items.map(item => resolveDisplayedTrajectoryAttachments(
    projectThetaGrid(item, stage, played), id => allAliases.get(id)?.data, { stageIndex: stage, playedRelationIndices: played })),
  item => isPlanItemRevealed(item, stage, played, active) && planItemDependencyNodeIds(item).every(id => Boolean(resolve(id))));
  const revealed = new Set(frameItems.flatMap((item, index) => isPlanItemRevealed(item, stage, played, active) ? [index] : []));
  const displayed = { ...plan, frames: plan.frames.map((frame, index) => index === stage ? { ...frame, items: frameItems } : frame) };
  const bound = bindRelationPlanFrame(displayed, stage, id => allAliases.get(String(id || '')) ? { x: 0, y: 0 } : null,
    { labelWidth: 150, labelHeight: 70, badgeGap: 46, laneGap: 60, markerScale: 1, isItemRevealed: index => revealed.has(index) });
  const marks = bound.primitives.filter(primitive => frameItems[primitive.itemIndex] && revealed.has(primitive.itemIndex)
    && planItemDependencyNodeIds(frameItems[primitive.itemIndex]).every(id => Boolean(resolve(id))))
    .map(primitive => ({ primitive, item: frameItems[primitive.itemIndex] }));
  const emphasis = item => focused ? planItemOwnsRelationMoment(item, focused.stageIndex, focused.relationIndex) ? 'active' : 'quiet' : null;
  const g = select(root);
  const layer = className => g.append('g').attr('class', className);
  const keyed = new Map();
  const keyedLayer = (_layers, item, _emphasis, className) => {
    const key = JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex, className]);
    if (!keyed.has(key)) keyed.set(key, layer(className));
    return keyed.get(key);
  };
  const drawing = createBindingDrawing({
    activeDerivationFrameIndex: stage, overlay: g, frameItems, g, operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [],
    focusedRelationMoment: focused, operatorVariableBindingLayers: new Map(), operatorVariableSharedPathLayers: new Map(),
    acceptedRootLayerBeforeNodes: keyedLayer, acceptedRootLayerAfterNodes: keyedLayer,
    acceptedLayerInHost: (_layers, _item, className, host) => host.append('g').attr('class', className),
    ensureControlRelationLayer: item => keyedLayer(null, item, null, 'babel-control-relation-layer'),
    bindingRelationLayers: new Map(), coindexRelationLayers: new Map(), parasiticGapCoindexLayers: new Map(),
    appendMarker: () => layer('vr-marker'), TARGET_EMERALD: '#34d399',
    relationLayerKey: item => JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex]),
    relationEmphasisForItem: emphasis, decorateRelationElement: () => {}, resolveOverlayAnchor: resolve, terminalAmbiguities: new Map(),
    identityTerminalOwners: new Map(), identityForestLightFamilies: [], markIdentityLensOccurrences() {},
    overlayNodeById: visibleAliases, visibleNodes: nodes, replayPlaqueLayout: new Map(),
    measuredTreeLabelRectNow: () => null, measuredTerminalSubtreeRectNow: () => null, measureCategoryText: text => [...text].length * 25
  });
  const errors = [];
  for (const { primitive, item } of marks) {
    if (SCHEDULED.has(item.familyId || '')) continue;
    const host = g.append('g').attr('class', 'vr-item');
    try {
      if (primitive.type === 'quantifier-raising') drawing.drawQuantifierRaising(primitive, item, host, emphasis(item));
      else if (primitive.type === 'operator-variable-binding') drawing.drawOperatorVariableBinding(primitive, item, host, emphasis(item));
      else if (primitive.type === 'index-badge') drawing.drawIndexBadge(primitive, item, host, emphasis(item));
      else if (primitive.type === 'identity-lens') drawing.drawIdentityLens(primitive, item, host, emphasis(item));
    } catch (error) { errors.push(`${primitive.type} ${item.familyId ?? ''}: ${String(error?.message ?? error).split('\n')[0]}`); }
  }
  const glyphs = [];
  const add = (label, letter, painter) => { if (label && letter) glyphs.push({ label, letter, painter }); };
  for (const element of descendants(root)) {
    const classes = (element.attrs.class || '').split(' ');
    if (element.tag === 'tspan' && classes.includes('babel-identity-index')) {
      const label = element.parentNode;
      add(label.attrs['data-category-node-id'] || label.attrs['data-node-id'], element.textContent, 'identity');
      continue;
    }
    if (element.tag !== 'text' || !classes.includes('babel-relation-index') || classes.includes('vr-index-badge')) continue;
    const parent = element.parentNode, grand = parent?.parentNode;
    if (grand?.attrs['data-qr-pronounced'] !== undefined && parent.attrs.class === 'babel-coindex-relation-layer') {
      const role = element.attrs['data-qr-index-role'] || (parent.children.indexOf(element) === 0 ? 'pronounced' : 'lf');
      add(grand.attrs[role === 'lf' ? 'data-qr-lf' : 'data-qr-pronounced'], element.textContent, 'qr');
    } else if (element.attrs['data-operator-variable-index-role']) {
      const role = element.attrs['data-operator-variable-index-role'];
      add(role === 'operator' ? parent.attrs['data-operator-variable-operator']
        : parent.attrs['data-operator-variable-witness'] || parent.attrs['data-operator-variable-variable'], element.textContent, 'operator-variable');
    } else {
      add(element.attrs['data-control-anchor'] || element.attrs['data-binding-anchor'] || element.attrs['data-coreference-anchor']
        || element.attrs['data-coindex-anchor'], element.textContent, 'badge');
    }
  }
  return { glyphs, errors };
}

/** Painted index letters for every Replay step: `[{ frame, glyphs, errors }]`. */
export function paintedIndexGlyphs(prepared) {
  if (!prepared.relationRenderPlan) return [];
  const { Element, restore } = createSvgDom();
  // The offline DOM has no NamedNodeMap; the shared operator path copies host attributes.
  Object.defineProperty(Element.prototype, 'attributes', { get() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); } });
  try {
    return prepared.playbackSteps.map((_step, index) => ({ frame: index + 1, ...paintStep(prepared, index, Element) }));
  } finally { restore(); }
}
