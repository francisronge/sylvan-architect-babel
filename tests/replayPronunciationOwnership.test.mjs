import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { hierarchy } from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { collectPronouncedLeafNodeIdsInOrder, hasSilentOrGhostAncestor } from '../replay/replayCompiler.ts';

const load = name => JSON.parse(fs.readFileSync(new URL(`../fixtures/replay-regressions/${name}.json`, import.meta.url)));
const nodes = root => [root, ...(root.children ?? []).flatMap(nodes)];
const find = (step, id) => nodes(step.replayCanvasData).find(node => node.id === id);
const hierNode = (step, id) => hierarchy(step.replayCanvasData).descendants().find(node => node.data.id === id);
const play = record => prepareReplay({ ...record, includePlayback: true }).playbackSteps;
const material = node => Object.fromEntries(['label', 'word', 'silent', 'tokenIndex']
  .filter(key => Object.hasOwn(node, key)).map(key => [key, node[key]]));
const hasBoundary = step => nodes(step.replayCanvasData).some(node => Object.hasOwn(node, 'replayPriorInheritedSilence'));

test('Minimalist pending source keeps its prior pronunciation without undoing an active sibling', () => {
  const record = load('pending-source-pronunciation'), original = structuredClone(record);
  const steps = play(record);
  const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 1);
  const before = steps[moment - 1];
  assert(moment > 0);
  assert.equal(find(before, 'rVP').silent, true, 'current ancestor retains its authored silence');
  assert.equal(hasSilentOrGhostAncestor(hierNode(before, 'rV::__leaf')), true, 'earlier lower head stays silent');
  assert.equal(hasSilentOrGhostAncestor(hierNode(before, 'qBase::__leaf')), false, 'pending source remains pronounced');
  assert(collectPronouncedLeafNodeIdsInOrder(before.replayCanvasData).includes('qBase::__leaf'));
  assert.equal(hasSilentOrGhostAncestor(hierNode(steps[moment], 'qBase::__leaf')), true);
  assert.equal(hasSilentOrGhostAncestor(hierNode(steps[moment], 'qEdge::__leaf')), false);
  assert(!hasBoundary(steps.at(-1)), 'completed Replay contains only current authored pronunciation');
  assert.deepEqual(play(record), steps, 'rebuilding and seeking cannot retain a previous boundary');
  assert.deepEqual(record, original);
});

test('prior inherited silence and a source’s own silent child remain silent', () => {
  for (const inherited of [false, true]) {
    const record = load('pending-source-pronunciation');
    const priorSource = nodes(record.derivationStages[0].workspaceForest[0]).find(node => node.id === 'qBase');
    const priorParent = nodes(record.derivationStages[0].workspaceForest[0]).find(node => node.id === 'rVP');
    const currentSource = nodes(record.derivationStages[1].workspaceForest[0]).find(node => node.id === 'qBase');
    if (inherited) priorParent.silent = true;
    // The source’s preceding contents are restored as a whole, including its own silence.
    priorSource.silent = true;
    currentSource.silent = true;
    const original = structuredClone(record), steps = play(record);
    const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
      && step.replayRelationIdentity.relationIndex === 1);
    assert.equal(hasSilentOrGhostAncestor(hierNode(steps[moment - 1], 'qBase::__leaf')), true);
    assert(!collectPronouncedLeafNodeIdsInOrder(steps[moment - 1].replayCanvasData).includes('qBase::__leaf'));
    assert(!hasBoundary(steps.at(-1)));
    assert.deepEqual(record, original);
  }
  const data = { id: 'current', label: 'XP', silent: true, children: [
    { id: 'source', label: 'DP', replayPriorInheritedSilence: false, children: [
      { id: 'overt', label: 'overt', word: 'overt' },
      { id: 'silent', label: 'silent', word: 'silent', silent: true }
    ] }
  ] };
  assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(data), ['overt']);
  for (const node of hierarchy(data).leaves()) {
    assert.equal(hasSilentOrGhostAncestor(node), node.data.id === 'silent');
  }
  data.children[0].replayPriorInheritedSilence = true;
  assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(data), []);
  assert(hierarchy(data).leaves().every(hasSilentOrGhostAncestor));
});

test('X-bar retained receiving head takes only its own fields at the head movement', () => {
  const record = load('receiving-head-material'), original = structuredClone(record), steps = play(record);
  const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 0);
  assert(moment > 0);
  assert.equal(find(steps[moment - 1], 'i').label, 'I⁰[finite, perfect, class 8]');
  assert.equal(find(steps[moment - 1], 'i').silent, true);
  assert.equal(find(steps[moment], 'i').label, 'I⁰');
  assert.equal(find(steps[moment], 'i').silent, undefined);
  assert.equal(hasSilentOrGhostAncestor(hierNode(steps[moment], 'v::__leaf')), false);
  assert.equal(find(steps[moment], 'iFeatures').silent, true);
  for (const id of ['i', 'v', 'iFeatures', 'verbTrace']) {
    assert.deepEqual(material(find(steps[moment], id)), material(find(steps.at(-1), id)));
  }
  assert(!hasBoundary(steps.at(-1)));
  assert.deepEqual(play(record), steps);
  assert.deepEqual(record, original);
});

test('receiving-container word and token fields wait for an independent later realization', () => {
  const record = load('receiving-head-material');
  const findAuthored = (stageIndex, id) => record.derivationStages[stageIndex].workspaceForest
    .flatMap(nodes).find(node => node.id === id);
  findAuthored(0, 'i').word = 'prior';
  Object.assign(findAuthored(1, 'i'), { word: 'final', tokenIndex: 2 });
  record.derivationStages[1].relations.splice(1, 0, {
    relation: 'VocabularyInsertion', anchors: { terminal: 'i' }, priorAnchors: { terminal: 'i' },
    values: { input: 'prior', output: 'final' }
  });
  const original = structuredClone(record), steps = play(record);
  const moments = steps.filter(step => step.replayRelationIdentity?.stageIndex === 1);
  const receiving = find(moments[0], 'i');
  assert.equal(receiving.label, 'I⁰');
  assert.equal(receiving.silent, undefined);
  assert.deepEqual(receiving.children.map(node => node.id), ['v', 'iFeatures']);
  assert.equal(receiving.word, 'prior');
  assert.equal(receiving.tokenIndex, undefined);
  assert.equal(find(moments[1], 'i').word, 'final');
  assert.equal(find(moments[1], 'i').tokenIndex, 2);
  assert.deepEqual(record, original);
});
