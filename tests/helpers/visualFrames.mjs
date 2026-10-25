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
import { categoryTextLayout } from '../../replay/categoryTextLayout.ts';
import {
  CATEGORY_FONT, categoryLineBaselineY, INDEX_LABEL, markerScaleAtZoom, RELATION_BINDING_METRICS,
  RELATION_LANES_BELOW_DEEPEST_NODE, SHELL_ATTACHMENT_CLEARANCE, TERMINAL_ATTACHMENT_Y, TERMINAL_FONT, TERMINAL_LABEL, TERMINAL_STEM,
  TRAJECTORY_ROUTES
} from '../../replay/rendererMetrics.ts';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { TREE_ROW_HEIGHT } from '../../replay/treeSpacing.ts';
import { prepareTreeLabelRuns } from '../../replay/prepareTreeLabelRuns.ts';
import { fallbackMarkerScale, fitFallbackGeometry } from '../../replay/relations/fallbackGeometry.ts';
import { bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import { paintedShift } from '../../replay/cameraCarry.ts';
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
import * as frameLayout from '../../components/renderer/frameTreeLayout.ts';
import { createPrimitiveVisibility } from '../../components/renderer/relationVisibility.ts';
import { createTreeInkTextMeasure } from '../../components/treeInkTextMeasure.ts';
import { createTreeLabelMeasure } from '../../components/treeLabelMeasure.ts';
import { availableTreeViewport } from '../../components/treeViewport.ts';
import { layoutReplayFrames } from '../../scripts/replayFrameLayout.mjs';
import { createCameraHarness } from './cameraHarness.mjs';
import { createSvgDom } from './svgDom.mjs';
import { checkFrame, checkMarkMotion, THRESHOLDS } from './visualRules.mjs';
import { SNAPSHOT_VIEWPORT, snapshotRecord } from './layoutSnapshot.mjs';
import { buildReplayPanelContent } from '../../replay/replayPanel.ts';
import { buildReplayDisplayDetailBlocks } from '../../replay/replayPanelFormatting.ts';
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

/** The canvas, Replay header and Replay panel (styles.css: 24px from the left,
 * 16px below 640px, at most 880px wide) on screen, from the same estimates,
 * carried into tree units through a painted camera `{ x, y, k }`. */
export function frameChrome(viewport, camera, replay = true) {
  const { width, height } = viewport, obstacles = viewportObstacles(viewport, replay), left = width <= 640 ? 16 : 24;
  const toTree = ({ x, y, width: w, height: h }) => rect((x - camera.x) / camera.k, (y - camera.y) / camera.k, w / camera.k, h / camera.k);
  return { canvas: toTree(rect(0, 0, width, height)),
    header: toTree(rect(left, 24, width - left - obstacles.right, obstacles.headerBottom - 24)),
    ...(replay ? { panel: toTree(rect(left, obstacles.panelTop, Math.min(880, width - left - obstacles.right), height - 16 - obstacles.panelTop)) } : {}) };
}

// The renderer's own tree-ink and styled-label measures, reading the bundled fonts.
const measuringDocument = createMeasuringDocument();
const measureTreeInk = createTreeInkTextMeasure(measuringDocument);
const measureTreeLabel = createTreeLabelMeasure(measuringDocument);
/** The text measures layout reads, alike at every canvas. layoutWidthFindings
 * accepts others per viewport, so a control can make text follow the window. */
export const TEXT_METRICS = Object.freeze({ measurePlaqueText, measureCategoryText, measureTreeInk, measureTreeLabel });
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
    const baseline = node.y + (terminal ? TERMINAL_LABEL.baselineY : categoryLineBaselineY(index, lines.length));
    const pieces = [{ text: line, font, dx: 0, shift: 0 }];
    const indexStyle = INDEX_LABEL[terminal ? 'terminal' : 'category'];
    if (index === lines.length - 1) for (const indexRun of run.indices) pieces.push({ text: indexRun.text,
      font: { ...INDEX_FONT, size: indexStyle.fontSize }, dx: INDEX_LABEL.dx,
      shift: indexRun.mode === 'identity' ? (terminal ? 6 : 4.4) : indexStyle.thetaDy });
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

/** Polylines of an SVG path drawn with M, L, H, V, Q and C commands. */
export function pathPolylines(d) {
  const tokens = String(d || '').trim().match(/[MLHVQC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
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
    } else if (command === 'C') {
      const start = at, first = { x: number(), y: number() }, second = { x: number(), y: number() }, end = { x: number(), y: number() };
      for (let step = 1; step <= 12; step++) {
        const t = step / 12, u = 1 - t, a = u ** 3, b = 3 * u * u * t, c = 3 * u * t * t, e = t ** 3;
        to({ x: a * start.x + b * first.x + c * second.x + e * end.x, y: a * start.y + b * first.y + c * second.y + e * end.y });
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
    anchor: anchor && { x: anchor.x, y: anchor.y + (!anchor.children?.length && anchor.data.word ? TERMINAL_ATTACHMENT_Y : 0) } };
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
const paintedSyntax = (tree, visible) => tree.descendants().filter(node => !isUnderTriangulation(node)
  && !canvas.isSyntheticWorkspaceRootNode(node) && (!visible || visible.has(display.getNodeId(node))));

function paintedTree(tree, visible, runsFor) {
  const nodes = paintedSyntax(tree, visible);
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
      lines.push({ id: `${id}:stem`, kind: 'stem', paths: [[{ x: node.x, y: node.y + TERMINAL_STEM.topY }, { x: node.x, y: node.y + TERMINAL_STEM.bottomY }]],
        halfWidth: TERMINAL_STEM.strokeWidth / 2, nodes: [id], claims: [] });
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
export function layoutMeasuredScenes(visual, { width, height }, metrics = TEXT_METRICS) {
  // Callers only read the result, so the default-metrics layout is shared between
  // the frame audit and layoutWidthFindings' reference viewport.
  const key = metrics === TEXT_METRICS ? `${width}x${height}` : null;
  const cache = key && (MEASURED_SCENES.get(visual) ?? MEASURED_SCENES.set(visual, new Map()).get(visual));
  if (cache?.has(key)) return cache.get(key);
  const result = layoutMeasuredScenesUncached(visual, { width, height }, metrics);
  cache?.set(key, result);
  return result;
}
const MEASURED_SCENES = new WeakMap();

function layoutMeasuredScenesUncached(visual, { width, height }, metrics) {
  const { prepared } = visual;
  return layoutReplayFrames({ steps: prepared.playbackSteps, stages: prepared.replayDerivationFrames, width, height,
    direction: visual.direction, measured: { plan: prepared.relationRenderPlan, protectedNodeIds: visual.protectedNodeIds,
      treeLabelRuns: visual.treeLabelRuns, pocketOccupants: true, ...metrics } }, MODULES);
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
      const pockets = camera.replayPocketOccupants(scene.schedule, stepIndex);
      const marks = relationGeometry({ visual, step, stepIndex, tree, painted, plan, schedule: scene.schedule, fitted, runs, pockets });
      const frame = { frame: stepIndex + 1, viewport: viewport.name, zoom: fitted.k, rowHeight: TREE_ROW_HEIGHT, stage, painted: paintedNodes(painted.nodes), texts: [...painted.texts, ...marks.texts],
        chrome: frameChrome(viewport, harness.session.cameraRuntime.deferred),
        plaques: marks.plaques, lines: [...painted.lines, ...marks.lines], marks: marks.marks };
      // mark-motion alone reads them, for few frames; build them on first read.
      let reserves;
      return Object.defineProperty(frame, 'reserves', { enumerable: true, get: () => reserves ??= pockets?.occupants() ?? [] });
    });
  });
}

/** Plaques, neutral role labels and connectors, bound as paintRelationScene
 * binds them for this step and refit at the Fit as fitFallbackOverlays does,
 * and `marks`: every other revealed relation mark as bound (arrows, badges,
 * lenses, shapes), for the layoutSnapshot.mjs fingerprint. */
function relationGeometry({ visual, step, stepIndex, tree, painted, plan, schedule, fitted, runs, pockets }) {
  const stage = step.replayFrameIndex, none = { texts: [], plaques: [], lines: [], marks: [] };
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
      return !terminal ? null : cell ? { x: cell.x + cell.width / 2, y: cell.y + cell.height + SHELL_ATTACHMENT_CLEARANCE.bottom }
        : { x: terminal.x, y: terminal.y + TERMINAL_ATTACHMENT_Y };
    }
    if (attachment === 'parent') return anchor.parent ? { x: anchor.parent.x, y: anchor.parent.y } : null;
    const cell = cells.get(`${display.getNodeId(anchor)}:category`);
    const { top, bottom } = SHELL_ATTACHMENT_CLEARANCE;
    if (attachment === 'shell-top') return cell ? { x: cell.x + cell.width / 2, y: cell.y - top } : { x: anchor.x, y: anchor.y - top };
    if (attachment === 'shell-bottom') return cell ? { x: cell.x + cell.width / 2, y: cell.y + cell.height + bottom } : { x: anchor.x, y: anchor.y + bottom };
    return { x: anchor.x, y: anchor.y };
  };
  const placements = projectPlaqueLayout(camera.selectReplayPlaqueLayout(schedule, stage, stepIndex), id => laidOut.get(id) ?? null);
  const items = projectVisibleAnchorSetOrganization(plan.frames[stage].items.map(item => resolveDisplayedTrajectoryAttachments(
    projectThetaGrid(item, stage, played), id => overlay.get(id)?.data, { stageIndex: stage, playedRelationIndices: played })),
  item => isPlanItemRevealed(item, stage, played, active) && planItemDependencyNodeIds(item).every(id => Boolean(resolveOverlayAnchor(id))));
  const revealed = new Set(items.flatMap((item, index) => isPlanItemRevealed(item, stage, played, active) ? [index] : []));
  const shown = index => revealed.has(index) && planItemDependencyNodeIds(items[index]).every(id => Boolean(resolveOverlayAnchor(id)));
  const visiblePlacements = [...placements].filter(([index]) => items[index] && shown(index));
  const plaques = visiblePlacements.map(([index, box]) => ({ ...plaqueRecord(items[index], box, laidOut.get(box.attachmentNodeId)),
    ...pockets ? { key: pockets.owner(index), pocket: pockets.pocket(index) } : {} }));
  const markerScale = markerScaleAtZoom(fitted.k), maxY = d3.max(all, node => node.y) ?? 0;
  const textTop = d3.min(painted.texts, text => text.cell.y) ?? TRAJECTORY_ROUTES.textTopFallbackY;
  const lanes = RELATION_LANES_BELOW_DEEPEST_NODE;
  const runText = (id, text) => (runs.get(id) ?? []).some(run => run.text + run.indices.map(index => index.text).join('') === text);
  const bind = extra => bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, index) => index === stage ? { ...frame, items } : frame) },
    stage, positionFor, { ...RELATION_BINDING_METRICS, markerScale,
      hasExistingGapNotation: runText, plaqueTextLayout: { measureText: measurePlaqueText }, isItemRevealed: index => revealed.has(index),
      trajectoryCeilingY: textTop - TRAJECTORY_ROUTES.ceilingAboveTextTop, trajectoryFloorY: maxY + lanes.trajectoryFloor,
      connectorBaselineY: maxY + lanes.connectorBaseline, railBaseY: maxY + lanes.railBase, direction: visual.direction, ...extra });
  const drawable = createPrimitiveVisibility(items, resolveOverlayAnchor);
  const shownMarks = bound => bound.primitives.filter(primitive => revealed.has(primitive.itemIndex) && drawable(primitive));
  if (!items.some(item => item.kind === 'fallback')) return { ...none, plaques, marks: boundMarks(shownMarks(bind({})), items) };
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
  const bound = bind({ fallbackMeasurements, separateFallbackMoments: true });
  const scale = fallbackMarkerScale(fitted.k, fallbackMeasurements.labels.map(value => value.height));
  // measureRelationInkObstacles reserves filled plaque shells with five units of padding.
  const refit = fitFallbackGeometry(bound, { markerScale, fittedMarkerScale: scale, fittedAnchorScale: markerScaleAtZoom(fitted.k), direction: visual.direction,
    badgeGap: RELATION_BINDING_METRICS.badgeGap, laneGap: RELATION_BINDING_METRICS.laneGap, fallbackMeasurements, railBaseY: maxY + lanes.railBase, separateFallbackMoments: true, fittedViewport: fitted.view,
    relationInkObstacles: plaques.map(({ rect: shell }) => rect(shell.x - 5, shell.y - 5, shell.width + 10, shell.height + 10)) });
  const marks = shownMarks(bound);
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
  return { texts, plaques, lines, marks: boundMarks(marks, items) };
}

