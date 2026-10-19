import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import {
  checkAttachAtMerge, checkInputUnchanged, checkLandingAttached, checkMarksAtOwningMoment, checkMovementLandingParent, checkNoEarlyReveal,
  checkNoVisibleScaffolding, checkOneLetterPerLabel, checkParentAfterChildren, checkRelationMoments, checkStableConstruction,
  checkStageCompletion, checkVisibleInCanvas, frameStructure
} from './helpers/replayInvariants.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { matchFindings } from './helpers/findings.mjs';
import { checkContractWarnings } from './helpers/replayContractWarnings.mjs';
import { STEP_EXCEPTIONS } from './helpers/replayStepExceptions.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';

const corpus = loadFixtureAnalyses();
const sample = corpus.records.find(entry => entry.id === 'replay-regressions/workspace-historical-continuity.json#/cases/4').record;
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true });
const replay = prepare(sample);
const steps = replay.playbackSteps;
const breakReplay = edit => {
  const copy = { ...replay, playbackSteps: structuredClone(steps), relationRenderPlan: structuredClone(replay.relationRenderPlan) };
  edit(copy.playbackSteps, copy.relationRenderPlan);
  return copy;
};
const reported = (violations, rule, frame, text) => violations.some(violation => violation.rule === rule
  && violation.frame === frame && violation.detail.includes(text));
const hiddenNodes = step => [...frameStructure(step).nodes].filter(([id, node]) => !frameStructure(step).displayed.has(id)
  && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'layout' && node.data.replayOrigin?.kind !== 'workspace');
const lastOfStage = stage => steps.findLastIndex(step => step.replayFrameIndex === stage);
const relationMoments = steps.flatMap((step, index) => step.replayKind === 'relation' ? [index] : []);

/* Controls: the unbroken sample satisfies every rule, and each checker reports
 * the exact break its rule forbids. */

test('control: input-unchanged reports a preparation that writes into the authored record', () => {
  const record = structuredClone(sample), authored = JSON.stringify(record);
  prepareReplay({ ...record, includePlayback: true });
  assert.deepEqual(checkInputUnchanged(authored, record), []);
  record.derivationStages[1].workspaceForest[0].replayLayoutOnly = true;
  assert(reported(checkInputUnchanged(authored, record), 'input-unchanged', null, 'changed the authored record'));
});

test('control: no-visible-scaffolding reports a visible future-layout node', () => {
  assert.deepEqual(checkNoVisibleScaffolding(replay), []);
  const index = steps.findIndex(step => [...frameStructure(step).nodes.values()].some(node => node.data.replayLayoutOnly));
  assert(index >= 0, 'the sample uses future layout scaffolding');
  const [id] = [...frameStructure(steps[index]).nodes].find(([, node]) => node.data.replayLayoutOnly);
  const broken = breakReplay(copy => copy[index].replayVisibleNodeIds.push(id));
  assert(reported(checkNoVisibleScaffolding(broken), 'no-visible-scaffolding', index + 1, id));
});

test('control: stage-completion reports a missing node, a reordered fork, a hidden word and a changed word', () => {
  assert.deepEqual(checkStageCompletion(replay, sample), []);
  const stage = 2, index = lastOfStage(stage), frame = index + 1;
  const hidden = breakReplay(copy => {
    copy[index].replayVisibleNodeIds = copy[index].replayVisibleNodeIds.filter(id => !['hier', 'hier::__leaf'].includes(id));
  });
  assert(reported(checkStageCompletion(hidden, sample), 'stage-completion', frame, 'authored hier is not displayed'));
  const reordered = breakReplay(copy => {
    const fork = d3.hierarchy(copy[index].replayCanvasData).find(node => node.data.id === 'littleVBar');
    fork.data.children.reverse();
  });
  assert(reported(checkStageCompletion(reordered, sample), 'stage-completion', frame, 'littleVBar shows children [vpAdj,littleV]'));
  const unspoken = breakReplay(copy => {
    copy[index].replayVisibleNodeIds = copy[index].replayVisibleNodeIds.filter(id => id !== 'hier::__leaf');
  });
  assert(reported(checkStageCompletion(unspoken, sample), 'stage-completion', frame, 'hier shows word "", authored "hier"'));
  const reworded = breakReplay(copy => {
    d3.hierarchy(copy[index].replayCanvasData).find(node => node.data.id === 'hier::__leaf').data.word = 'dort';
  });
  assert(reported(checkStageCompletion(reworded, sample), 'stage-completion', frame, 'hier shows word "dort", authored "hier"'));
});

