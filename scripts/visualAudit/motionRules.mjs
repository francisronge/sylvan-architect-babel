// Judges what the page painted frame by frame while it moved: one Next step,
// rapid Next presses, or a viewport resize. Samples come from the page probe's
// sampler, which reads the DOM after animation callbacks and layout, before paint:
//   { t, gen, rendered, settled, transform:{x,y,k}|null, visibility, cover, canvas,
//     nodes: [[id, cx, cy, opacity, parentId]], marks: [[key, opacity]] }
// `visibility` multiplies the SVG's and tree group's effective opacity; `cover`
// is the strongest opaque layer over the tree; `gen` changes when the tree is redrawn.
// Findings follow tests/helpers/findings.mjs; the camera policy itself lives in
// tests/helpers/cameraInvariants.mjs and settled-layout continuity in judgeStageSyntax.
import { median, pointInRect } from './geometry.mjs';
import { stepOwnership } from '../../tests/helpers/motionOwnership.mjs';

export const DEFAULT_MOTION = Object.freeze({
  shownOpacity: 0.5,       // a node reads as painted at or above this
  presentOpacity: 0.05,    // below this a node or mark is not painted at all
  minVisibility: 0.9,      // tree opacity × uncovered share
  offCanvasPx: 24,         // a retained node centre this far past the canvas is out of sight
  minShared: 3,
  teleportPx: 160,         // one-frame median jump of retained syntax
  nodeJumpPx: 160,         // one retained node's jump beyond the common motion
  detourPx: 160,           // extra path beyond the net move (a fly-in), per node
  snapBackMinPx: 40,       // a jump this large that returns near an older pose
  snapBackRatio: 0.25,
  jitterMovePx: 1.5,       // per-frame motion that counts as moving
  jitterIdleFrames: 2,     // idle frames that separate two movement episodes
  reversalPx: 3,
  layoutUnits: 1           // settled retained syntax may not move inside a stage (tree units)
});

const CHECKS = {
  step: ['empty', 'faded', 'offcanvas', 'teleport', 'nodeJump', 'detour', 'blinks', 'markBlinks'],
  rapid: ['empty', 'faded', 'offcanvas', 'teleport', 'nodeJump', 'snapBack', 'blinks', 'markBlinks'],
  // The same frame is shown before and after a resize: nothing may vanish.
  resize: ['empty', 'faded', 'blinks', 'markBlinks', 'vanished', 'jitter']
};

const nodesOf = sample => new Map((sample.nodes || []).map(([id, x, y, opacity, parent]) => [id, { x, y, opacity, parent }]));
const marksOf = sample => new Map((sample.marks || []).map(([key, opacity]) => [key, opacity]));

function timeline(samples, m) {
  return samples.map((sample, index) => {
    const nodes = nodesOf(sample), canvas = sample.canvas;
    const beyond = node => canvas ? Math.max(canvas.x - node.x, node.x - canvas.x - canvas.width, canvas.y - node.y, node.y - canvas.y - canvas.height, 0) : 0;
    const onCanvas = node => !canvas || pointInRect([node.x, node.y], canvas);
    let shownOnCanvas = 0, presentOnCanvas = 0;
    for (const node of nodes.values()) {
      if (!onCanvas(node)) continue;
      if (node.opacity >= m.presentOpacity) presentOnCanvas++;
      if (node.opacity >= m.shownOpacity) shownOnCanvas++;
    }
    const next = samples[index + 1];
    return { index, t: sample.t, k: sample.transform?.k, nodes, marks: marksOf(sample), onCanvas, beyond, shownOnCanvas, presentOnCanvas,
      visibility: (sample.visibility ?? 1) * (1 - (sample.cover ?? 0)), cover: sample.cover ?? 0,
      durationMs: next ? Math.max(0, next.t - sample.t) : 1000 / 60 };
  });
}

const span = (picked, t0) => ({ frames: picked.length, durationMs: Math.round(picked.reduce((sum, frame) => sum + frame.durationMs, 0)),
  firstAtMs: picked.length ? Math.round(picked[0].t - t0) : null });

/** Per-node one-frame moves of `ids` painted in both frames, their common (median)
 * move, and each node's residual apart from the view. A camera zoom moves every
 * node by its distance from the zoom centre, so residuals first scale the earlier
 * position by the sampled camera's zoom ratio; the median then removes the common
 * translation (camera pan, zoom centre and SVG origin alike). */