/** Every bound mark except plaques, neutral role labels and connectors (recorded
 * above as plaques, texts and lines), as plain data: hierarchy nodes and
 * functions are dropped and repeated references kept once. Ids name the mark's
 * type, claims and occurrence, so a comparison can pair them across checkouts. */
function boundMarks(primitives, items) {
  const counts = new Map();
  return primitives.filter(primitive => !['plaque', 'fallback-mark', 'segment'].includes(primitive.type)).map(primitive => {
    const base = `${primitive.type}(${refsOf(items[primitive.itemIndex]).join('/')})`, n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const seen = new WeakSet();
    const data = JSON.parse(JSON.stringify(primitive, (key, value) => {
      if (typeof value === 'function' || value && typeof value === 'object' && 'parent' in value && 'data' in value) return undefined;
      if (value && typeof value === 'object') { if (seen.has(value)) return undefined; seen.add(value); }
      return value;
    }));
    return { id: `${base}#${n}`, ...data };
  });
}

/** The Canopy tree: the final stage's forest at the places of the last Replay
 * frame, as TreeVisualizer and drawTreeFrame place it. A record without Replay
 * is laid out fresh, as drawTreeFrame lays out a frame without a stage size;
 * the canvas goes where the renderer once passed it, so a layout size that
 * reads it again is reported by layoutWidthFindings. A last frame that cannot
 * place the Canopy is a layout fault, reported as an error. */
