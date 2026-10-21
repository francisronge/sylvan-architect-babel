// Shows what changed between two checkouts in the frames that
// tests/helpers/layoutSnapshot.mjs fingerprints: the same committed fixture
// analyses, laid out offline at the desktop viewport by each checkout's own
// code. For each changed frame it names the text, plaques, lines, camera Fit
// and panel text that differ.
//   node scripts/explainLayoutChange.mjs --baseline-root /path/to/main [--only TEXT]
//     [--frames 4-18,20] [--max-frames 6] [--max-items 12]
// The candidate is this checkout unless --candidate-root names another.
// Positions are tree units, as in the fingerprints.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { canonicalFrame, frameRanges, panelText, SNAPSHOT_VIEWPORT, tierLines } from '../tests/helpers/layoutSnapshot.mjs';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { values } = parseArgs({ options: {
  'baseline-root': { type: 'string' }, 'candidate-root': { type: 'string', default: here }, only: { type: 'string' },
  frames: { type: 'string' }, 'max-frames': { type: 'string', default: '6' }, 'max-items': { type: 'string', default: '12' }
} });
if (!values['baseline-root']) throw Error('Usage: node scripts/explainLayoutChange.mjs --baseline-root BASE [--candidate-root CANDIDATE] '
  + '[--only TEXT] [--frames 4-18,20] [--max-frames N] [--max-items N]');
const wanted = values.frames && new Set(values.frames.split(',').flatMap(part => {
  const [from, to = from] = part.split('-').map(Number);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}));
const maxFrames = Number(values['max-frames']), maxItems = Number(values['max-items']);

async function checkout(root) {
  const load = file => import(pathToFileURL(path.join(path.resolve(root), file)).href);
  const [frames, panel, formatting] = await Promise.all([load('tests/helpers/visualFrames.mjs'), load('replay/replayPanel.ts'),
    load('replay/replayPanelFormatting.ts')]);
  const viewport = frames.VIEWPORTS.find(({ name }) => name === SNAPSHOT_VIEWPORT);
  return record => {
    const visual = frames.prepareVisualRecord(record);
    return { frames: frames.layoutVisualFrames(visual, [viewport]), canopy: frames.layoutCanopyVisualFrame(visual, viewport),
      panels: panelText({ ...panel, ...formatting }, visual.prepared.playbackSteps, record.derivationStages),
      tiers: tierLines(visual.prepared.relationRenderPlan) };
  };
}

const r2 = value => Math.round(value * 100) / 100 + 0;
const same = (a, b) => JSON.stringify(a, (_, v) => typeof v === 'number' ? r2(v) : v) === JSON.stringify(b, (_, v) => typeof v === 'number' ? r2(v) : v);
const origin = item => item.rect ?? item.boxes?.[0] ?? item.paths?.[0]?.[0] ?? item.start ?? (Number.isFinite(item.x) ? item : undefined);
/** Items keyed by id; a repeated id gets its occurrence number, so duplicates still pair up. */
const keyed = items => {
  const seen = new Map();
  return new Map(items.map(item => {
    const n = (seen.get(item.id) ?? 0) + 1;
    seen.set(item.id, n);
    return [n > 1 ? `${item.id} #${n}` : item.id, item];
  }));
};
const move = (a, b) => {
  const p = origin(a), q = origin(b);
  return p && q ? { dx: r2(q.x - p.x), dy: r2(q.y - p.y) } : { dx: 0, dy: 0 };
};

/** Differences of one kind of item (texts, plaques or lines), matched by id. */
function itemChanges(kind, before, after) {
  const was = keyed(before), now = keyed(after);
  const lines = [];
  for (const [id, item] of now) {
    const old = was.get(id);
    if (!old) { lines.push(`+ ${kind} ${id}`); continue; }
    if (same(old, item)) continue;
    const { dx, dy } = move(old, item);
    lines.push(dx || dy ? `~ ${kind} ${id} moved ${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy}` : `~ ${kind} ${id} changed shape`);
  }
  for (const id of was.keys()) if (!now.has(id)) lines.push(`- ${kind} ${id}`);
  return lines;
}