test('control: a waiting root projection is allowed only until a later relation moment that no earlier relation pre-empts', () => {
  const record = corpus.records.find(entry => entry.id === 'replay-regressions/nested-premovement-width.json#').record;
  const waiting = prepare(record), completion = waiting.playbackSteps.findLastIndex(step => step.replayFrameIndex === 0) + 1;
  assert(!frameStructure(waiting.playbackSteps[completion - 1]).displayed.has('matrixCP'), 'stage 1 withholds its unary CP');
  assert.deepEqual(checkStageCompletion(waiting, record), []);
  const reveal = waiting.playbackSteps.findIndex(step => frameStructure(step).displayed.has('matrixCP'));
  const ordinary = { ...waiting, playbackSteps: structuredClone(waiting.playbackSteps) };
  ordinary.playbackSteps[reveal].replayKind = 'micro';
  assert(reported(checkStageCompletion(ordinary, record), 'stage-completion', completion, 'authored matrixCP is not displayed'));
  const named = structuredClone(record);
  named.derivationStages[0].relations.push({ relation: 'clause typing', anchors: { clause: 'matrixCP' } });
  assert(reported(checkStageCompletion(waiting, named), 'stage-completion', completion, 'authored matrixCP is not displayed'));
});

test('control: relation-moments reports a lost, repeated, misplaced or needlessly reordered moment', () => {
  assert.deepEqual(checkRelationMoments(replay, sample), []);
  const [first, second] = relationMoments.filter(index => steps[index].replayFrameIndex === 3);
  assert(second !== undefined, 'the sample stage has two separate relations');
  const lost = breakReplay(copy => { copy[first].replayKind = 'micro'; });
  assert(reported(checkRelationMoments(lost, sample), 'relation-moments', null, 'relation 3:0 (V-to-T head movement) has 0 moments'));
  const repeated = breakReplay(copy => copy.splice(second + 1, 0, structuredClone(copy[second])));
  assert(reported(checkRelationMoments(repeated, sample), 'relation-moments', second + 2, 'has 2 moments'));
  const misplaced = breakReplay(copy => { copy[first].replayFrameIndex = 2; });
  assert(reported(checkRelationMoments(misplaced, sample), 'relation-moments', first + 1, 'plays in stage 3, not its own stage 4'));
  const reordered = breakReplay(copy => {
    [copy[first].replayRelationIdentity, copy[second].replayRelationIdentity] = [copy[second].replayRelationIdentity, copy[first].replayRelationIdentity];
  });
  assert(reported(checkRelationMoments(reordered, sample), 'relation-moments', second + 1,
    'relation 3:0 plays after later authored relation 3:1 without waiting for syntax it introduces'));
});

test('control: landing-attached reports a movement landing shown before the parent it joins', () => {
  assert.deepEqual(checkLandingAttached(replay), []);
  const index = steps.findIndex(step => step.replayKind === 'relation' && (step.replayRelationLinks ?? []).some(link =>
    link.movementTransition === true && link.authoredRelationKey === `${step.replayRelationIdentity.stageIndex}:${step.replayRelationIdentity.relationIndex}`));
  assert(index >= 0, 'the sample has a movement moment');
  const { targetNodeId } = steps[index].replayRelationLinks.find(link => link.movementTransition === true);
  const landing = [...frameStructure(steps[index]).nodes.values()].find(node => node.data.id === targetNodeId);
  const parent = landing.parent.data.id;
  const detached = breakReplay(copy => { copy[index].replayVisibleNodeIds = copy[index].replayVisibleNodeIds.filter(id => id !== parent); });
  assert(reported(checkLandingAttached(detached), 'landing-attached', index + 1, `${targetNodeId} lands without its parent ${parent}`));
});

