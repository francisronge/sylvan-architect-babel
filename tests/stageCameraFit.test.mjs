import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { buildStageCameraFit } from '../replay/stageCamera.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const ref = { stageIndex: 0, relationIndex: 0, relation: 'Fixture', anchors: {} };
const label = 'gender: feminine; number: plural; person: third';

function fit(measurePlaqueText) {
  const tree = { id: 'root', label: 'XP', children: [
    { id: 'a', label: 'A', word: 'one', children: [] },
    { id: 'b', label: 'B', word: 'two', children: [] }
  ] };
  const stage = { statement: 'Test', stageRecord: 'Test', workspaceForest: [tree], relations: [] };
  const steps = buildReplayPlayback({ sentence: 'one two', analyses: [{ tree, derivationStages: [stage] }] }).steps;
  const item = { kind: 'undirected-link', linkStyle: 'feature-sharing', label, pairs: [{ fromNodeId: 'a', toNodeId: 'b' }], relationRef: ref };
  return buildStageCameraFit({ steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
    plan: { frames: [{ items: [item] }] }, width: 800, height: 700, plaqueSchedule: { stages: [new Map()], steps: new Map() },
    measurePlaqueText, measureCategoryText: undefined, measureTreeInk: undefined, treeLabelRuns: undefined, measureTreeLabel: undefined });
}

test('the stage camera fit sizes native plaques with the text measure the painter uses', () => {
  const narrow = fit(text => ({ width: [...text].length * 8, ascent: 25, descent: 7 })).bounds;
  const wide = fit(text => ({ width: [...text].length * 40, ascent: 25, descent: 7 })).bounds;
  // Wider text wraps the shared-feature plaque onto more lines below the words.
  assert(wide.maxY > narrow.maxY, 'measured plaque text must reach the camera bounds');
});

const sources = directory => readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(ts|tsx|mjs)$/u.test(entry.name))
  .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)));

test('the app and the offline camera audit fit Replay through one stage camera function', () => {
  // A second call site could pass different inputs, so the audit would verify a camera the app never fits.
  for (const file of [...sources('components'), ...sources('scripts')]) {
    assert.doesNotMatch(readFileSync(path.join(root, file), 'utf8'), /buildStageCameraBounds\s*\(/u,
      `${file} must fit through buildStageCameraFit`);
  }
  for (const file of ['components/TreeVisualizer.tsx', 'scripts/replayFrameLayout.mjs']) {
    assert.match(readFileSync(path.join(root, file), 'utf8'), /buildStageCameraFit\(\{/u, `${file} calls the shared fit`);
  }
});
