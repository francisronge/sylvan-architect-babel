import type { Point, Rect } from './overlayGeometry.ts';

type Pair = { fromNodeId: string; toNodeId: string };

/** Existing predication elbows, ordered by distance within each predicand. */
export function predicationPaths(pairs: readonly Pair[], rectFor: (id: string) => Rect | null) {
  const groups = new Map<string, { pair: Pair; pairIndex: number }[]>();
  pairs.forEach((pair, pairIndex) => {
    const group = groups.get(pair.fromNodeId) ?? [];
    group.push({ pair, pairIndex });
    groups.set(pair.fromNodeId, group);
  });
  const paths: { pairIndex: number; points: [Point, Point, Point, Point] }[] = [];
  groups.forEach((group, sourceId) => {
    const source = rectFor(sourceId);
    if (!source) return;
    const sourceCenterX = source.x + source.width / 2;
    const resolved = group.flatMap(entry => {
      const target = rectFor(entry.pair.toNodeId);
      return target ? [{ ...entry, target }] : [];
    }).sort((left, right) => Math.abs(left.target.x + left.target.width / 2 - sourceCenterX)
      - Math.abs(right.target.x + right.target.width / 2 - sourceCenterX));
    const lowestAnchor = Math.max(source.y + source.height, ...resolved.map(({ target }) => target.y + target.height));
    resolved.forEach(({ pairIndex, target }, index) => {
      const sourceX = sourceCenterX + (index - (resolved.length - 1) / 2) * 18;
      const targetX = target.x + target.width / 2;
      const laneY = lowestAnchor + 52 + index * 28;
      paths.push({ pairIndex, points: [
        { x: sourceX, y: source.y + source.height + 14 },
        { x: sourceX, y: laneY },
        { x: targetX, y: laneY },
        { x: targetX, y: target.y + target.height + 14 }
      ] });
    });
  });
  return paths;
}
