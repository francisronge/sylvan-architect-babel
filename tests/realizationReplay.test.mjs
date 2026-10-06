import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { adaptDerivationStagesForReplay, buildReplayPanelContent } from '../replay/replayCompiler.ts';
import { buildReplayPlayback, buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { attachReplayRealizations, resolveRealizationChanges } from '../replay/realizationReplay.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

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
const play = (stages, inputTokens) => buildReplayPlayback({ ...bundle(stages),
  ...(inputTokens ? { sentence: inputTokens.join(' '), inputTokens } : {}) }).steps;
const moments = (steps, stageIndex) => steps.filter(step => step.replayFrameIndex === stageIndex && step.replayKind === 'relation');
const completion = (steps, stageIndex) => steps.find(step => step.replayFrameIndex === stageIndex && step.replayKind === 'macro');
const geometry = steps => steps.map(({ replayRealizations, replayRealizationDiagnostics, ...step }) => step);
const assertPreservedResidual = (stages, stageIndex, relationIndex, key) => {
  const frames = adaptDerivationStagesForReplay(stages);
  const relation = stages[stageIndex].relations[relationIndex];
  const dispatch = dispatchRelationClaims({ relation, stageIndex, relationIndex,
    currentForest: frames[stageIndex].workspaceForest, priorForest: frames[stageIndex - 1]?.workspaceForest,
    currentRealizations: frames[stageIndex].after.realizations, priorRealizations: frames[stageIndex - 1]?.after.realizations });
  assert.deepEqual(dispatch.evidenceCoverage.authoredRelation, relation);
  assert(dispatch.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(ref => ref.field === 'values' && ref.key === key)),
    `neutral residual ${key} remains available for inspection`);
};

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

test('ambiguous realization descriptions never win by wording or list order', () => {
  for (const names of [['Inflection', 'Case preservation'], ['Case preservation', 'Inflection'], ['形態', 'تحقق']]) {
    const relations = names.map(name => relation(['root', 'past'], undefined, name));
    const stages = [stage(), stage([group()], relations)];
    const original = structuredClone(stages), steps = play(stages);
    assert(moments(steps, 1).every(step => step.replayRealizations.length === 0));
    assert.deepEqual(completion(steps, 1).replayRealizations, [group()]);
    assert.deepEqual(stages, original);
  }
});

test('a stem change and its input-token association remain distinct claims with explicit timing evidence', () => {
  const beforeForest = [{ id: 'root', label: 'V', word: '書く' }, { id: 'past', label: 'T', word: 'た' }];
  const afterForest = [{ id: 'root', label: 'V', word: '書い' }, { id: 'past', label: 'T', word: 'た' }];
  const stages = [stage(undefined, [], beforeForest), stage([group(['root'], [0, 1])], [
    { relation: 'Past-conditioned stem allomorphy', anchors: { stem: 'root', conditioner: 'past' },
      priorAnchors: { lexicalForm: 'root' },
      values: { lexicalCitationForm: '書く', surfaceStem: '書い' } },
    { relation: 'Orthographic input association', anchors: { stem: 'root' },
      values: { inputPiecesInOrder: ['書', 'い'] } }
  ], afterForest)];
  const before = structuredClone(stages), frames = adaptDerivationStagesForReplay(stages);
  const [change] = resolveRealizationChanges(frames[0], frames[1], 1, ['書', 'い']);
  assert.equal(change.relationIndex, 1, 'the input sequence owns token association, not the earlier spelling rewrite');
  assert.equal(change.diagnostic, undefined);
  const steps = play(stages, ['書', 'い']);
  assert.deepEqual(moments(steps, 1).map(step => step.replayRelationIdentity.relationIndex), [0, 1]);
  assert.deepEqual(moments(steps, 1)[0].replayRealizations, []);
  assert.deepEqual(moments(steps, 1)[1].replayRealizations, stages[1].realizations);
  assert.deepEqual(completion(steps, 1).replayRealizations, stages[1].realizations);
  assert.deepEqual(stages, before);
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

test('multiple descriptions of one stem do not fabricate a unique realization moment', () => {
  const stemForest = [{ id: 'stem', label: 'V', word: '読ん' }];
  const association = group(['stem'], [0, 1]);
  const stages = [stage(undefined, [], stemForest), stage([association], [
    { relation: 'Morphological realization', anchors: { stem: 'stem' }, values: { stemAllomorph: '読ん' } },
    { relation: 'One stem across input pieces', anchors: { stem: 'stem' }, values: { inputPieces: ['読', 'ん'] } },
    { relation: 'Chain licensing', anchors: { antecedentGovernor: 'stem' } },
    { relation: 'Case preservation', anchors: { chain: ['stem'] } }
  ], stemForest)];
  const original = structuredClone(stages);
  const steps = play(stages);
  for (const moment of moments(steps, 1)) {
    assert.deepEqual(moment.replayRealizations, []);
    assert(moment.replayRealizationDiagnostics.some(d => d.includes('REALIZATION_AMBIGUOUS_OWNER')));
  }
  assert.deepEqual(completion(steps, 1).replayRealizations, [association]);
  assert.deepEqual(stages, original);
});

const collectivePFStages = () => {
  const syntax = [{ id: 'clause', label: 'IP', children: [
    { id: 'subject', label: 'NP', word: 'someone' },
    { id: 'past', label: 'I', word: '-ed' },
    { id: 'root', label: 'V', word: 'walk' },
    { id: 'object', label: 'NP', word: 'home' }
  ] }];
  return [stage(undefined, [], syntax), stage([group()], [
    { relation: 'finite past-tense realization', anchors: { pastSuffix: 'past', stem: 'root' },
      values: { surfaceWord: 'walked' } },
    { relation: 'Case licensing', anchors: {
      nominativeLicensor: 'past', nominativeRecipient: 'subject',
      objectiveLicensor: 'root', objectiveRecipient: 'object'
    } }
  ], syntax)];
};

test('an exact collective PF owner is not made ambiguous by Case claims sharing its heads', () => {
  for (const name of ['finite past-tense realization', 'An unfamiliar output operation']) {
    const stages = collectivePFStages();
    stages[1].relations[0].relation = name;
    const original = structuredClone(stages), frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, 0);
    const steps = play(stages), [pf, caseMoment] = moments(steps, 1);
    assert.deepEqual(pf.replayRealizations, stages[1].realizations);
    assert.deepEqual(caseMoment.replayRealizations, stages[1].realizations);
    assert.equal(pf.replayRealizationDiagnostics, undefined);
    assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...s }) => s)));
    assert.deepEqual(stages, original);
  }
});

