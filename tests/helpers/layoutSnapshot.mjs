/** "Nothing changed" fingerprints of what Replay shows for one analysis.
 *
 * Each painted Replay frame at the desktop viewport, laid out offline by
 * visualFrames.mjs (measured fonts, plaques, role labels, connectors, every
 * other bound relation mark and the camera Fit), and its Replay panel text
 * become one short digest, as does the
 * Canopy. `tiers` lists every relation plan item with the tier its claim won.
 * Positions are rounded to 0.01 tree units and every list is sorted by its
 * ids, so arithmetic noise and painting order do not count as a change.
 *
 * `npm run verify:visual-offline` compares the committed fixtures against
 * fixtures/replay-snapshots/fixture-layout.json and names the analyses and
 * frames that differ; `scripts/explainLayoutChange.mjs` shows what moved
 * against another checkout. A changed digest is a behavior change: review it,
 * never regenerate it blind. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const SNAPSHOT_VIEWPORT = 'desktop';

// Round to a millionth first, so a value one floating-point step from a
// hundredth boundary rounds the same way on both sides.
const round = (_key, value) => typeof value === 'number' ? Math.round(Math.round(value * 1e6) / 1e4) / 100 + 0 : value;
const byId = list => [...list].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const digest = text => createHash('sha256').update(text).digest('base64url').slice(0, 8);

/** What the Replay panel shows for step `index`, as ReplayPanel builds it. */
export function panelText({ buildReplayPanelContent, buildReplayDisplayDetailBlocks }, steps, derivationStages) {
  const blocks = buildReplayDisplayDetailBlocks(steps);
  return steps.map((step, index) => {
    const content = buildReplayPanelContent(step, derivationStages);
    return { kind: step.replayKind, stage: step.replayFrameIndex, heading: content.heading, note: step.note ?? '',
      lines: content.supportLines.map(line => [line.label, line.value, line.literal]),
      blocks: (blocks.get(index) ?? []).map(block => [block.title, block.lines]) };
  });
}

/** One normalized frame (visualRules' model) and its panel, in a stable form. */
export function canonicalFrame(frame, panel = null) {
  return JSON.stringify({ zoom: frame.zoom, chrome: frame.chrome, texts: byId(frame.texts), plaques: byId(frame.plaques),
    lines: byId(frame.lines), marks: byId(frame.marks ?? []), panel }, round);
}

/** Every plan item: `stage:relation T<tier> kind family facet`, sorted. */
export function tierLines(plan) {
  const lines = new Set();
  for (const frame of plan?.frames ?? []) for (const item of frame.items) {
    const ref = item.relationRef;
    lines.add([`${ref.stageIndex}:${ref.relationIndex}`, `T${item.claimTier ?? '-'}`, item.kind, item.familyId, item.tier2FacetId]
      .filter(Boolean).join(' '));
  }
  return [...lines].sort();
}

/** The fingerprint of one prepared analysis: `frames` are the desktop Replay
 * frames in order (normalized, from layoutVisualFrames) and `canopy` its
 * desktop Canopy frame or null. */
export function snapshotRecord(visual, frames, canopy, panelModules) {
  const { prepared, record } = visual;
  const panels = panelText(panelModules, prepared.playbackSteps, record.derivationStages);
  return { frames: frames.map(frame => digest(canonicalFrame(frame, panels[frame.frame - 1]))).join(' '),
    canopy: canopy ? digest(canonicalFrame(canopy)) : null, tiers: tierLines(prepared.relationRenderPlan) };
}

/** Frame numbers as ranges: [4,5,6,9] → "4–6, 9". */
export const frameRanges = numbers => numbers.reduce((ranges, number) => {
  const last = ranges.at(-1);
  if (last && last[1] === number - 1) last[1] = number; else ranges.push([number, number]);
  return ranges;
}, []).map(([from, to]) => from === to ? `${from}` : `${from}–${to}`).join(', ');

/** Differences between the committed fingerprints and this run's. With
 * `complete` false (a partial run), committed analyses that were not run are
 * not reported as removed. */
export function compareSnapshots(expected, actual, { complete = true } = {}) {
  const changed = [], added = [], removed = [];
  for (const [id, now] of Object.entries(actual)) {
    const before = expected[id];
    if (!before) { added.push(id); continue; }
    const a = before.frames.split(' '), b = now.frames.split(' ');
    const frames = [];
    for (let index = 0; index < Math.max(a.length, b.length); index++) if (a[index] !== b[index]) frames.push(index + 1);
    const tiers = { removed: before.tiers.filter(line => !now.tiers.includes(line)), added: now.tiers.filter(line => !before.tiers.includes(line)) };
    if (frames.length || before.canopy !== now.canopy || tiers.removed.length || tiers.added.length)
      changed.push({ id, frames, frameCount: [a.length, b.length], canopy: before.canopy !== now.canopy, tiers });
  }
  if (complete) for (const id of Object.keys(expected)) if (!actual[id]) removed.push(id);
  return { changed, added, removed };
}

/** Readable lines for a comparison, at most `limit` analyses. */
export function describeComparison({ changed, added, removed }, limit = 40) {
  const lines = changed.slice(0, limit).flatMap(({ id, frames, frameCount: [was, now], canopy, tiers }) => [
    `  ${id}`,
    ...(frames.length ? [`    frames ${frameRanges(frames)}${was !== now ? ` (was ${was} frames, now ${now})` : ''}`] : []),
    ...(canopy ? ['    Canopy'] : []),
    ...tiers.removed.map(line => `    - ${line}`), ...tiers.added.map(line => `    + ${line}`)
  ]);
  if (changed.length > limit) lines.push(`  … and ${changed.length - limit} more`);
  if (added.length) lines.push(`  Not in the snapshot: ${added.slice(0, limit).join(', ')}`);
  if (removed.length) lines.push(`  No longer audited: ${removed.slice(0, limit).join(', ')}`);
  return lines;
}

export const readSnapshot = file => JSON.parse(readFileSync(file, 'utf8')).records;

/** One analysis per block and one tier per line, so a diff names what changed. */
export function writeSnapshot(file, records) {
  const ids = Object.keys(records).sort();
  const body = ids.map(id => `    ${JSON.stringify(id)}: {\n      "frames": ${JSON.stringify(records[id].frames)},\n`
    + `      "canopy": ${JSON.stringify(records[id].canopy)},\n      "tiers": [${records[id].tiers.length
      ? `\n${records[id].tiers.map(line => `        ${JSON.stringify(line)}`).join(',\n')}\n      ` : ''}]\n    }`).join(',\n');
  writeFileSync(file, `{\n  "schemaVersion": 1,\n  "viewport": "${SNAPSHOT_VIEWPORT}",\n  "records": {\n${body}\n  }\n}\n`);
}
