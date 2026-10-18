/** Pure checks of the camera rules in AGENTS.md "Replay and renderer safety"
 * and the forward-playback framing in
 * docs/design/visual-relations-renderer-closeout-2026-08-25.md, over a
 * sequence of painted camera poses and frame layouts.
 *
 * A trace (tests/helpers/cameraTrace.mjs builds one offline; a browser audit
 * can build one from painted transforms) is
 * `{ canvas: { width, height }, view, frames, direct, passes }`:
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
 * Checkers return violations `{ rule, frame, frames, from, passes, detail, measure }`
 * with 1-based frames. One finding covers every frame and pass that shows the
 * same pose problem: `frame` is the first, `frames` all of them. Checkers never
 * assert; callers decide which findings are expected.
 * `checkSettledPathIndependence` also returns the differences it allowed. */

export const CAMERA_RULES = ['settled-path-independence', 'content-placement', 'first-paint-continuity', 'within-stage-stability'];

/** Screen-pixel thresholds, tuned against the committed fixtures and saved
 * qualification runs (see scripts/auditReplayCamera.mjs). */
export const CAMERA_THRESHOLDS = {
  /** Two poses agree when the frame's envelope corners land within this. */
  samePosePx: 0.5,
  /** Retained travel of shared syntax may exceed the fit's by this much. */
  steadierPx: 4,
  /** Syntax or bounds beyond the usable view by more than this are clipped. */
  clipPx: 2,
  /** An envelope edge this close to the view edge is pinned there. */
  pinPx: 2,
  /** ...and is reported when the opposite gap exceeds this share of the view. */
  emptyShare: 0.33,
  /** Median first-paint jump of syntax whose attachment is unchanged. */
  jumpPx: 24,
  /** A shared node this far beyond the canvas edge, label included, is out of sight. */
  offCanvasPx: 24
};

const screen = (pose, point) => ({ x: pose.x + point.x * pose.k, y: pose.y + point.y * pose.k });
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : null;
};
const round = value => Math.round(value * 10) / 10;
const poseText = pose => `(${round(pose.x)}, ${round(pose.y)}, k ${pose.k.toFixed(4)})`;
const poseKey = pose => [pose.x, pose.y, pose.k].map(value => value.toFixed(3)).join(',');
const corners = rect => rect ? [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.minX, rect.maxY], [rect.maxX, rect.maxY]]
  .map(([x, y]) => ({ x, y })) : [];
const screenRect = (pose, rect) => rect && ({ left: pose.x + rect.minX * pose.k, right: pose.x + rect.maxX * pose.k,
  top: pose.y + rect.minY * pose.k, bottom: pose.y + rect.maxY * pose.k });
const frameRect = frame => frame.envelope ?? frame.bounds ?? null;

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

/** Collect findings under `key`; a repeat adds its frame and passes to the first. */
function findings() {
  const byKey = new Map();
  return {
    add(key, finding) {
      const prior = byKey.get(key);
      if (!prior) { byKey.set(key, { ...finding, frames: [finding.frame], passes: [...finding.passes] }); return; }
      if (!prior.frames.includes(finding.frame)) prior.frames.push(finding.frame);
      for (const pass of finding.passes) if (!prior.passes.includes(pass)) prior.passes.push(pass);
    },
    list: () => [...byKey.values()].map(finding => ({ ...finding, frames: finding.frames.sort((a, b) => a - b) }))
  };
}

/**
 * A frame reached by an adjacent step settles where direct selection does.
 * The documented exception is forward playback retaining an accepted view:
 * it never zooms in past the stage fit, it contains the stage envelope, and
 * it holds the syntax shared with the previous frame no further from where it
 * was painted than the stage fit would. Later micro-steps of the same stage
 * keep the entry pose and inherit its verdict, so a disallowed entry is one
 * finding whose `frames` lists the frames it persists through.
 */
