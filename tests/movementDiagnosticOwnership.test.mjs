import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { isPriorMovementContextFailure } from '../replay/relations/movementDiagnosticOwnership.ts';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { findRelationRegistryEntry, productionRelationRegistry } from '../replay/relationDispatch/index.js';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/holdout-transitions.json', import.meta.url)));
const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
const stage = (workspaceForest, relations = []) => ({ workspaceForest, relations, statement: 'State', stageRecord: 'Authored state.' });
const headContext = (binding = false) => {
  const verb = node('v', 'V', [], { lineageId: 'verb', word: 'read' });
  const object = node('objectTrace', 'DP trace', [], { lineageId: 'nominal', silent: true });
  const subject = node('binder', 'DP', [], { lineageId: 'nominal', word: 'Books' });
  const clause = (head, lowerVerb) => node('ip', 'IP', [subject,
    node('ibar', 'I′', [head, node('vp', 'VP', [lowerVerb, object])])]);
  const before = clause(node('i', 'I', [], { silent: true }), verb);
  const raisedVerb = binding ? { ...verb, id: 'raisedV' } : verb;
  const after = clause(node('i', 'I', [raisedVerb, node('features', 'I', [], { silent: true })]),
    node('verbTrace', 'V trace', [], { lineageId: 'verb', silent: true }));
  const movement = { relation: 'V-to-I head movement', anchors: { movedHead: raisedVerb.id, trace: 'verbTrace', landingHead: 'i' }, priorAnchors: { source: 'v' } };
  const context = binding
    ? { relation: 'Authored dependency', anchors: { binder: 'binder', boundTrace: 'objectTrace', localVerbalHead: 'verbTrace', raisedVerbalHead: raisedVerb.id } }
    : { relation: 'Authored dependency', anchors: { occurrences: ['v', 'verbTrace'], lexicalGovernor: 'v', lowerHead: 'verbTrace', objectTrace: 'objectTrace' }, priorAnchors: { governor: 'v', objectTrace: 'objectTrace' } };
  return { sentence: 'Books read', derivationStages: [stage([structuredClone(before)]), stage([structuredClone(after)], [movement, context])] };
};
const observe = (input, relationIndex = 1, previousRelations) => {
  const [prior, current] = input.derivationStages;
  const dispatches = dispatchStageRelations(input.derivationStages)[1];
  const earlier = previousRelations ?? current.relations.slice(0, relationIndex)
    .map(relation => recoverMovementEvidence(relation, current.workspaceForest, prior.workspaceForest).movement).filter(Boolean);
  return { dispatch: dispatches[relationIndex], earlier, quiet: isPriorMovementContextFailure(
    current.relations[relationIndex], dispatches[relationIndex], earlier) };
};

for (const binding of [false, true]) test(`earlier head movement explains a later ${binding ? 'binding' : 'identity'} claim's context`, () => {
  const input = headContext(binding), original = structuredClone(input);
  const { dispatch, quiet } = observe(input);
  assert(dispatch.evidence.movementFailure, 'the speculative resolver refusal remains inspectable');
  assert.equal(quiet, true);
  const replay = prepareReplay({ ...input, includePlayback: true });
  const moment = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 1);
  assert(moment, 'the authored relation retains its own moment');
  assert(!moment.movementDiagnostics?.some(text => text.startsWith('MOVEMENT_')));
  assert(moment.replayVisibleNodeIds.includes(binding ? 'raisedV' : 'v'));
  assert(moment.replayVisibleNodeIds.includes('verbTrace'));
  assert.equal(replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory').length, 1);
  assert.deepEqual(input, original);
});

for (const id of ['successive-trace', 'raising-completion']) test(`${id}: chain context does not inherit a failed fresh-movement warning`, () => {
  const input = structuredClone(saved.find(record => record.id === id));
  const { dispatch, quiet } = observe(input, 2);
  assert.equal(dispatch.evidence.movementFailure, 'MOVEMENT_TARGET_IS_LOWER_WITNESS');
  assert.equal(quiet, true);
  const replay = prepareReplay({ ...input, includePlayback: true });
  const moment = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 2);
  assert(!moment.movementDiagnostics?.some(text => text.includes('MOVEMENT_TARGET_IS_LOWER_WITNESS')));
  assert(!moment.recoveredMovement?.transition);
});

