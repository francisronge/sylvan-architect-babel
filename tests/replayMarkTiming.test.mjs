import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { isPlanItemRevealed, planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { checkNoEarlyReveal, frameStructure } from './helpers/replayInvariants.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';

const corpus = loadFixtureAnalyses().records;
const prepared = id => {
  const { record } = corpus.find(entry => entry.id === id);
  return { record, replay: prepareReplay({ ...structuredClone(record), includePlayback: true }) };
};
const moment = (steps, stage, relation) => steps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity.stageIndex === stage && step.replayRelationIdentity.relationIndex === relation);
const owns = (item, stage, relation) => planItemRelationRefs(item).some(ref => ref.stageIndex === stage && ref.relationIndex === relation);
/** Whether an item is revealed at each step of its frame's stage, as the renderer selects it. */
const revealedAcross = (replay, item, stage) => {
  const played = new Set();
  return replay.playbackSteps.flatMap(step => {
    if (step.replayFrameIndex !== stage) return [];
    const active = step.replayKind === 'relation' ? step.replayRelationIdentity.relationIndex : null;
    if (active !== null) played.add(active);
    return [isPlanItemRevealed(item, stage, played, active)];
  });
};

test('a persistent mark stays until the movement that carries its anchor away', () => {
  // Stage 3 moves the V-to-I complex holding v2 on to C; v2 keeps its place until that moment.
  const { record, replay } = prepared('replay-regressions/case-source-transfer.json#');
  const steps = replay.playbackSteps, carried = moment(steps, 2, 2), first = steps.findIndex(step => step.replayFrameIndex === 2);
  const arrow = replay.relationRenderPlan.frames[2].items.find(item => item.kind === 'trajectory' && owns(item, 1, 1));
  assert(arrow, 'stage 2\'s V-to-I arrow is materialized for stage 3');
  assert.deepEqual([arrow.supersededAt?.stageIndex, arrow.supersededAt?.relationIndex], [2, 2]);
  assert.deepEqual(revealedAcross(replay, arrow, 2), steps.filter(step => step.replayFrameIndex === 2).map((_step, index) => first + index < carried));
  assert.deepEqual(checkMarkPersistence(replay, record).filter(found => found.subtype === 'ends-before-removal'), []);
});

test('a restated occurrence keeps its preceding label until the relation that names it', () => {
  // Stage 2 restates matrixI as V-adjoined; V-to-I head movement is the first relation naming it.
  const { record, replay } = prepared('movement/holdout-transitions.json#/1');
  const steps = replay.playbackSteps, adjoins = moment(steps, 1, 1);
  const labelAt = index => d3.hierarchy(steps[index].replayCanvasData).find(node => node.data.id === 'matrixI').data.label;
  steps.forEach((step, index) => {
    if (step.replayFrameIndex === 1) assert.equal(labelAt(index), index < adjoins ? 'I⁰ [finite]' : 'I⁰ [finite, V-adjoined]', `frame ${index + 1}`);
  });
  assert.deepEqual(checkStepSemantics(replay, record).filter(found => found.subtype === 'unowned-repaint'), []);
});

/** What one authored occurrence displays at a step: its own fields and the derived words shown under it. */
const shown = (step, id) => {
  const structure = frameStructure(step);
  const node = [...structure.nodes.values()].find(candidate => candidate.data.id === id || candidate.data.replayOrigin?.authoredId === id);
  const words = (node.children ?? []).filter(child => child.data.replayOrigin?.kind === 'word' && structure.displayed.has(child.data.id));
  return { label: node.data.label, word: node.data.word, words: words.map(child => child.data.label) };
};
const stageSteps = (steps, stage) => steps.flatMap((step, index) => step.replayFrameIndex === stage ? [index] : []);
const authoredStage = (workspaceForest, relations = []) => ({ statement: 'An authored state.', stageRecord: 'An authored account.', workspaceForest, relations });
const replayOf = record => ({ record, replay: prepareReplay({ ...structuredClone(record), includePlayback: true }) });

const dp = (nLabel, word = 'dog') => ({ id: 'dp', label: 'DP', lineageId: 'subject', children: [
  { id: 'd', label: 'D', word: 'the', tokenIndex: 0 }, { id: 'n', label: nLabel, word, tokenIndex: 1 }] });