test('control: no-early-reveal reports syntax first shown by a micro-step, a relation moment or a completed stage', () => {
  assert.deepEqual(checkNoEarlyReveal(replay), []);
  const later = (id, index) => steps.slice(index + 1).some(step => frameStructure(step).displayed.has(id));
  for (const kind of ['micro', 'relation']) {
    const index = steps.findIndex((step, position) => step.replayKind === kind && hiddenNodes(step).some(([id]) => later(id, position)));
    assert(index >= 0, `the sample has a ${kind} step before later syntax`);
    const [id] = hiddenNodes(steps[index]).find(([candidate]) => later(candidate, index));
    const broken = breakReplay(copy => copy[index].replayVisibleNodeIds.push(id));
    assert(reported(checkNoEarlyReveal(broken), 'no-early-reveal', index + 1, `${id} appears at ${kind}`), `${kind} reveal of ${id}`);
  }
  const completion = lastOfStage(2), id = steps[completion - 1].targetNodeId;
  const first = steps.findIndex(step => frameStructure(step).displayed.has(id));
  const unbuilt = breakReplay(copy => copy.slice(first, completion).forEach(step => {
    step.replayVisibleNodeIds = step.replayVisibleNodeIds.filter(visible => visible !== id);
  }));
  assert(reported(checkNoEarlyReveal(unbuilt), 'no-early-reveal', completion + 1, `${id} appears at macro StageRecord`));
});

test('control: parent-after-children reports a new parent without its child and a retained parent that loses one', () => {
  assert.deepEqual(checkParentAfterChildren(replay), []);
  const merge = steps.findIndex(step => step.replayKind === 'micro' && step.operation === 'ExternalMerge');
  const [child] = frameStructure(steps[merge]).children.get(steps[merge].targetNodeId);
  const early = breakReplay(copy => { copy[merge].replayVisibleNodeIds = copy[merge].replayVisibleNodeIds.filter(id => id !== child); });
  assert(reported(checkParentAfterChildren(early), 'parent-after-children', merge + 1, `${child} is hidden under displayed ${steps[merge].targetNodeId}`));
  const retained = breakReplay(copy => { copy[merge + 1].replayVisibleNodeIds = copy[merge + 1].replayVisibleNodeIds.filter(id => id !== child); });
  assert(frameStructure(steps[merge + 1]).displayed.has(steps[merge].targetNodeId));
  assert(reported(checkParentAfterChildren(retained), 'parent-after-children', merge + 2, `${child} is hidden under displayed`));
});

test('control: stable-construction reports retained syntax that disappears or moves at another target\'s step', () => {
  assert.deepEqual(checkStableConstruction(replay), []);
  const retained = index => [...frameStructure(steps[index - 1]).displayed].find(id => id !== steps[index].targetNodeId
    && frameStructure(steps[index - 1]).parent.get(id) && frameStructure(steps[index]).displayed.has(id)
    && frameStructure(steps[index]).parent.get(id) === frameStructure(steps[index - 1]).parent.get(id));
  const index = steps.findIndex((step, i) => i > 0 && step.replayKind === 'micro' && retained(i));
  const id = retained(index);
  const removed = breakReplay(copy => { copy[index].replayVisibleNodeIds = copy[index].replayVisibleNodeIds.filter(item => item !== id); });
  assert(reported(checkStableConstruction(removed), 'stable-construction', index + 1, `${id} disappears`));
  // The renderer draws an edge only between two visible nodes, so hiding the
  // parent leaves its child as a separate root, not under a visible grandparent.
  const nested = steps.findIndex((step, i) => i > 0 && step.replayKind === 'micro' && retained(i)
    && frameStructure(steps[i]).parent.get(frameStructure(steps[i - 1]).parent.get(retained(i))));
  const child = retained(nested), hidden = frameStructure(steps[nested - 1]).parent.get(child);
  const unparented = breakReplay(copy => { copy[nested].replayVisibleNodeIds = copy[nested].replayVisibleNodeIds.filter(item => item !== hidden); });
  assert.equal(frameStructure(unparented.playbackSteps[nested]).parent.get(child), null);
  assert(reported(checkStableConstruction(unparented), 'stable-construction', nested + 1, `${child} is detached from ${hidden}`));
});

