import { getNodeId } from '../../replay/displayIdentity.ts';
import { indexHierarchyNodesByIdAndAliases } from '../../replay/replayCanvas.ts';
import type { HierNode } from '../../replay/types.ts';

/*
 * Movement flight (experiment, opt-in via `?movementFlight=1` or the
 * TreeVisualizer `movementFlight` prop). At a movement relation moment
 * reached by advancing exactly one step, the landing's painted subtree travels
 * from the source occurrence along its drawn trajectory while the arrow draws
 * behind it and the lower occurrence's newly authored form fades in. The rest
 * of the step stays instant.
 *
 * The frame is painted, measured and refined in its settled state before a
 * flight starts. The flight only adds paint-time effects (CSS transform and
 * opacity animations, a sweep mask, visibility on new marks); landing or
 * cancelling removes every one of them, so the settled frame is exactly the
 * ordinary frame.
 */

export const MOVEMENT_FLIGHT_MS = 450;
export const MOVEMENT_FLIGHT_EASING = 'ease-in-out';
const FLIGHT_TRAJECTORY_KINDS = new Set(['phrasal', 'phrasal-lowering', 'head', 'lowering']);
const FLIGHT_PATH_SAMPLES = 32;
/** Tree units a persisted mark may shift between frames and still count as unchanged. */
const MARK_CENTER_TOLERANCE = 24;
const ATTACHMENT_HOLD = 0.85;

export const movementFlightRequested = (search: string) =>
  new URLSearchParams(search).get('movementFlight') === '1';
/** Read once when the renderer module loads. */
export const MOVEMENT_FLIGHT_URL_FLAG = typeof window !== 'undefined'
  && movementFlightRequested(window.location?.search || '');

export interface FlightPoint { x: number; y: number }
export interface FlightNode extends FlightPoint { id: string; parentId: string | null }
export interface FlightTrajectory {
  sourceNodeId: string;
  landingNodeId: string;
  trajectoryKind: string;
  blocked?: boolean;
}
export interface MovementFlightPlan {
  sourceNodeId: string;
  landingNodeId: string;
  trajectoryKind: string;
  /** The landing's displacement at departure: source occurrence position minus landing position. */
  offset: FlightPoint;
  /** The landing and its painted descendants; all are new at this step. */
  landingNodeIds: string[];
  /** The parent whose branch to the landing waits for the arrival. */
  attachingParentId: string | null;
  /** Source-occurrence nodes that are new or repainted (words or ink) at this step. */
  lowerFormNodeIds: string[];
}
export interface PaintedMark { kind: string; owners: string[]; x: number; y: number }
/** What one settled frame painted: node id to label ink and text, and its relation marks. */
export interface PaintedRecord { nodes: ReadonlyMap<string, string>; marks: readonly PaintedMark[] }
export interface MovementFlightSession {
  steps: unknown;
  stepIndex: number;
  /** Set when the first frame of the flight settles, so drawing time never skips its departure. */
  startedAt: number | null;
  baseline: PaintedRecord;
}
export interface MovementFlightState {
  session: MovementFlightSession | null;
  painted: { steps: unknown; stepIndex: number; record: PaintedRecord | null } | null;
}
export const createMovementFlightState = (): MovementFlightState => ({ session: null, painted: null });

/**
 * Decides, before a frame is drawn, whether it carries a flight. A flight starts
 * only when the last painted frame was the preceding step of the same Replay; a
 * redraw of the same step (Fit, resize, fonts) continues it from its elapsed
 * time. Prev, jumps, scrubbing, reduced motion and a new Replay all draw the
 * settled frame.
 */
export function beginMovementFlightFrame(state: MovementFlightState, frame: {
  steps: unknown; stepIndex: number; eligible: boolean;
}): MovementFlightSession | null {
  const { steps, stepIndex, eligible } = frame;
  const previous = state.painted;
  const sameStep = previous?.steps === steps && previous.stepIndex === stepIndex;
  let session: MovementFlightSession | null = null;
  if (eligible) {
    if (state.session?.steps === steps && state.session.stepIndex === stepIndex) session = state.session;
    else if (previous?.steps === steps && previous.stepIndex === stepIndex - 1 && previous.record) {
      session = { steps, stepIndex, startedAt: null, baseline: previous.record };
    }
  }
  state.session = session;
  state.painted = { steps, stepIndex, record: sameStep ? previous.record : null };
  return session;
}

