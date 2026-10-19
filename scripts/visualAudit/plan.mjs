// What the visual audit will look at, decided before any browser opens.

/** Records embedded by the saved-analysis review pages. Combined pages store
 * { groups, records }; single-batch pages store the record array itself. */
export function extractPageRecords(html) {
  const match = /<script id="replay-records" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('The page has no embedded replay-records script; expected a saved-analysis review page.');
  const data = JSON.parse(match[1]);
  const records = Array.isArray(data) ? data : data.records;
  if (!Array.isArray(records)) throw new Error('replay-records holds no record array.');
  return { format: Array.isArray(data) ? 'batch' : 'combined', groups: Array.isArray(data) ? [] : data.groups || [], records };
}

export function parseViewports(spec = '1440x900,390x844') {
  return String(spec).split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const match = /^(\d+)x(\d+)$/i.exec(entry);
    if (!match) throw new Error(`Viewport "${entry}" must look like 1440x900.`);
    const width = Number(match[1]), height = Number(match[2]);
    if (width < 200 || height < 200) throw new Error(`Viewport ${entry} is too small.`);
    return { width, height, label: `${width}x${height}` };
  });
}

/** Resize sequence relative to the base viewport: scale factors ("1.33") or sizes ("1920x1200"). */
export function parseResizeSequence(spec, base) {
  if (!spec || spec === 'none') return [];
  return String(spec).split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const size = /^(\d+)x(\d+)$/i.exec(entry);
    if (size) return { width: Number(size[1]), height: Number(size[2]) };
    const factor = Number(entry);
    if (!(factor > 0)) throw new Error(`Resize step "${entry}" must be a factor or WxH.`);
    return { width: Math.max(320, Math.round(base.width * factor)), height: Math.max(320, Math.round(base.height * factor)) };
  }).map(size => ({ ...size, label: `${size.width}x${size.height}` }));
}

const FRAME_TERMS = /^(all|final|first|stage-entry|every:\d+|\d+(-\d+)?)$/;

/** Validates a frame spec: comma-separated all, final, first, stage-entry, every:N, N or A-B. */
export function parseFrameSpec(spec = 'all') {
  const terms = String(spec).split(',').map(term => term.trim()).filter(Boolean);
  if (!terms.length) throw new Error('Empty frame spec.');
  for (const term of terms) if (!FRAME_TERMS.test(term)) throw new Error(`Unknown frame term "${term}".`);
  return terms;
}

/** 1-based frames to audit statically, given the case's frame count and stage entries. */
export function resolveFrames(terms, frameCount, stageEntries = []) {
  const frames = new Set();
  for (const term of terms) {
    if (term === 'all') for (let frame = 1; frame <= frameCount; frame++) frames.add(frame);
    else if (term === 'final') frames.add(frameCount);
    else if (term === 'first') frames.add(1);
    else if (term === 'stage-entry') stageEntries.forEach(frame => frames.add(frame));
    else if (term.startsWith('every:')) {
      const every = Number(term.slice(6));
      for (let frame = 1; frame <= frameCount; frame += every) frames.add(frame);
      frames.add(frameCount);
    } else {
      const [from, to = from] = term.split('-').map(Number);
      for (let frame = Math.max(1, from); frame <= Math.min(frameCount, to); frame++) frames.add(frame);
    }
  }
  return [...frames].filter(frame => frame >= 1 && frame <= frameCount).sort((a, b) => a - b);
}

/** Frames Next must visit: numeric-only specs start one frame early so the
 * first audited frame is reached by stepping; anything else visits every frame. */
export function traversalRange(terms, frameCount, selected) {
  if (!selected.length) return { start: 1, end: 1 };
  const numeric = terms.every(term => /^\d+(-\d+)?$/.test(term));
  return numeric ? { start: Math.max(1, selected[0] - 1), end: selected.at(-1) } : { start: 1, end: Math.max(...selected) };
}

/** Frames that open a new authored stage, from "Stage s/S" labels in Replay order. */
export function stageEntryFrames(stages) {
  const entries = [];
  stages.forEach((stage, index) => {
    if (index > 0 && Number.isFinite(stage) && stage !== stages[index - 1]) entries.push(index + 1);
  });
  return entries;
}