export function checkSettledPathIndependence(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = findings(), allowed = [];
  for (const pass of trace.passes) {
    let entry = null;
    for (const step of pass.steps) {
      const frame = trace.frames[step.to], direct = trace.direct[step.to];
      const difference = poseDistance(step.settled, direct, frame);
      if (difference <= thresholds.samePosePx) { entry = null; continue; }
      if (entry && trace.frames[step.from].stage === frame.stage && poseDistance(step.before, step.settled, frame) <= thresholds.samePosePx) {
        if (entry.key) found.add(entry.key, { frame: step.to + 1, passes: [pass.name] });
        else allowed.push({ ...entry.allowed, frame: step.to + 1, inheritedFrom: entry.allowed.frame });
        continue;
      }
      const measure = { settled: step.settled, direct, differencePx: round(difference) };
      const reasons = [];
      if (step.to !== step.from + 1) reasons.push('a backward step has no documented retention');
      else if (frame.final) reasons.push('the completed last Stage Record must use its fit');
      else {
        if (step.settled.k > direct.k + 1e-6) reasons.push(`it zooms in past the stage fit (k ${step.settled.k.toFixed(4)} > ${direct.k.toFixed(4)})`);
        const spill = worstOverflow(step.settled, frame, trace.view);
        if (spill > thresholds.clipPx) reasons.push(`its envelope overflows the view by ${round(spill)} px`);
        const before = trace.frames[step.from], ids = sharedIds(before, frame);
        if (!ids.length) reasons.push('no syntax is shared with the previous frame, so retention holds nothing still');
        else {
          const retained = median(syntaxTravel(step.before, before, step.settled, frame, ids));
          const fitted = median(syntaxTravel(step.before, before, direct, frame, ids));
          Object.assign(measure, { retainedTravelPx: round(retained), fittedTravelPx: round(fitted) });
          if (retained > fitted + thresholds.steadierPx)
            reasons.push(`shared syntax travels ${round(retained)} px under the retained view but ${round(fitted)} px under the fit`);
        }
      }
      if (reasons.length) {
        const key = `${step.to}:${poseKey(step.settled)}`;
        found.add(key, { rule: 'settled-path-independence', frame: step.to + 1, from: step.from + 1, passes: [pass.name],
          detail: `stepping from frame ${step.from + 1} settles at ${poseText(step.settled)}, ${round(difference)} px from direct `
            + `selection ${poseText(direct)}: ${reasons.join('; ')}`, measure });
        entry = { key };
      } else {
        const accepted = { frame: step.to + 1, from: step.from + 1, pass: pass.name, ...measure };
        allowed.push(accepted);
        entry = { allowed: accepted };
      }
    }
  }
  return { violations: found.list(), allowed };
}

/**
 * Every distinct settled pose of a frame (direct selection and each pass)
 * shows its syntax inside the usable view, keeps the stage bounds unclipped,
 * and does not pin the stage envelope to one edge while a large share of the
 * view stays empty on the opposite side. One finding covers the frames of a
 * stage that share the pose and the problem.
 */
