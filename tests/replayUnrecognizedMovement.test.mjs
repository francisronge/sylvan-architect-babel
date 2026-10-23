import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getFrameRelations } from '../replay/frameRelations.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';
import { withStructuralMovement } from './helpers/structuralMovementSwitch.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/unrecognized-movement.json', import.meta.url), 'utf8'));
const prepared = new Map();
const replay = index => {
  if (!prepared.has(index)) prepared.set(index, prepareReplay({ ...structuredClone(fixture.cases[index]), includePlayback: true }));
  return prepared.get(index);
};
const play = index => replay(index).playbackSteps;
const moment = (steps, stageIndex, relationIndex) => {
  const index = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity.relationIndex === relationIndex);
  assert.ok(index >= 0, `relation ${stageIndex}:${relationIndex} has a moment`);
  return index;
};
const firstShown = (steps, id) => steps.findIndex(step => frameStructure(step).displayed.has(id));
const node = (step, id) => {
  const visit = candidate => candidate.id === id ? candidate : candidate.children?.map(visit).find(Boolean);
  return visit(step.replayCanvasData);
};
const describeStep = (steps, index) => `frame ${index + 1} (${steps[index]?.replayKind} ${steps[index]?.operation} ${steps[index]?.targetNodeId})`;

/** Each displaced occurrence and new parent first appears at its claim's moment. */
const assertIntroducedAt = (steps, at, ids) => ids.forEach(id => assert.equal(firstShown(steps, id), at,
  `${id} first appears at ${describeStep(steps, firstShown(steps, id))}, not its moment ${describeStep(steps, at)}`));
/** An ordinary node first appears at a construction step that builds it. */
const assertBuiltByOwnStep = (steps, id) => {
  const index = firstShown(steps, id), step = steps[index];
  assert.equal(step?.replayKind, 'micro', `${id} first appears at ${describeStep(steps, index)}`);
  assert.ok([id, `${id}::__leaf`].includes(step.targetNodeId), `${id} first appears at ${describeStep(steps, index)}`);
};
const assertStageRecordAddsNothing = (steps, stageIndex) => {
  const record = steps.findLastIndex(step => step.replayFrameIndex === stageIndex);
  assert.equal(steps[record].operation, 'StageRecord');
  const before = frameStructure(steps[record - 1]), after = frameStructure(steps[record]);
  assert.deepEqual([...after.displayed].filter(id => !before.displayed.has(id)), [], `stage ${stageIndex + 1}'s record adds no syntax`);
  assert.deepEqual([...after.displayed].filter(id => before.parent.get(id) !== after.parent.get(id)), [], `stage ${stageIndex + 1}'s record attaches nothing`);
};

test('a copy related to its earlier occurrence by a claim with unfamiliar names appears at that claim\'s moment', () => {
  const steps = play(0), at = moment(steps, 2, 0);
  assertIntroducedAt(steps, at, ['rSubjectHigh', 'rTP']);
  const before = steps.slice(0, at).filter(step => step.replayFrameIndex === 2);
  assert.deepEqual(before.map(step => `${step.operation} ${step.targetNodeId}`), ['LexicalSelect rT', 'ExternalMerge rTDomain']);
  for (const step of before) assert.notEqual(node(step, 'rSubjectBase').silent, true, 'the earlier occurrence keeps its word until the moment');
  assert.equal(node(steps[at], 'rSubjectBase').silent, true);
  const structure = frameStructure(steps[at]);
  assert.equal(structure.parent.get('rSubjectHigh'), 'rTP');
  assert.equal(structure.parent.get('rTDomain'), 'rTP', 'the new TP attaches the copy above the existing T′');
  assertStageRecordAddsNothing(steps, 2);
});

test('a head complex whose claim lists contained heads appears at its moment, not at an unrelated selection', () => {
  const steps = play(1), at = moment(steps, 8, 1);
  assertIntroducedAt(steps, at, ['mTHeadAtC', 'mvHeadAtC', 'mVAtC', 'mvAtC', 'mTAtC', 'mCHead']);
  assertBuiltByOwnStep(steps, 'mC');
  // The host head merges with its complement first; the head complex then replaces it there.
  assertBuiltByOwnStep(steps, 'mCP');
  assert.equal(firstShown(steps, 'mCP'), at - 1);
  assert.deepEqual(frameStructure(steps[at - 1]).children.get('mCP'), ['mC', 'mTPHigh']);
  assert.deepEqual(frameStructure(steps[at]).children.get('mCP'), ['mCHead', 'mTPHigh']);
  assertStageRecordAddsNothing(steps, 8);
});

