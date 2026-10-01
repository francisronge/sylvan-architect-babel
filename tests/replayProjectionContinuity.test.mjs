import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import {
  adaptDerivationStagesForReplay,
  buildPlaybackStepsFromDerivationFrames
} from '../replay/replayCompiler.ts';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, word, extra = {}) => ({
  id, label, ...(word ? { word } : {}), children: [], ...extra
});

test('attaching a head-movement landing replaces its cross-workspace curve at the repeated relation moment', () => {
  const low = leaf('didLow', 'T', 'did', { lineageId: 'did' });
  const high = leaf('didHigh', 'T', 'did', { lineageId: 'did' });
  const question = leaf('questionC', 'C', undefined, { silent: true });
  const verbPhrase = node('verbPhrase', 'VP', []);
  const tensePhrase = () => node('tensePhrase', 'TP', [{ ...low, silent: true }, verbPhrase]);
  const complexC = () => node('complexC', 'C', [high, question]);
  const relation = {
    relation: 'T-to-C head movement',
    anchors: { higherTOccurrence: 'didHigh', lowerTOccurrence: 'didLow' },
    priorAnchors: { source: 'didLow' }
  };
  const stages = [
    stage('The lower T and C are separate.', [
      node('tensePhrase', 'TP', [low, verbPhrase]), question
    ]),
    stage('The raised T reaches the C workspace.', [tensePhrase(), complexC()], [relation]),
    stage('C and TP form one clause.', [
      node('clause', 'CP', [complexC(), tensePhrase()])
    ], [{ ...relation, priorAnchors: undefined }])
  ];
  const plan = compileRelationRenderPlan(stages);
  const trajectories = (stageIndex, played) => visiblePlanFrameItems(plan, stageIndex, played)
    .filter(item => item.kind === 'trajectory').map(item => item.trajectoryKind);
  assert.deepEqual(trajectories(1, new Set([0])), ['sideward']);
  assert.deepEqual(trajectories(2, new Set()), ['sideward']);
  assert.deepEqual(trajectories(2, new Set([0])), ['head']);
  assert.deepEqual(plan.frames[2].items.filter(item => item.kind === 'trajectory')
    .map(item => item.supersededAt?.relationIndex ?? null), [0, null]);
});
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (statement, workspaceForest, relations = []) => ({
  statement,
  stageRecord: 'The completed derivational state has been recorded.',
  relations,
  workspaceForest
});
const findNode = (root, id) => {
  if (root?.id === id) return root;
  for (const child of root?.children || []) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
};