export function checkContentPlacement(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = findings(), { view } = trace;
  const poses = trace.frames.map(() => new Map());
  const add = (index, pose, source) => {
    const key = poseKey(pose);
    if (!poses[index].has(key)) poses[index].set(key, { pose, sources: [] });
    if (!poses[index].get(key).sources.includes(source)) poses[index].get(key).sources.push(source);
  };
  trace.direct.forEach((pose, index) => add(index, pose, 'direct'));
  for (const pass of trace.passes) for (const step of pass.steps) add(step.to, step.settled, pass.name);
  poses.forEach((entries, index) => {
    const frame = trace.frames[index];
    for (const [key, { pose, sources }] of entries) {
      const problems = [], kinds = [], measure = { pose };
      const clipped = [...frame.nodes].flatMap(([id, point]) => {
        const { x, y } = screen(pose, point);
        const side = y < view.top - thresholds.clipPx ? 'under the header' : y > view.bottom + thresholds.clipPx ? 'under the Replay panel'
          : x < view.left - thresholds.clipPx ? 'beyond the left edge' : x > view.right + thresholds.clipPx ? 'beyond the right edge' : null;
        return side ? [{ id, side }] : [];
      });
      if (clipped.length) {
        const sides = [...new Set(clipped.map(entry => entry.side))];
        measure.clippedSyntax = clipped;
        kinds.push(`syntax ${sides.join(',')}`);
        problems.push(`${clipped.length} of ${frame.nodes.size} syntax nodes ${sides.join(', ')} (${clipped.slice(0, 4).map(entry => entry.id).join(', ')})`);
      }
      const clippedSides = Object.entries(overflow(screenRect(pose, frame.bounds), view)).filter(([, amount]) => amount > thresholds.clipPx);
      if (clippedSides.length) {
        measure.boundsOverflow = Object.fromEntries(clippedSides.map(([side, amount]) => [side, round(amount)]));
        kinds.push(`bounds ${clippedSides.map(([side]) => side).join(',')}`);
        problems.push(`stage bounds clipped ${clippedSides.map(([side, amount]) => `${side} ${round(amount)} px`).join(', ')}`);
      }
      const envelope = screenRect(pose, frame.envelope);
      if (envelope) for (const [low, high, extent] of [['left', 'right', view.right - view.left], ['top', 'bottom', view.bottom - view.top]]) {
        const gapLow = low === 'left' ? envelope.left - view.left : envelope.top - view.top;
        const gapHigh = high === 'right' ? view.right - envelope.right : view.bottom - envelope.bottom;
        if (gapLow < -thresholds.clipPx || gapHigh < -thresholds.clipPx) continue;
        const pinned = Math.min(gapLow, gapHigh), empty = Math.max(gapLow, gapHigh);
        if (pinned > thresholds.pinPx || empty < thresholds.emptyShare * extent) continue;
        const side = gapLow <= gapHigh ? low : high;
        measure.pinned = { side, emptyPx: round(empty), emptyShare: Math.round(empty / extent * 100) / 100 };
        kinds.push(`pinned ${side}`);
        problems.push(`content pinned to the ${side} edge with ${round(empty)} px (${Math.round(empty / extent * 100)}%) of the view empty opposite`);
      }
      if (!problems.length) continue;
      found.add(`${frame.stage}:${key}:${kinds.join(';')}`, { rule: 'content-placement', frame: index + 1, from: null, passes: sources,
        detail: `settled pose ${poseText(pose)}: ${problems.join('; ')}`, measure });
    }
  });
  return found.list();
}

/**
 * The first pose painted on a step keeps the shared syntax on the canvas where
 * the previous settled frame showed it, and does not jump syntax whose
 * attachment the step leaves unchanged. The camera may then travel smoothly.
 * Each finding names its cause: the camera's first pose, a new stage's
 * coordinates under an unchanged camera, or relayout within one stage.
 */
