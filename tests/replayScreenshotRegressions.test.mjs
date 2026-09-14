import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { adaptDerivationStagesForReplay, buildAuthoredRelationLinksForFrames, buildReplayPanelContent, getFrameRelations } from '../replay/replayCompiler.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';

const records = JSON.parse(readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const visible = (step, id) => step.replayVisibleNodeIds.includes(id);
const moment = (steps, stageIndex, relationIndex) => steps.findIndex(step =>
  step.replayRelationIdentity?.stageIndex === stageIndex && step.replayRelationIdentity.relationIndex === relationIndex);
const play = record => buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;

for (const [name, parent, landing, source, cHead, whRelation] of [
  ['astra-xbar', 'questionCP', 'frontedNP', 'objectNP', 'questionC', 1],
  ['fable-xbar', 'cp1', 'dp3', 'dp1', 'c0', 0]
]) {
  test(`${name}: the waiting projection and complete wh phrase appear together`, () => {
    const record = structuredClone(records.find(item => item.name === name));
    const original = JSON.stringify(record);
    const steps = play(record);
    const move = moment(steps, 4, whRelation);
    const headMove = moment(steps, 3, 0);
    assert(move > headMove && headMove > 0);
    assert(visible(steps[headMove - 1], cHead), 'C must be built before head movement');
    for (const step of steps.slice(0, move)) {
      assert(!visible(step, parent), 'the waiting top projection is withheld');
      assert(!visible(step, landing), 'an earlier relation cannot expose the landing shell');
    }
    assert(visible(steps[move], parent));
    const high = nodes(steps[move].replayCanvasData).find(node => node.id === landing);
    for (const node of nodes(high)) assert(visible(steps[move], node.id), `missing landing descendant ${node.id}`);
    assert(visible(steps[move - 1], source));
    assert(!nodes(steps[move - 1].replayCanvasData).find(node => node.id === source).silent);
    assert(nodes(steps[move].replayCanvasData).find(node => node.id === source).silent);
    assert(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === parent));
    assert.equal(steps.filter(step => step.replayKind === 'macro').length, record.derivationStages.length);
    assert.equal(JSON.stringify(record), original, 'authored stages must not be edited by presentation');
  });
}

test('early wh licensing retains its original relation and diagnostic without revealing future syntax', () => {
  const record = records.find(item => item.name === 'astra-xbar');
  const steps = play(record);
  const step = steps[moment(steps, 4, 0)];
  assert.equal(buildReplayPanelContent(step, record.derivationStages).heading, 'wh licensing');
  assert.match(step.movementDiagnostics.join('\n'), /requires frontedNP before relation 2/);
  assert.match(step.movementDiagnostics.join('\n'), /unavailable structure is not introduced early/);
  for (const node of nodes(step.replayCanvasData)) {
    if (node.replayLayoutOnly) assert(!visible(step, node.id), `future node exposed: ${node.id}`);
  }
});

test('an earlier relation needing the unary projection prevents deferring it', () => {
  const record = structuredClone(records.find(item => item.name === 'fable-xbar'));
  record.derivationStages[3].relations.push({ relation: 'Authored projection context', anchors: { context: 'cp1' } });
  const steps = play(record);
  const earlier = steps[moment(steps, 3, 2)];
  assert(visible(earlier, 'cp1'));
});

test('a unary projection with no later movement retains its normal projection step', () => {
  const record = structuredClone(records.find(item => item.name === 'fable-xbar'));
  record.derivationStages = record.derivationStages.slice(0, 4);
  const steps = play(record);
  assert(steps.some(step => step.replayKind === 'micro' && step.operation === 'Project' && step.targetNodeId === 'cp1'));
  assert(visible(steps.at(-1), 'cp1'));
});

test('waiting-projection presentation does not depend on a CP label', () => {
  const record = structuredClone(records.find(item => item.name === 'fable-xbar'));
  for (const stage of record.derivationStages) for (const root of stage.workspaceForest) {
    if (root.id === 'cp1') root.label = 'TopP';
  }
  const steps = play(record);
  const move = moment(steps, 4, 0);
  assert(!steps.slice(0, move).some(step => visible(step, 'cp1')));
  assert(visible(steps[move], 'cp1'));
});

