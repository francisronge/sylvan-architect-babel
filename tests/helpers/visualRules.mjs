import { foreseenPocketBlocker, newPocketBlocker, ownRoutesChanged, returnsWithinReach } from '../../replay/relations/pocketHold.ts';
import { blocksCarriedPocket } from '../../replay/relations/plaquePlacement.ts';

/** Static geometry rules for one painted frame, independent of how the frame was
 * measured. An adapter normalizes a frame to the model below and calls
 * `checkFrame`; the offline layout (tests/helpers/visualFrames.mjs) is one
 * adapter and a browser probe can be another. Findings follow
 * tests/helpers/findings.mjs; the caller fills `record`.
 *
 * Frame model. Coordinates are tree units; `zoom` converts them to CSS pixels.
 *   { frame, viewport, zoom, rowHeight?, stage?, texts, plaques, lines, chrome? }
 *   rowHeight is the layout's row in tree units, when the adapter knows it; stage
 *   is the authored stage the frame shows. checkMarkMotion also takes the camera's
 *   carry between two frames { dx, dy } when the adapter measures it.
 *   texts   [{ id, kind, text, boxes, halo, nodes, claims, lines?, plaque?, reach?, distance? }]
 *     kind 'category' or 'word' is tree text; any other kind is a mark's own text.
 *     boxes are glyph boxes, one per painted line or index run; halo is the width
 *     of the dark outline painted under them; nodes are the tree nodes it labels;
 *     claims are the relation keys ('stage:relation') whose mark it belongs to;
 *     lines are the wrapped lines of a label; plaque is the plaque holding it;
 *     reach and distance measure a mark's text against its placer's preferred spots.
 *   plaques [{ id, text, rect, radius, claims, anchor?, size?, pocket?, key?, grid?, joined?, content? }]
 *     rect is the drawn shell and radius its corner radius; anchor { x, y } is the
 *     point the allocator measures from (below a word-bearing leaf, its word);
 *     size is the allocated box when it differs from rect; pocket is the allocated
 *     box as the schedule placed it, with the narrower `syntaxGap` it was accepted
 *     at, if any (by default rect's corner and size); key is the plaque's identity
 *     among `reserves` owners; grid marks a theta grid; joined marks a plaque tied
 *     to syntax by an arrow or collector of its own; content { width, height } is the
 *     box the rows it paints need, when the adapter knows it.
 *   lines   [{ id, kind, paths, halfWidth, nodes, claims, masked? }]
 *     paths are polylines of { x, y }; nodes are the tree nodes it may meet (a
 *     branch its parent and child, its path running parent to child; a stem its
 *     word; a connector its witnesses' subtrees); masked lines are painted under
 *     tree text by design.
 *   reserves [PocketOccupant] the boxes plaque allocation reserves for what the
 *     frame paints (replay/relations/pocketHold.ts), when the adapter has them;
 *     only mark-motion reads these.
 *   chrome  { canvas, panel?, header? } rects, when the adapter knows the screen.
 * Ids must be stable across frames: node ids, or a mark's claim, text and anchor.
 *
 * Not reported by design (Francis, 18 October): the final-frame spotlight fit,
 * two different index letters for two chains, and the rail below the deepest
 * connector lane. Index letters are counted by checkOneLetterPerLabel
 * (tests/helpers/replayInvariants.mjs, PR #75), not here. */

/** Every rule the visual audit reports. checkFrame applies all but layout-width,
 * which compares one record's frames across viewports (visualFrames.mjs,
 * layoutWidthFindings), and mark-motion, which compares adjacent frames
 * (checkMarkMotion, and checkStaleShell for its stale-shell subtype). */
export const RULES = Object.freeze(['glyph-overlap', 'line-clearance', 'mark-distance', 'label-typography', 'clipped', 'branch-geometry',
  'parent-centring', 'layout-width', 'mark-motion', 'region-overlap']);

/** CSS pixels at the frame's Fit unless noted. Glyph boxes may share a two-pixel
 * sliver of outline; a stroke must keep a pixel from a plaque shell and may not
 * enter text by more than a pixel; a mark may exceed its placer's reach by 10%
 * (a ratio), a mark's text also by 20 pixels; a connector this close to a plaque
 * of its own claim is that plaque's leader. Tree units for mark-motion: a plaque
 * may shift `motionUnits` against its anchor between frames, and an anchor that
 * moves `stillUnits` or less stays still. What occupies a pocket is pocketHold.ts's. A
 * plaque shell may exceed its painted content by `shellRowUnits`, one Case row. */