test('collective PF ownership keeps competing PF claims and unproved participant roles ambiguous', () => {
  for (const mode of ['second PF', 'unknown role', 'unrecovered PF value', 'no PF literal', 'wrong group']) {
    const stages = collectivePFStages(), current = stages[1];
    if (mode === 'second PF') current.relations.push(structuredClone(current.relations[0]));
    if (mode === 'unknown role') current.relations[1].anchors.additionalParticipant = 'root';
    if (mode === 'unrecovered PF value') current.relations[1].values = { surfaceWord: 'another form' };
    if (mode === 'no PF literal') delete current.relations[0].values;
    if (mode === 'wrong group') current.realizations = [group(['root'])];
    const frames = adaptDerivationStagesForReplay(stages);
    const [change] = resolveRealizationChanges(frames[0], frames[1], 1);
    assert.equal(change.relationIndex, null, mode);
    assert.match(change.diagnostic, /REALIZATION_AMBIGUOUS_OWNER/, mode);
    for (const moment of moments(play(stages), 1)) assert.deepEqual(moment.replayRealizations, [], mode);
  }
});

test('exact PF outputs own changed association while a Case context retains its own moment', () => {
  const stages = collectivePFStages();
  stages[0].realizations = [group(['root'])];
  const frames = adaptDerivationStagesForReplay(stages), [change] = resolveRealizationChanges(frames[0], frames[1], 1);
  assert.equal(change.relationIndex, 0);
  assert.equal(change.diagnostic, undefined);
  assert.deepEqual(moments(play(stages), 1).map(moment => moment.replayRelationIdentity.relationIndex), [0, 1]);
});


const movedRealizationStages = () => {
  const lower = { id: 'lower', label: 'DP', lineageId: 'phrase-chain', children: [
    { id: 'articleLow', label: 'D', lineageId: 'article-chain', word: 'a' },
    { id: 'nounLow', label: 'N', lineageId: 'noun-chain', word: 'b' }
  ] };
  const prior = [{ id: 'predicate', label: 'VP', children: [lower, { id: 'verb', label: 'V', word: 'c' }] }];
  const upper = structuredClone(lower); upper.id = 'upper'; upper.children.forEach(n => { n.id = n.id.replace('Low', 'High'); });
  const current = [{ id: 'clause', label: 'TP', children: [upper, { id: 'bar', label: 'T′', children: [{ id: 'head', label: 'T' }, structuredClone(prior[0])] }] }];
  current[0].children[1].children[1].children[0].children.forEach(n => { n.silent = true; });
  const r = { relation: 'An open label', anchors: { higherOccurrence: 'upper', lowerOccurrence: 'lower' }, priorAnchors: { sourceOccurrence: 'lower' } };
  return [stage([group(['articleLow', 'nounLow'])], [], prior), stage([group(['nounHigh', 'articleHigh'])], [r], current)];
};

test('one proven movement owns the complete realization transfer through exact descendant identities', () => {
  for (const rename of [false, true]) {
    const stages = movedRealizationStages();
    if (rename) {
      const ids = x => `opaque-${x}`;
      for (const s of stages) {
        const visit = n => { n.id = ids(n.id); if(n.lineageId)n.lineageId=ids(n.lineageId); n.children?.forEach(visit); };
        s.workspaceForest.forEach(visit); s.realizations.forEach(g => { g.nodeIds=g.nodeIds.map(ids).reverse(); });
        s.relations.forEach(r => { r.relation='Another completely unrelated name'; for(const field of ['anchors','priorAnchors'])r[field]=Object.fromEntries(Object.entries(r[field]).reverse().map(([k,v])=>[k,ids(v)])); });
      }
    }
    const original = structuredClone(stages), frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, 0);
    const steps = play(stages), index = steps.findIndex(s=>s.replayRelationIdentity?.stageIndex===1);
    assert.deepEqual(steps[index-1].replayRealizations, stages[0].realizations);
    assert.deepEqual(steps[index].replayRealizations, stages[1].realizations);
    assert(!steps[index].replayRealizationDiagnostics?.length);
    assert.deepEqual(stages, original);
  }
});