test('saved lexical selection and projection headings identify the selected object', () => {
  for (const record of records) {
    const steps = play(record);
    const select = steps.find(step => step.operation === 'LexicalSelect' && step.targetLabel === 'buy');
    assert(select, record.name);
    assert.equal(buildReplayPanelContent(select).heading, 'Select buy');
    const project = steps.find(step => step.operation === 'Project' && step.targetLabel === 'V');
    assert.equal(buildReplayPanelContent(project).heading, 'Project V');
  }
});

test('all saved analyses have accurate step numbers after Replay postprocessing', () => {
  for (const record of records) {
    const steps = play(record);
    for (let stageIndex = 0; stageIndex < record.derivationStages.length; stageIndex++) {
      const stageSteps = steps.filter(step => step.replayFrameIndex === stageIndex);
      stageSteps.forEach((step, index) => assert.match(step.replayProgressLabel,
        new RegExp(`Step ${index + 1}/${stageSteps.length}$`), record.name));
    }
  }
});

test('a prior-occurrence reference prevents withholding its projection', () => {
  const record = structuredClone(records.find(item => item.name === 'fable-xbar'));
  record.derivationStages[4].relations.unshift({ relation: 'Projection context', anchors: {}, priorAnchors: { projection: 'cp1' } });
  const steps = play(record);
  assert(visible(steps.find(step => step.replayFrameIndex === 3 && step.replayKind === 'macro'), 'cp1'));
});

test('an unlabelled relation cannot shift the following relation onto a sibling heading', () => {
  const record = structuredClone(records.find(item => item.name === 'astra-xbar'));
  const stage = record.derivationStages[0];
  stage.relations.unshift({ anchors: { context: 'objectNP' } });
  stage.relations.push({ relation: 'Later context', anchors: { context: 'objectNP' } });
  const steps = play(record);
  const relation = steps.find(step => step.replayRelationIdentity?.stageIndex === 0);
  assert.equal(relation.replayRelationIdentity.relationIndex, 1);
  assert.equal(buildReplayPanelContent(relation, record.derivationStages).heading, stage.relations[1].relation);
  const frames = adaptDerivationStagesForReplay(record.derivationStages);
  const plan = buildDerivationReplayPlan(record);
  for (const limit of [0, 1, 2]) {
    const links = buildAuthoredRelationLinksForFrames(frames, plan, 0, stage.workspaceForest, limit);
    assert.deepEqual(links.map(link => link.authoredRelationIndex), Array.from({ length: limit }, (_, i) => i + 1));
  }
});

test('head movement cannot reveal a separate later PF change on an unrelated node', () => {
  const record = structuredClone(records.find(item => item.name === 'fable-xbar'));
  record.derivationStages = record.derivationStages.slice(0, 4);
  const stage = record.derivationStages[3];
  const verb = stage.workspaceForest.flatMap(nodes).find(node => node.word === 'buy');
  verb.word = 'bought';
  stage.relations.push({ relation: 'PFRealization', anchors: { terminal: verb.id }, values: { realization: 'bought' } });
  const steps = play(record);
  const change = moment(steps, 3, 2);
  assert(change > moment(steps, 3, 0));
  for (const step of steps.slice(0, change).filter(step => step.replayFrameIndex === 3)) {
    assert.equal(nodes(step.replayCanvasData).find(node => node.id === `${verb.id}::__leaf`)?.word, 'buy');
  }
  assert.equal(nodes(steps[change].replayCanvasData).find(node => node.id === `${verb.id}::__leaf`)?.word, 'bought');
});

test('a later second child without movement evidence does not defer the earlier projection', () => {
  const record = structuredClone(records.find(item => item.name === 'fable-xbar'));
  record.derivationStages = record.derivationStages.slice(0, 5);
  record.derivationStages[4].relations = [];
  const steps = play(record);
  assert(visible(steps.find(step => step.replayFrameIndex === 3 && step.replayKind === 'macro'), 'cp1'));
});