export const THRESHOLDS = Object.freeze({ overlapPx: 2, clearancePx: 1, crossingPx: 1, reachMargin: 0.1, textReachPx: 20,
  leaderPx: 6, clippedPx: 2, rowUnits: 1, centringPx: 1, motionUnits: 4, stillUnits: 1, shellRowUnits: 62 });

const TREE_TEXT = new Set(['category', 'word']);
const LOCAL_PLAQUE = 480;
const finding = (rule, subtype, frame, subject, detail, measure = null) => ({ rule, subtype, record: null, subject,
  frame: frame.frame, viewport: frame.viewport, measure: measure === null ? null : Math.round(measure * 100) / 100, detail });
const shares = (a = [], b = []) => a.some(value => b.includes(value));
const px = (frame, units) => Math.round(units * frame.zoom);
const describe = item => `${item.kind ?? 'plaque'} "${item.text}"`;

const overlap1d = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** The deepest point of a polyline inside a rectangle, with corners rounded by
 * `radius`: the largest distance from its nearest edge, or 0 when the line stays outside. */
export function penetration(points, box, radius = 0) {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, box.x + r), box.x + box.width - r), cy = Math.min(Math.max(y, box.y + r), box.y + box.height - r);
    const edge = Math.min(x - box.x, box.x + box.width - x, y - box.y, box.y + box.height - y);
    return cx === x || cy === y ? edge : r - Math.hypot(x - cx, y - cy);
  };
  let deepest = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], to = points[index];
    let enter = 0, leave = 1;
    const dx = to.x - from.x, dy = to.y - from.y;
    for (const [origin, delta, min, max] of [[from.x, dx, box.x, box.x + box.width], [from.y, dy, box.y, box.y + box.height]]) {
      if (Math.abs(delta) < 1e-9) { if (origin <= min || origin >= max) { enter = 1; leave = 0; } continue; }
      const a = (min - origin) / delta, b = (max - origin) / delta;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    }
    if (enter >= leave) continue;
    for (let sample = 0; sample <= 8; sample++) {
      const t = enter + (leave - enter) * sample / 8, x = from.x + dx * t, y = from.y + dy * t;
      deepest = Math.max(deepest, inside(x, y));
    }
  }
  return deepest;
}

const pointSegment = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
const segmentSegment = (a, b, c, d) => {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0) && d1 && d2 && d3 && d4) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
};
/** Centre-line distance from a polyline to a rounded rectangle's outline; 0 when
 * it reaches inside. A radius of 0 is a plain rectangle. */
export function pathToShell(points, box, radius = 0) {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
  const inner = { x: box.x + r, y: box.y + r, width: box.width - 2 * r, height: box.height - 2 * r };
  const inside = p => p.x >= inner.x && p.x <= inner.x + inner.width && p.y >= inner.y && p.y <= inner.y + inner.height;
  const corners = [{ x: inner.x, y: inner.y }, { x: inner.x + inner.width, y: inner.y },
    { x: inner.x + inner.width, y: inner.y + inner.height }, { x: inner.x, y: inner.y + inner.height }];
  let best = Infinity;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    if (inside(a) || inside(b)) return 0;
    best = Math.min(best, ...corners.map((corner, side) => segmentSegment(a, b, corner, corners[(side + 1) % 4])));
  }
  if (points.length === 1) best = inside(points[0]) ? 0 : Math.min(...corners.map((corner, side) =>
    pointSegment(points[0], corner, corners[(side + 1) % 4])));
  return Math.max(0, best - r);
}

const bounds = points => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};
const near = (outline, box, pad) => outline.x - pad <= box.x + box.width && outline.x + outline.width + pad >= box.x
  && outline.y - pad <= box.y + box.height && outline.y + outline.height + pad >= box.y;

/** glyph-overlap: two glyph or plaque boxes overlap by more than the tolerance
 * in both directions, one grown by the larger outline (a text's dark outline
 * over another's glyphs counts). Exempt: boxes of one tree node, text held by a
 * plaque, two mark texts of one claim (laid out together), and nested shells. */
