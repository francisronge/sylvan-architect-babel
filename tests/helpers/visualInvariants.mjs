/** Static frame geometry checks: what is wrong in one painted frame. Each rule
 * takes a laid-out frame (tests/helpers/visualFrames.mjs) or, for duplicate
 * glyphs, a painter census (visualGlyphs.mjs), and returns violations
 * `{ rule, frame, detail, subject, view, viewport, px }`: `frame` is the
 * 1-based Replay frame or 'canopy', `subject` a stable key for expected-defect
 * lists, and `px` the size of the fault in CSS pixels at the frame's Fit.
 * Checkers never assert; callers decide which violations are expected.
 *
 * Deliberately not flagged (Francis, October 18): the final-frame camera fit
 * with the spotlight, two different index letters for two chains, and the
 * anchor rail below the deepest connector lane. Movement trajectories are
 * masked around tree text by design and are not tested against labels. */

export const RULES = Object.freeze(['glyph-overlap', 'line-clearance', 'mark-distance', 'duplicate-glyph', 'label-typography']);

/** Tolerances, in CSS pixels at the frame's Fit unless noted. Glyph boxes may
 * share a two-pixel sliver of outline; strokes must keep a pixel of clearance
 * from plaques and stay out of text by more than a pixel; marks may exceed
 * their allocator's reach by 10% (a ratio), and a role label by 20 pixels. */
export const THRESHOLDS = Object.freeze({ overlapPx: 2, clearancePx: 1, crossingPx: 1, reachMargin: 0.1, roleReachPx: 20 });

const violation = (rule, frame, subject, detail, px = null) => ({ rule, frame: frame.view === 'canopy' ? 'canopy' : frame.frame,
  view: frame.view, viewport: frame.viewport, subject, detail, px: px === null ? null : Math.round(px * 100) / 100 });
const fixed = value => Math.round(value);

const overlap1d = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/** The deepest point of a polyline inside a rectangle: the largest distance
 * from the rectangle's nearest edge, or 0 when the line stays outside. */
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
/** Centre-line distance from a straight piece to a rounded rectangle's outline;
 * 0 when the piece reaches inside it. */
export function pieceToRoundedRect([a, b], box, radius = 14) {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
  const inner = { x: box.x + r, y: box.y + r, width: box.width - 2 * r, height: box.height - 2 * r };
  const inside = p => p.x >= inner.x && p.x <= inner.x + inner.width && p.y >= inner.y && p.y <= inner.y + inner.height;
  if (inside(a) || inside(b)) return 0;
  const corners = [{ x: inner.x, y: inner.y }, { x: inner.x + inner.width, y: inner.y },
    { x: inner.x + inner.width, y: inner.y + inner.height }, { x: inner.x, y: inner.y + inner.height }];
  return Math.max(0, Math.min(...corners.map((corner, index) => segmentSegment(a, b, corner, corners[(index + 1) % 4]))) - r);
}

/** Glyph boxes: each painted line of a tree label, each plaque shell and each
 * role label's text, with the outline (halo) painted around it. */
const glyphBoxes = frame => [
  ...frame.labels.flatMap(label => label.boxes.map(box => ({ id: label.id, owner: label.node, rect: box, pad: label.halo,
    what: `${label.kind} "${label.text}"` }))),
  ...frame.plaques.map(plaque => ({ id: plaque.id, owner: plaque.id, rect: plaque.rect, pad: 0.75, what: `plaque [${plaque.text}]` })),
  ...frame.roles.map(role => ({ id: role.id, owner: role.id, rect: role.ink, pad: role.halo, what: `role "${role.text}" (${role.witness})` }))
];

/** glyph-overlap: two painted glyph or plaque boxes overlap by more than the
 * tolerance in both directions. Text is drawn over a dark outline (its halo),
 * so one text's outline over another's glyphs counts: the pair overlaps when
 * the glyph boxes, one grown by the larger halo, intersect. A node's own
 * category and word never pair. */