function moves(a, b, ids, m) {
  const list = [], zoom = a.k > 0 && b.k > 0 ? b.k / a.k : 1;
  for (const id of ids) {
    const p = a.nodes.get(id), q = b.nodes.get(id);
    if (p && q && p.opacity >= m.presentOpacity && q.opacity >= m.presentOpacity)
      list.push({ id, dx: q.x - p.x, dy: q.y - p.y, vx: q.x - zoom * p.x, vy: q.y - zoom * p.y });
  }
  if (!list.length) return null;
  const dx = median(list.map(move => move.dx)), dy = median(list.map(move => move.dy));
  const vx = median(list.map(move => move.vx)), vy = median(list.map(move => move.vy));
  return { dx, dy, length: median(list.map(move => Math.hypot(move.dx, move.dy))), list,
    residuals: list.map(move => ({ id: move.id, rx: move.vx - vx, ry: move.vy - vy, px: Math.hypot(move.vx - vx, move.vy - vy) })) };
}

/** shown → not shown → shown runs for every key shown in some frame. */
function blinkRuns(frames, keys, shownAt) {
  const runs = [];
  for (const key of keys) {
    let seen = false, hidden = 0, start = null;
    for (const frame of frames) {
      if (frame.presentOnCanvas === 0) continue; // an empty frame is reported on its own
      if (shownAt(frame, key)) {
        if (seen && hidden) runs.push({ key, hiddenFrames: hidden, atFrame: start });
        seen = true; hidden = 0; start = null;
      } else if (seen) { if (!hidden) start = frame.index; hidden++; }
    }
  }
  return runs;
}

/**
 * Judges one sampled motion; `context` ('step', 'rapid' or 'resize') selects the
 * checks and names the rule (`step-motion`, ...). `place` is { record, frame,
 * viewport } for the findings. `exemptFade` skips opacity where Replay's opening
 * reveal fades in. Position checks follow retained syntax whose ancestors present
 * in both end frames are unchanged; a reattached constituent may move with it.
 */