export function checkGlyphOverlap(frame, thresholds = THRESHOLDS) {
  const boxes = [
    ...frame.texts.flatMap(text => text.boxes.map(rect => ({ item: text, rect, pad: text.halo ?? 0, tree: TREE_TEXT.has(text.kind) }))),
    ...frame.plaques.map(plaque => ({ item: plaque, rect: plaque.rect, pad: 0.75, plaque: true }))
  ].sort((a, b) => a.rect.x - b.rect.x);
  const limit = thresholds.overlapPx / frame.zoom, widest = Math.max(0, ...boxes.map(entry => entry.pad)), found = new Map();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (b.rect.x - widest > a.rect.x + a.rect.width) break;
    if (a.item === b.item || shares(a.item.nodes, b.item.nodes)) continue;
    if (!a.tree && !b.tree && !a.plaque && !b.plaque && shares(a.item.claims, b.item.claims)) continue;
    if (a.item.plaque === b.item.id || b.item.plaque === a.item.id) continue;
    if (a.plaque && b.plaque && (contains(a.rect, b.rect) || contains(b.rect, a.rect))) continue;
    const pad = Math.max(a.pad, b.pad);
    const ox = overlap1d(a.rect.x - pad, a.rect.x + a.rect.width + pad, b.rect.x, b.rect.x + b.rect.width);
    const oy = overlap1d(a.rect.y - pad, a.rect.y + a.rect.height + pad, b.rect.y, b.rect.y + b.rect.height);
    if (ox <= limit || oy <= limit) continue;
    const [first, second] = [a, b].sort((x, y) => x.item.id.localeCompare(y.item.id));
    const subject = `${first.item.id} ${second.item.id}`, measure = Math.min(ox, oy) * frame.zoom;
    if ((found.get(subject)?.measure ?? -1) >= measure) continue;
    found.set(subject, finding('glyph-overlap', a.plaque && b.plaque ? 'plaque' : a.plaque || b.plaque ? 'text-plaque' : 'text',
      frame, subject, `${describe(first.item)} overlaps ${describe(second.item)} by ${px(frame, ox)}×${px(frame, oy)}px`, measure));
  }
  return [...found.values()];
}

/** line-clearance: a connector whose stroke comes within the tolerance of a
 * plaque shell of another claim (subtype connector-plaque, measured as the
 * missing clearance) or runs into it (connector-plaque-crossing, measured as
 * depth), or a line that runs more than the tolerance into text or a
 * plaque that is not its own (subtypes like branch-text or connector-mark,
 * measured as depth). Mark text counts only through its middle band, deeper
 * than 45% of its height, since its outline masks a grazing line. Not tested:
 * masked lines against text, and branches or stems against mark text (role
 * labels are placed against labels, plaques and relation ink, not branches). */
export function checkLineClearance(frame, thresholds = THRESHOLDS) {
  const out = new Map(), crossing = thresholds.crossingPx / frame.zoom;
  const keep = entry => {
    const key = `${entry.subtype} ${entry.subject}`;
    if ((out.get(key)?.measure ?? -1) < entry.measure) out.set(key, entry);
  };
  const textTargets = frame.texts.filter(text => !text.plaque).flatMap(text => text.boxes.map(rect => ({ item: text, rect,
    kind: TREE_TEXT.has(text.kind) ? 'text' : 'mark',
    limit: TREE_TEXT.has(text.kind) ? crossing : Math.max(crossing, 0.45 * Math.min(rect.width, rect.height)) })));
  for (const line of frame.lines) {
    const points = line.paths.flat();
    if (!points.length) continue;
    const outline = bounds(points);
    if (line.kind === 'connector') for (const plaque of frame.plaques) {
      if (shares(line.claims, plaque.claims) || !near(outline, plaque.rect, 20 / frame.zoom)) continue;
      const centre = Math.min(...line.paths.map(path => pathToShell(path, plaque.rect, plaque.radius ?? 0)));
      const clearance = (centre - line.halfWidth - 0.75) * frame.zoom, subject = `${line.id} ${plaque.id}`;
      if (clearance < thresholds.clearancePx) keep(finding('line-clearance', 'connector-plaque', frame, subject,
        `${line.kind} ${line.id} ${centre === 0 ? 'reaches into' : 'touches'} ${describe(plaque)}: clearance ${clearance.toFixed(1)}px`,
        thresholds.clearancePx - clearance));
      // Clearance saturates once a line enters the shell; a crossing keeps its own depth.
      const depth = Math.max(...line.paths.map(path => penetration(path, plaque.rect, plaque.radius ?? 0)));
      if (depth > crossing) keep(finding('line-clearance', 'connector-plaque-crossing', frame, subject,
        `${line.kind} ${line.id} runs ${px(frame, depth)}px into ${describe(plaque)}`, depth * frame.zoom));
    }
    const targets = [
      ...textTargets.filter(target => !line.masked && (line.kind === 'connector' || target.kind === 'text')),
      ...(line.kind === 'connector' ? [] : frame.plaques.map(plaque => ({ item: plaque, rect: plaque.rect, kind: 'plaque', limit: crossing })))
    ];
    for (const { item, rect, kind, limit } of targets) {
      if (shares(line.nodes, item.nodes) || shares(line.claims, item.claims) || !near(outline, rect, 0)) continue;
      const depth = Math.max(...line.paths.map(path => penetration(path, rect)));
      if (depth > limit) keep(finding('line-clearance', `${line.kind}-${kind}`, frame, `${line.id} ${item.id}`,
        `${line.kind} ${line.id} runs ${px(frame, depth)}px into ${describe(item)}`, depth * frame.zoom));
    }
  }
  return [...out.values()];
}