function layoutCanopyTree(visual, viewport, metrics = TEXT_METRICS) {
  const data = canvas.buildDerivationCanvasData(visual.record.derivationStages.at(-1)?.workspaceForest ?? []);
  if (!data) return null;
  const canopy = canvas.buildRenderableCommittedCanvasData(data);
  const root = d3.hierarchy(canopy); display.applyVizIds(root);
  const { playbackSteps: steps, replayDerivationFrames: stages } = visual.prepared;
  const measurements = { measureCategoryText: metrics.measureCategoryText, measureTreeInk: metrics.measureTreeInk };
  if (!steps.at(-1)?.replayCanvasData || !stages.length) return layout.layoutSyntaxTree(root,
    camera.treeLayoutSize(root.descendants().length, root.height, viewport.width, viewport.height), visual.direction, undefined, undefined, measurements);
  const scene = layoutMeasuredScenes(visual, viewport, metrics);
  const frame = frameLayout.selectCanopyReplayFrame(steps, scene.coordinates, viewport, scene.groups);
  const places = frame && frameLayout.canopyPlacesInReplayFrame(canopy, frame, visual.direction, measurements);
  if (!places) throw Error('Could not lay out this tree: the last Replay frame cannot place the Canopy');
  return frameLayout.placeCanopy(root, places);
}

