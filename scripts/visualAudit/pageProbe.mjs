// The browser half of the visual audit. `probeScript()` returns source for
// `page.addInitScript`; it defines `window.__babelAudit` and changes nothing
// until called. The pure helpers below are serialized into that script, so
// they must not reference module scope; tests import them directly.

/** Classifies a painted SVG text or tspan from its classes and context. */
export function classifyText({ tag, classes = [], inNodeGroup = false, inPlaque = false, owned = false, inRelationLayer = false }) {
  if (tag !== 'text' && tag !== 'tspan') return 'ignore';
  const indexClasses = ['babel-relation-index', 'vr-index-badge', 'babel-identity-index', 'babel-theta-terminal-index'];
  if (classes.some(name => indexClasses.includes(name))) return inPlaque ? 'plaque-text' : 'index';
  if (tag === 'tspan') return 'ignore';
  if (classes.includes('category-label')) return 'category';
  if (classes.includes('terminal-label')) return 'word';
  if (inPlaque) return 'plaque-text';
  if (inNodeGroup) return 'node-text';
  if (owned || inRelationLayer) return 'relation-label';
  return 'other';
}

/** Classifies painted geometry: tree branch, plaque shell, relation connector, or ignore. */
export function classifyGraphic({ tag, classes = [], inNodeGroup = false, owned = false, inRelationLayer = false }) {
  const all = classes.join(' ');
  if (tag === 'path' && classes.includes('branch')) return { type: 'branch' };
  const shells = ['babel-feature-plaque-shell', 'babel-pf-plate-shell', 'vr-plaque', 'babel-theta-grid-shell',
    'babel-cooper-storage-plaque', 'babel-pf-correspondence-shell', 'babel-fission-bundle-shell',
    'babel-pf-morphology-shell', 'babel-argument-sharing-object-box'];
  if (classes.some(name => shells.includes(name)) && ['rect', 'g', 'path'].includes(tag)) return { type: 'plaque' };
  if (inNodeGroup) return tag === 'line' ? { type: 'stem' } : { type: 'ignore' };
  if (!['path', 'line', 'polyline'].includes(tag)) return { type: 'ignore' };
  // Attachment decorations, regions and plaque furniture are not connectors.
  if (/shadow|hit-target|hit-area|arrowhead|(^|[\s-])tip($|[\s-])|-cap($|\s)|endpoint|origin|domain|enclosure|region|bracket|underline|strike|ring|mask|clearance|extent|outline|marker|-rule($|\s)|-x($|\s)/.test(all)) {
    return { type: 'ignore' };
  }
  if (classes.includes('movement-arrow') || /trajectory|lf-path/.test(all)) return { type: 'connector', kind: 'trajectory' };
  if (!owned && !inRelationLayer) return { type: 'ignore' };
  if (/fallback/.test(all)) return { type: 'connector', kind: 'fallback' };
  if (/rail|stub/.test(all)) return { type: 'connector', kind: 'rail' };
  return { type: 'connector', kind: 'relation' };
}

/** Data attributes whose values name the syntax nodes a mark belongs to. */
export function isNodeRefAttribute(name) {
  if (/^data-(vr-(stage-index|relation-index|owner-refs|emphasis|failed|terminal-ambiguity|x|y|lane)|plaque-domain|step)$/.test(name)) return false;
  return /^data-.*(anchor|node|node-id|nodes|trajectory-from|trajectory-to|controller|controllee|predicand|predicate|pronounced|-lf|witness|target|targets|source|antecedent|dependent|-gap|chunk|variable|operator|domain|reuses)$/.test(name);
}

/** Splits an attribute value into ids: a JSON array, else whitespace-separated. */
export function splitRefs(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const flat = [];
      const walk = item => Array.isArray(item) ? item.forEach(walk) : (typeof item === 'string' && item && flat.push(item));
      walk(JSON.parse(text));
      return flat;
    } catch { /* fall through to whitespace splitting */ }
  }
  return text.split(/\s+/).filter(Boolean);
}