export function movementFlightTiming(elapsed: number) {
  if (!(elapsed < MOVEMENT_FLIGHT_MS)) return null;
  return {
    delay: elapsed > 0 ? -elapsed : 0,
    duration: MOVEMENT_FLIGHT_MS,
    easing: MOVEMENT_FLIGHT_EASING,
    fill: 'both' as const
  };
}

const subtreeIds = (rootId: string, children: ReadonlyMap<string, string[]>) => {
  const ids: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    ids.push(id);
    stack.push(...(children.get(id) || []));
  }
  return ids;
};

/**
 * Plans one flight per drawable movement trajectory of the moment. Only material
 * that is new at this step may travel: a landing whose subtree was painted
 * before keeps today's instant presentation.
 */
export function planMovementFlights(
  trajectories: readonly FlightTrajectory[],
  nodes: ReadonlyMap<string, FlightNode>,
  previous: ReadonlyMap<string, string>,
  labels: ReadonlyMap<string, string>
): MovementFlightPlan[] {
  const children = new Map<string, string[]>();
  nodes.forEach((node) => {
    if (!node.parentId || !nodes.has(node.parentId)) return;
    const bucket = children.get(node.parentId) || [];
    bucket.push(node.id);
    children.set(node.parentId, bucket);
  });
  const flown = new Set<string>();
  return trajectories.flatMap((trajectory) => {
    if (trajectory.blocked || !FLIGHT_TRAJECTORY_KINDS.has(trajectory.trajectoryKind)) return [];
    const source = nodes.get(trajectory.sourceNodeId);
    const landing = nodes.get(trajectory.landingNodeId);
    if (!source || !landing || source.id === landing.id) return [];
    const landingNodeIds = subtreeIds(landing.id, children);
    const sourceNodeIds = subtreeIds(source.id, children);
    if (landingNodeIds.some((id) => previous.has(id) || flown.has(id))) return [];
    if (landingNodeIds.includes(source.id) || sourceNodeIds.includes(landing.id)) return [];
    const offset = { x: source.x - landing.x, y: source.y - landing.y };
    if (Math.hypot(offset.x, offset.y) < 1) return [];
    landingNodeIds.forEach((id) => flown.add(id));
    return [{
      sourceNodeId: source.id,
      landingNodeId: landing.id,
      trajectoryKind: trajectory.trajectoryKind,
      offset,
      landingNodeIds,
      attachingParentId: landing.parentId && nodes.has(landing.parentId) ? landing.parentId : null,
      lowerFormNodeIds: sourceNodeIds.filter((id) => !previous.has(id) || previous.get(id) !== labels.get(id))
    }];
  });
}

/**
 * Translation keyframes for a landing subtree. Samples run along the painted
 * trajectory from departure to arrival at equal arc lengths. The subtree follows
 * the curve while the departure correction (source position versus the arrow's
 * departure point) shrinks to zero, so it starts exactly on the source
 * occurrence and ends exactly at its landing. Without samples it travels straight.
 */
export function flightKeyframes(offset: FlightPoint, samples: readonly FlightPoint[]) {
  if (samples.length < 2) return [{ offset: 0, x: offset.x, y: offset.y }, { offset: 1, x: 0, y: 0 }];
  const first = samples[0];
  const last = samples[samples.length - 1];
  const correction = { x: offset.x - (first.x - last.x), y: offset.y - (first.y - last.y) };
  return samples.map((point, index) => {
    const progress = index === samples.length - 1 ? 1 : index / (samples.length - 1);
    return {
      offset: progress,
      x: point.x - last.x + (1 - progress) * correction.x,
      y: point.y - last.y + (1 - progress) * correction.y
    };
  });
}

/**
 * Marks that were not painted, in place, by the preceding frame wait for the
 * arrival: the moment's own marks and any mark re-anchored at this step. A
 * persisted mark keeps showing, including a coalesced one that gains this
 * moment as another owner.
 */