export function judgeMotion(samples, { context = 'step', place = {}, label = '', exemptFade = false, checks, thresholds = {} } = {}) {
  const m = { ...DEFAULT_MOTION, ...thresholds }, enabled = new Set(checks || CHECKS[context] || CHECKS.step);
  if (!samples || samples.length < 2) return [];
  const frames = timeline(samples, m), first = frames[0], last = frames.at(-1), t0 = first.t, findings = [];
  const add = (subtype, measure, message, metrics, subject = '@view') => findings.push({ rule: `${context}-motion`, subtype,
    record: place.record ?? null, subject, frame: place.frame ?? null, viewport: place.viewport ?? null,
    measure: measure === null ? null : Math.round(measure * 100) / 100, detail: `${label ? `${label}: ` : ''}${message}`, metrics });

  const retained = [...first.nodes].filter(([id, node]) => node.opacity >= m.shownOpacity && first.onCanvas(node)
    && last.nodes.get(id)?.opacity >= m.shownOpacity && last.onCanvas(last.nodes.get(id))).map(([id]) => id);
  const both = new Set([...first.nodes.keys()].filter(id => last.nodes.has(id)));
  const chain = (frame, id) => {
    const out = [];
    for (let parent = frame.nodes.get(id)?.parent, guard = 0; parent && guard < 500; parent = frame.nodes.get(parent)?.parent, guard++) if (both.has(parent)) out.push(parent);
    return out.join(' ');
  };
  const anchoredIds = retained.filter(id => chain(first, id) === chain(last, id));
  const anchored = anchoredIds.length >= m.minShared ? anchoredIds : retained;

  if (enabled.has('empty') && first.shownOnCanvas > 0 && last.shownOnCanvas > 0) {
    const empty = frames.slice(1, -1).filter(frame => frame.presentOnCanvas === 0);
    if (empty.length) add('empty-frame', span(empty, t0).durationMs, `${empty.length} painted frame(s) show no syntax on the canvas`, span(empty, t0));
  }
  if (enabled.has('faded') && !exemptFade) {
    const dimmed = frame => {
      const values = anchored.map(id => frame.nodes.get(id)?.opacity).filter(value => value >= m.presentOpacity);
      return anchored.length >= m.minShared && values.length ? median(values) : 1;
    };
    const faded = frames.map(frame => ({ frame, level: frame.visibility * dimmed(frame) })).filter(entry => entry.level < m.minVisibility);
    if (faded.length) {
      const lowest = Math.min(...faded.map(entry => entry.level));
      add('faded', 1 - lowest, `the tree is faded or covered in ${faded.length} frame(s)`, { ...span(faded.map(entry => entry.frame), t0),
        minVisibility: Number(lowest.toFixed(3)), maxCover: Number(Math.max(...faded.map(entry => entry.frame.cover)).toFixed(3)) });
    }
  }
  if (enabled.has('offcanvas') && anchored.length) {
    // A camera move between two poses that both show a node keeps it on the canvas.
    const lost = new Map();
    for (const frame of frames.slice(1, -1)) for (const id of anchored) {
      const node = frame.nodes.get(id);
      if (node && node.opacity >= m.presentOpacity && frame.beyond(node) > m.offCanvasPx) lost.set(id, [...(lost.get(id) ?? []), frame]);
    }
    if (lost.size) {
      const worst = Math.max(...[...lost.values()].map(list => list.length));
      add('offcanvas', lost.size, `${lost.size} of ${anchored.length} retained nodes are painted off the canvas`,
        { nodes: [...lost.keys()].slice(0, 12), retained: anchored.length, longestFrames: worst,
          ...span([...new Set([...lost.values()].flat())].sort((a, b) => a.index - b.index), t0) });
    }
  }
  const steps = frames.slice(1).map((frame, index) => {
    const dt = Math.max(frame.t - frames[index].t, 1e-3);
    return { frame, dt, move: moves(frames[index], frame, anchored.length ? anchored : [...frame.nodes.keys()], m), scale: Math.min(1, 33.4 / dt) };
  });
  if (enabled.has('teleport')) {
    // A long frame legitimately covers more of a smooth camera move.
    const jumps = steps.filter(entry => entry.move && entry.move.length * entry.scale > m.teleportPx);
    if (jumps.length) {
      const largest = Math.max(...jumps.map(entry => entry.move.length));
      add('teleport', largest, `retained syntax jumps ${Math.round(largest)}px in one frame`, span(jumps.map(entry => entry.frame), t0));
    }
  }
  if (enabled.has('nodeJump')) {
    // The duration scale lets a long frame carry more of a node's ongoing motion;
    // it must not discount a snap, and a redraw that snaps syntax is itself a
    // long frame. A move that neither holding still nor keeping the node's
    // previous pace explains is a jump however long the frame took, so the
    // verdict on a snap does not depend on how fast the browser painted it.
    const unexplained = (node, entry, previous) => {
      const before = previous?.move?.residuals.find(other => other.id === node.id);
      if (!before) return 0;
      const px = before.rx * entry.dt / previous.dt, py = before.ry * entry.dt / previous.dt, length = px * px + py * py;
      const along = length > 1e-9 ? Math.min(1, Math.max(0, (node.rx * px + node.ry * py) / length)) : 0;
      return Math.hypot(node.rx - along * px, node.ry - along * py);
    };
    const jumps = steps.flatMap((entry, index) => (entry.move?.residuals || [])
      .filter(node => node.px * entry.scale > m.nodeJumpPx || unexplained(node, entry, steps[index - 1]) > m.nodeJumpPx)
      .map(node => ({ ...node, frame: entry.frame })));
    if (jumps.length) {
      const largest = jumps.reduce((best, jump) => jump.px > best.px ? jump : best);
      add('node-jump', largest.px, `${new Set(jumps.map(jump => jump.id)).size} retained node(s) jump apart from the view, ${largest.id} by ${Math.round(largest.px)}px`,
        { nodes: [...new Set(jumps.map(jump => jump.id))].slice(0, 12), ...span([...new Set(jumps.map(jump => jump.frame))], t0) });
    }
  }
  if (enabled.has('detour') && anchored.length) {
    const excess = anchored.map(id => {
      let path = 0, previous = null;
      for (const frame of frames) {
        const node = frame.nodes.get(id);
        if (!node || node.opacity < m.presentOpacity) continue;
        if (previous) path += Math.hypot(node.x - previous.x, node.y - previous.y);
        previous = node;
      }
      const a = first.nodes.get(id), b = last.nodes.get(id);
      return { id, px: path - Math.hypot(a.x - b.x, a.y - b.y) };
    }).filter(entry => entry.px > m.detourPx);
    if (excess.length) {
      const largest = excess.reduce((best, entry) => entry.px > best.px ? entry : best);
      add('fly-in', largest.px, `${excess.length} retained node(s) leave and fly back in, ${largest.id} travelling ${Math.round(largest.px)}px beyond its net move`,
        { nodes: excess.map(entry => entry.id).slice(0, 12), medianDetourPx: Math.round(median(excess.map(entry => entry.px))) });
    }
  }
  if (enabled.has('snapBack')) {
    const backs = [];
    for (let index = 2; index < frames.length; index++) {
      const move = steps[index - 1].move;
      if (!move || move.length <= m.snapBackMinPx) continue;
      const pool = anchored.length >= m.minShared ? anchored : [...frames[index].nodes.keys()];
      for (let earlier = 0; earlier <= index - 2; earlier++) {
        const ids = pool.filter(id => frames[index].nodes.has(id) && frames[earlier].nodes.has(id) && frames[index - 1].nodes.has(id));
        const back = ids.length >= m.minShared ? moves(frames[earlier], frames[index], ids, m) : null;
        if (back && back.length < m.snapBackRatio * move.length) { backs.push({ frame: frames[index], jump: move.length, framesBack: index - earlier }); break; }
      }
    }
    if (backs.length) {
      const largest = Math.max(...backs.map(entry => entry.jump));
      add('snap-back', largest, `the view jumps back to an earlier pose ${backs.length} time(s)`,
        { ...span(backs.map(entry => entry.frame), t0), framesBack: backs.map(entry => entry.framesBack) });
    }
  }
  const everShown = (key, get) => frames.some(frame => get(frame, key));
  if (enabled.has('blinks')) {
    const shownAt = (frame, id) => frame.nodes.get(id)?.opacity >= m.shownOpacity;
    const keys = [...new Set(frames.flatMap(frame => [...frame.nodes.keys()]))].filter(id => everShown(id, shownAt));
    const runs = blinkRuns(frames, keys, shownAt);
    if (runs.length) add('node-blink', Math.max(...runs.map(run => run.hiddenFrames)), `${new Set(runs.map(run => run.key)).size} painted node(s) disappear and reappear`,
      { examples: runs.slice(0, 8).map(run => ({ id: run.key, hiddenFrames: run.hiddenFrames, atMs: Math.round(frames[run.atFrame].t - t0) })) });
  }
  if (enabled.has('markBlinks')) {
    // Relation moments quiet other marks to 0.3; only a mark that stops painting blinks.
    const shownAt = (frame, key) => frame.marks.get(key) >= m.presentOpacity;
    const keys = [...new Set(frames.flatMap(frame => [...frame.marks.keys()]))].filter(key => everShown(key, shownAt));
    const runs = blinkRuns(frames, keys, shownAt);
    if (runs.length) add('mark-blink', Math.max(...runs.map(run => run.hiddenFrames)), `${new Set(runs.map(run => run.key)).size} relation mark(s) disappear and reappear`,
      { examples: runs.slice(0, 8).map(run => ({ key: run.key, hiddenFrames: run.hiddenFrames, atMs: Math.round(frames[run.atFrame].t - t0) })) });
  }
  if (enabled.has('vanished')) {
    const goneNodes = [...first.nodes].filter(([id, node]) => node.opacity >= m.shownOpacity && !(last.nodes.get(id)?.opacity >= m.presentOpacity)).map(([id]) => id);
    if (goneNodes.length) add('node-vanished', goneNodes.length, `${goneNodes.length} node(s) painted before are gone after`, { nodes: goneNodes.slice(0, 12) });
    const goneMarks = [...first.marks].filter(([key, opacity]) => opacity >= m.presentOpacity && !(last.marks.get(key) >= m.presentOpacity)).map(([key]) => key);
    if (goneMarks.length) add('mark-vanished', goneMarks.length, `${goneMarks.length} relation mark(s) painted before are gone after`, { marks: goneMarks.slice(0, 12) });
  }
  if (enabled.has('jitter')) {
    let episodes = 0, idle = Infinity, reversals = 0, previous = null, total = 0;
    for (const entry of steps) {
      if (entry.move && entry.move.length > m.jitterMovePx) {
        if (idle >= m.jitterIdleFrames) episodes++;
        idle = 0; total += entry.move.length;
        if (previous && Math.hypot(previous.dx, previous.dy) > m.reversalPx && Math.hypot(entry.move.dx, entry.move.dy) > m.reversalPx
          && previous.dx * entry.move.dx + previous.dy * entry.move.dy < 0) reversals++;
        previous = entry.move;
      } else idle++;
    }
    if (episodes > 1 || reversals) add('jitter', episodes + reversals,
      `the tree settles in ${episodes} separate movement(s)${reversals ? ` and reverses ${reversals} time(s)` : ''}`,
      { episodes, reversals, totalMovePx: Math.round(total) });
  }
  return findings;
}

