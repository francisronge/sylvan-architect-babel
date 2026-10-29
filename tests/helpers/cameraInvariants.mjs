/** Pure checks of the camera rules in AGENTS.md "Replay and renderer contract"
 * and the forward-playback framing in
 * docs/design/visual-relations-renderer-closeout-2026-08-25.md, over a
 * sequence of painted camera poses and frame layouts. This is Babel's one camera
 * policy: offline traces (tests/helpers/cameraTrace.mjs) and browser captures
 * feed the same checks.
 *
 * A trace is `{ canvas: { width, height }, view, frames, direct, passes }`:
 * - `view`: the usable canvas rectangle, excluding the Replay header, Replay
 *   panel and controls. Poses are D3 transforms `{ x, y, k }`.
 * - `frames[i]` (Replay frame i + 1): `stage`, `final` for the completed last
 *   Stage Record, `bounds` (the stage camera bounds a fit centres), `envelope`
 *   (bounds plus the shared margin and plaques the camera must contain) and
 *   `nodes`, a Map from display ID to tree-space `{ x, y, ancestors }`.
 * - `direct[i]`: the settled pose when frame i + 1 is selected directly.
 * - `passes`: `{ name, steps }`, each step `{ from, to, before, first, settled }`
 *   with 0-based frame indices: the settled pose before the step, the first
 *   pose painted for `to`, and the pose the camera settles on.
 *
 * Checkers return findings in the shape of tests/helpers/findings.mjs without
 * `record` and `viewport`, which the caller adds: `{ rule, subtype, subject,
 * frame, measure, detail }`. A step's frame is written '20>21'; `subject` is the
 * authored stage of the frame. Where several passes paint the same fault, one
 * finding keeps the largest measure. Checkers never assert. */

// canopy-final-frame is checked by visualFrames.mjs (compareCanopyToFinalFrame) and
// reported with the camera audit, which lays out each record at desktop and mobile.
export const CAMERA_RULES = ['settled-path-independence', 'content-placement', 'first-paint-continuity', 'within-stage-stability',
  'canopy-final-frame', 'canopy-placement'];

/** Screen-pixel thresholds, tuned against the committed fixtures and saved
 * qualification runs (`node scripts/auditReplayVisuals.mjs --audit camera`). */
export const CAMERA_THRESHOLDS = {
  /** Two poses agree when the frame's envelope corners land within this. */
  samePosePx: 0.5,
  /** Retained travel of shared syntax may exceed the fit's by this much. */
  steadierPx: 4,
  /** Syntax or bounds beyond the usable view by more than this are clipped. */
  clipPx: 2,
  /** An envelope edge this close to the view edge is pinned there... */
  pinPx: 2,
  /** ...and is reported when the opposite gap exceeds this share of the view. */
  emptyShare: 0.33,
  /** Median first-paint jump of syntax whose attachment is unchanged. */
  jumpPx: 24,
  /** A shared node this far beyond the canvas edge, label included, is out of sight. */
  offCanvasPx: 24,
  /** The Canopy's painted tree is centred when its centre lies this close to the view's. */
  centrePx: 2
};

const screen = (pose, point) => ({ x: pose.x + point.x * pose.k, y: pose.y + point.y * pose.k });
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : null;
};
const round = value => Math.round(value * 100) / 100;
const poseText = pose => `(${round(pose.x)}, ${round(pose.y)}, k ${pose.k.toFixed(4)})`;
const corners = rect => rect ? [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.minX, rect.maxY], [rect.maxX, rect.maxY]]
  .map(([x, y]) => ({ x, y })) : [];
const screenRect = (pose, rect) => rect && ({ left: pose.x + rect.minX * pose.k, right: pose.x + rect.maxX * pose.k,
  top: pose.y + rect.minY * pose.k, bottom: pose.y + rect.maxY * pose.k });
const frameRect = frame => frame.envelope ?? frame.bounds ?? null;
const stageOf = frame => `stage ${frame.stage + 1}`;
const transition = step => `${step.from + 1}>${step.to + 1}`;

/** Largest on-screen displacement of the frame's envelope between two poses;
 * without an envelope, of its syntax. */
export function poseDistance(a, b, frame) {
  const points = corners(frameRect(frame));
  const sample = points.length ? points : [...frame.nodes.values()];
  if (!sample.length) return Math.hypot(a.x - b.x, a.y - b.y);
  return Math.max(...sample.map(point => {
    const p = screen(a, point), q = screen(b, point);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }));
}

/** How far a rectangle on screen extends beyond the view, per side. */
const overflow = (rect, view) => rect ? { left: view.left - rect.left, right: rect.right - view.right,
  top: view.top - rect.top, bottom: rect.bottom - view.bottom } : { left: 0, right: 0, top: 0, bottom: 0 };