test('a pied-piped phrase appears at its claim\'s moment at each edge', () => {
  const steps = play(2);
  assertIntroducedAt(steps, moment(steps, 3, 0), ['pp1', 'p1', 'wh1', 'vEdge']);
  // The relative Internal Merge moves pp1 to pp2: it introduces the whole
  // pied-piped PP and the CP it joins. The operator-variable dependency that
  // names the carried wh2 is no movement of its own and plays after it.
  assertIntroducedAt(steps, moment(steps, 7, 0), ['pp2', 'p2', 'wh2', 'cpRel']);
  assert.ok(moment(steps, 7, 0) < moment(steps, 7, 1));
  const paths = replay(2).relationRenderPlan.frames[7].items.filter(item => item.kind === 'trajectory')
    .map(item => `${item.relationRef.stageIndex}:${item.relationRef.relationIndex} ${item.sourceNodeId}->${item.targetNodeId}`);
  assert.ok(paths.includes('3:0 pp0->pp1'), 'the phase-edge Internal Merge draws its PP path');
  assert.ok(paths.includes('7:0 pp1->pp2'), 'the relative Internal Merge draws its PP path');
  assert.ok(!paths.some(path => path.startsWith('7:1 ')), 'the operator-variable dependency draws no movement path');
  [3, 7].forEach(stage => assertStageRecordAddsNothing(steps, stage));
});

test('a fronted copy outside the rewritten trace appears at its claim\'s moment, not at the Stage Record', () => {
  const steps = play(3), at = moment(steps, 2, 0);
  assertIntroducedAt(steps, at, ['frontedObject', 'frontedObjectDbar', 'frontedObjectD', 'objectTrace']);
  assertStageRecordAddsNothing(steps, 2);
});

test('a shared occurrence in the other conjunct keeps its own construction, and its claim adds no syntax', () => {
  const steps = play(4), at = moment(steps, 1, 1);
  ['vp-buy', 'the-sell', 'house-sell', 'object-sell', 'vp-sell'].forEach(id => assertBuiltByOwnStep(steps, id));
  assert.ok(firstShown(steps, 'vp-sell') < at);
  assert.equal(frameStructure(steps[at]).key, frameStructure(steps[at - 1]).key, 'the claim names syntax already built');
  assertStageRecordAddsNothing(steps, 1);
});

test('an occurrence that keeps its id reaches its landing at the rewrite moment, inside a root merged by construction', () => {
  const steps = play(5), at = moment(steps, 1, 1);
  for (const step of steps.slice(0, at).filter(step => step.replayFrameIndex === 1))
    assert.equal(frameStructure(step).parent.get('bObject'), 'bVBar', 'the object stays at its source until the moment');
  assert.equal(frameStructure(steps[at]).parent.get('bObject'), 'bVP');
  assertIntroducedAt(steps, at, ['bObjectTrace']);
  ['bBaBar', 'bBaP'].forEach(id => assertBuiltByOwnStep(steps, id));
  assertStageRecordAddsNothing(steps, 1);
});

test('unanchored construction in a rewrite stage keeps its own steps', () => {
  const applicative = play(6);
  ['aD', 'aNom', 'aBenef'].forEach(id => assertBuiltByOwnStep(applicative, id));
  assertStageRecordAddsNothing(applicative, 1);
  const pseudogapping = play(7);
  ['a_and', 'a_coord_projection', 'a_coordination'].forEach(id => assertBuiltByOwnStep(pseudogapping, id));
  assertStageRecordAddsNothing(pseudogapping, 6);
});

/* Synthetic end-to-end controls through getFrameRelations and the compiler. */

const leafNode = (id, label, extra = {}) => ({ id, label, ...extra });
const branch = (id, label, ...children) => ({ id, label, children });
const words = forest => forest.flatMap(node => node.children?.length ? words(node.children) : node.word && !node.silent ? [node.word] : []);
const twoStages = (before, after, relations) => ({ sentence: words(after).join(' '), derivationStages: [
  { statement: 'Preceding state', stageRecord: 'The earlier occurrence is built.', relations: [], workspaceForest: before },
  { statement: 'Completed state', stageRecord: 'The stage is complete.', relations, workspaceForest: after }] });