export const judgeStepMotion = (samples, options = {}) => judgeMotion(samples, { ...options, context: 'step' });
export const judgeRapidStepping = (samples, options = {}) => judgeMotion(samples, { ...options, context: 'rapid' });
export const judgeResize = (samples, options = {}) => judgeMotion(samples, { ...options, context: 'resize' });

/** The first pose painted for a step: the first sample after a redraw (new
 * `gen`), else the first sample whose camera changed, else the settled pose. */
export function firstPaintedPose(samples) {
  const before = samples[0];
  const pose = samples.find(sample => sample.gen !== before?.gen && sample.transform)
    ?? samples.find(sample => sample.transform && JSON.stringify(sample.transform) !== JSON.stringify(before?.transform));
  return pose?.transform ?? samples.at(-1)?.transform ?? null;
}

/** The step pairs judgeStageSyntax judges: consecutive settled frames of one
 * authored stage whose later frame's step is known. */
export const continuityPairs = frames => frames.slice(1).map((after, index) => [frames[index], after])
  .filter(([before, after]) => after.number === before.number + 1 && Number.isFinite(after.stage)
    && after.stage === before.stage && !after.final && after.step);

/**
 * Settled painted syntax moves inside one authored stage only where the step
 * owns it (tests/helpers/motionOwnership.mjs: its target, its own trajectory
 * participants, new or reattached syntax, everything below those and the
 * ancestors that recentre over them). Frames are cameraFrame results in Replay
 * order with `number` and `step`. Every unowned node that moves is reported,
 * except one riding with its moving parent, so one shifted root is caught.
 */
