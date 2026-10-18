/** Static geometry rules for one painted frame, independent of how the frame was
 * measured. An adapter normalizes a frame to the model below and calls
 * `checkFrame`; the offline layout (tests/helpers/visualFrames.mjs) is one
 * adapter and a browser probe can be another. Findings follow
 * tests/helpers/findings.mjs; the caller fills `record`.
 *
 * Frame model. Coordinates are tree units; `zoom` converts them to CSS pixels.
 *   { frame, viewport, zoom, texts, plaques, lines, chrome? }
 *   texts   [{ id, kind, text, boxes, halo, nodes, claims, lines?, plaque?, reach?, distance? }]
 *     kind 'category' or 'word' is tree text; any other kind is a mark's own text.
 *     boxes are glyph boxes, one per painted line or index run; halo is the width
 *     of the dark outline painted under them; nodes are the tree nodes it labels;
 *     claims are the relation keys ('stage:relation') whose mark it belongs to;
 *     lines are the wrapped lines of a label; plaque is the plaque holding it;
 *     reach and distance measure a mark's text against its placer's preferred spots.
 *   plaques [{ id, text, rect, radius, claims, anchor?, size?, grid?, joined? }]
 *     rect is the drawn shell and radius its corner radius; anchor { x, y } is the
 *     point the allocator measures from (below a word-bearing leaf, its word);
 *     size is the allocated box when it differs from rect; grid marks a theta grid;
 *     joined marks a plaque tied to syntax by an arrow or collector of its own.
 *   lines   [{ id, kind, paths, halfWidth, nodes, claims, masked? }]
 *     paths are polylines of { x, y }; nodes are the tree nodes it may meet (a
 *     branch its parent and child, a stem its word, a connector its witnesses'
 *     subtrees); masked lines are painted under tree text by design.
 *   chrome  { canvas, panel?, header? } rects, when the adapter knows the screen.
 * Ids must be stable across frames: node ids, or a mark's claim, text and anchor.
 *
 * Not reported by design (Francis, 18 October): the final-frame spotlight fit,
 * two different index letters for two chains, and the rail below the deepest
 * connector lane. Index letters are counted by checkOneLetterPerLabel
 * (tests/helpers/replayInvariants.mjs, PR #75), not here. */

export const RULES = Object.freeze(['glyph-overlap', 'line-clearance', 'mark-distance', 'label-typography', 'clipped']);

/** CSS pixels at the frame's Fit unless noted. Glyph boxes may share a two-pixel
 * sliver of outline; a stroke must keep a pixel from a plaque shell and may not
 * enter text by more than a pixel; a mark may exceed its placer's reach by 10%
 * (a ratio), a mark's text also by 20 pixels; a connector this close to a plaque
 * of its own claim is that plaque's leader. */
export const THRESHOLDS = Object.freeze({ overlapPx: 2, clearancePx: 1, crossingPx: 1, reachMargin: 0.1, textReachPx: 20,
  leaderPx: 6, clippedPx: 2 });

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

/** The deepest point of a polyline inside a rectangle: the largest distance from
 * the rectangle's nearest edge, or 0 when the line stays outside. */
export function penetration(points, box) {
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
      deepest = Math.max(deepest, Math.min(x - box.x, box.x + box.width - x, y - box.y, box.y + box.height - y));
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
 * missing clearance), or a line that runs more than the tolerance into text or a
 * plaque that is not its own (subtypes like branch-text or connector-mark,
 * measured as depth). Mark text counts only through its middle band, deeper
 * than 45% of its height, since its outline masks a grazing line. Not tested:
 * masked lines against text, and branches or stems against mark text (role
 * labels are placed against labels, plaques and relation ink, not branches). */
export function checkLineClearance(frame, thresholds = THRESHOLDS) {
  const out = new Map(), crossing = thresholds.crossingPx / frame.zoom;
  const keep = (subject, entry) => { if ((out.get(subject)?.measure ?? -1) < entry.measure) out.set(subject, entry); };
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
      const clearance = (centre - line.halfWidth - 0.75) * frame.zoom;
      if (clearance < thresholds.clearancePx) keep(`${line.id} ${plaque.id}`, finding('line-clearance', 'connector-plaque', frame,
        `${line.id} ${plaque.id}`, `${line.kind} ${line.id} ${centre === 0 ? 'reaches into' : 'touches'} ${describe(plaque)}: `
          + `clearance ${clearance.toFixed(1)}px`, thresholds.clearancePx - clearance));
    }
    const targets = [
      ...textTargets.filter(target => !line.masked && (line.kind === 'connector' || target.kind === 'text')),
      ...(line.kind === 'connector' ? [] : frame.plaques.map(plaque => ({ item: plaque, rect: plaque.rect, kind: 'plaque', limit: crossing })))
    ];
    for (const { item, rect, kind, limit } of targets) {
      if (shares(line.nodes, item.nodes) || shares(line.claims, item.claims) || !near(outline, rect, 0)) continue;
      const depth = Math.max(...line.paths.map(path => penetration(path, rect)));
      if (depth > limit) keep(`${line.id} ${item.id}`, finding('line-clearance', `${line.kind}-${kind}`, frame, `${line.id} ${item.id}`,
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
    if (!plaque.anchor || plaque.joined || !(Math.max(size.width, size.height) <= LOCAL_PLAQUE || plaque.grid && size.height <= LOCAL_PLAQUE)) continue;
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

/** Every rule on one normalized frame. */
export const checkFrame = (frame, thresholds = THRESHOLDS) => [
  ...checkGlyphOverlap(frame, thresholds), ...checkLineClearance(frame, thresholds), ...checkMarkDistance(frame, thresholds),
  ...checkLabelTypography(frame), ...checkClipped(frame, thresholds)
];