export function checkGlyphOverlap(frame, thresholds = THRESHOLDS) {
  const limit = thresholds.overlapPx / frame.zoom, boxes = glyphBoxes(frame).sort((a, b) => a.rect.x - b.rect.x), found = new Map();
  const widest = Math.max(0, ...boxes.map(entry => entry.pad));
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (b.rect.x - widest > a.rect.x + a.rect.width) break;
      if (a.owner === b.owner) continue;
      const pad = Math.max(a.pad, b.pad);
      const ox = overlap1d(a.rect.x - pad, a.rect.x + a.rect.width + pad, b.rect.x, b.rect.x + b.rect.width);
      const oy = overlap1d(a.rect.y - pad, a.rect.y + a.rect.height + pad, b.rect.y, b.rect.y + b.rect.height);
      if (ox <= limit || oy <= limit) continue;
      const [first, second] = [a, b].sort((x, y) => x.id.localeCompare(y.id));
      const subject = `${first.id} ${second.id}`, px = Math.min(ox, oy) * frame.zoom;
      if ((found.get(subject)?.px ?? -1) >= px) continue;
      found.set(subject, violation('glyph-overlap', frame, subject,
        `${first.what} overlaps ${second.what} by ${fixed(ox * frame.zoom)}×${fixed(oy * frame.zoom)}px`, px));
    }
  }
  return [...found.values()];
}

/** line-clearance: (a) a neutral connector whose stroke comes within the
 * tolerance of a visible plaque's outline, or crosses tree text or another
 * relation's role label; (b) a tree branch or word stem that runs into another
 * node's label or a plaque. Lines may meet their own labels: a branch its
 * parent's and child's, a stem its word, a connector its witnesses' subtrees
 * and its own role labels. Crossing counts once the line is more than the
 * tolerance inside the glyph box; a role label's outline masks a line that only
 * grazes it, so it counts only through its middle band (more than 45% of its
 * height inside). Branches behind neutral role labels are not reported: the
 * placer reserves labels, plaques and relation ink, not branches, and at Fit
 * those six-to-nine-pixel labels pass over faint branches unnoticed. */
export function checkLineClearance(frame, thresholds = THRESHOLDS) {
  const out = [], k = frame.zoom, crossing = thresholds.crossingPx / k;
  const near = (points, box, pad) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    return minX - pad <= box.x + box.width && maxX + pad >= box.x && minY - pad <= box.y + box.height && maxY + pad >= box.y;
  };
  const roleBand = role => Math.max(crossing, 0.45 * Math.min(role.ink.width, role.ink.height));
  const textTargets = [
    ...frame.labels.flatMap(label => label.boxes.map(box => ({ id: label.id, owner: label.node, rect: box, limit: crossing,
      what: `${label.kind} "${label.text}"` }))),
    ...frame.roles.map(role => ({ id: role.id, owner: role.id, item: role.itemIndex, rect: role.ink, limit: roleBand(role), what: `role "${role.text}"` }))
  ];
  const report = (line, target, depth, verb) => {
    const subject = `${line.id} ${target.id}`;
    const prior = out.find(entry => entry.subject === subject);
    if (prior && prior.px >= depth * k) return;
    if (prior) out.splice(out.indexOf(prior), 1);
    out.push(violation('line-clearance', frame, subject, `${line.what} ${verb} ${target.what} by ${fixed(depth * k)}px`, depth * k));
  };
  for (const connector of frame.connectors) {
    const points = connector.pieces.flat();
    if (!points.length) continue;
    const what = `connector ${connector.relation} (${connector.witnesses.join('→')})`;
    for (const plaque of frame.plaques) {
      if (!near(points, plaque.rect, 20 / k)) continue;
      const centre = Math.min(...connector.pieces.map(piece => pieceToRoundedRect(piece, plaque.rect)));
      const clearance = (centre - connector.halfWidth - 0.75) * k;
      if (clearance < thresholds.clearancePx) out.push(violation('line-clearance', frame, `${connector.id} ${plaque.id}`,
        `${what} ${centre === 0 ? 'reaches into' : 'touches'} plaque [${plaque.text}]: clearance ${clearance.toFixed(1)}px`,
        thresholds.clearancePx - clearance));
    }
    const own = new Set(connector.own ?? connector.witnesses);
    for (const target of textTargets) {
      if (own.has(target.owner) || target.item === connector.itemIndex || !near(points, target.rect, 0)) continue;
      const depth = Math.max(...connector.pieces.map(piece => penetration(piece, target.rect)));
      if (depth > target.limit) report({ id: connector.id, what }, target, depth, 'crosses');
    }
  }
  const lines = [
    ...frame.branches.map(branch => ({ id: branch.id, own: new Set([branch.parent, branch.child]), points: branch.points, what: `branch ${branch.id}` })),
    ...frame.stems.map(stem => ({ id: stem.id, own: new Set([stem.node]), points: stem.points, what: `stem of ${stem.node}` }))
  ];
  const targets = [...textTargets.filter(target => target.item === undefined),
    ...frame.plaques.map(plaque => ({ id: plaque.id, owner: plaque.id, rect: plaque.rect, limit: crossing, what: `plaque [${plaque.text}]` }))];
  for (const line of lines) for (const target of targets) {
    if (line.own.has(target.owner) || !near(line.points, target.rect, 0)) continue;
    const depth = penetration(line.points, target.rect);
    if (depth > target.limit) report(line, target, depth, 'runs into');
  }
  return out;
}