const compile = record => {
  const authored = structuredClone(record), prepared = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.deepEqual(record, authored);
  return { prepared, relations: getFrameRelations(prepared.replayDerivationFrames[1], prepared.derivationReplayPlan.stages[1],
    record.derivationStages[0].workspaceForest) };
};
const construction = steps => steps.filter(step => step.replayKind === 'micro').map(step => `${step.operation} ${step.targetNodeId}`);
const phrase = (id, lineageId, word) => branch(id, 'DP', leafNode(`${id}D`, 'D', { word, lineageId: `${lineageId}-head` }));

test('a copy whose new parent joins its unchanged earlier occurrence attaches both at the claim\'s moment', () => {
  const old = { ...phrase('old', 'book', 'book'), lineageId: 'book' }, copy = { ...phrase('new', 'book', 'book'), lineageId: 'book' };
  const { prepared } = compile(twoStages([old], [branch('root', 'XP', structuredClone(old), copy)],
    [{ relation: 'shared occurrence', anchors: { first: 'old', second: 'new' } }]));
  const steps = prepared.playbackSteps, at = moment(steps, 1, 0);
  for (const step of steps.slice(0, at).filter(step => step.replayFrameIndex === 1))
    assert.equal(frameStructure(step).parent.get('old'), null, 'the earlier occurrence stays its own workspace until the moment');
  assertIntroducedAt(steps, at, ['root', 'new']);
  assert.equal(frameStructure(steps[at]).parent.get('old'), 'root', 'the moment attaches the preceding root with the copy');
  assertStageRecordAddsNothing(steps, 1);
});

const pronunciationCase = ({ ambiguous = false } = {}) => {
  const lower = id => ({ id, label: 'V descriptive', lineageId: 'copy-chain', word: 'walk', tokenIndex: 0, children: [] });
  const other = { id: 'other', label: 'Adv', word: 'again', tokenIndex: 1, children: [] };
  const lowers = ambiguous ? [lower('lower'), lower('second')] : [lower('lower')];
  const record = twoStages([branch('base', 'V', ...lowers, other)], [branch('root', 'T',
    branch('complex', 'T', { ...lower('higher'), word: 'walked' }, { id: 'host', label: 'T', silent: true, children: [] }),
    branch('base', 'V', ...lowers.map(node => ({ ...node, silent: true })), structuredClone(other)))], [
    { relation: 'Opaque occurrence update', anchors: { higher: 'higher', lower: 'lower', ...(ambiguous ? { second: 'second' } : {}), context: 'host' } },
    { relation: 'PFRealization', anchors: { terminal: 'higher' }, values: { realization: 'walked' } }]);
  record.inputTokens = ['walked', 'again'];
  return compile(record);
};

test('a copy related only by its lineage keeps its earlier occurrence\'s form until a later claim owns its pronunciation', () => {
  const { prepared, relations } = pronunciationCase();
  assert.deepEqual(relations[0].anchoredCopyDisplacement.copies, [{ nodeId: 'higher', earlierNodeId: 'lower' }]);
  const steps = prepared.playbackSteps, copy = steps[moment(steps, 1, 0)], realization = steps[moment(steps, 1, 1)];
  assert.ok(frameStructure(copy).displayed.has('higher'));
  assert.equal(node(copy, 'higher').word, 'walk', 'the copy shows the form it continues');
  assert.equal(node(realization, 'higher').word, 'walked');
});

test('a copy with several displaced earlier occurrences shows no borrowed form and says why', () => {
  const { prepared, relations } = pronunciationCase({ ambiguous: true });
  assert.deepEqual(relations[0].anchoredCopyDisplacement.copies, [{ nodeId: 'higher' }]);
  assert.ok(relations[0].movementDiagnostics.some(diagnostic => diagnostic.startsWith('COPY_SOURCE_AMBIGUOUS:')));
  const steps = prepared.playbackSteps, copy = steps[moment(steps, 1, 0)], realization = steps[moment(steps, 1, 1)];
  assert.equal(node(copy, 'higher').word, undefined, 'neither candidate form stands in for the later owner');
  assert.equal(node(realization, 'higher').word, 'walked');
});

test('the receiving material a new parent attaches carries exact evidence that owns its motion', () => {
  const steps = play(3), at = moment(steps, 2, 0);
  assert.deepEqual(steps[at].replayTreeTransition.attachments, [{ host: 'cbar', wrapper: 'outerCbar' }]);
});