/** The plaque allocator's farthest nearby pocket from its anchor
 * (replay/relations/plaquePlacement.ts, placeStagePlaques): the right or left
 * column 110 units out, the lowest row 235 units below. */
export const plaqueNearbyReach = ({ width, height }) => Math.hypot(110 + width / 2, 235 + height / 2);

/** mark-distance: a plaque that relies on proximity farther from its anchor than
 * the allocator's farthest nearby pocket, or a mark's text farther from its
 * placer's preferred spots, by more than `reachMargin` of that reach (measured
 * as the ratio). The catalogued floating plaques lie 14% to 51% beyond; a few
 * units past the farthest pocket still sits beside the anchor. Mark text must
 * also be `textReachPx` beyond: a tiny witness label has a small reach, and one
 * outward step past a crowded spot still reads as its own. Exempt: plaques
 * joined to syntax, plaques with a leader connector of their own claim, and
 * large plaques placed below their subtree by design. */
export function checkMarkDistance(frame, thresholds = THRESHOLDS) {
  const out = [], margin = 1 + thresholds.reachMargin, leader = thresholds.leaderPx / frame.zoom;
  for (const plaque of frame.plaques) {
    const size = plaque.size ?? plaque.rect;
    if (!plaque.anchor || plaque.joined || plaque.realization
      || !(Math.max(size.width, size.height) <= LOCAL_PLAQUE || plaque.grid && size.height <= LOCAL_PLAQUE)) continue;
    if (frame.lines.some(line => line.kind === 'connector' && shares(line.claims, plaque.claims)
      && Math.min(...line.paths.map(path => pathToShell(path, plaque.rect))) <= leader)) continue;
    const reach = plaqueNearbyReach(size);
    const distance = Math.hypot(plaque.rect.x + size.width / 2 - plaque.anchor.x, plaque.rect.y + size.height / 2 - plaque.anchor.y);
    if (distance > reach * margin) out.push(finding('mark-distance', 'plaque', frame, plaque.id,
      `${describe(plaque)} is ${Math.round(distance)} units from its anchor; nearby reach ${Math.round(reach)}`, distance / reach));
  }
  for (const text of frame.texts) {
    if (!(text.reach > 0) || text.distance <= text.reach * margin || (text.distance - text.reach) * frame.zoom <= thresholds.textReachPx) continue;
    out.push(finding('mark-distance', text.kind, frame, text.id,
      `${describe(text)} is ${Math.round(text.distance)} units from its witness; nearby reach ${Math.round(text.reach)}`, text.distance / text.reach));
  }
  return out;
}

/** mark-distance, subtype realization: a realization group's plate (`realization`,
 * realizationDisplay.ts), which allocation places after every relation's plaque, farther
 * than `reachMargin` beyond its nearby reach from its owner while a pocket at least
 * that margin nearer stays clear. Pockets are searched on a 40-unit grid around the
 * owner, nearest first. A pocket is clear when none of `blockers` (pocket occupants,
 * carried to this frame's anchor) comes within the plaque gap: the boxes allocation
 * reserved through the plate's stay in its pocket, so a pocket that later syntax or
 * marks take does not count. Plates of any size are judged. */
