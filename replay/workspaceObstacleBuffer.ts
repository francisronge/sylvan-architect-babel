import type { PlaqueRect } from './relations/plaquePlacement.ts';
import type { Cubic } from './relations/curveClearance.ts';

/** Immutable contour bounds use doubles without allocating a rectangle for
 * every ancestor translation. Metadata is shared until a curve must move;
 * object rectangles are materialized only for exact contacts or consumers. */
export class WorkspaceObstacleBuffer {
  readonly bounds: Float64Array;
  /** Shared flags and attachment identity; use curve()/rectangle() for translated geometry. */
  readonly metadata: readonly PlaqueRect[];
  private materialized: Array<PlaqueRect | undefined>;
  private all?: readonly PlaqueRect[];
  private resolveCurve?: (index: number) => Cubic | undefined;

  constructor(bounds: Float64Array, metadata: readonly PlaqueRect[], originals?: readonly PlaqueRect[],
    resolveCurve?: (index: number) => Cubic | undefined) {
    this.bounds = bounds;
    this.metadata = metadata;
    this.materialized = originals ? [...originals] : [];
    this.all = originals;
    this.resolveCurve = resolveCurve;
  }

  get length(): number { return this.metadata.length; }

  curve(index: number): Cubic | undefined {
    return this.resolveCurve ? this.resolveCurve(index) : this.metadata[index].curve;
  }

  rectangle(index: number): PlaqueRect {
    let rect = this.materialized[index];
    if (!rect) {
      const offset = index * 4, values = this.bounds;
      rect = { ...this.metadata[index], x: values[offset], y: values[offset + 1],
        width: values[offset + 2], height: values[offset + 3] };
      if (rect.curve) rect.curve = this.curve(index);
      this.materialized[index] = rect;
    }
    return rect;
  }

  rectangles(): readonly PlaqueRect[] {
    return this.all ??= Array.from({ length: this.length }, (_, index) => this.rectangle(index));
  }
}

export function workspaceObstacleBuffer(rectangles: readonly PlaqueRect[] | WorkspaceObstacleBuffer): WorkspaceObstacleBuffer {
  if (rectangles instanceof WorkspaceObstacleBuffer) return rectangles;
  const bounds = new Float64Array(rectangles.length * 4);
  for (let index = 0; index < rectangles.length; index++) {
    const rect = rectangles[index], offset = index * 4;
    bounds[offset] = rect.x; bounds[offset + 1] = rect.y;
    bounds[offset + 2] = rect.width; bounds[offset + 3] = rect.height;
  }
  return new WorkspaceObstacleBuffer(bounds, rectangles, rectangles);
}

/** Keep each parent addition separate. Combining translations would change
 * rounding and signed zero in the original recursively translated geometry.
 * Branches are the six-field samples emitted by plaqueBranchObstacles. */
export function composeWorkspaceObstacleBuffer(own: readonly PlaqueRect[],
  children: readonly { obstacles: WorkspaceObstacleBuffer; x: number; y: number }[],
  branches: readonly PlaqueRect[]): WorkspaceObstacleBuffer {
  const length = own.length + branches.length + children.reduce((sum, child) => sum + child.obstacles.length, 0);
  const bounds = new Float64Array(length * 4), metadata: PlaqueRect[] = [];
  let target = 0;
  const append = (rect: PlaqueRect) => {
    bounds[target++] = rect.x; bounds[target++] = rect.y;
    bounds[target++] = rect.width; bounds[target++] = rect.height;
    metadata.push(rect);
  };
  for (const rect of own) append(rect);
  const childrenByRange: Array<{ start: number; end: number; obstacles: WorkspaceObstacleBuffer;
    x: number; y: number; translated?: Map<Cubic, Cubic> }> = [];
  for (const child of children) {
    const source = child.obstacles.bounds;
    childrenByRange.push({ start: metadata.length, end: metadata.length + child.obstacles.length, ...child });
    for (let index = 0; index < child.obstacles.length; index++) {
      const offset = index * 4;
      bounds[target++] = source[offset] + child.x;
      bounds[target++] = source[offset + 1] + child.y;
      bounds[target++] = source[offset + 2]; bounds[target++] = source[offset + 3];
      metadata.push(child.obstacles.metadata[index]);
    }
  }
  let branchTemplate: PlaqueRect | undefined;
  for (const rect of branches) {
    bounds[target++] = rect.x; bounds[target++] = rect.y;
    bounds[target++] = rect.width; bounds[target++] = rect.height;
    if (!branchTemplate || branchTemplate.curve !== rect.curve
      || !Object.is(branchTemplate.curvePadding, rect.curvePadding))
      branchTemplate = { x: 0, y: 0, width: 0, height: 0, curve: rect.curve, curvePadding: rect.curvePadding };
    metadata.push(branchTemplate);
  }
  // Most rejected trials only consult rectangle bounds. Resolve a native cubic
  // when exact contact needs it, preserving every ancestor addition and sharing
  // one translated curve across its sampled rectangles.
  return new WorkspaceObstacleBuffer(bounds, metadata, undefined, index => {
    const raw = metadata[index].curve;
    if (!raw) return undefined;
    const child = childrenByRange.find(range => index >= range.start && index < range.end);
    if (!child) return raw;
    const source = child.obstacles.curve(index - child.start)!;
    const translated = child.translated ??= new Map<Cubic, Cubic>();
    let curve = translated.get(source);
    if (!curve) {
      curve = { source: { x: source.source.x + child.x, y: source.source.y + child.y },
        control1: { x: source.control1.x + child.x, y: source.control1.y + child.y },
        control2: { x: source.control2.x + child.x, y: source.control2.y + child.y },
        target: { x: source.target.x + child.x, y: source.target.y + child.y } };
      translated.set(source, curve);
    }
    return curve;
  });
}