test('head movement preserves the old binary parent until subject landing introduces its complete bar projection', () => {
  const subject = node('subjectLow', 'DP', [
    leaf('nounLow', 'N', 'children', { lineageId: 'noun' })
  ], { lineageId: 'subject' });
  const prior = node('tp', 'TP', [
    leaf('tense', 'T', undefined, { silent: true }),
    node('verbalPhrase', 'vP', [
      subject,
      leaf('verbLow', 'V', 'laugh', { lineageId: 'verb' })
    ])
  ]);
  const completed = node('tp', 'TP', [
    node('subjectHigh', 'DP', [
      leaf('nounHigh', 'N', 'children', { lineageId: 'noun' })
    ], { lineageId: 'subject' }),
    node('tenseBar', 'T′', [
      node('tense', 'T', [
        leaf('verbHigh', 'V', 'laugh', { lineageId: 'verb' }),
        leaf('tenseHead', 'T', undefined, { silent: true })
      ]),
      node('verbalPhrase', 'vP', [
        node('subjectLow', 'DP', [
          leaf('nounLow', 'N', 'children', { lineageId: 'noun', silent: true })
        ], { lineageId: 'subject', silent: true }),
        leaf('verbLow', 'V', 'laugh', { lineageId: 'verb', silent: true })
      ])
    ])
  ]);
  const stages = [
    stage('T projects above the verbal phrase.', [prior]),
    stage('The verb reaches T and the subject reaches Spec-TP.', [completed], [
      {
        relation: 'V-to-T head movement',
        anchors: { higherOccurrence: 'verbHigh', lowerOccurrence: 'verbLow' },
        priorAnchors: { source: 'verbLow' }
      },
      {
        relation: 'subject A-movement',
        anchors: { higherCopy: 'subjectHigh', lowerCopy: 'subjectLow' },
        priorAnchors: { source: 'subjectLow' }
      }
    ])
  ];
  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'children laugh',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const head = steps.find(step => step.operation === 'V-to-T head movement');
  const subjectLanding = steps.find(step => step.operation === 'subject A-movement');
  const stageRecord = steps.at(-1);
  assert.ok(head && subjectLanding);
  assert.deepEqual(findNode(head.replayCanvasData, 'tp').children.map(child => child.id),
    ['tense', 'verbalPhrase']);
  assert.ok(head.replayVisibleNodeIds.includes('tenseHead'));
  assert.ok(!head.replayVisibleNodeIds.includes('subjectHigh'));
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'tenseBar'),
    'the bar wrapper belongs to the subject landing and has no empty earlier merge moment');
  assert.ok(steps.every(step => step.replayKind !== 'micro' || step.replayVisibleNodeIds.includes(step.targetNodeId)));
  for (const step of [subjectLanding, stageRecord]) {
    assert.deepEqual(findNode(step.replayCanvasData, 'tp').children.map(child => child.id),
      ['subjectHigh', 'tenseBar']);
    assert.ok(step.replayVisibleNodeIds.includes('subjectHigh'));
    assert.ok(step.replayVisibleNodeIds.includes('tenseBar'));
    assert.ok(step.replayVisibleNodeIds.includes('tenseHead'));
  }
});

test('a retained head becomes its complete complex atomically at head movement', () => {
  const source = leaf('source', 'V', 'read', { lineageId: 'verb' });
  const host = leaf('host', 'T', undefined, { silent: true });
  const before = node('clause', 'TP', [host, node('predicate', 'VP', [source])]);
  const after = node('clause', 'TP', [
    node('host', 'T', [{ ...source, id: 'landing' }, leaf('innerHost', 'T', undefined, { silent: true })]),
    node('predicate', 'VP', [{ ...source, silent: true }])
  ]);
  const stages = [stage('T is present.', [before]), stage('The head reaches T.', [after], [
    { relation: 'V-to-T head movement', anchors: { higherOccurrence: 'landing', lowerOccurrence: 'source' }, priorAnchors: { source: 'source' } }
  ])];
  const steps = buildPlaybackStepsFromDerivationFrames(adaptDerivationStagesForReplay(stages),
    'read', buildDerivationReplayPlan({ derivationStages: stages }));
  const movementIndex = steps.findIndex(step => step.operation === 'V-to-T head movement');
  assert.ok(movementIndex > 0);
  assert.ok(steps.slice(0, movementIndex).every(step => !step.replayVisibleNodeIds.includes('innerHost')));
  for (const step of steps.slice(0, movementIndex)) {
    assert.ok(!(findNode(step.replayCanvasData, 'host')?.children || []).some(child => !child.replayLayoutOnly),
      'the preceding leaf must not gain a hidden real child before adjunction');
  }
  assert.ok(steps[movementIndex].replayVisibleNodeIds.includes('innerHost'));
  assert.deepEqual(findNode(steps[movementIndex].replayCanvasData, 'host').children.map(child => child.id), ['landing', 'innerHost']);
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'innerHost'));
});

const assertCompleteLandingParent = (step, landingId) => {
  const findParent = root => root.children?.some(child => child.id === landingId)
    ? root : root.children?.map(findParent).find(Boolean);
  const parent = findParent(step.replayCanvasData);
  assert.ok(parent && step.replayVisibleNodeIds.includes(parent.id));
  assert.ok(parent.children.every(child => step.replayVisibleNodeIds.includes(child.id)),
    `${parent.id} must have every current branch at the landing`);
};