export function marksHeldForFlight(current: readonly PaintedMark[], baseline: readonly PaintedMark[]) {
  const sharesOwner = (left: PaintedMark, right: PaintedMark) => left.owners.length === 0 && right.owners.length === 0
    || left.owners.some((owner) => right.owners.includes(owner));
  return current.map((mark) => !baseline.some((previous) => previous.kind === mark.kind && sharesOwner(previous, mark)
    && Math.hypot(previous.x - mark.x, previous.y - mark.y) <= MARK_CENTER_TOLERANCE));
}

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number; inverse?: () => Matrix };
const applyMatrix = (m: Matrix, p: FlightPoint) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
/** Maps a point from an element's user space into the tree layer's user space. */
const intoTreeSpace = (element: SVGGraphicsElement, tree: SVGGraphicsElement) => {
  const elementMatrix = element.getCTM?.() as Matrix | null | undefined;
  const treeInverse = (tree.getCTM?.() as Matrix | null | undefined)?.inverse?.();
  return elementMatrix && treeInverse
    ? (p: FlightPoint) => applyMatrix(treeInverse, applyMatrix(elementMatrix, p))
    : (p: FlightPoint) => p;
};

const EMPHASIS_CLASS = /^vr-relation-(active|quiet|hovered)$/u;
const ownerRefs = (element: Element) => {
  const refs = (element.getAttribute('data-vr-owner-refs') || '').split(/\s+/u).filter(Boolean);
  if (refs.length > 0) return refs;
  const stage = element.getAttribute('data-vr-stage-index');
  const relation = element.getAttribute('data-vr-relation-index');
  return stage !== null && relation !== null ? [`${stage}:${relation}`] : [];
};