test('withholding a top projection preserves its carried child and an independent workspace', () => {
  const record = structuredClone(records.find(item => item.name === 'fable-xbar'));
  for (const stage of record.derivationStages) stage.workspaceForest.push({ id: 'independent', label: 'N', word: 'aside' });
  const steps = play(record);
  const before = steps.find(step => step.replayFrameIndex === 3 && step.replayKind === 'macro');
  assert(!visible(before, 'cp1'));
  for (const id of ['cbar1', 'c0', 'independent', 'independent::__leaf']) assert(visible(before, id), id);
  assert(visible(steps[moment(steps, 4, 0)], 'cp1'));
});

const neutralAttachmentRecord = () => {
  const phrase = { id: 'phrase', label: 'YP', children: [{ id: 'word', label: 'Y', word: 'what' }] };
  const body = children => ({ id: 'body', label: 'X', children });
  const root = children => ({ id: 'top', label: 'XP', children });
  return { sentence: 'what stays', derivationStages: [
    { statement: 'First state', stageRecord: 'First state.', relations: [], workspaceForest: [
      root([body([phrase, { id: 'predicate', label: 'V', word: 'stays' }])])
    ] },
    { statement: 'Second state', stageRecord: 'Second state.', relations: [
      { relation: 'Unclassified claim', anchors: { one: 'phrase', two: 'lower' }, priorAnchors: { context: 'body' } },
      { relation: 'Later context', anchors: { context: 'phrase' } }
    ], workspaceForest: [root([structuredClone(phrase), body([
      { id: 'lower', label: 'YP', silent: true }, { id: 'predicate', label: 'V', word: 'stays' }
    ])])] }
  ] };
};

test('a fallback-owned phrase relocation reveals its waiting projection at the relation moment', () => {
  const record = neutralAttachmentRecord();
  const original = JSON.stringify(record);
  const steps = play(record);
  const attachment = moment(steps, 1, 0);
  assert(attachment > 0);
  assert(!steps.slice(0, attachment).some(step => visible(step, 'top')));
  assert(visible(steps[attachment], 'top'));
  for (const id of ['phrase', 'word', 'word::__leaf', 'body', 'lower']) assert(visible(steps[attachment], id), id);
  assert.equal(nodes(steps[attachment - 1].replayCanvasData).find(node => node.id === 'body').children[0].id, 'phrase');
  assert.equal(nodes(steps[attachment].replayCanvasData).find(node => node.id === 'body').children[0].id, 'lower');
  assert(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'top'));
  assert.equal(JSON.stringify(record), original);
  const frames = adaptDerivationStagesForReplay(record.derivationStages);
  const plan = buildDerivationReplayPlan(record);
  const relation = getFrameRelations(frames[1], plan.stages[1], record.derivationStages[0].workspaceForest)[0];
  assert(relation.neutralTransitionEvidence, 'display timing must preserve the neutral claim');
  assert.equal(relation.recoveredMovement, undefined, 'display timing must not invent movement evidence');
});

test('fallback projection deferral requires an owned persistent phrase and respects earlier projection anchors', () => {
  const cases = [
    record => { delete record.derivationStages[1].relations[0].priorAnchors; },
    record => { record.derivationStages[1].relations[0].priorAnchors = { context: 'predicate' }; },
    record => { record.derivationStages[0].workspaceForest.push({ id: 'phrase', label: 'Other' }); },
    record => { record.derivationStages[1].workspaceForest[0].children[0].id = 'new-phrase'; record.derivationStages[1].relations[0].anchors.one = 'new-phrase'; },
    record => { record.derivationStages[0].relations.push({ relation: 'Earlier context', anchors: { context: 'top' } }); },
    record => { record.derivationStages[1].relations.unshift({ relation: 'Earlier context', anchors: {}, priorAnchors: { context: 'top' } }); }
  ];
  for (const alter of cases) {
    const record = neutralAttachmentRecord();
    alter(record);
    const steps = play(record);
    assert(visible(steps.find(step => step.replayFrameIndex === 0 && step.replayKind === 'macro'), 'top'));
  }
});