test('a shared lineage without displacement or repeated material leaves construction to ordinary steps', () => {
  const john = { id: 'john', label: 'D', word: 'John', lineageId: 'person', children: [] };
  const saw = { id: 'saw', label: 'V', word: 'saw', children: [] };
  const after = [branch('clause', 'VP', structuredClone(john), branch('vbar', 'V′', structuredClone(saw),
    { id: 'him', label: 'D', word: 'him', lineageId: 'person', children: [] }))];
  const baseline = construction(compile(twoStages([john, saw], after, [])).prepared.playbackSteps);
  for (const relation of [
    { relation: 'antecedent identity', anchors: { antecedent: 'john', pronoun: 'him' } },
    { relation: 'Coreference', anchors: { antecedent: 'john', anaphor: 'him' } },
    { relation: 'Identity', anchors: { first: 'john', second: 'him' } },
    { relation: 'theta-role assignment', anchors: { predicate: 'saw', theme: 'him', reused: 'john' } }
  ]) {
    const { prepared, relations } = compile(twoStages([john, saw], after, [relation]));
    assert.equal(relations[0].anchoredCopyDisplacement, undefined, relation.relation);
    assert.deepEqual(construction(prepared.playbackSteps), baseline, `${relation.relation} does not time construction`);
  }
});

test('end to end, neutral copy ownership needs lineage and unique ids, and gives every copy its exact earlier occurrence', () => {
  const atom = (id, label, extra = {}) => ({ id, label, ...extra });
  const tree = (id, label, ...children) => ({ id, label, children });
  const find = (forest, id) => forest.flatMap(function all(item) { return [item, ...(item.children ?? []).flatMap(all)]; }).find(item => item.id === id);
  const deferredCopy = () => {
    const lower = atom('lower', 'V descriptive', { word: 'was', tokenIndex: 0, lineageId: 'verbal-chain' });
    const predicate = tree('predicate', 'PredP', atom('adjective', 'A', { word: 'ready', tokenIndex: 1 }));
    return twoStages([tree('base', 'V', lower, predicate)], [tree('root', 'C', atom('force', 'C declarative', { silent: true }),
      tree('clause', 'T', atom('subject', 'D expletive', { silent: true }), tree('bar', 'T',
        tree('complex', 'T', atom('higher', 'V descriptive', { ...lower, id: 'higher' }), atom('host', 'T', { silent: true })),
        tree('base', 'V', atom('lower', lower.label, { word: lower.word, lineageId: lower.lineageId, silent: true }), predicate))))], [
      { relation: 'An open authored association', anchors: { higherCopula: 'higher', lowerCopula: 'lower', landingHead: 'host' },
        priorAnchors: { sourceCopula: 'lower' } },
      { relation: 'Independent subject account', anchors: { subject: 'subject', clause: 'clause', finiteHead: 'host' } }]);
  };
  const owner = (record, id) => {
    const { prepared } = compile(record), steps = prepared.playbackSteps, index = firstShown(steps, id);
    return steps[index].replayKind === 'relation' ? steps[index].replayRelationIdentity.relationIndex : steps[index].replayKind;
  };
  assert.equal(owner(deferredCopy(), 'higher'), 0);
  for (const [variant, expected] of [['different-lineage', 'micro'], ['missing-lineage', 'micro'],
    ['second-landing', 0], ['wrong-slot', 0]]) {
    const changed = deferredCopy(), current = changed.derivationStages[1].workspaceForest;
    if (variant === 'different-lineage') find(current, 'higher').lineageId = 'other';
    if (variant === 'missing-lineage') delete find(current, 'higher').lineageId;
    if (variant === 'second-landing') {
      current.push({ ...find(current, 'higher'), id: 'another' });
      changed.derivationStages[1].relations[0].anchors.anotherCopy = 'another';
    }
    if (variant === 'wrong-slot') find(current, 'base').children.reverse();
    assert.equal(owner(changed, 'higher'), expected, variant);
    if (variant === 'second-landing') {
      const { relations } = compile(changed);
      assert.deepEqual(relations[0].anchoredCopyDisplacement.copies, [{ nodeId: 'higher', earlierNodeId: 'lower' }, { nodeId: 'another', earlierNodeId: 'lower' }]);
    }
  }
  const duplicated = deferredCopy(), forest = duplicated.derivationStages[1].workspaceForest;
  forest.push(structuredClone(find(forest, 'higher')));
  assert.equal(compile(duplicated).relations[0].anchoredCopyDisplacement, undefined, 'a repeated id identifies no copy');
});