test('control: attach-at-merge reports a child attached to its retained parent before that parent\'s merge', () => {
  assert.deepEqual(checkAttachAtMerge(replay), []);
  const record = corpus.records.find(entry => entry.id === 'replay-regressions/retained-parent-attachment.json#').record;
  const held = prepare(record), projection = held.playbackSteps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'embeddedCP');
  const merge = held.playbackSteps.findIndex((step, index) => index > projection && step.targetNodeId === 'matrixVBar');
  assert.deepEqual(checkAttachAtMerge(held), []);
  assert.equal(frameStructure(held.playbackSteps[merge]).parent.get('embeddedCP'), 'matrixVBar', 'the merge attaches the CP');
  // Paint the merged tree at the CP's projection, as the layout scaffold once did.
  const early = { ...held, playbackSteps: structuredClone(held.playbackSteps) };
  Object.assign(early.playbackSteps[projection], { replayCanvasData: structuredClone(held.playbackSteps[merge].replayCanvasData),
    replayVisibleNodeIds: [...held.playbackSteps[merge].replayVisibleNodeIds] });
  assert.deepEqual(checkAttachAtMerge(early).map(item => [item.frame, item.detail]),
    [[projection + 1, 'embeddedCP attaches to matrixVBar at micro Project (target embeddedCP)']]);
  const merged = { ...held, playbackSteps: structuredClone(held.playbackSteps) };
  merged.playbackSteps[merge].targetNodeId = 'embeddedCP';
  assert(reported(checkAttachAtMerge(merged), 'attach-at-merge', merge + 1, 'embeddedCP attaches to matrixVBar'),
    'the same attachment at a step that does not target the parent');
});

test('control: visible-in-canvas reports a visible id with no canvas node', () => {
  assert.deepEqual(checkVisibleInCanvas(replay), []);
  const stale = breakReplay(copy => { copy[3].replayVisibleNodeIds = [...copy[3].replayVisibleNodeIds, 'not-a-canvas-node']; });
  assert(reported(checkVisibleInCanvas(stale), 'visible-in-canvas', 4, 'not-a-canvas-node is visible but absent'));
});

test('control: one-letter-per-label reports a letter painted twice beside one label and a letter painted nowhere', () => {
  // A relative operator's movement chain, its binding restatement and an identity
  // coindex each assert i at the silent operator and its trace.
  const record = corpus.records.find(entry => entry.id === 'replay-regressions/independent-clause-and-realization.json#').record;
  const relative = prepare(record);
  assert.deepEqual(checkOneLetterPerLabel(relative), []);
  const everyLetter = checkOneLetterPerLabel(relative, () => () => ({ draw: 'glyph', label: null, alsoFor: [] }));
  assert(reported(everyLetter, 'one-letter-per-label', 22, 'operatorHigh shows i 3 times'));
  assert(reported(everyLetter, 'one-letter-per-label', 20, 'operatorTrace shows i 2 times'));
  const noLetter = checkOneLetterPerLabel(relative, () => () => ({ draw: 'none' }));
  assert(reported(noLetter, 'one-letter-per-label', 22, 'operatorHigh shows i 0 times'));
});

