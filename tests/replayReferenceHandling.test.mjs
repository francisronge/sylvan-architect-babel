import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { __test__ as planTest } from '../derivationReplayPlan.js';

// Exact authored identity governs every reference: node ids resolve exactly,
// lineage continuity is decided lineage-to-lineage, and an anchor or endpoint
// that does not resolve is reported or left undrawn, never replaced.

const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (statement, relations, workspaceForest) => ({
  statement,
  stageRecord: `${statement} The record explains it.`,
  relations,
  workspaceForest
});
const play = (derivationStages, sentence) => buildReplayPlayback({
  sentence,
  analyses: [{ derivationStages, tree: derivationStages.at(-1).workspaceForest[0] }]
}).steps;
const relationMoment = (steps, stageIndex, relationIndex) => steps.find((step) =>
  step.replayRelationIdentity?.stageIndex === stageIndex
  && step.replayRelationIdentity?.relationIndex === relationIndex);

test('anchors are classified exactly: resolved by id, otherwise reported at their authored field', () => {
  const forest = [node('tp', 'TP', [leaf('n', 'N', 'Mia', { tokenIndex: 0 })])];
  const { resolved, unresolved } = planTest.classifyRelationAnchors(
    { probe: 'tp', goals: ['n', 'missing'], lonely: 'absent' },
    forest
  );
  assert.deepEqual(resolved.map((anchor) => [anchor.role, anchor.nodeId, anchor.authoredAnchorIndex]), [
    ['probe', 'tp', 0], ['goals', 'n', 1]
  ]);
  assert.deepEqual(unresolved.map((anchor) => [anchor.fieldPath, anchor.nodeId, anchor.authoredAnchorIndex]), [
    ['anchors.goals[1]', 'missing', 2], ['anchors.lonely', 'absent', 3]
  ]);
});

test('a relation whose anchors do not resolve keeps its Replay moment and names the missing witness', () => {
  const stages = [
    stage('Mia is merged.', [
      { relation: 'Authored claim', anchors: { witness: 'not_here' } },
      { relation: 'Second claim', anchors: { probe: 'tp', goal: 'gone' } }
    ], [node('tp', 'TP', [leaf('n', 'N', 'Mia', { tokenIndex: 0 })])])
  ];
  const steps = play(stages, 'Mia');
  const first = relationMoment(steps, 0, 0);
  const second = relationMoment(steps, 0, 1);
  assert.ok(first, 'the fully unresolved relation still owns a moment');
  assert.ok(second, 'the partly unresolved relation still owns a moment');
  assert.match(first.movementDiagnostics.join('\n'), /RELATION_ANCHOR_UNRESOLVED: Stage 1, relation 1 \(Authored claim\) anchors\.witness names "not_here"/);
  assert.match(second.movementDiagnostics.join('\n'), /relation 2 \(Second claim\) anchors\.goal names "gone"/);
  assert.equal(JSON.stringify(stages[0].relations[0].anchors), '{"witness":"not_here"}', 'authored anchors are untouched');
});

const whChain = (highId, lowExtra = {}) => [
  node('cp', 'CP', [
    node(highId, 'DP', [leaf(`${highId}_d`, 'D', 'What', { tokenIndex: 0, lineageId: 'wh-d' })], { lineageId: 'wh' }),
    node('tp', 'TP', [
      node('dp_mia', 'DP', [leaf('d_mia', 'D', 'Mia', { tokenIndex: 1 })]),
      node('vp', 'VP', [
        leaf('v', 'V', 'saw', { tokenIndex: 2 }),
        node('dp_low', 'DP', [leaf('d_low', 'D', 'what', { silent: true, lineageId: 'wh-d' })], { silent: true, lineageId: 'wh', ...lowExtra })
      ])
    ])
  ])
];

test('a movement endpoint that is absent from a later stage is never replaced by a lineage mate', () => {
  const movement = { relation: 'WhMovement', anchors: { source: 'dp_low', target: 'dp_high' } };
  for (const [title, laterForest] of [
    ['one lineage mate', whChain('dp_high_renamed')],
    ['two lineage mates', [
      node('cp', 'CP', [
        node('dp_high_a', 'DP', [leaf('dp_high_a_d', 'D', 'What', { tokenIndex: 0, lineageId: 'wh-d' })], { lineageId: 'wh' }),
        node('cbar', "C'", [
          node('dp_high_b', 'DP', [leaf('dp_high_b_d', 'D', 'what', { silent: true, lineageId: 'wh-d' })], { silent: true, lineageId: 'wh' }),
          whChain('dp_unused')[0].children[1]
        ])
      ])
    ]]
  ]) {
    const stages = [
      stage('The wh phrase moves.', [movement], whChain('dp_high')),
      stage('The landing id changes.', [], laterForest)
    ];
    const steps = play(stages, 'What Mia saw');
    const laterSteps = steps.filter((step) => step.replayFrameIndex === 1);
    assert.ok(laterSteps.length > 0);
    for (const step of laterSteps) {
      for (const link of step.replayRelationLinks || []) {
        if (link.relation !== 'WhMovement') continue;
        assert.notEqual(link.targetNodeId, 'dp_high_renamed', `${title}: no renamed landing is guessed`);
        assert.notEqual(link.targetNodeId, 'dp_high_a', `${title}: no lineage mate is guessed`);
        assert.notEqual(link.targetNodeId, 'dp_high_b', `${title}: no lineage mate is guessed`);
      }
    }
  }
});

test('lineage continuity compares lineage with lineage, not with node ids', () => {
  const stages = [
    stage('The object is built.', [], [
      node('dp_book_s1', 'DP', [leaf('d_the', 'D', 'the', { tokenIndex: 1 }), leaf('n_book', 'N', 'book', { tokenIndex: 2 })], { lineageId: 'book' })
    ]),
    stage('The verb selects the object.', [], [
      node('vp', 'VP', [
        leaf('v_read', 'V', 'read', { tokenIndex: 0 }),
        node('dp_book_s2', 'DP', [leaf('d_the', 'D', 'the', { tokenIndex: 1 }), leaf('n_book', 'N', 'book', { tokenIndex: 2 })], { lineageId: 'book' })
      ])
    ])
  ];
  const steps = play(stages, 'read the book');
  const stageTwo = steps.filter((step) => step.replayFrameIndex === 1);
  const firstStageTwoStep = stageTwo[0];
  assert.ok(firstStageTwoStep.replayVisibleNodeIds.includes('dp_book_s2'),
    'the continuing object is already visible when its next stage begins');
  assert.equal(
    stageTwo.some((step) => step.replayKind === 'micro' && step.targetNodeId === 'dp_book_s2'),
    false,
    'a continuing object is not rebuilt as new material'
  );
});
