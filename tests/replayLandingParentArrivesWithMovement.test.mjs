import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { frameStructure } from './helpers/replayInvariants.mjs';

// A parent whose other daughter is built in the same stage, and whose remaining daughter is a
// movement's landing, is no independently buildable shell: it arrives with the movement that
// fills it, never with one daughter. Estonian V2: C′ is built, I moves into C, and the subject's
// movement then creates CP. Root declarative clause typing names CP, so it plays after that.
const corpus = loadFixtureAnalyses();
const record = id => structuredClone(corpus.records.find(entry => entry.id === id).record);

test('Estonian V2: CP arrives with the subject movement, never with C′ alone', () => {
  const steps = prepareReplay({ ...record('replay-regressions/native-plaque-footprints.json#'), includePlayback: true }).playbackSteps;
  const stage = steps.filter(step => step.replayFrameIndex === 4);
  const first = stage.findIndex(step => frameStructure(step).displayed.has('cp'));
  assert.ok(first >= 0, 'CP appears in its stage');
  const moment = stage[first];
  assert.equal(moment.replayKind, 'relation');
  assert.equal(moment.operation, 'subject preposing to the V2 field');
  assert.deepEqual(frameStructure(moment).children.get('cp'), ['mNP', 'cBar'], 'CP appears with the landing and C′');
  for (const step of stage.slice(first)) assert.equal(frameStructure(step).children.get('cp')?.length, 2, `${step.operation} ${step.targetNodeId}`);
  const typing = stage.findIndex(step => step.operation === 'root declarative clause typing');
  assert.ok(typing > first, 'the clause typing that names CP waits for the movement that introduces it');
});
