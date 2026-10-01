import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const leaf = (id, label, word) => ({ id, label, ...(word ? { word } : {}), children: [] });
const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations });
const find = (node, id) => node?.id === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
const cases = [
  { name: 'past-conditioned stem allomorphy', before: '書く', after: '書い', priorRole: 'lexicalForm',
    values: { lexicalCitationForm: '書く', surfaceStem: '書い', process: 'i-onbin before past た' }, pastBefore: 'た' },
  { name: 'past-tense morphological realization', before: '読む', after: '読ん', priorRole: 'lexicalVerb',
    values: { lexicalVerb: '読む', stemAllomorph: '読ん', pastAllomorph: 'だ', surfaceWord: '読んだ' }, pastBefore: undefined }
];

for (const c of cases) test(`${c.name}: the recovered output changes at its own moment, not the Stage Record`, () => {
  const forest = (word, past) => [{ id: 'infl', label: 'I⁰', children: [
    leaf('stem', 'V⁰', word), leaf('tense', 'I⁰[past]', past)
  ] }];
  const relation = { relation: c.name, anchors: { morphologicalDomain: 'infl', stem: 'stem', conditioner: 'tense' },
    priorAnchors: { [c.priorRole]: 'stem', conditioner: 'tense' }, values: c.values };
  const stages = [stage(forest(c.before, c.pastBefore)), stage(forest(c.after, c.pastBefore ?? 'だ'), [
    { relation: 'Independent context', anchors: { context: 'infl' } },
    relation,
    { relation: 'orthographic input association', anchors: { stem: 'stem' }, values: { inputPieces: [...c.after] } }
  ])];
  const original = structuredClone(stages);
  const { playbackSteps: steps, relationRenderPlan: plan } = prepareReplay({ derivationStages: stages,
    sentence: `${c.after}${c.pastBefore ?? 'だ'}`, includePlayback: true });
  const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity?.relationIndex === 1);
  assert(moment > 0);
  assert(plan.frames[1].items.some(item => item.tier2FacetId === 'pf.rewrite'));
  for (const [index, step] of steps.entries()) {
    const stem = find(step.replayCanvasData, 'stem');
    if (!stem) continue;
    const word = index < moment ? c.before : c.after;
    assert.equal(stem.word, word, `${step.operation} frame ${index + 1}`);
    assert.equal(find(step.replayCanvasData, 'stem::__leaf')?.word, word);
  }
  assert.equal(find(steps[moment].replayCanvasData, 'tense').word, c.pastBefore ?? 'だ');
  assert.deepEqual(stages, original);
});

test('native VocabularyInsertion retains its existing relation-owned word update', () => {
  const stages = [stage([leaf('verb', 'V', '√GO')]), stage([leaf('verb', 'V', 'went')], [
    { relation: 'Independent context', anchors: { context: 'verb' } },
    { relation: 'VocabularyInsertion', anchors: { terminal: 'verb' }, values: { input: '√GO', output: 'went' } }
  ])];
  const { playbackSteps: steps } = prepareReplay({ derivationStages: stages, sentence: 'went', includePlayback: true });
  const context = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity?.relationIndex === 0);
  const native = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity?.relationIndex === 1);
  assert.equal(find(context.replayCanvasData, 'verb').word, '√GO');
  assert.equal(find(native.replayCanvasData, 'verb').word, 'went');
});
