import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { __test__ as parser } from '../server/babelParser.js';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const copy = name => structuredClone(saved.find(record => record.name === name));
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const play = record => buildReplayPlayback({ sentence: 'Which book did John buy?', analyses: [record] }).steps;
const moments = (steps, stage) => steps.filter(step => step.replayFrameIndex === stage && step.replayKind === 'relation');
const visible = (step, id) => step.replayVisibleNodeIds.includes(id);
const higherHead = () => ({ id: 'higher_head', label: 'X', silent: true, children: [] });

test('an added container is completed after existing children are attached to its temporary shell', () => {
  for (const nested of [false, true]) for (const reverse of [false, true]) {
    const leaf = id => ({ id, label: 'X', word: id });
    const container = { id: 'container', label: 'XP', children: [leaf('new'), leaf('old')] };
    const attachment = nested ? { id: 'outer', label: 'XP', children: [container] } : container;
    const anchors = { container: attachment.id, participant: 'new' };
    const state = (workspaceForest, relations = []) => ({ statement: 'Authored change', stageRecord: '', workspaceForest, relations });
    const record = { derivationStages: [
      state([{ id: 'root', label: 'XP', children: [leaf('old'), leaf('other')] }]),
      state([{ id: 'root', label: 'XP', children: [attachment, leaf('other'), leaf('later')] }], [
        { relation: 'Authored change', anchors: reverse ? Object.fromEntries(Object.entries(anchors).reverse()) : anchors,
          priorAnchors: { participant: 'old' } },
        { relation: 'Later change', anchors: { participant: 'later' }, priorAnchors: { participant: 'other' } }
      ])
    ] };
    const original = structuredClone(record);
    const steps = play(record);
    const moment = moments(steps, 1)[0];
    const before = steps[steps.indexOf(moment) - 1];
    assert.ok(!visible(before, 'new'));
    assert.ok(visible(moment, 'new'), 'the new child must appear with its owning relation');
    assert.ok(!visible(moment, 'later'), 'unrelated later material remains pending');
    const material = nodes(moment.replayCanvasData);
    assert.deepEqual(material.find(n => n.id === 'container').children.map(n => n.id), ['new', 'old']);
    assert.equal(material.filter(n => n.id === 'old').length, 1);
    assert.deepEqual(record, original);
  }
});

const mixedHeadStage = (anchor = 'd_john_hi') => {
  const record = copy('fable-minimalism');
  record.derivationStages = record.derivationStages.slice(0, 4);
  const stage = record.derivationStages[3];
  stage.workspaceForest = [{ id: 'higher_phrase', label: 'XP', children: [higherHead(), ...stage.workspaceForest] }];
  stage.relations.unshift({ relation: 'Nominal interpretation', anchors: { participant: anchor } });
  return record;
};

for (const anchor of ['d_john_hi', 'higher_head']) {
  test(`an earlier ordinary relation stays before movement with ${anchor} ready`, () => {
    const record = mixedHeadStage(anchor);
    const original = structuredClone(record);
    const steps = play(record);
    const [ordinary, movement] = moments(steps, 3);
    assert.deepEqual(moments(steps, 3).map(s => s.replayRelationIdentity.relationIndex), [0, 1]);
    assert.equal(ordinary.operation, 'Nominal interpretation');
    assert.ok(visible(ordinary, anchor));
    assert.ok(!visible(ordinary, 't_did_hi'));
    assert.ok(!visible(ordinary, 'higher_phrase'));
    assert.ok(visible(movement, 't_did_hi'));
    assert.ok(!visible(movement, 'higher_phrase'));
    assert.ok(steps.findIndex(s => s.targetNodeId === 'higher_phrase') > steps.indexOf(movement));
    assert.deepEqual(record, original);
  });
}

for (const anchor of ['t_did_hi', 'c_complex', 'higher_phrase']) {
  test(`a future ${anchor} is diagnosed without reordering or revealing it`, () => {
    const steps = play(mixedHeadStage(anchor));
    const [ordinary, movement] = moments(steps, 3);
    assert.deepEqual(moments(steps, 3).map(s => s.replayRelationIdentity.relationIndex), [0, 1]);
    assert.ok(!visible(ordinary, anchor));
    const diagnostic = ordinary.movementDiagnostics.join('\n');
    assert.match(diagnostic, /Stage 4/);
    assert.match(diagnostic, /relation 1/);
    assert.match(diagnostic, /before relation 2/);
    assert.match(diagnostic, /order is preserved/);
    assert.ok(visible(movement, 't_did_hi'));
    assert.ok(visible(steps.at(-1), anchor), 'the authored final state remains inspectable');
  });
}

