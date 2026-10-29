import { blocksCarriedPocket, nearbyPlaqueReach, type PlaqueRect } from './plaquePlacement.ts';
import { plaquesOverlap, translateObstacle } from './plaqueObstacleIndex.ts';

/** When a plaque shown at consecutive Replay steps may leave its pocket. It keeps the
 * pocket, carried with its anchor, unless the anchor moves or the later step newly
 * paints something in its way (renderer closeout, "A plaque shown at consecutive
 * Replay steps keeps its pocket"). This module is that rule's one definition: the
 * Replay schedule (stageCamera.ts, holdPockets) moves a plaque only where it allows,
 * and the offline visual audit (tests/helpers/visualRules.mjs, mark-motion) reports
 * every other move.
 *
 * Both read the same occupants: the boxes plaque allocation reserves for what one
 * step paints, in tree units. They are the step's visible syntax (label and word
 * boxes, branches), its revealed marks (stems, trajectories, predication and control
 * routes, fixed native plaques), and the plaques it shows with their own Case arrows
 * and collectors, each tagged with the plaque that owns it. An occupant is new when
 * the earlier step had no twin of it: the same owner's box, carried with the anchor.
 * A pocket is blocked by a new occupant within the gap carrying keeps
 * (plaquePlacement.ts, blocksCarriedPocket), or by a new label or plaque crossing a
 * route the plaque drew from that pocket. Where the plaque's own Case arrow or a
 * collector starts, ends or leaves a moved source, the schedule keeps the pocket
 * only if every allocation rule accepts it; the audit cannot redraw that route at
 * the old pocket and lets the plaque move.
 *
 * Within one stage the schedule knows what every step paints. A plaque leaves a
 * pocket that syntax or a mark of its stage will newly take while it is still shown
 * beside a still anchor (foreseenPocketBlocker) where it is free to move: where the
 * stage begins, where it is first shown or where its anchor moves. It then keeps the
 * pocket it takes, across stage boundaries too, until its anchor moves or it is no
 * longer shown (stageCamera.ts, release). The audit reports a plaque that left early
 * where a stage began and moves again beside its still anchor; it judges any other
 * plaque as before. */

/** Which of a plaque's own connectors an occupant belongs to: `key` names the Case
 * arrow or collector row and the row height it meets; `far` is the source node it
 * leaves; `source` is that label's attachment, which the route may touch; `ink`
 * routes clear a label's ink box rather than its whole box (collectors). */
export type PocketRoute = { key: string; far: { x: number; y: number }; source?: string; ink?: boolean };

/** One box allocation reserves for what a step paints. `owner` is the plaqueIdentity
 * of the plaque whose shell or own route it is. */
export type PocketOccupant = PlaqueRect & { owner?: string; route?: PocketRoute };

/** A plaque's pocket at one step: its allocated box and the narrower gap from syntax
 * it was accepted at, if any. */
export type HeldPocket = PlaqueRect & { syntaxGap?: number };

/** Geometry within this many tree units of where the earlier step had it, carried
 * with the anchor, did not move. */
export const POCKET_STILL_UNITS = 1;

type Move = { x: number; y: number };
const near = (a: number, b: number) => Math.abs(a - b) <= POCKET_STILL_UNITS;
const shell = (box: PlaqueRect) => Boolean(box.plaqueShell || box.blocksConnectors && box.connectorAttachment === undefined && !box.curve);

/** Whether `later` is `earlier`, carried by `move`: the same kind of box of the same
 * owner at the same place. Another plaque taking a pocket a plaque left is new. */
const twin = (earlier: PocketOccupant, later: PocketOccupant, move: Move) => earlier.owner === later.owner && near(earlier.x + move.x, later.x)
  && near(earlier.y + move.y, later.y) && near(earlier.width, later.width) && near(earlier.height, later.height)
  && Boolean(earlier.curve) === Boolean(later.curve) && Boolean(earlier.trajectory) === Boolean(later.trajectory)
  && Boolean(earlier.blocksConnectors) === Boolean(later.blocksConnectors) && shell(earlier) === shell(later)
  && Boolean(earlier.extendsDownward) === Boolean(later.extendsDownward);

/** Whether `occupant` is the plaque `owner`'s own, or encloses it (PlaqueRect,
 * `enclosedPlaques`): neither blocks the plaque. */
export const ownOccupant = (owner: string, occupant: PocketOccupant) => occupant.owner === owner || Boolean(occupant.enclosedPlaques?.has(owner));

/** Whether the earlier step had no twin of `occupant`. */
export const isNewOccupant = (occupant: PocketOccupant, earlier: readonly PocketOccupant[], move: Move) =>
  !earlier.some(other => twin(other, occupant, move));

const routesOf = (owner: string, occupants: readonly PocketOccupant[]) => {
  const routes = new Map<string, PocketRoute>();
  for (const occupant of occupants) if (occupant.owner === owner && occupant.route) routes.set(occupant.route.key, occupant.route);
  return routes;
};

/** Whether the plaque's own Case arrow and collectors differ between the steps: one
 * starts or ends, meets another row, or leaves a source node that moved against the
 * anchor. Both steps' routes depend only on these, not on the pocket. */