const globToRegExp = glob => new RegExp(`^${glob.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/**
 * Cases from `--cases` (all, comma-separated ids or globs) and repeatable
 * `--case id@frames`. Returns [{ id, frames }] in page order, frames null for the default.
 */
export function selectCases(records, { cases, caseSpecs = [] } = {}) {
  const ids = records.map(record => record.id), known = new Set(ids), chosen = new Map(), unknown = [];
  const add = (id, frames = null) => chosen.set(id, frames ?? chosen.get(id) ?? null);
  for (const term of String(cases || '').split(',').map(value => value.trim()).filter(Boolean)) {
    if (term === 'all') ids.forEach(id => add(id));
    else if (term.includes('*')) {
      const pattern = globToRegExp(term), matches = ids.filter(id => pattern.test(id));
      if (!matches.length) unknown.push(term);
      matches.forEach(id => add(id));
    } else if (known.has(term)) add(term);
    else unknown.push(term);
  }
  for (const spec of caseSpecs) {
    const at = spec.lastIndexOf('@');
    const id = at > 0 ? spec.slice(0, at) : spec, frames = at > 0 ? spec.slice(at + 1) : null;
    if (!known.has(id)) { unknown.push(id); continue; }
    if (frames) parseFrameSpec(frames);
    add(id, frames);
  }
  if (unknown.length) throw new Error(`Unknown saved analyses: ${unknown.join(', ')}`);
  return ids.filter(id => chosen.has(id)).map(id => ({ id, frames: chosen.get(id) }));
}

export function parseShard(spec) {
  if (!spec) return null;
  const match = /^(\d+)\/(\d+)$/.exec(spec);
  if (!match) throw new Error('--shard must look like 2/5.');
  const index = Number(match[1]), count = Number(match[2]);
  if (index < 1 || index > count) throw new Error('--shard index must be between 1 and the shard count.');
  return { index, count };
}

/** Interleaved shards keep batches balanced across groups. */
export const applyShard = (cases, shard) => shard ? cases.filter((_, position) => position % shard.count === shard.index - 1) : cases;

/** Seeded random subset, returned in page order. */
export function sampleCases(cases, count, seed = 1) {
  if (!count || count >= cases.length) return cases;
  let state = (Number(seed) >>> 0) || 1;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const order = cases.map((item, position) => ({ item, position, key: random() })).sort((a, b) => a.key - b.key);
  return order.slice(0, count).sort((a, b) => a.position - b.position).map(entry => entry.item);
}

/** Seconds per unit of work, from the shape of the review page's real waits
 * (360 ms camera moves, 260–280 ms opacity transitions, measured layout). Replace
 * them with `report.timings` from a real run. */
export const DEFAULT_COSTS = Object.freeze({
  pageLoad: 6, caseSwitch: 1.5, step: 0.8, fastStep: 0.3, collect: 0.15, directCheck: 0.9,
  rapidRun: 2.5, resizeTransition: 1.8, canopy: 2, sheet: 1.5, flaggedShare: 0.05
});

/**
 * Wall-clock estimate in seconds for one process. `cases` carry `traversed`,
 * `audited`, `direct` and `rapid` counts per viewport.
 */
export function estimateRuntime({ cases, viewports, fast = false, resizeTransitions = 4, canopy = true, costs = {} }) {
  const c = { ...DEFAULT_COSTS, ...costs };
  const perViewport = cases.reduce((total, item) => total + c.caseSwitch
    + item.traversed * (fast ? c.fastStep : c.step) + item.audited * c.collect
    + (item.direct || 0) * c.directCheck + (fast ? 0 : (item.rapid || 0) * c.rapidRun + resizeTransitions * c.resizeTransition)
    + (canopy ? c.canopy : 0) + item.audited * c.flaggedShare * c.sheet, c.pageLoad);
  return { seconds: Math.round(perViewport * viewports), perViewportSeconds: Math.round(perViewport), costs: c };
}

export const formatDuration = seconds => {
  const hours = Math.floor(seconds / 3600), minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};
