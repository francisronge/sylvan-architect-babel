import { categoryTextLayout, CATEGORY_LINE_HEIGHT, type CategoryTextMeasure } from '../categoryTextLayout.ts';
import { isWordlessCategoryLeaf, shouldExpandPreterminalLeaf } from '../replayCompiler.ts';
import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import { planItemRelationRefs, type RelationPlanItem } from './renderPlanCompiler.ts';
import { featureSharingPlaqueRect, dependentCaseStatePlaques, sampleCubic } from './markGeometry.ts';
import { caseAssignmentPlaqueCurve, featureCollectionPlaqueCurve } from './overlayGeometry.ts';
import { caseFeatureComposition, collectionPlaque, featurePlaqueAssignment, featureRowKey, pathFeatureRow } from './featureComposition.ts';
import { prepareCasePlaqueRows, preparePlaqueTextLayout, preparePfPlaqueTextLayout, prepareThetaGridTextLayout, type PlaqueTextMeasure } from './plaqueTextLayout.ts';

export type PlaqueRect = { x: number; y: number; width: number; height: number; extendsDownward?: boolean;
  caseRowY?: number; collectionRows?: CollectionRow[]; blocksConnectors?: boolean; connectorAttachment?: string;
  connectorInk?: { x: number; y: number; width: number; height: number } };
type CollectionRow = { sourceNodeId: string; y: number; lane?: number; ownerKeys?: string[] };
type Node = HierarchyPointNode<SyntaxNode>;
export type PlaquePlacement = PlaqueRect & {
  location: 'local' | 'below'; domainId: string;
  scrollHeight?: number;
  attachmentNodeId: string; attachmentX: number; attachmentY: number;
};
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
const fitsLocalPocket = ({ width, height }: Pick<PlaqueRect, 'width' | 'height'>) => Math.max(width, height) <= 480;
export function thetaGridPredicateLabel(anchor: Pick<Node, 'data' | 'children'>): string {
  let node = anchor;
  // A unary display shell can expose its own word; branching cannot select a head.
  while (!String(node.data.word || '').trim() && node.children?.length === 1) node = node.children[0];
  return String(node.data.word || anchor.data.label || 'predicate');
}
const union = (rects: PlaqueRect[]): PlaqueRect => {
  const x = Math.min(...rects.map(rect => rect.x));
  const y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
};
export const plaquesOverlap = (a: PlaqueRect, b: PlaqueRect, gap = 24): boolean =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
  && (b.extendsDownward || a.y < b.y + b.height + gap)
  && (a.extendsDownward || a.y + a.height + gap > b.y);

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

/** Reserve labels, words, and sampled native cubic branches, including future stage syntax. */
export function plaqueTreeObstacles(nodes: Node[], measureCategoryText?: CategoryTextMeasure): PlaqueRect[] {
  const rectangles: PlaqueRect[] = [];
  const included = new Set(nodes);
  for (const node of nodes.filter(visible)) {
    const label = categoryTextLayout(node.data.label || '', measureCategoryText);
    const width = Math.max(150, String(node.data.label || '').length * 38);
    const hasCategory = Boolean(node.children?.length) || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data);
    if (hasCategory) rectangles.push({ ...(label.lines.length > 1
      ? { x: node.x + label.x - 8, y: node.y + label.y - 8, width: label.width + 16, height: label.height + 16 }
      : { x: node.x - width / 2, y: node.y - 42, width, height: 84 }),
      blocksConnectors: label.lines.length === 1, connectorAttachment: `${idOf(node)}:category`,
      ...(label.lines.length === 1 ? { connectorInk: { x: node.x + label.x, y: node.y + label.y,
        width: label.width, height: label.height } } : {}) });
    if (hasCategory && label.lines.length > 1) label.lines.forEach((line, index) => {
      const lineWidth = measureCategoryText?.(line) ?? [...line].length * 25;
      rectangles.push({ x: node.x - lineWidth / 2 - 4, y: node.y + label.y + index * CATEGORY_LINE_HEIGHT - 4,
        width: lineWidth + 8, height: 60, blocksConnectors: true, connectorAttachment: `${idOf(node)}:category` });
    });
    if (!node.children?.length && node.data.word) {
      const wordWidth = Math.max(150, String(node.data.word).length * 40);
      rectangles.push({ x: node.x - wordWidth / 2, y: node.y + 65, width: wordWidth, height: 110,
        blocksConnectors: true, connectorAttachment: `${idOf(node)}:terminal` });
      rectangles.push({ x: node.x - 6, y: node.y, width: 12, height: 130 });
    }
    const parent = node.parent;
    if (!parent || !included.has(parent) || !visible(parent)) continue;
    // d3.linkVertical uses control points at the vertical midpoint.
    let previous = { x: parent.x, y: parent.y };
    for (let i = 1; i <= 32; i++) {
      const t = i / 32;
      const u = 1 - t;
      const middleY = (parent.y + node.y) / 2;
      const point = { x: (u ** 3 + 3 * u * u * t) * parent.x + (3 * u * t * t + t ** 3) * node.x,
        y: u ** 3 * parent.y + (3 * u * u * t + 3 * u * t * t) * middleY + t ** 3 * node.y };
      rectangles.push({ x: Math.min(previous.x, point.x) - 5, y: Math.min(previous.y, point.y) - 5,
        width: Math.abs(previous.x - point.x) + 10, height: Math.abs(previous.y - point.y) + 10 });
      previous = point;
    }
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
    const bounds = union(plaqueTreeObstacles(subtree));
    // Allow a label-height of clearance for the estimated text centre. The
    // browser attaches to measured ink; neither attachment nor path is moved.
    const x = bounds.x + bounds.width / 2, y = Math.max(...subtree.map(node => node.y)) - 42;
    return [{ x: x - 42, y, width: 84, height: bottom - y, extendsDownward: true }];
  });
}

