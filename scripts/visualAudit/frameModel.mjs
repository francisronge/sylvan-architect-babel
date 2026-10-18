// Measurement adapter: painted DOM geometry from the page probe (CSS pixels) to
// the shared models the rules judge. Static geometry becomes the frame model of
// tests/helpers/visualRules.mjs (tree units, ids as the offline adapter names
// them), index letters feed tests/helpers/indexLetters.mjs, and settled poses
// become frames of the camera trace in tests/helpers/cameraInvariants.mjs.
import { availableTreeViewport } from '../../components/treeViewport.ts';
import { extractDisplayedSubscriptIndex } from '../../replay/replaySurfaceNotation.ts';
import { countLabelLetters, showLetter } from '../../tests/helpers/indexLetters.mjs';

const VIEWPORT_NAMES = { '1440x900': 'desktop', '2560x1440': 'desktop-large', '390x844': 'mobile' };
/** Pass names shared with the offline visual audit where the window sizes agree. */
export const viewportName = ({ width, height }) => VIEWPORT_NAMES[`${width}x${height}`] ?? `${width}x${height}`;

const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const shown = item => (item?.opacity ?? 1) >= 0.05;
const TREE_TEXT = new Set(['category', 'word', 'node-text']);

/** Screen to tree units through the painted camera: (screen − SVG origin − translate) / k. */
export function treeSpace({ camera, origin = { x: 0, y: 0 } }) {
  const { x, y, k } = camera;
  return { k,
    point: ([px, py]) => ({ x: (px - origin.x - x) / k, y: (py - origin.y - y) / k }),
    rect: box => box && { x: (box.x - origin.x - x) / k, y: (box.y - origin.y - y) / k, width: box.width / k, height: box.height / k } };
}

function hierarchy(snapshot) {
  const children = new Map(), parent = new Map();
  for (const { source, target } of snapshot.edges || []) {
    if (!children.has(source)) children.set(source, []);
    children.get(source).push(target);
    parent.set(target, source);
  }
  const descend = ids => {
    const out = new Set(), pending = [...ids];
    while (pending.length) {
      const id = pending.pop();
      if (!id || out.has(id)) continue;
      out.add(id);
      pending.push(...(children.get(id) || []));
    }
    return out;
  };
  const ancestors = id => {
    const out = [];
    for (let current = parent.get(id), guard = 0; current && guard < 1000; current = parent.get(current), guard++) out.push(current);
    return out;
  };
  return { children, parent, descend, ancestors };
}

/**
 * One painted frame in the shared rules' model. `anchorsFor(claims)` returns the
 * authored anchor node ids of those relations. Returns `{ model, screen }`:
 * `screen` maps each model id to its CSS-pixel boxes for contact sheets.
 */
