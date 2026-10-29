import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { isPlanItemRevealed } from '../replay/relations/renderPlan.ts';

/** Every realization-style plate each Replay step reveals, as the renderer selects it. */
const platesPerStep = prepared => {
  const played = new Map();
  return prepared.playbackSteps.map(step => {
    const stage = step.replayFrameIndex;
    if (!played.has(stage)) played.set(stage, new Set());
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
    if (identity?.stageIndex === stage) played.get(stage).add(identity.relationIndex);
    return { step, plates: (prepared.relationRenderPlan.frames[stage]?.items ?? []).filter(item => item.kind === 'node-plaque'
      && item.plaqueStyle === 'realization'
      && isPlanItemRevealed(item, stage, played.get(stage), identity?.relationIndex ?? null)) };
  });
};
const canopyPlates = plan => {
  const frame = plan.frames.at(-1);
  return frame.items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'realization'
    && isPlanItemRevealed(item, frame.stageIndex, null));
};
const text = item => item.rows.map(row => row.label ? `${row.label} → ${row.value}` : row.value).join(' / ');

const leaf = (id, label, word, extra = {}) => ({ id, label, word, ...extra });
const forest = [{ id: 'tp', label: 'TP', children: [
  { id: 'dp', label: 'DP', children: [leaf('mia', 'N', 'Mia')] },
  { id: 'tbar', label: "T'", children: [
    { id: 'vt', label: 'T', children: [leaf('go', 'V', 'go'), leaf('past', 'T', 'past', { silent: true })] },
    { id: 'np', label: 'NP', children: [leaf('home', 'N', 'home')] }
  ] }
] }];
const stage = (relations, realizations) => ({ statement: 'Authored stage', stageRecord: 'The authored analysis.',
  workspaceForest: forest, relations, ...(realizations ? { realizations } : {}) });
const association = (name, ids) => ({ relation: name, anchors: { participants: ids } });
const record = relations => ({ sentence: 'Mia went home.', inputTokens: ['Mia', 'went', 'home'], includePlayback: true,
  derivationStages: [stage([]), stage(relations, [{ nodeIds: ['vt'], tokenIndices: [1] }, { nodeIds: ['mia'], tokenIndices: [0] }])] });

test('a realized form its leaves do not spell is drawn at its owner moment, persists and reaches the Canopy', () => {
  const prepared = prepareReplay(record([association('Clause typing', ['tp']), association('Tense realization', ['vt'])]));
  const steps = platesPerStep(prepared);
  const owner = steps.findIndex(({ step }) => step.replayKind === 'relation' && step.replayFrameIndex === 1
    && step.replayRelationIdentity.relationIndex === 1);
  assert(owner > 0);
  steps.forEach(({ plates }, index) => assert.deepEqual(plates.map(text), index < owner ? [] : ['go → went'], `step ${index + 1}`));
  assert.deepEqual(steps[owner].plates[0].anchorNodeIds, ['go'], 'anchored on the pronounced contributor, where the word stands');
  assert.equal(steps[owner].plates[0].relationRef.relationIndex, 1, 'the owning relation focuses its plate');
  // The group whose leaves spell its text ("Mia") draws nothing.
  assert.deepEqual(canopyPlates(prepareReplay({ ...record([association('Clause typing', ['tp']),
    association('Tense realization', ['vt'])]), includePlayback: false }).relationRenderPlan).map(text), ['go → went']);
});

test('an association no single relation owns is drawn at its latest covering relation, never first at a Stage Record', () => {
  // Relations 1 and 2 both cover vt; relation 3, which follows them, does not.
  const prepared = prepareReplay(record([association('Tense lowering', ['vt']), association('Tense realization', ['vt']),
    association('Clause typing', ['tp'])]));
  const steps = platesPerStep(prepared);
  const firstShown = steps.findIndex(({ plates }) => plates.length);
  assert(firstShown >= 0, 'the realized form is drawn');
  assert.equal(steps[firstShown].step.replayKind, 'relation');
  assert.deepEqual(steps[firstShown].step.replayRelationIdentity, { stageIndex: 1, relationIndex: 1 });
  assert.deepEqual(steps[firstShown].plates.map(text), ['go → went']);
  assert.deepEqual(steps[firstShown].step.replayRealizations.find(group => group.nodeIds.includes('vt')), { nodeIds: ['vt'], tokenIndices: [1] },
    'the plate shows exactly when Replay makes the association active');
  assert(steps.slice(0, firstShown).every(({ step }) => !step.replayRealizations?.some(group => group.nodeIds.includes('vt'))));
});

