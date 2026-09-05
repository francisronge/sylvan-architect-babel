import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptDerivationStagesForReplay,
  buildPlaybackStepsFromDerivationFrames,
  buildReplaySupportLines,
  stepRepresentsMovement
} from '../replay/replayCompiler.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';

const leaf = (id, label, word) => ({ id, label, word, children: [] });
const node = (id, label, children = []) => ({ id, label, children });

const canvas = node('cp', 'CP', [
  node('dp_high', 'DP', [leaf('d_high', 'D', 'Which'), leaf('n_high', 'N', 'book')]),
  node('tp', 'TP', [
    leaf('t_probe', 'T', '[uφ]'),
    node('vp', 'VP', [
      node('dp_goal', 'DP', [leaf('d_goal', 'D', 'the'), leaf('n_goal', 'N', 'girls')]),
      node('dp_low', 'DP', [leaf('d_low', 'D', 't₁')])
    ])
  ])
]);

const relationLink = ({ relation, relationIndex, anchors, renderFamily, trajectoryKind, values }) => ({
  relation,
  authoredRelationKey: `0:${relationIndex}`,
  anchors,
  renderFamily,
  trajectoryKind,
  values,
  operation: 'Relation'
});

const relationStep = ({ relation, relationIndex, links }) => ({
  operation: relation,
  replayKind: 'relation',
  replayRelationIdentity: { stageIndex: 0, relationIndex },
  targetNodeId: '',
  targetLabel: relation,
  sourceLabels: [],
  replayCanvasData: canvas,
  replayRelationLinks: links
});

test('movement relation moments alone receive Source and Landing support lines', () => {
  const step = relationStep({
    relation: 'AbarMove',
    relationIndex: 0,
    links: [relationLink({
      relation: 'AbarMove',
      relationIndex: 0,
      anchors: [
        { role: 'lowerCopy', nodeId: 'dp_low' },
        { role: 'pronouncedCopy', nodeId: 'dp_high' }
      ],
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal'
    })]
  });
  step.sourceNodeIds = ['dp_low'];
  step.sourceLabels = ['t₁'];
  step.targetNodeId = 'dp_high';
  step.targetLabel = 'Which book';

  assert.equal(stepRepresentsMovement(step), true);
  assert.deepEqual(
    buildReplaySupportLines(step).map(({ label }) => label),
    ['Source', 'Landing']
  );
});

test('BoundingNodeCrossing uses its registered authored roles, not movement labels', () => {
  const earlierMovement = relationLink({
    relation: 'AbarMove',
    relationIndex: 0,
    anchors: [
      { role: 'lowerCopy', nodeId: 'dp_low' },
      { role: 'pronouncedCopy', nodeId: 'dp_high' }
    ],
    renderFamily: 'trajectory',
    trajectoryKind: 'phrasal'
  });
  const step = relationStep({
    relation: 'BoundingNodeCrossing',
    relationIndex: 1,
    links: [
      earlierMovement,
      relationLink({
        relation: 'BoundingNodeCrossing',
        relationIndex: 1,
        anchors: [
          { role: 'boundary', nodeId: 'tp' },
          { role: 'boundary', nodeId: 'vp' },
          { role: 'domain', nodeId: 'cp' }
        ],
        renderFamily: 'authored-anchor-link'
      })
    ]
  });

  assert.equal(stepRepresentsMovement(step), false);
  assert.deepEqual(buildReplaySupportLines(step), [
    { label: 'Domain', value: 'CP' },
    { label: 'Boundary', value: 'TP, VP' }
  ]);
});

test('OperatorVariableBinding keeps role-faithful wording as a semantic relation', () => {
  const step = relationStep({
    relation: 'OperatorVariableBinding',
    relationIndex: 0,
    links: [relationLink({
      relation: 'OperatorVariableBinding',
      relationIndex: 0,
      anchors: [
        { role: 'operator', nodeId: 'dp_high' },
        { role: 'variable', nodeId: 'dp_low' },
        { role: 'traceWitness', nodeId: 'd_low' },
        { role: 'scopeDomain', nodeId: 'tp' }
      ],
      renderFamily: 'operator-variable-binding'
    })]
  });

  assert.equal(stepRepresentsMovement(step), false);
  assert.deepEqual(buildReplaySupportLines(step), [
    { label: 'Operator', value: 'Which book' },
    { label: 'Variable', value: 't₁' },
    { label: 'Trace Witness', value: 't₁' },
    { label: 'Scope Domain', value: 'TP' }
  ]);
});