const raising = (landing, later) => ({ sentence: 'the dog will bark', derivationStages: [
  authoredStage([{ id: 'tbar', label: "T'", children: [{ id: 't', label: 'T', word: 'will', tokenIndex: 2 },
    { id: 'vp', label: 'VP', children: [dp('N [unvalued]'), { id: 'v', label: 'V', word: 'bark', tokenIndex: 3 }] }] }]),
  authoredStage([{ id: 'tp', label: 'TP', children: [landing, { id: 'tbar', label: "T'", children: [{ id: 't', label: 'T', word: 'will', tokenIndex: 2 },
    { id: 'vp', label: 'VP', children: [{ id: 'lower', label: 'DP', lineageId: 'subject', silent: true }, { id: 'v', label: 'V', word: 'bark', tokenIndex: 3 }] }] }] }], [
    { relation: 'A-movement', anchors: { source: 'lower', landing: 'dp' }, priorAnchors: { source: 'dp' } }, later])] });

test('a movement shows its complete landing, including a restated descendant that a later relation names', () => {
  // The retained DP lands with its noun valued; the later Case relation only names it.
  const { record, replay } = replayOf(raising(dp('N [valued]'), { relation: 'Case context', anchors: { nominal: 'n', assigner: 't' } }));
  const steps = replay.playbackSteps, moves = moment(steps, 1, 0);
  assert.equal(shown(steps[moves - 1], 'n').label, 'N [unvalued]');
  assert.equal(frameStructure(steps[moves]).parent.get('dp'), 'tp');
  assert.deepEqual(shown(steps[moves], 'n'), { label: 'N [valued]', word: 'dog', words: ['dog'] });
  assert.deepEqual(checkStepSemantics(replay, record), []);
});

test('a movement keeps the landing word that a later realization owns until that realization', () => {
  const { record, replay } = replayOf(raising(dp('N [valued]', 'dogs'), { relation: 'VocabularyInsertion', anchors: { terminal: 'n' } }));
  const steps = replay.playbackSteps, moves = moment(steps, 1, 0), inserts = moment(steps, 1, 1);
  assert.deepEqual(shown(steps[moves], 'n'), { label: 'N [valued]', word: 'dog', words: ['dog'] });
  assert.deepEqual(shown(steps[inserts], 'n'), { label: 'N [valued]', word: 'dogs', words: ['dogs'] });
  assert.deepEqual(checkStepSemantics(replay, record), []);
});

test('a movement keeps a landing word that a relation pronouncing its ancestor realizes until that relation', () => {
  // No relation names n; the insertion pronounces the DP that holds it, so n's word is that insertion's.
  for (const label of ['N [unvalued]', 'N [valued]']) {
    const { record, replay } = replayOf(raising(dp(label, 'dogs'), { relation: 'VocabularyInsertion', anchors: { terminal: 'dp' } }));
    const steps = replay.playbackSteps, moves = moment(steps, 1, 0), inserts = moment(steps, 1, 1);
    assert.equal(frameStructure(steps[moves]).parent.get('dp'), 'tp');
    assert.deepEqual(shown(steps[moves], 'n'), { label, word: 'dog', words: ['dog'] }, label);
    assert.deepEqual(shown(steps[inserts], 'n'), { label, word: 'dogs', words: ['dogs'] }, label);
    assert.deepEqual([...checkStepSemantics(replay, record), ...checkNoEarlyReveal(replay)], []);
    // Control: the word changing with the movement is reported, though the movement owns the landing.
    const broken = { ...replay, playbackSteps: structuredClone(steps) };
    broken.playbackSteps[moves].replayCanvasData = structuredClone(steps[inserts].replayCanvasData);
    assert(checkStepSemantics(broken, record).some(found => found.subtype === 'unowned-repaint' && found.subject === 'n::__leaf'
      && found.frame === moves + 1), label);
  }
});

/** A retained head under a new T: stage 2 restates it, and its second relation names it. */
const underT = (before, after, relations) => {
  const vp = head => ({ id: 'vp', label: 'VP', children: [head, { id: 'obj', label: 'DP', word: 'home', tokenIndex: 2 }] });
  const subject = { id: 'subj', label: 'DP', word: 'they', tokenIndex: 0 };
  return { sentence: 'they walked home', derivationStages: [authoredStage([subject, vp(before)]),
    authoredStage([{ id: 'tp', label: 'TP', children: [subject, { id: 'tbar', label: "T'", children: [
      { id: 't', label: 'T [past]', silent: true }, vp(after)] }] }], relations ?? [
      { relation: 'Agree', anchors: { probe: 't', goal: 'subj' } }, { relation: 'Morphological realization', anchors: { exponent: 'v' } }])] };
};