/** Reads "Replay Frame 21/68 · Stage 2/5 · Step 1/4" from the Replay header. */
export function parseStageLabel(text) {
  const value = String(text || '');
  const frame = /Replay Frame\s+(\d+)\s*\/\s*(\d+)/i.exec(value);
  const stage = /Stage\s+(\d+)\s*\/\s*(\d+)\s*·\s*Step\s+(\d+)\s*\/\s*(\d+)/i.exec(value);
  if (!frame && !stage) return null;
  return { frame: frame ? Number(frame[1]) : null, frameCount: frame ? Number(frame[2]) : null,
    stage: stage ? Number(stage[1]) : null, stageCount: stage ? Number(stage[2]) : null,
    step: stage ? Number(stage[3]) : null, stepCount: stage ? Number(stage[4]) : null };
}

export function parseCamera(value) {
  if (!value) return null;
  const translate = /translate\(\s*(-?[\d.e+-]+)[\s,]+(-?[\d.e+-]+)\s*\)/i.exec(value);
  const scale = /scale\(\s*(-?[\d.e+-]+)/i.exec(value);
  const camera = { x: translate ? Number(translate[1]) : 0, y: translate ? Number(translate[2]) : 0, k: scale ? Number(scale[1]) : 1 };
  return Object.values(camera).every(Number.isFinite) ? camera : null;
}

/** Alpha of a computed CSS colour ("rgba(3, 19, 14, 0.9)", "rgb(3 19 14 / 90%)"). */
export function colorAlpha(color) {
  const match = /rgba?\(([^)]*)\)/i.exec(String(color || ''));
  if (!match) return 0;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return 1;
  const alpha = parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
}

/** Splits sampled path points where the path jumps to a new subpath. */
export function splitSubpaths(points, maxStep) {
  const pieces = [];
  let piece = [];
  for (const point of points) {
    const last = piece.at(-1);
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) > maxStep) {
      if (piece.length) pieces.push(piece);
      piece = [];
    }
    piece.push(point);
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

