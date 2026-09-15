import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { adaptDerivationStagesForReplay, buildReplayPanelContent } from '../replay/replayCompiler.ts';
import { buildReplayPlayback, buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { attachReplayRealizations, resolveRealizationChanges } from '../replay/realizationReplay.ts';

const node = (id, children = []) => ({ id, label: id, children });
const forest = [node('domain', [node('root'), node('past'), node('other')])];
const group = (nodeIds = ['root', 'past'], tokenIndices = [0]) => ({ nodeIds, tokenIndices });
const relation = (current, prior, name = 'Authored association') => ({ relation: name,
  anchors: { participants: current }, ...(prior ? { priorAnchors: { participants: prior } } : {}) });
const stage = (realizations, relations = [], workspaceForest = forest) => ({
  statement: 'Authored stage', stageRecord: 'The authored analysis.', workspaceForest, relations,
  ...(realizations === undefined ? {} : { realizations })
});
const bundle = stages => ({ sentence: 'walked again', analyses: [{ tree: forest[0], derivationStages: stages }] });
const play = stages => buildReplayPlayback(bundle(stages)).steps;
const moments = (steps, stageIndex) => steps.filter(step => step.replayFrameIndex === stageIndex && step.replayKind === 'relation');
const completion = (steps, stageIndex) => steps.find(step => step.replayFrameIndex === stageIndex && step.replayKind === 'macro');
const geometry = steps => steps.map(({ replayRealizations, replayRealizationDiagnostics, ...step }) => step);

test('a realization-only stage switches at its exact owner without changing Replay geometry', () => {
  for (const name of ['Authored association', 'A name with no recognized alias']) {
    const stages = [stage(), stage([group()], [relation(['other']), relation(['root', 'past'], undefined, name)]), stage([group()])];
    const original = structuredClone(stages);
    const steps = play(stages);
    const [unrelated, owner] = moments(steps, 1);
    assert.deepEqual(unrelated.replayRealizations, []);
    assert.deepEqual(owner.replayRealizations, [group()]);
    assert.deepEqual(completion(steps, 1).replayRealizations, [group()]);
    assert.deepEqual(completion(steps, 2).replayRealizations, [group()]);
    const ordinary = stages.map(({ realizations, ...rest }) => rest);
    assert.deepEqual(geometry(steps), play(ordinary));
    assert.deepEqual(stages, original);
  }
});

test('shared source features do not merge independently owned output moments', () => {
  const stages = [stage(), stage([group(['root', 'past'], [0]), group(['other', 'past'], [1])], [
    relation(['root', 'past']), relation(['other', 'past'])
  ])];
  const [first, second] = moments(play(stages), 1);
  assert.deepEqual(first.replayRealizations, [group(['root', 'past'], [0])]);
  assert.deepEqual(second.replayRealizations, stages[1].realizations);
  assert.deepEqual([first, second].map(step => step.replayRelationIdentity.relationIndex), [0, 1]);
});

test('overlapping outputs change atomically and retired syntax requires exact prior witnesses', () => {
  const before = stage([group(['root'], [0]), group(['other'], [1])]);
  const afterForest = [node('new-domain', [node('result')])];
  const after = stage([group(['result'], [0, 1])], [relation(['result'], ['root', 'other'])], afterForest);
  const steps = play([before, after]);
  assert.deepEqual(moments(steps, 1)[0].replayRealizations, after.realizations);
  const frames = adaptDerivationStagesForReplay([before, after]);
  assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, 0);
  frames[1].relations[0].priorAnchors = { participants: ['same-lineage-but-wrong-id'] };
  const unresolved = resolveRealizationChanges(frames[0], frames[1], 1);
  assert.equal(unresolved[0].relationIndex, null);
  assert.match(unresolved[0].diagnostic, /REALIZATION_MISSING_OWNER/);
});

test('removed groups and changed input positions respect current or prior exact ownership', () => {
  for (const prior of [undefined, ['root', 'past']]) {
    const stages = [stage([group()]), stage([group(['root', 'past'], [1])], [
      relation(prior ? ['other'] : ['root', 'past'], prior)
    ])];
    const [moment] = moments(play(stages), 1);
    if (prior) {
      assert.deepEqual(moment.replayRealizations, [], 'prior witnesses retire the old group but do not establish current output');
      assert.match(moment.replayRealizationDiagnostics.join('\n'), /REALIZATION_MISSING_OWNER/);
    } else assert.deepEqual(moment.replayRealizations, stages[1].realizations);
    assert.deepEqual(completion(play(stages), 1).replayRealizations, stages[1].realizations);
  }
  const steps = play([stage([group()]), stage(undefined, [relation(['root', 'past'])])]);
  assert.deepEqual(moments(steps, 1)[0].replayRealizations, []);
  assert.deepEqual(completion(steps, 1).replayRealizations, []);
});

test('missing or ambiguous timing remains inspection evidence rather than an invented relation moment', () => {
  for (const relations of [[], [relation(['other'])], [relation(['root', 'past']), relation(['root', 'past'])]]) {
    const stages = [stage(), stage([group()], relations)];
    const steps = play(stages);
    const current = steps.filter(step => step.replayFrameIndex === 1);
    assert.equal(moments(steps, 1).length, relations.length);
    current.filter(step => step.replayKind !== 'macro').forEach(step => assert.deepEqual(step.replayRealizations, []));
    const macro = completion(steps, 1);
    assert.deepEqual(macro.replayRealizations, [group()]);
    assert.match(macro.replayRealizationDiagnostics.join('\n'), relations.length === 2 ? /AMBIGUOUS_OWNER/ : /MISSING_OWNER/);
    for (const step of current) {
      assert.deepEqual(buildReplayPanelContent(step, stages),
        buildReplayPanelContent({ ...step, replayRealizationDiagnostics: undefined }, stages));
    }
  }
});