const worstOverflow = (pose, frame, view) => Math.max(...Object.values(overflow(screenRect(pose, frameRect(frame)), view)));

const sharedIds = (before, after) => [...after.nodes.keys()].filter(id => before.nodes.has(id));
/** Shared syntax whose shared ancestry is unchanged: what a step does not move.
 * A reattached (moved) constituent changes ancestry and may legitimately travel. */
export function unmovedIds(before, after) {
  const shared = sharedIds(before, after);
  const both = new Set(shared);
  const lineage = (frame, id) => JSON.stringify((frame.nodes.get(id).ancestors ?? []).filter(ancestor => both.has(ancestor)));
  return shared.filter(id => lineage(before, id) === lineage(after, id));
}
/** Per-node on-screen travel of `ids` from `before` painted with `fromPose` to `after` painted with `toPose`. */
export function syntaxTravel(fromPose, before, toPose, after, ids) {
  return ids.map(id => {
    const p = screen(fromPose, before.nodes.get(id)), q = screen(toPose, after.nodes.get(id));
    return Math.hypot(p.x - q.x, p.y - q.y);
  });
}

/** One finding per rule, subtype, subject and frame, keeping the largest measure. */
function collect() {
  const byPlace = new Map();
  return {
    add(finding, pass) {
      const key = JSON.stringify([finding.rule, finding.subtype, finding.subject, finding.frame]);
      const prior = byPlace.get(key);
      if (!prior || finding.measure > prior.measure) byPlace.set(key, { ...finding, passes: [...new Set([...(prior?.passes ?? []), pass])] });
      else if (!prior.passes.includes(pass)) prior.passes.push(pass);
    },
    list: () => [...byPlace.values()]
  };
}

/**
 * A frame reached by an adjacent step settles where direct selection does.
 * The documented exception is forward playback retaining an accepted view:
 * it never zooms in past the stage fit, it contains the stage envelope, and
 * it holds the syntax the step leaves in place (shared syntax whose shared
 * ancestry is unchanged, the reference the camera carries across stages) no
 * further from where it was painted than the stage fit would; a reattached
 * constituent may move. Later micro-steps of the same stage
 * keep the entry pose and inherit its verdict, so a disallowed entry is
 * reported once, at the step into the stage ('retention'). A Prev within one
 * stage may likewise keep the stage's accepted pose; a Prev into an earlier
 * stage or out of the completed last Stage Record settles where direct
 * selection does, and otherwise is 'backward'.
 */
export function checkSettledPathIndependence(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = collect(), allowed = [];
  for (const pass of trace.passes) {
    let entry = null;
    for (const step of pass.steps) {
      const frame = trace.frames[step.to], direct = trace.direct[step.to];
      const difference = poseDistance(step.settled, direct, frame);
      if (difference <= thresholds.samePosePx) { entry = null; continue; }
      const kept = trace.frames[step.from].stage === frame.stage && poseDistance(step.before, step.settled, frame) <= thresholds.samePosePx;
      if (kept && entry?.at === step.from) {
        if (entry.allowed) allowed.push({ ...entry.allowed, frame: step.to + 1, inheritedFrom: entry.allowed.frame });
        entry.at = step.to;
        continue;
      }
      if (kept && step.to === step.from - 1 && !trace.frames[step.from].final) {
        allowed.push({ frame: step.to + 1, from: step.from + 1, pass: pass.name, differencePx: round(difference), keptStagePose: true });
        entry = null;
        continue;
      }
      const reasons = [], context = {};
      const subtype = step.to !== step.from + 1 ? 'backward' : frame.final ? 'final' : 'retention';
      if (subtype === 'backward') reasons.push('a Prev keeps a pose only within one stage, never into an earlier stage or out of the completed record');
      else if (subtype === 'final') reasons.push('the completed last Stage Record must use its fit');
      else {
        if (step.settled.k > direct.k + 1e-6) reasons.push(`it zooms in past the stage fit (k ${step.settled.k.toFixed(4)} > ${direct.k.toFixed(4)})`);
        const spill = worstOverflow(step.settled, frame, trace.view);
        if (spill > thresholds.clipPx) reasons.push(`its envelope overflows the view by ${round(spill)} px`);
        const before = trace.frames[step.from], unmoved = unmovedIds(before, frame);
        const ids = unmoved.length ? unmoved : sharedIds(before, frame);
        if (!ids.length) reasons.push('no syntax is shared with the previous frame, so retention holds nothing still');
        else {
          context.retainedTravelPx = round(median(syntaxTravel(step.before, before, step.settled, frame, ids)));
          context.fittedTravelPx = round(median(syntaxTravel(step.before, before, direct, frame, ids)));
          if (context.retainedTravelPx > context.fittedTravelPx + thresholds.steadierPx)
            reasons.push(`${unmoved.length ? 'unmoved' : 'shared'} syntax travels ${context.retainedTravelPx} px under the retained view `
              + `but ${context.fittedTravelPx} px under the fit`);
        }
      }
      if (!reasons.length) {
        entry = { at: step.to, allowed: { frame: step.to + 1, from: step.from + 1, pass: pass.name, differencePx: round(difference), ...context } };
        allowed.push(entry.allowed);
        continue;
      }
      entry = { at: step.to };
      found.add({ rule: 'settled-path-independence', subtype, subject: stageOf(frame), frame: transition(step), measure: round(difference),
        detail: `settles at ${poseText(step.settled)}, ${round(difference)} px from direct selection ${poseText(direct)}: ${reasons.join('; ')}`,
        context }, pass.name);
    }
  }
  return { findings: found.list(), allowed };
}