test('control: marks-at-owning-moment reports a mark before its moment and a mark whose moment never plays', () => {
  assert.deepEqual(checkMarksAtOwningMoment(replay), []);
  const momentOf = (stage, relation) => steps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity.stageIndex === stage && step.replayRelationIdentity.relationIndex === relation);
  const firstOfStage = stage => steps.findIndex(step => step.replayFrameIndex === stage);
  const early = replay.relationRenderPlan.frames.flatMap(frame => frame.items).find(item => item.appearsAtStage === item.relationRef.stageIndex
    && momentOf(item.relationRef.stageIndex, item.relationRef.relationIndex) > firstOfStage(item.relationRef.stageIndex));
  assert(early, 'the sample has a mark whose moment follows construction');
  const premature = breakReplay((_copy, plan) => plan.frames[early.relationRef.stageIndex].items
    .filter(item => item.relationRef.stageIndex === early.relationRef.stageIndex
      && item.relationRef.relationIndex === early.relationRef.relationIndex && item.appearsAtStage === early.appearsAtStage)
    .forEach(item => { item.appearsAtStage -= 1; }));
  assert(reported(checkMarksAtOwningMoment(premature), 'marks-at-owning-moment', firstOfStage(early.relationRef.stageIndex) + 1,
    `${early.relationRef.stageIndex}:${early.relationRef.relationIndex} is revealed before its owning moment`));
  const lasting = replay.relationRenderPlan.frames.at(-1).items.find(item => item.relationRef.stageIndex < steps.at(-1).replayFrameIndex);
  assert(lasting, 'the sample has a mark that persists into a later stage');
  const unplayed = breakReplay(copy => { copy[momentOf(lasting.relationRef.stageIndex, lasting.relationRef.relationIndex)].replayKind = 'micro'; });
  assert(checkMarksAtOwningMoment(unplayed).some(violation => violation.rule === 'marks-at-owning-moment'
    && violation.detail.includes(`${lasting.relationRef.stageIndex}:${lasting.relationRef.relationIndex} is revealed`)));
});

test('control: movement-landing-parent reports a movement moment that paints its landing without the new parent attaching it', () => {
  // GPT-6.1 Sol analysis 6 of 我昨天看见的那个人走了。: the subject movement lands
  // beside T′ (matrixTProjection), the new parent over TP's earlier T and vP.
  const record = corpus.records.find(entry => entry.id === 'replay-regressions/waiting-root-continuity.json#').record;
  const prepared = prepare(record), moment = prepared.playbackSteps.findIndex(step => step.operation === 'Matrix subject movement and licensing');
  assert.deepEqual(checkMovementLandingParent(prepared, record), []);
  assert.deepEqual(frameStructure(prepared.playbackSteps[moment]).children.get('matrixTP'), ['subjectHigher', 'matrixTProjection']);
  const withheld = { ...prepared, playbackSteps: structuredClone(prepared.playbackSteps) };
  const step = withheld.playbackSteps[moment];
  step.replayVisibleNodeIds = step.replayVisibleNodeIds.filter(id => id !== 'matrixTProjection');
  assert(reported(checkMovementLandingParent(withheld, record), 'movement-landing-parent', moment + 1,
    'matrixTProjection is not painted beside landing subjectHigher under matrixTP'));
});

/* The sweep: every rule on every frame of every committed saved analysis.
 * Real defects stay listed below with the exact subject node of each violation;
 * a new violation fails, and so does a listed one that no longer occurs. */

const FIRST_STAGE_REWRITE = 'Defect: a first-stage movement claim with no preceding stage to prove its source becomes a neutral rewrite; '
  + 'its moment shows only the anchored root of the rewritten phrase, and the rest of that phrase appears later with an ordinary merge.';