export function checkRealizationDistance(frame, blockersOf = plaque => frame.reserves ?? [], thresholds = THRESHOLDS) {
  const out = [], margin = 1 + thresholds.reachMargin;
  for (const plaque of frame.plaques) {
    if (!plaque.realization || !plaque.anchor) continue;
    const size = plaque.size ?? plaque.rect, { width, height } = size, { x: ax, y: ay } = plaque.anchor;
    const reach = plaqueNearbyReach(size), distanceOf = box => Math.hypot(box.x + width / 2 - ax, box.y + height / 2 - ay);
    const distance = distanceOf(plaque.rect);
    if (distance <= reach * margin) continue;
    const bound = distance / margin, step = 40, cells = Math.floor(bound / step);
    const near = { x: ax - bound - width, y: ay - bound - height, width: 2 * (bound + width), height: 2 * (bound + height) };
    const blockers = blockersOf(plaque).filter(occupant => (occupant.owner === undefined || occupant.owner !== (plaque.key ?? plaque.id))
      && blocksCarriedPocket(near, occupant));
    const pockets = [];
    for (let i = -cells; i <= cells; i++) for (let j = -cells; j <= cells; j++) {
      const box = { x: ax + i * step - width / 2, y: ay + j * step - height / 2, width, height };
      if (distanceOf(box) <= bound) pockets.push(box);
    }
    const nearer = pockets.sort((a, b) => distanceOf(a) - distanceOf(b)).find(box => !blockers.some(blocker => blocksCarriedPocket(box, blocker)));
    if (nearer) out.push(finding('mark-distance', 'realization', frame, plaque.id,
      `${describe(plaque)} is ${Math.round(distance)} units from its owner, nearby reach ${Math.round(reach)}, while a pocket ${Math.round(distanceOf(nearer))} units away stays clear`,
      distance / reach));
  }
  return out;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Marks that complete what precedes them: closing brackets and quotes, clause
// punctuation (with CJK forms), ellipses, percent signs, primes, degree and
// bar-level marks.
const CLOSING = /^[\p{Pe}\p{Pf},.;:!?、。，．；：！？…‥％‰°′″‴'’”»›⁰¹²³⁴⁵⁶⁷⁸⁹]/u;
const OPENING_END = /[\p{Ps}\p{Pi}]$/u;
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u;

/** label-typography: a wrapped label whose later line starts with a closing mark
 * (closing-start), is a lone remnant of at most two graphemes or only
 * punctuation (fragment), or whose earlier line ends with an opening mark
 * (opening-end). A short first line is an ordinary break after a head symbol
 * (`AP` / `(subject-oriented …`). */
export function checkLabelTypography(frame) {
  const out = [];
  for (const text of frame.texts) {
    if ((text.lines?.length ?? 0) < 2) continue;
    const lines = text.lines.map(line => line.trim()), subject = `${text.id} ${JSON.stringify(text.lines)}`;
    const subtypes = new Set(lines.flatMap((line, index) => [
      ...(index > 0 && CLOSING.test(line) ? ['closing-start'] : []),
      ...(index > 0 && line && ([...graphemes.segment(line)].length <= 2 || PUNCTUATION_ONLY.test(line)) ? ['fragment'] : []),
      ...(index < lines.length - 1 && OPENING_END.test(line) ? ['opening-end'] : [])]));
    for (const subtype of subtypes) out.push(finding('label-typography', subtype, frame, subject, `${JSON.stringify(text.lines)}: ${subtype}`));
  }
  return out;
}

/** clipped: text or a plaque hidden under the Replay panel or header, or cut off
 * by the canvas edge, by more than the tolerance; or no tree text left visible.
 * A connector is clipped where its centre line runs that far under the panel or
 * header, or past the canvas edge (a mark the panel cuts). Branches and stems
 * follow their tree text. Needs `frame.chrome`, which only an adapter that knows
 * the screen supplies. */
export function checkClipped(frame, thresholds = THRESHOLDS) {
  if (!frame.chrome?.canvas) return [];
  const limit = thresholds.clippedPx / frame.zoom, { canvas, panel, header } = frame.chrome, out = [];
  const items = [...frame.texts.filter(text => !text.plaque).map(text => ({ item: text, rects: text.boxes })),
    ...frame.plaques.map(plaque => ({ item: plaque, rects: [plaque.rect] }))];
  for (const { item, rects } of items) {
    for (const [subtype, region] of [['under-panel', panel], ['under-header', header]]) {
      const hidden = region && Math.max(0, ...rects.map(rect => Math.min(overlap1d(rect.x, rect.x + rect.width, region.x, region.x + region.width),
        overlap1d(rect.y, rect.y + rect.height, region.y, region.y + region.height))));
      if (hidden > limit) out.push(finding('clipped', subtype, frame, item.id, `${describe(item)} is under the ${subtype.slice(6)}`, hidden * frame.zoom));
    }
    const outside = Math.max(0, ...rects.map(rect => Math.max(canvas.x - rect.x, rect.x + rect.width - canvas.x - canvas.width,
      canvas.y - rect.y, rect.y + rect.height - canvas.y - canvas.height)));
    if (outside > limit) out.push(finding('clipped', 'off-canvas', frame, item.id, `${describe(item)} extends past the canvas`, outside * frame.zoom));
  }
  for (const line of frame.lines.filter(line => line.kind === 'connector')) {
    const points = line.paths.flat();
    for (const [subtype, region] of [['under-panel', panel], ['under-header', header]]) {
      const hidden = region && Math.max(0, ...points.map(p => Math.min(p.x - region.x, region.x + region.width - p.x,
        p.y - region.y, region.y + region.height - p.y)));
      if (hidden > limit) out.push(finding('clipped', subtype, frame, line.id, `${line.kind} ${line.id} runs under the ${subtype.slice(6)}`, hidden * frame.zoom));
    }
    const outside = Math.max(0, ...points.map(p => Math.max(canvas.x - p.x, p.x - canvas.x - canvas.width, canvas.y - p.y, p.y - canvas.y - canvas.height)));
    if (outside > limit) out.push(finding('clipped', 'off-canvas', frame, line.id, `${line.kind} ${line.id} runs past the canvas`, outside * frame.zoom));
  }
  const tree = frame.texts.filter(text => TREE_TEXT.has(text.kind));
  if (tree.length && tree.every(text => out.some(entry => entry.subtype === 'off-canvas' && entry.subject === text.id)))
    out.push(finding('clipped', 'no-syntax', frame, '@frame', 'no tree text is on the canvas'));
  return out;
}

/** branch-geometry: a visible parent→child syntax branch spans exactly one
 * layout row (`frame.rowHeight`, tree units), and the visible children of one
 * parent share a row (subtypes span and sisters, measured as the deviation in
 * CSS pixels). A branch's first and last path points are its parent and child.
 * Word stems, hanging words, trajectories and relation marks are other line
 * kinds and never tested here. Skipped without `rowHeight`. */
export function checkBranchGeometry(frame, thresholds = THRESHOLDS) {
  if (!(frame.rowHeight > 0)) return [];
  const out = [], children = new Map();
  for (const line of frame.lines) {
    if (line.kind !== 'branch' || !line.paths[0]?.length) continue;
    const from = line.paths[0][0], to = line.paths[0].at(-1), deviation = Math.abs(to.y - from.y - frame.rowHeight);
    if (deviation > thresholds.rowUnits) out.push(finding('branch-geometry', 'span', frame, line.id,
      `branch ${line.id} spans ${Math.round(to.y - from.y)} units, not one ${frame.rowHeight}-unit row`, deviation * frame.zoom));
    const [parent, child] = line.nodes;
    children.set(parent, [...(children.get(parent) ?? []), { child, y: to.y }]);
  }
  for (const [parent, list] of children) {
    const ys = list.map(entry => entry.y), spread = Math.max(...ys) - Math.min(...ys);
    if (spread > thresholds.rowUnits) out.push(finding('branch-geometry', 'sisters', frame, `${parent} children`,
      `children of ${parent} sit on different rows: ${list.map(entry => `${entry.child} ${Math.round(entry.y)}`).join(', ')}`,
      spread * frame.zoom));
  }
  return out;
}

/** parent-centring: a visible parent stands over the midpoint of its outermost
 * visible daughters, as layoutSyntaxTree centres every current parent; a parent
 * with one visible daughter stands over it. Daughters are read from painted
 * branches, so hidden, layout-only and triangulated material does not count.
 * The measure is the offset in CSS pixels. */
export function checkParentCentring(frame, thresholds = THRESHOLDS) {
  const parents = new Map();
  for (const line of frame.lines) {
    if (line.kind !== 'branch' || !line.paths[0]?.length) continue;
    const [parent] = line.nodes, from = line.paths[0][0], to = line.paths[0].at(-1);
    if (!parents.has(parent)) parents.set(parent, { x: from.x, daughters: [] });
    parents.get(parent).daughters.push({ id: line.nodes[1], x: to.x });
  }
  const out = [];
  for (const [parent, { x, daughters }] of parents) {
    const xs = daughters.map(daughter => daughter.x), middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    const offset = Math.abs(x - middle) * frame.zoom;
    if (offset > thresholds.centringPx) out.push(finding('parent-centring', 'offset', frame, parent,
      `${parent} stands ${Math.round(x - middle)} units off the midpoint of ${daughters.map(daughter => daughter.id).join(', ')}`, offset));
  }
  return out;
}

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : 0; };
const firstPoint = item => item.boxes?.[0] ?? item.rect ?? item.paths?.[0]?.[0];

/** mark-motion: a plaque shown in two adjacent frames of one viewport keeps its
 * pocket, its offset from its anchor, unless the rule the Replay schedule moves it by
 * (replay/relations/pocketHold.ts) lets it go:
 *   - its anchor moves (against the camera's carry across a stage boundary),
 *   - its own Case arrow or collectors start, end, meet another row or leave a source
 *     that moved,
 *   - the later frame newly paints something in its pocket's way: within one stage
 *     only another plaque or its own route, since the stage laid out its syntax and
 *     marks in advance and the plaque should have left before they arrived,
 *   - a later frame of the later frame's stage, while the plaque stays shown there
 *     beside a still anchor, newly paints syntax or a mark in its pocket's way
 *     (`ahead`: the frames after `after` of its viewport and stage, in order), or
 *   - it shows its owner only by proximity and returns from beyond its nearby reach
 *     to within it, into a pocket that what the earlier frame had there has left.
 * The frames' `reserves` say what each paints, as the schedule saw it. Subtype
 * plaque-teleport; the frame is the transition and the measure the shift in tree
 * units. */
export function checkMarkMotion(before, after, thresholds = THRESHOLDS, cameraCarry = undefined, ahead = []) {
  if (!before || before.viewport !== after.viewport) return [];
  const textsBefore = new Map(before.texts.map(text => [text.id, text]));
  const offsets = after.texts.filter(text => TREE_TEXT.has(text.kind) && textsBefore.has(text.id)).map(text => {
    const from = firstPoint(textsBefore.get(text.id)), to = firstPoint(text);
    return { dx: to.x - from.x, dy: to.y - from.y };
  });
  // One camera fit serves a stage; across a stage boundary the camera carries the
  // syntax the crossing leaves in place (`cameraCarry`, from carryCamera), or else
  // the median shift of tree text.
  const crossing = before.stage !== undefined && before.stage !== after.stage;
  const carry = !crossing ? { dx: 0, dy: 0 } : cameraCarry
    ?? { dx: median(offsets.map(offset => offset.dx)), dy: median(offsets.map(offset => offset.dy)) };
  const shiftOf = (prior, plaque) => Math.hypot(plaque.rect.x - prior.rect.x - plaque.anchor.x + prior.anchor.x,
    plaque.rect.y - prior.rect.y - plaque.anchor.y + prior.anchor.y);
  // Plaques sharing an id pair with their nearest earlier pocket of the same size.
  const unpaired = before.plaques.filter(plaque => plaque.anchor);
  const earlier = before.reserves ?? [], later = after.reserves ?? [];
  const out = [];
  for (const plaque of after.plaques) {
    if (!plaque.anchor) continue;
    const candidates = unpaired.filter(prior => prior.id === plaque.id);
    const sized = candidates.filter(prior => prior.rect.width === plaque.rect.width && prior.rect.height === plaque.rect.height);
    const prior = (sized.length ? sized : candidates).sort((a, b) => shiftOf(a, plaque) - shiftOf(b, plaque))[0];
    if (!prior) continue;
    unpaired.splice(unpaired.indexOf(prior), 1);
    const move = { x: plaque.anchor.x - prior.anchor.x, y: plaque.anchor.y - prior.anchor.y }, shift = shiftOf(prior, plaque);
    if (shift <= thresholds.motionUnits || Math.hypot(move.x - carry.dx, move.y - carry.dy) > thresholds.stillUnits) continue;
    const owner = plaque.key ?? plaque.id;
    const pocketOf = ({ rect, size = rect, pocket = { x: rect.x, y: rect.y, width: size.width, height: size.height } }) => pocket;
    const pocket = { ...pocketOf(prior), x: pocketOf(prior).x + move.x, y: pocketOf(prior).y + move.y };
    // Within a stage, syntax and marks a frame newly paints were laid out in advance.
    const blocked = newPocketBlocker({ pocket, owner, move }, earlier, later);
    const foreseen = blocked && before.stage !== undefined && !crossing && !newPocketBlocker({ pocket, owner, move }, earlier, later, occupant => occupant.owner !== undefined);
    if (ownRoutesChanged(owner, move, earlier, later) || blocked && !foreseen
      || !blocked && foreseenPocketBlocker({ pocket, move }, earlier, aheadOf(plaque, prior, ahead, thresholds))
      || !plaque.joined && returnsWithinReach({ before: { pocket, anchor: plaque.anchor }, after: { pocket: pocketOf(plaque),
        anchor: plaque.anchor }, owner, move, thetaGrid: plaque.grid }, earlier, later)) continue;
    out.push(finding('mark-motion', 'plaque-teleport', after, plaque.id, foreseen
      ? `${describe(plaque)} jumps ${Math.round(shift)} units beside its still anchor when its stage paints syntax or a mark it laid out in advance in its pocket`
      : `${describe(plaque)} jumps ${Math.round(shift)} units from a pocket nothing new occupies, beside its still anchor`, shift));
  }
  return out.map(entry => ({ ...entry, frame: `${before.frame}>${after.frame}` }));
}

/** mark-motion, subtype stale-shell: a plaque whose shell is larger than the content
 * it paints by more than a row (`shellRowUnits`, tree units, in width or height) while
 * an earlier frame of the same viewport, showing it continuously in a shell of that
 * size, painted content that filled it to within a row. When rows leave a plaque its
 * shell fits the rest at that step. Only plaques whose adapter reports `content`
 * { width, height } are judged. `history` maps each plaque id to its run so far and
 * is updated; pass a fresh Map per viewport and the frames in order. The frame is the
 * transition and the measure the larger excess. */
export function checkStaleShell(before, after, history, thresholds = THRESHOLDS) {
  const out = [], row = thresholds.shellRowUnits, seen = new Set();
  for (const plaque of after.plaques) {
    seen.add(plaque.id);
    const shell = plaque.rect, content = plaque.content, prior = before ? history.get(plaque.id) : undefined;
    const same = prior && Math.abs(prior.width - shell.width) < 1 && Math.abs(prior.height - shell.height) < 1;
    const run = same ? prior : { width: shell.width, height: shell.height, filled: false };
    if (content) {
      const excess = Math.max(shell.width - content.width, shell.height - content.height);
      if (excess <= row) run.filled = true;
      else if (same && prior.filled) out.push(finding('mark-motion', 'stale-shell', after, plaque.id,
        `${describe(plaque)} keeps a shell ${Math.round(excess)} units larger than the content it paints now`, excess));
    }
    history.set(plaque.id, run);
  }
  for (const id of [...history.keys()]) if (!seen.has(id)) history.delete(id);
  return out.map(entry => ({ ...entry, frame: `${before?.frame}>${after.frame}` }));
}

/** The frames of `ahead` while `plaque` stays shown in them with its anchor within
 * `stillUnits` of where `plaque` has it (pocketHold.ts, AheadStep), each with what
 * it paints and the anchor's move since `prior`, the plaque in the earlier frame. */
function aheadOf(plaque, prior, ahead, thresholds) {
  const steps = [];
  for (const frame of ahead) {
    const later = frame.plaques.find(other => other.id === plaque.id && other.anchor);
    if (!later || Math.hypot(later.anchor.x - plaque.anchor.x, later.anchor.y - plaque.anchor.y) > thresholds.stillUnits) break;
    steps.push({ occupants: frame.reserves ?? [], move: { x: later.anchor.x - prior.anchor.x, y: later.anchor.y - prior.anchor.y } });
  }
  return steps;
}

const REGION_MARKS = new Set(['enclosure', 'domain-region', 'domain-ellipse']);
const claimsOfMark = mark => /\(([^)]*)\)/.exec(mark.id ?? '')?.[1].split('/').filter(Boolean) ?? [];