test('descendant realization ownership rejects competing moments, unmatched members, and unrelated outputs', () => {
  for (const change of [
    ss => { ss[1].relations.push(structuredClone(ss[1].relations[0])); },
    ss => { delete ss[1].workspaceForest[0].children[0].children[0].lineageId;
      ss[1].workspaceForest[0].children[0].children[0].word = 'changed'; },
    ss => { ss[1].workspaceForest[0].children[0].children[0].lineageId = 'noun-chain'; },
    ss => { ss[1].realizations[0].nodeIds = ['nounHigh']; },
    ss => { ss[1].realizations[0].nodeIds = ['nounHigh', 'verb']; },
    ss => { ss[1].realizations[0].tokenIndices = [1]; }
  ]) {
    const stages = movedRealizationStages(); change(stages);
    const frames = adaptDerivationStagesForReplay(stages);
    assert(resolveRealizationChanges(frames[0], frames[1], 1).every(change=>change.relationIndex===null));
    assert.deepEqual(moments(play(stages),1)[0].replayRealizations,stages[0].realizations);
  }
});

const directMovedAssociation = () => ({
  relation: 'An independently authored association',
  anchors: { currentContributors: ['nounHigh', 'articleHigh'] },
  priorAnchors: { earlierContributors: ['articleLow', 'nounLow'] }
});

test('complete direct realization evidence takes precedence over inferred movement continuity', () => {
  for (const renamed of [false, true]) {
    const stages = movedRealizationStages();
    stages[1].relations.push(directMovedAssociation());
    if (renamed) {
      const rename = id => `opaque/${id}`;
      for (const s of stages) {
        const visit = n => { n.id = rename(n.id); if (n.lineageId) n.lineageId = rename(n.lineageId); n.children?.forEach(visit); };
        s.workspaceForest.forEach(visit);
        s.realizations.forEach(g => { g.nodeIds = g.nodeIds.map(rename).reverse(); });
        s.relations.forEach((r, index) => {
          r.relation = index ? 'Unfamiliar description B' : 'Unfamiliar description A';
          for (const field of ['anchors', 'priorAnchors']) {
            r[field] = Object.fromEntries(Object.entries(r[field]).reverse().map(([key, value]) => [
              index ? `opaque ${field}` : key,
              Array.isArray(value) ? value.map(rename).reverse() : rename(value)
            ]));
          }
        });
      }
    }
    const original = structuredClone(stages);
    const frames = adaptDerivationStagesForReplay(stages);
    const [change] = resolveRealizationChanges(frames[0], frames[1], 1);
    assert.equal(change.relationIndex, 1);
    assert.equal(change.diagnostic, undefined);
    const steps = play(stages), [movement, explicit] = moments(steps, 1);
    assert.deepEqual(movement.replayRealizations, stages[0].realizations);
    assert.deepEqual(explicit.replayRealizations, stages[1].realizations);
    assert.equal(explicit.replayRealizationDiagnostics, undefined);
    assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...s }) => s)));
    assert.deepEqual(stages, original);
  }
});

test('competing direct owners stay ambiguous without including weaker movement candidates', () => {
  const stages = movedRealizationStages();
  stages[1].relations.push(directMovedAssociation(), {
    ...directMovedAssociation(), relation: 'Another directly covering claim'
  });
  const frames = adaptDerivationStagesForReplay(stages);
  const [change] = resolveRealizationChanges(frames[0], frames[1], 1);
  assert.equal(change.relationIndex, null);
  assert.deepEqual(change.candidateRelationIndices, [1, 2]);
  assert.match(change.diagnostic, /Relations 2, 3 cover the same change/);
  const steps = play(stages);
  for (const moment of moments(steps, 1)) assert.deepEqual(moment.replayRealizations, stages[0].realizations);
  assert.deepEqual(completion(steps, 1).replayRealizations, stages[1].realizations);
});

test('inferred movement owners compete only when no complete direct coverage exists', () => {
  const stages = movedRealizationStages();
  stages[1].relations.push(structuredClone(stages[1].relations[0]));
  const partial = directMovedAssociation();
  partial.anchors.currentContributors = ['nounHigh'];
  stages[1].relations.push(partial);
  const frames = adaptDerivationStagesForReplay(stages);
  const [change] = resolveRealizationChanges(frames[0], frames[1], 1);
  assert.equal(change.relationIndex, null);
  assert.deepEqual(change.candidateRelationIndices, [0, 1]);
  assert.match(change.diagnostic, /Relations 1, 2 cover the same change/);
  stages[1].relations.pop();
  stages[1].relations.push(directMovedAssociation());
  const completeFrames = adaptDerivationStagesForReplay(stages);
  assert.equal(resolveRealizationChanges(completeFrames[0], completeFrames[1], 1)[0].relationIndex, 2);
});

test('a direct owner before its participants become available defers instead of falling back to movement', () => {
  const stages = movedRealizationStages();
  stages[1].relations.unshift(directMovedAssociation());
  const frames = adaptDerivationStagesForReplay(stages);
  assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, 0);
  const steps = play(stages), [early, movement] = moments(steps, 1);
  assert.deepEqual(early.replayRealizations, stages[0].realizations);
  assert.match(early.replayRealizationDiagnostics.join('\n'), /REALIZATION_PARTICIPANT_UNAVAILABLE/);
  assert.deepEqual(movement.replayRealizations, stages[0].realizations);
  assert.deepEqual(completion(steps, 1).replayRealizations, stages[1].realizations);
});