/** mark-distance: a plaque that relies on proximity (no Case arrow or
 * collector of its own) farther from its anchor than the allocator's farthest
 * nearby pocket, or a neutral role label pushed beyond its placer's preferred
 * spots around its witness label, in both cases by more than `reachMargin` of
 * that reach. The margin keeps a plaque that merely sits a few units past the
 * farthest pocket, still beside its anchor, from counting; the catalogued
 * floating plaques lie 14% to 51% beyond reach, some only a few pixels at Fit.
 * A role label must also be `roleReachPx` beyond: a tiny witness label has a
 * small reach, and one outward step past a crowded spot still reads as its own. */
export function checkMarkDistance(frame, thresholds = THRESHOLDS) {
  const out = [], limit = reach => reach * (1 + thresholds.reachMargin);
  for (const plaque of frame.plaques) {
    if (!plaque.local || plaque.connector || !plaque.anchor || plaque.distance <= limit(plaque.reach)) continue;
    out.push(violation('mark-distance', frame, plaque.id,
      `plaque [${plaque.text}] is ${fixed(plaque.distance)} units from anchor ${plaque.anchorId}; nearby reach ${fixed(plaque.reach)}`,
      (plaque.distance - plaque.reach) * frame.zoom));
  }
  for (const role of frame.roles) {
    if (role.distance <= limit(role.reach) || (role.distance - role.reach) * frame.zoom <= thresholds.roleReachPx) continue;
    out.push(violation('mark-distance', frame, role.id,
      `role "${role.text}" is ${fixed(role.distance)} units from witness ${role.witness}'s label; nearby reach ${fixed(role.reach)}`,
      (role.distance - role.reach) * frame.zoom));
  }
  return out;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Marks that complete what precedes them: closing brackets and quotes, sentence
// and clause punctuation (with CJK forms), primes, degree and bar-level marks.
const CLOSING = /^[\p{Pe}\p{Pf},.;:!?、。，．；：！？′″‴'’°⁰¹²³⁴⁵⁶⁷⁸⁹]/u;

/** label-typography: a wrapped category label whose later line starts with a
 * closing mark or is a lone short fragment (at most two graphemes), such as
 * `]` or `e]`. A short first line is an ordinary break after a head symbol
 * (`AP` / `(subject-oriented …`). */
export function checkLabelTypography(frame) {
  const out = [];
  for (const label of frame.labels) {
    if (label.kind !== 'category' || (label.lines?.length ?? 0) < 2) continue;
    const faults = label.lines.flatMap((line, index) => {
      const text = line.trim(), length = [...graphemes.segment(text)].length;
      return [...(index > 0 && CLOSING.test(text) ? [`line ${index + 1} starts with "${[...graphemes.segment(text)][0].segment}"`] : []),
        ...(index > 0 && length <= 2 ? [`line ${index + 1} is the fragment "${text}"`] : [])];
    });
    if (faults.length) out.push(violation('label-typography', frame, `${label.id} ${JSON.stringify(label.lines)}`,
      `${JSON.stringify(label.lines)}: ${faults.join('; ')}`));
  }
  return out;
}

/** duplicate-glyph: one occurrence label painted with the same index letter
 * more than once, by one painter or several. */
export function checkDuplicateGlyphs(census) {
  return census.flatMap(({ frame, glyphs }) => {
    const groups = new Map();
    for (const glyph of glyphs) {
      const key = JSON.stringify([glyph.label, glyph.letter]);
      groups.set(key, [...(groups.get(key) ?? []), glyph.painter]);
    }
    return [...groups].filter(([, painters]) => painters.length > 1).map(([key, painters]) => {
      const [label, letter] = JSON.parse(key);
      return { rule: 'duplicate-glyph', frame, view: 'replay', viewport: null, subject: `${label} ${letter}`, px: null,
        detail: `index ${letter} is painted ${painters.length} times at ${label} (${painters.sort().join('+')})` };
    });
  });
}

/** Every geometric rule on one laid-out frame. */
export const checkVisualFrame = (frame, thresholds = THRESHOLDS) => [
  ...checkGlyphOverlap(frame, thresholds), ...checkLineClearance(frame, thresholds),
  ...checkMarkDistance(frame, thresholds), ...checkLabelTypography(frame)
];