export function installAuditProbe(helpers) {
  if (window.__babelAudit) return;
  const { classifyText, classifyGraphic, isNodeRefAttribute, splitRefs, parseStageLabel, parseCamera, colorAlpha, splitSubpaths } = helpers;
  const TREE = 'svg[data-babel-tree]';
  const HIDDEN_CONTAINERS = 'defs,marker,mask,clipPath,pattern,symbol';
  const round = (value, digits = 2) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
  const rect = box => box ? { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) } : null;
  const viewport = () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  const clip = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
  };
  const classesOf = element => (element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  const tagOf = element => element.tagName.toLowerCase();

  function opacityMeter() {
    const cache = new Map();
    const chain = element => {
      if (!element || element.nodeType !== 1) return 1;
      if (cache.has(element)) return cache.get(element);
      const style = getComputedStyle(element);
      let value = style.display === 'none' ? 0 : Number(style.opacity);
      if (!Number.isFinite(value)) value = 1;
      value *= chain(element.parentElement);
      cache.set(element, value);
      return value;
    };
    return element => {
      const visibility = getComputedStyle(element).visibility;
      return visibility === 'hidden' || visibility === 'collapse' ? 0 : chain(element);
    };
  }

  function describe(element, svg) {
    let inNodeGroup = false, inRelationLayer = false;
    for (let ancestor = element.parentElement; ancestor && ancestor !== svg; ancestor = ancestor.parentElement) {
      const list = classesOf(ancestor);
      if (list.includes('node-group')) inNodeGroup = true;
      if (list.some(name => name === 'vr-item' || name === 'vr-overlay-layer' || name.endsWith('relation-layer'))) inRelationLayer = true;
    }
    return { tag: tagOf(element), classes: classesOf(element), inNodeGroup, inRelationLayer,
      owned: Boolean(element.closest('[data-vr-owner-refs]')), inPlaque: false };
  }

  const ownersOf = element => splitRefs(element.closest('[data-vr-owner-refs]')?.getAttribute('data-vr-owner-refs'));

  function refsReader(svg, nodeIds) {
    const cache = new Map();
    const own = element => {
      if (!element || element === svg || element.nodeType !== 1) return [];
      if (cache.has(element)) return cache.get(element);
      const ids = [...own(element.parentElement)];
      for (const attribute of element.attributes) {
        if (isNodeRefAttribute(attribute.name)) ids.push(...splitRefs(attribute.value).filter(id => nodeIds.has(id)));
      }
      const unique = [...new Set(ids)];
      cache.set(element, unique);
      return unique;
    };
    return own;
  }

  function coverOf(svg, opacity) {
    const host = svg.parentElement, box = svg.getBoundingClientRect(), total = box.width * box.height;
    if (!host || !total) return 0;
    let cover = 0;
    for (const element of host.children) {
      if (element === svg || element.matches('style,script,[data-babel-replay-panel],[data-babel-replay-header]')) continue;
      const shared = clip(element.getBoundingClientRect(), box);
      if (shared.width * shared.height < 0.5 * total) continue;
      cover = Math.max(cover, colorAlpha(getComputedStyle(element).backgroundColor) * opacity(element));
    }
    return cover;
  }

  function frameInfo() {
    const header = document.querySelector('[data-babel-replay-header]');
    const panel = document.querySelector('[data-babel-replay-panel]');
    const slider = document.querySelector('input[aria-label="Replay frame"]');
    const svg = document.querySelector(TREE);
    const label = parseStageLabel(header?.textContent || '') || {};
    const active = panel?.getAttribute('data-babel-active-relation-index');
    return { ...label, frame: label.frame ?? (slider ? Number(slider.value) + 1 : null),
      frameCount: slider ? Number(slider.max) + 1 : label.frameCount ?? null,
      kind: panel?.getAttribute('data-babel-replay-kind') || null, view: panel ? 'Replay' : 'Canopy',
      rendered: svg?.getAttribute('data-babel-rendered-step') ?? null,
      settled: svg?.getAttribute('data-babel-camera-settled-step') ?? null,
      activeRelation: active !== null && active !== undefined ? {
        stageIndex: Number(panel.getAttribute('data-babel-active-relation-stage-index')), relationIndex: Number(active) } : null };
  }

  function nodeRecords(svg, opacity) {
    return [...svg.querySelectorAll('g.node-group')].map(group => {
      const translate = /translate\(\s*(-?[\d.e+-]+)[\s,]+(-?[\d.e+-]+)/i.exec(group.getAttribute('transform') || '');
      const matrix = group.getScreenCTM();
      return { id: group.getAttribute('data-node-group-id'), tx: translate ? Number(translate[1]) : null,
        ty: translate ? Number(translate[2]) : null, x: matrix ? round(matrix.e) : null, y: matrix ? round(matrix.f) : null,
        leaf: Boolean(group.querySelector(':scope > text.terminal-label')), opacity: round(opacity(group), 3) };
    });
  }

  /** Text without nested index glyphs, which are recorded on their own. */
  function ownText(element) {
    let value = '';
    for (const child of element.childNodes) {
      if (child.nodeType === 3) value += child.textContent;
      else if (child.nodeType === 1 && classifyText({ tag: tagOf(child), classes: classesOf(child) }) !== 'index') value += ownText(child);
    }
    return value;
  }

  function samplePoints(element) {
    const matrix = element.getScreenCTM();
    const length = element.getTotalLength();
    if (!matrix || !Number.isFinite(length) || length <= 0) return [];
    const scale = Math.hypot(matrix.a, matrix.b) || 1;
    const steps = Math.max(1, Math.min(240, Math.ceil(length * scale / 6)));
    const points = [];
    for (let index = 0; index <= steps; index++) {
      const point = element.getPointAtLength(length * index / steps);
      points.push([round(matrix.a * point.x + matrix.c * point.y + matrix.e, 1), round(matrix.b * point.x + matrix.d * point.y + matrix.f, 1)]);
    }
    return splitSubpaths(points, (length * scale / steps) * 1.5 + 2);
  }

  function strokeOf(element) {
    const style = getComputedStyle(element);
    if (style.stroke === 'none' || Number(style.strokeOpacity) === 0) return 0;
    const width = parseFloat(style.strokeWidth) || 0;
    const matrix = element.getScreenCTM();
    return style.vectorEffect === 'non-scaling-stroke' || !matrix ? width : width * Math.hypot(matrix.a, matrix.b);
  }

  function collect({ light = false } = {}) {
    const svg = document.querySelector(TREE);
    if (!svg) return { error: 'no painted Babel tree', frame: frameInfo(), viewport: viewport() };
    const errors = [], opacity = opacityMeter();
    const root = svg.querySelector(':scope > g');
    const canvas = rect(clip(svg.getBoundingClientRect(), viewport()));
    const nodes = nodeRecords(svg, opacity);
    const svgBox = svg.getBoundingClientRect();
    const visibleRect = selector => {
      const element = document.querySelector(selector);
      return element && opacity(element) > 0.05 && element.getClientRects().length ? rect(element.getBoundingClientRect()) : null;
    };
    const base = { viewport: viewport(), canvas, origin: { x: round(svgBox.x), y: round(svgBox.y) },
      camera: parseCamera(root?.getAttribute('transform')), frame: frameInfo(),
      panel: visibleRect('[data-babel-replay-panel]'), header: visibleRect('[data-babel-replay-header]') };
    const nodeIds = new Set(nodes.map(node => node.id));
    const refsOf = refsReader(svg, nodeIds);
    const edges = [...svg.querySelectorAll('path.branch')].map(path => ({
      source: path.getAttribute('data-source-node-id'), target: path.getAttribute('data-target-node-id') }));
    if (light) {
      // Nodes a painted movement names this frame: the trajectory endpoints.
      const movement = new Set();
      for (const element of svg.querySelectorAll('path,line,polyline')) {
        if (element.closest(HIDDEN_CONTAINERS)) continue;
        const kind = classifyGraphic(describe(element, svg));
        if (kind.type === 'connector' && kind.kind === 'trajectory' && opacity(element) >= 0.05) refsOf(element).forEach(id => movement.add(id));
      }
      return { ...base, light: true, nodes: nodes.filter(node => node.opacity >= 0.05), edges, movement: [...movement] };
    }
    const plaques = [], containers = [];
    for (const element of svg.querySelectorAll('rect,path,polygon,g.babel-cooper-storage-plaque')) {
      try {
        if (element.closest(HIDDEN_CONTAINERS) || classifyGraphic(describe(element, svg)).type !== 'plaque') continue;
        const value = opacity(element), box = element.getBoundingClientRect();
        if (value < 0.01 || !(box.width > 0 && box.height > 0)) continue;
        const anchor = element.closest('[data-feature-anchor]')?.getAttribute('data-feature-anchor');
        // The painter's plaque group holds the shell and its text: a Case plaque keeps its
        // shell and title in .babel-feature-plaque-frame and each row in a sibling .babel-feature-row.
        const container = tagOf(element) === 'g' ? element
          : element.closest('.babel-theta-grid-plate,.babel-feature-plaque,.babel-dependent-case-state-plaque') || element.parentElement;
        const matrix = element.getScreenCTM();
        const record = { uid: `p${plaques.length}`, cls: classesOf(element).join(' '), owners: ownersOf(element),
          refs: refsOf(element), anchor: nodeIds.has(anchor) ? anchor : null,
          location: element.closest('[data-plaque-location]')?.getAttribute('data-plaque-location') || null,
          box: rect(box), opacity: round(value, 3),
          radiusPx: round((Number(element.getAttribute('rx')) || 0) * (matrix ? Math.hypot(matrix.a, matrix.b) : 1)),
          // A Case route or a feature collector ties the plaque to syntax.
          joined: Boolean(element.closest('.babel-case-feature-plaque')
            || container.querySelector('[data-collection-plaque],[data-case-outcome]')) };
        plaques.push(record);
        containers.push({ container, record, box });
      } catch (error) { errors.push(`plaque: ${error}`); }
    }
    const plaqueOf = (element, box) => {
      for (const { container, record, box: shell } of containers) {
        if (!container.contains(element)) continue;
        const shared = clip(box, { x: shell.x - 2, y: shell.y - 2, width: shell.width + 4, height: shell.height + 4 });
        if (shared.width * shared.height >= 0.8 * Math.max(box.width * box.height, 1e-6)) return record.uid;
      }
      return null;
    };

    const texts = [];
    const context = document.createElement('canvas').getContext('2d');
    /** Glyph boxes per painted line: the line's advance horizontally, its ink
     * (canvas metrics of the computed font at the baseline) vertically. */
    const inkOf = (element, parts) => {
      try {
        const style = getComputedStyle(element), matrix = element.getScreenCTM();
        if (!context || !matrix) return [];
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const scale = Math.hypot(matrix.c, matrix.d) || 1, boxes = [];
        for (const part of parts) {
          const content = ownText(part);
          if (!content.trim() || !part.getNumberOfChars?.()) continue;
          const metrics = context.measureText(content), start = part.getStartPositionOfChar(0), cell = part.getBoundingClientRect();
          const baseline = matrix.b * start.x + matrix.d * start.y + matrix.f;
          const top = baseline - metrics.actualBoundingBoxAscent * scale, low = baseline + metrics.actualBoundingBoxDescent * scale;
          if (low > top && cell.width > 0) boxes.push(rect({ x: cell.x, y: top, width: cell.width, height: low - top }));
        }
        return boxes;
      } catch { return []; }
    };
    const strokeOfText = element => {
      const style = getComputedStyle(element), matrix = element.getScreenCTM();
      if (style.stroke === 'none' || !String(style.paintOrder || '').startsWith('stroke')) return 0;
      return round((parseFloat(style.strokeWidth) || 0) * (matrix ? Math.hypot(matrix.c, matrix.d) : 1));
    };
    /** Where a separately painted index letter is placed, from the attributes the
     * binding painters write (the lookups #75's letter count uses). */
    const letterPlacement = element => {
      const host = element.closest('[data-operator-variable-operator],[data-qr-lf],[data-qr-pronounced]');
      const read = (node, name) => node?.getAttribute(name) || null;
      return { qrRole: read(element, 'data-qr-index-role'), role: read(element, 'data-operator-variable-index-role'),
        coindex: read(element, 'data-coindex-anchor'),
        anchor: read(element, 'data-control-anchor') || read(element, 'data-binding-anchor')
          || read(element, 'data-coreference-anchor') || read(element, 'data-index-anchor'),
        operator: read(host, 'data-operator-variable-operator'), variable: read(host, 'data-operator-variable-variable'),
        witness: read(host, 'data-operator-variable-witness'), lf: read(host, 'data-qr-lf'), pronounced: read(host, 'data-qr-pronounced') };
    };
    for (const element of svg.querySelectorAll('text')) {
      try {
        if (element.closest(HIDDEN_CONTAINERS)) continue;
        const value = opacity(element), box = element.getBoundingClientRect();
        if (value < 0.01 || !(box.width > 0 && box.height > 0)) continue;
        const descriptor = describe(element, svg);
        descriptor.inPlaque = Boolean(plaqueOf(element, box));
        const kind = classifyText(descriptor);
        if (kind === 'ignore') continue;
        const lineSpans = [...element.children].filter(child => tagOf(child) === 'tspan' && child.hasAttribute('y'));
        const nodeId = element.getAttribute('data-category-node-id') || element.getAttribute('data-node-id')
          || element.closest('.node-group')?.getAttribute('data-node-group-id') || null;
        const record = { uid: `t${texts.length}`, kind, cls: descriptor.classes.join(' '),
          text: lineSpans.length ? lineSpans.map(ownText).join(' ') : ownText(element), nodeId,
          owners: ownersOf(element), refs: refsOf(element), box: rect(box),
          inkBoxes: inkOf(element, lineSpans.length ? lineSpans : [element]), strokePx: strokeOfText(element),
          placement: kind === 'index' ? letterPlacement(element) : undefined,
          lines: lineSpans.length > 1 ? lineSpans.map(span => ({ text: ownText(span), box: rect(span.getBoundingClientRect()) })) : [],
          opacity: round(value, 3), plaque: plaqueOf(element, box), host: null,
          fontPx: round(parseFloat(getComputedStyle(element).fontSize) * Math.hypot(element.getScreenCTM()?.c || 0, element.getScreenCTM()?.d || 0), 1) };
        texts.push(record);
        if (kind !== 'category' && kind !== 'word') continue;
        for (const span of element.querySelectorAll('tspan')) {
          if (classifyText({ tag: 'tspan', classes: classesOf(span) }) !== 'index') continue;
          const spanBox = span.getBoundingClientRect(), spanOpacity = opacity(span);
          if (spanOpacity < 0.01 || !(spanBox.width > 0 && spanBox.height > 0)) continue;
          texts.push({ uid: `t${texts.length}`, kind: 'index', cls: classesOf(span).join(' '), text: span.textContent,
            nodeId, owners: ownersOf(span), refs: refsOf(span), box: rect(spanBox), inkBoxes: [], strokePx: 0, lines: [],
            opacity: round(spanOpacity, 3), plaque: null, host: record.uid,
            fontPx: round(parseFloat(getComputedStyle(span).fontSize) * Math.hypot(span.getScreenCTM()?.c || 0, span.getScreenCTM()?.d || 0), 1) });
        }
      } catch (error) { errors.push(`text: ${error}`); }
    }

    const connectors = [], branches = [];
    for (const element of svg.querySelectorAll('path,line,polyline')) {
      try {
        if (element.closest(HIDDEN_CONTAINERS)) continue;
        const kind = classifyGraphic(describe(element, svg));
        if (kind.type !== 'branch' && kind.type !== 'connector' && kind.type !== 'stem') continue;
        const value = opacity(element), strokePx = strokeOf(element);
        if (value < 0.01 || strokePx <= 0) continue;
        const box = element.getBoundingClientRect();
        if (kind.type === 'connector' && plaqueOf(element, box)) continue;
        const pieces = samplePoints(element);
        if (kind.type === 'stem') {
          branches.push({ uid: `s${branches.length}`, kind: 'stem', node: element.closest('.node-group')?.getAttribute('data-node-group-id') || null,
            points: pieces.flat(), strokePx: round(strokePx), opacity: round(value, 3) });
          continue;
        }
        if (kind.type === 'branch') {
          branches.push({ uid: `b${branches.length}`, kind: 'branch', source: element.getAttribute('data-source-node-id'),
            target: element.getAttribute('data-target-node-id'), points: pieces.flat(), strokePx: round(strokePx), opacity: round(value, 3) });
          continue;
        }
        const shared = { cls: classesOf(element).join(' '), kind: kind.kind, owners: ownersOf(element), refs: refsOf(element),
          strokePx: round(strokePx), opacity: round(value, 3), masked: Boolean(element.closest('[mask]')) };
        pieces.forEach((points, piece) => connectors.push({ uid: `c${connectors.length}`, piece, ...shared, points }));
      } catch (error) { errors.push(`path: ${error}`); }
    }
    return { ...base, nodes, edges, texts, plaques, connectors, branches, errors };
  }

  const sampler = { running: false, frames: [], clicks: [], probe: null, observer: null, raf: 0, max: 2400 };
  const generations = new WeakMap();
  let generation = 0;
  /** Each redraw replaces the tree group; a new generation marks a step's first painted pose. */
  const generationOf = root => {
    if (!root) return 0;
    if (!generations.has(root)) generations.set(root, ++generation);
    return generations.get(root);
  };
  function sampleFrame() {
    const t = performance.now(), svg = document.querySelector(TREE);
    if (!svg) return { t, tree: false, nodes: [], marks: [], visibility: 0, cover: 0, canvas: rect(viewport()) };
    const opacity = opacityMeter(), root = svg.querySelector(':scope > g');
    const parents = new Map();
    for (const branch of svg.querySelectorAll('path.branch')) parents.set(branch.getAttribute('data-target-node-id'), branch.getAttribute('data-source-node-id'));
    const nodes = [];
    for (const group of svg.querySelectorAll('g.node-group')) {
      const value = opacity(group);
      if (value < 0.01) continue;
      const box = group.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      const id = group.getAttribute('data-node-group-id');
      nodes.push([id, round(box.x + box.width / 2, 1), round(box.y + box.height / 2, 1), round(value, 3), parents.get(id) ?? null]);
    }
    const marks = new Map();
    for (const element of svg.querySelectorAll('[data-vr-owner-refs]')) {
      if (element.parentElement?.closest('[data-vr-owner-refs]')) continue;
      const value = opacity(element);
      if (value < 0.01) continue;
      const box = element.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      // Emphasis toggles vr-relation-* classes at relation moments; they never name a mark.
      const kind = classesOf(element).find(name => name !== 'vr-item' && !name.startsWith('vr-relation-')) || tagOf(element);
      const key = `${element.getAttribute('data-vr-owner-refs')}|${kind}`;
      marks.set(key, Math.max(marks.get(key) || 0, round(value, 3)));
    }
    return { t: round(t, 1), gen: generationOf(root), rendered: svg.getAttribute('data-babel-rendered-step'), settled: svg.getAttribute('data-babel-camera-settled-step'),
      transform: parseCamera(root?.getAttribute('transform')), visibility: round(root ? opacity(root) : 0, 3),
      cover: round(coverOf(svg, opacity), 3), canvas: rect(clip(svg.getBoundingClientRect(), viewport())), nodes, marks: [...marks] };
  }
  function stopSampler() {
    sampler.running = false;
    cancelAnimationFrame(sampler.raf);
    sampler.observer?.disconnect();
    sampler.probe?.remove();
    sampler.observer = sampler.probe = null;
    return { frames: sampler.frames, clicks: sampler.clicks };
  }
  /** Samples every rendering update. A 1px probe resized in each animation frame
   * makes ResizeObserver report after all frame callbacks and layout, before paint. */
  function startSampler({ max = 2400 } = {}) {
    stopSampler();
    Object.assign(sampler, { running: true, frames: [], clicks: [], max });
    const probe = document.createElement('div');
    probe.setAttribute('data-babel-audit-probe', '');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict';
    document.documentElement.appendChild(probe);
    sampler.probe = probe;
    let wide = false;
    sampler.observer = new ResizeObserver(() => {
      if (!sampler.running) return;
      try { sampler.frames.push(sampleFrame()); }
      catch (error) { sampler.frames.push({ t: performance.now(), error: String(error), nodes: [], marks: [] }); }
      if (sampler.frames.length >= sampler.max) stopSampler();
    });
    sampler.observer.observe(probe);
    const tick = () => {
      if (!sampler.running) return;
      wide = !wide;
      probe.style.width = wide ? '2px' : '1px';
      sampler.raf = requestAnimationFrame(tick);
    };
    sampler.raf = requestAnimationFrame(tick);
    return new Promise(resolve => {
      const ready = () => sampler.frames.length || !sampler.running ? resolve(sampler.frames.length) : requestAnimationFrame(ready);
      ready();
    });
  }

  const panelButton = name => [...document.querySelectorAll('[data-babel-replay-panel] button')]
    .find(button => button.textContent.trim() === name);
  function clickNext() {
    const button = panelButton('Next');
    if (!button || button.disabled) return false;
    button.click();
    if (sampler.running) sampler.clicks.push(round(performance.now(), 1));
    return true;
  }
  async function rapidNext(intervals = []) {
    let clicks = clickNext() ? 1 : 0;
    for (const delay of intervals) {
      if (!clicks) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      if (!clickNext()) break;
      clicks++;
    }
    return clicks;
  }
  function jumpTo(index) {
    const slider = document.querySelector('input[aria-label="Replay frame"]');
    if (!slider) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(index));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function showOverlay(items) {
    clearOverlay();
    const layer = document.createElement('div');
    layer.id = 'babel-audit-overlay';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    for (const { box, color, label } of items) {
      const outline = document.createElement('div');
      outline.style.cssText = `position:absolute;left:${box.x - 3}px;top:${box.y - 3}px;width:${box.width + 6}px;height:${box.height + 6}px;`
        + `outline:2px solid ${color};border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.85)`;
      if (label) {
        const tag = document.createElement('span');
        tag.textContent = label;
        tag.style.cssText = `position:absolute;left:-2px;top:-17px;font:700 11px/14px system-ui,sans-serif;color:#000;background:${color};padding:0 4px;border-radius:3px;white-space:nowrap`;
        outline.appendChild(tag);
      }
      layer.appendChild(outline);
    }
    document.documentElement.appendChild(layer);
  }
  function clearOverlay() { document.getElementById('babel-audit-overlay')?.remove(); }

  window.__babelAudit = { collect, frameInfo, startSampler, stopSampler, sampleCount: () => sampler.frames.length,
    lastSample: () => sampler.frames.at(-1) || null, clickNext, rapidNext, jumpTo, showOverlay, clearOverlay };
}

export const probeScript = () => `(${installAuditProbe.toString()})({ ${[classifyText, classifyGraphic, isNodeRefAttribute,
  splitRefs, parseStageLabel, parseCamera, colorAlpha, splitSubpaths].map(fn => `${fn.name}: ${fn.toString()}`).join(',\n')} });`;