type PlaqueRequest = { index: number; ids: string[]; width: number; height: number; scrollHeight?: number; caseAssignment?: boolean; caseRowY?: number; collectionRows?: CollectionRow[] };

/** A single word can carry a head's mark; a complex head retains its own category anchor. */
export function caseAssignmentSource(node: Node): Node {
  const terminals = node.descendants().filter(child => !child.children?.length && Boolean(child.data.word));
  return terminals.length === 1 ? terminals[0] : node;
}

const caseSourceRect = (anchor: Node): PlaqueRect => {
  const source = caseAssignmentSource(anchor);
  const word = !source.children?.length && source.data.word;
  const label = categoryTextLayout(source.data.label || '');
  return { x: source.x - (word ? 75 : label.width / 2), y: source.y + (word ? 65 : label.y),
    width: word ? 150 : label.width, height: word ? 60 : label.height };
};

const caseRouteRects = (anchor: Node, box: PlaqueRect): PlaqueRect[] => {
  const { source, control1, control2, target } = caseAssignmentPlaqueCurve(caseSourceRect(anchor), box, box.y + (box.caseRowY ?? 93));
  const points = sampleCubic(source, control1, control2, target, 32);
  return points.slice(1).map((point, i) => ({
    x: Math.min(points[i].x, point.x) - 8, y: Math.min(points[i].y, point.y) - 8,
    width: Math.abs(points[i].x - point.x) + 16, height: Math.abs(points[i].y - point.y) + 16
  }));
};

/** Test the drawn approach against opaque ink, leaving its own attachment available. */
export function caseAssignmentClears(anchor: Node, box: PlaqueRect, obstacles: PlaqueRect[]): boolean {
  const source = caseAssignmentSource(anchor);
  const attachment = `${idOf(source)}:${!source.children?.length && source.data.word ? 'terminal' : 'category'}`;
  const blockers = obstacles.filter(rect => rect.blocksConnectors && rect.connectorAttachment !== attachment);
  return caseRouteRects(anchor, box).every(segment => blockers.every(rect => !plaquesOverlap(segment, rect, 0)));
}

function collectionCurves(box: PlaqueRect, nodes: Node[], obstacles: PlaqueRect[] = []) {
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  return (box.collectionRows ?? []).flatMap(row => {
    const node = byId.get(row.sourceNodeId);
    if (!node) return [];
    const labels = [...obstacles, ...plaqueTreeObstacles([node])];
    const attachment = labels.find(rect => rect.connectorAttachment === `${row.sourceNodeId}:category`)
      ?? labels.find(rect => rect.connectorAttachment === `${row.sourceNodeId}:terminal`);
    if (!attachment) return [];
    return [{ row, attachment,
      ...featureCollectionPlaqueCurve(box, box.y + row.y, attachment.connectorInk ?? attachment, row.lane ?? 0) }];
  });
}

