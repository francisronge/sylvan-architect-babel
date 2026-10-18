/** Offline laid-out frames for the visual invariants (tests/helpers/visualInvariants.mjs).
 *
 * Each Replay frame follows the browser's own order: Replay preparation, the
 * plaque worker job (measure, run, bind), the stage tree layout with its
 * reserved coordinates, the step's plaque schedule, the stage camera bounds and
 * Fit, and the relation binder with its neutral-label refit at that Fit. Only
 * the DOM reads are replaced: text is measured from the bundled fonts
 * (visualFontMetrics.mjs), so painted label boxes, relation ink and the camera
 * are close to, but not identical with, a native capture.
 *
 * A frame lists painted geometry in tree units: `labels` (category labels and
 * words with their index runs), `stems`, `branches`, `plaques`, `roles`
 * (neutral role labels) and `connectors` (neutral links and fan spokes), plus
 * the Fit `zoom` that converts tree units to CSS pixels. */
import * as d3 from 'd3';
import { CATEGORY_FONT, CATEGORY_LINE_HEIGHT, categoryTextLayout } from '../../replay/categoryTextLayout.ts';
import { applyVizIds, getNodeId } from '../../replay/displayIdentity.ts';
import { bindPlaqueLayoutResult, measurePlaqueLayoutJob, runPlaqueLayoutJob } from '../../replay/plaqueLayoutJob.ts';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { prepareTreeLabelRuns } from '../../replay/prepareTreeLabelRuns.ts';
import { fallbackLabelRect, fallbackMarkerScale, fitFallbackGeometry } from '../../replay/relations/fallbackGeometry.ts';
import { bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import { projectPlaqueLayout } from '../../replay/relations/plaquePlacement.ts';
import { projectVisibleAnchorSetOrganization } from '../../replay/relations/relationFrame.ts';
import {
  isPlanItemRevealed, planItemDependencyNodeIds, planItemRelationRefs, resolveDisplayedTrajectoryAttachments
} from '../../replay/relations/renderPlan.ts';
import { projectThetaGrid } from '../../replay/relations/thetaGridComposition.ts';
import { resolveUniqueDisplayTerminal } from '../../replay/relations/trajectoryAttachment.ts';
import {
  buildDerivationCanvasData, buildRenderableCommittedCanvasData, buildRenderableDerivationCanvasData,
  indexHierarchyNodesByIdAndAliases, isSyntheticWorkspaceRootNode
} from '../../replay/replayCanvas.ts';
import {
  isDisplayTerminalNode, isWordlessCategoryLeaf, resolveLeafSurface, shouldExpandPreterminalLeaf
} from '../../replay/replaySurfaceNotation.ts';
import {
  buildStageCameraBounds, buildStageLayoutGroups, selectReplayPlaqueLayout, STAGE_CAMERA_PADDING,
  stageTreeLayoutSize, treeLayoutSize
} from '../../replay/stageCamera.ts';
import { cloneSyntaxTree } from '../../replay/syntaxForest.ts';
import { layoutSyntaxTree } from '../../replay/treeLayout.ts';
import { treeLabelRunsForStep } from '../../replay/treeLabelRuns.ts';
import { buildMovementProtectedNodeIds, isUnderTriangulation } from '../../replay/triangulation.ts';
import { createPrimitiveVisibility } from '../../components/renderer/relationVisibility.ts';
import { alignReplayUnaryTerminalLeaves } from '../../components/renderer/treeNotation.ts';
import { createTreeInkTextMeasure, TERMINAL_FONT } from '../../components/treeInkTextMeasure.ts';
import { createTreeLabelMeasure } from '../../components/treeLabelMeasure.ts';
import { availableTreeViewport, containCamera } from '../../components/treeViewport.ts';
import {
  createMeasuringDocument, measureCategoryText, measurePlaqueText, measureRun, parseFont
} from './visualFontMetrics.mjs';

/** Browser windows the audit fits. The tree canvas sits below the app bar: a
 * 1600×1000 capture measured a 1596×876 canvas. The Replay header, panel
 * (styles.css: `height: min(260px, 40%)`, at least 148px) and right-hand
 * controls are the obstacles TreeVisualizer measures for fitting; with these
 * estimates the Fit of that capture is reproduced within 1.1%. The mobile
 * canvas and controls have not been checked against a capture. */
export const VIEWPORTS = Object.freeze([
  { name: 'desktop', window: [1440, 900] },
  { name: 'desktop-large', window: [2560, 1440] },
  { name: 'mobile', window: [390, 844] }
].map(({ name, window: [width, height] }) => Object.freeze({ name, width: width - 4, height: height - 124 })));

export function viewportObstacles({ width, height }, replay) {
  const panel = Math.max(148, Math.min(260, 0.4 * height, height - 100));
  return { top: 0, right: width < 500 ? 16 : 100, bottom: 16, headerBottom: replay ? 66 : 42,
    panelTop: replay ? height - 16 - panel : Infinity };
}

// TreeVisualizer: plans whose accepted compositions draw over the tree first.
const TREE_FIRST_FAMILIES = new Set(['copy.multiple-pronunciation', 'copy.partial-deletion', 'multidominance.shared-node',
  'argument-sharing.domains', 'pf.phrasal-spellout', 'pf.correspondence', 'pf.fission', 'pf.impoverishment',
  'pf.local-dislocation', 'pf.cyclic-linearization', 'cooper-storage.ledger', 'scope.operator-variable', 'accord.link',
  'accord.strong-npi', 'focus.prominence', 'focus.f-projection', 'theta.grid']);

// The first strong character decides the browser's `dir="auto"`.
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
export const treeDirection = sentence => {
  const strong = [...String(sentence ?? '')].find(char => /\p{L}/u.test(char));
  return strong && RTL.test(strong) ? 'rtl' : 'ltr';
};

// The renderer's own tree-ink and styled-label measures, reading the bundled fonts.
const document = createMeasuringDocument();
const measureTreeInk = createTreeInkTextMeasure(document);
const measureTreeLabel = createTreeLabelMeasure(document);

const rect = (x, y, width, height) => ({ x, y, width, height });
const union = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return rect(x, y, Math.max(...rects.map(r => r.x + r.width)) - x, Math.max(...rects.map(r => r.y + r.height)) - y);
};
const isCategory = node => Boolean(node.children?.length) || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data);
const isTerminal = node => !node.children?.length && !isWordlessCategoryLeaf(node.data);
const INDEX_FONT = { family: 'Crimson Pro', italic: true, weight: 900 };

