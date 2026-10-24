import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import { categoryTextLayout, type CategoryTextMeasure } from '../categoryTextLayout.ts';
import { CATEGORY_FALLBACK_GLYPH_WIDTH, CATEGORY_LINE_HEIGHT, nominalLabelWidth, TERMINAL_ATTACHMENT_Y } from '../rendererMetrics.ts';
import { isWordlessCategoryLeaf, resolveLeafSurface, shouldExpandPreterminalLeaf } from '../replaySurfaceNotation.ts';
import { cubicIntersectsRect } from './curveClearance.ts';
import {
  caseFeatureComposition,
  collectionPlaque,
  featurePlaqueAssignment,
  featureRowKey,
  pathFeatureRow
} from './featureComposition.ts';
import { dependentCaseStatePlaques, featureSharingPlaqueRect, sampleCubic } from './markGeometry.ts';
import {
  caseAssignmentPlaqueCurve,
  caseAssignmentRoutes,
  caseArrowBendsVisibly,
  type CaseArrowRoute,
  PLAIN_CASE_ROUTE,
  featureCollectionEdge,
  featureCollectionPlaqueCurve,
  type CollectionEdge
} from './overlayGeometry.ts';
import {
  plaqueColumnContains,
  plaqueColumnCovers,
  plaquesOverlap,
  preparePlaqueColumnIntervals,
  preparePlaqueObstacleIndex,
  preparePlaqueOverlapIndex,
  type ObstacleRect
} from './plaqueObstacleIndex.ts';
import {
  prepareCasePlaqueRows,
  preparePfPlaqueTextLayout,
  preparePlaqueTextLayout,
  prepareThetaGridTextLayout,
  type PlaqueTextMeasure
} from './plaqueTextLayout.ts';
import { boundingRect } from './rectGeometry.ts';
import { planItemRelationRefs, remapPlanOccurrence, type RelationPlanItem } from './renderPlan.ts';
import type { TreeLabelMeasure, TreeLabelRuns } from '../treeLabelRuns.ts';
import type { PocketRoute } from './pocketHold.ts';
export { plaquesOverlap } from './plaqueObstacleIndex.ts';

export type PlaqueRect = ObstacleRect & {
  terminalStemNodeId?: string;
  caseRowY?: number; collectionRows?: CollectionRow[]; collectionWidth?: number; drawnWidth?: number; drawnHeight?: number;
  /** The route the allocator accepted for this plaque's Case arrow; the painter draws the same curve. */
  caseRoute?: CaseArrowRoute;
  blocksConnectors?: boolean; connectorAttachment?: string;
  connectorInk?: { x: number; y: number; width: number; height: number };
  /** A fixed native plaque's footprint: a plaque, not syntax or a connector. */
  plaqueShell?: boolean;
  /** A sampled movement trajectory: like a plaque, it keeps the full gap when syntax gets a narrower one. */
  trajectory?: boolean };
type CollectionRow = { sourceNodeId: string; y: number; lane?: number; ownerKeys?: string[]; featureKey?: string; edge?: CollectionEdge; portX?: number };
type Node = HierarchyPointNode<SyntaxNode>;
const drawnPlaque = (box: PlaqueRect): PlaqueRect =>
  (box.drawnWidth === undefined || box.drawnWidth === box.width) && (box.drawnHeight === undefined || box.drawnHeight === box.height)
    ? box : { ...box, width: box.drawnWidth ?? box.width, height: box.drawnHeight ?? box.height };
export type PlaquePlacement = PlaqueRect & {
  location: 'local' | 'below'; domainId: string;
  scrollHeight?: number;
  /** The narrower gap from syntax this pocket was accepted at, when not PLAQUE_GAP. */
  syntaxGap?: number;
  attachmentNodeId: string; attachmentX: number; attachmentY: number;
};
const claims = new WeakMap<RelationPlanItem, string>();
/** One claim's identity across Replay steps, for keeping its pocket (stageCamera.ts,
 * holdPockets). A later movement can transfer the claim to a lower occurrence
 * (renderPlan.ts, `occurrenceTransfers`); later frames carry the transfer, and Replay
 * shows the earlier occurrence until the movement plays. The claim keeps the identity
 * of the occurrence it was authored on across that movement and those frames.
 * Allocation keeps `plaqueIdentity`, so a lifetime still ends where an occurrence changes. */
export function claimIdentity(item: RelationPlanItem): string {
  let identity = claims.get(item);
  if (identity === undefined) {
    const authored = (item.occurrenceTransfers ?? []).reduceRight((claim, transfer) =>
      remapPlanOccurrence(claim, transfer.toNodeId, transfer.fromNodeId), item);
    claims.set(item, identity = plaqueIdentity(authored));
  }
  return identity;
}
/** Identify the same drawn claim across plan frames, never by its changing array position. */
export function plaqueIdentity(item: RelationPlanItem): string {
  if (item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid') return JSON.stringify(['theta-grid',
    item.relationRef.stageIndex, item.relationRef.relationIndex, item.anchorNodeIds, item.tier2ClaimIdentity]);
  return JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex,
    item.kind, item.familyId, item.canonicalClaimIdentity, item.tier2FacetId, item.tier2RenderPart,
    item.kind === 'node-plaque' ? [item.plaqueStyle, item.title, item.anchorNodeIds, item.rows, item.thetaRoles]
      : item.kind === 'directed-path' ? [item.pathStyle, item.fromNodeId, item.toNodeId, item.featureRow] : null]);
}
const idOf = (node: Node): string => String((node as Node & { __vizId?: string }).__vizId ?? node.data.id ?? '');
const visible = (node: Node) => node.data.replayOrigin?.kind !== 'workspace';
const localPlaqueSize = 480;
// The crossing hints use these same 64 samples in both axes and every scene.
const candidateWeights = Array.from({ length: 65 }, (_, index) => {
  const t = index / 64, u = 1 - t;
  return u ** 3 + 3 * u * u * t;
});
const fitsLocalPocket = ({ width, height }: Pick<PlaqueRect, 'width' | 'height'>) => Math.max(width, height) <= localPlaqueSize;
// The local search first tries pockets beside and above or below the anchor point:
// these box tops, each centred or this far to either side.
const nearbyPocketTops = (height: number) => [-height - 60, -height / 2, 55, 115, 175, 235];
const nearbyPocketGap = 110;
/** One claim's nearest-pocket search checks at most this many pockets, then
 * keeps its prior pocket or goes below the tree. Long wrapped labels multiply
 * the box-clear pockets; a claim whose every nearby connector or Case arrow is
 * blocked would otherwise check them all. The committed analyses need at most
 * 82,517. */
export const LOCAL_POCKET_CHECK_LIMIT = 150_000;
/** A column's first list of lanes holds at least those within this distance. */
const POCKET_LANE_REACH = 120;
/** A pocket clearly nearer than an incumbent lies within this fraction of its distance. */
export const MIN_RELOCATION_GAIN = 0.75;
/** Plaques keep this gap from every obstacle. */
export const PLAQUE_GAP = 24;
/** The gap a remote plaque's second look keeps from syntax and connectors. It
 * keeps the full gap from trajectories and other plaques. */
export const DETACHED_PLAQUE_GAP = PLAQUE_GAP / 2;
/** Allocated plaques and fixed native plaques; everything else is syntax or a connector. */
const isPlaqueShell = (obstacle: PlaqueRect) => Boolean(obstacle.plaqueShell
  || obstacle.blocksConnectors && obstacle.connectorAttachment === undefined && !obstacle.curve);
/** A category label or word box (plaqueTreeObstacles). */
const isTreeText = (obstacle: PlaqueRect) => obstacle.connectorAttachment !== undefined && !obstacle.curve;
/** The nearest-pocket scan slides a plaque flush against its blockers, where the
 * fixed nearby pockets usually keep slack. A scanned pocket keeps this much more
 * than PLAQUE_GAP from tree text where a small nudge allows it. */
export const PLAQUE_SCAN_TEXT_EXTRA = 10;
const NUDGES = [-2, -1, 0, 1, 2].map(step => step * PLAQUE_SCAN_TEXT_EXTRA);
const grownObstacles = new WeakMap<PlaqueRect, Map<number, PlaqueRect>>();
/** `obstacle` grown by `by` on every side, one shared box per obstacle and amount. */
function grownObstacle(obstacle: PlaqueRect, by: number): PlaqueRect {
  let sizes = grownObstacles.get(obstacle);
  if (!sizes) grownObstacles.set(obstacle, sizes = new Map());
  let box = sizes.get(by);
  if (!box) sizes.set(by, box = { ...obstacle, x: obstacle.x - by, y: obstacle.y - by, width: obstacle.width + 2 * by, height: obstacle.height + 2 * by });
  return box;
}
/** Whether `obstacle` blocks carrying a pocket accepted at `syntaxGap`: the pocket keeps
 * that gap from syntax and connectors, and the full PLAQUE_GAP from plaques and
 * trajectories, which grow by the difference. */
export function blocksCarriedPocket(pocket: PlaqueRect, obstacle: PlaqueRect, syntaxGap = PLAQUE_GAP): boolean {
  const grow = PLAQUE_GAP - syntaxGap;
  return plaquesOverlap(pocket, grow && (isPlaqueShell(obstacle) || obstacle.trajectory) ? grownObstacle(obstacle, grow) : obstacle, syntaxGap);
}
/** Distances are measured from a word-bearing leaf's word, else from the anchor's label. */
export function plaqueAnchorPoint(anchor: Pick<Node, 'x' | 'y' | 'data' | 'children'>) {
  return { x: anchor.x, y: anchor.y + (!anchor.children?.length && anchor.data.word ? TERMINAL_ATTACHMENT_Y : 0) };
}
/** Distance from the anchor point to the centre of the farthest nearby pocket. A
 * plaque beyond it is remote; one too large for the local search has no reach. */
export function nearbyPlaqueReach({ width, height, thetaGrid }: Pick<PlaqueRect, 'width' | 'height'> & { thetaGrid?: boolean }) {
  if (!fitsLocalPocket({ width, height }) && !(thetaGrid && height <= localPlaqueSize)) return Infinity;
  return Math.hypot(nearbyPocketGap + width / 2, Math.max(...nearbyPocketTops(height).map(top => Math.abs(top + height / 2))));
}
/** The farthest nearby pocket itself is nearby; the margin absorbs rounding. */
export const beyondNearbyReach = (distance: number, box: Parameters<typeof nearbyPlaqueReach>[0]) =>
  distance > nearbyPlaqueReach(box) + 1e-6;
export function thetaGridPredicateLabel(anchor: Pick<Node, 'data' | 'children'>): string {
  let node = anchor;
  // A unary display shell can expose its own word; branching cannot select a head.
  while (!String(node.data.word || '').trim() && node.children?.length === 1) node = node.children[0];
  return String(node.data.word || anchor.data.label || 'predicate');
}
/** Placement-only union; connector queries keep their separate attachment and ink metadata. */
export function uniquePlaqueObstacles(obstacles: readonly PlaqueRect[]): PlaqueRect[] {
  const unique = prepareUniquePlaqueObstacles();
  return obstacles.filter(box => unique.add(box));
}

/** The geometry equality of uniquePlaqueObstacles: bounds, downward extent and
 * any precise curve with its padding. Other metadata never distinguishes boxes. */