/**
 * Every distinct settled pose of a frame (direct selection and each pass)
 * shows its syntax inside the usable view ('syntax-clipped'), keeps the stage
 * bounds there ('bounds-clipped'), and does not pin the stage envelope to one
 * edge while a large share of the view stays empty opposite ('pinned').
 */
export function checkContentPlacement(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = collect(), { view } = trace;
  const settle = (index, pose, source) => {
    const frame = trace.frames[index], place = { rule: 'content-placement', subject: stageOf(frame), frame: index + 1 };
    const clipped = [...frame.nodes].flatMap(([id, point]) => {
      const { x, y } = screen(pose, point);
      const beyond = Math.max(view.top - y, y - view.bottom, view.left - x, x - view.right);
      const side = y < view.top ? 'under the header' : y > view.bottom ? 'under the Replay panel' : x < view.left ? 'beyond the left edge' : 'beyond the right edge';
      return beyond > thresholds.clipPx ? [{ id, side, beyond }] : [];
    });
    if (clipped.length) found.add({ ...place, subtype: 'syntax-clipped', measure: round(Math.max(...clipped.map(entry => entry.beyond))),
      detail: `at ${poseText(pose)}, ${clipped.length} of ${frame.nodes.size} syntax nodes are ${[...new Set(clipped.map(entry => entry.side))].join(', ')} `
        + `(${clipped.slice(0, 4).map(entry => entry.id).join(', ')})` }, source);
    const spill = Object.entries(overflow(screenRect(pose, frame.bounds), view)).filter(([, amount]) => amount > thresholds.clipPx);
    if (spill.length) found.add({ ...place, subtype: 'bounds-clipped', measure: round(Math.max(...spill.map(([, amount]) => amount))),
      detail: `at ${poseText(pose)}, the stage bounds are clipped ${spill.map(([side, amount]) => `${side} ${round(amount)} px`).join(', ')}` }, source);
    const envelope = screenRect(pose, frame.envelope);
    if (envelope) for (const [low, high, extent] of [['left', 'right', view.right - view.left], ['top', 'bottom', view.bottom - view.top]]) {
      const gapLow = low === 'left' ? envelope.left - view.left : envelope.top - view.top;
      const gapHigh = high === 'right' ? view.right - envelope.right : view.bottom - envelope.bottom;
      if (gapLow < -thresholds.clipPx || gapHigh < -thresholds.clipPx) continue;
      const empty = Math.max(gapLow, gapHigh);
      if (Math.min(gapLow, gapHigh) > thresholds.pinPx || empty < thresholds.emptyShare * extent) continue;
      found.add({ ...place, subtype: 'pinned', measure: round(empty / extent),
        detail: `at ${poseText(pose)}, the content is pinned to the ${gapLow <= gapHigh ? low : high} edge with ${Math.round(empty)} px `
          + `(${Math.round(empty / extent * 100)}%) of the view empty opposite` }, source);
    }
  };
  trace.direct.forEach((pose, index) => settle(index, pose, 'direct'));
  for (const pass of trace.passes) for (const step of pass.steps) settle(step.to, step.settled, pass.name);
  return found.list();
}

/**
 * The first pose painted on a step keeps the shared syntax on the canvas where
 * the previous settled frame showed it ('off-canvas:moved' or 'off-canvas:unmoved'
 * by what leaves), and does not jump syntax whose attachment the step leaves
 * unchanged. A jump's subtype names its cause: the camera's first pose
 * ('jump:camera'), a new stage's coordinates under an unchanged camera
 * ('jump:stage-coordinates'), or relayout within one stage ('jump:relayout').
 * The camera may then travel smoothly.
 */