test('direct ownership requires uniquely resolving current and prior occurrence IDs', () => {
  for (const duplicatePrior of [false, true]) {
    const stages = movedRealizationStages();
    stages[1].relations.push(directMovedAssociation());
    const s = stages[duplicatePrior ? 0 : 1];
    s.workspaceForest.push({ id: duplicatePrior ? 'articleLow' : 'articleHigh', label: 'D', word: 'a' });
    const frames = adaptDerivationStagesForReplay(stages);
    const [change] = resolveRealizationChanges(frames[0], frames[1], 1);
    assert.equal(change.relationIndex, null);
    assert.match(change.diagnostic, /REALIZATION_MISSING_OWNER/);
  }
});

const pronunciationStages = () => {
  const stages = movedRealizationStages();
  const old = stages[0].workspaceForest[0].children[0];
  const upper = stages[1].workspaceForest[0].children[0];
  const lower = stages[1].workspaceForest[0].children[1].children[1].children[0];
  for (const n of [old, upper, lower]) { n.children = []; n.word = 'ab'; }
  lower.silent = true;
  stages[0].realizations = [group(['lower'], [0, 1])];
  stages[1].realizations = [group(['upper'], [0, 1])];
  stages[1].relations.push({ relation: 'An open description',
    anchors: { pronounced: 'upper', unpronounced: 'lower' },
    priorAnchors: { previouslyRealized: 'lower' }, values: { inputTokens: ['a', 'b'] } });
  return stages;
};

test('an explicit pronunciation transfer follows its own moment after movement', () => {
  for (const aliases of [false, true]) {
    const stages = pronunciationStages();
    if (aliases) stages[1].relations[1].anchors = { pronouncedOccurrence: 'upper', unpronouncedCopy: 'lower' };
    const original = structuredClone(stages), frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, ['a', 'b'])[0].relationIndex, 1);
    const steps = play(stages, ['a', 'b']), [movement, pronunciation] = moments(steps, 1);
    assert.deepEqual(movement.replayRealizations, stages[0].realizations);
    assert.deepEqual(pronunciation.replayRealizations, stages[1].realizations);
    assert.equal(pronunciation.replayRealizationDiagnostics, undefined);
    assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...rest }) => rest), ['a', 'b']));
    assert.deepEqual(stages, original);
  }
});

test('pronunciation transfer cannot choose between competing, contradictory or incomplete declarations', () => {
  for (const [index, mutate] of [
    stages => stages[1].relations.push(structuredClone(stages[1].relations[1])),
    stages => { stages[1].relations[1].anchors.pronounced = 'lower'; },
    stages => { stages[1].relations[1].anchors.unpronounced = 'head'; },
    stages => { stages[1].relations[1].values.status = 'pending'; },
    stages => { stages[1].relations[1].relation = 'Possible copy pronunciation'; },
    stages => { delete stages[1].workspaceForest[0].children[0].lineageId; },
    stages => { stages[1].workspaceForest[0].children[0].silent = true; },
    stages => { stages[1].realizations[0].tokenIndices = [1]; }
  ].entries()) {
    const stages = pronunciationStages(); mutate(stages);
    const frames = adaptDerivationStagesForReplay(stages);
    const changes = resolveRealizationChanges(frames[0], frames[1], 1, ['a', 'b']);
    assert(changes.every(change => change.relationIndex !== 1), `unsupported pronunciation control ${index}`);
    if (index === 0) assert(changes.every(change => change.relationIndex === null), 'two complete declarations cannot choose an owner');
  }
});

test('an exact PF output wins over its conditioner role in another PF claim', () => {
  const syntax = [{ id: 'verb', label: 'V', word: 'read' }, { id: 'neg', label: 'Neg', word: 'not' },
    { id: 'past', label: 'T', word: 'past' }];
  const relations = [
    { relation: 'contextual verbal allomorphy', anchors: { conditioner: 'neg', verb: 'verb' }, values: { realization: 'read form' } },
    { relation: 'contextual negative allomorphy', anchors: { conditioner: 'past', negative: 'neg' }, values: { realization: 'negative form' } }
  ];
  for (const reverse of [false, true]) {
    const stages = [stage(undefined, [], syntax), stage([group(['verb'], [0]), group(['neg'], [1])],
      reverse ? [...relations].reverse() : relations, syntax)];
    const frames = adaptDerivationStagesForReplay(stages), changes = resolveRealizationChanges(frames[0], frames[1], 1);
    assert.deepEqual(changes.map(change => change.relationIndex), reverse ? [1, 0] : [0, 1]);
    const steps = play(stages);
    assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...rest }) => rest)));
    assert.equal(moments(steps, 1).length, 2);
  }
  for (const key of ['pronunciation', 'unexplainedAssertion']) {
    const mixed = structuredClone(relations);
    mixed[0].values[key] = 'a separately authored assertion';
    const stages = [stage(undefined, [], syntax), stage([group(['neg'], [1])], mixed, syntax)];
    const frames = adaptDerivationStagesForReplay(stages);
    const [change] = resolveRealizationChanges(frames[0], frames[1], 1);
    assert.equal(change.relationIndex, key === 'pronunciation' ? null : 1, `mixed conditioner claim: ${key}`);
    if (key === 'pronunciation') assert.deepEqual(change.candidateRelationIndices, [0, 1]);
    else assertPreservedResidual(stages, 1, 0, key);
  }
});

