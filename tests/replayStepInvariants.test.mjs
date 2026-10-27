import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { planItemDependencyNodeIds, planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import {
  checkMovementUnrendered, checkObjectLanguageMetalanguage, checkRenamedAnchors, checkSelfSpelledRealizations
} from './helpers/replayContractWarnings.mjs';
import { checkMarkPersistence, checkStepSemantics, stepMarks } from './helpers/replayStepInvariants.mjs';

/* Controls for the rules the invariant sweep (replayInvariants.test.mjs) runs
 * over every committed analysis: production output satisfies each rule, and
 * each controlled break, including the visible change of a fixed historical
 * defect, is reported where it happens. */

const corpus = loadFixtureAnalyses();
const regression = name => corpus.records.find(item => item.id === `replay-regressions/${name}.json#`);
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true });
const sample = corpus.records.find(item => item.id === 'replay-regressions/workspace-historical-continuity.json#/cases/4').record;
const replay = prepare(sample), steps = replay.playbackSteps;
const edited = (base, edit) => {
  const copy = { ...base, playbackSteps: structuredClone(base.playbackSteps), relationRenderPlan: structuredClone(base.relationRenderPlan) };
  edit(copy.playbackSteps, copy.relationRenderPlan);
  return copy;
};
const reported = (findings, rule, subtype, frame, text) => findings.some(found => found.rule === rule && found.subtype === subtype
  && found.frame === frame && found.detail.includes(text));
const hide = (step, ids) => { step.replayVisibleNodeIds = step.replayVisibleNodeIds.filter(id => !ids.includes(id)); };
const subtree = (step, id) => d3.hierarchy(step.replayCanvasData).find(node => node.data.id === id).descendants().map(node => node.data.id);
const momentOf = (list, stage, relation) => list.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity.stageIndex === stage && step.replayRelationIdentity.relationIndex === relation);
const paintAs = (list, index, from) => Object.assign(list[index], {
  replayCanvasData: structuredClone(list[from].replayCanvasData), replayVisibleNodeIds: [...list[from].replayVisibleNodeIds] });

test('control: step-semantics reports empty steps, wrong child counts, repaints, removals and a movement that introduces nothing', () => {
  assert.deepEqual(checkStepSemantics(replay, sample), []);
  const merge = steps.findIndex(step => step.replayKind === 'micro' && step.operation === 'ExternalMerge'), target = steps[merge].targetNodeId;
  const check = edit => checkStepSemantics(edited(replay, edit), sample);
  assert(reported(check(list => list.splice(merge + 1, 0, structuredClone(list[merge]))), 'step-semantics', 'empty-step', merge + 2,
    `${target} attaches nothing new`));
  assert(reported(check(list => { list[merge].operation = 'Project'; }), 'step-semantics', 'child-count', merge + 1, `${target} projects over 2 children`));
  const select = steps.findIndex((step, index) => index > merge && step.replayKind === 'micro' && step.operation === 'LexicalSelect');
  const retained = [...frameStructure(steps[select - 1]).displayed].find(id => !id.includes('::'));
  assert(reported(check(list => { d3.hierarchy(list[select].replayCanvasData).find(node => node.data.id === retained).data.label = 'XP'; }),
    'step-semantics', 'unowned-repaint', select + 1, `${retained} repaints from`));
  const later = steps.findIndex(step => step.replayFrameIndex === 2 && step.replayKind === 'micro');
  assert(reported(check(list => hide(list[later], ['hier', 'hier::__leaf'])), 'step-semantics', 'authored-removal', later + 1,
    'hier disappears although stage 3 authors it'));
  const record = steps.findIndex(step => step.operation === 'StageRecord'), root = steps[record].targetNodeId;
  assert(reported(check(list => hide(list[record], subtree(list[record], root))), 'step-semantics', 'unowned-removal', record + 1,
    `${root} disappears at macro StageRecord`));
  const moment = momentOf(steps, 3, 1);
  assert(reported(check(list => hide(list[moment], ['adv', 'adv::__leaf'])), 'step-semantics', 'unowned-removal', moment + 1,
    'adv disappears at relation "subject A-movement"'));
  assert(reported(check(list => paintAs(list, moment - 1, moment)), 'step-semantics', 'movement-incomplete', moment + 1,
    'movement landing dpTP was already displayed'));
});