export function toFrameModel(snapshot, { frame, viewport, anchorsFor = () => [] }) {
  const space = treeSpace(snapshot), tree = hierarchy(snapshot);
  const nodes = new Map((snapshot.nodes || []).map(node => [node.id, node]));
  const counts = new Map(), screen = new Map();
  const unique = id => {
    const seen = counts.get(id) ?? 0;
    counts.set(id, seen + 1);
    return seen ? `${id}#${seen + 1}` : id;
  };
  const anchorPoint = node => node && Number.isFinite(node.tx) ? { x: node.tx, y: node.ty + (node.leaf ? 140 : 0) } : undefined;

  const plaques = [], plaqueIds = new Map();
  for (const plaque of (snapshot.plaques || []).filter(shown)) {
    const text = (snapshot.texts || []).filter(item => item.plaque === plaque.uid).map(item => normalize(item.text)).join('; ');
    const rect = space.rect(plaque.box), centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    // A feature plaque names its anchor; other plaques measure from their claim's nearest authored anchor.
    const candidates = plaque.anchor ? [plaque.anchor]
      : [...new Set([...anchorsFor(plaque.owners || []), ...(plaque.refs || [])])].filter(id => nodes.has(id));
    const anchorId = candidates.map(id => ({ id, point: anchorPoint(nodes.get(id)) })).filter(entry => entry.point)
      .sort((a, b) => Math.hypot(a.point.x - centre.x, a.point.y - centre.y) - Math.hypot(b.point.x - centre.x, b.point.y - centre.y))[0]?.id;
    const id = unique(`plaque(${(plaque.owners || []).join('/')} ${text.slice(0, 48)})@${anchorId ?? ''}`);
    plaqueIds.set(plaque.uid, id);
    plaques.push({ id, text, rect, radius: (plaque.radiusPx ?? 0) / space.k, claims: plaque.owners || [],
      grid: /theta-grid/.test(plaque.cls || ''), joined: Boolean(plaque.joined), anchor: anchorPoint(nodes.get(anchorId)) });
    screen.set(id, [plaque.box]);
  }

  const indexRuns = new Map();
  for (const text of (snapshot.texts || []).filter(item => item.host && shown(item))) {
    if (!indexRuns.has(text.host)) indexRuns.set(text.host, []);
    indexRuns.get(text.host).push(text.box);
  }
  const texts = [];
  for (const text of (snapshot.texts || []).filter(shown)) {
    if (text.host || text.kind === 'plaque-text' || text.kind === 'other') continue;
    const isTree = TREE_TEXT.has(text.kind);
    if (isTree && !text.nodeId) continue;
    const kind = isTree ? (text.kind === 'category' ? 'category' : 'word') : text.kind === 'index' ? 'index' : 'role';
    const claims = isTree ? [] : text.owners || [];
    const id = unique(isTree ? `${text.nodeId}:${kind}` : `${kind}(${claims.join('/')} ${normalize(text.text)})@${(text.refs || [])[0] ?? ''}`);
    const boxes = [...(text.inkBoxes?.length ? text.inkBoxes : [text.box]), ...(indexRuns.get(text.uid) || [])].filter(Boolean);
    texts.push({ id, kind, text: normalize(text.text), boxes: boxes.map(space.rect), halo: (text.strokePx ?? 0) / 2 / space.k,
      nodes: isTree ? [text.nodeId] : [], claims, ...(text.lines?.length > 1 ? { lines: text.lines.map(line => line.text) } : {}) });
    screen.set(id, boxes);
  }

  const lines = [];
  for (const item of (snapshot.branches || []).filter(shown)) {
    const stem = item.kind === 'stem';
    if (stem ? !item.node : !(item.source && item.target)) continue;
    const id = unique(stem ? `${item.node}:stem` : `${item.source}->${item.target}`);
    lines.push({ id, kind: stem ? 'stem' : 'branch', paths: [item.points.map(space.point)], halfWidth: (item.strokePx ?? 0) / 2 / space.k,
      nodes: stem ? [item.node] : [item.source, item.target], claims: [] });
  }
  let previous = null;
  for (const item of (snapshot.connectors || []).filter(shown)) {
    const path = item.points.map(space.point);
    if (item.piece > 0 && previous) { previous.paths.push(path); continue; }
    const named = [...new Set(item.refs || [])];
    const id = unique(`connector(${(item.owners || []).join('/')})${named.join('→')}`);
    previous = { id, kind: 'connector', paths: [path], halfWidth: (item.strokePx ?? 0) / 2 / space.k,
      nodes: [...tree.descend([...named, ...anchorsFor(item.owners || [])])], claims: item.owners || [], masked: Boolean(item.masked) };
    lines.push(previous);
  }
  for (const line of lines) screen.set(line.id, line.paths.map(points => {
    const xs = points.map(p => p.x * space.k), ys = points.map(p => p.y * space.k);
    const origin = snapshot.origin || { x: 0, y: 0 };
    return { x: Math.min(...xs) + origin.x + snapshot.camera.x, y: Math.min(...ys) + origin.y + snapshot.camera.y,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }));

  const chrome = snapshot.canvas ? { canvas: space.rect(snapshot.canvas), panel: space.rect(snapshot.panel) ?? undefined,
    header: space.rect(snapshot.header) ?? undefined } : undefined;
  return { model: { frame, viewport, zoom: space.k, texts, plaques, lines, chrome }, screen };
}

/**
 * Index letters painted at each occurrence label, placed as the binding painters
 * place them: an inline coindex or written subscript in the label, or a letter
 * whose role and host attributes name its label. A letter with no placement
 * attributes is not counted (it cannot be attributed without guessing).
 */
export function letterObservations(snapshot) {
  const tree = hierarchy(snapshot);
  const labels = (snapshot.texts || []).filter(text => (text.kind === 'category' || text.kind === 'word') && text.nodeId && shown(text));
  const byNode = kind => new Map(labels.filter(text => text.kind === kind).map(text => [text.nodeId, text]));
  const categories = byNode('category'), words = byNode('word');
  const terminal = id => {
    if (!id) return null;
    if (words.has(id)) return words.get(id);
    const below = [...tree.descend([id])].filter(node => words.has(node));
    return below.length === 1 ? words.get(below[0]) : null;
  };
  const shell = id => (id && categories.get(id)) || terminal(id);
  const labelId = text => `${text.nodeId}:${text.kind}`;
  const shownLetters = new Map(), asserted = new Map(), boxes = new Map();
  const observe = (label, letter, box) => {
    if (!label || !letter) return;
    const key = labelId(label);
    showLetter(shownLetters, key, letter);
    asserted.set(key, (asserted.get(key) ?? new Set()).add(letter));
    boxes.set(key, [...(boxes.get(key) ?? [label.box]), box]);
  };
  for (const label of labels) {
    observe(label, extractDisplayedSubscriptIndex(label.text) ?? null, label.box);
    for (const run of (snapshot.texts || []).filter(text => text.host === label.uid && shown(text) && /babel-identity-index/.test(text.cls || ''))) {
      observe(label, normalize(run.text), run.box);
    }
  }
  const centreDistance = (a, b) => Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2);
  for (const glyph of (snapshot.texts || []).filter(text => text.kind === 'index' && !text.host && shown(text))) {
    const p = glyph.placement || {}, letter = normalize(glyph.text);
    let label = p.qrRole ? shell(p.qrRole === 'lf' ? p.lf : p.pronounced)
      : p.role === 'operator' ? shell(p.operator)
        : p.role ? (p.witness && terminal(p.witness)) || shell(p.variable)
          : p.coindex ? shell(p.coindex) : p.anchor ? shell(p.anchor) : null;
    // Before PR #75 a QR letter carried no role; it stands at one of its two named labels.
    if (!label && (p.lf || p.pronounced)) label = [shell(p.lf), shell(p.pronounced)].filter(Boolean)
      .sort((a, b) => centreDistance(a.box, glyph.box) - centreDistance(b.box, glyph.box))[0] ?? null;
    observe(label, letter, glyph.box);
  }
  return { shown: shownLetters, asserted, boxes };
}