test('compiled OperatorVariableBinding Replay preserves authored participant roles', () => {
  const tree = {
    id: 'cp_operator_variable',
    label: 'CP',
    children: [
      {
        id: 'dp_operator',
        label: 'DP',
        children: [{ id: 'd_operator', label: 'D', word: 'Which book', lineageId: 'wh-chain' }]
      },
      {
        id: 'dp_variable',
        label: 'DP',
        silent: true,
        children: [{ id: 'd_variable', label: 'D', word: 't₁', silent: true, lineageId: 'wh-chain' }]
      }
    ]
  };
  const stages = [{
    statement: 'The operator binds the object variable.',
    stageRecord: 'OperatorVariableBinding relates the operator to its variable.',
    relations: [{
      relation: 'OperatorVariableBinding',
      anchors: {
        operator: 'dp_operator',
        variable: 'dp_variable',
        traceWitness: 'd_variable',
        scopeDomain: 'cp_operator_variable'
      }
    }],
    workspaceForest: [tree]
  }];
  const frames = adaptDerivationStagesForReplay(stages);
  const plan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(frames, undefined, plan);
  const relation = steps.find((step) => (
    step.replayKind === 'relation' && step.operation === 'OperatorVariableBinding'
  ));

  assert.ok(relation);
  assert.deepEqual(
    relation.replayRelationLinks.find((link) => link.authoredRelationKey === '0:0')?.anchors,
    [
      { role: 'operator', nodeId: 'dp_operator' },
      { role: 'variable', nodeId: 'dp_variable' },
      { role: 'traceWitness', nodeId: 'd_variable' },
      { role: 'scopeDomain', nodeId: 'cp_operator_variable' }
    ]
  );
  assert.deepEqual(buildReplaySupportLines(relation), [
    { label: 'Operator', value: 'Which book' },
    { label: 'Variable', value: 't₁' },
    { label: 'Trace Witness', value: 't₁' },
    { label: 'Scope Domain', value: 'CP' }
  ]);
});

test('representative nonmovement relations retain role-faithful participants and values', () => {
  const agree = relationStep({
    relation: 'Agree',
    relationIndex: 0,
    links: [relationLink({
      relation: 'Agree',
      relationIndex: 0,
      anchors: [
        { role: 'goal', nodeId: 'dp_goal' },
        { role: 'probe', nodeId: 't_probe' }
      ],
      renderFamily: 'authored-anchor-link',
      values: { valuation: '3PL' }
    })]
  });
  assert.equal(stepRepresentsMovement(agree), false);
  assert.deepEqual(buildReplaySupportLines(agree), [
    { label: 'Probe', value: '[uφ]' },
    { label: 'Goal', value: 'the girls' },
    { label: 'Valuation', value: '3PL' }
  ]);

  const phase = relationStep({
    relation: 'Phase',
    relationIndex: 0,
    links: [relationLink({
      relation: 'Phase',
      relationIndex: 0,
      anchors: [
        { role: 'edge', nodeId: 'dp_high' },
        { role: 'phase', nodeId: 'cp' }
      ],
      renderFamily: 'authored-anchor-link'
    })]
  });
  assert.deepEqual(
    buildReplaySupportLines(phase),
    [
      { label: 'Phase', value: 'CP' },
      { label: 'Edge', value: 'Which book' }
    ]
  );
});

test('an open unregistered relation keeps authored role order without semantic guessing', () => {
  const step = relationStep({
    relation: 'OpenRelationName',
    relationIndex: 0,
    links: [relationLink({
      relation: 'OpenRelationName',
      relationIndex: 0,
      anchors: [
        { role: 'firstWitness', nodeId: 'dp_high' },
        { role: 'secondWitness', nodeId: 'dp_goal' }
      ],
      renderFamily: 'authored-anchor-link'
    })]
  });

  assert.equal(step.operation, 'OpenRelationName');
  assert.equal(stepRepresentsMovement(step), false);
  assert.deepEqual(buildReplaySupportLines(step), [
    { label: 'First Witness', value: 'Which book' },
    { label: 'Second Witness', value: 'the girls' }
  ]);
});

test('one-anchor deletion evidence survives alongside an earlier movement relation', () => {
  const tree = node('tp_deletion', 'TP', [
    node('dp_high_deletion', 'DP', [leaf('d_high_deletion', 'D', 'Jane')]),
    node('vp_deletion', 'VP', [
      leaf('v_deletion', 'V', 'invite'),
      node('dp_low_deletion', 'DP', [leaf('d_low_deletion', 'D', 't₁')])
    ])
  ]);
  const stages = [
    {
      statement: 'The object remnant moves out of VP.',
      stageRecord: 'AMove introduces the remnant chain.',
      relations: [{
        relation: 'AMove',
        anchors: {
          lowerCopy: 'dp_low_deletion',
          pronouncedCopy: 'dp_high_deletion'
        }
      }],
      workspaceForest: [tree]
    },
    {
      statement: 'PF deletes VP after the remnant escapes.',
      stageRecord: 'EllipsisDeletion names VP as the silent domain.',
      relations: [{
        relation: 'EllipsisDeletion',
        anchors: { domain: 'vp_deletion' }
      }],
      workspaceForest: [tree]
    }
  ];
  const frames = adaptDerivationStagesForReplay(stages);
  const plan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(frames, undefined, plan);
  const deletion = steps.find((step) => (
    step.replayKind === 'relation' && step.operation === 'EllipsisDeletion'
  ));

  assert.ok(deletion);
  assert.ok(deletion.replayRelationLinks.some((link) => (
    link.authoredRelationKey === '1:0'
    && link.anchors?.some((anchor) => anchor.role === 'domain' && anchor.nodeId === 'vp_deletion')
  )));
  assert.deepEqual(buildReplaySupportLines(deletion), [
    { label: 'Domain', value: 'VP' }
  ]);
});
