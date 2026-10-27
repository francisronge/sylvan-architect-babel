import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkAttachAtMerge, checkNoEarlyReveal, checkStageCompletion, frameStructure } from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';

// Word-labelled terminals, as in Claude Opus 5.5's Mandarin 他把衣服洗干净了。
// (opus n3-03-zh-ba-resultative): the result head 干净 adjoins the verb 洗,
// which stays where it is while the new complex xiCx forms above it. Each
// terminal is its own authored occurrence, so 洗 is painted as one node
// throughout, and claims and the movement reach the words by their own ids.
const leaf = (id, word, extra = {}) => ({ id, label: word, word, ...extra, children: [] });
const result = gan => ({ id: 'res1', label: '干净', children: [leaf('yifu', '衣服', { lineageId: 'L-yifu' }), gan] });
const record = landingRole => ({
  sentence: '洗衣服干净', inputTokens: ['洗', '衣服', '干净'],
  derivationStages: [
    { statement: 'The result predicate.', stageRecord: '衣服 is the subject of 干净.',
      relations: [{ relation: 'predication', anchors: { subject: 'yifu', predicate: 'gan' } }],
      workspaceForest: [result(leaf('gan', '干净', { lineageId: 'L-gan' }))] },
    { statement: 'The verb selects the result.', stageRecord: '洗 selects the result phrase.',
      relations: [{ relation: 'complement-selection', anchors: { selector: 'xi', complement: 'res1' } }],
      workspaceForest: [{ id: 'vp1', label: '洗', children: [leaf('xi', '洗'), result(leaf('gan', '干净', { lineageId: 'L-gan' }))] }] },
    { statement: 'The result head adjoins the verb.', stageRecord: '干净 forms the complex head 洗干净.',
      relations: [{ relation: 'head-movement', anchors: { [landingRole]: 'gan2', source: 'gan', host: 'xi', complexHead: 'xiCx' } }],
      workspaceForest: [{ id: 'vp1', label: '洗', children: [
        { id: 'xiCx', label: '洗', children: [leaf('xi', '洗'), leaf('gan2', '干净', { lineageId: 'L-gan' })] },
        result(leaf('gan', '干净', { lineageId: 'L-gan', silent: true }))] }] }
  ]
});

// `landing` is recognized as head movement; Opus's own `mover` is not (yet).
for (const landingRole of ['landing', 'mover']) {
  test(`a word-labelled host keeps one painted identity while a head adjoins it (${landingRole})`, () => {
    const input = record(landingRole);
    const replay = prepareReplay({ ...structuredClone(input), includePlayback: true });
    const painted = new Set(), owner = new Map();
    replay.playbackSteps.forEach((step, index) => {
      const { nodes, displayed } = frameStructure(step);
      for (const id of displayed) {
        const data = nodes.get(id).data;
        if ([data.id, ...(data.aliasIds ?? [])].includes('xi')) {
          painted.add(id);
          owner.set(index + 1, nodes.get(id).parent?.data.id);
        }
      }
    });
    assert.deepEqual([...painted], ['xi'], '洗 is painted under its own id at every step');
    assert.deepEqual([...new Set(owner.values())], ['vp1', 'xiCx'], 'the complex forms above the unmoved verb');
    assert.deepEqual(checkStepSemantics(replay, input).map(found => `${found.subtype} ${found.frame} ${found.detail}`), []);
    assert.deepEqual([...checkNoEarlyReveal(replay), ...checkAttachAtMerge(replay), ...checkStageCompletion(replay, input)]
      .map(found => `${found.rule} ${found.frame} ${found.detail}`), []);
  });
}

test('a recognized movement of a word-labelled terminal reaches its landing by its own id', () => {
  const replay = prepareReplay({ ...structuredClone(record('landing')), includePlayback: true });
  const moment = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === 2);
  const link = replay.playbackSteps[moment].replayRelationLinks.find(item => item.renderFamily === 'trajectory');
  assert.equal(link?.targetNodeId, 'gan2');
  assert.ok(frameStructure(replay.playbackSteps[moment]).displayed.has('gan2'), 'the landing is painted as gan2 at its moment');
});
