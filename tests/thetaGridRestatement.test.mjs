import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { checkMarkPersistence, stepMarks } from './helpers/replayStepInvariants.mjs';

// A relative operator moves to Spec-CP; the next claim restates the verb's
// inventory with the trace and names the earlier inventory in `priorAnchors`,
// as GPT-6.1 Sol wrote it in sol-120-20261026 n3-78 a1 (separate argument
// fields), n4-22 a1 (one argument list) and n4-40 a1 (one argument).
const authoredStage = (workspaceForest, relations) => ({ statement: 'An authored state.', stageRecord: 'An authored account.', workspaceForest, relations });
const vp = object => ({ id: 'vp', label: 'VP', children: [{ id: 'agent', label: 'DP', word: 'Mia' },
  { id: 'vbar', label: "V'", children: [{ id: 'v', label: 'V', word: 'read' }, object] }] });
const op = { id: 'op', label: 'DP', lineageId: 'operator', silent: true };
const trace = { id: 'trace', label: 'DP', lineageId: 'operator', silent: true };
const movement = { relation: 'A-bar movement', anchors: { landing: 'op', sourceTrace: 'trace' }, priorAnchors: { source: 'op' } };
const record = (original, restated) => ({ sentence: 'Mia read', derivationStages: [
  authoredStage([vp(op)], [original]),
  authoredStage([{ id: 'cp', label: 'CP', children: [op, { id: 'cbar', label: "C'", children: [{ id: 'c', label: 'C', silent: true }, vp(trace)] }] }],
    [movement, restated])] });

const shapes = {
  'separate argument fields': record(
    { relation: 'theta-assignment', anchors: { predicate: 'v', agent: 'agent', theme: 'op' }, values: { agentRole: 'Agent', themeRole: 'Theme' } },
    { relation: 'theta-assignment', anchors: { predicate: 'v', agent: 'agent', theme: 'trace' },
      priorAnchors: { predicate: 'v', agent: 'agent', theme: 'op' }, values: { agentRole: 'Agent', themeRole: 'Theme' } }),
  'one argument list': record(
    { relation: 'theta-role assignment', anchors: { predicate: 'v', arguments: ['agent', 'op'] }, values: { arguments: ['Agent', 'Theme'] } },
    { relation: 'theta-role assignment', anchors: { predicate: 'v', arguments: ['agent', 'trace'] },
      priorAnchors: { predicate: 'v', arguments: ['agent', 'op'] }, values: { arguments: ['Agent', 'Theme'] } }),
  'one argument': record(
    { relation: 'theta assignment', anchors: { predicate: 'v', argument: 'op' }, values: { role: 'Theme' } },
    { relation: 'theta assignment', anchors: { predicate: 'v', argument: 'trace' },
      priorAnchors: { predicate: 'v', argument: 'op' }, values: { role: 'Theme' } })
};

const refs = item => planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`);
const isGrid = item => item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid';
const isThetaMark = item => isGrid(item) || item.kind === 'node-badges' && item.badgeStyle === 'theta-role';
/** The theta marks each step paints, as the renderer selects them. */
const paintedThetaMarks = replay => {
  const played = new Map();
  return replay.playbackSteps.map(step => {
    const stage = step.replayFrameIndex;
    if (!played.has(stage)) played.set(stage, new Set());
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
    if (identity?.stageIndex === stage) played.get(stage).add(identity.relationIndex);
    return stepMarks(replay.relationRenderPlan, step, played.get(stage)).filter(mark => mark.painted && isThetaMark(mark.item)).map(mark => mark.item);
  });
};

for (const [shape, authored] of Object.entries(shapes)) {
  test(`a theta claim restating its earlier inventory replaces that grid at its moment (${shape})`, () => {
    const replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
    const steps = replay.playbackSteps, marks = paintedThetaMarks(replay);
    const restates = steps.findIndex(step => step.replayKind === 'relation'
      && step.replayRelationIdentity.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 1);
    assert(restates > 0);
    // Before the restatement plays, the earlier grid stands; from its moment, only the restated grid.
    assert.deepEqual(marks[restates - 1].filter(isGrid).map(refs), [['0:0']]);
    for (const painted of marks.slice(restates)) {
      assert.deepEqual(painted.filter(isGrid).map(refs), [['1:1']]);
      assert(painted.every(item => !refs(item).includes('0:0')), 'the earlier grid\'s badges yield with it');
    }
    assert.deepEqual(marks.at(-1).find(isGrid).thetaRoles.map(role => role.nodeId).sort(),
      Object.values(authored.derivationStages[1].relations[1].anchors).flat().filter(id => id !== 'v').sort());
    assert(!replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'fallback' && refs(item).includes('1:1')),
      'the prior block is the grid\'s own replacement evidence, not a neutral remainder');
    assert.deepEqual(checkMarkPersistence(replay, authored), []);

    // Control: the earlier grid and badges kept painting beside the restatement.
    const broken = { ...replay, relationRenderPlan: { ...replay.relationRenderPlan, frames: replay.relationRenderPlan.frames.map(frame => ({
      ...frame, items: frame.items.map(item => {
        if (!refs(item).includes('0:0')) return item;
        const { supersededAt: _supersededAt, ...kept } = item;
        return kept;
      }) })) } };
    assert(checkMarkPersistence(broken, authored).some(found => found.subtype === 'outlives-restatement'
      && found.frame === restates + 1 && found.subject.startsWith('node-plaque') && found.subject.endsWith(' 0:0')));
  });
}

test('an identical theta restatement without a prior state still shares the earlier grid', () => {
  const claim = shapes['one argument list'].derivationStages[0].relations[0];
  const authored = { sentence: 'Mia read', derivationStages: [authoredStage([vp(op)], [claim]),
    authoredStage([vp(op)], [{ relation: 'Context', anchors: { head: 'v' } }, structuredClone(claim)])] };
  const replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
  const grids = replay.relationRenderPlan.frames[1].items.filter(isGrid);
  assert.deepEqual(grids.map(refs), [['0:0', '1:1']]);
  assert.equal(grids[0].supersededAt, undefined);
  assert.deepEqual(checkMarkPersistence(replay, authored), []);
});