export function checkFirstPaintContinuity(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = collect(), { width, height } = trace.canvas;
  const outside = ({ x, y }) => Math.max(-x, x - width, -y, y - height, 0);
  for (const pass of trace.passes) for (const step of pass.steps) {
    const before = trace.frames[step.from], after = trace.frames[step.to];
    const shared = sharedIds(before, after);
    if (!shared.length) continue;
    const unmoved = unmovedIds(before, after), still = new Set(unmoved);
    const place = { rule: 'first-paint-continuity', subject: stageOf(after), frame: transition(step) };
    const paints = `the first pose ${poseText(step.first)} after ${poseText(step.before)}`;
    const lost = shared.filter(id => !outside(screen(step.before, before.nodes.get(id)))
      && outside(screen(step.first, after.nodes.get(id))) > thresholds.offCanvasPx);
    for (const [kind, ids] of [['moved', lost.filter(id => !still.has(id))], ['unmoved', lost.filter(id => still.has(id))]]) {
      if (ids.length) found.add({ ...place, subtype: `off-canvas:${kind}`,
        measure: round(Math.max(...ids.map(id => outside(screen(step.first, after.nodes.get(id)))))),
        detail: `${paints} paints ${ids.length} of ${shared.length} shared ${kind} nodes beyond the canvas (${ids.slice(0, 4).join(', ')})` }, pass.name);
    }
    const reference = unmoved.length ? unmoved : shared;
    const jump = median(syntaxTravel(step.before, before, step.first, after, reference));
    if (jump <= thresholds.jumpPx) continue;
    const cause = poseDistance(step.before, step.first, after) > thresholds.samePosePx ? 'camera'
      : before.stage !== after.stage ? 'stage-coordinates' : 'relayout';
    found.add({ ...place, subtype: `jump:${cause}`, measure: round(jump),
      detail: `${paints} jumps ${unmoved.length ? 'unmoved' : 'shared'} syntax a median ${round(jump)} px` }, pass.name);
  }
  return found.list();
}

/**
 * Micro-steps of one authored stage share one camera. A change is allowed only
 * where the previous pose no longer contains the stage envelope (documented
 * overflow); steps into or out of the completed last Stage Record use its fit.
 * A Prev that leaves a retained pose for direct selection's is 'prev-refit'.
 */
export function checkWithinStageStability(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = collect();
  for (const pass of trace.passes) for (const step of pass.steps) {
    const before = trace.frames[step.from], after = trace.frames[step.to];
    if (before.stage !== after.stage || before.final || after.final) continue;
    const change = poseDistance(step.before, step.settled, after);
    if (change <= thresholds.samePosePx || worstOverflow(step.before, after, trace.view) > thresholds.clipPx) continue;
    const refit = step.to === step.from - 1 && poseDistance(step.settled, trace.direct[step.to], after) <= thresholds.samePosePx;
    found.add({ rule: 'within-stage-stability', subtype: refit ? 'prev-refit' : 'change', subject: stageOf(after), frame: transition(step),
      measure: round(change), detail: `the camera moves ${round(change)} px within the stage, from ${poseText(step.before)} to `
        + `${poseText(step.settled)}, though the previous pose contains the stage` }, pass.name);
  }
  return found.list();
}

/**
 * The Canopy's fit shows its whole painted tree inside the usable view
 * ('clipped') and centres it there on both axes ('off-centre'), however wide
 * the tree; the user zooms in to read. `canopy` is `{ view, box, pose }`: the
 * usable view, the painted tree's box `{ x, y, width, height }` in tree units
 * and the settled pose. Findings are as above, at frame 'canopy'.
 */
export function checkCanopyPlacement({ view, box, pose }, thresholds = CAMERA_THRESHOLDS) {
  const ink = screenRect(pose, { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height });
  const place = { rule: 'canopy-placement', subject: 'canopy', frame: 'canopy' }, found = [];
  const spill = Object.entries(overflow(ink, view)).filter(([, amount]) => amount > thresholds.clipPx);
  if (spill.length) found.push({ ...place, subtype: 'clipped', measure: round(Math.max(...spill.map(([, amount]) => amount))),
    detail: `at ${poseText(pose)}, the painted tree is clipped ${spill.map(([side, amount]) => `${side} ${round(amount)} px`).join(', ')}` });
  const off = { x: (ink.left + ink.right - view.left - view.right) / 2, y: (ink.top + ink.bottom - view.top - view.bottom) / 2 };
  if (Math.max(Math.abs(off.x), Math.abs(off.y)) > thresholds.centrePx) found.push({ ...place, subtype: 'off-centre',
    measure: round(Math.max(Math.abs(off.x), Math.abs(off.y))),
    detail: `at ${poseText(pose)}, the painted tree's centre is ${round(off.x)}, ${round(off.y)} px from the view's` });
  return found;
}

/** Every rule over one trace. */
export function checkCameraTrace(trace, thresholds = CAMERA_THRESHOLDS) {
  const path = checkSettledPathIndependence(trace, thresholds);
  return {
    findings: [...path.findings, ...checkContentPlacement(trace, thresholds),
      ...checkFirstPaintContinuity(trace, thresholds), ...checkWithinStageStability(trace, thresholds)],
    allowed: path.allowed
  };
}
