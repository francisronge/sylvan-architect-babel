import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const leaf = (id, label, word = id) => ({ id, label, word });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const all = n => [n, ...(n.children ?? []).flatMap(all)];
const find = (forest, id) => forest.flatMap(all).find(n => n.id === id);
const fixture = ({ cross = true, phrase = true, category = 'D', receiver = 'V', complex = false } = {}) => {
  const lower = phrase || complex
    ? node('low', category, [leaf('first', category, 'one'), leaf('second', 'N', 'two')], { lineageId: 'chain' })
    : { ...leaf('low', category, 'one'), lineageId: 'chain' };
  const domain = phrase
    ? node('domain', receiver, [leaf('predicate', receiver), lower])
    : node('domain', `${category}′`, [lower, node('complement', 'ZP', [leaf('z', 'Z')])]);
  const receiving = leaf('receiver', receiver, 'takes');
  const priorForest = cross ? [domain, receiving] : [node('clause', 'CP', [domain, receiving])];
  const currentForest = structuredClone(priorForest);
  find(currentForest, 'low').silent = true;
  const landing = structuredClone(lower);
  const rename = n => { n.id = `new-${n.id}`; n.children?.forEach(rename); };
  rename(landing);
  const parent = node('new-parent', receiver, [receiving, landing]);
  if (cross) currentForest[1] = parent;
  else currentForest[0].children[1] = parent;
  return { priorForest, currentForest, relation: { relation: 'An authored dependency',
    anchors: { sourceOccurrence: 'low', newOccurrence: 'new-low' }, priorAnchors: { sourceOccurrence: 'low' } } };
};
const recover = x => recoverMovementEvidence(x.relation, x.currentForest, x.priorForest);
const prepare = x => prepareReplay({ sentence: 'one two takes', includePlayback: true,
  derivationStages: [x.priorForest, x.currentForest].map((workspaceForest, i) => ({
    statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations: i ? [x.relation] : [] })) });

for (const cross of [false, true]) for (const [category, receiver] of [['D', 'V'], ['Q', 'Foc']])
  test(`a bare ${category} phrase remains phrasal in a ${receiver} recipient ${cross ? 'across' : 'within'} workspaces`, () => {
    const input = fixture({ cross, category, receiver }), original = structuredClone(input);
    assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
    const replay = prepare(input), steps = replay.playbackSteps;
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
    assert(moment > 0);
    assert(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes('new-low')));
    assert.equal(find([steps[moment - 1].replayCanvasData], 'low').silent, undefined);
    assert(steps[moment].replayVisibleNodeIds.includes('new-low'));
    assert.equal(find([steps[moment].replayCanvasData], 'low').silent, true);
    const trajectory = replay.relationRenderPlan.frames[1].items.find(item => item.kind === 'trajectory');
    assert.equal(trajectory.trajectoryKind, cross ? 'sideward' : 'phrasal');
    assert.deepEqual(input, original);
  });

test('opaque identities, child order and explanatory annotations cannot supply head evidence', () => {
  const input = fixture();
  for (const forest of [input.priorForest, input.currentForest]) for (const n of forest.flatMap(all)) {
    n.id = `opaque-${n.id}`;
    if (n.label === 'D') n.label = 'D: position 0';
    n.children?.reverse();
  }
  input.relation = { relation: 'Independent relation wording', anchors: { sourceOccurrence: 'opaque-low', newOccurrence: 'opaque-new-low' },
    priorAnchors: { sourceOccurrence: 'opaque-low' } };
  assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
});

for (const cross of [false, true]) for (const complex of [false, true])
  test(`a genuine ${complex ? 'bare complex' : 'simple'} head retains head movement ${cross ? 'across' : 'within'} workspaces`, () => {
    const input = fixture({ cross, phrase: false, category: 'Agr', receiver: 'Foc', complex });
    const movement = recover(input).movement;
    assert.equal(movement?.trajectoryKind, 'head');
    assert.equal(movement?.transition, true);
    assert.equal(movement?.targetNodeId, 'new-low');
    assert(prepare(input).playbackSteps.some(s => s.replayRelationIdentity?.stageIndex === 1));
  });

test('explicit zero-level and compound heads keep their authored status outside a projected source slot', () => {
  for (const category of ['Agr⁰', 'Agr^0', 'Agr0', 'Agr+V']) {
    const input = fixture({ category, phrase: true });
    assert.equal(recover(input).movement?.trajectoryKind, 'head', category);
  }
});

test('a bare complex head retains its position inside a bare minimal projection', () => {
  for (const cross of [false, true]) {
    const input = fixture({ cross, phrase: false, category: 'Agr', receiver: 'Foc', complex: true });
    for (const forest of [input.priorForest, input.currentForest]) find(forest, 'domain').label = 'Agr';
    assert.equal(recover(input).movement?.trajectoryKind, 'head');
  }
});

