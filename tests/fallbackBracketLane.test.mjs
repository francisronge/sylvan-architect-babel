import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { TREE_ROW_HEIGHT } from '../replay/treeSpacing.ts';

// A neutral connector's brackets hang below the words they bracket in the frame
// that shows them. Syntax that appears later in the same stage is not painted
// yet and must not push the lane down: in this Opus held-out run the degree
// modification at step 8 hung about 1,780 tree units (1,250 px at 2560×1440)
// below its two words and off the canvas.
const ID = 'replay-regressions/bracket-lane-current-frame.json#/analysis';
const record = loadFixtureAnalyses().records.find(entry => entry.id === ID).record;

test('a bracket lane hangs within one row of the words it brackets, inside the canvas', () => {
  const frames = layoutVisualFrames(prepareVisualRecord(record), VIEWPORTS, { steps: [8] });
  assert.equal(frames.length, VIEWPORTS.length);
  for (const frame of frames) {
    const line = frame.lines.find(candidate => candidate.kind === 'connector');
    assert.ok(line, `${frame.viewport}: step 8 draws the degree-modification connector`);
    const words = frame.texts.filter(text => text.kind === 'word' && text.nodes.some(node => line.nodes.includes(node)));
    const bottom = Math.max(...words.map(word => word.cell.y + word.cell.height));
    const lowest = Math.max(...line.paths.flat().map(point => point.y));
    assert.ok(lowest - bottom <= TREE_ROW_HEIGHT, `${frame.viewport}: lane ${Math.round(lowest - bottom)} units below its words`);
    const canvas = frame.chrome.canvas, panelTop = frame.chrome.panel?.y ?? canvas.y + canvas.height;
    for (const text of frame.texts.filter(text => text.claims.length)) for (const box of text.boxes)
      assert.ok(box.y + box.height <= panelTop, `${frame.viewport}: ${text.text} stays above the Replay panel`);
    assert.ok(lowest <= panelTop, `${frame.viewport}: the connector stays above the Replay panel`);
  }
});
