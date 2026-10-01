import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/coordination-and-ellipsis.json', import.meta.url)));
const japanese = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/independent-clause-and-realization.json', import.meta.url)));
const nodes = forest => forest.flatMap(node => [node, ...nodes(node.children ?? [])]);
const node = (id, children = [], extra = {}) => ({ id, label: 'XP', children, ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'Coordinate the current clauses.', stageRecord: 'Coordinate the clauses before suppressing the second predicate.', workspaceForest, relations });
const reduced = () => {
  const first = node('first', [node('antecedent', [], { label: 'V', word: 'read' })]);
  const second = node('second', [node('remnant', [], { label: 'DP', word: 'Mia' }), node('predicate', [], { label: 'V', word: 'read' })]);
  const currentSecond = structuredClone(second);
  currentSecond.children[1].silent = true;
  return { sentence: 'read and Mia', derivationStages: [stage([first, second]), stage([
    node('coordination', [first, node('tail', [node('coordinator', [], { label: '&', word: 'and' }), currentSecond])])
  ], [
    { relation: 'Parallel interpretation', anchors: { antecedent: 'antecedent', remnant: 'remnant', coordinator: 'coordinator' } },
    { relation: 'Predicate suppression', anchors: { output: 'predicate', antecedent: 'antecedent' }, priorAnchors: { original: 'predicate' } }
  ])] };
};
const syntax = step => {
  const visible = new Set(step.replayVisibleNodeIds);
  const visit = current => {
    if (current.replayOrigin?.kind === 'word') return [];
    const children = (current.children ?? []).flatMap(visit);
    if (!visible.has(current.id) || current.replayOrigin?.kind === 'workspace') return children;
    return [{ id: current.id, label: current.label, word: current.word?.toLowerCase(), silent: current.silent, children }];
  };
  return visit(step.replayCanvasData).sort((a, b) => a.id.localeCompare(b.id));
};
const effectiveSilence = (forest, id) => {
  const visit = (current, inherited = false) => {
    const silent = inherited || current.silent === true;
    if (current.id === id) return silent;
    return (current.children ?? []).map(child => visit(child, silent)).find(value => value !== undefined);
  };
  return forest.map(root => visit(root)).find(value => value !== undefined);
};

for (const [name, make, parents, predicate] of [
  ['reduced coordination and suppression', reduced, ['tail', 'coordination'], 'predicate'],
  ['fresh GPT-6.1 Sol gapping', () => structuredClone(saved), ['coordLow', 'coordMax'], 'ordered2']
]) test(`${name}: independent coordination merges precede the relation-owned nonpronunciation`, () => {
  const record = make(), original = structuredClone(record);
  const { playbackSteps } = prepareReplay({ ...record, includePlayback: true });
  const steps = playbackSteps.filter(step => step.replayFrameIndex === 1);
  const relationIndex = steps.findIndex(step => step.replayRelationIdentity?.relationIndex === 1);
  assert(relationIndex >= 0);
  for (const id of parents) {
    const mergeIndex = steps.findIndex(step => step.replayKind === 'micro' && step.operation === 'ExternalMerge' && step.targetNodeId === id);
    assert(mergeIndex >= 0 && mergeIndex < relationIndex, `${id} requires its ordinary merge before suppression`);
    for (const source of steps[mergeIndex].sourceNodeIds) assert(steps[mergeIndex - 1].replayVisibleNodeIds.includes(source));
  }
  const overtBefore = nodes([steps[relationIndex - 1].replayCanvasData]).find(node => node.id === predicate);
  const suppressed = nodes([steps[relationIndex].replayCanvasData]).find(node => node.id === predicate);
  assert.notEqual(overtBefore.silent, true, 'construction must not apply the later pronunciation change');
  const authoredSuppression = nodes(record.derivationStages[1].workspaceForest).find(node => node.id === predicate);
  assert.equal(suppressed.silent, authoredSuppression.silent);
  assert.equal(effectiveSilence([steps[relationIndex - 1].replayCanvasData], predicate), false);
  assert.equal(effectiveSilence([steps[relationIndex].replayCanvasData], predicate), true);
  assert.deepEqual(syntax(steps.at(-1)), syntax(steps.at(-2)), 'Stage Record must not attach a hidden edge');
  assert.deepEqual(record, original);
});

test('a retained relation-owned occurrence does not enter its new parent through an ordinary merge', () => {
  const operand = node('operand', [], { label: 'N', word: 'one' });
  const head = node('head', [], { label: 'V', word: 'read' });
  const record = { sentence: 'one read', derivationStages: [
    stage([node('host', [operand, head])]),
    stage([node('host', [node('wrapper', [operand]), head])], [
      { relation: 'Local restructuring', anchors: { output: 'operand' }, priorAnchors: { input: 'operand' } }
    ])
  ] };
  const { playbackSteps } = prepareReplay({ ...record, includePlayback: true });
  const steps = playbackSteps.filter(step => step.replayFrameIndex === 1);
  const momentIndex = steps.findIndex(step => step.replayKind === 'relation');
  assert(momentIndex >= 0);
  assert(steps.slice(0, momentIndex).every(step => !step.replayVisibleNodeIds.includes('wrapper')),
    'an existing ID does not grant early availability of its relocated current occurrence');
  assert(steps[momentIndex].replayVisibleNodeIds.includes('wrapper'));
  assert.deepEqual(syntax(steps.at(-1)), syntax(steps.at(-2)));
});

test('fresh Japanese: a later embedded realization does not discard matrix clause construction', () => {
  const record = structuredClone(japanese), original = structuredClone(record);
  const { playbackSteps } = prepareReplay({ ...record, includePlayback: true });
  const steps = playbackSteps.filter(step => step.replayFrameIndex === 1);
  const momentIndex = steps.findIndex(step => step.replayRelationIdentity?.relationIndex === 4);
  assert(momentIndex >= 0);
  for (const id of ['buyVbar', 'buyVP', 'matrixIbar', 'matrixIP']) {
    const constructionIndex = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === id);
    assert(constructionIndex >= 0 && constructionIndex < momentIndex, `${id} requires its ordinary construction`);
    const construction = steps[constructionIndex];
    for (const source of construction.sourceNodeIds) assert(steps[constructionIndex - 1].replayVisibleNodeIds.includes(source));
  }
  for (const step of steps.slice(0, momentIndex)) assert.deepEqual(step.replayRealizations, [],
    'embedded pronunciation must wait for its own moment');
  assert.deepEqual(steps[momentIndex].replayRealizations, record.derivationStages[1].realizations);
  assert.deepEqual(syntax(steps.at(-1)), syntax(steps.at(-2)));
  assert.deepEqual(record, original);
});