export function prepareUniquePlaqueObstacles() {
  type Buckets = Map<number, PlaqueRect[]>;
  const groups = new Map<string, Buckets>();
  const curves = new WeakMap<NonNullable<PlaqueRect['curve']>, Map<number | undefined, Buckets>>();
  const numeric = new Float64Array(1), words = new Uint32Array(numeric.buffer);
  const hashNumber = (value: number, hash: number) => {
    numeric[0] = value === 0 ? 0 : Number.isNaN(value) ? NaN : value;
    return Math.imul(Math.imul(hash ^ words[0], 16777619) ^ words[1], 16777619);
  };
  const same = (a: number, b: number) => a === b || Number.isNaN(a) && Number.isNaN(b);
  const group = (key: string) => {
    let seen = groups.get(key);
    if (!seen) groups.set(key, seen = new Map());
    return seen;
  };
  const plain = group('');
  /** Whether an equal box was added already; `insert` adds this one when not. */
  const find = (box: PlaqueRect, insert: boolean) => {
    let seen = plain;
    if (box.curve) {
      let pads = curves.get(box.curve);
      if (!pads) curves.set(box.curve, pads = new Map());
      const cached = pads.get(box.curvePadding);
      if (cached) seen = cached;
      else {
        // Equal geometry shares a group even when the curve objects differ.
        // Avoid copying the same curve JSON into all 32 sample keys.
        seen = group(JSON.stringify([box.curve, box.curvePadding]));
        pads.set(box.curvePadding, seen);
      }
    }
    // Hashes select a small bucket, never establish equality. Exact numeric
    // comparison retains the old string key's treatment of signed zero and NaN.
    let key = hashNumber(box.x, 2166136261);
    key = hashNumber(box.y, key); key = hashNumber(box.width, key); key = hashNumber(box.height, key);
    key ^= Number(Boolean(box.extendsDownward));
    const bucket = seen.get(key);
    if (bucket?.some(other => same(box.x, other.x) && same(box.y, other.y)
      && same(box.width, other.width) && same(box.height, other.height)
      && Boolean(box.extendsDownward) === Boolean(other.extendsDownward))) return true;
    if (insert) { if (bucket) bucket.push(box); else seen.set(key, [box]); }
    return false;
  };
  return {
    /** True for the first box of its geometry. */
    add: (box: PlaqueRect) => !find(box, true),
    has: (box: PlaqueRect) => find(box, false)
  };
}

/** A placement reflected about the vertical line at `axis`, for right-to-left
 * Replay. Its drawn shell lands on the mirror of the left-to-right shell, so a
 * plaque the left-to-right search put right of its anchor stands left of it;
 * row ports and side edges reflect with it. Left to right, a shell drawn
 * narrower than a later phase reserves that width rightward from its left edge
 * while plaques are allocated; reflected, it reserves only its drawn shell, so
 * the reservation never extends toward the anchor. Its wider phase has its own
 * reflected placement. */
export function reflectPlaquePlacement(placement: PlaquePlacement, axis: number): PlaquePlacement {
  const drawn = placement.drawnWidth ?? placement.width;
  const reflectX = (x: number) => axis - x;
  return { ...placement, x: axis - placement.x - drawn, width: drawn, attachmentX: reflectX(placement.attachmentX),
    // A bent Case arrow reflects with its pocket; a plain arrow is drawn as main draws it.
    ...(placement.caseRoute ? { caseRoute: { ...placement.caseRoute, mirror: !placement.caseRoute.mirror } } : {}),
    ...(placement.collectionRows ? { collectionRows: placement.collectionRows.map(row => ({ ...row,
      ...(row.edge === 'left' || row.edge === 'right' ? { edge: row.edge === 'left' ? 'right' : 'left' } as const : {}),
      ...(row.portX === undefined ? {} : { portX: drawn - row.portX }) })) } : {}),
    ...(placement.connectorInk ? { connectorInk: { ...placement.connectorInk,
      x: axis - placement.connectorInk.x - placement.connectorInk.width } } : {}),
    ...(placement.curve ? { curve: Object.fromEntries(Object.entries(placement.curve).map(([key, point]) =>
      [key, { ...point, x: reflectX(point.x) }])) as typeof placement.curve } : {}) };
}

/** Carry a reserved offset with its actual Replay node, without choosing another pocket. */
export function projectPlaqueLayout(layout: Map<number, PlaquePlacement>, positionFor: (id: string) => { x: number; y: number } | null) {
  const projected = new Map<number, PlaquePlacement>();
  layout.forEach((placement, index) => {
    const anchor = positionFor(placement.attachmentNodeId);
    if (!anchor) return;
    projected.set(index, { ...placement,
      x: placement.x + anchor.x - placement.attachmentX,
      y: placement.y + anchor.y - placement.attachmentY });
  });
  return projected;
}

const branchWeights = Array.from({ length: 32 }, (_, index) => {
  const t = (index + 1) / 32, u = 1 - t;
  return { parentX: u ** 3 + 3 * u * u * t, childX: 3 * u * t * t + t ** 3,
    parentY: u ** 3, middleY: 3 * u * u * t + 3 * u * t * t, childY: t ** 3 };
});

/** The native D3 branch sampler, without allocating unrelated label or word
 * obstacles. Keep the original polynomial arithmetic and sample order. */
export function plaqueBranchObstacles(parent: { x: number; y: number }, node: { x: number; y: number }, precise = false): PlaqueRect[] {
  const middle = (parent.y + node.y) / 2;
  const curve = precise ? { source: { x: parent.x, y: parent.y },
    control1: { x: parent.x, y: middle }, control2: { x: node.x, y: middle },
    target: { x: node.x, y: node.y } } : undefined;
  const rectangles: PlaqueRect[] = [];
  let previous = { x: parent.x, y: parent.y };
  for (const weight of branchWeights) {
    const point = { x: weight.parentX * parent.x + weight.childX * node.x,
      y: weight.parentY * parent.y + weight.middleY * middle + weight.childY * node.y };
    const x = Math.min(previous.x, point.x) - 5, y = Math.min(previous.y, point.y) - 5;
    const width = Math.abs(previous.x - point.x) + 10, height = Math.abs(previous.y - point.y) + 10;
    rectangles.push(curve ? { x, y, width, height, curve, curvePadding: 5 } : { x, y, width, height });
    previous = point;
  }
  return rectangles;
}

/** Reserve labels, words, and sampled native cubic branches, including future stage syntax.
 * Optional curve metadata lets collision validation reject empty sample-box corners
 * without changing placement rectangles or their existing safety padding. */
export function plaqueTreeObstacles(nodes: Node[], measureCategoryText?: CategoryTextMeasure, preciseBranches = false): PlaqueRect[] {
  const rectangles: PlaqueRect[] = [];
  const included = new Set(nodes);
  for (const node of nodes.filter(visible)) {
    const label = categoryTextLayout(node.data.label || '', measureCategoryText);
    const hasCategory = Boolean(node.children?.length) || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data);
    if (hasCategory) rectangles.push({
      x: node.x + label.x - 8, y: node.y + label.y - 8, width: label.width + 16, height: label.height + 16,
      blocksConnectors: label.lines.length === 1, connectorAttachment: `${idOf(node)}:category`,
      ...(label.lines.length === 1 ? { connectorInk: { x: node.x + label.x, y: node.y + label.y,
        width: label.width, height: label.height } } : {}) });
    if (hasCategory && label.lines.length > 1) label.lines.forEach((line, index) => {
      const lineWidth = measureCategoryText?.(line) ?? [...line].length * CATEGORY_FALLBACK_GLYPH_WIDTH;
      rectangles.push({ x: node.x - lineWidth / 2 - 4, y: node.y + label.y + index * CATEGORY_LINE_HEIGHT - 4,
        width: lineWidth + 8, height: 60, blocksConnectors: true, connectorAttachment: `${idOf(node)}:category` });
    });
    // The painter also draws notation stored in label, such as t or ∅.
    // Use its terminal predicate so those glyphs and their stems reserve space.
    if (!node.children?.length && !isWordlessCategoryLeaf(node.data)) {
      const wordWidth = nominalLabelWidth(String(node.data.word || resolveLeafSurface(node)));
      rectangles.push({ x: node.x - wordWidth / 2, y: node.y + 65, width: wordWidth, height: 110,
        blocksConnectors: true, connectorAttachment: `${idOf(node)}:terminal` });
      rectangles.push({ x: node.x - 6, y: node.y, width: 12, height: 130, terminalStemNodeId: idOf(node) });
    }
    const parent = node.parent;
    if (!parent || !included.has(parent) || !visible(parent)) continue;
    rectangles.push(...plaqueBranchObstacles(parent, node, preciseBranches));
  }
  return rectangles;
}

/** Reserve the straight stems below neutral-link witnesses before placing plaques. */
export function plaqueConnectorObstacles(items: RelationPlanItem[], nodes: Node[]): PlaqueRect[] {
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  const included = new Set(nodes);
  const bottom = Math.max(0, ...nodes.map(node => node.y + 175));
  const ids = new Set(items.flatMap(item => item.kind === 'fallback'
    ? item.drawing.link?.endpoints ?? [] : []));
  return [...ids].flatMap(id => {
    const anchor = byId.get(id);
    if (!anchor) return [];
    const subtree = anchor.descendants().filter(node => included.has(node));
    const bounds = boundingRect(plaqueTreeObstacles(subtree));
    // Allow a label-height of clearance for the estimated text centre. The
    // browser attaches to measured ink; neither attachment nor path is moved.
    const x = bounds.x + bounds.width / 2, y = Math.max(...subtree.map(node => node.y)) - 42;
    return [{ x: x - 42, y, width: 84, height: bottom - y, extendsDownward: true }];
  });
}

/** `realizedForm`: a realization group's plate (realizationDisplay.ts). It attaches at its word when
 * its anchor holds exactly one, and chooses after every relation's plaque, so it never takes their pockets. */
export type PlaqueRequest = { index: number; ids: string[]; width: number; height: number; thetaGrid?: boolean; realizedForm?: boolean; scrollHeight?: number; caseAssignment?: boolean; caseRowY?: number; collectionRows?: CollectionRow[]; collectionWidth?: number; drawnWidth?: number; drawnHeight?: number };

/** Keep the lifetime pocket and ports while checking the content painted in this stage. */
export function projectPlaqueContent<T extends PlaqueRect>(box: T, request: Pick<PlaqueRequest, 'width' | 'height' | 'caseRowY' | 'collectionRows'>): T {
  const rows = box.collectionRows ? [] as CollectionRow[] : undefined;
  for (const row of box.collectionRows ?? []) {
    const current = request.collectionRows?.find(candidate => candidate.sourceNodeId === row.sourceNodeId
      && candidate.featureKey === row.featureKey);
    if (current) rows!.push({ ...row, ...current });
  }
  return { ...box, drawnWidth: request.width, drawnHeight: request.height, caseRowY: request.caseRowY,
    collectionRows: rows };
}

/** A single word can carry a head's mark (a Case arrow's source, a realized form's
 * plate); a complex head retains its own category anchor. */
export function caseAssignmentSource(node: Node): Node {
  const terminals = node.descendants().filter(child => !child.children?.length && Boolean(child.data.word));
  return terminals.length === 1 ? terminals[0] : node;
}