test('a known relation does not run early merely because its anchors exist', () => {
  const record = copy('astra-minimalism');
  const steps = play(record);
  const agree = steps.findIndex(s => s.replayFrameIndex === 2 && s.operation === 'Agree');
  const merge = steps.findIndex(s => s.replayFrameIndex === 2 && s.targetNodeId === 'subjectVP' && s.operation === 'ExternalMerge');
  assert.ok(agree > merge, 'without an authored boundary, do not invent earlier timing from anchor readiness');
});

test('an intermediate workspace expresses Agree before further Merge using the existing contract', () => {
  const record = copy('astra-minimalism');
  const stage = record.derivationStages[2];
  const finalForest = structuredClone(record.derivationStages.at(-1).workspaceForest);
  const core = stage.workspaceForest.flatMap(nodes).find(n => n.id === 'coreVP');
  record.derivationStages.splice(2, 1, {
    statement: 'Transitive v agrees with the object.',
    stageRecord: 'v merges with VP, then Agree values the object before John merges.',
    workspaceForest: [structuredClone(core)], relations: stage.relations
  }, { ...stage, statement: 'John merges with vP.', stageRecord: 'John merges after Agree.', relations: [] });
  const bundle = parser.normalizeParseBundle({ derivationStages: record.derivationStages }, 'minimalism', 'Which book did John buy?', 'gpt', true);
  const { steps } = buildReplayPlayback(bundle);
  const agree = steps.find(s => s.replayFrameIndex === 2 && s.operation === 'Agree');
  assert.ok(agree);
  assert.ok(!visible(agree, 'johnDP'));
  assert.ok(steps.findIndex(s => s.replayFrameIndex === 3 && s.targetNodeId === 'subjectVP') > steps.indexOf(agree));
  assert.deepEqual(record.derivationStages.at(-1).workspaceForest, finalForest);
});

test('Tier 3 movement retains authored order and atomic attachment without gaining an arrow', () => {
  const record = copy('fable-minimalism');
  const stage = record.derivationStages[4];
  stage.workspaceForest = [{ id: 'higher_phrase', label: 'XP', children: [higherHead(), ...stage.workspaceForest] }];
  stage.relations = [
    { relation: 'Nominal interpretation', anchors: { participant: 'd_john_hi' } },
    { relation: 'AbarMove', anchors: { source: 'dp_wh', landing: 'dp_wh_hi' } }
  ];
  const steps = play(record);
  const [ordinary, movement] = moments(steps, 4);
  assert.deepEqual(moments(steps, 4).map(s => s.replayRelationIdentity.relationIndex), [0, 1]);
  assert.ok(!visible(ordinary, 'dp_wh_hi'));
  assert.ok(visible(movement, 'dp_wh_hi'));
  assert.ok(visible(movement, 'cp_full'));
  const items = compileRelationRenderPlan(record.derivationStages).frames[4].items;
  assert.ok(!items.some(i => i.kind === 'trajectory' && i.relationRef.stageIndex === 4 && i.relationRef.relationIndex === 1));
});

test('two movements and intervening relations retain order before a higher merge', () => {
  const phrase = (id, lineage, word, silent = false) => ({ id, label: 'DP', lineageId: lineage,
    ...(silent ? { silent: true } : {}), children: [{ id: `${id}_D`, label: 'D', ...(silent ? { silent: true } : { word }), children: [] }] });
  const a = phrase('a', 'A', 'a');
  const b = phrase('b', 'B', 'b');
  const record = { derivationStages: [
    { statement: 'Two phrases.', stageRecord: 'Two phrases are established.', relations: [], workspaceForest: [a, b] },
    { statement: 'Two independent movements.', stageRecord: 'Interpret A, move A, interpret B, move B, then merge the resulting structures.',
      relations: [
        { relation: 'Interpretation', anchors: { participant: 'a' } },
        { relation: 'Internal Merge', anchors: { lowerCopy: 'a', higherCopy: 'a_hi' } },
        { relation: 'Interpretation', anchors: { participant: 'b' } },
        { relation: 'Internal Merge', anchors: { lowerCopy: 'b', higherCopy: 'b_hi' } }
      ], workspaceForest: [{ id: 'root', label: 'XP', children: [
        { id: 'host_a', label: 'XP', children: [phrase('a_hi', 'A', 'a'), phrase('a', 'A', 'a', true)] },
        { id: 'host_b', label: 'XP', children: [phrase('b_hi', 'B', 'b'), phrase('b', 'B', 'b', true)] }
      ] }] }
  ] };
  const steps = play(record);
  const relations = moments(steps, 1);
  assert.deepEqual(relations.map(s => s.replayRelationIdentity.relationIndex), [0, 1, 2, 3]);
  assert.ok(!visible(relations[0], 'a_hi'));
  assert.ok(visible(relations[1], 'a_hi'));
  assert.ok(!visible(relations[2], 'b_hi'));
  assert.ok(visible(relations[3], 'b_hi'));
  assert.ok(steps.findIndex(s => s.targetNodeId === 'root') > steps.indexOf(relations[3]));
});