test('saved German subject landing has its independently constructed I-bar before later head movement', () => {
  const saved = JSON.parse(readFileSync(new URL('../fixtures/movement/independent-infl-context.json', import.meta.url)));
  const steps = buildPlaybackStepsFromDerivationFrames(adaptDerivationStagesForReplay(saved.derivationStages),
    saved.sentence, buildDerivationReplayPlan(saved));
  const subject = steps.findIndex(step => step.operation === 'A-movement');
  const head = steps.findIndex(step => step.operation === 'V-to-I head movement');
  const projection = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'ibar');
  assert.ok(projection >= 0 && projection < subject && subject < head);
  assertCompleteLandingParent(steps[subject], 'subjectIP');
  assert.deepEqual(findNode(steps[subject].replayCanvasData, 'ibar').children.map(child => child.id), ['vp', 'inflFeatures']);
  assert.equal(findNode(steps[subject].replayCanvasData, 'verbBase').word, 'gefallen');
  assert.ok(!steps[subject].replayVisibleNodeIds.includes('verbI'));
  assertCompleteLandingParent(steps[head], 'verbI');
  assert.ok(steps.every(step => step.replayKind !== 'micro' || step.replayVisibleNodeIds.includes(step.targetNodeId)));
});

for (const firstMovement of ['subject', 'head']) {
  test(`${firstMovement} movement first: receiving context respects the earlier authored relation`, () => {
    const subject = leaf('subject', 'DP', 'Ada', { lineageId: 'argument' });
    const verb = leaf('verb', 'V', 'reads', { lineageId: 'predicate' });
    const lower = node('predicate', 'VP', [subject, verb]);
    const current = node('clause', 'TP', [{ ...subject, id: 'raisedSubject' }, node('bar', 'T′', [
      node('complex', 'T', [{ ...verb, id: 'raisedVerb' }, leaf('tense', 'T', undefined, { silent: true })]),
      node('predicate', 'VP', [{ ...subject, silent: true }, { ...verb, silent: true }])
    ])]);
    const relations = {
      subject: { relation: 'A-movement', anchors: { landing: 'raisedSubject', trace: 'subject' }, priorAnchors: { source: 'subject' } },
      head: { relation: 'V-to-T head movement', anchors: { movedHead: 'raisedVerb', trace: 'verb', landingHead: 'complex' }, priorAnchors: { source: 'verb' } }
    };
    const ordered = firstMovement === 'subject' ? [relations.subject, relations.head] : [relations.head, relations.subject];
    const stages = [stage('The predicate is formed.', [lower]), stage('Both landings are complete.', [current], ordered)];
    const steps = buildPlaybackStepsFromDerivationFrames(adaptDerivationStagesForReplay(stages), 'Ada reads',
      buildDerivationReplayPlan({ derivationStages: stages }));
    const relationSteps = steps.filter(step => step.replayKind === 'relation');
    assert.deepEqual(relationSteps.map(step => step.operation), ordered.map(relation => relation.relation));
    const first = steps.indexOf(relationSteps[0]);
    assert.ok(steps.slice(0, first).some(step => step.replayKind === 'micro' && step.targetNodeId === 'tense'));
    if (firstMovement === 'subject') {
      assert.ok(steps.slice(0, first).some(step => step.replayKind === 'micro' && step.targetNodeId === 'bar'));
    } else {
      assert.ok(steps.slice(0, first).every(step => !step.replayVisibleNodeIds.includes('bar')),
        'without an earlier claim needing its context, the new attachment belongs to head movement');
      assert.ok(relationSteps[0].replayVisibleNodeIds.includes('bar'));
    }
    assertCompleteLandingParent(relationSteps.find(step => step.operation === relations.subject.relation), 'raisedSubject');
    assertCompleteLandingParent(relationSteps.find(step => step.operation === relations.head.relation), 'raisedVerb');
    assert.ok(steps.every(step => step.replayKind !== 'micro' || step.replayVisibleNodeIds.includes(step.targetNodeId)));
  });
}