test('realizations survive stage, frame and snapshot projections without mutating the authored record', () => {
  const stages = [stage([group()], [relation(['root', 'past'])])];
  const original = structuredClone(stages);
  const frames = adaptDerivationStagesForReplay(stages);
  const plan = buildDerivationReplayPlan({ derivationStages: stages });
  assert.deepEqual(frames[0].after.realizations, stages[0].realizations);
  assert.deepEqual(plan.stages[0].realizations, stages[0].realizations);
  assert.deepEqual(plan.stages[0].macroStep.realizations, stages[0].realizations);
  const snapshot = buildReplaySnapshotProjection(bundle(stages));
  assert.deepEqual(snapshot.steps.at(-1).replayRealizations, stages[0].realizations);
  frames[0].after.realizations[0].nodeIds.push('not-authored');
  plan.stages[0].realizations[0].tokenIndices.push(2);
  snapshot.steps.at(-1).replayRealizations[0].nodeIds.push('not-authored');
  assert.deepEqual(stages, original);
  const ordinary = buildReplaySnapshotProjection(bundle([stage()]));
  assert.ok(ordinary.steps.every(step => !Object.hasOwn(step, 'replayRealizations')));
});

test('missing relation moments and unavailable participants cannot introduce a realization early', () => {
  const retiring = [stage([group()]), stage([], [relation([], ['root', 'past'])])];
  const steps = play(retiring);
  assert.equal(moments(steps, 1).length, 0);
  assert.match(completion(steps, 1).replayRealizationDiagnostics.join('\n'), /OWNER_MOMENT_UNAVAILABLE/);
  assert.deepEqual(completion(steps, 1).replayRealizations, []);

  const stages = [stage(), stage([group()], [relation(['root', 'past'])])];
  const frames = adaptDerivationStagesForReplay(stages);
  const raw = moments(play(stages), 1)[0];
  const [unavailable] = attachReplayRealizations([{ ...raw, replayVisibleNodeIds: ['root'] }], frames);
  assert.deepEqual(unavailable.replayRealizations, []);
  assert.match(unavailable.replayRealizationDiagnostics.join('\n'), /PARTICIPANT_UNAVAILABLE.*past/);
});

test('a source domain is not realized while a current authored descendant is still pending', () => {
  const before = [node('domain', [node('root')]), node('other')];
  const after = [node('domain', [node('root'), node('past')]), node('other')];
  const stages = [stage(undefined, [], before), stage([group(['domain'])], [
    relation(['domain']), relation(['past'], ['other'])
  ], after)];
  const steps = play(stages);
  const [early, later] = moments(steps, 1);
  assert.ok(early.replayVisibleNodeIds.includes('domain'));
  assert.ok(!early.replayVisibleNodeIds.includes('past'));
  assert.deepEqual(early.replayRealizations, []);
  assert.match(early.replayRealizationDiagnostics.join('\n'), /PARTICIPANT_UNAVAILABLE.*past/);
  assert.ok(later.replayVisibleNodeIds.includes('past'));
  assert.deepEqual(later.replayRealizations, [], 'a different later relation does not become the owner');
  assert.deepEqual(completion(steps, 1).replayRealizations, stages[1].realizations);
  assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...rest }) => rest)));

  const displaced = structuredClone(later);
  displaced.replayCanvasData = node('workspace', [node('domain', [node('root')]), node('other', [node('past')])]);
  displaced.replayRelationIdentity = early.replayRelationIdentity;
  const [outsideDomain] = attachReplayRealizations([displaced], adaptDerivationStagesForReplay(stages));
  assert.deepEqual(outsideDomain.replayRealizations, [], 'a descendant visible outside the source is not part of its completed domain');
  assert.match(outsideDomain.replayRealizationDiagnostics.join('\n'), /PARTICIPANT_UNAVAILABLE.*past/);
});

test('realization visibility follows exact authored IDs through the existing display allocator', () => {
  for (const id of [' root ', 'with internal spaces']) for (const lexical of [false, true]) {
    const sourceForest = lexical
      ? [node('domain', [{ id, label: 'walk', word: 'walk' }, node('past')])]
      : [node(id)];
    const stages = [stage(undefined, [], sourceForest), stage([group([id])], [relation([id])], sourceForest)];
    const [moment] = moments(play(stages), 1);
    assert.deepEqual(moment.replayRealizations, stages[1].realizations);
    assert.equal(moment.replayRealizationDiagnostics, undefined);
    assert.deepEqual(completion(play(stages), 1).replayRealizations[0].nodeIds, [id]);
  }
  const sourceForest = [node('domain', [{ id: ' root ', label: 'walk', word: 'walk' },
    { id: 'root', label: 'ed', word: 'ed' }])];
  const stages = [stage(undefined, [], sourceForest), stage([group([' root ', 'root'])], [
    relation([' root ', 'root'])
  ], sourceForest)];
  assert.deepEqual(moments(play(stages), 1)[0].replayRealizations, stages[1].realizations);
});

test('realization records require the original input instead of guessing it from morpheme leaves', () => {
  const record = bundle([stage([group()])]);
  delete record.sentence;
  assert.throws(() => buildReplayPlayback(record), /requires the original input sentence/);
  const ordinary = { analyses: [{ tree: { id: 'walked', label: 'V', word: 'walked' }, derivationStages: [] }] };
  assert.equal(buildReplayPlayback(ordinary).sentence, 'walked');
});