test('a preceding root keeps the attachment the claim\'s moment gives it beneath a new outer projection', () => {
  const old = { ...phrase('old', 'book', 'book'), lineageId: 'book' }, copy = { ...phrase('new', 'book', 'book'), lineageId: 'book' };
  const { prepared } = compile(twoStages([old], [branch('top', 'YP', branch('root', 'XP', structuredClone(old), copy))],
    [{ relation: 'shared occurrence', anchors: { first: 'old', second: 'new' } }]));
  const steps = prepared.playbackSteps, at = moment(steps, 1, 0);
  assertIntroducedAt(steps, at, ['root', 'new']);
  for (const step of steps.slice(at).filter(step => step.replayFrameIndex === 1))
    assert.equal(frameStructure(step).parent.get('old'), 'root', `${step.operation} ${step.targetNodeId} keeps the attachment`);
  assertBuiltByOwnStep(steps, 'top');
  assertStageRecordAddsNothing(steps, 1);
});

test('material a claim\'s new parent gains outside the claim attaches at that parent\'s own merge', () => {
  const old = { ...phrase('old', 'book', 'book'), lineageId: 'book' }, copy = { ...phrase('new', 'book', 'book'), lineageId: 'book' };
  const extra = leafNode('extra', 'Adv', { word: 'again' });
  const { prepared } = compile(twoStages([old, extra], [branch('root', 'XP', structuredClone(old), copy, structuredClone(extra))],
    [{ relation: 'shared occurrence', anchors: { first: 'old', second: 'new' } }]));
  const steps = prepared.playbackSteps, at = moment(steps, 1, 0), structure = frameStructure(steps[at]);
  assert.deepEqual(['old', 'new', 'extra'].map(id => structure.parent.get(id)), ['root', 'root', null]);
  const merge = steps.findIndex((step, index) => index > at && step.replayKind === 'micro' && step.targetNodeId === 'root');
  assert.ok(merge > at, 'the parent keeps its own merge for the remaining material');
  assert.equal(frameStructure(steps[merge - 1]).parent.get('extra'), null);
  assert.equal(frameStructure(steps[merge]).parent.get('extra'), 'root');
  assertStageRecordAddsNothing(steps, 1);
});

test('a copied phrase keeps its earlier occurrence\'s words until a later claim owns a terminal\'s form', () => {
  const verbPhrase = (id, verbId, word, extra = {}) => ({ id, label: 'VP', lineageId: 'predicate', ...extra,
    children: [{ id: verbId, label: 'V', word, lineageId: 'verb', ...extra, children: [] }] });
  const other = { id: 'other', label: 'Adv', word: 'again', children: [] };
  const record = twoStages([branch('base', 'XP', verbPhrase('low', 'vLow', 'walk'), other)], [branch('root', 'XP',
    verbPhrase('high', 'vHigh', 'walked'), branch('base', 'XP', verbPhrase('low', 'vLow', 'walk', { silent: true }), structuredClone(other)))], [
    { relation: 'Opaque occurrence update', anchors: { higher: 'high', lower: 'low' } },
    { relation: 'PFRealization', anchors: { terminal: 'vHigh' }, values: { realization: 'walked' } }]);
  // Structure would read this displacement as movement; the neutral copy is
  // the path Replay takes whenever structure declines to read one.
  const { prepared } = withStructuralMovement('0', () => compile(record)), steps = prepared.playbackSteps;
  const copy = steps[moment(steps, 1, 0)], realization = steps[moment(steps, 1, 1)];
  assert.ok(frameStructure(copy).displayed.has('vHigh'));
  assert.equal(node(copy, 'vHigh').word, 'walk', 'the copied terminal shows its counterpart\'s form');
  assert.equal(node(realization, 'vHigh').word, 'walked', 'the later claim changes the word');
  assertStageRecordAddsNothing(steps, 1);
});

test('material a surviving parent gains while its old container dissolves attaches before the Stage Record', () => {
  const old = { ...phrase('old', 'book', 'book'), lineageId: 'book' }, extra = leafNode('extra', 'Adv', { word: 'again' });
  const { prepared } = compile(twoStages([branch('base', 'XP', branch('inner', 'YP', old)), extra],
    [branch('base', 'XP', branch('host', 'ZP', { ...phrase('new', 'book', 'book'), lineageId: 'book' }),
      { ...structuredClone(old), silent: true }, structuredClone(extra))],
    [{ relation: 'shared occurrence', anchors: { first: 'old', second: 'new' } }]));
  const steps = prepared.playbackSteps, at = moment(steps, 1, 0);
  const attached = steps.findIndex(step => step.replayFrameIndex === 1 && frameStructure(step).parent.get('extra') === 'base');
  assert.ok(attached >= 0 && steps[attached].replayKind === 'micro', `extra attaches at ${describeStep(steps, attached)}`);
  assert.equal(frameStructure(steps[at]).parent.get('new'), 'host');
  assertStageRecordAddsNothing(steps, 1);
});