test('one token list cannot override a second genuine PF association for the same output', () => {
  for (const inputKey of ['inputParts', 'inputPieces', 'inputPiecesInOrder', 'inputTokens']) {
    const syntax = [{ id: 'stem', label: 'D', word: 'ab' }];
    const stages = [stage(undefined, [], syntax), stage([group(['stem'], [0, 1])], [
      { relation: 'Morphological realization', anchors: { stem: 'stem' }, values: { surfaceForm: 'ab' } },
      { relation: 'Lexical input association', anchors: { determiner: 'stem' }, values: { lexicalForm: 'ab', [inputKey]: ['a', 'b'] } }
    ], syntax)];
    let frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, ['a', 'b'])[0].relationIndex, null);
    stages[1].relations[0].values[inputKey] = ['a', 'b'];
    frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, ['a', 'b'])[0].relationIndex, null);
    stages[1].relations[0].values[inputKey] = ['a'];
    stages[1].relations[1].values[inputKey] = ['a'];
    frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, ['a', 'b'])[0].relationIndex, null, 'wrong token counts cannot prioritize either PF claim');
  }
});

test('neutral residual prose does not invent PF ownership for recovered non-PF participants', () => {
  for (const key of ['unexplainedAssertion', 'pronunciation', 'interpretation']) {
    const stages = collectivePFStages();
    stages[1].relations[1].values = { [key]: 'an independently authored assertion' };
    const original = structuredClone(stages), frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, key === 'pronunciation' ? null : 0);
    assertPreservedResidual(stages, 1, 1, key);
    assert.deepEqual(moments(play(stages), 1).map(step => step.replayRelationIdentity.relationIndex), [0, 1]);
    assert.deepEqual(stages, original);
  }
  for (const values of [
    { pronunciation: 'a separate pronunciation assertion' },
    { operation: 'a separate pronunciation assertion' },
    { unexplainedAssertion: [] }
  ]) {
    const stages = pronunciationStages();
    stages[1].relations[0].values = values;
    const frames = adaptDerivationStagesForReplay(stages);
    const [change] = resolveRealizationChanges(frames[0], frames[1], 1, ['a', 'b']);
    assert.equal(change.relationIndex, 'pronunciation' in values ? null : 1, `mixed movement assertion: ${JSON.stringify(values)}`);
    if ('pronunciation' in values) assert.deepEqual(change.candidateRelationIndices, [0, 1]);
    assertPreservedResidual(stages, 1, 0, Object.keys(values)[0]);
  }
});

test('unknown relevant roles and malformed exact claims still compete with a proved PF association', () => {
  for (const [index, mutate] of [
    relation => { relation.anchors.unexplainedParticipant = ['lower', 'upper']; },
    relation => { relation.relation = 'Agree'; relation.anchors = { probe: 'lower', extraContext: 'upper' }; },
    relation => { relation.values = { inputTokens: ['wrong', 'tokens'] }; },
    relation => { relation.anchors.pronounced = 'lower'; }
  ].entries()) {
    const stages = pronunciationStages(); mutate(stages[1].relations[0]);
    const frames = adaptDerivationStagesForReplay(stages);
    const [change] = resolveRealizationChanges(frames[0], frames[1], 1, ['a', 'b']);
    assert.equal(change.relationIndex, null, `unproved owner control ${index}`);
    assert.deepEqual(change.candidateRelationIndices, [0, 1]);
  }
});

test('a malformed exact claim cannot gain ownership through independent PF or pronunciation evidence', () => {
  for (const [stages, owner, inputTokens] of [
    [pronunciationStages(), 1, ['a', 'b']],
    [collectivePFStages(), 0, undefined]
  ]) {
    stages[1].relations[owner].relation = 'Agree';
    const frames = adaptDerivationStagesForReplay(stages);
    const [change] = resolveRealizationChanges(frames[0], frames[1], 1, inputTokens);
    assert.equal(change.relationIndex, null);
    assert.deepEqual(change.candidateRelationIndices, [0, 1]);
  }
});

test('token sequence priority requires exact saved token content and order', () => {
  const syntax = [{ id: 'stem', label: 'V', word: '書い' }, { id: 'past', label: 'T', word: 'た' }];
  const prior = structuredClone(syntax); prior[0].word = '書く';
  const stages = [stage(undefined, [], prior), stage([group(['stem'], [0, 1])], [
    { relation: 'Past-conditioned stem allomorphy', anchors: { stem: 'stem', conditioner: 'past' },
      priorAnchors: { lexicalForm: 'stem' },
      values: { lexicalCitationForm: '書く', surfaceStem: '書い' } },
    { relation: 'Orthographic input association', anchors: { stem: 'stem' }, values: { inputPiecesInOrder: ['書', 'い'] } }
  ], syntax)];
  const frames = adaptDerivationStagesForReplay(stages);
  for (const tokens of [undefined, ['wrong', 'tokens'], ['い', '書'], ['書']]) {
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, tokens)[0].relationIndex, null);
  }
  assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, ['書', 'い'])[0].relationIndex, 1);
  for (const key of ['pronunciation', 'unexplainedAssertion']) {
    const mixed = structuredClone(stages);
    mixed[1].relations[0].values[key] = 'a separately authored assertion';
    const mixedFrames = adaptDerivationStagesForReplay(mixed);
    const [change] = resolveRealizationChanges(mixedFrames[0], mixedFrames[1], 1, ['書', 'い']);
    assert.equal(change.relationIndex, key === 'pronunciation' ? null : 1, `mixed spelling rewrite: ${key}`);
    if (key === 'pronunciation') assert.deepEqual(change.candidateRelationIndices, [0, 1]);
    else assertPreservedResidual(mixed, 1, 0, key);
  }
});