/** region-overlap: a plaque shell across the outline of a region mark that belongs to
 * no claim of its own, entering it by more than `overlapPx`: an enclosure, a domain box
 * or a domain ellipse in `marks` (bound region primitives, tree units, the claims in
 * their id `type(stage:relation/…)#n`). A plaque wholly inside a region does not cross
 * its outline. Subtype plaque; the measure is the depth in pixels. */
export function checkRegionOverlap(frame, thresholds = THRESHOLDS) {
  const out = [];
  for (const mark of frame.marks ?? []) {
    if (!REGION_MARKS.has(mark.type)) continue;
    const claims = claimsOfMark(mark);
    for (const plaque of frame.plaques) {
      if (shares(plaque.claims, claims)) continue;
      const r = plaque.rect;
      let depth;
      if (mark.type === 'domain-ellipse') {
        // How far inside the ellipse the shell's nearest point lies, along its nearer axis.
        const x = Math.min(Math.max(mark.cx, r.x), r.x + r.width), y = Math.min(Math.max(mark.cy, r.y), r.y + r.height);
        const reach = Math.hypot((x - mark.cx) / mark.rx, (y - mark.cy) / mark.ry);
        const inside = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]
          .every(([cx, cy]) => Math.hypot((cx - mark.cx) / mark.rx, (cy - mark.cy) / mark.ry) <= 1);
        depth = reach >= 1 || inside ? 0 : (1 - reach) * Math.min(mark.rx, mark.ry);
      } else depth = contains(mark, r) ? 0 : Math.min(overlap1d(r.x, r.x + r.width, mark.x, mark.x + mark.width),
        overlap1d(r.y, r.y + r.height, mark.y, mark.y + mark.height));
      if (depth * frame.zoom > thresholds.overlapPx) out.push(finding('region-overlap', 'plaque', frame, `${plaque.id} ${mark.id}`,
        `${describe(plaque)} enters the ${mark.type} of ${claims.join('/')} by ${px(frame, depth)} px`, depth * frame.zoom));
    }
  }
  return out;
}

/** Every rule on one normalized frame. */
export const checkFrame = (frame, thresholds = THRESHOLDS) => [
  ...checkGlyphOverlap(frame, thresholds), ...checkLineClearance(frame, thresholds), ...checkMarkDistance(frame, thresholds),
  ...checkLabelTypography(frame), ...checkClipped(frame, thresholds), ...checkBranchGeometry(frame, thresholds),
  ...checkParentCentring(frame, thresholds), ...checkRegionOverlap(frame, thresholds)
];