for (const [name, mutate] of [
  ['declared movement', input => { input.derivationStages[1].relations[1].relation = 'HeadMove'; }],
  ['explicit preceding movement source', input => { input.derivationStages[1].relations[1].priorAnchors.source = 'v'; }],
  ['two directed occurrence fields', input => { input.derivationStages[1].relations[1].anchors.higherHead = 'v'; }],
  ['repeated source list', input => { input.derivationStages[1].relations[1].anchors.lowerHead = ['verbTrace', 'verbTrace']; }],
  ['missing current anchor', input => { input.derivationStages[1].relations[1].anchors.objectTrace = 'absent'; }],
  ['changed unrelated witness', input => { input.derivationStages[1].workspaceForest[0].children[1].children[1].children[1].label = 'DP changed'; }],
  ['context before its event', input => { input.derivationStages[1].relations.reverse(); }]
]) test(`${name} keeps the resolver failure`, () => {
  const input = headContext(); mutate(input);
  const index = name === 'context before its event' ? 0 : 1;
  const { quiet } = observe(input, index);
  assert.equal(quiet, false);
});

test('an earlier different event or absence of a static recovered claim proves no context', () => {
  const input = headContext(), { dispatch, earlier } = observe(input);
  const relation = input.derivationStages[1].relations[1];
  assert.equal(isPriorMovementContextFailure(relation, dispatch, []), false);
  assert.equal(isPriorMovementContextFailure(relation, dispatch,
    earlier.map(movement => ({ ...movement, targetNodeId: 'another' }))), false);
  assert.equal(isPriorMovementContextFailure(relation, { ...dispatch, facets: [] }, earlier), false);
});

test('declared and independently sourced lower-witness claims still fail', () => {
  for (const explicitSource of [false, true]) {
    const input = structuredClone(saved.find(record => record.id === 'successive-trace'));
    const relation = input.derivationStages[1].relations[2];
    if (explicitSource) relation.priorAnchors = { source: 'wh' };
    else relation.relation = 'AbarMove';
    assert.equal(observe(input, 2).quiet, false);
  }
});


const retainedContext = () => {
  const input = headContext();
  const forest = input.derivationStages[1].workspaceForest;
  const relation = { relation: 'Authored dependency', anchors: {
    occurrences: ['objectTrace', 'binder'], basePosition: 'objectTrace',
    chainHead: 'binder', thetaAssigner: 'v'
  } };
  input.derivationStages = [stage(structuredClone(forest)), stage(structuredClone(forest), [relation])];
  return input;
};

test('an unchanged established identity group does not require another movement owner', () => {
  const input = retainedContext(), original = structuredClone(input);
  const { dispatch, quiet, earlier } = observe(input, 0);
  assert.equal(dispatch.evidence.movementFailure, 'MOVEMENT_ENDPOINTS_UNRESOLVED');
  assert.equal(earlier.length, 0);
  assert.equal(quiet, true);
  const replay = prepareReplay({ ...input, includePlayback: true });
  const moment = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 0);
  assert(moment);
  assert(!moment.movementDiagnostics?.some(text => text.startsWith('MOVEMENT_')));
  assert(!moment.recoveredMovement);
  assert.deepEqual(input, original);
});

for (const [name, mutate] of [
  ['declared movement', input => { input.derivationStages[1].relations[0].relation = 'HeadMove'; }],
  ['explicit prior source', input => { input.derivationStages[1].relations[0].priorAnchors = { source: 'objectTrace' }; }],
  ['directed endpoints', input => { input.derivationStages[1].relations[0].anchors.higherOccurrence = 'binder'; }],
  ['changed occurrence', input => { input.derivationStages[1].workspaceForest[0].children[0].label = 'DP changed'; }],
  ['relocated occurrence', input => { input.derivationStages[1].workspaceForest[0].children.reverse(); }],
  ['repeated source', input => { input.derivationStages[1].relations[0].anchors.basePosition = ['objectTrace', 'objectTrace']; }],
  ['unrelated source', input => { input.derivationStages[1].relations[0].anchors.basePosition = 'verbTrace'; }],
  ['missing anchor', input => { input.derivationStages[1].relations[0].anchors.context = 'absent'; }]
]) test(`retained context with ${name} keeps its movement failure attribution`, () => {
  const input = retainedContext(); mutate(input);
  assert.equal(observe(input, 0).quiet, false);
});

const chainRestatement = () => {
  const input = headContext();
  input.derivationStages[1].relations[1] = {
    relation: 'A-chain', anchors: { occurrences: ['v', 'verbTrace'] }
  };
  return input;
};

for (const label of ['A-chain', 'A′-chain', 'wh-chain', 'head-chain']) {
  test(`${label} describes an earlier owned chain without demanding another move`, () => {
    const input = chainRestatement();
    input.derivationStages[1].relations[1].relation = label;
    assert.equal(observe(input).quiet, true);
    const replay = prepareReplay({ ...input, includePlayback: true });
    const moment = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === 1
      && step.replayRelationIdentity.relationIndex === 1);
    assert(moment);
    assert(!moment.movementDiagnostics?.length);
    assert(!moment.recoveredMovement, 'a chain description acquires no new movement');
    assert.equal(replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory').length, 1);
  });
}

