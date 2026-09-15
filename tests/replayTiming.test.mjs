import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { getFrameRelations } from '../replay/replayCompiler.ts';
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

test('neutral structural timing is independent of an incomplete registered name', () => {
  for (const name of ['wh-movement', 'Unregistered change']) {
    const phrase = { id: 'phrase', label: 'DP', lineageId: 'phrase-family', children: [{ id: 'word', label: 'D', word: 'what' }] };
    const state = (children, relations = []) => ({ statement: 'Authored state', stageRecord: '', relations,
      workspaceForest: [{ id: 'root', label: 'CP', children }] });
    const record = { derivationStages: [
      state([{ id: 'origin', label: 'VP', children: [phrase] }]),
      state([phrase, { id: 'origin', label: 'VP', children: [{ id: 'trace', label: 'DP', lineageId: 'phrase-family', silent: true }] }], [
        { relation: name, anchors: { headOfChain: 'phrase', footOfChain: 'trace' }, priorAnchors: { location: 'origin' },
          values: { outcome: ['blocked', 'licensed'] } }
      ])
    ] };
    const original = structuredClone(record);
    const steps = play(record);
    const moment = moments(steps, 1)[0];
    const before = steps[steps.indexOf(moment) - 1];
    const parent = (step, id) => nodes(step.replayCanvasData).find(n => n.children?.some(c => c.id === id))?.id;
    assert.equal(parent(before, 'phrase'), 'origin', 'the phrase remains at its prior position until the relation');
    assert.ok(!visible(before, 'trace'));
    assert.equal(parent(moment, 'phrase'), 'root');
    assert.ok(visible(moment, 'trace'));
    const items = compileRelationRenderPlan(record.derivationStages).frames.at(-1).items;
    assert.ok(items.some(i => i.kind === 'fallback'));
    assert.ok(!items.some(i => i.kind === 'trajectory'), 'correct timing does not earn an arrow');
    assert.deepEqual(record, original);
  }
});

test('neutral transition evidence excludes an independently recovered sibling claim', () => {
  const forest = [{ id: 'a', label: 'DP' }, { id: 'b', label: 'DP' }, { id: 'c', label: 'X' }, { id: 'd', label: 'X' }];
  const relation = { relation: 'wh-movement', anchors: { headOfChain: 'a', footOfChain: 'b', assigner: 'c', recipient: 'd' },
    priorAnchors: { location: 'b' }, values: { case: 'Accusative' } };
  const [step] = getFrameRelations({ workspaceForest: forest }, { relationSteps: [relation] }, forest);
  assert.deepEqual(step.neutralTransitionEvidence.anchors, { headOfChain: 'a', footOfChain: 'b' });
  assert.deepEqual(step.neutralTransitionEvidence.priorAnchors, { location: 'b' });
  assert.deepEqual(step.anchors, relation.anchors, 'all original participants remain available for display');
});

const abstractItem = (id, children = []) => ({ id, label: 'X', children });
const realizedItem = id => ({ id, label: 'V', word: 'walked', children: [] });
const transformation = (output, input) => ({ relation: 'Authored transformation',
  anchors: { output }, priorAnchors: { input } });
const transitionRecord = (previous, current, relations) => ({ derivationStages: [
  { statement: 'Initial structure', stageRecord: '', workspaceForest: previous, relations: [] },
  { statement: 'Changed structure', stageRecord: '', workspaceForest: current, relations }
] });

test('owned removal or relocation retires exhausted prior containers at the relation moment', () => {
  const inputs = [abstractItem('stem'), abstractItem('tense')];
  const output = realizedItem('output');
  const independent = abstractItem('independent', [abstractItem('independent_child')]);
  const cases = [
    { previous: abstractItem('old', inputs), current: output, output: 'output' },
    { previous: abstractItem('older', [abstractItem('old', inputs)]), current: output, output: 'output' },
    { previous: abstractItem('old', inputs), current: abstractItem('new', [output]), output: 'output' },
    { previous: abstractItem('old', inputs), current: abstractItem('new', inputs), output: ['stem', 'tense'] }
  ];
  for (const item of cases) {
    const record = transitionRecord([item.previous, independent], [item.current, independent], [
      transformation(item.output, ['stem', 'tense'])
    ]);
    const original = structuredClone(record);
    const steps = play(record);
    const moment = moments(steps, 1)[0];
    const before = steps[steps.indexOf(moment) - 1];
    for (const id of ['old', 'stem', 'tense']) assert.ok(visible(before, id), id);
    for (const id of ['old', 'older']) assert.ok(!visible(moment, id), id);
    for (const id of [item.output].flat()) assert.ok(visible(moment, id), id);
    const material = nodes(moment.replayCanvasData);
    assert.deepEqual(material.find(node => node.id === 'independent'),
      nodes(before.replayCanvasData).find(node => node.id === 'independent'));
    if (item.current.id === 'new') {
      assert.deepEqual(material.find(node => node.id === 'new').children.map(node => node.id),
        item.current.children.map(node => node.id));
    }
    assert.deepEqual(record, original);
  }
});

test('ancestor cleanup preserves authored empty parents and unowned siblings or empty items', () => {
  const inputs = [abstractItem('stem'), abstractItem('tense')];
  const output = realizedItem('output');
  const cases = [
    { previous: [abstractItem('old', inputs)], current: [abstractItem('old'), output], kept: ['old'] },
    { previous: [abstractItem('old', [...inputs, abstractItem('sibling')])], current: [output], kept: ['old', 'sibling'] },
    { previous: [abstractItem('old', inputs), abstractItem('empty')], current: [output], kept: ['empty'] },
    { previous: [abstractItem('old', inputs)], current: [abstractItem('old'), abstractItem('old'), output], kept: ['old'] }
  ];
  for (const item of cases) {
    const record = transitionRecord(item.previous, item.current, [transformation('output', ['stem', 'tense'])]);
    const original = structuredClone(record);
    const moment = moments(play(record), 1)[0];
    for (const id of item.kept) assert.ok(visible(moment, id), id);
    for (const id of ['stem', 'tense']) assert.ok(!visible(moment, id), id);
    assert.ok(visible(moment, 'output'));
    assert.deepEqual(record, original);
  }
});

test('overlapping claims retire a removed parent only when its last child has changed', () => {
  const record = transitionRecord([abstractItem('old', [abstractItem('stem'), abstractItem('tense')])],
    [realizedItem('first'), realizedItem('second')], [
      transformation('first', 'stem'),
      transformation('second', ['stem', 'tense'])
    ]);
  const original = structuredClone(record);
  const [first, second] = moments(play(record), 1);
  for (const id of ['old', 'tense', 'first']) assert.ok(visible(first, id), id);
  for (const id of ['stem', 'second']) assert.ok(!visible(first, id), id);
  for (const id of ['old', 'stem', 'tense']) assert.ok(!visible(second, id), id);
  for (const id of ['first', 'second']) assert.ok(visible(second, id), id);
  assert.deepEqual([first, second].map(step => step.replayRelationIdentity.relationIndex), [0, 1]);
  assert.deepEqual(record, original);
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
    { relation: 'AbarMove', anchors: { source: 'dp_wh', landing: 'dp_wh_hi' },
      values: { outcome: ['blocked', 'licensed'] } }
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