/** The Canopy's painted tree and its box `{ x, y, width, height }` in tree
 * units: the text cells and branches the renderer's getBBox reads. */
export function layoutCanopyPainted(visual, viewport) {
  const tree = layoutCanopyTree(visual, viewport);
  if (!tree) return null;
  const painted = paintedTree(tree, null, () => undefined);
  const box = union([...painted.texts.map(text => text.cell), ...painted.lines.flatMap(line => line.paths.flat().map(p => rect(p.x, p.y, 0, 0)))]);
  return { tree, painted, box };
}

/** The Canopy: the final stage's forest without relation marks, fitted to its
 * painted bounds as fitTreeCamera fits the Canopy, with no minimum scale. */
export function layoutCanopyVisualFrame(visual, viewport) {
  const canopy = layoutCanopyPainted(visual, viewport);
  if (!canopy) return null;
  const { painted, box } = canopy;
  const view = availableTreeViewport(viewport.width, viewport.height, viewportObstacles(viewport, false));
  const zoom = Math.min((view.right - view.left) / box.width, (view.bottom - view.top) / box.height, 1);
  const pose = { x: (view.left + view.right) / 2 - (box.x + box.width / 2) * zoom, y: (view.top + view.bottom) / 2 - (box.y + box.height / 2) * zoom, k: zoom };
  return { frame: 'canopy', viewport: viewport.name, zoom, rowHeight: TREE_ROW_HEIGHT, painted: paintedNodes(painted.nodes),
    texts: painted.texts, plaques: [], lines: painted.lines, chrome: frameChrome(viewport, pose, false) };
}