test('a bare source projection does not prove head status from a flat or same-category sister', () => {
  for (const sister of [leaf('complement', 'Z'), node('complement', 'Agr', [leaf('z', 'Z')])]) {
    const input = fixture({ phrase: false, category: 'Agr', complex: true });
    for (const forest of [input.priorForest, input.currentForest]) {
      const domain = find(forest, 'domain');
      domain.label = 'Agr';
      domain.children[1] = structuredClone(sister);
    }
    assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
  }
});

const assembledHead = (nested = false) => {
  const input = fixture({ phrase: false, category: 'Agr', receiver: 'Foc', complex: true });
  for (const forest of [input.priorForest, input.currentForest]) {
    const domain = find(forest, 'domain');
    domain.label = 'Agr';
    domain.children[1] = { ...leaf('complement', 'N'), lineageId: 'member' };
    for (const id of ['second', 'new-second']) {
      const member = find(forest, id);
      if (!member) continue;
      member.lineageId = 'member';
      if (nested) {
        delete member.word;
        member.children = [leaf(`${id}-host`, 'N'), leaf(`${id}-added`, 'Z')];
      }
    }
  }
  return input;
};

for (const nested of [false, true]) test(`an existing ${nested ? 'nested' : 'flat'} head assembly is proved by its member's lower occurrence`, () => {
  const input = assembledHead(nested);
  assert.equal(recover(input).movement?.trajectoryKind, 'head');
  assert.equal(recover(input).movement?.transition, true);
});

for (const [name, change] of [
  ['missing lineage', input => { delete find(input.priorForest, 'complement').lineageId; }],
  ['different lineage', input => { find(input.priorForest, 'complement').lineageId = 'other'; }],
  ['projected lower member', input => { find(input.priorForest, 'complement').label = 'NP'; }],
  ['different category', input => { find(input.priorForest, 'complement').label = 'Z'; }],
  ['phrasal member', input => { find(input.priorForest, 'second').label = 'NP'; }],
  ['a projecting member without its own head host', input => { find(input.priorForest, 'second-host').label = 'Q'; }]
]) test(`an existing head assembly is not inferred from ${name}`, () => {
  const input = assembledHead(true);
  change(input);
  assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
});

test('an explicitly phrasal landing cannot become a head from its receiving sister', () => {
  const input = fixture({ category: 'DP' });
  assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
});

test('the saved sideward copy retains one phrase-owned moment without head-only scaffolding', () => {
  const { cases } = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-historical-continuity.json', import.meta.url)));
  const record = cases.find(record => record.key === 'archive/expansion-parasitic-gap/0');
  const original = structuredClone(record);
  const replay = prepareReplay({ ...record, includePlayback: true });
  const steps = replay.playbackSteps;
  assert.equal(steps.length, 47);
  for (const frame of [20, 21]) {
    const step = steps[frame - 1];
    assert(!step.replayVisibleNodeIds.includes('a_fvp'));
    assert(!step.replayVisibleNodeIds.includes('a_fdp'));
    assert(!find([step.replayCanvasData], 'a_fvp').replayLayoutOnly,
      'a phrase wrapper does not receive the special head-landing reservation');
  }
  const link = steps[21].replayRelationLinks.find(link => link.authoredRelationKey === '1:0' && link.renderFamily === 'trajectory');
  assert.equal(link.trajectoryKind, 'phrasal');
  assert.equal(link.sourceNodeId, 'a_rdp');
  assert.equal(link.targetNodeId, 'a_fdp');
  assert.equal(link.priorSourceNodeId, 'a_rdp');
  for (const id of ['a_fvp', 'a_fdp', 'a_fd', 'a_fn']) assert(steps[21].replayVisibleNodeIds.includes(id));
  assert.equal(replay.relationRenderPlan.frames[1].items.find(item => item.kind === 'trajectory'
    && item.relationRef.relationIndex === 0).trajectoryKind, 'sideward');
  assert.deepEqual(record, original);
});

for (const [name, path, select, frames, stageIndex, relationIndex] of [
  ['Spanish intransitive v-to-T', '../fixtures/replay-regressions/workspace-spanish-continuity.json', value => value, 40, 2, 0],
  ['Hungarian nested T-to-Foc', '../fixtures/replay-regressions/workspace-component-lifetime.json', value => value.cases.find(c => c.key === 'hungarian-dative/1'), 48, 5, 1]
]) test(`${name} preserves its genuine head movement and saved Replay schedule`, () => {
  const record = select(JSON.parse(fs.readFileSync(new URL(path, import.meta.url))));
  const original = structuredClone(record);
  const stage = record.derivationStages[stageIndex];
  const movement = recoverMovementEvidence(stage.relations[relationIndex], stage.workspaceForest,
    record.derivationStages[stageIndex - 1].workspaceForest).movement;
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(movement?.transition, true);
  const replay = prepareReplay({ ...record, includePlayback: true });
  assert.equal(replay.playbackSteps.length, frames);
  const key = `${stageIndex}:${relationIndex}`;
  const moment = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity?.relationIndex === relationIndex);
  assert(moment.replayRelationLinks.some(link => link.authoredRelationKey === key && link.trajectoryKind === 'head'));
  assert.deepEqual(record, original);
});