export function ownRoutesChanged(owner: string, move: Move, earlier: readonly PocketOccupant[], later: readonly PocketOccupant[]) {
  const before = routesOf(owner, earlier), after = routesOf(owner, later);
  return before.size !== after.size || [...after].some(([key, route]) => {
    const prior = before.get(key);
    return !prior || !near(prior.far.x + move.x, route.far.x) || !near(prior.far.y + move.y, route.far.y);
  });
}

/** Whether a label or plaque crosses one piece of a plaque's own route, as the
 * allocator tests it (plaquePlacement.ts, casePlaqueSpace and collectionPlaqueSpace). */
const crossesRoute = (piece: PocketOccupant, blocker: PocketOccupant) => blocker.blocksConnectors === true
  && blocker.connectorAttachment !== piece.route!.source
  && plaquesOverlap(piece, piece.route!.ink && blocker.connectorInk ? { ...blocker, ...blocker.connectorInk } : blocker, 0);

/** The first occupant the later step newly paints in the way of `pocket`, the plaque
 * `owner`'s earlier pocket carried with its anchor by `move`: within the carrying gap
 * of the pocket, or a label or plaque crossing a route the plaque drew from it in the
 * earlier step. The plaque's own occupants never block it, nor do occupants `counts`
 * rejects. */
export function newPocketBlocker({ pocket, owner, move }: { pocket: HeldPocket; owner: string; move: Move },
  earlier: readonly PocketOccupant[], later: readonly PocketOccupant[],
  counts: (occupant: PocketOccupant) => boolean = () => true): PocketOccupant | undefined {
  const routes = earlier.filter(occupant => occupant.owner === owner && occupant.route)
    .map(piece => translateObstacle(piece, move.x, move.y));
  return later.find(occupant => !ownOccupant(owner, occupant) && counts(occupant)
    && (blocksCarriedPocket(pocket, occupant, pocket.syntaxGap) || routes.some(piece => crossesRoute(piece, occupant)))
    && isNewOccupant(occupant, earlier, move));
}

/** A later Replay step of the plaque's stage, while the plaque stays shown there and
 * its anchor still: what that step paints, and how far the anchor has moved since the
 * earlier step. */
export type AheadStep = { occupants: readonly PocketOccupant[]; move: Move };

/** The first syntax or mark that a later step of the same stage newly paints in the
 * way of `pocket`, the plaque's earlier pocket carried by `move` to the later step.
 * Within one stage the schedule knows what every step paints, so a plaque does not
 * keep a pocket that such syntax or a mark will take while it is still shown beside a
 * still anchor; it moves where it is free to rather than at the step that blocks it. `ahead` lists
 * the stage's later steps in order and stops where the plaque is hidden or its anchor
 * moves. Plaques and their own routes (occupants with an owner) are placed step by
 * step and do not count, nor does a mark that encloses the plaque `owner`. */
export function foreseenPocketBlocker({ pocket, owner, move }: { pocket: HeldPocket; owner: string; move: Move },
  earlier: readonly PocketOccupant[], ahead: readonly AheadStep[]): PocketOccupant | undefined {
  for (const step of ahead) {
    const carried = { ...pocket, x: pocket.x + step.move.x - move.x, y: pocket.y + step.move.y - move.y };
    const found = step.occupants.find(occupant => occupant.owner === undefined && !ownOccupant(owner, occupant)
      && blocksCarriedPocket(carried, occupant, pocket.syntaxGap) && isNewOccupant(occupant, earlier, step.move));
    if (found) return found;
  }
  return undefined;
}

const distance = (box: PlaqueRect, anchor: { x: number; y: number }) =>
  Math.hypot(box.x + box.width / 2 - anchor.x, box.y + box.height / 2 - anchor.y);

/** A plaque that shows its owner only by proximity, left beyond its nearby reach
 * (plaquePlacement.ts, nearbyPlaqueReach), may come back within it once what the
 * earlier step had in that nearer pocket has gone: an occupant other than its own
 * blocked the later pocket, carried back by `move`, and the later step lacks it.
 * Anchors are the points distances are measured from (plaqueAnchorPoint). */
export function returnsWithinReach({ before, after, owner, move, thetaGrid, realizedForm }: {
  before: { pocket: HeldPocket; anchor: { x: number; y: number } };
  after: { pocket: HeldPocket; anchor: { x: number; y: number } };
  owner: string; move: Move; thetaGrid?: boolean; realizedForm?: boolean;
}, earlier: readonly PocketOccupant[], later: readonly PocketOccupant[]) {
  const reach = (box: PlaqueRect) => nearbyPlaqueReach({ width: box.width, height: box.height, thetaGrid, realizedForm }) + 1e-6;
  if (distance(before.pocket, before.anchor) <= reach(before.pocket) || distance(after.pocket, after.anchor) > reach(after.pocket)) return false;
  const back: HeldPocket = { ...after.pocket, x: after.pocket.x - move.x, y: after.pocket.y - move.y };
  return earlier.some(occupant => !ownOccupant(owner, occupant) && blocksCarriedPocket(back, occupant, back.syntaxGap)
    && !later.some(other => twin(occupant, other, move)));
}