/** The box a Case arrow leaves, in tree coordinates, for a source returned by
 * caseAssignmentSource. The painter measures that label's SVG text box; an
 * allocation passes the same measured box so it tests the curve it paints. */
export type CaseSourceRects = (source: Node) => PlaqueRect | undefined;

/** Without a measured label: the category layout and a nominal word box. */
function estimatedCaseSourceRect(source: Node, measureCategoryText?: CategoryTextMeasure): PlaqueRect {
  const word = !source.children?.length && source.data.word;
  const label = categoryTextLayout(source.data.label || '', measureCategoryText);
  return { x: source.x - (word ? 75 : label.width / 2), y: source.y + (word ? 65 : label.y),
    width: word ? 150 : label.width, height: word ? 60 : label.height };
}

/** The painted box of a Case source: its word for a word-bearing leaf, else its
 * category, measured as the native text box. Retained label variants share their
 * union, the largest box any of its moments paints. */
export function measuredCaseSourceRect(source: Node, runs: readonly TreeLabelRuns[] | undefined,
  measureTreeLabel?: TreeLabelMeasure, measureCategoryText?: CategoryTextMeasure): PlaqueRect {
  const kind = !source.children?.length && source.data.word ? 'terminal' : 'category';
  const cells = (runs ?? []).filter(run => run.kind === kind).map(run => measureTreeLabel?.(run)?.cell);
  if (!cells.length || !cells.every(cell => cell && [cell.x, cell.y, cell.width, cell.height].every(Number.isFinite)
    && cell.width > 0 && cell.height > 0)) return estimatedCaseSourceRect(source, measureCategoryText);
  const box = boundingRect(cells as NonNullable<(typeof cells)[number]>[]);
  return { x: source.x + box.x, y: source.y + box.y, width: box.width, height: box.height };
}

const caseSourceRect = (anchor: Node, sources?: CaseSourceRects): PlaqueRect => {
  const source = caseAssignmentSource(anchor);
  return sources?.(source) ?? estimatedCaseSourceRect(source);
};

type CurveRects = (curve: ReturnType<typeof featureCollectionPlaqueCurve>, padding: number) => PlaqueRect[];
const caseRouteRectsFrom = (sourceRect: PlaqueRect, box: PlaqueRect, rects: CurveRects = curveObstacleRects): PlaqueRect[] => {
  const curve = caseAssignmentPlaqueCurve(sourceRect, drawnPlaque(box), box.y + (box.caseRowY ?? 93), box.caseRoute);
  return rects(curve, 8);
};
const caseRouteRects = (anchor: Node, box: PlaqueRect, rects?: CurveRects, sources?: CaseSourceRects): PlaqueRect[] =>
  caseRouteRectsFrom(caseSourceRect(anchor, sources), box, rects);

const curveBounds = (curve: ReturnType<typeof featureCollectionPlaqueCurve>, padding: number): PlaqueRect => {
  const { source, control1, control2, target } = curve;
  const x = Math.min(source.x, control1.x, control2.x, target.x) - padding;
  const y = Math.min(source.y, control1.y, control2.y, target.y) - padding;
  return { x, y, width: Math.max(source.x, control1.x, control2.x, target.x) + padding - x,
    height: Math.max(source.y, control1.y, control2.y, target.y) + padding - y };
};

/** Equal connector curves share one list of their obstacle rectangles, which no
 * caller mutates. Subcurves keep the end points by reference, so these key too. */
export function prepareCurveObstacleRects(): CurveRects {
  const cache = new Map<string, PlaqueRect[]>();
  return (curve, padding) => {
    const { source, control1, control2, target } = curve;
    const key = [padding, source.x, source.y, control1.x, control1.y, control2.x, control2.y, target.x, target.y]
      .map(exactNumber).join(' ') + JSON.stringify([source, target]);
    let rects = cache.get(key);
    if (!rects) cache.set(key, rects = curveObstacleRects(curve, padding));
    return rects;
  };
}

/** Exact subcurve hulls keep broad bounds conservative without filling their empty corners. */
const curveObstacleRects = (curve: ReturnType<typeof featureCollectionPlaqueCurve>, padding: number, depth = 5): PlaqueRect[] => {
  if (depth === 0) return [{ ...curveBounds(curve, padding), curve, curvePadding: padding }];
  const middle = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const ab = middle(curve.source, curve.control1), bc = middle(curve.control1, curve.control2), cd = middle(curve.control2, curve.target);
  const abc = middle(ab, bc), bcd = middle(bc, cd), split = middle(abc, bcd);
  return [...curveObstacleRects({ source: curve.source, control1: ab, control2: abc, target: split }, padding, depth - 1),
    ...curveObstacleRects({ source: split, control1: bcd, control2: cd, target: curve.target }, padding, depth - 1)];
};

/** Test the drawn approach against opaque ink, leaving its own attachment available. */
export function caseAssignmentClears(anchor: Node, box: PlaqueRect, obstacles: PlaqueRect[], sources?: CaseSourceRects): boolean {
  return prepareCasePlaqueSpace(anchor, obstacles, sources)(box);
}

const finiteRect = (rect: ObstacleRect) => Number.isFinite(rect.x) && Number.isFinite(rect.y)
  && Number.isFinite(rect.width) && Number.isFinite(rect.height);
/** Exact text for a number, distinguishing -0, for keys that must not merge distinct inputs. */
export const exactNumber = (value: number) => Object.is(value, -0) ? '-0' : String(value);
type CrossingBound = { attachment: string | undefined; low: number; high: number; first: number; last: number };

/** Connector sources and blockers of one immutable scene. Every allocation that
 * adds its own plaques to the scene shares these; none of them is mutated. */
export type ConnectorScene = {
  readonly nodes: readonly Node[]; readonly obstacles: readonly PlaqueRect[]; readonly blockers: readonly PlaqueRect[];
  readonly finite: boolean;
  source(id: string): PlaqueRect | undefined;
  inkIndex(attachment: string | undefined): ReturnType<typeof preparePlaqueObstacleIndex<PlaqueRect>>;
  caseIndex(attachment: string): ReturnType<typeof preparePlaqueObstacleIndex<PlaqueRect>>;
  bounds(axis: 'x' | 'y'): readonly CrossingBound[];
  blockersSince(previous: ConnectorScene): readonly number[];
  distinctBlockers(): readonly number[];
  blockerKeys(): ReadonlyMap<string, number>;
};
export function prepareConnectorScene(nodes: readonly Node[], obstacles: readonly PlaqueRect[]): ConnectorScene {
  const blockers = obstacles.filter(rect => rect.blocksConnectors);
  let attachments: Map<string, PlaqueRect> | undefined;
  let byId: Map<string, Node> | undefined;
  const sourceCache = new Map<string, PlaqueRect | undefined>();
  const inkIndexes = new Map<string | undefined, ReturnType<typeof preparePlaqueObstacleIndex<PlaqueRect>>>();
  const caseIndexes = new Map<string, ReturnType<typeof preparePlaqueObstacleIndex<PlaqueRect>>>();
  const bounds: Partial<Record<'x' | 'y', CrossingBound[]>> = {};
  let keys: Map<string, number> | undefined, distinct: number[] | undefined;
  const changed = new WeakMap<object, number[]>();
  const scene: ConnectorScene = {
    nodes, obstacles, blockers,
    /** Split queries equal one combined query only on finite rectangles. */
    finite: blockers.every(rect => finiteRect(rect) && (!rect.connectorInk || finiteRect(rect.connectorInk))),
    // Ordinary plaques have no collection sources. Prepare only the exact source
    // queried by a collection row; unqueried syntax cannot affect its route.
    source(id: string): PlaqueRect | undefined {
      if (sourceCache.has(id)) return sourceCache.get(id);
      if (!attachments) {
        attachments = new Map();
        for (const obstacle of obstacles) if (obstacle.connectorAttachment !== undefined
          && !attachments.has(obstacle.connectorAttachment)) attachments.set(obstacle.connectorAttachment, obstacle);
        byId = new Map(nodes.map(node => [idOf(node), node]));
      }
      const node = byId!.get(id);
      if (!node) return undefined;
      let source = attachments.get(`${id}:category`) ?? attachments.get(`${id}:terminal`);
      if (!source) {
        const labels = plaqueTreeObstacles([node]);
        source = labels.find(rect => rect.connectorAttachment === `${id}:category`)
          ?? labels.find(rect => rect.connectorAttachment === `${id}:terminal`);
      }
      sourceCache.set(id, source); return source;
    },
    /** Collection ink that a route from this attachment must clear. */
    inkIndex(attachment: string | undefined) {
      let index = inkIndexes.get(attachment);
      if (!index) {
        index = preparePlaqueObstacleIndex(blockers.filter(rect => rect.connectorAttachment !== attachment)
          .map(rect => rect.connectorInk ?? rect));
        inkIndexes.set(attachment, index);
      }
      return index;
    },
    /** Opaque boxes that a Case arrow from this attachment must clear. */
    caseIndex(attachment: string) {
      let index = caseIndexes.get(attachment);
      if (!index) {
        index = preparePlaqueObstacleIndex(blockers.filter(rect => rect.connectorAttachment !== attachment));
        caseIndexes.set(attachment, index);
      }
      return index;
    },
    // A fixed curve can need horizontal clearance as well as a different height.
    // Solve both coordinates from sampled crossings; the allocator validates every
    // proposed pocket with the exact curve, including orientation/handle changes.
    bounds(axis: 'x' | 'y') { return bounds[axis] ??= crossingBounds(blockers, axis); },
    /** Indices of blockers whose crossing hints `previous` lacks, in order. */
    blockersSince(previous: ConnectorScene): number[] {
      let indices = changed.get(previous);
      if (!indices) {
        const prior = previous.blockerKeys();
        indices = [];
        for (const [key, index] of scene.blockerKeys()) if (!prior.has(key)) indices.push(index);
        indices.sort((a, b) => a - b);
        changed.set(previous, indices);
      }
      return indices;
    },
    /** Blockers with distinct crossing hints, in order. */
    distinctBlockers(): readonly number[] { return distinct ??= [...scene.blockerKeys().values()].sort((a, b) => a - b); },
    /** Each distinct crossing-hint input, at its first blocker. */
    blockerKeys(): ReadonlyMap<string, number> {
      if (!keys) {
        keys = new Map();
        blockers.forEach((obstacle, index) => {
          const rect = obstacle.connectorInk ?? obstacle;
          const key = `${exactNumber(rect.x)} ${exactNumber(rect.y)} ${exactNumber(rect.width)} ${exactNumber(rect.height)}`
            + (obstacle.connectorAttachment === undefined ? '' : ` ${obstacle.connectorAttachment}`);
          if (!keys!.has(key)) keys!.set(key, index);
        });
      }
      return keys;
    }
  };
  return scene;
}

const crossingBounds = (blockers: readonly PlaqueRect[], axis: 'x' | 'y'): CrossingBound[] => blockers.map(obstacle => {
  const rect = obstacle.connectorInk ?? obstacle;
  const other = axis === 'x' ? 'y' : 'x';
  const extent = axis === 'x' ? 'width' : 'height';
  const otherExtent = axis === 'x' ? 'height' : 'width';
  return { attachment: obstacle.connectorAttachment,
    low: rect[other] - 8, high: rect[other] + rect[otherExtent] + 8,
    first: rect[axis] - 8, last: rect[axis] + rect[extent] + 8 };
});