test('a restated lexical word under a restated parent: each waits for the relation naming it', () => {
  // Restating walk as walked changes the word leaf's generated id; the occurrence is the same.
  const { record, replay } = replayOf(underT({ id: 'p', label: 'V [unvalued]', children: [{ id: 'w', label: 'walk', word: 'walk', tokenIndex: 1 }] },
    { id: 'p', label: 'V [valued]', children: [{ id: 'w', label: 'walked', word: 'walked', tokenIndex: 1 }] },
    [{ relation: 'Agree', anchors: { probe: 't', goal: 'p' } }, { relation: 'Morphological realization', anchors: { exponent: 'w' } }]));
  const steps = replay.playbackSteps, values = moment(steps, 1, 0), realizes = moment(steps, 1, 1);
  for (const index of stageSteps(steps, 1)) {
    assert.equal(shown(steps[index], 'p').label, index < values ? 'V [unvalued]' : 'V [valued]', `frame ${index + 1}`);
    assert.equal(shown(steps[index], 'w').label, index < realizes ? 'walk' : 'walked', `frame ${index + 1}`);
  }
  assert.deepEqual(checkStepSemantics(replay, record).filter(found => found.subtype === 'unowned-repaint'), []);
});

test('a waiting occurrence keeps its derived word, or its lack of one, until the relation naming it', () => {
  for (const [before, after] of [[{ id: 'v', label: 'V', word: 'walked', tokenIndex: 1 }, { id: 'v', label: 'V' }],
    [{ id: 'v', label: 'V' }, { id: 'v', label: 'V', word: 'walked', tokenIndex: 1 }]]) {
    const { record, replay } = replayOf(underT(before, after)), steps = replay.playbackSteps, realizes = moment(steps, 1, 1);
    const words = word => word ? [word] : [];
    for (const index of stageSteps(steps, 1))
      assert.deepEqual(shown(steps[index], 'v'), index < realizes ? { label: 'V', word: before.word, words: words(before.word) }
        : { label: 'V', word: after.word, words: words(after.word) }, `frame ${index + 1}`);
    // The selection of a word that waits for its owner is no step; the stage is counted without it.
    const counted = stageSteps(steps, 1).map(index => steps[index]);
    assert.deepEqual(counted.map(step => step.replayStageStepIndex), counted.map((_step, index) => index));
    assert(counted.every(step => step.replayProgressLabel.endsWith(`/${counted.length}`)));
    assert.deepEqual([...checkStepSemantics(replay, record), ...checkNoEarlyReveal(replay)], []);
    // Control: the word may come or go only at the relation naming its owner, not at the earlier Agree.
    const agrees = moment(steps, 1, 0), broken = { ...replay, playbackSteps: structuredClone(steps) }, word = 'v::__leaf';
    const visible = broken.playbackSteps[agrees].replayVisibleNodeIds;
    broken.playbackSteps[agrees].replayVisibleNodeIds = before.word ? visible.filter(id => id !== word) : [...visible, word];
    const findings = before.word ? checkStepSemantics(broken, record) : checkNoEarlyReveal(broken);
    assert(findings.some(found => found.frame === agrees + 1 && found.detail.startsWith(`${word} ${before.word ? 'disappears' : 'appears'}`)));
  }
});