const collectionRouteRects = (curve: ReturnType<typeof featureCollectionPlaqueCurve>) => {
  const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 32);
  return points.slice(1).map((point, i) => ({
    x: Math.min(points[i].x, point.x) - 6, y: Math.min(points[i].y, point.y) - 6,
    width: Math.abs(points[i].x - point.x) + 12, height: Math.abs(points[i].y - point.y) + 12
  }));
};

/** Fixed Orchard collection curves stay clear by placement, never by rerouting. */
export function collectionPlaqueClears(box: PlaqueRect, nodes: Node[], obstacles: PlaqueRect[]): boolean {
  return collectionCurves(box, nodes, obstacles).every(({ attachment, row: _row, ...curve }) =>
    collectionRouteRects(curve).every(segment => [box, ...obstacles.filter(rect => rect.blocksConnectors
      && rect.connectorAttachment !== attachment.connectorAttachment)]
      .every(obstacle => !plaquesOverlap(segment, obstacle.connectorInk ?? obstacle, 0))));
}

/** Candidate heights at which the fixed Orchard curve passes an opaque corner. */
export function collectionPlaqueCandidateYs(box: PlaqueRect, nodes: Node[], obstacles: PlaqueRect[]): number[] {
  return collectionCurves(box, nodes, obstacles).flatMap(({ row, attachment, source, target, control1, control2 }) => {
    return obstacles.filter(rect => rect.blocksConnectors && rect.connectorAttachment !== attachment.connectorAttachment)
      .flatMap(obstacle => {
        const rect = obstacle.connectorInk ?? obstacle;
        return Array.from({ length: 63 }, (_, i) => (i + 1) / 64).flatMap(t => {
          const u = 1 - t;
          const x = u ** 3 * source.x + 3 * u * u * t * control1.x
            + 3 * u * t * t * control2.x + t ** 3 * target.x;
          if (x < rect.x - 8 || x > rect.x + rect.width + 8) return [];
          const targetWeight = 3 * u * t * t + t ** 3;
          const sourceWeight = 1 - targetWeight;
          return [rect.y - 8, rect.y + rect.height + 8].map(y =>
            (y - target.y * targetWeight) / sourceWeight - row.y);
        });
      });
  });
}

/** Reserve collections before other plaques choose their lifetime pockets. */
export function plaqueCollectionConnectorObstacles(nodes: Node[], layout: Map<number, PlaquePlacement>): PlaqueRect[] {
  return [...layout.values()].flatMap(box => collectionCurves(box, nodes)
    .flatMap(({ row: _row, attachment: _attachment, ...curve }) => collectionRouteRects(curve)));
}

/** Reserve the same curved approach as the painter, including carried claims. */
export function plaqueCaseConnectorObstacles(items: RelationPlanItem[], nodes: Node[], layout: Map<number, PlaquePlacement>): PlaqueRect[] {
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  return [...layout].flatMap(([index, box]) => {
    const item = items[index];
    const anchor = item?.kind === 'directed-path' && item.pathStyle === 'case-assignment' && byId.get(item.fromNodeId);
    return anchor ? caseRouteRects(anchor, box) : [];
  });
}