const copiedRealizationStages = () => {
  const stages = movedRealizationStages();
  for (const stage of stages) {
    const clearChildren = n => { if (!['lower', 'upper'].includes(n.id)) delete n.lineageId; n.children?.forEach(clearChildren); };
    stage.workspaceForest.forEach(clearChildren);
  }
  return stages;
};

test('a uniquely copied subtree carries renamed realization contributors without individual lineage fields', () => {
  const stages = copiedRealizationStages(), original = structuredClone(stages);
  const frames = adaptDerivationStagesForReplay(stages);
  assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, 0);
  const steps = play(stages);
  assert.deepEqual(moments(steps, 1)[0].replayRealizations, stages[1].realizations);
  assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...rest }) => rest)));
  assert.deepEqual(stages, original);
});

test('subtree correspondence rejects repeated unproved positions, changed content, topology and contradictory lineage', () => {
  for (const mutate of [
    stages => { stages[1].workspaceForest[0].children[0].children[0].word = 'different'; },
    stages => { stages[1].workspaceForest[0].children[0].children.reverse(); },
    stages => { stages[1].workspaceForest[0].children[0].children[0].children = [{ id: 'new', label: 'N', word: 'a' }]; },
    stages => { stages[0].workspaceForest[0].children[0].children[0].lineageId = 'one';
      stages[1].workspaceForest[0].children[0].children[0].lineageId = 'two'; },
    stages => { const old = stages[0].workspaceForest[0].children[0], next = stages[1].workspaceForest[0].children[0];
      for (const root of [old, next]) for (const child of root.children) { child.word = 'same'; child.label = 'N'; } },
    stages => { stages[1].workspaceForest.push(structuredClone(stages[1].workspaceForest[0].children[0].children[0])); }
  ]) {
    const stages = copiedRealizationStages(); mutate(stages);
    const frames = adaptDerivationStagesForReplay(stages);
    assert(resolveRealizationChanges(frames[0], frames[1], 1).every(change => change.relationIndex === null));
  }
});

const receivingHostStages = (hostAlreadyNamed = false) => {
  const oldHead = { id: 'tense', label: 'I⁰', ...(hostAlreadyNamed ? { word: '-ed' } : {}) };
  const prior = [{ id: 'clause', label: 'IP', children: [
    { id: 'vp', label: 'VP', children: [{ id: 'verbLow', label: 'V⁰', lineageId: 'verb-chain', word: 'walk' }] }, oldHead
  ] }];
  const current = [{ id: 'clause', label: 'IP', children: [
    { id: 'vp', label: 'VP', children: [{ id: 'trace', label: 'V⁰', lineageId: 'verb-chain', silent: true }] },
    { id: 'complex', label: 'I⁰', children: [
      { id: 'verbHigh', label: 'V⁰', lineageId: 'verb-chain', word: 'walk' }, { ...oldHead, word: '-ed' }
    ] }
  ] }];
  return [stage(undefined, [], prior), stage([group(['verbHigh', 'tense'])], [
    { relation: 'An authored head operation', anchors: { raisedHead: 'verbHigh', sourceTrace: 'trace',
      ...(hostAlreadyNamed ? { targetHead: 'tense', resultingComplexHead: 'complex' }
        : { landingHead: 'complex', inflectionalHost: 'tense' }) },
      priorAnchors: { sourceHead: 'verbLow', targetHead: 'tense' } },
    { relation: 'Morphological realization', anchors: { complexHead: 'complex', stem: 'verbHigh', inflection: 'tense' },
      values: { surfaceWord: 'walked' } }
  ], current)];
};

test('an exact retained receiving head and its prior occurrence are context of the proved movement', () => {
  for (const named of [false, true]) {
    const stages = receivingHostStages(named), original = structuredClone(stages);
    const frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, 1);
    const steps = play(stages), relationMoments = moments(steps, 1);
    assert.deepEqual(relationMoments.map(s => s.replayRelationIdentity.relationIndex), [0, 1]);
    assert.deepEqual(relationMoments[0].replayRealizations, []);
    assert.deepEqual(relationMoments[1].replayRealizations, stages[1].realizations);
    assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...s }) => s)));
    assert.deepEqual(stages, original);
  }
});