test('an exact chain name can restate unchanged prior occurrences', () => {
  const input = chainRestatement();
  const current = input.derivationStages[1];
  input.derivationStages = [stage(structuredClone(current.workspaceForest)),
    stage(structuredClone(current.workspaceForest), [current.relations[1]])];
  assert.equal(observe(input, 0).quiet, true);
});

for (const [name, mutate] of [
  ['before its movement', input => input.derivationStages[1].relations.reverse()],
  ['explicit move operation', input => { input.derivationStages[1].relations[1].relation = 'Move'; }],
  ['explicit prior source', input => { input.derivationStages[1].relations[1].priorAnchors = { source: 'v' }; }],
  ['missing member', input => { input.derivationStages[1].relations[1].anchors.occurrences.push('absent'); }],
  ['unproved new member', input => {
    input.derivationStages[1].workspaceForest.push(node('another', 'V', [], { lineageId: 'verb', silent: true }));
    input.derivationStages[1].relations[1].anchors.occurrences.push('another');
  }],
  ['directed pair', input => {
    Object.assign(input.derivationStages[1].relations[1].anchors, { source: 'verbTrace', landing: 'v' });
  }]
]) test(`chain restatement ${name} keeps its diagnostic`, () => {
  const input = chainRestatement(); mutate(input);
  assert.equal(observe(input, name === 'before its movement' ? 0 : 1).quiet, false);
});

const neutralPosition = () => {
  const input = headContext(true);
  input.derivationStages[1].relations[1] = {
    relation: 'Auxiliary selection', anchors: {
      auxiliary: 'raisedV', basePosition: 'verbTrace', participle: 'objectTrace'
    }, values: { construction: 'perfect' }
  };
  return input;
};

test('a neutral selection can reference the base of an earlier owned movement', () => {
  const input = neutralPosition();
  assert.equal(observe(input).quiet, true);
  assert.equal(observe(input, 1, []).quiet, false, 'new base needs its earlier owner');
});

test('a neutral positional reference can retain an unchanged established pair', () => {
  const input = neutralPosition(), current = input.derivationStages[1];
  input.derivationStages = [stage(structuredClone(current.workspaceForest)),
    stage(structuredClone(current.workspaceForest), [current.relations[1]])];
  assert.equal(observe(input, 0).quiet, true);
});

for (const [name, mutate] of [
  ['operation identity', input => { input.derivationStages[1].relations[1].relation = 'HeadMove'; }],
  ['explicit prior source', input => { input.derivationStages[1].relations[1].priorAnchors = { source: 'v' }; }],
  ['explicit landing', input => { input.derivationStages[1].relations[1].anchors.landing = 'raisedV'; }],
  ['isolated base position', input => { delete input.derivationStages[1].relations[1].anchors.auxiliary; }],
  ['unknown participant', input => { input.derivationStages[1].relations[1].anchors.participle = 'absent'; }],
  ['an explicit source role', input => {
    const anchors = input.derivationStages[1].relations[1].anchors;
    anchors.source = anchors.basePosition; delete anchors.basePosition;
  }]
]) test(`neutral positional context with ${name} keeps its diagnostic`, () => {
  const input = neutralPosition(); mutate(input);
  assert.equal(observe(input).quiet, false);
});

test('positional-context proof does not depend on readable occurrence IDs', () => {
  const input = neutralPosition();
  const ids = new Set();
  const visit = node => { ids.add(node.id); node.children?.forEach(visit); };
  input.derivationStages.forEach(stage => stage.workspaceForest.forEach(visit));
  const mapping = new Map([...ids].map((id, index) => [id, `q${index + 101}`]));
  const rewrite = node => { node.id = mapping.get(node.id); node.children?.forEach(rewrite); };
  input.derivationStages.forEach(stage => {
    stage.workspaceForest.forEach(rewrite);
    stage.relations.forEach(relation => {
      for (const fields of [relation.anchors, relation.priorAnchors]) {
        for (const key of Object.keys(fields ?? {})) {
          fields[key] = Array.isArray(fields[key]) ? fields[key].map(id => mapping.get(id)) : mapping.get(fields[key]);
        }
      }
    });
  });
  assert.equal(observe(input).quiet, true);
});

test('malformed exact Tier-1 claims cannot use the positional-context exception', () => {
  const input = neutralPosition();
  const relation = input.derivationStages[1].relations[1];
  relation.relation = 'Control';
  assert(findRelationRegistryEntry(productionRelationRegistry, relation.relation));
  const { dispatch, earlier } = observe(input);
  assert.equal(isPriorMovementContextFailure(relation, {
    ...dispatch, evidence: { ...dispatch.evidence, movement: undefined, movementFailure: 'MOVEMENT_ENDPOINTS_UNRESOLVED' }
  }, earlier), false);
});
