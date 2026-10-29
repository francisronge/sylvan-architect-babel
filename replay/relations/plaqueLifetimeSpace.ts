import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import { prepareImmutableObstacleTranslations, translateObstacle } from './plaqueObstacleIndex.ts';
import {
  casePlaqueSpace,
  collectionPlaqueSpace,
  exactNumber,
  prepareConnectorScene,
  prepareUniquePlaqueObstacles,
  projectPlaqueContent,
  type CaseSourceRects,
  type ConnectorScene,
  type PlaqueRect,
  type PlaqueRequest,
  type PlaqueSpace
} from './plaquePlacement.ts';

type Node = HierarchyPointNode<SyntaxNode>;
type CrossingRoutes = ReturnType<ReturnType<typeof collectionPlaqueSpace>['crossingRoutes']>;

/** One scene of a plaque's lifetime in its own coordinates. `dx`/`dy` carry it to
 * the anchor being allocated; `added` holds the other plaques shown there and
 * their connectors. `owner`, the plaque's plaqueIdentity, skips the obstacles that
 * enclose it (PlaqueRect, `enclosedPlaques`). */
export type LifetimeScene = {
  nodes: Node[]; obstacles: PlaqueRect[]; added: PlaqueRect[]; owner?: string;
  anchor: Node; request: PlaqueRequest; dx: number; dy: number;
  caseVisible: boolean; rowVisible: (owners: string[] | undefined) => boolean;
};

/** Lifetime spaces for one schedule. Scene nodes and obstacles must stay unchanged
 * while it allocates: their connector structures are shared by every plaque.
 * `caseSources` supplies each scene's measured Case source boxes. */