test('receiving-head continuity rejects changed identity, structure, slot, competing hosts and unknown participants', () => {
  const currentHead = stages => stages[1].workspaceForest[0].children[1].children[1];
  for (const [index, mutate] of [
    stages => { currentHead(stages).lineageId = 'different-host'; },
    stages => { currentHead(stages).tokenIndex = 1; },
    stages => { currentHead(stages).silent = true; },
    stages => { currentHead(stages).label = 'I⁰ [changed]'; },
    stages => { currentHead(stages).children = [{ id: 'extra', label: 'I⁰' }]; },
    stages => { stages[0].workspaceForest[0].children.reverse(); },
    stages => { stages[0].workspaceForest.push(structuredClone(stages[0].workspaceForest[0].children[1])); },
    stages => { stages[1].workspaceForest[0].children[1].children.push({ id: 'otherHost', label: 'I⁰' }); },
    stages => { stages[1].relations[0].anchors.unexplained = ['verbHigh', 'tense']; },
    stages => { stages[1].relations[0].anchors.unexplained = 'tense'; },
    stages => { stages[1].relations[0].priorAnchors.unexplained = 'tense'; },
    stages => { stages[1].workspaceForest[0].lineageId = 'different-parent'; },
    stages => { stages[1].relations[0].values = { pronunciation: 'another independently asserted association' }; }
  ].entries()) {
    const stages = receivingHostStages(); mutate(stages);
    const frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1)[0].relationIndex, null, `receiving host control ${index}`);
  }
});

const rewriteDomainStages = () => {
  const before = [{ id: 'domain', label: 'I⁰', children: [
    { id: 'stem', label: 'V⁰', word: '書く' }, { id: 'tense', label: 'I⁰', word: 'た' }
  ] }];
  const after = structuredClone(before); after[0].children[0].word = '書い';
  return [stage(undefined, [], before), stage([group(['stem'], [0, 1])], [
    { relation: 'Past-conditioned stem allomorphy', anchors: { stem: 'stem', conditioner: 'tense', morphologicalDomain: 'domain' },
      priorAnchors: { lexicalForm: 'stem', conditioner: 'tense' }, values: { lexicalCitationForm: '書く', surfaceStem: '書い' } },
    { relation: 'Orthographic input association', anchors: { stem: 'stem' }, values: { inputPiecesInOrder: ['書', 'い'] } }
  ], after)];
};

test('an unchanged exact rewrite domain does not compete with its separately authored input association', () => {
  const stages = rewriteDomainStages(), original = structuredClone(stages), frames = adaptDerivationStagesForReplay(stages);
  assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, ['書', 'い'])[0].relationIndex, 1);
  const steps = play(stages, ['書', 'い']);
  assert.deepEqual(moments(steps, 1).map(s => s.replayRelationIdentity.relationIndex), [0, 1]);
  assert.deepEqual(moments(steps, 1)[0].replayRealizations, []);
  assert.deepEqual(moments(steps, 1)[1].replayRealizations, stages[1].realizations);
  assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...s }) => s), ['書', 'い']));
  assert.deepEqual(stages, original);
});

test('rewrite-domain context rejects changed or extra contributors, ambiguous wrappers and independent PF assertions', () => {
  for (const [index, mutate] of [
    stages => { for (const s of stages) s.workspaceForest[0].children.push({ id: 'extra', label: 'X⁰', word: 'x' }); },
    stages => { stages[1].workspaceForest[0].children[1].word = 'changed'; },
    stages => { stages[1].workspaceForest[0].children[1].silent = true; },
    stages => { stages[1].workspaceForest[0].children[1].tokenIndex = 9; },
    stages => { stages[1].workspaceForest[0].children.reverse(); },
    stages => { stages[0].workspaceForest.push(structuredClone(stages[0].workspaceForest[0])); },
    stages => { delete stages[1].relations[0].priorAnchors; },
    stages => { stages[1].relations[0].values.pronunciation = 'a separate PF assertion'; },
    stages => { stages[1].relations[0].anchors.output = 'stem'; stages[1].relations[0].values.surfaceForm = '書い'; }
  ].entries()) {
    const stages = rewriteDomainStages(); mutate(stages);
    const frames = adaptDerivationStagesForReplay(stages);
    assert.equal(resolveRealizationChanges(frames[0], frames[1], 1, ['書', 'い'])[0].relationIndex, null, `rewrite domain control ${index}`);
  }
});

const literalAssociationStages = (verbPieces = ['読', 'ま'], negativePieces = ['なか', 'っ']) => {
  const tokens = [...verbPieces, ...negativePieces];
  const syntax = [{ id: 'verb', label: 'V', word: verbPieces.join('') },
    { id: 'neg', label: 'Neg', word: negativePieces.join('') }, { id: 'past', label: 'T', word: 'past' }];
  const relations = [
    { relation: 'contextual verbal allomorphy', anchors: { conditioner: 'neg', verb: 'verb' },
      values: { realization: 'verbal form', inputAssociation: `${syntax[0].word} corresponds collectively to ${verbPieces.join(' and ')}` } },
    { relation: 'contextual negative allomorphy', anchors: { conditioner: 'past', negative: 'neg' },
      values: { realization: 'negative form', inputAssociation: `${syntax[1].word} corresponds collectively to ${negativePieces.join(' and ')}` } }
  ];
  return { tokens, stages: [stage(undefined, [], syntax), stage([
    group(['verb'], verbPieces.map((_, i) => i)), group(['neg'], negativePieces.map((_, i) => i + verbPieces.length))
  ], relations, syntax)] };
};
const negativeAssociation = (stages, tokens) => {
  const frames = adaptDerivationStagesForReplay(stages);
  return resolveRealizationChanges(frames[0], frames[1], 1, tokens)
    .find(change => change.after.some(group => group.nodeIds.includes('neg')));
};

