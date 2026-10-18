/** The offline adapter for tests/helpers/visualRules.mjs: every Replay frame
 * and the Canopy, laid out as the browser lays them out and normalized to the
 * rules' frame model.
 *
 * scripts/replayFrameLayout.mjs runs the measured browser path (plaque worker
 * job, stage tree layout, unary alignment, stage camera bounds); the real
 * fitTreeCamera picks each viewport's Fit; the relation binder and the
 * neutral-label refit place role labels and connectors at that Fit, as
 * paintRelationScene does. Only DOM reads are replaced: text is measured from
 * the bundled fonts (visualFontMetrics.mjs), so boxes, plaque sizes and the Fit
 * approximate a native capture and never replace one. */
import * as d3 from 'd3';
import * as canvas from '../../replay/replayCanvas.ts';
import * as camera from '../../replay/stageCamera.ts';
import * as coordinates from '../../replay/stageCoordinates.ts';
import * as display from '../../replay/displayIdentity.ts';
import * as layout from '../../replay/treeLayout.ts';
import * as plaqueJob from '../../replay/plaqueLayoutJob.ts';
import { CATEGORY_FONT, CATEGORY_LINE_HEIGHT, categoryTextLayout } from '../../replay/categoryTextLayout.ts';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { prepareTreeLabelRuns } from '../../replay/prepareTreeLabelRuns.ts';
import { fallbackMarkerScale, fitFallbackGeometry } from '../../replay/relations/fallbackGeometry.ts';
import { bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import { projectPlaqueLayout } from '../../replay/relations/plaquePlacement.ts';
import { projectVisibleAnchorSetOrganization } from '../../replay/relations/relationFrame.ts';
import {
  isPlanItemRevealed, planItemDependencyNodeIds, planItemRelationRefs, resolveDisplayedTrajectoryAttachments
} from '../../replay/relations/renderPlan.ts';
import { projectThetaGrid } from '../../replay/relations/thetaGridComposition.ts';
import { resolveUniqueDisplayTerminal } from '../../replay/relations/trajectoryAttachment.ts';
import {
  isDisplayTerminalNode, isWordlessCategoryLeaf, resolveLeafSurface, shouldExpandPreterminalLeaf
} from '../../replay/replaySurfaceNotation.ts';
import { treeLabelRunsForStep } from '../../replay/treeLabelRuns.ts';
import { buildMovementProtectedNodeIds, isUnderTriangulation } from '../../replay/triangulation.ts';
import * as notation from '../../components/renderer/treeNotation.ts';
import { fitTreeCamera } from '../../components/renderer/frameCamera.ts';
import { createPrimitiveVisibility } from '../../components/renderer/relationVisibility.ts';
import { createTreeInkTextMeasure, TERMINAL_FONT } from '../../components/treeInkTextMeasure.ts';
import { createTreeLabelMeasure } from '../../components/treeLabelMeasure.ts';
import { availableTreeViewport } from '../../components/treeViewport.ts';
import { layoutReplayFrames } from '../../scripts/replayFrameLayout.mjs';
import { createCameraHarness } from './cameraHarness.mjs';
import { createSvgDom } from './svgDom.mjs';
import { checkFrame, THRESHOLDS } from './visualRules.mjs';
import { createMeasuringDocument, measureCategoryText, measurePlaqueText, measureRun, parseFont } from './visualFontMetrics.mjs';

/** Browser windows the audit fits. The tree canvas sits below the app bar: a
 * 1600×1000 capture measured a 1596×876 canvas. The Replay header and panel
 * (styles.css: `height: min(260px, 40%)`, at least 148px) and the right-hand
 * controls (App.tsx: `right-4 md:right-8`, 44 or 56px wide, 12px clearance) are
 * the obstacles TreeVisualizer measures for fitting. With these estimates the
 * Fit of that capture is reproduced within 1.1%; the mobile canvas has not been
 * checked against a capture. */
export const viewportForWindow = (name, [width, height]) => Object.freeze({ name, width: width - 4, height: height - 124 });
export const VIEWPORTS = Object.freeze([
  viewportForWindow('desktop', [1440, 900]), viewportForWindow('desktop-large', [2560, 1440]), viewportForWindow('mobile', [390, 844])
]);

export function viewportObstacles({ width, height }, replay = true) {
  const panel = Math.max(148, Math.min(260, 0.4 * height, height - 100));
  return { top: 0, right: width < 768 ? 72 : 100, bottom: 16, headerBottom: replay ? 66 : 42,
    panelTop: replay ? height - 16 - panel : Infinity };
}

// The renderer's own tree-ink and styled-label measures, reading the bundled fonts.
const measuringDocument = createMeasuringDocument();
const measureTreeInk = createTreeInkTextMeasure(measuringDocument);
const measureTreeLabel = createTreeLabelMeasure(measuringDocument);
const MODULES = { coordinates, camera, layout, display, d3, plaqueJob, notation, canvas };

const rect = (x, y, width, height) => ({ x, y, width, height });
const union = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return rect(x, y, Math.max(...rects.map(r => r.x + r.width)) - x, Math.max(...rects.map(r => r.y + r.height)) - y);
};
const isCategory = node => Boolean(node.children?.length) || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data);
const isTerminal = node => !node.children?.length && !isWordlessCategoryLeaf(node.data);
const refsOf = item => planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`);
const INDEX_FONT = { family: 'Crimson Pro', italic: true, weight: 900 };

/** Painted label geometry: `boxes` holds one glyph box per painted line and
 * per index run, and `cell` the SVG text box the renderer measures (font cells).
 * Index runs follow treeLabelIndexAttributes: dx 5, a subscript shift or a theta
 * dy. Separate boxes keep the empty corner beside a short line, or below a word
 * next to its lowered index, out of the glyphs. */
export function labelGeometry(node, run) {
  const terminal = run.kind === 'terminal', font = parseFont(terminal ? TERMINAL_FONT : CATEGORY_FONT);
  const lines = terminal ? [run.text] : run.lines ?? [run.text];
  const boxes = [], cells = [];
  lines.forEach((line, index) => {
    const baseline = node.y + (terminal ? 115 : -10 - (lines.length - 1 - index) * CATEGORY_LINE_HEIGHT);
    const pieces = [{ text: line, font, dx: 0, shift: 0 }];
    if (index === lines.length - 1) for (const indexRun of run.indices) pieces.push({ text: indexRun.text,
      font: { ...INDEX_FONT, size: terminal ? 30 : 22 }, dx: 5,
      shift: indexRun.mode === 'identity' ? (terminal ? 6 : 4.4) : terminal ? 14 : 9 });
    const measured = pieces.map(piece => ({ ...piece, run: measureRun(piece.text, piece.font) }));
    let pen = node.x - measured.reduce((sum, piece) => sum + piece.dx + piece.run.width, 0) / 2;
    for (const piece of measured) {
      pen += piece.dx;
      const y = baseline + piece.shift;
      cells.push(rect(pen, y - piece.run.fontAscent, piece.run.width, piece.run.fontAscent + piece.run.fontDescent));
      if (piece.run.right > piece.run.left) boxes.push(rect(pen + piece.run.left, y - piece.run.ascent,
        piece.run.right - piece.run.left, piece.run.ascent + piece.run.descent));
      pen += piece.run.width;
    }
  });
  return { boxes, cell: union(cells), lines };
}

/** Sampled d3.linkVertical cubic from a parent to a child position. */
export function branchPoints(source, target, samples = 24) {
  const middle = (source.y + target.y) / 2;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples, u = 1 - t;
    return { x: u ** 3 * source.x + 3 * u * u * t * source.x + 3 * u * t * t * target.x + t ** 3 * target.x,
      y: u ** 3 * source.y + 3 * u * u * t * middle + 3 * u * t * t * middle + t ** 3 * target.y };
  });
}

/** Polylines of an SVG path drawn with M, L, H, V and Q commands. */
export function pathPolylines(d) {
  const tokens = String(d || '').trim().match(/[MLHVQ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const paths = [];
  let at = null, index = 0;
  const number = () => Number(tokens[index++]);
  const to = point => { paths.at(-1).push(point); at = point; };
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') { at = { x: number(), y: number() }; paths.push([at]); }
    else if (command === 'L') to({ x: number(), y: number() });
    else if (command === 'H') to({ x: number(), y: at.y });
    else if (command === 'V') to({ x: at.x, y: number() });
    else if (command === 'Q') {
      const start = at, control = { x: number(), y: number() }, end = { x: number(), y: number() };
      for (let step = 1; step <= 12; step++) {
        const t = step / 12, u = 1 - t;
        to({ x: u * u * start.x + 2 * u * t * control.x + t * t * end.x, y: u * u * start.y + 2 * u * t * control.y + t * t * end.y });
      }
    } else throw Error(`Unsupported path command ${command} in ${d}`);
  }
  return paths.filter(path => path.length > 1);
}

/** A placed plaque in the rules' model. The allocator measures from a
 * word-bearing leaf's word, 140 units below it. A Case route or a feature
 * collector joins the plaque to syntax. */
export function plaqueRecord(item, box, anchor) {
  const grid = item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid';
  const text = item.kind === 'node-plaque' ? (grid ? `theta ${(item.thetaRoles ?? []).map(role => role.role ?? role.label).join('/')}`
    : (item.rows ?? []).map(row => `${row.label}: ${row.value}`).join('; ')) : `${item.kind} ${item.pathStyle ?? ''}`.trim();
  return { id: `plaque(${refsOf(item).join('/')} ${text.slice(0, 48)})@${box.attachmentNodeId}`, text, claims: refsOf(item),
    rect: rect(box.x, box.y, box.drawnWidth ?? box.width, box.drawnHeight ?? box.height), radius: 14,
    size: { width: box.width, height: box.height }, grid,
    joined: item.kind === 'directed-path' || Boolean(box.collectionRows?.length),
    anchor: anchor && { x: anchor.x, y: anchor.y + (!anchor.children?.length && anchor.data.word ? 140 : 0) } };
}

/** The neutral role placer's preferred spots (fallbackGeometry.ts,
 * placeFallbackMark), with its viewport alternatives above and below. */
function roleReach(mark, scale) {
  const r = mark.labelRect, gap = (mark.textWidth / 2 + 7) * scale, center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const spots = [{ x: r.x + r.width + gap, y: center.y }, { x: r.x - gap, y: center.y }, { x: center.x, y: r.y - 15 * scale },
    { x: r.x + r.width + gap, y: r.y - 15 * scale }, { x: r.x - gap, y: r.y - 15 * scale }, { x: center.x, y: r.y + r.height + 15 * scale }];
  return { reach: Math.max(...spots.map(spot => Math.hypot(spot.x - center.x, spot.y - center.y))),
    distance: Math.hypot(mark.x - center.x, mark.y - center.y) };
}

/** The browser resolves Replay direction from the sentence's first strong character. */
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const directionOf = sentence => RTL.test([...String(sentence ?? '')].find(char => /\p{L}/u.test(char)) ?? '') ? 'rtl' : 'ltr';

/** Replay preparation shared by every viewport of one record. */
export function prepareVisualRecord(record) {
  const prepared = prepareReplay({ derivationStages: structuredClone(record.derivationStages), sentence: record.sentence,
    inputTokens: record.inputTokens, includePlayback: true });
  const runs = new Map();
  return { record, prepared, direction: directionOf(record.sentence),
    treeLabelRuns: prepareTreeLabelRuns(prepared, measureCategoryText, { includeRelationIndices: true }),
    protectedNodeIds: buildMovementProtectedNodeIds(prepared.committedDerivationVisualLinks),
    stepRuns(index) {
      if (!runs.has(index)) runs.set(index, treeLabelRunsForStep(prepared, index, measureCategoryText, { includeRelationIndices: true }));
      return runs.get(index);
    } };
}

const firstRun = (runs, kind) => runs?.find(run => run.kind === kind);

/** Tree text, stems and branches painted by paintSyntaxTree. */
function paintedTree(tree, visible, runsFor) {
  const nodes = tree.descendants().filter(node => !isUnderTriangulation(node) && !canvas.isSyntheticWorkspaceRootNode(node)
    && (!visible || visible.has(display.getNodeId(node))));
  const shown = new Set(nodes), texts = [], lines = [];
  for (const node of nodes) {
    const id = display.getNodeId(node), runs = runsFor(node);
    if (isCategory(node)) {
      const run = firstRun(runs, 'category') ?? { kind: 'category', text: node.data.label || '',
        lines: categoryTextLayout(node.data.label || '', measureCategoryText).lines, indices: [] };
      const { boxes, cell, lines: wrapped } = labelGeometry(node, run);
      if (boxes.length) texts.push({ id: `${id}:category`, kind: 'category', text: run.text, boxes, cell, halo: 5, nodes: [id], claims: [], lines: wrapped });
    }
    if (isTerminal(node)) {
      const run = firstRun(runs, 'terminal') ?? { kind: 'terminal', text: resolveLeafSurface(node).trim(), indices: [] };
      const { boxes, cell } = labelGeometry(node, run);
      if (boxes.length) texts.push({ id: `${id}:word`, kind: 'word', text: run.text, boxes, cell, halo: 4, nodes: [id], claims: [] });
      lines.push({ id: `${id}:stem`, kind: 'stem', paths: [[{ x: node.x, y: node.y + 20 }, { x: node.x, y: node.y + 65 }]],
        halfWidth: 1.5, nodes: [id], claims: [] });
    }
    if (node.parent && shown.has(node.parent)) lines.push({ id: `${display.getNodeId(node.parent)}->${id}`, kind: 'branch',
      paths: [branchPoints(node.parent, node)], halfWidth: 2, nodes: [display.getNodeId(node.parent), id], claims: [] });
  }
  return { nodes, texts, lines };
}

/** Every painted Replay frame of one record at each viewport. Layout depends on
 * the viewport only through the stage layout sizes, so viewports with equal
 * sizes share one layout; each gets its own Fit and neutral-label refit. */
export function layoutVisualFrames(visual, viewports = VIEWPORTS, { steps: only } = {}) {
  const { prepared } = visual, steps = prepared.playbackSteps, stages = prepared.replayDerivationFrames;
  if (!steps.length || !stages.length) return [];
  const groups = camera.buildStageLayoutGroups(steps, stages), shared = new Map();
  for (const viewport of viewports) {
    const key = JSON.stringify(stages.map((_, stage) => camera.stageTreeLayoutSize(steps, stage, viewport.width, viewport.height, groups)));
    shared.set(key, [...(shared.get(key) ?? []), viewport]);
  }
  const { Element, restore } = createSvgDom();
  try { return [...shared.values()].flatMap(group => layoutGroup(visual, group, only, Element)); } finally { restore(); }
}

/** The measured browser layout of every frame of one prepared record at one
 * canvas size: scenes, plaque schedule and `stageCamera(stage, completedStep)`. */
export function layoutMeasuredScenes(visual, { width, height }) {
  const { prepared } = visual;
  return layoutReplayFrames({ steps: prepared.playbackSteps, stages: prepared.replayDerivationFrames, width, height,
    direction: visual.direction, measured: { plan: prepared.relationRenderPlan, protectedNodeIds: visual.protectedNodeIds,
      treeLabelRuns: visual.treeLabelRuns, measurePlaqueText, measureCategoryText, measureTreeInk, measureTreeLabel } }, MODULES);
}

function layoutGroup(visual, viewports, only, Element) {
  const { prepared } = visual, steps = prepared.playbackSteps, plan = prepared.relationRenderPlan;
  const scene = layoutMeasuredScenes(visual, viewports[0]);
  return scene.scenes.flatMap(({ step, tree, visible, nodes }, stepIndex) => {
    if (only && !only.includes(stepIndex + 1) || !step.replayCanvasData || !Number.isInteger(step.replayFrameIndex)) return [];
    const stage = step.replayFrameIndex, runs = visual.stepRuns(stepIndex);
    const shown = step.replayVisibleNodeIds?.length ? visible : null;
    const painted = paintedTree(tree, shown, node => runs.get(display.getNodeId(node)));
    const completedStep = stepIndex === steps.length - 1 && step.replayKind === 'macro' ? stepIndex : undefined;
    const { bounds, containment } = scene.stageCamera(stage, completedStep);
    return viewports.map(viewport => {
      // The real Fit of a directly loaded frame; fitFallbackOverlays reports it.
      const harness = createCameraHarness(Element, { width: viewport.width, height: viewport.height, animated: true, step: stepIndex });
      let fitted = null;
      harness.run(() => fitTreeCamera({ session: harness.session, layout: { relationRenderPlan: plan, activeDerivationFrameIndex: stage,
        uiBounds: viewportObstacles(viewport), stageCameraBounds: bounds, stagePlaqueContainmentBounds: containment,
        completedReplayStep: completedStep, g: harness.group, fitFallbackOverlays: (k, view) => { fitted = { k, view }; },
        derivationFrameFitNodes: [...nodes.values()], overlayFitBounds: null, visibleNodes: [...nodes.values()] } }));
      const marks = relationGeometry({ visual, step, stepIndex, tree, painted, plan, schedule: scene.schedule, fitted, runs });
      return { frame: stepIndex + 1, viewport: viewport.name, zoom: fitted.k, texts: [...painted.texts, ...marks.texts],
        plaques: marks.plaques, lines: [...painted.lines, ...marks.lines] };
    });
  });
}

/** Plaques, neutral role labels and connectors, bound as paintRelationScene
 * binds them for this step and refit at the Fit as fitFallbackOverlays does. */
function relationGeometry({ visual, step, stepIndex, tree, painted, plan, schedule, fitted, runs }) {
  const stage = step.replayFrameIndex, none = { texts: [], plaques: [], lines: [] };
  if (!plan?.frames[stage]) return none;
  const steps = visual.prepared.playbackSteps, played = new Set();
  for (let index = 0; index <= stepIndex; index++) {
    const identity = steps[index].replayRelationIdentity;
    if (steps[index].replayKind === 'relation' && identity?.stageIndex === stage) played.add(identity.relationIndex);
  }
  const active = step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stage ? step.replayRelationIdentity.relationIndex : null;
  const all = tree.descendants(), laidOut = canvas.indexHierarchyNodesByIdAndAliases(all);
  const overlay = canvas.indexHierarchyNodesByIdAndAliases(painted.nodes), visibleIds = new Set(overlay.keys());
  const resolveOverlayAnchor = id => overlay.get(id) ?? (() => {
    const node = laidOut.get(id);
    return node?.descendants().some(descendant => visibleIds.has(display.getNodeId(descendant))) ? node : undefined;
  })();
  const cells = new Map(painted.texts.map(text => [text.id, text.cell]));
  const positionFor = (id, attachment = 'position') => {
    const anchor = laidOut.get(String(id || ''));
    if (!anchor) return null;
    if (attachment === 'terminal') {
      const { terminal } = resolveUniqueDisplayTerminal(anchor, node => node.children || [], node => isDisplayTerminalNode(node.data));
      const cell = terminal && cells.get(`${display.getNodeId(terminal)}:word`);
      return !terminal ? null : cell ? { x: cell.x + cell.width / 2, y: cell.y + cell.height + 6 } : { x: terminal.x, y: terminal.y + 140 };
    }
    if (attachment === 'parent') return anchor.parent ? { x: anchor.parent.x, y: anchor.parent.y } : null;
    const cell = cells.get(`${display.getNodeId(anchor)}:category`);
    if (attachment === 'shell-top') return cell ? { x: cell.x + cell.width / 2, y: cell.y - 8 } : { x: anchor.x, y: anchor.y - 8 };
    if (attachment === 'shell-bottom') return cell ? { x: cell.x + cell.width / 2, y: cell.y + cell.height + 6 } : { x: anchor.x, y: anchor.y + 6 };
    return { x: anchor.x, y: anchor.y };
  };
  const placements = projectPlaqueLayout(camera.selectReplayPlaqueLayout(schedule, stage, stepIndex), id => laidOut.get(id) ?? null);
  const items = projectVisibleAnchorSetOrganization(plan.frames[stage].items.map(item => resolveDisplayedTrajectoryAttachments(
    projectThetaGrid(item, stage, played), id => overlay.get(id)?.data, { stageIndex: stage, playedRelationIndices: played })),
  item => isPlanItemRevealed(item, stage, played, active) && planItemDependencyNodeIds(item).every(id => Boolean(resolveOverlayAnchor(id))));
  const revealed = new Set(items.flatMap((item, index) => isPlanItemRevealed(item, stage, played, active) ? [index] : []));
  const shown = index => revealed.has(index) && planItemDependencyNodeIds(items[index]).every(id => Boolean(resolveOverlayAnchor(id)));
  const visiblePlacements = [...placements].filter(([index]) => items[index] && shown(index));
  const plaques = visiblePlacements.map(([index, box]) => plaqueRecord(items[index], box, laidOut.get(box.attachmentNodeId)));
  if (!items.some(item => item.kind === 'fallback')) return { ...none, plaques };
  // measureFallbackLabels: plain label cells for every laid-out node.
  const labelRects = new Map(all.filter(node => !canvas.isSyntheticWorkspaceRootNode(node) && !isUnderTriangulation(node)).map(node => {
    const run = isCategory(node) ? { kind: 'category', text: node.data.label || '', lines: categoryTextLayout(node.data.label || '', measureCategoryText).lines, indices: [] }
      : { kind: 'terminal', text: firstRun(runs.get(display.getNodeId(node)), 'terminal')?.text ?? resolveLeafSurface(node).trim(), indices: [] };
    return [display.getNodeId(node), labelGeometry(node, run).cell];
  }));
  const rectFor = (id, subtree) => {
    const anchor = laidOut.get(id);
    const rects = anchor ? (subtree ? anchor.descendants() : [anchor]).flatMap(node => labelRects.get(display.getNodeId(node)) ?? []) : [];
    return rects.length ? union(rects) : null;
  };
  const fallbackMeasurements = { labels: [...labelRects.values()], obstacles: [...placements.values()],
    visibleLabels: [...labelRects].filter(([id]) => visibleIds.has(id)).map(([, value]) => value),
    visibleObstacles: visiblePlacements.map(([, box]) => box), labelFor: id => rectFor(id, false), subtreeFor: id => rectFor(id, true),
    bottom: Math.max(0, ...[...labelRects.values()].map(value => value.y + value.height)) };
  const markerScale = Math.min(1 / fitted.k, 3), maxY = d3.max(all, node => node.y) ?? 0;
  const textTop = d3.min(painted.texts, text => text.cell.y) ?? -90;
  const runText = (id, text) => (runs.get(id) ?? []).some(run => run.text + run.indices.map(index => index.text).join('') === text);
  const bound = bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, index) => index === stage ? { ...frame, items } : frame) },
    stage, positionFor, { labelWidth: 150, labelHeight: 70, badgeGap: 46, laneGap: 60, markerScale,
      hasExistingGapNotation: runText, plaqueTextLayout: { measureText: measurePlaqueText }, fallbackMeasurements,
      separateFallbackMoments: true, isItemRevealed: index => revealed.has(index), trajectoryCeilingY: textTop - 90,
      trajectoryFloorY: maxY + 180, connectorBaselineY: maxY + 130, railBaseY: maxY + 240 });
  const scale = fallbackMarkerScale(fitted.k, fallbackMeasurements.labels.map(value => value.height));
  // measureRelationInkObstacles reserves filled plaque shells with five units of padding.
  const refit = fitFallbackGeometry(bound, { markerScale, fittedMarkerScale: scale, fittedAnchorScale: Math.min(1 / fitted.k, 3),
    badgeGap: 46, laneGap: 60, fallbackMeasurements, railBaseY: maxY + 240, separateFallbackMoments: true, fittedViewport: fitted.view,
    relationInkObstacles: plaques.map(({ rect: shell }) => rect(shell.x - 5, shell.y - 5, shell.width + 10, shell.height + 10)) });
  const drawable = createPrimitiveVisibility(items, resolveOverlayAnchor);
  const marks = bound.primitives.filter(primitive => revealed.has(primitive.itemIndex) && drawable(primitive));
  const texts = marks.filter(primitive => primitive.type === 'fallback-mark').map(primitive => {
    const mark = refit.get(primitive) ?? primitive, height = (mark.textHeight ?? 20) * scale, claims = refsOf(items[primitive.itemIndex]);
    // The placement box adds two units per side for the three-unit round outline.
    return { id: `role(${claims.join('/')} ${primitive.text})@${primitive.nodeId}`, kind: 'role', text: primitive.text, nodes: [], claims,
      boxes: [rect(mark.x - mark.textWidth / 2 * scale, mark.y - height / 2, mark.textWidth * scale, height)], halo: 1.5 * scale,
      ...roleReach(mark, scale) };
  });
  const lines = marks.filter(primitive => primitive.type === 'segment').map(primitive => {
    const segment = refit.get(primitive) ?? primitive, claims = refsOf(items[primitive.itemIndex]);
    return { id: `connector(${claims.join('/')})${primitive.witnessNodeIds.join('→')}`, kind: 'connector', claims,
      nodes: primitive.witnessNodeIds.flatMap(id => laidOut.get(id)?.descendants().map(display.getNodeId) ?? [id]),
      paths: pathPolylines(segment.d), halfWidth: (segment.route === 'direct' ? 1.5 : 1.9) * scale / 2 };
  });
  return { texts, plaques, lines };
}

/** The Canopy: the final stage's forest without relation marks, fitted to its
 * painted bounds as fitTreeCamera fits a frame without stage bounds. */
export function layoutCanopyVisualFrame(visual, viewport) {
  const data = canvas.buildDerivationCanvasData(visual.record.derivationStages.at(-1)?.workspaceForest ?? []);
  if (!data) return null;
  const root = d3.hierarchy(canvas.buildRenderableCommittedCanvasData(data)); display.applyVizIds(root);
  const tree = layout.layoutSyntaxTree(root, camera.treeLayoutSize(root.descendants().length, root.height, viewport.width, viewport.height),
    visual.direction, undefined, undefined, { measureCategoryText, measureTreeInk });
  const painted = paintedTree(tree, null, () => undefined);
  const box = union([...painted.texts.map(text => text.cell), ...painted.lines.flatMap(line => line.paths.flat().map(p => rect(p.x, p.y, 0, 0)))]);
  const view = availableTreeViewport(viewport.width, viewport.height, viewportObstacles(viewport, false));
  const zoom = Math.max(viewport.width < 500 ? 0.02 : 0.06, Math.min((view.right - view.left) / box.width, (view.bottom - view.top) / box.height, 1));
  return { frame: 'canopy', viewport: viewport.name, zoom, texts: painted.texts, plaques: [], lines: painted.lines };
}

/** One record's findings: every Replay frame at each viewport and the Canopy. */
export function auditVisualRecord(id, record, { viewports = VIEWPORTS, canopy = true, thresholds = THRESHOLDS } = {}) {
  const visual = prepareVisualRecord(record);
  const frames = layoutVisualFrames(visual, viewports);
  if (canopy) frames.push(...viewports.map(viewport => layoutCanopyVisualFrame(visual, viewport)).filter(Boolean));
  return { steps: visual.prepared.playbackSteps.length, frames: frames.length,
    findings: frames.flatMap(frame => checkFrame(frame, thresholds)).map(finding => ({ ...finding, record: id })) };
}