/** canopy-final-frame: the Canopy is the last Replay frame without its
 * relation marks. It paints the same syntax at the same places; only the camera
 * may differ, so in tree units the two agree up to one translation. `canopy` is
 * the Canopy's painted nodes and `frame` the last frame's, a Map from display
 * ID. A Canopy node is that frame's node of the same ID or alias. Findings
 * follow tests/helpers/findings.mjs without `record` and `viewport`; `measure`
 * is the larger of the horizontal and vertical displacement in tree units. */
export function compareCanopyToFinalFrame(canopy, frame) {
  const occurrences = canvas.indexHierarchyNodesByIdAndAliases([...frame.values()]), shown = new Set(), findings = [];
  const finding = (subtype, subject, measure, detail) => ({ rule: 'canopy-final-frame', subtype, subject, frame: 'canopy', measure, detail });
  let offset;
  for (const node of canopy) {
    const id = display.getNodeId(node), occurrence = occurrences.get(id);
    if (!occurrence) { findings.push(finding('unmatched', id, null, `${id} is not in the last Replay frame`)); continue; }
    shown.add(display.getNodeId(occurrence));
    offset ??= { x: node.x - occurrence.x, y: node.y - occurrence.y };
    const dx = node.x - occurrence.x - offset.x, dy = node.y - occurrence.y - offset.y;
    const measure = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) * 100) / 100;
    if (measure > 0.01) findings.push(finding('moved', id, measure, `${id} is ${dx.toFixed(2)}, ${dy.toFixed(2)} from its place in the last frame`));
  }
  for (const id of frame.keys()) if (!shown.has(id)) findings.push(finding('unpainted', id, null, `the Canopy does not paint ${id}`));
  return findings;
}

/** canopy-final-frame at one viewport. It reuses the viewport's measured Replay
 * layout, so a pass that laid out the frames adds only the Canopy's placement. */
export function canopyFinalFrameFindings(visual, viewport) {
  const { playbackSteps: steps, replayDerivationFrames: stages } = visual.prepared;
  if (!steps.length || !stages.length) return [];
  const last = layoutMeasuredScenes(visual, viewport).scenes.at(-1), tree = layoutCanopyTree(visual, viewport);
  if (!tree) return [{ rule: 'canopy-final-frame', subtype: 'unpainted', subject: 'canopy', frame: 'canopy', measure: null,
    detail: 'the last Replay frame has no Canopy' }];
  return compareCanopyToFinalFrame(paintedSyntax(tree, null), last.nodes);
}

/** layout-width: layout must not read the window. Each other viewport lays out
 * every Replay frame and the Canopy as the first viewport does, up to one
 * translation per stage, which the camera absorbs; the Canopy counts as one
 * stage. Each stage reports its worst node, in tree units, per viewport pair.
 * `metrics(viewport)` gives the text measures (TEXT_METRICS by default). */