test('do-support shows "did" at its latest covering relation, never first at the Stage Record, without duplicating "left"', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/showcase/scope-ellipsis-coordination.json', import.meta.url), 'utf8')).cases[3];
  assert.equal(fixture.sentence, 'John left, and Mary did too.');
  const prepared = prepareReplay({ derivationStages: fixture.derivationStages, sentence: fixture.sentence,
    inputTokens: fixture.inputTokens, includePlayback: true });
  const steps = platesPerStep(prepared);
  // Relation 3 states "did" but also anchors the elided VP outside the group,
  // so it does not settle the tie with the ellipsis licensing relation 4: the
  // plate waits for relation 4, the latest covering relation.
  const firstShown = steps.findIndex(({ plates }) => plates.some(item => item.realization));
  assert(firstShown >= 0, 'the realized form is drawn');
  assert.equal(steps[firstShown].step.replayKind, 'relation');
  assert.deepEqual(steps[firstShown].step.replayRelationIdentity, { stageIndex: 2, relationIndex: 3 });
  const did = steps.at(-1).plates.filter(item => item.realization);
  assert.deepEqual(did.map(text), ['do → did']);
  assert.deepEqual(did[0].anchorNodeIds, ['do']);
  // "left" is already drawn by the relation's own PF realization plate: one plate, not two.
  const onLeft = canopyPlates(prepared.relationRenderPlan).filter(item => item.anchorNodeIds.includes('jcomplex'));
  assert.equal(onLeft.length, 1);
  assert.equal(onLeft[0].realization, undefined);
  assert.deepEqual(canopyPlates(prepared.relationRenderPlan).filter(item => item.realization).map(text), ['do → did']);
});

test('of relations covering one association, the one stating its realized text owns it, whatever its field names', () => {
  // The s1-11 shape: do-support names the head among many anchors; a separate realization states the text.
  const support = { relation: 'do-support', anchors: { finiteHead: 'vt', insertedAuxiliary: 'go', inflection: 'past' },
    values: { operation: 'Insert the supporting verb in finite T.' } };
  const stating = { relation: 'past-tense realization', anchors: { source: 'vt' }, values: { morphology: 'irregular past', text: 'WENT' } };
  const steps = platesPerStep(prepareReplay(record([support, stating])));
  const firstShown = steps.findIndex(({ plates }) => plates.length);
  assert(firstShown >= 0, 'the realized form is drawn');
  assert.equal(steps[firstShown].step.replayKind, 'relation');
  assert.deepEqual(steps[firstShown].step.replayRelationIdentity, { stageIndex: 1, relationIndex: 1 });
  assert.equal(steps[firstShown].plates[0].relationRef.relationIndex, 1);
  assert(!steps[firstShown].step.replayRealizationDiagnostics?.some(text => text.includes('AMBIGUOUS')), 'no ambiguity remains');
  // Two relations stating the text stay ambiguous: the plate waits for the latter.
  const both = platesPerStep(prepareReplay(record([stating, { ...support, values: { form: 'went' } }])));
  assert.deepEqual(both[both.findIndex(({ plates }) => plates.length)].step.replayRelationIdentity, { stageIndex: 1, relationIndex: 1 });
});

test('realized text is the sentence stretch at the word-list positions', async () => {
  const { realizedInputText } = await import('../replay/realizationDisplay.ts');
  assert.equal(realizedInputText([4], 'John left, and Mary did too.', ['John', 'left', 'and', 'Mary', 'did', 'too']), 'did');
  assert.equal(realizedInputText([0, 1, 2], '読んだ本', ['読', 'ん', 'だ', '本']), '読んだ');
  assert.equal(realizedInputText([0, 2], 'a b c', ['a', 'b', 'c']), 'a … c');
});