test('control: step-semantics finds a movement landing displayed under a node that stands for it, and only there', () => {
  // Claude Opus 5.5 (n3-23): the landing o2 painted as its new parent's stabilized
  // lexical leaf TP2::__lex_leaf, aliased o2, was reported as not displayed.
  const moment = momentOf(steps, 3, 1), landing = 'dpTP';
  const incomplete = edit => checkStepSemantics(edited(replay, edit), sample)
    .filter(found => found.subtype === 'movement-incomplete' && found.frame === moment + 1).map(found => found.detail);
  const standIn = (list, visible) => {
    const node = d3.hierarchy(list[moment].replayCanvasData).find(item => item.data.id === landing).data;
    Object.assign(node, { id: 'dpTPHost::__lex_leaf', aliasIds: [landing], replayOrigin: { kind: 'lexical', ownerId: 'dpTPHost', authoredId: landing } });
    list[moment].replayVisibleNodeIds = list[moment].replayVisibleNodeIds.filter(id => id !== landing).concat(visible ? [node.id] : []);
  };
  assert.deepEqual(incomplete(list => standIn(list, true)), []);
  assert.deepEqual(incomplete(list => standIn(list, false)), [`movement landing ${landing} is not displayed at relation "subject A-movement"`]);
  // A derived word leaf paints its owner's word, not the occurrence itself.
  assert.deepEqual(incomplete(list => {
    const node = d3.hierarchy(list[moment].replayCanvasData).find(item => item.data.id === landing).data;
    node.children = [...node.children ?? [], { id: `${landing}::__leaf`, label: 'x', word: 'x', replayOrigin: { kind: 'word', ownerId: landing } }];
    list[moment].replayVisibleNodeIds = list[moment].replayVisibleNodeIds.filter(id => id !== landing).concat(`${landing}::__leaf`);
  }), [`movement landing ${landing} is not displayed at relation "subject A-movement"`]);
// Opus s65 (opus-stress, stage 7): GB substitution. The moved subject lands
// in Spec-IP, replacing the authored empty NP there at its own moment.
const substitution = (emptyWord) => {
  const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
  const subject = () => node('npMtoto', 'NP', [node('nMtoto', 'N', [], { word: 'mtoto' })], { lineageId: 'mtoto' });
  const verbPhrase = object => node('ibar', 'I′', [node('iAli', 'I', [], { word: 'alinunuliwa' }),
    node('vp', 'VP', [node('tV', 'V', [], { silent: true }), object, node('npKitabu', 'NP', [], { word: 'kitabu' })])]);
  const empty = node('npE', 'NP', [], emptyWord ? { word: emptyWord } : { silent: true });
  const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Authored state.', relations, workspaceForest });
  return { sentence: 'Mtoto alinunuliwa kitabu.', derivationStages: [
    stage([node('ip', 'IP', [empty, verbPhrase(subject())])]),
    stage([node('ip', 'IP', [subject(), verbPhrase(node('tNP', 'NP', [], { lineageId: 'mtoto', silent: true }))])],
      [{ relation: 'NP-movement chain', anchors: { head: 'npMtoto', trace: 'tNP' }, values: { type: 'A-movement' } }])] };
};

test('step-semantics lets a landing replace the empty position it substitutes for, and no other removal', () => {
  const record = substitution(), prepared = prepare(record), list = prepared.playbackSteps, moment = momentOf(list, 1, 0);
  assert(frameStructure(list[moment - 1]).displayed.has('npE') && !frameStructure(list[moment]).displayed.has('npE'),
    'the empty position leaves at the movement moment');
  assert.deepEqual(checkStepSemantics(prepared, record).filter(found => found.subtype === 'unowned-removal'), []);
  assert(reported(checkStepSemantics(edited(prepared, copy => hide(copy[moment], ['tV'])), record),
    'step-semantics', 'unowned-removal', moment + 1, 'tV disappears'), 'another silent node is not the landing\'s position');
  const pronounced = substitution('huyu'), voiced = prepare(pronounced);
  assert(reported(checkStepSemantics(voiced, pronounced), 'step-semantics', 'unowned-removal', momentOf(voiced.playbackSteps, 1, 0) + 1,
    'npE disappears'), 'a pronounced occurrence is not an empty position');
});

test('historical: step-semantics reports a merge the preceding projection already showed (PR #78)', () => {
  for (const [name, child, parent, text] of [['retained-parent-attachment', 'embeddedCP', 'matrixVBar', 'matrixVBar attaches nothing new'],
    ['retained-head-attachment', 'tDid', 'tI', 'tI attaches nothing new']]) {
    const { record } = regression(name), fixed = prepare(record), list = fixed.playbackSteps;
    assert.deepEqual(checkStepSemantics(fixed, record), [], `${name} passes`);
    const merge = list.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === parent && step.operation === 'ExternalMerge');
    assert.equal(frameStructure(list[merge]).parent.get(child), parent);
    // Paint the merged tree one step early, as the layout scaffold did before the fix.
    assert(reported(checkStepSemantics(edited(fixed, copy => paintAs(copy, merge - 1, merge)), record), 'step-semantics', 'empty-step', merge + 1, text), name);
  }
});

test('historical: step-semantics reports lower copies silenced at an unrelated merge (PR #60)', () => {
  const { record } = regression('paired-retained-movement'), fixed = prepare(record);
  assert.deepEqual(checkStepSemantics(fixed, record), []);
  const moment = momentOf(fixed.playbackSteps, 4, 0);
  const broken = edited(fixed, list => {
    Object.assign(list[moment], { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 's1' });
    delete list[moment].replayRelationIdentity;
  });
  assert(reported(checkStepSemantics(broken, record), 'step-semantics', 'unowned-repaint', moment + 1, 'j1 repaints from DP "john" to DP "john" silent'));
});

const lastingMark = () => {
  const played = new Set();
  for (const [index, step] of steps.entries()) {
    if (index && steps[index - 1].replayFrameIndex !== step.replayFrameIndex) played.clear();
    if (step.replayKind === 'relation') played.add(step.replayRelationIdentity.relationIndex);
    const mark = index > momentOf(steps, 2, 0) && step.replayFrameIndex === 2 && stepMarks(replay.relationRenderPlan, step, played).find(item => item.painted);
    if (mark) return { index, anchor: planItemDependencyNodeIds(mark.item)[0] };
  }
};

test('control: mark-persistence reports a hidden authored anchor, a dropped lasting mark and a late start', () => {
  assert.deepEqual(checkMarkPersistence(replay, sample), []);
  const { index, anchor } = lastingMark();
  const hidden = checkMarkPersistence(edited(replay, list => hide(list[index], subtree(list[index], anchor))), sample);
  assert(reported(hidden, 'mark-persistence', 'hidden-anchor', index + 1, `ends because ${anchor} is not displayed, although stage 3 authors it`));
  assert(reported(hidden, 'mark-persistence', 'paints-again', index + 2, 'paints again after ending'));
  const dropped = edited(replay, (_list, plan) => {
    plan.frames.forEach(frame => frame.items.filter(item => item.relationRef.stageIndex === 2).forEach(item => { item.persistence = 'from-stage-onward'; }));
    plan.frames[3].items = plan.frames[3].items.filter(item => item.relationRef.stageIndex !== 2);
  });
  assert(reported(checkMarkPersistence(dropped, sample), 'mark-persistence', 'dropped', momentOf(steps, 3, 0) + 1,
    'ends while its anchors remain and its from-stage-onward persistence continues'));
  const moment = momentOf(steps, 3, 1);
  assert(reported(checkMarkPersistence(edited(replay, list => hide(list[moment], subtree(list[moment], 'dpLow'))), sample),
    'mark-persistence', 'late-start', moment + 2, `first paints after its moment at frame ${moment + 1}`));
});

test('control: mark-persistence judges marks from the authored moments, so a broken production selector is reported, not trusted', () => {
  const { index, anchor } = lastingMark();
  for (const select of [() => false, () => true]) {
    const findings = checkMarkPersistence(replay, sample, { select });
    assert(findings.length && findings.every(found => found.subtype === 'reveal-selector'), `${select}`);
    const hidden = checkMarkPersistence(edited(replay, list => hide(list[index], subtree(list[index], anchor))), sample, { select });
    assert(reported(hidden, 'mark-persistence', 'hidden-anchor', index + 1, anchor), `${select} still reports the hidden anchor`);
  }
});

test('historical: mark-persistence reports a trajectory that ends and paints again around a vanishing source (PR #70)', () => {
  const { record } = regression('shared-landing-source'), fixed = prepare(record);
  assert.deepEqual(checkMarkPersistence(fixed, record), []);
  const first = fixed.playbackSteps.findIndex(step => step.replayFrameIndex === 2);
  const broken = checkMarkPersistence(edited(fixed, list => hide(list[first], ['whEmbedded', 'whNBar', 'whN', 'whN::__leaf'])), record);
  assert(reported(broken, 'mark-persistence', 'paints-again', first + 2, 'trajectory tier2.movement-path 1:0 paints again'));
});

test('control: renamed-anchor reports a persistent anchor renamed with the same lineage, and not one that keeps its id', () => {
  assert.deepEqual(checkRenamedAnchors(replay, sample), []);
  const renamed = structuredClone(sample), find = (forest, id) => d3.hierarchy({ children: forest }).find(node => node.data.id === id).data;
  find(renamed.derivationStages[3].workspaceForest, 'tense').lineageId = 'finiteT';
  Object.assign(find(renamed.derivationStages[4].workspaceForest, 'tense'), { id: 'tenseAtC', lineageId: 'finiteT' });
  assert.deepEqual(checkRenamedAnchors(prepare(renamed), renamed).map(found => found.detail),
    ['stage 5 replaces tense (lineage finiteT) with tenseAtC; the marks of 3:2 end there']);
  const kept = structuredClone(regression('renamed-head-anchors').record);
  const restore = node => { if (node.id === 'v2') node.id = 'v1'; (node.children ?? []).forEach(restore); };
  kept.derivationStages.slice(2).forEach(stage => {
    stage.workspaceForest.forEach(restore);
    stage.relations.forEach(relation => Object.entries(relation.anchors).forEach(([role, id]) => { if (id === 'v2') relation.anchors[role] = 'v1'; }));
  });
  assert(!checkRenamedAnchors(prepare(kept), kept).some(found => found.detail.includes('replaces v1')));
});

test('control: self-spelled-realization reports a group that joins written words, and not one inside a written word', () => {
  const korean = regression('unrendered-head-movement'), contract = korean.contract;
  assert.deepEqual(checkSelfSpelledRealizations(korean.record, { contract }), [], 'a noun and its particle are one written word');
  const joined = structuredClone(korean.record), groups = joined.derivationStages[0].realizations;
  groups.splice(0, 2, { nodeIds: [...groups[0].nodeIds, ...groups[1].nodeIds], tokenIndices: [...groups[0].tokenIndices, ...groups[1].tokenIndices] });
  assert.deepEqual(checkSelfSpelledRealizations(joined, { contract }).map(found => found.subtype), ['self-spelled-realization']);
  assert.deepEqual(checkSelfSpelledRealizations(joined, {}), [], 'tokenizer-era groups are not judged');
});

test('control: object-language-metalanguage reports names written in the sentence\'s script, and not cited input words', () => {
  const korean = regression('unrendered-head-movement').record;
  assert.deepEqual(checkObjectLanguageMetalanguage(korean), []);
  const cited = structuredClone(korean), written = structuredClone(korean);
  cited.derivationStages[0].relations[0].relation = 'licensing of the particle "께서"';
  written.derivationStages[0].relations[0].relation = '주제역 부여';
  assert.deepEqual(checkObjectLanguageMetalanguage(cited), []);
  assert.match(checkObjectLanguageMetalanguage(written)[0].detail, /^1 relation names, 0 role names and 0 labels are written in Hangul script/);
});

test('control: movement-unrendered reports a proved movement whose path is gone', () => {
  assert.deepEqual(checkMovementUnrendered(replay, sample), []);
  const pathless = edited(replay, (_list, plan) => plan.frames.forEach(frame => {
    frame.items = frame.items.filter(item => !planItemRelationRefs(item).some(ref => ref.stageIndex === 3 && ref.relationIndex === 1));
  }));
  assert.deepEqual(checkMovementUnrendered(pathless, sample).map(found => [found.frame, found.subtype]),
    [[momentOf(steps, 3, 1) + 1, 'MOVEMENT_TRANSITION_WITHOUT_PATH']]);
});

test('control: movement-unrendered reports a displacement that no path reaches, whatever its claim calls its fields', () => {
  const { record } = corpus.records.find(item => item.id === 'replay-regressions/unnamed-movement-roles.json#/cases/1');
  assert.deepEqual(checkMovementUnrendered(prepare(record), record), [],
    'drawn movements and the shared identity of stage 2, which displaces nothing, are not reported');
  // An open field name that no recognition reads leaves the copies neutral,
  // as "landings" was before it inflected like "sources".
  const unread = structuredClone(record), anchors = unread.derivationStages[5].relations[0].anchors;
  anchors.arrivals = anchors.landings;
  delete anchors.landings;
  const neutral = prepare(unread);
  assert.deepEqual(checkMovementUnrendered(neutral, unread).map(found => [found.frame, found.subtype, found.subject]),
    [[momentOf(neutral.playbackSteps, 5, 0) + 1, 'COPY_WITHOUT_PATH', '5:0']]);
});

test('historical: step-semantics reports a movement whose landing and path arrive with a later claim (59-en-wh-island)', () => {
  const { record } = regression('landing-claimed-again'), fixed = prepare(record);
  assert.deepEqual(checkStepSemantics(fixed, record), []);
  const moment = momentOf(fixed.playbackSteps, 11, 0);
  // Before the fix the movement moment repeated the preceding frame, and the
  // next claim of the stage drew the landing, its C′ and the path.
  const broken = edited(fixed, list => {
    paintAs(list, moment, moment - 1);
    list[moment].replayRelationLinks = structuredClone(list[moment - 1].replayRelationLinks);
  });
  assert(reported(checkStepSemantics(broken, record), 'step-semantics', 'trajectory-off-moment', moment + 2,
    `the movement path of relation 11:0 first appears at frame ${moment + 2}, not at its own moment at frame ${moment + 1}`));
});

test('historical: mark-persistence counts a relation-only mark coalescing two claims once per claim (48-en-gapping)', () => {
  const { record } = regression('coalesced-relation-only-mark'), fixed = prepare(record), list = fixed.playbackSteps;
  const shared = fixed.relationRenderPlan.frames[0].items.find(item => item.kind === 'fallback' && item.persistence === 'relation-only'
    && planItemRelationRefs(item).length === 2);
  assert.deepEqual(planItemRelationRefs(shared).map(ref => ref.relationIndex), [2, 4], 'one relation-only mark holds both claims');
  assert.deepEqual(checkMarkPersistence(fixed, record), []);
  // The claim of relation 3 played again at relation 5's step paints its mark a second time.
  const second = momentOf(list, 0, 4);
  const repeated = checkMarkPersistence(edited(fixed, copy => { copy[second].replayRelationIdentity = { stageIndex: 0, relationIndex: 2 }; }), record);
  assert(reported(repeated, 'mark-persistence', 'paints-again', second + 1, `fallback 0:2 paints again after ending at frame ${second}`));
});