const CONTEXT_MERGE_AT_MOMENT = 'Defect (diagnosed RELATION_TIMING_CONFLICT): continued V-to-I is authored before the I-to-C movement '
  + 'that builds its context, and each needs syntax the other introduces, so no Replay order satisfies both and authored order is '
  + 'kept; its moment reveals the ordinary merge C′ instead of giving C′ its own step.';

const KNOWN_DEFECTS = [
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/0', 'parent-after-children', 16, 'detP portraitBar'],
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/0', 'no-early-reveal', 17,
    'detP portraitBar detBar nPortrait ofPP detWhich nPortrait::__leaf ofPbar detWhich::__leaf pOf npSelf pOf::__leaf selfBar nSelf nSelf::__leaf'],
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/2', 'parent-after-children', 19, 'argumentDbar'],
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/2', 'no-early-reveal', 23,
    'argumentDbar demonstrativeD childrenNP demonstrativeD::__leaf childrenNbar childrenN childrenN::__leaf'],
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/3', 'parent-after-children', 37, 'sdh moh'],
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/3', 'no-early-reveal', 38,
    'sdh moh donoh studenth moh::__leaf donoh::__leaf studenth::__leaf'],
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/4', 'parent-after-children', 37, 'sdh moh'],
  [FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/4', 'no-early-reveal', 38,
    'sdh moh donoh studenth moh::__leaf donoh::__leaf studenth::__leaf'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/independent-clause-and-realization.json#', 'parent-after-children', 20, 'operatorHighNbar'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/independent-clause-and-realization.json#', 'no-early-reveal', 21, 'operatorHighNbar operatorHighN'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/receiving-head-material.json#', 'parent-after-children', 20, 'booksDbar'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/receiving-head-material.json#', 'no-early-reveal', 21,
    'booksDbar booksD booksNP booksNbarOuter booksNbarInner demP bookN demBar bookN::__leaf dem dem::__leaf'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'parent-after-children', 11, 'rVAtT rvAtTLeaf'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'no-early-reveal', 12, 'rVAtT rvAtTLeaf rVAtT::__leaf'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'parent-after-children', 28, 'mVAtT mvAtTLeaf'],
  [FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'no-early-reveal', 29, 'mVAtT mvAtTLeaf mVAtT::__leaf'],
  [CONTEXT_MERGE_AT_MOMENT, 'replay-regressions/case-source-transfer.json#', 'no-early-reveal', 28, 'cbar'],
];

// A node revealed at a step that does not own it is one defect, reported by
// no-early-reveal; that step's attachment of the same node is not reported again.
const REPORTED_BY = new Map([['attach-at-merge', 'no-early-reveal']]);
const subjectOf = violation => violation.detail.split(' ')[0];

const RULES = ['input-unchanged', 'no-visible-scaffolding', 'stage-completion', 'relation-moments', 'landing-attached',
  'no-early-reveal', 'parent-after-children', 'stable-construction', 'attach-at-merge', 'movement-landing-parent', 'visible-in-canvas',
  'marks-at-owning-moment', 'one-letter-per-label'];
let sweep;
before(() => {
  sweep = corpus.records.map(({ id, record, contract }) => {
    try {
      const authored = structuredClone(record), snapshot = JSON.stringify(authored);
      const prepared = prepareReplay({ ...authored, includePlayback: true });
      return { id, frames: prepared.playbackSteps.length, violations: [
        ...checkInputUnchanged(snapshot, authored), ...checkNoVisibleScaffolding(prepared), ...checkStageCompletion(prepared, authored),
        ...checkRelationMoments(prepared, authored), ...checkLandingAttached(prepared), ...checkNoEarlyReveal(prepared),
        ...checkParentAfterChildren(prepared), ...checkStableConstruction(prepared), ...checkAttachAtMerge(prepared),
        ...checkMovementLandingParent(prepared, authored), ...checkVisibleInCanvas(prepared),
        ...checkMarksAtOwningMoment(prepared), ...checkOneLetterPerLabel(prepared)
      ], findings: [...checkStepSemantics(prepared, authored), ...checkMarkPersistence(prepared, authored),
        ...checkContractWarnings(prepared, authored, { contract })] };
    } catch (error) { return { id, error }; }
  });
});