/** Measure content independently of allocation so its whole lifetime can reserve one size. */
export function prepareStagePlaqueRequests(items: RelationPlanItem[], nodes: Node[], measureText?: PlaqueTextMeasure): PlaqueRequest[] {
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  const requests: PlaqueRequest[] = [];
  items.forEach((item, index) => {
    if (item.kind === 'node-plaque') {
      if (item.plaqueStyle === 'feature') {
        if (featurePlaqueAssignment(items, index) !== undefined) return;
      }
      let size = preparePlaqueTextLayout(item, { variant: item.plaqueStyle === 'feature' ? 'feature' : 'generic' });
      if (item.plaqueStyle === 'realization') {
        const rows = item.rows.map((row, rowIndex) => ({ ...row, rowIndex,
          kind: item.realizationRowKinds?.[rowIndex], isFinal: rowIndex === item.rows.length - 1 }));
        size = { ...size, ...preparePfPlaqueTextLayout(rows, {
          isZeroRealization: rows.length === 1 && rows[0].kind === 'rewrite' && rows[0].value === '\u2205'
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
        return [{ sourceNodeId: candidate.toNodeId, y: (first.y - first.ascent + last.y + last.descent) / 2,
          ownerKeys: planItemRelationRefs(candidate).map(ref => `${ref.stageIndex}:${ref.relationIndex}`) }];
      }) : [];
      requests.push({ index, ids: [...item.anchorNodeIds, ...(item.thetaRoles?.map(role => role.nodeId) || [])],
        width: size.width, height: size.height, ...(collectionRows.length ? { collectionRows } : {}),
        ...(size.overflow ? { scrollHeight: size.height } : {}) });
    } else if (item.kind === 'directed-path' && item.pathStyle === 'case-assignment') {
      const composition = caseFeatureComposition(items, index)!;
      const size = prepareCasePlaqueRows(composition.rows);
      const collectionRows = composition.collections.map(({ item, index }, lane) => ({ sourceNodeId: item.toNodeId, lane,
        ownerKeys: planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`),
        y: size.rows[composition.rows.findIndex(row => row.ownerIndices.includes(index))].y }));
      requests.push({ index, ids: [item.fromNodeId, item.toNodeId], width: size.width, caseAssignment: true,
        height: size.height, caseRowY: size.rows[composition.rows.findIndex(row => row.ownerIndices.includes(index))].y,
        ...(collectionRows.length ? { collectionRows } : {}) });
    }
  });
  return requests;
}

type PlaqueLifetime = {
  sizes: ReadonlyMap<string, Pick<PlaqueRect, 'width' | 'height'>>;
  collectionsOnly?: boolean;
  spaceFor: (index: number, anchor: Node, allocated: Map<number, PlaquePlacement>) => {
    obstacles: PlaqueRect[];
    acceptsConnector: (box: PlaqueRect) => boolean;
    connectorCandidateYs?: (box: PlaqueRect) => number[];
  };
};

/** Geometry only: a common enclosing subtree locates a plaque, never establishes a linguistic domain. */
export function placeStagePlaques(items: RelationPlanItem[], nodes: Node[], obstacles = plaqueTreeObstacles(nodes),
  previous = new Map<string, PlaquePlacement>(), measureText?: PlaqueTextMeasure, lifetime?: PlaqueLifetime) {
  const result = new Map<number, PlaquePlacement>();
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  const placed: PlaqueRect[] = [];
  const requests = prepareStagePlaqueRequests(items, nodes, measureText).map(request => ({ ...request,
    ...lifetime?.sizes.get(plaqueIdentity(items[request.index])) }))
    .filter(request => !lifetime?.collectionsOnly || request.collectionRows?.length);
  // Lifetime reservations already cover future syntax. Standalone one-stage
  // callers must still reject an obsolete pocket supplied by their caller.
  for (const request of requests) {
    const prior = previous.get(plaqueIdentity(items[request.index]));
    const attachment = prior && byId.get(prior.attachmentNodeId);
    if (!prior || !attachment || prior.width !== request.width || prior.height !== request.height) continue;
    const placement = { ...prior, x: prior.x + attachment.x - prior.attachmentX,
      y: prior.y + attachment.y - prior.attachmentY, attachmentX: attachment.x, attachmentY: attachment.y,
      ...(request.caseRowY !== undefined ? { caseRowY: request.caseRowY } : {}),
      ...(request.collectionRows ? { collectionRows: request.collectionRows } : {}) };
    const space = lifetime?.spaceFor(request.index, attachment, result);
    const occupied = [...(space?.obstacles ?? obstacles), ...placed];
    const connectorsClear = space ? space.acceptsConnector(placement)
      : (!request.caseAssignment || caseAssignmentClears(attachment, placement, occupied))
        && collectionPlaqueClears(placement, nodes, occupied);
    if (occupied.some(obstacle => plaquesOverlap(placement, obstacle)) || !connectorsClear) continue;
    result.set(request.index, placement);
    placed.push({ ...placement, blocksConnectors: true },
      ...(request.caseAssignment ? caseRouteRects(attachment, placement) : []));
  }
  // Local boxes get the nearby pockets first. Large boxes do not consume those pockets.
  requests.sort((a, b) => Number(!fitsLocalPocket(a)) - Number(!fitsLocalPocket(b)) || a.index - b.index);
  for (const request of requests) {
    if (result.has(request.index)) continue;
    const anchors = request.ids.map(id => byId.get(id)).filter((node): node is Node => Boolean(node));
    if (!anchors.length) continue;
    const anchor = anchors[0];
    const space = lifetime?.spaceFor(request.index, anchor, result);
    const occupied = [...(space?.obstacles ?? obstacles), ...placed];
    const clear = (candidate: PlaqueRect) => {
      const box = { ...candidate, caseRowY: request.caseRowY, collectionRows: request.collectionRows };
      return occupied.every(obstacle => !plaquesOverlap(candidate, obstacle))
        && (space ? space.acceptsConnector(box)
          : (!request.caseAssignment || caseAssignmentClears(anchor, box, occupied))
            && collectionPlaqueClears(box, nodes, occupied));
    };
    const ancestors = anchor.ancestors();
    let domain = ancestors.find(candidate => visible(candidate) && anchors.every(node => node.ancestors().includes(candidate))) || anchor;
    if (anchors.length === 1 && !domain.children?.length && domain.parent && visible(domain.parent)) domain = domain.parent;
    const availableNodes = new Set(nodes);
    const domainBounds = union(plaqueTreeObstacles(domain.descendants().filter(node => availableNodes.has(node))));
    const { width, height } = request;
    const local = fitsLocalPocket(request);
    const terminal = request.caseAssignment ? anchor.descendants().filter(node => !node.children?.length && node.data.word) : [];
    const anchorY = terminal.length === 1 ? terminal[0].y + 140
      : anchor.y + (!anchor.children?.length && anchor.data.word ? 140 : 0);
    const candidates = request.caseAssignment ? [70, 140, -height - 70].flatMap(dy =>
      [anchor.x + 110, anchor.x - width - 110, anchor.x - width / 2]
        .map(x => ({ x, y: anchorY + dy - ((request.caseRowY ?? 93) - 93), width, height })))
      : local ? [-height - 60, -height / 2, 55, 115, 175, 235]
      .flatMap(dy => [anchor.x + 110, anchor.x - width - 110, anchor.x - width / 2]
        .map(x => ({ x, y: anchorY + dy, width, height })))
      .sort((a, b) => Math.hypot(a.x + width / 2 - anchor.x, a.y + height / 2 - anchorY)
        - Math.hypot(b.x + width / 2 - anchor.x, b.y + height / 2 - anchorY)) : [];
    let placement = candidates.find(clear);
    if (!placement && local) {
      // Search the nearest clear pocket, including one just beyond the initial
      // candidates. A radius cutoff would send a local claim below its subtree.
      const gap = 24 + 1e-6;
      const horizontalGap = (x: number) => request.caseAssignment
        ? Math.max(x - anchor.x, anchor.x - x - width, 0) : Math.abs(x + width / 2 - anchor.x);
      const xs = [...new Set([...candidates.map(box => box.x), ...occupied.flatMap(box =>
        [box.x - width - gap, box.x + box.width + gap])])]
        .sort((a, b) => horizontalGap(a) - horizontalGap(b));
      let bestDistance = Infinity;
      for (const x of xs) {
        const dx = horizontalGap(x);
        if (dx * dx >= bestDistance) break;
        const intervals = occupied.filter(box => x < box.x + box.width + gap && x + width + gap > box.x)
          .map(box => [box.y - height - gap, box.extendsDownward ? Infinity : box.y + box.height + gap]).sort((a, b) => a[0] - b[0]);
        const merged: number[][] = [];
        for (const interval of intervals) {
          const last = merged[merged.length - 1];
          if (last && interval[0] < last[1]) last[1] = Math.max(last[1], interval[1]);
          else merged.push(interval);
        }
        const idealY = request.caseAssignment ? anchorY + 163 - (request.caseRowY ?? 93) : anchorY - height / 2;
        // The nearest box-sized gap can still put the curved approach through
        // another label. Consider the remaining gap edges before falling below.
        const candidate = { x, y: 0, width, height, collectionRows: request.collectionRows };
        const rawConnectorLanes = request.collectionRows?.length ? [
          ...(space?.connectorCandidateYs?.(candidate) ?? collectionPlaqueCandidateYs(candidate, nodes, occupied)),
          ...Array.from({ length: 33 }, (_, lane) => idealY + (lane - 16) * 40)
        ] : [];
        const connectorLanes = rawConnectorLanes.flatMap(y => [y, y - 16, y + 16]);
        const ys = [...new Set([idealY, ...connectorLanes, ...merged.flat()])].filter(Number.isFinite)
          .sort((a, b) => Math.abs(a - idealY) - Math.abs(b - idealY));
        for (const y of ys) {
          const dy = y - idealY;
          const route = request.caseAssignment ? caseAssignmentPlaqueCurve(caseSourceRect(anchor),
            { x, y, width, height }, y + (request.caseRowY ?? 93)) : null;
          const points = route && sampleCubic(route.source, route.control1, route.control2, route.target, 16);
          const distance = points ? points.slice(1).reduce((length, point, i) =>
            length + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0) ** 2 : dx * dx + dy * dy;
          if (!request.caseAssignment && distance >= bestDistance) break;
          if (distance < bestDistance && clear({ x, y, width, height })) {
            placement = { x, y, width, height }; bestDistance = distance;
          }
        }
      }
    }
    const location = placement ? 'local' : 'below';
    if (!placement) {
      // A connector's lower lane clears all plaques, so its stems extend past
      // every below-tree plaque. Choose the nearest clear column before stacking.
      const idealX = domainBounds.x + domainBounds.width / 2 - width / 2;
      const stems = occupied.filter(box => box.extendsDownward);
      const gap = 24 + 1e-6;
      const x = [idealX, ...stems.flatMap(box => [box.x - width - gap, box.x + box.width + gap])]
        .sort((a, b) => Math.abs(a - idealX) - Math.abs(b - idealX) || a - b)
        .find(x => stems.every(box => x + width + 24 <= box.x || x >= box.x + box.width + 24))!;
      let y = domainBounds.y + domainBounds.height + 60;
      for (;;) {
        const collisions = occupied.filter(obstacle => plaquesOverlap({ x, y, width, height }, obstacle));
        if (!collisions.length) break;
        y = Math.max(...collisions.map(obstacle => obstacle.y + obstacle.height)) + 32;
      }
      placement = { x, y, width, height };
    }
    placement = { ...placement, ...(request.caseRowY ? { caseRowY: request.caseRowY } : {}),
      ...(request.collectionRows ? { collectionRows: request.collectionRows } : {}) };
    const attachment = anchor;
    result.set(request.index, { ...placement, location, domainId: idOf(domain),
      ...(request.scrollHeight ? { scrollHeight: request.scrollHeight } : {}),
      attachmentNodeId: idOf(attachment), attachmentX: attachment.x, attachmentY: attachment.y });
    placed.push({ ...placement, blocksConnectors: true },
      ...(request.caseAssignment ? caseRouteRects(anchor, placement) : []));
  }
  return result;
}

/** Native compounds retain their Orchard placement while contributing their full boxes to fitting. */
export function nativeRelationPlaqueRects(items: RelationPlanItem[],
  rectFor: (id: string, terminal: boolean) => PlaqueRect | null): PlaqueRect[] {
  return items.flatMap(item => {
    if (item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing') {
      const ids = [...new Set(item.pairs.flatMap(pair => [pair.fromNodeId, pair.toNodeId]))];
      const rects = ids.map(id => rectFor(id, true)).filter((rect): rect is PlaqueRect => rect !== null);
      return rects.length >= 2 ? [featureSharingPlaqueRect(rects)] : [];
    }
    if (item.kind !== 'directed-path' || item.pathStyle !== 'dependent-case') return [];
    const probe = rectFor(item.fromNodeId, true), goal = rectFor(item.toNodeId, true);
    const probeCategory = rectFor(item.fromNodeId, false), goalCategory = rectFor(item.toNodeId, false);
    if (!probe || !goal || !probeCategory || !goalCategory) return [];
    return Object.values(dependentCaseStatePlaques(probe, goal, item.label ?? '', item.secondaryLabel ?? '',
      item.dependentCaseStep ?? '2', probeCategory.y + probeCategory.height / 2 <= goalCategory.y + goalCategory.height / 2));
  });
}