function frameChanges(before, after, panels) {
  const lines = [];
  if (r2(before.zoom) !== r2(after.zoom)) lines.push(`~ camera Fit zoom ${r2(before.zoom)} → ${r2(after.zoom)}`);
  else if (!same(before.chrome, after.chrome)) {
    const { dx, dy } = move({ rect: before.chrome.canvas }, { rect: after.chrome.canvas });
    lines.push(`~ camera moved ${dx}, ${dy}`);
  }
  if (panels && JSON.stringify(panels[0]) !== JSON.stringify(panels[1])) lines.push(`~ panel text: ${JSON.stringify(panels[0]?.heading)} → ${JSON.stringify(panels[1]?.heading)}`);
  return [...lines, ...itemChanges('text', before.texts, after.texts), ...itemChanges('plaque', before.plaques, after.plaques),
    ...itemChanges('line', before.lines, after.lines), ...itemChanges('mark', before.marks ?? [], after.marks ?? [])];
}

const { loadFixtureAnalyses } = await import(pathToFileURL(path.join(path.resolve(values['candidate-root']), 'tests/helpers/replayInvariantCorpus.mjs')).href);
const baseline = await checkout(values['baseline-root']), candidate = await checkout(values['candidate-root']);
const records = loadFixtureAnalyses().records.filter(({ id }) => !values.only || id.includes(values.only));
let differing = 0;
for (const { id, record } of records) {
  const a = baseline(record), b = candidate(record), out = [];
  const changed = [];
  // Frames pair by their Replay frame number; a step without a painted frame has none.
  const byFrame = side => new Map(side.frames.map(item => [item.frame, item]));
  const was = byFrame(a), now = byFrame(b);
  for (const frame of [...new Set([...was.keys(), ...now.keys()])].sort((x, y) => x - y)) {
    const before = was.get(frame), after = now.get(frame), panels = [a.panels[frame - 1], b.panels[frame - 1]];
    if (wanted && !wanted.has(frame)) continue;
    if (!before || !after) { changed.push({ frame, lines: [before ? '- whole frame' : '+ whole frame'] }); continue; }
    if (canonicalFrame(before, panels[0]) === canonicalFrame(after, panels[1])) continue;
    changed.push({ frame, lines: frameChanges(before, after, panels) });
  }
  const canopy = a.canopy && b.canopy ? canonicalFrame(a.canopy) !== canonicalFrame(b.canopy) && frameChanges(a.canopy, b.canopy)
    : Boolean(a.canopy) !== Boolean(b.canopy) && ['Canopy added or removed'];
  const tiers = [...a.tiers.filter(line => !b.tiers.includes(line)).map(line => `- ${line}`),
    ...b.tiers.filter(line => !a.tiers.includes(line)).map(line => `+ ${line}`)];
  if (!changed.length && !canopy && !tiers.length) continue;
  differing++;
  out.push(`${id}`);
  if (changed.length) out.push(`  ${changed.length} frames differ: ${frameRanges(changed.map(({ frame }) => frame))}`);
  for (const { frame, lines } of changed.slice(0, maxFrames)) {
    out.push(`  frame ${frame}:`, ...lines.slice(0, maxItems).map(line => `    ${line}`));
    if (lines.length > maxItems) out.push(`    … ${lines.length - maxItems} more`);
  }
  if (changed.length > maxFrames) out.push(`  … ${changed.length - maxFrames} more frames (--frames, --max-frames)`);
  if (canopy) out.push('  Canopy:', ...canopy.slice(0, maxItems).map(line => `    ${line}`));
  if (tiers.length) out.push('  Tiers:', ...tiers.map(line => `    ${line}`));
  console.log(out.join('\n'));
}
console.log(`${differing} of ${records.length} analyses differ.`);