test('the sweep accounts for every committed analysis with derivationStages', () => {
  assert.deepEqual(corpus.excluded.map(entry => entry.id), ['raw/mia-laughed.xbar.json#/payload', 'raw/what-did-mia-see.xbar.json#/payload']);
  assert.deepEqual(corpus.records.filter(entry => entry.sentenceSource !== 'saved').map(entry => entry.id), [
    'movement/saved-qualification.json#/0', 'movement/saved-qualification.json#/1', 'movement/saved-qualification.json#/2',
    'movement/saved-qualification.json#/3', 'normalized/mia-laughed.xbar.json#/analyses/0', 'normalized/what-did-mia-see.xbar.json#/analyses/0'
  ], 'records without a saved sentence are checked with their final pronounced words');
  assert.deepEqual(sweep.filter(entry => entry.error).map(entry => `${entry.id}: ${entry.error.message}`), [], 'every record prepares');
  assert(corpus.records.length > 100 && sweep.reduce((count, entry) => count + (entry.frames ?? 0), 0) > 5000);
});

for (const rule of RULES) test(`sweep: ${rule} holds on every frame of every committed analysis, apart from listed defects`, () => {
  const key = (id, frame, subject) => `${id} frame ${frame}: ${subject}`;
  const expected = new Set(KNOWN_DEFECTS.filter(entry => entry[2] === rule)
    .flatMap(([, id, , frame, subjects]) => subjects.split(' ').map(subject => key(id, frame, subject))));
  const reportedElsewhere = (violations, violation) => violations.some(other => other.rule === REPORTED_BY.get(rule)
    && other.frame === violation.frame && subjectOf(other) === subjectOf(violation));
  const found = sweep.flatMap(entry => (entry.violations ?? [])
    .filter(violation => violation.rule === rule && !reportedElsewhere(entry.violations, violation))
    .map(violation => ({ key: key(entry.id, violation.frame, subjectOf(violation)), text: `${entry.id} frame ${violation.frame}: ${violation.detail}` })));
  assert.deepEqual(found.filter(violation => !expected.has(violation.key)).map(violation => violation.text), [], 'new violations');
  const keys = new Set(found.map(violation => violation.key));
  assert.deepEqual([...expected].filter(entry => !keys.has(entry)), [], 'listed defects that no longer occur; remove them from KNOWN_DEFECTS');
});

// A step-semantics finding at the frame and subject where a construction rule
// reports is that rule's defect, not a second one.
const CONSTRUCTION = new Set(['no-early-reveal', 'stable-construction', 'attach-at-merge']);
test('sweep: step semantics, mark persistence and contract warnings hold on every committed analysis, apart from listed exceptions', () => {
  const findings = sweep.flatMap(entry => (entry.findings ?? []).filter(found => found.rule !== 'step-semantics'
    || !(entry.violations ?? []).some(other => CONSTRUCTION.has(other.rule) && other.frame === found.frame && subjectOf(other) === found.subject))
    .map(found => ({ ...found, record: entry.id, viewport: null, measure: null })));
  const { unexpected, exceeded, stale } = matchFindings(findings, STEP_EXCEPTIONS);
  assert.deepEqual(unexpected.map(found => `${found.record} frame ${found.frame} ${found.rule}/${found.subtype}: ${found.detail}`), [], 'new findings');
  assert.deepEqual(exceeded, []);
  assert.deepEqual(stale.map(({ exception, frame }) => `${exception.record} frame ${frame} ${exception.rule}/${exception.subtype}: ${exception.subject}`),
    [], 'listed exceptions that no longer occur; remove them from replayStepExceptions.mjs');
});