export function prepareLifetimePlaqueSpaces(caseSources?: CaseSourceRects) {
  const translate = prepareImmutableObstacleTranslations();
  const connectorScenes = new WeakMap<readonly PlaqueRect[], ConnectorScene>();
  const connectorScene = ({ nodes, obstacles }: LifetimeScene) => {
    let scene = connectorScenes.get(obstacles);
    if (!scene || scene.nodes !== nodes) connectorScenes.set(obstacles, scene = prepareConnectorScene(nodes, obstacles));
    return scene;
  };
  // Which obstacles of a scene differ from those of the scene before it in some
  // lifetime. Equal plain boxes stay equal under one shared translation; curves
  // are always rechecked, since translation rebuilds their points.
  const changes = new WeakMap<readonly PlaqueRect[], WeakMap<readonly PlaqueRect[], number[]>>();
  const changedSince = (previous: readonly PlaqueRect[], obstacles: readonly PlaqueRect[]) => {
    let byPrevious = changes.get(obstacles), changed = byPrevious?.get(previous);
    if (!changed) {
      const prior = prepareUniquePlaqueObstacles();
      previous.forEach(box => { if (!box.curve) prior.add(box); });
      changed = [];
      obstacles.forEach((box, index) => { if (box.curve || !prior.has(box)) changed!.push(index); });
      if (!byPrevious) changes.set(obstacles, byPrevious = new WeakMap());
      byPrevious.set(previous, changed);
    }
    return changed;
  };
  /** uniquePlaqueObstacles over every scene's translated fixed and added boxes, in
   * order. A box equal to one the preceding scene contributed at the same
   * translation is already present, and need not be tested again. */
  const lifetimeObstacles = (scenes: readonly LifetimeScene[]) => {
    const unique = prepareUniquePlaqueObstacles(), obstacles: PlaqueRect[] = [];
    let previous: LifetimeScene | undefined;
    for (const scene of scenes) {
      const fixed = translate(scene.obstacles, scene.dx, scene.dy), owner = scene.owner;
      const blocks = (box: PlaqueRect) => owner === undefined || !box.enclosedPlaques?.has(owner);
      const carried = previous && Object.is(previous.dx, scene.dx) && Object.is(previous.dy, scene.dy) && previous.owner === owner;
      if (carried) for (const index of changedSince(previous!.obstacles, scene.obstacles)) {
        if (blocks(fixed[index]) && unique.add(fixed[index])) obstacles.push(fixed[index]);
      } else for (const box of fixed) if (blocks(box) && unique.add(box)) obstacles.push(box);
      if (!carried || scene.added !== previous!.added) for (const added of scene.added) {
        const box = translateObstacle(added, scene.dx, scene.dy);
        if (unique.add(box)) obstacles.push(box);
      }
      previous = scene;
    }
    return obstacles;
  };
  return (scenes: readonly LifetimeScene[]): PlaqueSpace => {
    const views = scenes.map(scene => {
      const fixed = connectorScene(scene);
      let collection: ReturnType<typeof collectionPlaqueSpace> | undefined;
      let caseClears: ReturnType<typeof casePlaqueSpace> | undefined;
      return { scene, fixed,
        get collection() { return collection ??= collectionPlaqueSpace(fixed, scene.added); },
        get caseClears() { return caseClears ??= casePlaqueSpace(fixed, scene.anchor, scene.added, caseSources); } };
    });
    // Scenes with the same offset and source ink draw identical routes, whose
    // equal blockers give equal hints. Within such a group each scene adds only
    // its blockers that its predecessor lacks: every omitted hint already precedes it.
    const plans = new Map<string, { group: number; fixed: readonly number[] }[]>();
    const planFor = (rows: readonly { sourceNodeId: string }[]) => {
      const sourceIds = JSON.stringify(rows.map(row => row.sourceNodeId));
      let plan = plans.get(sourceIds);
      if (!plan) {
        const groups = new Map<string, { group: number; scene: ConnectorScene }>();
        plan = views.map(view => {
          let key = `${exactNumber(view.scene.dx)} ${exactNumber(view.scene.dy)}`;
          for (const row of rows) key += `|${view.collection.sourceKey(row.sourceNodeId)}`;
          const prior = groups.get(key), group = prior?.group ?? groups.size;
          groups.set(key, { group, scene: view.fixed });
          return { group, fixed: prior ? view.fixed.blockersSince(prior.scene) : view.fixed.distinctBlockers() };
        });
        plans.set(sourceIds, plan);
      }
      return plan;
    };
    const candidates = (box: PlaqueRect, axis: 'x' | 'y') => {
      const values: number[] = [];
      if (!box.collectionRows?.length) return values;
      const routes: CrossingRoutes[] = [];
      planFor(box.collectionRows).forEach(({ group, fixed }, index) => {
        const { collection, scene: { dx, dy } } = views[index], offset = axis === 'x' ? dx : dy, start = values.length;
        routes[group] ??= collection.crossingRoutes({ ...box, x: box.x - dx, y: box.y - dy }, axis);
        collection.pushCandidates(routes[group], box[axis] - offset, axis, fixed, values);
        for (let i = start; i < values.length; i++) values[i] += offset;
      });
      return values;
    };
    const project = ({ scene }: (typeof views)[number], box: PlaqueRect) =>
      projectPlaqueContent({ ...box, x: box.x - scene.dx, y: box.y - scene.dy }, scene.request);
    const arrowClears = (view: (typeof views)[number], box: PlaqueRect, projected = project(view, box)) =>
      box.caseRowY === undefined || !view.scene.caseVisible || view.caseClears(projected);
    const accepts = (view: (typeof views)[number], box: PlaqueRect) => {
      const { scene } = view, projected = project(view, box);
      projected.collectionRows = projected.collectionRows?.filter(row => scene.rowVisible(row.ownerKeys));
      return arrowClears(view, box, projected)
        && (!projected.collectionRows?.length || view.collection.clears(projected));
    };
    // Nearly every rejected pocket fails in the scene that rejected the last one.
    // The conjunction is unchanged by the order of its pure scene checks.
    let witness = 0;
    return {
      obstacles: lifetimeObstacles(scenes),
      connectorCandidateXs: box => candidates(box, 'x'),
      connectorCandidateYs: box => candidates(box, 'y'),
      blocksArrow: box => witness < views.length && !arrowClears(views[witness], box),
      acceptsConnector: box => {
        if (box.caseRowY === undefined && !box.collectionRows?.length) return true;
        for (let step = 0; step < views.length; step++) {
          const index = (witness + step) % views.length;
          if (!accepts(views[index], box)) { witness = index; return false; }
        }
        return true;
      }
    };
  };
}