export function letterFindings(snapshot, { record, frame, viewport }) {
  const { shown: shownLetters, asserted, boxes } = letterObservations(snapshot);
  return countLabelLetters(shownLetters, asserted).map(({ label, letter, count }) => ({
    rule: 'one-letter-per-label', subtype: count > 1 ? 'repeated' : 'missing', record, subject: `${label} ${letter}`,
    frame, viewport, measure: count, detail: `${label} shows ${letter} ${count} times`, boxes: boxes.get(label) ?? [] }));
}

/** A settled frame for the camera trace: stage, tree-space nodes with ancestors, and their bounds. */
export function cameraFrame(light, { final = false } = {}) {
  const tree = hierarchy(light), nodes = new Map();
  for (const node of light.nodes || []) {
    if (Number.isFinite(node.tx)) nodes.set(node.id, { x: node.tx, y: node.ty, ancestors: tree.ancestors(node.id) });
  }
  const points = [...nodes.values()];
  const bounds = points.length ? { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) } : null;
  return { stage: light.frame?.stage ?? null, final, bounds, nodes, movement: new Set(tree.descend(light.movement || [])) };
}

/** The usable view the camera fits into, from the painted header and panel (components/treeViewport.ts). */
export function cameraView(light) {
  const { canvas, origin = { x: 0, y: 0 } } = light;
  const width = canvas?.width ?? 0, height = canvas?.height ?? 0;
  return { canvas: { width, height }, view: availableTreeViewport(width, height, {
    headerBottom: light.header ? light.header.y + light.header.height - origin.y : 0,
    panelTop: light.panel ? light.panel.y - origin.y : undefined, right: 16 }) };
}
