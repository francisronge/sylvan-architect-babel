import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';

// Claude Opus 5.5 (opus-stress batch, s29-fr-wh-in-situ) raised an in-situ wh-phrase
// covertly to Spec-CP and gave the in-situ phrase its lineage only at that stage, as
// the contract allows when the first copy is made. Restoring the source to its
// preceding form, which has no lineage, failed the movement's lineage check, so the
// landing stayed in the stage's construction forest: CP gained it as an attachment
// and Replay played an empty Project CP step before the movement's moment.
const leaf = (id, label, word, extra = {}) => ({ id, label, children: [], ...(word === null ? { silent: true } : { word }), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const whPhrase = (id, extra = {}) => node(id, 'NP', [leaf(`${id}-n`, 'N', 'qui', extra.silent ? { silent: true } : {})], extra.lineage ? { lineageId: 'qui' } : {});
const clause = object => node('cbar', "C'", [leaf('c', 'C', null), node('ip', 'IP', [leaf('tu', 'N', 'tu'),
  node('vp', 'VP', [leaf('v', 'V', 'vois'), object])])]);
const stages = [
  { statement: 'Build the question with qui in situ.', stageRecord: 'In situ.', relations: [{ relation: 'clause typing', anchors: { typer: 'c', clause: 'cp' } }],
    workspaceForest: [node('cp', 'CP', [clause(whPhrase('np'))])] },
  { statement: 'At LF, qui raises covertly to Spec-CP.', stageRecord: 'Covert movement.',
    relations: [{ relation: 'LF wh-movement', anchors: { landing: 'np-lf', source: 'np' } }],
    workspaceForest: [node('cp', 'CP', [{ ...whPhrase('np-lf', { lineage: true }), silent: true }, clause(whPhrase('np', { lineage: true }))])] }
];
const record = { sentence: 'tu vois qui', derivationStages: stages };

test('a lineage the movement stage declares on its in-situ source does not leave the landing to construction', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = replay.playbackSteps;
  const stageSteps = steps.filter(step => step.replayFrameIndex === 1);
  assert.deepEqual(stageSteps.map(step => step.replayKind), ['relation', 'macro'], 'the stage plays its movement moment and its record only');
  assert(replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory' && item.sourceNodeId === 'np' && item.targetNodeId === 'np-lf'));
  assert.deepEqual(checkStepSemantics(replay, record), []);
});