test('a realized-form plate takes a nearby pocket beside its pronounced word', async () => {
  const { VIEWPORTS, prepareVisualRecord, layoutVisualFrames } = await import('./helpers/visualFrames.mjs');
  const { nearbyPlaqueReach } = await import('../replay/relations/plaquePlacement.ts');
  const { includePlayback, ...input } = record([association('Clause typing', ['tp']), association('Tense realization', ['vt'])]);
  const frames = layoutVisualFrames(prepareVisualRecord(input), VIEWPORTS.filter(viewport => viewport.name === 'desktop'));
  const plates = frames.flatMap(frame => frame.plaques.filter(plaque => plaque.text.includes('went')));
  assert(plates.length > 0);
  for (const plate of plates) {
    assert.match(plate.id, /@go::__leaf$/u, "attached at the word go itself");
    const distance = Math.hypot(plate.rect.x + plate.rect.width / 2 - plate.anchor.x, plate.rect.y + plate.rect.height / 2 - plate.anchor.y);
    assert(distance <= nearbyPlaqueReach(plate.size), `${plate.id} sits ${Math.round(distance)} from its word`);
  }
});

// Stage 2 activates the group realizing "went" (go + silent past); stage 3 retains it.
const retained = (relations, verb = 'go') => {
  const groups = [{ nodeIds: ['vt'], tokenIndices: [1] }, { nodeIds: ['mia'], tokenIndices: [0] }];
  const restated = structuredClone(forest);
  restated[0].children[1].children[0].children[0].word = verb;
  return { ...record([]), derivationStages: [stage([]), stage([association('Tense realization', ['vt'])], groups),
    { ...stage(relations, groups), workspaceForest: restated }] };
};
const stagePlates = (prepared, stageIndex) => platesPerStep(prepared).filter(({ step }) => step.replayFrameIndex === stageIndex);

test('a retained group plate stays until a plate the stage introduces shows the same form at its own moment', () => {
  const suppletive = { relation: 'Suppletive past-tense realization', anchors: { tense: 'past', verb: 'go', verbalComplex: 'vt' },
    values: { lexicalBase: 'go', realization: 'went', tense: 'past' } };
  const steps = stagePlates(prepareReplay(retained([association('Clause typing', ['tp']), suppletive])), 2);
  assert.deepEqual(steps.map(({ step }) => step.replayRelationIdentity?.relationIndex ?? step.operation), [0, 1, 'StageRecord']);
  assert.deepEqual(steps[0].plates.map(text), ['go → went'], 'the realized form stays before the relation plate appears');
  for (const { plates } of steps.slice(1))
    assert.deepEqual(plates.map(text), ['realization → went / tense → past'], 'one plate, not two, once the relation plate shows');
});

test('a retained group keeps its preceding display until the moment Replay paints its restated word', () => {
  const prepared = prepareReplay(retained([association('Clause typing', ['tp']),
    { relation: 'Past spell-out', anchors: { verb: 'go' } }], 'went'));
  const steps = stagePlates(prepared, 2);
  assert.deepEqual(steps.map(({ step }) => step.replayRelationIdentity?.relationIndex ?? step.operation), [0, 1, 'StageRecord']);
  assert.deepEqual(steps[0].plates.map(text), ['go → went'], 'the tree still shows go');
  assert.deepEqual(steps[1].plates.map(text), [], 'went now stands in the tree');
  assert.deepEqual(steps[2].plates.map(text), []);
  assert.deepEqual(canopyPlates(prepared.relationRenderPlan).map(text), []);
});

test('a restated group plate retires at the restatement even when a later plate shows the same form', () => {
  // Relation 2 restates go as went; relation 3, on the silent tense, shows "went" again.
  const tense = { relation: 'Suppletive past-tense realization', anchors: { tense: 'past' },
    values: { lexicalBase: 'go', realization: 'went', tense: 'past' } };
  const steps = stagePlates(prepareReplay(retained([association('Clause typing', ['tp']),
    { relation: 'Past spell-out', anchors: { verb: 'go' } }, tense], 'went')), 2);
  assert.deepEqual(steps.map(({ step }) => step.replayRelationIdentity?.relationIndex ?? step.operation), [0, 1, 2, 'StageRecord']);
  assert.deepEqual(steps[0].plates.map(text), ['go → went'], 'the tree still shows go');
  assert.deepEqual(steps[1].plates.map(text), [], 'went stands in the tree from the restatement on');
  for (const { plates } of steps.slice(2)) assert.deepEqual(plates.map(text), ['realization → went / tense → past']);
});
