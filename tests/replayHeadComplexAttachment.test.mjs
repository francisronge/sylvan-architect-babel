import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';

import { prepareReplay } from '../replay/prepareReplay.ts';
import * as display from '../replay/displayIdentity.ts';
import * as camera from '../replay/stageCamera.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as layout from '../replay/treeLayout.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { frameStructure } from './helpers/replayInvariants.mjs';
import { replayStages } from './helpers/canonicalIds.mjs';

const record = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/unrendered-head-movement.json', import.meta.url), 'utf8'));

test('a head movement moment attaches the host head under the new complex head, so no branch spans two rows', () => {
  const steps = prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps;
  const at = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 4
    && step.replayRelationIdentity.relationIndex === 0);
  assert.ok(at > 0);
  for (const step of steps.slice(0, at).filter(step => step.replayFrameIndex === 4))
    assert.equal(frameStructure(step).parent.get('declarativeComplex'), undefined, 'the complex head waits for its moment');
  const structure = frameStructure(steps[at]);
  assert.equal(structure.parent.get('declarativeComplex'), 'complementizerBar');
  assert.equal(structure.parent.get('complementizer'), 'declarativeComplex', 'the host head joins the complex at its moment');
  const { scenes } = layoutReplayFrames({ steps, stages: replayStages(record), width: 1600, height: 948, direction: 'ltr' },
    { coordinates, camera, layout, display, d3 });
  const rows = [...new Set([...scenes[at].nodes.values()].map(node => node.y))].sort((a, b) => a - b);
  const row = rows[1] - rows[0];
  for (const [id, node] of scenes[at].nodes) {
    const parentId = structure.parent.get(id);
    if (parentId && scenes[at].nodes.has(parentId))
      assert.ok(node.y - scenes[at].nodes.get(parentId).y <= row + 1e-6, `${parentId}→${id} spans one row`);
  }
});
