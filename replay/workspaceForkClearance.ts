import type { PlaqueRect } from './relations/plaquePlacement.ts';
import { cubicIntersectsRect } from './relations/curveClearance.ts';
import { WorkspaceObstacleBuffer } from './workspaceObstacleBuffer.ts';

type Point = { x: number; y: number };
type ChildInk = { point: Point; obstacles: readonly PlaqueRect[] | WorkspaceObstacleBuffer };

/** Child contours exclude the incoming fork edges. Check those native cubics
 * separately against other children's ink, using the same branch envelope as
 * plaqueTreeObstacles. Obstacles are local to their current child root. */
export function currentForkBranchesClear(parent: Point, children: readonly ChildInk[]): boolean {
  return currentForkBranchCollision(parent, children) === undefined;
}

/** Return the same rejected contact for measured backward-clearance planning. */
export function currentForkBranchCollision(parent: Point, children: readonly ChildInk[]): { childIndex: number; obstacle: PlaqueRect } | undefined {
  if (children.length < 2) return undefined;
  for (const [index, child] of children.entries()) {
    const middle = (parent.y + child.point.y) / 2;
    const curve = { source: parent, control1: { x: parent.x, y: middle },
      control2: { x: child.point.x, y: middle }, target: child.point };
    const minX = Math.min(parent.x, child.point.x) - 5, maxX = Math.max(parent.x, child.point.x) + 5;
    const minY = Math.min(parent.y, child.point.y) - 5, maxY = Math.max(parent.y, child.point.y) + 5;
    for (const [otherIndex, other] of children.entries()) {
      if (otherIndex === index) continue;
      const buffered = other.obstacles instanceof WorkspaceObstacleBuffer ? other.obstacles : undefined;
      const obstacles = buffered ? buffered.metadata : other.obstacles as readonly PlaqueRect[];
      for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
        const metadata = obstacles[obstacleIndex];
        // Equal-rank ordered forks end above their children's internal branches.
        // The missed collisions are ink rising above a different child root.
        if (metadata.curve) continue;
        const offset = obstacleIndex * 4, bounds = buffered?.bounds;
        const x = (bounds ? bounds[offset] : metadata.x) + other.point.x;
        const y = (bounds ? bounds[offset + 1] : metadata.y) + other.point.y;
        const width = bounds ? bounds[offset + 2] : metadata.width;
        const height = bounds ? bounds[offset + 3] : metadata.height;
        if (x >= maxX || x + width <= minX || y >= maxY || y + height <= minY) continue;
        const obstacle = buffered ? buffered.rectangle(obstacleIndex) : metadata;
        const rect = { ...obstacle, x, y };
        if (cubicIntersectsRect(curve, rect, 5)) return { childIndex: otherIndex, obstacle };
      }
    }
  }
  return undefined;
}