test('a fully corroborated literal association cannot compete for a disjoint conditioner output', () => {
  for (const [verb, neg] of [[['読', 'ま'], ['なか', 'っ']], [['al', 'ph', 'a'], ['be', 'ta']], [['كتب', 'ت'], ['ل', 'ن']]]) {
    for (const reverse of [false, true]) {
      const { stages, tokens } = literalAssociationStages(verb, neg);
      if (reverse) stages[1].relations.reverse();
      const original = structuredClone(stages);
      assert.equal(negativeAssociation(stages, tokens).relationIndex, reverse ? 0 : 1);
      const steps = play(stages, tokens), active = moments(steps, 1);
      assert.equal(active.length, 2);
      const expectedFirst = stages[1].realizations[reverse ? 1 : 0];
      assert.deepEqual(active[0].replayRealizations, [expectedFirst]);
      assert.deepEqual(active[1].replayRealizations, reverse ? [...stages[1].realizations].reverse() : stages[1].realizations);
      assert(active.every(step => !step.replayRealizationDiagnostics?.length));
      assert.deepEqual(geometry(steps), play(stages.map(({ realizations, ...rest }) => rest), tokens));
      assertPreservedResidual(stages, 1, reverse ? 1 : 0, 'inputAssociation');
      assert.deepEqual(stages, original);
    }
  }
});

test('literal association scope requires the complete positive scalar assertion', () => {
  for (const value of [
    '読ま may correspond collectively to 読 and ま',
    '読ま does not correspond collectively to 読 and ま',
    '読ま corresponds collectively to 読 and ま; neg also corresponds to なか and っ',
    '読ま corresponds collectively to 読 and ま if licensed',
    '読ま corresponds collectively to ま and 読',
    '読ま corresponds collectively to 読',
    'unknown corresponds collectively to 読 and ま',
    'なかっ corresponds collectively to なか and っ',
    ['読ま corresponds collectively to 読 and ま'], '', []
  ]) {
    const { stages, tokens } = literalAssociationStages();
    stages[1].relations[0].values.inputAssociation = value;
    assert.equal(negativeAssociation(stages, tokens).relationIndex, null, JSON.stringify(value));
  }
});

test('literal association scope rejects absent, mismatched, overlapping or ambiguous evidence', () => {
  const controls = [
    ['missing tokens', data => { data.tokens = undefined; }],
    ['wrong tokens', data => { data.tokens[0] = 'wrong'; }],
    ['token order', data => { data.tokens.reverse(); }],
    ['duplicate fields', ({ stages }) => { stages[1].relations[0].values['input association'] = stages[1].relations[0].values.inputAssociation; }],
    ['unscoped pronunciation', ({ stages }) => { stages[1].relations[0].values.pronunciation = 'another assertion'; }],
    ['unmapped output', ({ stages }) => { stages[1].realizations.shift(); }],
    ['duplicate mapping', ({ stages }) => { stages[1].realizations.push(structuredClone(stages[1].realizations[0])); }],
    ['overlapping tokens', ({ stages }) => { stages[1].realizations.push(group(['past'], [0])); }],
    ['another mapping for output', ({ stages }) => { stages[1].realizations.push(group(['verb'], [4])); }],
    ['duplicate form', ({ stages }) => { stages[1].workspaceForest.push({ id: 'homograph', label: 'N', word: '読ま' }); }],
    ['duplicate identity', ({ stages }) => { stages[1].workspaceForest.push({ id: 'verb', label: 'V', word: 'other' }); }],
    ['missing output word', ({ stages }) => { delete stages[1].workspaceForest[0].word; }],
    ['nonterminal output', ({ stages }) => { stages[1].workspaceForest[0].children = [node('part')]; }],
    ['different occurrence', ({ stages }) => { stages[1].realizations[0].nodeIds = ['past']; }],
    ['joint output', ({ stages }) => { stages[1].realizations[0].nodeIds.push('past'); }],
    ['duplicate token position', ({ stages }) => { stages[1].realizations[0].tokenIndices = [0, 0]; }],
    ['negative token position', ({ stages }) => { stages[1].realizations[0].tokenIndices = [-1, 0]; }],
    ['fractional token position', ({ stages }) => { stages[1].realizations[0].tokenIndices = [0, 0.5]; }],
    ['unavailable token position', ({ stages }) => { stages[1].realizations[0].tokenIndices = [4, 5]; }],
    ['malformed exact claim', ({ stages }) => { stages[1].relations[0].relation = 'Agree'; }],
    ['unknown affected role', ({ stages }) => { stages[1].relations[0].anchors.anotherRole = 'neg'; }],
    ['genuine competing owner', ({ stages }) => { stages[1].relations.push(structuredClone(stages[1].relations[1])); }]
  ];
  for (const [label, mutate] of controls) {
    const data = literalAssociationStages(); mutate(data);
    assert.equal(negativeAssociation(data.stages, data.tokens).relationIndex, null, label);
  }
  for (const verbPieces of [['single'], ['a and b', 'c']]) {
    const { stages, tokens } = literalAssociationStages(verbPieces);
    assert.equal(negativeAssociation(stages, tokens).relationIndex, null, 'unbounded token grammar');
  }
  const data = literalAssociationStages();
  data.tokens.splice(1, 0, 'unrelated');
  data.stages[1].realizations = [group(['verb'], [0, 2]), group(['neg'], [3, 4])];
  assert.equal(negativeAssociation(data.stages, data.tokens).relationIndex, null, 'nonconsecutive token positions');
});