test('a word with its own pronunciation owner comes or goes only at that owner, not at an earlier relation naming it', () => {
  // Agree names v first; the insertion establishes v's pronunciation.
  const relations = [{ relation: 'Agree', anchors: { probe: 't', goal: 'v' } }, { relation: 'VocabularyInsertion', anchors: { terminal: 'v' } }];
  for (const [before, after] of [[{ id: 'v', label: 'V', word: 'walked', tokenIndex: 1 }, { id: 'v', label: 'V' }],
    [{ id: 'v', label: 'V' }, { id: 'v', label: 'V', word: 'walked', tokenIndex: 1 }]]) {
    const { record, replay } = replayOf(underT(before, after, relations)), steps = replay.playbackSteps;
    const agrees = moment(steps, 1, 0), inserts = moment(steps, 1, 1), words = word => word ? [word] : [];
    assert.deepEqual(shown(steps[agrees], 'v').words, words(before.word));
    assert.deepEqual(shown(steps[inserts], 'v').words, words(after.word));
    assert.deepEqual([...checkStepSemantics(replay, record), ...checkNoEarlyReveal(replay)], []);
    // Control: the insertion's frame shown at the Agree moment instead.
    const broken = { ...replay, playbackSteps: structuredClone(steps) };
    Object.assign(broken.playbackSteps[agrees], { replayCanvasData: structuredClone(steps[inserts].replayCanvasData),
      replayVisibleNodeIds: [...steps[inserts].replayVisibleNodeIds] });
    const findings = before.word ? checkStepSemantics(broken, record) : checkNoEarlyReveal(broken);
    assert(findings.some(found => found.frame === agrees + 1 && found.detail.startsWith(`v::__leaf ${before.word ? 'disappears' : 'appears'}`)),
      JSON.stringify(findings));
  }
});

const thetaForest = [{ id: 'vp', label: 'VP', children: [{ id: 'agent', label: 'X', word: 'Mia' },
  { id: 'bar', label: "V'", children: [{ id: 'v', label: 'X', word: 'bought' }, { id: 'theme', label: 'X', word: 'books' }] }] }];
const theta = (arguments_, labels) => ({ relation: 'ThetaAssignment', anchors: { predicate: 'v', arguments: arguments_ }, values: { arguments: labels } });
const thetaStage = relations => authoredStage(structuredClone(thetaForest), relations);
const themeBadges = (plan, frame) => plan.frames[frame].items.find(item => item.kind === 'node-badges' && item.badgeStyle === 'theta-role' && owns(item, 0, 0));
const yieldsAt = item => item?.supersededAt && [item.supersededAt.stageIndex, item.supersededAt.relationIndex];

test('restating a theta claim does not compose its grid: the badges yield to the relation adding a role', () => {
  const theme = theta(['theme'], ['Theme']), both = theta(['agent', 'theme'], ['Agent', 'Theme']);
  assert.deepEqual(yieldsAt(themeBadges(compileRelationRenderPlan([thetaStage([theme]), thetaStage([theme, both])]), 1)), [1, 1]);
  const plan = compileRelationRenderPlan([thetaStage([theme]), thetaStage([theme]), thetaStage([both])]);
  assert(themeBadges(plan, 1) && !themeBadges(plan, 1).supersededAt, 'a restatement alone composes nothing');
  assert.deepEqual(yieldsAt(themeBadges(plan, 2)), [2, 0], 'the badges stay into the composing stage until its moment');
});

test('a theta grid composed in an earlier stage stays composed when a later stage restates its contributors', () => {
  const theme = theta(['theme'], ['Theme']), both = theta(['agent', 'theme'], ['Agent', 'Theme']);
  const record = { sentence: 'Mia bought books', derivationStages: [thetaStage([theme, both]),
    thetaStage([{ relation: 'Context', anchors: { head: 'v' } }, theme, both])] };
  const { replay } = replayOf(record), plan = replay.relationRenderPlan;
  const badges = frame => plan.frames[frame].items.filter(item => item.kind === 'node-badges' && item.badgeStyle === 'theta-role');
  // Stage 1 composes the grids at the Agent+Theme moment; neither claim's badges return in stage 2.
  assert.deepEqual(badges(0).map(item => planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`)), [['0:0']]);
  assert.deepEqual(badges(1), []);
  assert.deepEqual(checkMarkPersistence(replay, record), []);
  // Control: the Theme badges painted again beside the grid composing them with Agent+Theme.
  const { supersededAt: _yield, ...returned } = badges(0)[0];
  const broken = { ...replay, relationRenderPlan: { ...plan, frames: plan.frames.map((frame, index) => index === 1
    ? { ...frame, items: [...frame.items, { ...returned, appearsAtStage: 0 }] } : frame) } };
  const first = replay.playbackSteps.findIndex(step => step.replayFrameIndex === 1);
  assert(checkMarkPersistence(broken, record).some(found => found.subtype === 'composed-still-paints'
    && found.subject === 'node-badges theta.grid 0:0' && found.frame === first + 1));
});