export function judgeStageSyntax(frames, { place = {}, thresholds = {} } = {}) {
  const m = { ...DEFAULT_MOTION, ...thresholds }, out = [];
  for (const [before, after] of continuityPairs(frames)) {
    const owned = stepOwnership({ target: after.step.target, links: after.step.links, points: after.points, prior: before.points });
    const shiftOf = id => {
      const a = before.nodes.get(id), b = after.nodes.get(id);
      return a && b ? { x: b.x - a.x, y: b.y - a.y } : null;
    };
    const moved = new Map(after.points.filter(point => !owned.has(point.id)).map(point => [point.id, shiftOf(point.id)])
      .filter(([, shift]) => shift && Math.hypot(shift.x, shift.y) > m.layoutUnits));
    for (const [id, shift] of moved) {
      const parent = moved.get(after.points.find(point => point.id === id)?.parent);
      if (parent && Math.hypot(shift.x - parent.x, shift.y - parent.y) <= m.layoutUnits) continue;
      const a = before.nodes.get(id), b = after.nodes.get(id), shiftLength = Math.hypot(shift.x, shift.y);
      out.push({ rule: 'syntax-continuity', subtype: 'retained-node-moves', record: place.record ?? null, subject: id,
        frame: `${before.number}>${after.number}`, viewport: place.viewport ?? null, measure: Math.round(shiftLength * 100) / 100,
        detail: `${id} moves ${shiftLength.toFixed(1)} units inside stage ${after.stage} (${before.number}→${after.number}) at a step that does not own it`,
        metrics: { dx: Number((b.x - a.x).toFixed(2)), dy: Number((b.y - a.y).toFixed(2)) } });
    }
  }
  return out;
}