/** Added plaques can share a scene's fixed structures when they cannot change its
 * sources and every rectangle is finite; otherwise query one combined list. */
const sharesConnectorScene = (scene: ConnectorScene, added: readonly PlaqueRect[]) => scene.finite
  && added.every(rect => rect.connectorAttachment === undefined && !rect.connectorInk && finiteRect(rect));

/** Source ink and blockers stay fixed while the allocator searches candidate pockets. */
export function prepareCasePlaqueSpace(anchor: Node, obstacles: PlaqueRect[], sources?: CaseSourceRects) {
  return casePlaqueSpace(prepareConnectorScene([], obstacles), anchor, [], sources);
}

/** The Case space of `scene` with `added` blockers, as if they ended its obstacles. */
export function casePlaqueSpace(scene: ConnectorScene, anchor: Node, added: readonly PlaqueRect[] = [], sources?: CaseSourceRects) {
  const addedBlockers = added.filter(rect => rect.blocksConnectors);
  if (addedBlockers.length && !sharesConnectorScene(scene, addedBlockers))
    return casePlaqueSpace(prepareConnectorScene(scene.nodes, [...scene.obstacles, ...added]), anchor, [], sources);
  const source = caseAssignmentSource(anchor);
  const rect = caseSourceRect(anchor, sources);
  const attachment = `${idOf(source)}:${!source.children?.length && source.data.word ? 'terminal' : 'category'}`;
  const index = scene.caseIndex(attachment);
  let previousX = NaN, previousY = NaN, previousWidth = NaN, previousHeight = NaN, previousRowY = NaN;
  let previousRoute: CaseArrowRoute | undefined, previousResult = false;
  return (box: PlaqueRect) => {
    const drawn = drawnPlaque(box), rowY = box.y + (box.caseRowY ?? 93);
    // Trying another collection port leaves the Case curve unchanged. Reuse
    // only that exact last curve against this immutable obstacle space.
    if (drawn.x === previousX && drawn.y === previousY && drawn.width === previousWidth
      && drawn.height === previousHeight && rowY === previousRowY && box.caseRoute?.exit === previousRoute?.exit
      && box.caseRoute?.bend === previousRoute?.bend) return previousResult;
    previousX = drawn.x; previousY = drawn.y; previousWidth = drawn.width; previousHeight = drawn.height; previousRowY = rowY;
    previousRoute = box.caseRoute;
    const curve = caseAssignmentPlaqueCurve(rect, drawn, rowY, box.caseRoute);
    const bounds = curveBounds(curve, 8);
    const blocks = (blocker: PlaqueRect) => cubicIntersectsRect(curve, blocker, 8);
    // Collision clearance alone can leave an arrow shorter than its head.
    // Reserve a readable shaft in tree coordinates, so zoom keeps its proportion.
    // A shallower route chosen in one scene must still bend visibly in every
    // scene it is carried into.
    previousResult = Math.hypot(curve.target.x - curve.source.x, curve.target.y - curve.source.y) >= CATEGORY_LINE_HEIGHT * 2
      && (!(box.caseRoute && box.caseRoute.bend < 1) || caseArrowBendsVisibly(curve))
      && !index.some(bounds, blocks) && !addedBlockers.some(blocker => plaquesOverlap(bounds, blocker, 0) && blocks(blocker));
    return previousResult;
  };
}

/** Measure source labels once per allocation space, not for every candidate pocket. */
export function prepareCollectionPlaqueSpace(nodes: Node[], obstacles: PlaqueRect[] = []) {
  return collectionPlaqueSpace(prepareConnectorScene(nodes, obstacles));
}

/** The collection space of `scene` with `added` blockers, as if they ended its obstacles. */
export function collectionPlaqueSpace(scene: ConnectorScene, added: readonly PlaqueRect[] = []) {
  let addedBlockers = added.filter(rect => rect.blocksConnectors);
  // A combined scene keeps the fixed blockers first, so their indices still apply.
  let unshared: readonly number[] | undefined;
  if (added.length && !sharesConnectorScene(scene, added)) {
    const fixedCount = scene.blockers.length;
    scene = prepareConnectorScene(scene.nodes, [...scene.obstacles, ...added]);
    unshared = Array.from({ length: scene.blockers.length - fixedCount }, (_, index) => fixedCount + index);
    added = addedBlockers = [];
  }
  // Port searches visit ink in index order. Keep one combined index for them.
  let ordered: ReturnType<typeof collectionPlaqueSpace> | undefined;
  const combined = () => ordered ??= collectionPlaqueSpace(prepareConnectorScene(scene.nodes, [...scene.obstacles, ...added]));
  const sources = { get: (id: string) => scene.source(id) };
  const inkIndex = (attachment: PlaqueRect) => scene.inkIndex(attachment.connectorAttachment);
  const curves = (box: PlaqueRect, sidesOnly = false) => (box.collectionRows ?? []).flatMap(row => {
    const attachment = sources.get(row.sourceNodeId);
    const edge = row.edge ?? (sidesOnly ? 'side' : undefined);
    return attachment ? [{ row, attachment,
      ...featureCollectionPlaqueCurve(drawnPlaque(box), box.y + row.y, attachment.connectorInk ?? attachment, row.lane ?? 0, edge, row.portX) }] : [];
  });
  // Nearby candidates commonly hit the same ink. A known blocker proves
  // rejection; a miss still runs the complete immutable spatial query.
  const previousBlockers = new WeakMap<object, PlaqueRect>();
  const routeClears = (curve: ReturnType<typeof featureCollectionPlaqueCurve>, box: PlaqueRect, attachment: PlaqueRect) => {
    if (cubicIntersectsRect(curve, drawnPlaque(box), 6)) return false;
    const index = inkIndex(attachment), bounds = curveBounds(curve, 6), previous = previousBlockers.get(index);
    if (previous && plaquesOverlap(bounds, previous, 0) && cubicIntersectsRect(curve, previous, 6)) return false;
    return !index.some(bounds, blocker => {
      if (!cubicIntersectsRect(curve, blocker, 6)) return false;
      previousBlockers.set(index, blocker);
      return true;
    }) && !addedBlockers.some(blocker => plaquesOverlap(bounds, blocker, 0) && cubicIntersectsRect(curve, blocker, 6));
  };
  const portGap = 24;
  const lastPort = (box: PlaqueRect) => Math.min(box.width, box.collectionWidth ?? box.width) - 24;
  const portAvailable = (x: number, occupied: number[]) => occupied.every(port => Math.abs(x - port) >= portGap - 1e-6);
  const reserveVerticalPorts = (box: PlaqueRect, rows: CollectionRow[]) => {
    const reserved = [...rows], limit = lastPort(box);
    for (const edge of ['top', 'bottom'] as const) {
      const occupied: number[] = [], pending: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.edge !== edge) continue;
        if (row.portX === undefined) pending.push(i);
        else occupied.push(row.portX);
      }
      const centerTogether = !occupied.length;
      for (let index = 0; index < pending.length; index++) {
        const rowIndex = pending[index], row = rows[rowIndex];
        const source = sources.get(row.sourceNodeId);
        if (!source) continue;
        const curve = featureCollectionPlaqueCurve(drawnPlaque(box), box.y + row.y, source.connectorInk ?? source, row.lane ?? 0, edge);
        const preferred = curve.source.x - box.x + (centerTogether ? (index - (pending.length - 1) / 2) * portGap : 0);
        const candidates = [Math.max(24, Math.min(limit, preferred)), 24, limit];
        for (const x of occupied) candidates.push(x - portGap, x + portGap);
        let portX: number | undefined, distance = Infinity;
        for (const x of candidates) {
          const nextDistance = Math.abs(x - preferred);
          if (x >= 24 && x <= limit && portAvailable(x, occupied) && nextDistance < distance) {
            portX = x; distance = nextDistance;
          }
        }
        reserved[rowIndex] = portX === undefined ? { ...row, edge: 'side' } : { ...row, portX };
        if (portX !== undefined) occupied.push(portX);
      }
    }
    return reserved;
  };
  const verticalPort = (box: PlaqueRect, row: CollectionRow, attachment: PlaqueRect, occupied: number[]): CollectionRow => {
    const rect = attachment.connectorInk ?? attachment;
    const route = (portX = row.portX) => featureCollectionPlaqueCurve(drawnPlaque(box), box.y + row.y, rect, row.lane ?? 0, row.edge, portX);
    const original = route();
    if (portAvailable(original.source.x - box.x, occupied) && routeClears(original, box, attachment)) return row;
    const preferred = original.source.x - box.x;
    const candidates = new Set([24, lastPort(box), ...occupied.flatMap(x => [x - portGap, x + portGap])]);
    const samples = sampleCubic(original.source, original.control1, original.control2, original.target, 64);
    // Moving a vertical port changes the first two cubic points together.
    // Solve that weight at each ink crossing, then validate the exact curve.
    const possibleBounds = boundingRect([curveBounds(route(24), 8), curveBounds(route(lastPort(box)), 8)]);
    inkIndex(attachment).some(possibleBounds, ink => {
      let first = -1, last = -1;
      samples.forEach((point, index) => {
        if (index === 0 || index === 64 || point.y < ink.y - 8 || point.y > ink.y + ink.height + 8) return;
        if (first < 0) first = index;
        last = index;
      });
      for (const index of new Set([first, last])) {
        if (index < 0) continue;
        const t = index / 64, u = 1 - t, weight = u ** 3 + 3 * u * u * t;
        for (const x of [ink.x - 8, ink.x + ink.width + 8]) {
          const port = preferred + (x - samples[index].x) / weight;
          if (port >= 24 && port <= lastPort(box)) candidates.add(port);
        }
      }
      return false;
    });
    for (const portX of [...candidates].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))) {
      if (portX >= 24 && portX <= lastPort(box) && portAvailable(portX, occupied)
        && routeClears(route(portX), box, attachment)) return { ...row, portX };
    }
    return row;
  };
  const clearVerticalPorts = (box: PlaqueRect, rows: CollectionRow[]) => {
    const reserved = [...rows];
    reserved.forEach((row, index) => {
      const source = sources.get(row.sourceNodeId);
      if (!source || (row.edge !== 'top' && row.edge !== 'bottom')) return;
      const occupied = reserved.flatMap((other, i) => i !== index && other.edge === row.edge && other.portX !== undefined ? [other.portX] : []);
      reserved[index] = verticalPort(box, row, source, occupied);
    });
    return reserved;
  };
  const addedBounds: Partial<Record<'x' | 'y', CrossingBound[]>> = {};
  /** The sampled routes whose blocker crossings hint at `box[axis]`. */
  const crossingRoutes = (box: PlaqueRect, axis: 'x' | 'y'): CrossingRoute[] => {
    const routes = curves(box);
    if (box.collectionRows?.some(row => !row.edge)) curves(box, true).forEach(route => {
      if (!routes.some(old => old.row === route.row && old.source.x === route.source.x && old.source.y === route.source.y
        && old.target.x === route.target.x && old.target.y === route.target.y)) routes.push(route);
    });
    return routes.map(curve => crossingRoute(curve, axis));
  };
  /** Hints for each route, from the scene's blockers (only `fixed` of them,
   * when given, in order) and then the added ones. */
  const pushCandidates = (routes: readonly CrossingRoute[], coordinate: number, axis: 'x' | 'y',
    fixed: readonly number[] | undefined, candidates: number[]) => {
    if (fixed && unshared) fixed = [...fixed, ...unshared];
    const sceneBounds = scene.bounds(axis), extra = addedBounds[axis] ??= crossingBounds(addedBlockers, axis);
    for (const route of routes) {
      pushCrossingCandidates(route, coordinate, sceneBounds, fixed, candidates);
      pushCrossingCandidates(route, coordinate, extra, undefined, candidates);
    }
    return candidates;
  };
  const candidateCoordinates = (box: PlaqueRect, axis: 'x' | 'y'): number[] =>
    pushCandidates(crossingRoutes(box, axis), box[axis], axis, undefined, []);
  return {
    attach: <T extends PlaqueRect>(box: T, sidesOnly = false, adjustPorts = true): T => {
      if (addedBlockers.length && adjustPorts) return combined().attach(box, sidesOnly, adjustPorts);
      const distinctSources = new Set(box.collectionRows?.map(row => row.sourceNodeId)).size > 1;
      let rows = box.collectionRows?.map(row => {
        const source = sources.get(row.sourceNodeId);
        if (row.edge || !source) return row;
        // Rows from one exact source can share its facing edge. Distinct
        // sources retain the direct row-side associations used in Orchard D6.
        const edge = sidesOnly || distinctSources ? 'side'
          : featureCollectionEdge(drawnPlaque(box), box.y + row.y, source.connectorInk ?? source);
        return { ...row, edge: edge === 'left' || edge === 'right' ? 'side' : edge } as CollectionRow;
      });
      if (rows) {
        rows = reserveVerticalPorts(box, rows);
        if (adjustPorts) rows = clearVerticalPorts(box, rows);
      }
      return { ...box, ...(rows ? { collectionRows: rows } : {}) };
    },
    withClearPorts: <T extends PlaqueRect>(box: T): T => addedBlockers.length ? combined().withClearPorts(box) : ({ ...box,
      collectionRows: box.collectionRows ? clearVerticalPorts(box, box.collectionRows) : undefined }),
    clears: (box: PlaqueRect): boolean => {
      for (const row of box.collectionRows ?? []) {
        const attachment = sources.get(row.sourceNodeId);
        if (!attachment) continue;
        const curve = featureCollectionPlaqueCurve(drawnPlaque(box), box.y + row.y,
          attachment.connectorInk ?? attachment, row.lane ?? 0, row.edge, row.portX);
        if (!routeClears(curve, box, attachment)) return false;
      }
      return true;
    },
    candidateXs: (box: PlaqueRect): number[] => candidateCoordinates(box, 'x'),
    candidateYs: (box: PlaqueRect): number[] => candidateCoordinates(box, 'y'),
    crossingRoutes, pushCandidates,
    /** Exactly what a route from `sourceNodeId` reads of this scene. */
    sourceKey: (sourceNodeId: string): string => {
      const source = sources.get(sourceNodeId);
      if (!source) return '-';
      const rect = source.connectorInk ?? source;
      return `${exactNumber(rect.x)} ${exactNumber(rect.y)} ${exactNumber(rect.width)} ${exactNumber(rect.height)} ${source.connectorAttachment}`;
    },
    routeRects: (box: PlaqueRect, rects: CurveRects = curveObstacleRects) => curves(box).flatMap(curve => rects(curve, 6)),
    /** Each collection row's route and the source label it leaves. */
    routeCurves: (box: PlaqueRect) => curves(box)
  };
}