/** Outermost relation marks outside tree labels, with their owners, kind and tree-space center. */
function collectRelationMarks(g: SVGGElement) {
  return Array.from(g.querySelectorAll<SVGGraphicsElement>('.vr-item'))
    .filter((element) => !element.parentElement?.closest('.vr-item') && !element.closest('.node-group'))
    .map((element) => {
      const owners = ownerRefs(element);
      const classes = Array.from(element.classList || []).filter((name) => !EMPHASIS_CLASS.test(name)).sort();
      let center = { x: 0, y: 0 };
      try {
        const box = element.getBBox();
        center = intoTreeSpace(element, g)({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      } catch {
        // Unrendered marks keep the origin; their key still distinguishes them.
      }
      return { element, mark: { kind: `${element.tagName.toLowerCase()} ${classes.join(' ')}`, owners, ...center } };
    });
}

/** A node's painted labels: words and ink, so a pronounced form turning silent counts as changed. */
const paintedLabelText = (group: Element) => Array.from(group.querySelectorAll('text'))
  .map((text) => `${text.getAttribute('fill') || ''} ${text.textContent || ''}`).join('\n');

export interface MovementFlight {
  /** Stops the flight and removes every flight effect, leaving the settled frame. */
  cancel: () => void;
  /** Whether a tree label currently travels; settled measurements must not use it. */
  carries: (element: Element) => boolean;
}

/**
 * Records the settled frame and starts its flight when the session allows one.
 * Call after every measurement and deferred relation draw of the frame.
 */
export function runMovementFlight({ state, steps, stepIndex, session, g, svg, visibleNodes, moment, now, idPrefix, onSettled }: {
  state: MovementFlightState;
  steps: unknown;
  stepIndex: number;
  session: MovementFlightSession | null;
  g: SVGGElement | null;
  svg: SVGSVGElement | null;
  visibleNodes: readonly (HierNode & FlightPoint)[];
  moment: { stageIndex: number; relationIndex: number } | null;
  now: number;
  idPrefix: string;
  onSettled: () => void;
}): MovementFlight | undefined {
  if (!g || !svg) return undefined;
  const nodeGroups = new Map<string, SVGGElement>();
  const labels = new Map<string, string>();
  Array.from(g.children).forEach((child) => {
    if (!child.classList?.contains('node-group')) return;
    const id = child.getAttribute('data-node-group-id') || '';
    if (!id) return;
    nodeGroups.set(id, child as SVGGElement);
    labels.set(id, paintedLabelText(child));
  });
  const marks = collectRelationMarks(g);
  if (state.painted?.steps === steps && state.painted.stepIndex === stepIndex) {
    state.painted.record = { nodes: labels, marks: marks.map(({ mark }) => mark) };
  }
  if (!session || session !== state.session || !moment) return undefined;
  session.startedAt ??= now;
  const timing = movementFlightTiming(now - session.startedAt);
  if (!timing) return undefined;

  const byAlias = indexHierarchyNodesByIdAndAliases(visibleNodes);
  const visibleIds = new Set(visibleNodes.map((node) => getNodeId(node)));
  const nodes = new Map<string, FlightNode>(visibleNodes.map((node) => {
    const id = getNodeId(node);
    const parentId = node.parent ? getNodeId(node.parent) : null;
    return [id, { id, x: node.x, y: node.y, parentId: parentId && visibleIds.has(parentId) ? parentId : null }];
  }));
  const resolve = (id: string | null) => {
    const node = id ? byAlias.get(id) : undefined;
    return node ? getNodeId(node) : '';
  };
  const momentKey = `${moment.stageIndex}:${moment.relationIndex}`;
  const paths = Array.from(g.querySelectorAll<SVGPathElement>('.babel-trajectory-path')).filter((path) => {
    const host = path.closest('.vr-item');
    return Boolean(host) && ownerRefs(host as Element).includes(momentKey);
  });
  const trajectories = paths.map((path) => ({
    sourceNodeId: resolve(path.getAttribute('data-trajectory-from')),
    landingNodeId: resolve(path.getAttribute('data-trajectory-to')),
    trajectoryKind: path.getAttribute('data-trajectory-kind') || '',
    blocked: path.classList.contains('babel-locality-path-failed')
  }));
  const plans = planMovementFlights(trajectories, nodes, session.baseline.nodes, labels);
  if (plans.length === 0) return undefined;

  const branches = Array.from(g.children).filter((child): child is SVGPathElement =>
    child.tagName.toLowerCase() === 'path' && child.classList?.contains('branch'));
  const animations: Animation[] = [];
  const restores: Array<() => void> = [];
  const flying = new Set<Element>();
  const ns = 'http://www.w3.org/2000/svg';
  const finalOpacity = (element: Element) => {
    const value = Number(element.getAttribute('opacity'));
    return Number.isFinite(value) && element.hasAttribute('opacity') ? value : 1;
  };
  const fadeIn = (element: Element, hold = 0) => animations.push(element.animate(hold > 0
    ? [{ offset: 0, opacity: 0 }, { offset: hold, opacity: 0 }, { offset: 1, opacity: finalOpacity(element) }]
    : [{ opacity: 0 }, { opacity: finalOpacity(element) }], timing));

  plans.forEach((plan, planIndex) => {
    const path = paths.find((candidate) => resolve(candidate.getAttribute('data-trajectory-from')) === plan.sourceNodeId
      && resolve(candidate.getAttribute('data-trajectory-to')) === plan.landingNodeId);
    const samples: FlightPoint[] = [];
    const length = path?.getTotalLength?.() ?? 0;
    if (path && Number.isFinite(length) && length > 0) {
      const toTree = intoTreeSpace(path, g);
      for (let index = 0; index <= FLIGHT_PATH_SAMPLES; index += 1) {
        const point = path.getPointAtLength(length * index / FLIGHT_PATH_SAMPLES);
        samples.push(toTree({ x: point.x, y: point.y }));
      }
    }
    const keyframes = flightKeyframes(plan.offset, samples);
    const landing = new Set(plan.landingNodeIds);
    plan.landingNodeIds.forEach((id) => {
      const group = nodeGroups.get(id);
      const node = nodes.get(id);
      if (!group || !node) return;
      // A CSS transform replaces the group's transform attribute while it runs,
      // so every keyframe carries the group's settled position.
      animations.push(group.animate(keyframes.map(({ offset, x, y }) => ({
        offset, transform: `translate(${node.x + x}px, ${node.y + y}px)`
      })), timing));
      group.setAttribute('data-babel-movement-flight', 'landing');
      flying.add(group);
      restores.push(() => group.removeAttribute('data-babel-movement-flight'));
    });
    branches.forEach((branch) => {
      const from = branch.getAttribute('data-source-node-id') || '';
      const to = branch.getAttribute('data-target-node-id') || '';
      if (landing.has(from) && landing.has(to)) {
        animations.push(branch.animate(keyframes.map(({ offset, x, y }) => ({
          offset, transform: `translate(${x}px, ${y}px)`
        })), timing));
      } else if (to === plan.landingNodeId && from === plan.attachingParentId) {
        fadeIn(branch, ATTACHMENT_HOLD);
      } else if (plan.lowerFormNodeIds.includes(to) && !session.baseline.nodes.has(to)) {
        // A repainted lower node keeps the branch it already had.
        fadeIn(branch);
      }
    });
    plan.lowerFormNodeIds.forEach((id) => {
      const group = nodeGroups.get(id);
      if (group) fadeIn(group);
    });
    // A head that lands under a different category materializes as it arrives.
    const landingLabel = nodeGroups.get(plan.landingNodeId)?.querySelector('.category-label');
    const sourceLabel = nodeGroups.get(plan.sourceNodeId)?.querySelector('.category-label');
    if (landingLabel && landingLabel.textContent !== sourceLabel?.textContent) fadeIn(landingLabel);

    const host = path?.closest<SVGGElement>('.vr-item');
    if (path && host && length > 0 && !host.hasAttribute('mask')) {
      const box = path.getBBox();
      const matrix = path.getScreenCTM?.();
      const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
      const sweepWidth = Math.max(120, 48 / Math.max(0.001, scale));
      const padding = sweepWidth / 2 + 24;
      const defs = document.createElementNS(ns, 'defs');
      const mask = document.createElementNS(ns, 'mask');
      const sweep = document.createElementNS(ns, 'path');
      const id = `${idPrefix}-${planIndex}`;
      mask.setAttribute('id', id);
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('x', String(box.x - padding));
      mask.setAttribute('y', String(box.y - padding));
      mask.setAttribute('width', String(box.width + padding * 2));
      mask.setAttribute('height', String(box.height + padding * 2));
      mask.style.maskType = 'alpha';
      sweep.setAttribute('d', path.getAttribute('d') || '');
      sweep.style.fill = 'none';
      sweep.style.stroke = 'white';
      sweep.style.strokeWidth = String(sweepWidth);
      sweep.style.strokeLinecap = 'butt';
      sweep.style.strokeDasharray = `${length} ${length}`;
      mask.appendChild(sweep);
      defs.appendChild(mask);
      svg.appendChild(defs);
      host.setAttribute('mask', `url(#${id})`);
      animations.push(sweep.animate([{ strokeDashoffset: String(length) }, { strokeDashoffset: '0' }], timing));
      restores.push(() => {
        host.removeAttribute('mask');
        defs.remove();
      });
    }
  });
  if (animations.length === 0) return undefined;

  const trajectoryHosts = new Set(paths.map((path) => path.closest('.vr-item')));
  const held = marksHeldForFlight(marks.map(({ mark }) => mark), session.baseline.marks);
  marks.forEach(({ element }, index) => {
    if (!held[index] || trajectoryHosts.has(element)) return;
    const previousVisibility = element.style.visibility;
    element.style.visibility = 'hidden';
    restores.push(() => { element.style.visibility = previousVisibility; });
  });
  svg.setAttribute('data-babel-movement-flight', 'flying');
  restores.push(() => svg.removeAttribute('data-babel-movement-flight'));

  let done = false;
  const finish = (settled: boolean) => {
    if (done) return;
    done = true;
    animations.forEach((animation) => animation.cancel());
    restores.forEach((restore) => restore());
    flying.clear();
    if (settled) onSettled();
  };
  animations[0].onfinish = () => finish(true);
  return {
    cancel: () => finish(false),
    carries: (element) => {
      const group = element.closest('.node-group');
      return Boolean(group && flying.has(group));
    }
  };
}
