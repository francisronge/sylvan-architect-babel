import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import type { RelationPlanItem } from './renderPlanCompiler.ts';
import { preparePlaqueTextLayout, preparePfPlaqueTextLayout } from './plaqueTextLayout.ts';

export type PlaqueRect = { x: number; y: number; width: number; height: number };
type Node = HierarchyPointNode<SyntaxNode>;
export type PlaquePlacement = PlaqueRect & {
  location: 'local' | 'below'; domainId: string;
  attachmentNodeId: string; attachmentX: number; attachmentY: number;
};
/** Identify the same drawn claim across plan frames, never by its changing array position. */
export function plaqueIdentity(item: RelationPlanItem): string {
  return JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex,
    item.kind, item.familyId, item.canonicalClaimIdentity, item.tier2FacetId, item.tier2RenderPart,
    item.kind === 'node-plaque' ? [item.plaqueStyle, item.title, item.anchorNodeIds, item.rows, item.thetaRoles]
      : item.kind === 'directed-path' ? [item.pathStyle, item.fromNodeId, item.toNodeId, item.featureRow] : null]);
}
const idOf = (node: Node): string => String((node as Node & { __vizId?: string }).__vizId ?? node.data.id ?? '');
const visible = (node: Node) => node.data.replayOrigin?.kind !== 'workspace';
const union = (rects: PlaqueRect[]): PlaqueRect => {
  const x = Math.min(...rects.map(rect => rect.x));
  const y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
};
export const plaquesOverlap = (a: PlaqueRect, b: PlaqueRect, gap = 24): boolean =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
  && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

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
export function plaqueTreeObstacles(nodes: Node[]): PlaqueRect[] {
  const rectangles: PlaqueRect[] = [];
  const included = new Set(nodes);
  for (const node of nodes.filter(visible)) {
    const width = Math.max(150, String(node.data.label || '').length * 38);
    rectangles.push({ x: node.x - width / 2, y: node.y - 42, width, height: 84 });
    if (!node.children?.length && node.data.word) {
      const wordWidth = Math.max(150, String(node.data.word).length * 40);
      rectangles.push({ x: node.x - wordWidth / 2, y: node.y + 85, width: wordWidth, height: 90 });
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

/** Geometry only: a common enclosing subtree locates a plaque, never establishes a linguistic domain. */
export function placeStagePlaques(items: RelationPlanItem[], nodes: Node[], obstacles = plaqueTreeObstacles(nodes),
  previous = new Map<string, PlaquePlacement>()) {
  const result = new Map<number, PlaquePlacement>();
  const byId = new Map(nodes.map(node => [idOf(node), node]));
  const occupied: PlaqueRect[] = [...obstacles];
  const requests: Array<{ index: number; ids: string[]; width: number; height: number; caseAssignment?: boolean }> = [];
  items.forEach((item, index) => {
    if (item.kind === 'node-plaque') {
      if (item.plaqueStyle === 'feature') {
        const assignments = items.filter(other => other.kind === 'directed-path'
          && other.pathStyle === 'case-assignment' && other.toNodeId === item.anchorNodeIds[0]
          && other.relationRef.stageIndex === item.relationRef.stageIndex);
        const bundles = items.filter(other => other.kind === 'node-plaque' && other.plaqueStyle === 'feature'
          && other.anchorNodeIds[0] === item.anchorNodeIds[0] && other.relationRef.stageIndex === item.relationRef.stageIndex);
        if (assignments.length === 1 && bundles.length === 1) return;
      }
      let size = preparePlaqueTextLayout(item, { variant: item.plaqueStyle === 'feature' ? 'feature' : 'generic' });
      if (item.plaqueStyle === 'realization') {
        const rows = item.rows.map((row, rowIndex) => ({ ...row, rowIndex,
          kind: item.realizationRowKinds?.[rowIndex], isFinal: rowIndex === item.rows.length - 1 }));
        size = { ...size, ...preparePfPlaqueTextLayout(rows, {
          isZeroRealization: rows.length === 1 && rows[0].kind === 'rewrite' && rows[0].value === '\u2205'
        }), rows: size.rows };
      }
      if (item.plaqueStyle === 'theta-grid') size = { ...size, width: 430, height: 126 };
      requests.push({ index, ids: [...item.anchorNodeIds, ...(item.thetaRoles?.map(role => role.nodeId) || [])],
        width: size.width, height: size.height });
    } else if (item.kind === 'directed-path' && item.pathStyle === 'case-assignment') {
      const assignments = items.filter(other => other.kind === 'directed-path'
        && other.pathStyle === 'case-assignment' && other.toNodeId === item.toNodeId
        && other.relationRef.stageIndex === item.relationRef.stageIndex);
      const bundles = items.filter(other => other.kind === 'node-plaque' && other.plaqueStyle === 'feature'
        && other.anchorNodeIds[0] === item.toNodeId && other.relationRef.stageIndex === item.relationRef.stageIndex);
      const bundle = assignments.length === 1 && bundles.length === 1 && bundles[0].kind === 'node-plaque' ? bundles[0] : null;
      const collections = assignments.length === 1 ? items.filter(other => other.kind === 'directed-path'
        && other.pathStyle === 'case-agree' && other.fromNodeId === item.toNodeId
        && other.relationRef.stageIndex === item.relationRef.stageIndex) : [];
      requests.push({ index, ids: [item.fromNodeId, item.toNodeId], width: 310, caseAssignment: true,
        height: 76 + (bundle?.rows.length ?? 1 + collections.length) * 62 });
    }
  });
  // Persistent boxes keep their pocket. Reserve them before placing newly introduced claims.
  for (const request of requests) {
    const prior = previous.get(plaqueIdentity(items[request.index]));
    const attachment = prior && byId.get(prior.attachmentNodeId);
    if (!prior || !attachment || prior.width !== request.width || prior.height !== request.height) continue;
    const placement = { ...prior, x: prior.x + attachment.x - prior.attachmentX,
      y: prior.y + attachment.y - prior.attachmentY, attachmentX: attachment.x, attachmentY: attachment.y };
    result.set(request.index, placement);
    occupied.push(placement);
  }
  // Local boxes get the nearby pockets first. Large boxes do not consume those pockets.
  requests.sort((a, b) => Number(a.height > 170 || a.width > 480) - Number(b.height > 170 || b.width > 480) || a.index - b.index);
  for (const request of requests) {
    if (result.has(request.index)) continue;
    const anchors = request.ids.map(id => byId.get(id)).filter((node): node is Node => Boolean(node));
    if (!anchors.length) continue;
    const anchor = anchors[0];
    const ancestors = anchor.ancestors();
    let domain = ancestors.find(candidate => visible(candidate) && anchors.every(node => node.ancestors().includes(candidate))) || anchor;
    if (anchors.length === 1 && !domain.children?.length && domain.parent && visible(domain.parent)) domain = domain.parent;
    const availableNodes = new Set(nodes);
    const domainBounds = union(plaqueTreeObstacles(domain.descendants().filter(node => availableNodes.has(node))));
    const { width, height } = request;
    const local = height <= 170 && width <= 480;
    const terminal = request.caseAssignment ? anchor.descendants().filter(node => !node.children?.length && node.data.word) : [];
    const anchorY = terminal.length === 1 ? terminal[0].y + 140
      : anchor.y + (!anchor.children?.length && anchor.data.word ? 140 : 0);
    const candidates = request.caseAssignment ? [70, 140, -height - 70].flatMap(dy =>
      [anchor.x + 110, anchor.x - width - 110, anchor.x - width / 2]
        .map(x => ({ x, y: anchorY + dy, width, height })))
      : local ? [-height - 60, -height / 2, 55, 115, 175, 235]
      .flatMap(dy => [anchor.x + 110, anchor.x - width - 110, anchor.x - width / 2]
        .map(x => ({ x, y: anchorY + dy, width, height })))
      .sort((a, b) => Math.hypot(a.x + width / 2 - anchor.x, a.y + height / 2 - anchorY)
        - Math.hypot(b.x + width / 2 - anchor.x, b.y + height / 2 - anchorY)) : [];
    let placement = candidates.find(candidate => occupied.every(obstacle => !plaquesOverlap(candidate, obstacle)));
    const location = placement ? 'local' : 'below';
    if (!placement) {
      // Stay horizontally under this subtree; only grow downward when another box or branch occupies it.
      const x = domainBounds.x + domainBounds.width / 2 - width / 2;
      let y = domainBounds.y + domainBounds.height + 60;
      for (;;) {
        const collisions = occupied.filter(obstacle => plaquesOverlap({ x, y, width, height }, obstacle));
        if (!collisions.length) break;
        y = Math.max(...collisions.map(obstacle => obstacle.y + obstacle.height)) + 32;
      }
      placement = { x, y, width, height };
    }
    const attachment = location === 'local' ? anchor : domain;
    result.set(request.index, { ...placement, location, domainId: idOf(domain),
      attachmentNodeId: idOf(attachment), attachmentX: attachment.x, attachmentY: attachment.y });
    occupied.push(placement);
  }
  return result;
}