export function checkFirstPaintContinuity(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = findings(), { width, height } = trace.canvas;
  const outside = ({ x, y }) => Math.max(-x, x - width, -y, y - height, 0);
  for (const pass of trace.passes) for (const step of pass.steps) {
    const before = trace.frames[step.from], after = trace.frames[step.to];
    const shared = sharedIds(before, after);
    if (!shared.length) continue;
    const unmoved = unmovedIds(before, after), still = new Set(unmoved);
    const lost = shared.filter(id => !outside(screen(step.before, before.nodes.get(id)))
      && outside(screen(step.first, after.nodes.get(id))) > thresholds.offCanvasPx);
    const reference = unmoved.length ? unmoved : shared;
    const jump = median(syntaxTravel(step.before, before, step.first, after, reference));
    const problems = [];
    if (lost.length) {
      const moved = lost.filter(id => !still.has(id)).length;
      problems.push(`${lost.length} of ${shared.length} shared nodes${moved === lost.length ? ', all moved by this step,' : ''} `
        + `paint beyond the canvas (${lost.slice(0, 4).join(', ')})`);
    }
    if (jump > thresholds.jumpPx) problems.push(`${unmoved.length ? 'unmoved' : 'shared'} syntax jumps a median ${round(jump)} px`);
    if (!problems.length) continue;
    // A camera can cancel only a common shift. What remains after the median
    // shift is the syntax's own relayout, which no pose can hold still.
    const shift = axis => median(reference.map(id => screen(step.first, after.nodes.get(id))[axis] - screen(step.before, before.nodes.get(id))[axis]));
    const [dx, dy] = [shift('x'), shift('y')];
    const relayout = median(reference.map(id => {
      const p = screen(step.before, before.nodes.get(id)), q = screen(step.first, after.nodes.get(id));
      return Math.hypot(q.x - p.x - dx, q.y - p.y - dy);
    }));
    const cause = poseDistance(step.before, step.first, after) > thresholds.samePosePx ? 'camera first pose'
      : before.stage !== after.stage ? 'stage coordinates under an unchanged camera' : 'relayout within the stage';
    found.add(`${step.from}:${step.to}:${poseKey(step.before)}:${poseKey(step.first)}`, { rule: 'first-paint-continuity',
      frame: step.to + 1, from: step.from + 1, passes: [pass.name],
      detail: `the step from frame ${step.from + 1} first paints ${poseText(step.first)} after ${poseText(step.before)}: `
        + `${problems.join('; ')} (${cause})`,
      measure: { cause, shared: shared.length, unmoved: unmoved.length, offCanvas: lost.length,
        offCanvasMoved: lost.filter(id => !still.has(id)).length,
        offCanvasPx: round(Math.max(0, ...lost.map(id => outside(screen(step.first, after.nodes.get(id)))))),
        medianJumpPx: round(jump), commonShiftPx: round(Math.hypot(dx, dy)), relayoutPx: round(relayout),
        before: step.before, first: step.first } });
  }
  return found.list();
}

/**
 * Micro-steps of one authored stage share one camera. A change is allowed only
 * where the previous pose no longer contains the stage envelope (documented
 * overflow); steps into or out of the completed last Stage Record use its fit.
 * One finding covers a stage's steps that make the same change.
 */
export function checkWithinStageStability(trace, thresholds = CAMERA_THRESHOLDS) {
  const found = findings();
  for (const pass of trace.passes) for (const step of pass.steps) {
    const before = trace.frames[step.from], after = trace.frames[step.to];
    if (before.stage !== after.stage || before.final || after.final) continue;
    const change = poseDistance(step.before, step.settled, after);
    if (change <= thresholds.samePosePx || worstOverflow(step.before, after, trace.view) > thresholds.clipPx) continue;
    found.add(`${after.stage}:${poseKey(step.before)}:${poseKey(step.settled)}`, { rule: 'within-stage-stability',
      frame: step.to + 1, from: step.from + 1, passes: [pass.name],
      detail: `a step within stage ${after.stage + 1} moves the camera ${round(change)} px, from ${poseText(step.before)} `
        + `to ${poseText(step.settled)}, though the previous pose contains the stage`,
      measure: { changePx: round(change), before: step.before, settled: step.settled } });
  }
  return found.list();
}

/** Every rule over one trace. */
export function checkCameraTrace(trace, thresholds = CAMERA_THRESHOLDS) {
  const path = checkSettledPathIndependence(trace, thresholds);
  return {
    violations: [...path.violations, ...checkContentPlacement(trace, thresholds),
      ...checkFirstPaintContinuity(trace, thresholds), ...checkWithinStageStability(trace, thresholds)],
    allowed: path.allowed
  };
}