const laterPronunciationRecord = ({ low, high, pf, after = node => node }, relation = 'Opaque occurrence update',
  anchors = { higher: high.id, lower: low.id }) => {
  const other = { id: 'other', label: 'Adv', word: 'again', children: [] };
  return twoStages([branch('base', 'XP', low, other)], [branch('root', 'XP', high,
    branch('base', 'XP', after(structuredClone(low)), structuredClone(other)))], [
    { relation, anchors },
    { relation: 'PFRealization', anchors: { terminal: pf }, values: { realization: 'walked' } }]);
};
/** The neutral copy's steps. Structure reads each of these displacements as
 * movement, so the reading is switched off to reach the neutral path that
 * Replay takes whenever structure declines to read a displacement. */
const laterPronunciation = shape => withStructuralMovement('0', () => compile(laterPronunciationRecord(shape)).prepared.playbackSteps);
const silence = node => ({ ...node, silent: true, children: (node.children || []).map(silence) });
const verb = (id, word, extra = {}) => ({ id, label: 'V', word, lineageId: 'verb', children: [], ...extra });

test('a copied terminal whose counterpart is a projection shows no earlier word before its owner\'s moment', () => {
  const steps = laterPronunciation({ pf: 'vHigh', after: silence,
    low: { id: 'low', label: 'VP', lineageId: 'predicate', children: [{ id: 'vbar', label: 'V′', children: [verb('vLow', 'walk')] }] },
    high: { id: 'high', label: 'VP', lineageId: 'predicate', children: [verb('vHigh', 'walked')] } });
  assert.equal(node(steps[moment(steps, 1, 0)], 'vHigh').word, undefined);
  assert.equal(node(steps[moment(steps, 1, 1)], 'vHigh').word, 'walked', 'the later claim changes the word');
  assertStageRecordAddsNothing(steps, 1);
});

test('a later claim that names a copied phrase owns the words of its terminals', () => {
  const steps = laterPronunciation({ pf: 'high', after: silence,
    low: { id: 'low', label: 'VP', lineageId: 'predicate', children: [verb('vLow', 'walk')] },
    high: { id: 'high', label: 'VP', lineageId: 'predicate', children: [verb('vHigh', 'walked')] } });
  assert.equal(node(steps[moment(steps, 1, 0)], 'vHigh').word, 'walk');
  assert.equal(node(steps[moment(steps, 1, 1)], 'vHigh').word, 'walked', 'the later claim changes the word');
  assertStageRecordAddsNothing(steps, 1);
});

test('a copy keeps its earlier occurrence\'s pronunciation, silence included, until a later claim owns it', () => {
  const steps = laterPronunciation({ pf: 'higher', low: verb('lower', 'walk'), high: verb('higher', 'walk', { silent: true }) });
  const copy = node(steps[moment(steps, 1, 0)], 'higher'), realization = node(steps[moment(steps, 1, 1)], 'higher');
  assert.deepEqual([copy.word, copy.silent], ['walk', undefined], 'the copy is pronounced like its source until then');
  assert.equal(realization.silent, true, 'the later claim makes it silent');
  assertStageRecordAddsNothing(steps, 1);
});

test('read from structure, an opaque occurrence update is a movement whose landing arrives as a worded movement\'s does', () => {
  const shape = { pf: 'vHigh', low: { id: 'low', label: 'VP', lineageId: 'predicate', children: [verb('vLow', 'walk')] },
    high: { id: 'high', label: 'VP', lineageId: 'predicate', children: [verb('vHigh', 'walked')] },
    after: node => ({ ...node, silent: true, children: node.children.map(silence) }) };
  const observe = record => {
    const { prepared } = compile(record), steps = prepared.playbackSteps;
    return { word: node(steps[moment(steps, 1, 0)], 'vHigh').word,
      paths: prepared.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory').map(item => `${item.sourceNodeId}>${item.targetNodeId}`) };
  };
  const opaque = observe(laterPronunciationRecord(shape));
  assert.deepEqual(opaque, { word: 'walked', paths: ['low>high'] });
  assert.deepEqual(observe(laterPronunciationRecord(shape, 'Internal Merge', { higherCopy: 'high', lowerCopy: 'low' })), opaque);
});