type CrossingRoute = { attachment: string | undefined; samples: { x: number; y: number }[]; minOther: number; maxOther: number;
  increasing: boolean; decreasing: boolean; other: 'x' | 'y' };
const crossingRoute = (curve: ReturnType<typeof featureCollectionPlaqueCurve> & { attachment: PlaqueRect }, axis: 'x' | 'y'): CrossingRoute => {
  const samples = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 64);
  const other = axis === 'x' ? 'y' : 'x';
  let minOther = Infinity, maxOther = -Infinity;
  let increasing = true, decreasing = true;
  for (let i = 1; i < 64; i++) {
    minOther = Math.min(minOther, samples[i][other]);
    maxOther = Math.max(maxOther, samples[i][other]);
    if (i > 1) {
      increasing &&= samples[i][other] >= samples[i - 1][other];
      decreasing &&= samples[i][other] <= samples[i - 1][other];
    }
  }
  return { attachment: curve.attachment.connectorAttachment, samples, minOther, maxOther, increasing, decreasing, other };
};

/** Append each blocker's crossing hints for one route, in blocker order. */
const pushCrossingCandidates = (route: CrossingRoute, coordinate: number,
  bounds: readonly CrossingBound[], indices: readonly number[] | undefined, candidates: number[]) => {
  const { attachment, samples, minOther, maxOther, increasing, decreasing, other } = route;
  const axis = other === 'x' ? 'y' : 'x';
  // Search the existing samples, not an analytic substitute: the first/last
  // crossing and its arithmetic define the candidate and stable tie order.
  const sampleBound = (value: number, inclusive: boolean) => {
    let low = 1, high = 64;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const coordinate = increasing ? samples[middle][other] : -samples[middle][other];
      if (coordinate < value || (inclusive && coordinate === value)) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const count = indices ? indices.length : bounds.length;
  for (let k = 0; k < count; k++) {
    const obstacle = bounds[indices ? indices[k] : k];
    if (obstacle.attachment === attachment) continue;
    const { low, high } = obstacle;
    if (maxOther < low || minOther > high) continue;
    let first = -1, last = -1;
    if (increasing || decreasing) {
      first = sampleBound(increasing ? low : -high, false);
      last = sampleBound(increasing ? high : -low, true) - 1;
      if (last < first) continue;
    } else {
      for (let i = 1; i < 64; i++) if (samples[i][other] >= low && samples[i][other] <= high) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) continue;
    for (const i of [first, last]) {
      const sourceWeight = candidateWeights[i], sample = samples[i][axis];
      candidates.push(coordinate + (obstacle.first - sample) / sourceWeight);
      candidates.push(coordinate + (obstacle.last - sample) / sourceWeight);
    }
  }
};

/** Fixed Orchard collection curves stay clear by placement, never by rerouting. */
export function collectionPlaqueClears(box: PlaqueRect, nodes: Node[], obstacles: PlaqueRect[]): boolean {
  return prepareCollectionPlaqueSpace(nodes, obstacles).clears(box);
}

/** Candidate heights are search hints; every resulting curve is checked before placement. */
export function collectionPlaqueCandidateYs(box: PlaqueRect, nodes: Node[], obstacles: PlaqueRect[]): number[] {
  return prepareCollectionPlaqueSpace(nodes, obstacles).candidateYs(box);
}

/** Reserve collections before other plaques choose their lifetime pockets. */
export function plaqueCollectionConnectorObstacles(nodes: Node[], layout: Map<number, PlaquePlacement>, rects?: CurveRects): PlaqueRect[] {
  const space = prepareCollectionPlaqueSpace(nodes);
  return [...layout.values()].flatMap(box => space.routeRects(box, rects));
}

/** Reserve the same curved approach as the painter, including carried claims. */
export function plaqueCaseConnectorObstacles(items: RelationPlanItem[], nodes: Node[], layout: Map<number, PlaquePlacement>,
  rects?: CurveRects, sources?: CaseSourceRects): PlaqueRect[] {
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  return [...layout].flatMap(([index, box]) => {
    const item = items[index];
    const anchor = item?.kind === 'directed-path' && item.pathStyle === 'case-assignment' && byId.get(item.fromNodeId);
    return anchor ? caseRouteRects(anchor, box, rects, sources) : [];
  });
}

/** One plaque's own Case arrow and the collector routes of `box`'s rows, as allocation
 * reserves them (plaqueCaseConnectorObstacles, plaqueCollectionConnectorObstacles), each
 * piece tagged with the route it belongs to (pocketHold.ts, PocketRoute). */
export function plaqueRouteObstacles(item: RelationPlanItem, nodes: readonly Node[], box: PlaqueRect,
  collection: ReturnType<typeof prepareCollectionPlaqueSpace>, rects?: CurveRects, sources?: CaseSourceRects): (PlaqueRect & { route: PocketRoute })[] {
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  const tag = (route: PocketRoute, pieces: PlaqueRect[]) => pieces.map(piece => ({ ...piece, route }));
  const anchor = item.kind === 'directed-path' && item.pathStyle === 'case-assignment' ? byId.get(item.fromNodeId) : undefined;
  const source = anchor && caseAssignmentSource(anchor);
  return [...source ? tag({ key: `case@${box.caseRowY ?? 93}`, far: { x: source.x, y: source.y },
    source: `${idOf(source)}:${!source.children?.length && source.data.word ? 'terminal' : 'category'}` },
    caseRouteRects(anchor!, box, rects, sources)) : [],
  ...collection.routeCurves(box).flatMap(({ row, attachment, ...curve }) => {
    const node = byId.get(row.sourceNodeId);
    return node ? tag({ key: `row:${row.sourceNodeId}:${row.featureKey ?? ''}@${row.y}`, far: { x: node.x, y: node.y },
      source: attachment.connectorAttachment, ink: true }, (rects ?? curveObstacleRects)(curve, 6)) : [];
  })];
}

/** Measure content independently of allocation so its whole lifetime can reserve one size. */
export function prepareStagePlaqueRequests(items: RelationPlanItem[], nodes: Node[], measureText?: PlaqueTextMeasure,
  includes?: (index: number) => boolean): PlaqueRequest[] {
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  const requests: PlaqueRequest[] = [];
  items.forEach((item, index) => {
    if (includes && !includes(index)) return;
    if (item.kind === 'node-plaque') {
      if (item.plaqueStyle === 'feature') {
        if (featurePlaqueAssignment(items, index) !== undefined) return;
      }
      let size = preparePlaqueTextLayout(item, { variant: item.plaqueStyle === 'feature' ? 'feature' : 'generic', measureText });
      if (item.plaqueStyle === 'realization') {
        const rows = item.rows.map((row, rowIndex) => ({ ...row, rowIndex,
          kind: item.realizationRowKinds?.[rowIndex], isFinal: rowIndex === item.rows.length - 1 }));
        size = { ...size, ...preparePfPlaqueTextLayout(rows, {
          isZeroRealization: rows.length === 1 && rows[0].kind === 'rewrite' && rows[0].value === '\u2205',
          measureText
        }), rows: size.rows };
      }
      if (item.plaqueStyle === 'theta-grid') {
        const predicate = byId.get(item.anchorNodeIds[0]);
        if (!predicate) return;
        const grid = prepareThetaGridTextLayout(thetaGridPredicateLabel(predicate), item.thetaRoles ?? [], { measureText });
        size = { ...size, width: grid.width, height: grid.height };
      }
      const collectionRows = item.plaqueStyle === 'feature' ? items.flatMap(candidate => {
        if (candidate.kind !== 'directed-path' || candidate.pathStyle !== 'case-agree'
          || collectionPlaque(items, candidate)?.index !== index) return [];
        const rowIndex = item.rows.findIndex(row => featureRowKey(row) === featureRowKey(pathFeatureRow(candidate)));
        const row = size.rows.find(row => row.rowIndex === rowIndex);
        if (!row?.lines.length) return [];
        const first = row.lines[0], last = row.lines[row.lines.length - 1];
        return [{ sourceNodeId: candidate.toNodeId, featureKey: featureRowKey(pathFeatureRow(candidate)),
          y: (first.y - first.ascent + last.y + last.descent) / 2,
          ownerKeys: planItemRelationRefs(candidate).map(ref => `${ref.stageIndex}:${ref.relationIndex}`) }];
      }) : [];
      requests.push({ index, ids: [...item.anchorNodeIds, ...(item.thetaRoles?.map(role => role.nodeId) || [])],
        width: size.width, height: size.height, ...(collectionRows.length ? { collectionRows } : {}),
        ...(item.plaqueStyle === 'theta-grid' ? { thetaGrid: true } : {}),
        ...(item.realization ? { realizedForm: true } : {}),
        ...(size.overflow ? { scrollHeight: size.height } : {}) });
    } else if (item.kind === 'directed-path' && item.pathStyle === 'case-assignment') {
      // A Case route reserves its exact source; its recipient cannot stand in for an unavailable source.
      if (!byId.has(item.fromNodeId)) return;
      const composition = caseFeatureComposition(items, index)!;
      const size = prepareCasePlaqueRows(composition.rows);
      const collectionRows = composition.collections.map(({ item, index }, lane) => ({ sourceNodeId: item.toNodeId, lane,
        featureKey: featureRowKey(pathFeatureRow(item)),
        ownerKeys: planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`),
        y: size.rows[composition.rows.findIndex(row => row.ownerIndices.includes(index))].y }));
      requests.push({ index, ids: [item.fromNodeId, item.toNodeId], width: size.width, caseAssignment: true,
        height: size.height, caseRowY: size.rows[composition.rows.findIndex(row => row.ownerIndices.includes(index))].y,
        ...(collectionRows.length ? { collectionRows } : {}) });
    }
  });
  return requests;
}

export type PlaqueSpace = {
  obstacles: PlaqueRect[];
  acceptsConnector: (box: PlaqueRect) => boolean;
  /** A partial check of the Case arrow alone: true only when `acceptsConnector`
   * rejects the arrow, in at least one scene, whatever ports the box has. */
  blocksArrow?: (box: PlaqueRect) => boolean;
  /** Search hints in first-occurrence order. The search reads each distinct value
   * once, so a space may omit a repeat of an earlier hint. */
  connectorCandidateXs?: (box: PlaqueRect) => number[];
  connectorCandidateYs?: (box: PlaqueRect) => number[];
};
type PlaqueLifetime = {
  sizes: ReadonlyMap<string, Pick<PlaqueRect, 'width' | 'height' | 'collectionWidth'>>;
  collectionsOnly?: boolean;
  /** Allocate only these claims; the caller reserves every other pocket. */
  includes?: (index: number) => boolean;
  /** Clear pockets a new search keeps unless it finds a clearly nearer one. */
  incumbents?: ReadonlyMap<number, PlaquePlacement>;
  /** Reconsidered prior pockets a new search keeps unless it finds a nearer one. */
  reconsider?: ReadonlySet<number>;
  /** Reconsidered claims whose prior pocket is an incumbent instead. */
  relocating?: ReadonlySet<number>;
  spaceFor: (index: number, anchor: Node, allocated: Map<number, PlaquePlacement>) => PlaqueSpace;
  /** Offered each newly searched pocket. A returned shorter lifetime is searched
   * again at once, keeping this pocket as the incumbent, so later claims avoid the
   * pocket actually chosen. */
  relocate?: (index: number, anchor: Node, allocated: Map<number, PlaquePlacement>, box: PlaqueRect) => PlaqueSpace | undefined;
  /** Search pockets at this narrower gap from everything but plaques. */
  syntaxGap?: number;
  /** Measured Case source boxes; without them Case arrows leave estimated labels. */
  caseSources?: CaseSourceRects;
};

/** A binary heap: `pop` returns the item `before` orders first. */
function createMinQueue<T>(before: (a: T, b: T) => number) {
  const items: T[] = [];
  return {
    peek: (): T | undefined => items[0],
    push(item: T) {
      let index = items.push(item) - 1;
      while (index) {
        const parent = (index - 1) >> 1;
        if (before(items[parent], item) <= 0) break;
        items[index] = items[parent]; index = parent;
      }
      items[index] = item;
    },
    pop(): T | undefined {
      const top = items[0], last = items.pop()!;
      if (!items.length) return top;
      let index = 0;
      for (;;) {
        const left = 2 * index + 1, right = left + 1;
        if (left >= items.length) break;
        const child = right < items.length && before(items[right], items[left]) < 0 ? right : left;
        if (before(last, items[child]) <= 0) break;
        items[index] = items[child]; index = child;
      }
      items[index] = last;
      return top;
    }
  };
}

/** Geometry only: a common enclosing subtree locates a plaque, never establishes a linguistic domain. */
export function placeStagePlaques(items: RelationPlanItem[], nodes: Node[], obstacles = plaqueTreeObstacles(nodes),
  previous = new Map<string, PlaquePlacement>(), measureText?: PlaqueTextMeasure, lifetime?: PlaqueLifetime) {
  const result = new Map<number, PlaquePlacement>(), caseSources = lifetime?.caseSources;
  const priorCandidates = new Map<number, PlaquePlacement>(), incumbentPriors = new Map<number, PlaquePlacement>();
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  const placed: PlaqueRect[] = [];
  const attachmentSpace = prepareCollectionPlaqueSpace(nodes, obstacles);
  const attach = <T extends PlaqueRect>(box: T, request: PlaqueRequest, prior?: PlaquePlacement, sidesOnly = false) => attachmentSpace.attach({
    ...box, caseRowY: request.caseRowY, collectionWidth: request.collectionWidth,
    drawnWidth: request.drawnWidth, drawnHeight: request.drawnHeight, collectionRows: request.collectionRows?.map(row => {
      const previousRow = prior?.collectionRows?.find(old => old.sourceNodeId === row.sourceNodeId
        && (row.featureKey ? old.featureKey === row.featureKey : Math.abs(old.y - row.y) < 1e-6)
        && old.ownerKeys?.some(key => row.ownerKeys?.includes(key)));
      return previousRow?.edge ? { ...row, edge: previousRow.edge, portX: previousRow.portX } : row;
    })
  }, sidesOnly, false);
  const requests = prepareStagePlaqueRequests(items, nodes, measureText, lifetime?.includes).map(request => ({ ...request,
    drawnWidth: request.width, drawnHeight: request.height,
    ...lifetime?.sizes.get(plaqueIdentity(items[request.index])) }))
    .filter(request => !lifetime?.collectionsOnly || request.collectionRows?.length);
  // Lifetime reservations already cover future syntax. Standalone one-stage
  // callers must still reject an obsolete pocket supplied by their caller.
  for (const request of requests) {
    const prior = previous.get(plaqueIdentity(items[request.index]));
    const attachment = prior && byId.get(prior.attachmentNodeId);
    if (!prior || !attachment || prior.width !== request.width || prior.height !== request.height) continue;
    const placement = attach({ ...prior, x: prior.x + attachment.x - prior.attachmentX,
      y: prior.y + attachment.y - prior.attachmentY, attachmentX: attachment.x, attachmentY: attachment.y,
    }, request, prior);
    const space = lifetime?.spaceFor(request.index, attachment, result);
    const occupied = [...(space?.obstacles ?? obstacles), ...placed];
    // A carried plain arrow keeps its pocket only while it still bends visibly.
    const judged = request.caseAssignment && !placement.caseRoute ? { ...placement, caseRoute: PLAIN_CASE_ROUTE } : placement;
    const connectorsClear = space ? space.acceptsConnector(judged)
      : (!request.caseAssignment || caseAssignmentClears(attachment, judged, occupied, caseSources))
        && collectionPlaqueClears(placement, nodes, occupied);
    const carryGap = lifetime?.syntaxGap ?? PLAQUE_GAP;
    if (lifetime?.syntaxGap === undefined) delete (placement as Partial<PlaquePlacement>).syntaxGap;
    if (occupied.some(obstacle => blocksCarriedPocket(placement, obstacle, carryGap)) || !connectorsClear) continue;
    if (lifetime?.reconsider?.has(request.index)) {
      (lifetime.relocating?.has(request.index) ? incumbentPriors : priorCandidates).set(request.index, placement);
      continue;
    }
    result.set(request.index, placement);
    placed.push({ ...placement, blocksConnectors: true },
      ...(request.caseAssignment ? caseRouteRects(attachment, placement, undefined, caseSources) : []));
  }
  // Compact boxes keep first choice of nearby pockets, even when a wider grid can also fit locally.
  // Among them, a plaque that shows its owner only by proximity chooses before one that a
  // Case arrow or collector joins to its owner, which can still reach a farther pocket.
  // A realized-form plate is no relation's claim; it takes what their plaques leave.
  const joined = (request: PlaqueRequest) => Number(Boolean(request.caseAssignment || request.collectionRows?.length));
  requests.sort((a, b) => Number(Boolean(a.realizedForm)) - Number(Boolean(b.realizedForm))
    || Number(!fitsLocalPocket(a)) - Number(!fitsLocalPocket(b)) || joined(a) - joined(b)
    || a.index - b.index);
  for (const request of requests) {
    if (result.has(request.index)) continue;
    const anchors = request.ids.map(id => byId.get(id)).filter((node): node is Node => Boolean(node));
    if (!anchors.length) continue;
    const anchor = request.realizedForm ? caseAssignmentSource(anchors[0]) : anchors[0];
    const space = lifetime?.spaceFor(request.index, anchor, result);
    const occupied = [...(space?.obstacles ?? obstacles), ...placed];
    // At a narrower gap, plaques and trajectories grow by the difference: they keep the full gap.
    const gap = lifetime?.syntaxGap ?? PLAQUE_GAP, grow = PLAQUE_GAP - gap;
    const searched = grow ? occupied.map(obstacle => isPlaqueShell(obstacle) || obstacle.trajectory ? { ...obstacle, x: obstacle.x - grow,
      y: obstacle.y - grow, width: obstacle.width + 2 * grow, height: obstacle.height + 2 * grow } : obstacle) : occupied;
    let obstacleIndex: ReturnType<typeof preparePlaqueOverlapIndex> | undefined;
    let queriedPocket = false;
    const overlaps = (box: PlaqueRect) => {
      // Most nearby plaques fit their first pocket. Its exact boolean query
      // does not need a sorted spatial hierarchy; later searches reuse one.
      if (!queriedPocket) {
        queriedPocket = true;
        return searched.some(obstacle => plaquesOverlap(box, obstacle, gap));
      }
      return (obstacleIndex ??= preparePlaqueOverlapIndex(searched)).overlaps(box, gap);
    };
    const caseClears = request.caseAssignment && !space ? prepareCasePlaqueSpace(anchor, occupied, caseSources) : undefined;
    const sourceRect = request.caseAssignment ? caseSourceRect(anchor, caseSources) : undefined;
    const accepts = (box: PlaqueRect) => space ? space.acceptsConnector(box)
        : (!caseClears || caseClears(box))
          && collectionPlaqueClears(box, nodes, occupied);
    // The first pass places the plaque exactly as its plain arrow allows. Only
    // when that arrow would run too straight does a second pass try bent routes.
    let bendRoutes = false;
    const clear = (candidate: PlaqueRect, blocked = overlaps): PlaqueRect | undefined => {
      if (blocked(candidate)) return undefined;
      // An arrow that would run too straight tries its bent routes at every pocket.
      if (bendRoutes && request.caseAssignment && sourceRect && candidate.caseRoute === undefined) {
        const drawn = { ...candidate, width: request.drawnWidth ?? width, height: request.drawnHeight ?? height };
        for (const caseRoute of caseAssignmentRoutes(sourceRect, drawn, candidate.y + (request.caseRowY ?? 93))) {
          const box = clear({ ...candidate, caseRoute }, () => false);
          if (box) return box;
        }
        return undefined;
      }
      // Ports never move a Case arrow: every attachment tried below draws the
      // same one. A pocket whose arrow is blocked is rejected before choosing them.
      if (request.caseAssignment) {
        const arrow = { ...candidate, caseRowY: request.caseRowY, drawnWidth: request.drawnWidth, drawnHeight: request.drawnHeight };
        if (space ? space.blocksArrow?.(arrow) : caseClears && !caseClears(arrow)) return undefined;
      }
      const box = attach(candidate, request);
      if (accepts(box)) return box;
      // Try another port before accepting a clear side fallback. Restrict this
      // search to otherwise valid pockets, not every rejected allocation candidate.
      if (box.collectionRows?.some(row => row.edge === 'top' || row.edge === 'bottom')) {
        const side = attach(candidate, request, undefined, true);
        if (accepts(side)) {
          const vertical = attachmentSpace.withClearPorts(box);
          return accepts(vertical) ? vertical : side;
        }
      }
      return undefined;
    };
    const ancestors = anchor.ancestors();
    let domain = ancestors.find(candidate => visible(candidate) && anchors.every(node => node.ancestors().includes(candidate))) || anchor;
    if (anchors.length === 1 && !domain.children?.length && domain.parent && visible(domain.parent)) domain = domain.parent;
    const availableNodes = new Set(nodes);
    const domainBounds = boundingRect(plaqueTreeObstacles(domain.descendants().filter(node => availableNodes.has(node))));
    const { width, height } = request;
    // Role grids grow horizontally with their columns; width alone must not detach them from the predicate.
    const local = fitsLocalPocket(request) || (request.thetaGrid && height <= localPlaqueSize);
    const terminal = request.caseAssignment ? anchor.descendants().filter(node => !node.children?.length && node.data.word) : [];
    const anchorY = terminal.length === 1 ? terminal[0].y + TERMINAL_ATTACHMENT_Y
      : anchor.y + (!anchor.children?.length && anchor.data.word ? TERMINAL_ATTACHMENT_Y : 0);
    const placementDistance = (box: PlaqueRect) => {
      if (!sourceRect) return (box.x + width / 2 - anchor.x) ** 2 + (box.y + height / 2 - anchorY) ** 2;
      // Pockets compare by the plain arrow, whatever route one takes, so a bent
      // route never prefers a different pocket from the one main would keep.
      const curve = caseAssignmentPlaqueCurve(sourceRect, { x: box.x, y: box.y, width, height },
        box.y + (request.caseRowY ?? 93));
      const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 16);
      return points.slice(1).reduce((length, point, i) =>
        length + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0) ** 2;
    };
    const select = () => {
      const priorClears = (prior: PlaquePlacement) => space ? space.acceptsConnector(prior)
        : (!caseClears || caseClears(prior)) && collectionPlaqueClears(prior, nodes, occupied);
      const clearPrior = (prior?: PlaquePlacement): PlaquePlacement | undefined => {
        if (!prior || overlaps(prior)) return undefined;
        if (!bendRoutes || !request.caseAssignment || !sourceRect || prior.caseRoute) return priorClears(prior) ? prior : undefined;
        const drawn = { ...prior, width: request.drawnWidth ?? width, height: request.drawnHeight ?? height };
        for (const caseRoute of caseAssignmentRoutes(sourceRect, drawn, prior.y + (request.caseRowY ?? 93)))
          if (priorClears({ ...prior, caseRoute })) return { ...prior, caseRoute };
        return undefined;
      };
      const prior = clearPrior(priorCandidates.get(request.index));
      const incumbent = clearPrior(incumbentPriors.get(request.index) ?? lifetime?.incumbents?.get(request.index));
      const priorCandidate = incumbent && (!prior || placementDistance(incumbent) < placementDistance(prior)) ? incumbent : prior;
      const priorDistance = priorCandidate ? placementDistance(priorCandidate) : Infinity;
      const candidates = request.caseAssignment ? [70, 140, -height - 70].flatMap(dy =>
        [anchor.x + 110, anchor.x - width - 110, anchor.x - width / 2]
          .map(x => ({ x, y: anchorY + dy - ((request.caseRowY ?? 93) - 93), width, height })))
        : local ? nearbyPocketTops(height)
        .flatMap(dy => [anchor.x + nearbyPocketGap, anchor.x - width - nearbyPocketGap, anchor.x - width / 2]
          .map(x => ({ x, y: anchorY + dy, width, height })))
        .sort((a, b) => Math.hypot(a.x + width / 2 - anchor.x, a.y + height / 2 - anchorY)
          - Math.hypot(b.x + width / 2 - anchor.x, b.y + height / 2 - anchorY)) : [];
      let placement: PlaqueRect | undefined;
      for (const candidate of candidates) {
        placement = clear(candidate);
        if (placement) break;
      }
      // A genuine participant relocation can make a valid old pocket unnecessarily
      // remote. Keep it as an incumbent; unchanged geometry takes the carry path.
      if (placement && priorCandidate && priorDistance <= placementDistance(placement)) placement = priorCandidate;
      /** A scanned pocket slides flush against what blocks it. Nudged by up to
       * twice PLAQUE_SCAN_TEXT_EXTRA, it keeps that much more than the gap from tree
       * text, when such a pocket is clear, nearby and nearer than the prior pocket. */
      const roomier = (box: PlaqueRect) => {
        // Every obstacle that can block a nudge also blocks the area they cover, at the wider gap.
        const reach = NUDGES[NUDGES.length - 1], area = { x: box.x - reach, y: box.y - reach, width: width + 2 * reach, height: height + 2 * reach };
        const roomy = searched.filter(obstacle => plaquesOverlap(area, obstacle, gap + PLAQUE_SCAN_TEXT_EXTRA))
          .map(obstacle => isTreeText(obstacle) ? grownObstacle(obstacle, PLAQUE_SCAN_TEXT_EXTRA) : obstacle);
        const blocked = (candidate: PlaqueRect) => roomy.some(obstacle => plaquesOverlap(candidate, obstacle, gap));
        if (!blocked(box)) return box;
        let best: PlaqueRect | undefined, bestDistance = priorDistance;
        for (const dx of NUDGES) for (const dy of NUDGES) {
          if (!dx && !dy) continue;
          const nudged = clear({ x: box.x + dx, y: box.y + dy, width, height }, blocked), distance = nudged && placementDistance(nudged);
          if (nudged && distance! < bestDistance && !beyondNearbyReach(Math.sqrt(distance!), request)) {
            best = nudged; bestDistance = distance!;
          }
        }
        return best ?? box;
      };
      /** The nearest clear pocket beyond the fixed candidates. */
      const scan = () => {
        let placement: PlaqueRect | undefined = priorCandidate;
        // Search the nearest clear pocket, including one just beyond the initial
        // candidates. A radius cutoff would send a local claim below its subtree.
        const scanGap = gap + 1e-6;
        const sourceX = sourceRect ? sourceRect.x + sourceRect.width / 2 : anchor.x;
        const horizontalGap = (x: number) => request.caseAssignment
          ? Math.max(x - sourceX, sourceX - x - width, 0) : Math.abs(x + width / 2 - anchor.x);
        const collectionSpace = request.collectionRows?.length && !space ? prepareCollectionPlaqueSpace(nodes, occupied) : undefined;
        const connectorColumns = request.collectionRows?.length ? candidates.flatMap(box => {
          const candidate = { ...box, collectionRows: request.collectionRows };
          return (space?.connectorCandidateXs?.(candidate) ?? collectionSpace?.candidateXs(candidate) ?? [])
            .flatMap(x => [x, x - 16, x + 16]);
        }) : [];
        const xs = [...new Set([...candidates.map(box => box.x), ...connectorColumns, ...searched.flatMap(box =>
          [box.x - width - scanGap, box.x + box.width + scanGap])])]
          .sort((a, b) => horizontalGap(a) - horizontalGap(b));
        const columnIntervals = preparePlaqueColumnIntervals(searched, height, scanGap);
        const idealY = request.caseAssignment ? anchorY + 163 - (request.caseRowY ?? 93) : anchorY - height / 2;
        /** A closed range holding every height in column `x` whose squared
         * distance can be below `bound`: that distance is at least the vertical
         * part's, after the horizontal part that column fixes. The margin exceeds
         * the rounding of these coordinates, so the range never excludes a lane. */
        const improvingRange = (x: number, dx: number, bound: number): [number, number] | undefined => {
          if (!Number.isFinite(bound)) return undefined;
          if (!sourceRect) {
            const reach = Math.sqrt(Math.max(0, bound - dx * dx)) + 1 + 1e-6 * (Math.sqrt(bound) + Math.abs(idealY));
            return Number.isFinite(reach + idealY) ? [idealY - reach, idealY + reach] : undefined;
          }
          // caseAssignmentPlaqueCurve's side choice, target and possible sources.
          const centerX = sourceRect.x + sourceRect.width / 2;
          const side = centerX < x ? 'left' : centerX > x + width ? 'right' : 'vertical';
          const targetX = side === 'left' ? x - 12 : x + width + 12;
          const horizontal = side === 'vertical' ? 0 : Math.min(Math.abs(targetX - centerX),
            Math.abs(targetX - (side === 'left' ? sourceRect.x + sourceRect.width + 8 : sourceRect.x - 8)));
          const sourceYs = [sourceRect.y - 8, sourceRect.y + sourceRect.height / 2, sourceRect.y + sourceRect.height + 8];
          const targetOffsets = side === 'vertical' ? [-12, height + 12] : [request.caseRowY ?? 93];
          const scale = Math.sqrt(bound) + Math.abs(x) + width + height + Math.abs(sourceRect.x) + Math.abs(sourceRect.y)
            + sourceRect.width + sourceRect.height;
          const reach = Math.sqrt(Math.max(0, bound - horizontal * horizontal)) + 1 + 1e-6 * scale;
          const low = Math.min(...sourceYs) - Math.max(...targetOffsets) - reach;
          const high = Math.max(...sourceYs) - Math.min(...targetOffsets) + reach;
          return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : undefined;
        };
        // What every list of a column's lanes uses, whatever its bound.
        type ColumnPrecursor = { x: number; dx: number; merged?: number[][]; hints?: number[]; arrows: Map<number, { chord: number; distance?: number }> };
        // One column's lanes nearer than `bound`, nearest first, ties in the lane
        // order of a scan of the columns in gap order. A larger bound only adds
        // lanes after these, in the same order; `complete` when it adds none.
        const columnLanes = (column: ColumnPrecursor, bound: number) => {
          const { x, dx } = column;
          const merged = column.merged ??= columnIntervals(x, width);
          // One blocked interval covering every improving height leaves this
          // column without lanes, so its connector hints need not be computed.
          const range = improvingRange(x, dx, bound);
          if (range && plaqueColumnCovers(merged, range[0], range[1])) return { lanes: [], complete: false };
          let complete = true;
          // The nearest box-sized gap can still put the curved approach through
          // another label. Consider the remaining gap edges before falling below.
          const candidate = { x, y: 0, width, height, collectionRows: request.collectionRows };
          const rawConnectorLanes = column.hints ??= request.collectionRows?.length ? [
            ...(space?.connectorCandidateYs?.(candidate) ?? collectionPlaqueCandidateYs(candidate, nodes, occupied)),
            ...Array.from({ length: 33 }, (_, lane) => idealY + (lane - 16) * 40)
          ] : [];
          const lanes = new Set<number>();
          // A Case arrow's squared chord, then its squared sampled length when first needed.
          const arrow = (y: number, assigner: PlaqueRect) => {
            let known = column.arrows.get(y);
            if (!known) {
              const route = caseAssignmentPlaqueCurve(assigner, { x, y, width, height }, y + (request.caseRowY ?? 93));
              column.arrows.set(y, known = { chord: (route.target.x - route.source.x) ** 2 + (route.target.y - route.source.y) ** 2 });
            }
            return known;
          };
          const withinBound = (y: number) => {
            if (!Number.isFinite(bound)) return true;
            const dy = y - idealY;
            if (!sourceRect) return dx * dx + dy * dy < bound;
            return arrow(y, sourceRect).chord < bound;
          };
          // Heights outside the range, in or between blocked intervals, cannot improve.
          const addLane = (y: number) => {
            if (!Number.isFinite(y) || plaqueColumnContains(merged, y)) return;
            if ((!range || y >= range[0] && y <= range[1]) && withinBound(y)) lanes.add(y); else complete = false;
          };
          addLane(idealY);
          // A hint whose three lanes all fall outside the range cannot add one.
          const hints = range ? rawConnectorLanes.filter(y => y >= range[0] - 17 && y <= range[1] + 17) : rawConnectorLanes;
          if (hints.length < rawConnectorLanes.length) complete = false;
          for (const y of new Set(hints)) {
            addLane(y); addLane(y - 16); addLane(y + 16);
          }
          for (const [low, high] of merged) { addLane(low); addLane(high); }
          // Blocked heights and those not nearer than the bound never enter the
          // sort. Surviving ties retain insertion order.
          const ys = [...lanes]
            .sort((a, b) => Math.abs(a - idealY) - Math.abs(b - idealY));
          const ranked: Array<{ y: number; distance: number }> = [];
          for (const y of ys) {
            const dy = y - idealY;
            let distance = dx * dx + dy * dy;
            if (sourceRect) {
              const known = arrow(y, sourceRect);
              if (known.chord >= bound) { complete = false; continue; }
              if (known.distance === undefined) {
                const route = caseAssignmentPlaqueCurve(sourceRect, { x, y, width, height }, y + (request.caseRowY ?? 93));
                const points = sampleCubic(route.source, route.control1, route.control2, route.target, 16);
                known.distance = points.slice(1).reduce((length, point, i) =>
                  length + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0) ** 2;
              }
              distance = known.distance;
            }
            if (distance >= bound) complete = false;
            if (!request.caseAssignment && distance >= bound) break;
            if (distance < bound) ranked.push({ y, distance });
          }
          // Box distances already ascend with the height offset; arrow lengths need not.
          return { lanes: sourceRect ? ranked.sort((a, b) => a.distance - b.distance) : ranked, complete };
        };
        // The claim keeps the pocket a scan of the columns in gap order keeps:
        // the nearest accepted before the first column whose squared gap reaches
        // the best distance so far. That gap bounds every box distance in its
        // column, but a Case arrow, which can leave the side of its source, can
        // be shorter. Ranking each pocket by the larger of its squared distance
        // and its column's squared gap, then by column, distance and lane, makes
        // the first accepted pocket in that order the scan's, so no farther one
        // is checked. A column lists only the lanes within a few times its rank
        // and lists more once those are checked.
        type PocketColumn = ColumnPrecursor & { index: number; gap: number; key: number; lanes: Array<{ y: number; distance: number }>; listed: number; next: number };
        const columns = createMinQueue<PocketColumn>((a, b) => a.key - b.key || a.index - b.index);
        let opened = 0, checks = 0;
        for (;;) {
          for (let nearest = columns.peek(); opened < xs.length; opened++) {
            const dx = horizontalGap(xs[opened]), gap = dx * dx;
            if (gap >= priorDistance) { opened = xs.length; break; }
            if (nearest && gap > nearest.key) break;
            columns.push({ index: opened, x: xs[opened], dx, gap, key: gap, lanes: [], listed: 0, next: 0, arrows: new Map() });
            nearest = columns.peek();
          }
          const column = columns.pop();
          if (!column || column.key >= priorDistance) break;
          if (column.next === column.lanes.length) {
            // A longer list repeats the lanes already checked first.
            const bound = Math.min(priorDistance, Math.max(4 * column.key, column.key + POCKET_LANE_REACH ** 2));
            const { lanes, complete } = columnLanes(column, bound);
            column.lanes = lanes; column.listed = complete ? Infinity : bound;
          } else {
            const { y } = column.lanes[column.next++];
            if (checks++ === LOCAL_POCKET_CHECK_LIMIT) break;
            const box = clear({ x: column.x, y, width, height });
            if (box) { placement = box; break; }
          }
          if (column.next < column.lanes.length) column.key = Math.max(column.gap, column.lanes[column.next].distance);
          else if (column.listed < priorDistance) column.key = Math.max(column.gap, column.listed);
          else continue;
          columns.push(column);
        }
        return placement;
      };
      if (!placement && local) {
        const scanned = scan();
        placement = scanned && scanned !== priorCandidate ? roomier(scanned) : scanned;
      }
      placement ??= priorCandidate;
      // Leaving an incumbent needs a clearly nearer pocket: a nearby one when the
      // incumbent is not nearby, or one within MIN_RELOCATION_GAIN of its distance.
      if (incumbent && placement && placement !== incumbent) {
        const fresh = Math.sqrt(placementDistance(placement)), kept = Math.sqrt(placementDistance(incumbent));
        if (fresh > MIN_RELOCATION_GAIN * kept && (beyondNearbyReach(fresh, request) || !beyondNearbyReach(kept, request)))
          placement = incumbent;
      }
      const kept = [priorCandidate, incumbent].find(box => box && box === placement);
      const location = placement ? kept ? kept.location : 'local' : 'below';
      if (!placement) {
        // A connector's lower lane clears all plaques, so its stems extend past
        // every below-tree plaque. Each column clear of the stems descends past
        // its own collisions; the landing nearest the subtree's ideal spot wins,
        // so a blocked column cannot send the plaque down through unrelated syntax.
        const idealX = domainBounds.x + domainBounds.width / 2 - width / 2;
        const top = domainBounds.y + domainBounds.height + 60;
        const stems = occupied.filter(box => box.extendsDownward);
        const gap = 24 + 1e-6;
        const descend = (x: number): number => {
          let y = top;
          for (;;) {
            const collisions = occupied.filter(obstacle => plaquesOverlap({ x, y, width, height }, obstacle));
            if (!collisions.length) return y;
            y = Math.max(...collisions.map(obstacle => obstacle.y + obstacle.height)) + 32;
          }
        };
        const columns = [idealX, ...stems.flatMap(box => [box.x - width - gap, box.x + box.width + gap])]
          .filter(x => stems.every(box => x + width + 24 <= box.x || x >= box.x + box.width + 24))
          .sort((a, b) => Math.abs(a - idealX) - Math.abs(b - idealX) || a - b);
        let best = { x: columns[0], y: Infinity, distance: Infinity };
        for (const x of columns) {
          // Columns are sorted by horizontal distance, a lower bound on the rest.
          if (Math.abs(x - idealX) >= best.distance) break;
          const y = descend(x);
          const distance = Math.hypot(x - idealX, y - top);
          if (distance < best.distance) best = { x, y, distance };
        }
        placement = attach({ x: best.x, y: best.y, width, height }, request);
      }
      const attachment = anchor;
      let chosen: PlaquePlacement = { ...placement, location, domainId: idOf(domain),
        ...(request.scrollHeight ? { scrollHeight: request.scrollHeight } : {}),
        attachmentNodeId: idOf(attachment), attachmentX: attachment.x, attachmentY: attachment.y };
      const shorter = lifetime?.relocate?.(request.index, anchor, result, chosen);
      if (shorter) {
        chosen = placeStagePlaques(items, nodes, obstacles, new Map(), measureText, { sizes: lifetime!.sizes,
          includes: index => index === request.index, incumbents: new Map([[request.index, chosen]]),
          spaceFor: () => shorter, caseSources }).get(request.index) ?? chosen;
        placement = chosen;
      }
      return { chosen, placement };
    };
    let { chosen, placement } = select();
    // The plain arrow stays wherever it bends visibly in every scene it is
    // drawn in; only one that clears there but runs too straight is re-placed.
    if (request.caseAssignment && !chosen.caseRoute && !accepts({ ...chosen, caseRoute: PLAIN_CASE_ROUTE }) && accepts(chosen)) {
      bendRoutes = true;
      ({ chosen, placement } = select());
    }
    result.set(request.index, chosen);
    placed.push({ ...placement, blocksConnectors: true },
      ...(request.caseAssignment ? caseRouteRects(anchor, placement, undefined, caseSources) : []));
  }
  return result;
}

/** Native compounds retain their Orchard placement while contributing their full boxes to fitting. */
export function nativeRelationPlaqueRects(items: RelationPlanItem[],
  rectFor: (id: string, terminal: boolean) => PlaqueRect | null, measureText?: PlaqueTextMeasure): PlaqueRect[] {
  return items.flatMap(item => {
    if (item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing') {
      const ids = [...new Set(item.pairs.flatMap(pair => [pair.fromNodeId, pair.toNodeId]))];
      const rects = ids.map(id => rectFor(id, true)).filter((rect): rect is PlaqueRect => rect !== null);
      return rects.length >= 2 ? [featureSharingPlaqueRect(rects, item.label, measureText)] : [];
    }
    if (item.kind !== 'directed-path' || item.pathStyle !== 'dependent-case') return [];
    const probe = rectFor(item.fromNodeId, true), goal = rectFor(item.toNodeId, true);
    const probeCategory = rectFor(item.fromNodeId, false), goalCategory = rectFor(item.toNodeId, false);
    if (!probe || !goal || !probeCategory || !goalCategory) return [];
    return Object.values(dependentCaseStatePlaques(probe, goal, item.label ?? '', item.secondaryLabel ?? '',
      item.dependentCaseStep ?? '2', probeCategory.y + probeCategory.height / 2 <= goalCategory.y + goalCategory.height / 2));
  });
}