/** Painted label geometry: `boxes` holds one glyph box per painted line and
 * per index run, `ink` their union, and `cell` the SVG text box the renderer
 * measures (font cells). Index runs follow treeLabelIndexAttributes: dx 5, a
 * subscript shift or a theta dy. Separate boxes keep the empty corner beside a
 * short line or below a word next to its lowered index out of the glyphs. */
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
    const width = measured.reduce((sum, piece) => sum + piece.dx + piece.run.width, 0);
    let pen = node.x - width / 2;
    for (const piece of measured) {
      pen += piece.dx;
      const y = baseline + piece.shift;
      cells.push(rect(pen, y - piece.run.fontAscent, piece.run.width, piece.run.fontAscent + piece.run.fontDescent));
      if (piece.run.right > piece.run.left) boxes.push(rect(pen + piece.run.left, y - piece.run.ascent,
        piece.run.right - piece.run.left, piece.run.ascent + piece.run.descent));
      pen += piece.run.width;
    }
  });
  return { boxes, ink: boxes.length ? union(boxes) : null, cell: union(cells), lines };
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

/** Straight pieces of an SVG path drawn with M, L, H, V and Q commands. */
export function pathPieces(d) {
  const tokens = String(d || '').trim().match(/[MLHVQ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const pieces = [];
  let at = null, index = 0;
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') at = { x: number(), y: number() };
    else if (command === 'L') { const next = { x: number(), y: number() }; pieces.push([at, next]); at = next; }
    else if (command === 'H') { const next = { x: number(), y: at.y }; pieces.push([at, next]); at = next; }
    else if (command === 'V') { const next = { x: at.x, y: number() }; pieces.push([at, next]); at = next; }
    else if (command === 'Q') {
      const control = { x: number(), y: number() }, end = { x: number(), y: number() };
      let previous = at;
      for (let step = 1; step <= 12; step++) {
        const t = step / 12, u = 1 - t;
        const point = { x: u * u * at.x + 2 * u * t * control.x + t * t * end.x, y: u * u * at.y + 2 * u * t * control.y + t * t * end.y };
        pieces.push([previous, point]); previous = point;
      }
      at = end;
    } else throw Error(`Unsupported path command ${command} in ${d}`);
  }
  return pieces;
}

/** The allocator's nearby pockets for a proximity plaque (plaquePlacement.ts,
 * placeStagePlaques): three columns at six heights around the anchor, measured
 * from a word-bearing leaf's word. Returns the farthest pocket's centre distance. */
export function plaqueNearbyReach(anchor, width, height) {
  const anchorY = anchor.y + (!anchor.children?.length && anchor.data.word ? 140 : 0);
  let reach = 0;
  for (const dy of [-height - 60, -height / 2, 55, 115, 175, 235]) for (const x of [anchor.x + 110, anchor.x - width - 110, anchor.x - width / 2])
    reach = Math.max(reach, Math.hypot(x + width / 2 - anchor.x, anchorY + dy + height / 2 - anchorY));
  return { reach, anchorY };
}

const relationKey = item => planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`).join('/');

/** One painted plaque: its shell at the projected placement, and its distance
 * from the anchor as the allocator measures it. Plaques with their own Case
 * arrow or collector (`connector`) and large plaques placed below their
 * subtree by design (`local` false) are not held to the nearby reach. */
export function plaqueRecord(item, box, anchor) {
  const width = box.drawnWidth ?? box.width, height = box.drawnHeight ?? box.height;
  const theta = item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid';
  const text = item.kind === 'node-plaque' ? (theta ? `theta ${(item.thetaRoles ?? []).map(role => role.role ?? role.label).join('/')}`
    : (item.rows ?? []).map(row => `${row.label}: ${row.value}`).join('; ')) : `${item.kind} ${item.pathStyle ?? ''}`.trim();
  const { reach, anchorY } = anchor ? plaqueNearbyReach(anchor, box.width, box.height) : { reach: Infinity, anchorY: 0 };
  // Identities hold across frames; plan item indices do not.
  return { id: `plaque(${relationKey(item)} ${text.slice(0, 48)})@${box.attachmentNodeId}`, relation: relationKey(item),
    anchorId: box.attachmentNodeId, text, rect: rect(box.x, box.y, width, height), theta,
    local: Math.max(box.width, box.height) <= 480 || (theta && box.height <= 480),
    connector: item.kind === 'directed-path' || Boolean(box.collectionRows?.length),
    anchor: anchor ? { x: anchor.x, y: anchorY } : null, reach,
    distance: anchor ? Math.hypot(box.x + box.width / 2 - anchor.x, box.y + box.height / 2 - anchorY) : 0 };
}

/** The neutral role placer's preferred spots (fallbackGeometry.ts,
 * placeFallbackMark), including its viewport alternatives above and below. */
export function roleNearbyReach(mark, scale) {
  const r = mark.labelRect, gap = (mark.textWidth / 2 + 7) * scale, center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const spots = [{ x: r.x + r.width + gap, y: center.y }, { x: r.x - gap, y: center.y }, { x: center.x, y: r.y - 15 * scale },
    { x: r.x + r.width + gap, y: r.y - 15 * scale }, { x: r.x - gap, y: r.y - 15 * scale }, { x: center.x, y: r.y + r.height + 15 * scale }];
  return { center, reach: Math.max(...spots.map(spot => Math.hypot(spot.x - center.x, spot.y - center.y))) };
}

const drain = iterator => { let next = iterator.next(); while (!next.done) next = iterator.next(); return next.value; };

/** Replay preparation shared by every viewport of one record. */
export function prepareVisualRecord(record) {
  const prepared = prepareReplay({ derivationStages: structuredClone(record.derivationStages), sentence: record.sentence,
    inputTokens: record.inputTokens, includePlayback: true });
  const runs = new Map();
  return {
    record, prepared, direction: treeDirection(record.sentence),
    treeLabelRuns: prepareTreeLabelRuns(prepared, measureCategoryText, { includeRelationIndices: true }),
    protectedNodeIds: buildMovementProtectedNodeIds(prepared.committedDerivationVisualLinks),
    stepRuns(index) {
      if (!runs.has(index)) runs.set(index, treeLabelRunsForStep(prepared, index, measureCategoryText, { includeRelationIndices: true }));
      return runs.get(index);
    }
  };
}

const firstRun = (runs, kind) => runs?.find(run => run.kind === kind);

/** Tree material painted by paintSyntaxTree for one laid-out frame. */
function paintedTree(tree, visible, runsFor) {
  const nodes = tree.descendants().filter(node => !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
    && (!visible || visible.has(getNodeId(node))));
  const shown = new Set(nodes);
  const labels = [], stems = [], branches = [];
  for (const node of nodes) {
    const id = getNodeId(node), runs = runsFor(node);
    if (isCategory(node)) {
      const run = firstRun(runs, 'category') ?? { kind: 'category', text: node.data.label || '', lines: categoryTextLayout(node.data.label || '', measureCategoryText).lines, indices: [] };
      const geometry = labelGeometry(node, run);
      if (geometry.ink) labels.push({ id: `${id}:category`, node: id, kind: 'category', text: run.text, lines: geometry.lines,
        indices: run.indices.map(index => index.text), boxes: geometry.boxes, ink: geometry.ink, cell: geometry.cell, halo: 5 });
    }
    if (isTerminal(node)) {
      const run = firstRun(runs, 'terminal') ?? { kind: 'terminal', text: resolveLeafSurface(node).trim(), indices: [] };
      const geometry = labelGeometry(node, run);
      if (geometry.ink) labels.push({ id: `${id}:word`, node: id, kind: 'word', text: run.text,
        indices: run.indices.map(index => index.text), boxes: geometry.boxes, ink: geometry.ink, cell: geometry.cell, halo: 4 });
      stems.push({ id: `${id}:stem`, node: id, points: [{ x: node.x, y: node.y + 20 }, { x: node.x, y: node.y + 65 }] });
    }
    if (node.parent && shown.has(node.parent))
      branches.push({ id: `${getNodeId(node.parent)}->${id}`, parent: getNodeId(node.parent), child: id,
        points: branchPoints(node.parent, node) });
  }
  return { nodes, labels, stems, branches };
}

/** Fit as fitTreeCamera computes it for a fresh frame (no retained manual or
 * advanced pose): stage camera bounds when Replay has them, else painted bounds. */
function fitCamera(bounds, viewport, obstacles, minimum, containment) {
  const view = availableTreeViewport(viewport.width, viewport.height, obstacles);
  const availableWidth = Math.max(1, view.right - view.left), availableHeight = Math.max(1, view.bottom - view.top);
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX + 2 * STAGE_CAMERA_PADDING.x);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY + 2 * STAGE_CAMERA_PADDING.y);
  const k = Math.max(minimum, Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1));
  let transform = { x: view.left + availableWidth / 2 - (bounds.minX + bounds.maxX) / 2 * k,
    y: view.top + availableHeight / 2 - (bounds.minY + bounds.maxY) / 2 * k, k };
  if (containment) transform = containCamera(transform, containment, view);
  return { ...transform, view };
}

/** Every painted Replay frame of one record at each viewport. Layout depends
 * on the viewport only through the stage layout sizes, so viewports with equal
 * sizes share one plaque job, tree layout and stage camera bounds; each still
 * gets its own Fit and neutral-label refit. */
export function layoutReplayVisualFrames(visual, viewports = VIEWPORTS, { steps: only } = {}) {
  const { prepared } = visual;
  const steps = prepared.playbackSteps, stages = prepared.replayDerivationFrames;
  if (!steps.length || !stages.length) return [];
  const layoutGroups = buildStageLayoutGroups(steps, stages);
  const shared = new Map();
  for (const viewport of [viewports].flat()) {
    const key = JSON.stringify(stages.map((_, stage) => stageTreeLayoutSize(steps, stage, viewport.width, viewport.height, layoutGroups)));
    if (!shared.has(key)) shared.set(key, []);
    shared.get(key).push(viewport);
  }
  return [...shared.values()].flatMap(group => layoutGroupFrames(visual, group, layoutGroups, only));
}

function layoutGroupFrames(visual, viewports, layoutGroups, only) {
  const { prepared, direction, treeLabelRuns, protectedNodeIds } = visual;
  const steps = prepared.playbackSteps, plan = prepared.relationRenderPlan, stages = prepared.replayDerivationFrames;
  const { width, height } = viewports[0];
  const completedCanvas = buildRenderableDerivationCanvasData(stages.at(-1).workspaceForest || []);
  const input = { steps, stageIndex: 0, completedCanvas, plan, width, height, direction, abstractionMode: false,
    protectedNodeIds, layoutGroups, measurePlaqueText, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel };
  const job = drain(measurePlaqueLayoutJob(input));
  const { schedule, coordinates } = bindPlaqueLayoutResult(input, job, runPlaqueLayoutJob(job));
  const cameras = new Map();
  const frames = [];
  steps.forEach((step, stepIndex) => {
    if (only && !only.includes(stepIndex + 1)) return;
    const stage = step.replayFrameIndex, canvas = step.replayCanvasData;
    if (!canvas || !Number.isInteger(stage)) return;
    const size = stageTreeLayoutSize(steps, stage, width, height, layoutGroups);
    const stageCoordinates = coordinates.get(stage)?.get(canvas);
    const visible = step.replayVisibleNodeIds?.length ? new Set(step.replayVisibleNodeIds.map(String)) : null;
    const root = d3.hierarchy(cloneSyntaxTree(canvas)); applyVizIds(root);
    const tree = layoutSyntaxTree(root, size ?? treeLayoutSize(root.descendants().length, root.height, width, height), direction,
      stageCoordinates, stageCoordinates ? visible ?? undefined : undefined, { measureCategoryText, measureTreeInk });
    alignReplayUnaryTerminalLeaves(tree, visible);
    const runs = visual.stepRuns(stepIndex);
    const painted = paintedTree(tree, visible, node => runs.get(getNodeId(node)));
    // Camera: one stage-wide fit, except the completed final frame.
    const completedReplayStep = stepIndex === steps.length - 1 && step.replayKind === 'macro' ? stepIndex : undefined;
    const items = plan?.frames[stage]?.items ?? [];
    const treeFirst = items.some(item => TREE_FIRST_FAMILIES.has(item.familyId));
    const cameraKey = `${stage}:${completedReplayStep}`;
    if (!cameras.has(cameraKey)) {
      const stagePlaqueLayout = selectReplayPlaqueLayout(schedule, stage);
      const common = { steps, stageIndex: stage, stepIndex: completedReplayStep,
        completedCanvas: buildRenderableDerivationCanvasData(stages[stage].workspaceForest || []), plan, width, height, direction,
        abstractionMode: false, protectedNodeIds, plaqueLayout: stagePlaqueLayout, plaqueSchedule: schedule, coordinates,
        layoutGroups, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel };
      const bounds = buildStageCameraBounds({ ...common, includeOverlays: !treeFirst });
      const containment = bounds && (treeFirst || items.some(item => item.kind === 'binding-domain'))
        ? buildStageCameraBounds({ ...common, includeOverlays: false, includePlaques: true, includeBindingDomains: true }) : null;
      cameras.set(cameraKey, { bounds, containment });
    }
    const { bounds, containment } = cameras.get(cameraKey);
    const fitBounds = bounds ?? (() => {
      const xs = painted.nodes.map(node => node.x), ys = painted.nodes.map(node => node.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) + 130 };
    })();
    const stageFit = containment && bounds ? {
      minX: Math.min(containment.minX, bounds.minX - STAGE_CAMERA_PADDING.x), maxX: Math.max(containment.maxX, bounds.maxX + STAGE_CAMERA_PADDING.x),
      minY: Math.min(containment.minY, bounds.minY - STAGE_CAMERA_PADDING.y), maxY: Math.max(containment.maxY, bounds.maxY + STAGE_CAMERA_PADDING.y)
    } : null;
    const { nodes: _nodes, ...syntax } = painted;
    for (const viewport of viewports) {
      const camera = fitCamera(fitBounds, viewport, viewportObstacles(viewport, true), viewport.width < 500 ? 0.02 : 0.06, stageFit);
      frames.push({ view: 'replay', frame: stepIndex + 1, stage, kind: step.replayKind, operation: step.operation,
        viewport: viewport.name, zoom: camera.k, ...syntax,
        ...relationGeometry({ visual, step, stepIndex, tree, painted, plan, schedule, camera, runs }) });
    }
  });
  return frames;
}

/** Plaques, neutral role labels and connectors, as paintRelationScene binds
 * them for this step and fitFallbackOverlays refits them at the Fit. */
function relationGeometry({ visual, step, stepIndex, tree, painted, plan, schedule, camera, runs }) {
  const stage = step.replayFrameIndex, empty = { plaques: [], roles: [], connectors: [] };
  if (!plan?.frames[stage]) return empty;
  const steps = visual.prepared.playbackSteps;
  const played = new Set();
  for (let index = 0; index <= stepIndex; index++) {
    const identity = steps[index].replayRelationIdentity;
    if (steps[index].replayKind === 'relation' && identity?.stageIndex === stage) played.add(identity.relationIndex);
  }
  const active = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
  const activeIndex = active?.stageIndex === stage ? active.relationIndex : null;
  const all = tree.descendants();
  const laidOut = indexHierarchyNodesByIdAndAliases(all);
  const overlay = indexHierarchyNodesByIdAndAliases(painted.nodes);
  const visibleIds = new Set(overlay.keys());
  const resolveOverlayAnchor = id => overlay.get(id) ?? (() => {
    const node = laidOut.get(id);
    return node?.descendants().some(descendant => visibleIds.has(getNodeId(descendant))) ? node : undefined;
  })();
  const labelCells = new Map(painted.labels.map(label => [label.id, label.cell]));
  const framePositionFor = (id, attachment = 'position') => {
    const anchor = laidOut.get(String(id || ''));
    if (!anchor) return null;
    if (attachment === 'terminal') {
      const { terminal } = resolveUniqueDisplayTerminal(anchor, node => node.children || [], node => isDisplayTerminalNode(node.data));
      if (!terminal) return null;
      const cell = labelCells.get(`${getNodeId(terminal)}:word`);
      return cell ? { x: cell.x + cell.width / 2, y: cell.y + cell.height + 6 } : { x: terminal.x, y: terminal.y + 140 };
    }
    if (attachment === 'parent') return anchor.parent ? { x: anchor.parent.x, y: anchor.parent.y } : null;
    const cell = labelCells.get(`${getNodeId(anchor)}:category`);
    if (attachment === 'shell-top') return cell ? { x: cell.x + cell.width / 2, y: cell.y - 8 } : { x: anchor.x, y: anchor.y - 8 };
    if (attachment === 'shell-bottom') return cell ? { x: cell.x + cell.width / 2, y: cell.y + cell.height + 6 } : { x: anchor.x, y: anchor.y + 6 };
    return { x: anchor.x, y: anchor.y };
  };
  const placements = projectPlaqueLayout(selectReplayPlaqueLayout(schedule, stage, stepIndex), id => laidOut.get(id) ?? null);
  const frameItems = projectVisibleAnchorSetOrganization(plan.frames[stage].items.map(item => resolveDisplayedTrajectoryAttachments(
    projectThetaGrid(item, stage, played), id => overlay.get(id)?.data, { stageIndex: stage, playedRelationIndices: played })),
  item => isPlanItemRevealed(item, stage, played, activeIndex) && planItemDependencyNodeIds(item).every(id => Boolean(resolveOverlayAnchor(id))));
  const revealed = new Set(frameItems.flatMap((item, index) => isPlanItemRevealed(item, stage, played, activeIndex) ? [index] : []));
  const shown = index => revealed.has(index) && planItemDependencyNodeIds(frameItems[index]).every(id => Boolean(resolveOverlayAnchor(id)));
  const plaques = [...placements].filter(([index]) => frameItems[index] && shown(index))
    .map(([index, box]) => ({ ...plaqueRecord(frameItems[index], box, laidOut.get(box.attachmentNodeId)), itemIndex: index }));
  if (!frameItems.some(item => item.kind === 'fallback')) return { ...empty, plaques };
  // measureFallbackLabels: plain label cells for every laid-out node.
  const fallbackLabelRects = new Map();
  for (const node of all) {
    if (isSyntheticWorkspaceRootNode(node) || isUnderTriangulation(node)) continue;
    const category = isCategory(node), base = runs.get(getNodeId(node));
    const run = category ? { kind: 'category', text: node.data.label || '', lines: categoryTextLayout(node.data.label || '', measureCategoryText).lines, indices: [] }
      : { kind: 'terminal', text: firstRun(base, 'terminal')?.text ?? resolveLeafSurface(node).trim(), indices: [] };
    fallbackLabelRects.set(getNodeId(node), labelGeometry(node, run).cell);
  }
  const rectFor = (id, subtree) => {
    const anchor = laidOut.get(id);
    const rects = anchor ? (subtree ? anchor.descendants() : [anchor]).flatMap(node => fallbackLabelRects.get(getNodeId(node)) ?? []) : [];
    return rects.length ? union(rects) : null;
  };
  const visibleObstacles = [...placements].filter(([index]) => frameItems[index] && shown(index)).map(([, box]) => box);
  const fallbackMeasurements = {
    labels: [...fallbackLabelRects.values()], obstacles: [...placements.values()],
    visibleLabels: [...fallbackLabelRects].filter(([id]) => visibleIds.has(id)).map(([, value]) => value),
    visibleObstacles, labelFor: id => rectFor(id, false), subtreeFor: id => rectFor(id, true),
    bottom: Math.max(0, ...[...fallbackLabelRects.values()].map(value => value.y + value.height))
  };
  const markerScale = Math.min(1 / camera.k, 3);
  const frameMaxNodeY = d3.max(all, node => node.y) ?? 0;
  const textTop = d3.min(painted.labels, label => label.cell.y) ?? -90;
  const displayed = { ...plan, frames: plan.frames.map((frame, index) => index === stage ? { ...frame, items: frameItems } : frame) };
  const runText = (id, text) => (runs.get(id) ?? []).some(run => run.text + run.indices.map(index => index.text).join('') === text);
  const bound = bindRelationPlanFrame(displayed, stage, framePositionFor, {
    labelWidth: 150, labelHeight: 70, badgeGap: 46, laneGap: 60, markerScale,
    hasExistingGapNotation: (id, text) => runText(id, text),
    plaqueTextLayout: { measureText: measurePlaqueText }, fallbackMeasurements, separateFallbackMoments: true,
    isItemRevealed: index => revealed.has(index), trajectoryCeilingY: textTop - 90, trajectoryFloorY: frameMaxNodeY + 180,
    connectorBaselineY: frameMaxNodeY + 130, railBaseY: frameMaxNodeY + 240
  });
  const scale = fallbackMarkerScale(camera.k, fallbackMeasurements.labels.map(value => value.height));
  const view = camera.view;
  // measureRelationInkObstacles reserves filled plaque shells with five units of padding.
  const relationInkObstacles = plaques.map(plaque => rect(plaque.rect.x - 5, plaque.rect.y - 5, plaque.rect.width + 10, plaque.rect.height + 10));
  const fitted = fitFallbackGeometry(bound, { markerScale, fittedMarkerScale: scale, fittedAnchorScale: Math.min(1 / camera.k, 3),
    badgeGap: 46, laneGap: 60, fallbackMeasurements, railBaseY: frameMaxNodeY + 240, relationInkObstacles, separateFallbackMoments: true,
    fittedViewport: { x: (view.left - camera.x) / camera.k, y: (view.top - camera.y) / camera.k,
      width: (view.right - view.left) / camera.k, height: (view.bottom - view.top) / camera.k } });
  const witnessesVisible = createPrimitiveVisibility(frameItems, resolveOverlayAnchor);
  const drawn = primitive => revealed.has(primitive.itemIndex) && witnessesVisible(primitive);
  const roles = [], connectors = [];
  for (const primitive of bound.primitives) {
    if (primitive.type !== 'fallback-mark' || !drawn(primitive)) continue;
    const mark = fitted.get(primitive) ?? primitive;
    const { center, reach } = roleNearbyReach(mark, scale);
    const box = fallbackLabelRect(mark, scale), textHeight = (mark.textHeight ?? 20) * scale;
    // The placement box adds two units per side for the three-unit round outline.
    const role = { id: `role(${relationKey(frameItems[primitive.itemIndex])} ${primitive.text})@${primitive.nodeId}`, itemIndex: primitive.itemIndex,
      relation: relationKey(frameItems[primitive.itemIndex]), witness: primitive.nodeId, text: primitive.text, rect: box,
      ink: rect(mark.x - mark.textWidth / 2 * scale, mark.y - textHeight / 2, mark.textWidth * scale, textHeight), halo: 1.5 * scale,
      labelRect: mark.labelRect, reach, distance: Math.hypot(mark.x - center.x, mark.y - center.y) };
    roles.push(role);
  }
  for (const primitive of bound.primitives) {
    if (primitive.type !== 'segment' || !drawn(primitive)) continue;
    const segment = fitted.get(primitive) ?? primitive;
    connectors.push({ id: `connector(${relationKey(frameItems[primitive.itemIndex])})${primitive.witnessNodeIds.join('→')}`,
      itemIndex: primitive.itemIndex, relation: relationKey(frameItems[primitive.itemIndex]), route: segment.route,
      witnesses: primitive.witnessNodeIds,
      own: primitive.witnessNodeIds.flatMap(id => laidOut.get(id)?.descendants().map(getNodeId) ?? [id]),
      pieces: pathPieces(segment.d), halfWidth: (segment.route === 'direct' ? 1.5 : 1.9) * scale / 2 });
  }
  return { plaques, roles, connectors };
}

/** The Canopy: the final stage's forest (the analysis's final forest) without
 * relation marks, fitted to its painted bounds. */
export function layoutCanopyVisualFrame(visual, viewport) {
  const { record, direction } = visual;
  const forest = record.derivationStages.at(-1)?.workspaceForest ?? [];
  const data = buildDerivationCanvasData(forest);
  if (!data) return null;
  const canvas = buildRenderableCommittedCanvasData(data);
  const root = d3.hierarchy(cloneSyntaxTree(canvas)); applyVizIds(root);
  const size = treeLayoutSize(root.descendants().length, root.height, viewport.width, viewport.height);
  const tree = layoutSyntaxTree(root, size, direction, undefined, undefined, { measureCategoryText, measureTreeInk });
  const painted = paintedTree(tree, null, () => undefined);
  const boxes = [...painted.labels.map(label => label.cell), ...painted.branches.map(branch => union(branch.points.map(p => rect(p.x, p.y, 0, 0))))];
  const box = union(boxes);
  const view = availableTreeViewport(viewport.width, viewport.height, viewportObstacles(viewport, false));
  const k = Math.max(viewport.width < 500 ? 0.02 : 0.06, Math.min((view.right - view.left) / box.width, (view.bottom - view.top) / box.height, 1));
  return { view: 'canopy', frame: null, stage: null, kind: 'canopy', operation: 'Canopy', viewport: viewport.name, zoom: k,
    labels: painted.labels, stems: painted.stems, branches: painted.branches, plaques: [], roles: [], connectors: [] };
}