export function layoutWidthFindings(visual, viewports, { canopy = true, metrics = () => TEXT_METRICS } = {}) {
  if (viewports.length < 2) return [];
  const { playbackSteps: steps, replayDerivationFrames: stages } = visual.prepared;
  const positions = viewport => {
    const frames = steps.length && stages.length ? layoutMeasuredScenes(visual, viewport, metrics(viewport)).scenes
      .map((scene, index) => ({ frame: index + 1, stage: scene.step.replayFrameIndex, nodes: scene.nodes })) : [];
    const tree = canopy && layoutCanopyTree(visual, viewport, metrics(viewport));
    if (tree) frames.push({ frame: 'canopy', stage: 'canopy', nodes: new Map(tree.descendants().map(node => [display.getNodeId(node), node])) });
    return frames;
  };
  const [reference, ...others] = viewports, base = positions(reference);
  return others.flatMap(viewport => {
    const worst = new Map(), offsets = new Map();
    positions(viewport).forEach(({ frame, stage, nodes }, index) => {
      for (const [id, node] of base[index].nodes) {
        const other = nodes.get(id);
        if (!other) continue;
        if (!offsets.has(stage)) offsets.set(stage, other.x - node.x);
        const measure = Math.round(Math.max(Math.abs(other.x - node.x - offsets.get(stage)), Math.abs(other.y - node.y)) * 10) / 10;
        if (measure > 0.5 && measure > (worst.get(stage)?.measure ?? 0)) worst.set(stage, { rule: 'layout-width',
          subtype: 'beyond-stage-translation', subject: id, frame, viewport: `${reference.name}~${viewport.name}`, measure });
      }
    });
    return [...worst.values()];
  });
}

/** A frame's painted syntax for the camera carry (replay/cameraCarry.ts). */
const paintedNodes = nodes => new Map(nodes.map(node => [display.getNodeId(node),
  { x: node.x, y: node.y, parentId: node.parent ? display.getNodeId(node.parent) : null }]));

/** mark-motion between each pair of adjacent Replay frames of one viewport, with
 * the camera's carry across a stage boundary. */
export function markMotionFindings(frames, thresholds = THRESHOLDS) {
  const byPlace = new Map(frames.filter(frame => typeof frame.frame === 'number').map(frame => [`${frame.viewport} ${frame.frame}`, frame]));
  return [...byPlace.values()].flatMap(frame => {
    const before = byPlace.get(`${frame.viewport} ${frame.frame - 1}`);
    const shift = before && before.stage !== frame.stage && before.painted && frame.painted ? paintedShift(before.painted, frame.painted) : undefined;
    return checkMarkMotion(before, frame, thresholds, shift && { dx: shift.x, dy: shift.y });
  });
}

/** One record's findings: every Replay frame at each viewport and the Canopy.
 * `visual` may be the record's prepareVisualRecord result shared with another
 * audit; this audit only reads it. With `snapshot`, the result also carries the
 * record's layoutSnapshot.mjs fingerprint, which needs the desktop viewport. */
export function auditVisualRecord(id, record, { viewports = VIEWPORTS, canopy = true, thresholds = THRESHOLDS,
  visual = prepareVisualRecord(record), snapshot = false } = {}) {
  const frames = layoutVisualFrames(visual, viewports);
  if (canopy) frames.push(...viewports.map(viewport => layoutCanopyVisualFrame(visual, viewport)).filter(Boolean));
  return { steps: visual.prepared.playbackSteps.length, frames: frames.length,
    findings: [...frames.flatMap(frame => checkFrame(frame, thresholds)), ...markMotionFindings(frames, thresholds),
      ...layoutWidthFindings(visual, viewports, { canopy })]
      .map(finding => ({ ...finding, record: id })),
    ...(snapshot ? { snapshot: snapshotVisualRecord(visual, frames.filter(frame => frame.viewport === SNAPSHOT_VIEWPORT)) } : {}) };
}

/** The layoutSnapshot.mjs fingerprint of a prepared record, from its desktop
 * frames when the caller already laid them out. */
export function snapshotVisualRecord(visual, desktopFrames = null) {
  const viewport = VIEWPORTS.find(({ name }) => name === SNAPSHOT_VIEWPORT);
  const frames = desktopFrames ?? [...layoutVisualFrames(visual, [viewport]), layoutCanopyVisualFrame(visual, viewport)].filter(Boolean);
  if (!frames.length && visual.prepared.playbackSteps.length) throw Error(`The snapshot needs the ${SNAPSHOT_VIEWPORT} viewport`);
  return snapshotRecord(visual, frames.filter(frame => frame.frame !== 'canopy'), frames.find(frame => frame.frame === 'canopy') ?? null,
    { buildReplayPanelContent, buildReplayDisplayDetailBlocks });
}
