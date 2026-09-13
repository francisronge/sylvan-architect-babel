import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';

import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import {
  adaptDerivationStagesForReplay,
  applyVizIds,
  buildPlaybackStepsFromDerivationFrames,
  getNodeId
} from '../replay/replayCompiler.ts';

const leaf = (id, label, word, extra = {}) => ({
  id,
  label,
  word,
  children: [],
  ...extra
});

const node = (id, label, children, extra = {}) => ({
  id,
  label,
  children,
  ...extra
});

const compile = (stages, sentence) => {
  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  return buildPlaybackStepsFromDerivationFrames(frames, sentence, replayPlan);
};

const findNode = (root, targetNodeId) => {
  if (!root) return null;
  if (root.id === targetNodeId) return root;
  for (const child of root.children || []) {
    const found = findNode(child, targetNodeId);
    if (found) return found;
  }
  return null;
};

const collectAllNodes = (root, nodes = []) => {
  if (!root) return nodes;
  nodes.push(root);
  for (const child of root.children || []) collectAllNodes(child, nodes);
  return nodes;
};

const collectExactNodes = (root, targetNodeId) =>
  collectAllNodes(root, []).filter((candidate) => candidate.id === targetNodeId);

const layoutPositions = (canvas) => {
  const hierarchy = d3.hierarchy(structuredClone(canvas));
  applyVizIds(hierarchy);
  const laidOut = d3.tree()
    .size([1200, 900])
    .separation((a, b) => (a.parent === b.parent ? 2.5 : 3.5))(hierarchy);
  return new Map(
    laidOut.descendants().map((entry) => [getNodeId(entry), [entry.x, entry.y]])
  );
};

test('deep future layouts compare tree structure without exponentially escaping child signatures', () => {
  for (const depth of [24, 48, 96]) {
    let tree = leaf('word', 'N', 'word', { tokenIndex: 0 });
    const ids = ['word'];
    for (let index = 0; index < depth; index++) {
      const id = `projection "${index}"`;
      ids.push(id);
      tree = node(id, "N'", [tree]);
    }
    const stage = { statement: 'Project', stageRecord: 'Nested structural control.', relations: [], workspaceForest: [tree] };
    const future = { ...stage, workspaceForest: [node('outer', 'NP', [tree])] };
    const originals = structuredClone([stage, future]);
    const steps = compile([stage, future], 'word');
    const firstRecord = steps.find(step => step.replayFrameIndex === 0 && step.replayKind === 'macro');
    assert.ok(firstRecord);
    for (const id of ids) assert.ok(firstRecord.replayVisibleNodeIds.includes(id), id);
    assert.equal(firstRecord.replayVisibleNodeIds.includes('outer'), false);
    assert.ok(steps.at(-1).replayVisibleNodeIds.includes('outer'));
    assert.deepEqual([stage, future], originals);
  }
});

test('detached workspace roots remain roots until their authored wrapper is built', () => {
  const left = node('tp_left', 'TP', [leaf('left_name', 'N', 'Mia')]);
  const right = node('cp_right', 'CP', [leaf('right_name', 'Adv', 'why')]);
  const finalTree = node('coordp_final', 'CoordP', [
    left,
    node('coordbar_final', "Coord'", [
      leaf('coord_but', 'Coord', 'but'),
      right
    ])
  ]);
  const stages = [
    {
      statement: 'The two clauses are related.',
      stageRecord: 'The workspaces remain separate.',
      relations: [{
        relation: 'Coreference',
        anchors: { antecedent: 'left_name', pronoun: 'right_name' }
      }],
      workspaceForest: [left, right]
    },
    {
      statement: 'The clauses are coordinated.',
      stageRecord: 'External Merge creates CoordP.',
      relations: [],
      workspaceForest: [finalTree]
    }
  ];

  const steps = compile(stages, 'Mia but why');
  const relationStep = steps.find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'relation'
  ));
  const completedFirstStage = steps.find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  const firstWrappingStep = steps.find((step) => step.replayFrameIndex === 1);

  assert.ok(relationStep, 'the first stage retains its authored relation moment');
  assert.ok(completedFirstStage, 'the first stage has a reachable Stage Record');
  assert.ok(firstWrappingStep, 'the wrapping stage has a structural microstep');
  assert.equal(relationStep.replayUsesFutureLayoutScaffold, true);
  assert.equal(completedFirstStage.replayUsesFutureLayoutScaffold, true);
  assert.equal(findNode(completedFirstStage.replayCanvasData, 'coordp_final')?.replayLayoutOnly, true);
  assert.equal(findNode(completedFirstStage.replayCanvasData, 'coord_but')?.replayLayoutOnly, true);
  assert.equal(completedFirstStage.replayVisibleNodeIds?.includes('coordp_final'), false);
  assert.equal(completedFirstStage.replayVisibleNodeIds?.includes('coord_but'), false);
});

test('a single movement wrapper reserves its future layout without leaking the mutation', () => {
  const lowerBase = node('dp_low', 'DP', [
    leaf('d_low', 'D', 'which', { lineageId: 'which-d' })
  ], { lineageId: 'which-dp' });
  const baseVp = node('vp_shared', 'VP', [
    leaf('v_read', 'V', 'read'),
    lowerBase
  ]);
  const lowerMoved = node('dp_low', 'DP', [
    leaf('d_low', 'D', 'which', { silent: true, lineageId: 'which-d' })
  ], { silent: true, lineageId: 'which-dp' });
  const high = node('dp_high', 'DP', [
    leaf('d_high', 'D', 'Which', { lineageId: 'which-d' })
  ], { lineageId: 'which-dp' });
  const movedTree = node('cp_moved', 'CP', [
    high,
    node('cbar_moved', "C'", [
      leaf('c_null', 'C', 'null', { silent: true }),
      node('vp_shared', 'VP', [leaf('v_read', 'V', 'read'), lowerMoved])
    ])
  ]);
  const stages = [
    {
      statement: 'The object is base generated.',
      stageRecord: 'The lower DP is pronounced.',
      relations: [],
      workspaceForest: [baseVp]
    },
    {
      statement: 'The object moves.',
      stageRecord: 'The lower DP becomes a silent copy.',
      relations: [{
        relation: 'AbarMove',
        anchors: { source: 'dp_low', target: 'dp_high', traceWitness: 'd_low' }
      }],
      workspaceForest: [movedTree]
    }
  ];

  const steps = compile(stages, 'Which read');
  const completedBaseStage = steps.find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  const movementStep = steps.find((step) => step.operation === 'AbarMove');

  assert.ok(completedBaseStage);
  assert.ok(movementStep);
  assert.equal(completedBaseStage.replayUsesFutureLayoutScaffold, true);
  assert.ok(findNode(completedBaseStage.replayCanvasData, 'cp_moved'));
  assert.equal(completedBaseStage.replayVisibleNodeIds.includes('cp_moved'), false);
  assert.equal(completedBaseStage.replayVisibleNodeIds.includes('dp_high'), false);
  assert.ok(findNode(completedBaseStage.replayCanvasData, 'vp_shared'));
  assert.equal(findNode(completedBaseStage.replayCanvasData, 'd_low')?.word, 'which');
  assert.notEqual(findNode(completedBaseStage.replayCanvasData, 'd_low')?.silent, true);

  const before = layoutPositions(completedBaseStage.replayCanvasData);
  const after = layoutPositions(movementStep.replayCanvasData);
  assert.deepEqual(before.get('vp_shared'), after.get('vp_shared'));
});

test('a future layout scaffold never subdivides a current dominance edge', () => {
  const currentTree = node('tp_edge_guard', 'TP', [
    node('vp_edge_guard', 'VP', [
      leaf('v_edge_guard', 'V', 'wonder'),
      node('cbar_edge_guard', "C'", [
        leaf('c_edge_guard', 'C', 'whether')
      ])
    ])
  ]);
  const futureTree = node('tp_edge_guard', 'TP', [
    node('vp_edge_guard', 'VP', [
      leaf('v_edge_guard', 'V', 'wonder'),
      node('cp_edge_guard', 'CP', [
        node('dp_edge_guard', 'DP', [leaf('d_edge_guard', 'D', 'which')]),
        node('cbar_edge_guard', "C'", [
          leaf('c_edge_guard', 'C', 'whether')
        ])
      ])
    ])
  ]);
  const stages = [
    {
      statement: 'The current complement is complete.',
      stageRecord: 'VP directly dominates C bar.',
      relations: [],
      workspaceForest: [currentTree]
    },
    {
      statement: 'The later projection is added.',
      stageRecord: 'CP contains the later landing position.',
      relations: [],
      workspaceForest: [futureTree]
    }
  ];

  const steps = compile(stages, 'wonder whether');
  const completedCurrentStage = steps.find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  assert.ok(completedCurrentStage);
  const currentVp = findNode(completedCurrentStage.replayCanvasData, 'vp_edge_guard');
  assert.ok(currentVp);
  assert.deepEqual(
    currentVp.children.map((child) => child.id),
    ['v_edge_guard', 'cbar_edge_guard'],
    'the current VP to C bar edge stays direct'
  );
  assert.equal(
    findNode(currentVp, 'cp_edge_guard'),
    null,
    'a future CP may not be inserted invisibly inside that edge'
  );
});

test('detached workspaces reserve their final wrapper through an intervening internal movement', () => {
  const left = node('tp_left_stable', 'TP', [leaf('left_name_stable', 'N', 'Mia')]);
  const rightBase = node('cbar_right_mutating', "C'", [
    leaf('c_null_mutating', 'C', 'null', { silent: true }),
    node('tp_right_mutating', 'TP', [
      node('adv_low_mutating', 'AdvP', [leaf('why_low_mutating', 'Adv', 'why')])
    ])
  ]);
  const rightMoved = node('cp_right_mutating', 'CP', [
    node('adv_high_mutating', 'AdvP', [leaf('why_high_mutating', 'Adv', 'why')]),
    node('cbar_right_mutating', "C'", [
      leaf('c_null_mutating', 'C', 'null', { silent: true }),
      node('tp_right_mutating', 'TP', [
        node('adv_low_mutating', 'AdvP', [
          leaf('why_low_mutating', 'Adv', 'why', { silent: true })
        ], { silent: true })
      ])
    ])
  ]);
  const finalTree = node('coordp_mutating_wrapper', 'CoordP', [
    left,
    node('coordbar_mutating_wrapper', "Coord'", [
      leaf('coord_but_mutating', 'Coord', 'but'),
      rightMoved
    ])
  ]);
  const stages = [
    {
      statement: 'The clauses are detached.',
      stageRecord: 'The antecedent and lower wh-clause are separate workspace objects.',
      relations: [],
      workspaceForest: [left, rightBase]
    },
    {
      statement: 'The wh-phrase moves inside its own clause.',
      stageRecord: 'Only the right workspace object changes internally.',
      relations: [{
        relation: 'AbarMove',
        anchors: {
          source: 'adv_low_mutating',
          target: 'adv_high_mutating',
          traceWitness: 'why_low_mutating'
        }
      }],
      workspaceForest: [left, rightMoved]
    },
    {
      statement: 'The clauses are coordinated.',
      stageRecord: 'External Merge creates the final wrapper.',
      relations: [],
      workspaceForest: [finalTree]
    }
  ];

  const steps = compile(stages, 'Mia but why');
  const completedDetachedStage = steps.find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  const firstWrappingStep = steps.find((step) => step.replayFrameIndex === 2);

  assert.ok(completedDetachedStage);
  assert.ok(firstWrappingStep);
  assert.equal(completedDetachedStage.replayUsesFutureLayoutScaffold, true);
  assert.equal(
    findNode(completedDetachedStage.replayCanvasData, 'coordp_mutating_wrapper')?.replayLayoutOnly,
    true
  );
  assert.equal(
    completedDetachedStage.replayVisibleNodeIds.includes('coordp_mutating_wrapper'),
    false,
    'the future wrapper reserves geometry without becoming visible syntax'
  );
  assert.ok(findNode(completedDetachedStage.replayCanvasData, 'why_low_mutating'));
  assert.equal(
    findNode(completedDetachedStage.replayCanvasData, 'why_high_mutating')?.replayLayoutOnly,
    true,
    'the future landing reserves geometry without becoming visible syntax'
  );
  assert.equal(completedDetachedStage.replayVisibleNodeIds.includes('why_high_mutating'), false);
});

test('a duplicated future landing disables the scaffold instead of reserving a synthetic copy', () => {
  const left = node('tp_left_collision', 'TP', [leaf('left_collision', 'N', 'Mia')]);
  const currentRight = node('cbar_collision', "C'", [
    node('vp_collision', 'VP', [
      node('why_collision', 'AdvP', [leaf('why_word_collision', 'Adv', 'why')])
    ])
  ]);
  const movedRight = node('cp_collision', 'CP', [
    node('why_collision', 'AdvP', [leaf('why_word_collision', 'Adv', 'why')]),
    node('cbar_collision', "C'", [
      node('vp_collision', 'VP', [
        node('why_low_collision', 'AdvP', [
          leaf('why_low_word_collision', 'Adv', 'why', { silent: true })
        ], { silent: true })
      ])
    ])
  ]);
  const finalTree = node('coordp_collision', 'CoordP', [
    left,
    node('coordbar_collision', "Coord'", [
      leaf('coord_collision', 'Coord', 'but'),
      movedRight
    ])
  ]);
  const stages = [
    {
      statement: 'Why is still in its base position.',
      stageRecord: 'The detached clause contains one pronounced lower occurrence.',
      relations: [],
      workspaceForest: [left, currentRight]
    },
    {
      statement: 'Why moves inside the detached clause.',
      stageRecord: 'The high occurrence is pronounced and the lower occurrence is silent.',
      relations: [{
        relation: 'AbarMove',
        anchors: {
          source: 'why_low_collision',
          target: 'why_collision',
          traceWitness: 'why_low_word_collision'
        }
      }],
      workspaceForest: [left, movedRight]
    },
    {
      statement: 'The clauses are coordinated.',
      stageRecord: 'External Merge creates the final wrapper.',
      relations: [],
      workspaceForest: [finalTree]
    }
  ];

  const steps = compile(stages, 'Mia but why');
  const completedBase = steps.find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  assert.ok(completedBase);
  assert.equal(completedBase.replayUsesFutureLayoutScaffold, false);
  const matchingOccurrences = completedBase.replayCanvasData
    ? collectExactNodes(completedBase.replayCanvasData, 'why_collision')
    : [];
  assert.equal(matchingOccurrences.length, 1);
  assert.ok(findNode(findNode(completedBase.replayCanvasData, 'vp_collision'), 'why_collision'));
  assert.equal(
    collectAllNodes(completedBase.replayCanvasData)
      .some((candidate) => String(candidate.id || '').startsWith('__babel_future_layout_')),
    false,
    'future copies cannot consume space in the current tree'
  );
});

test('a detached-workspace trajectory may reserve its authored pronounced copy', () => {
  const left = node('tp_left_named_copy', 'TP', [leaf('left_named_copy', 'N', 'Mia')]);
  const currentRight = node('cbar_named_copy', "C'", [
    node('vp_named_copy', 'VP', [
      node('adv_shared_named_copy', 'AdvP', [leaf('why_named_copy', 'Adv', 'why')])
    ])
  ]);
  const movedRight = node('cp_named_copy', 'CP', [
    node('adv_shared_named_copy', 'AdvP', [leaf('why_named_copy', 'Adv', 'why')]),
    node('cbar_named_copy', "C'", [
      node('vp_named_copy', 'VP', [
        node('adv_low_named_copy', 'AdvP', [
          leaf('why_low_named_copy', 'Adv', 'why', { silent: true })
        ], { silent: true })
      ])
    ])
  ]);
  const finalTree = node('coordp_named_copy', 'CoordP', [
    left,
    node('coordbar_named_copy', "Coord'", [
      leaf('coord_named_copy', 'Coord', 'but'),
      movedRight
    ])
  ]);
  const stages = [
    {
      statement: 'The clauses are detached.',
      stageRecord: 'Why remains in its base workspace.',
      relations: [],
      workspaceForest: [left, currentRight]
    },
    {
      statement: 'Why moves inside the detached clause.',
      stageRecord: 'The pronounced copy occupies the reserved landing.',
      relations: [{
        relation: 'AbarMove',
        anchors: {
          source: 'adv_low_named_copy',
          pronouncedCopy: 'adv_shared_named_copy',
          traceWitness: 'why_low_named_copy'
        }
      }],
      workspaceForest: [left, movedRight]
    },
    {
      statement: 'The clauses are coordinated.',
      stageRecord: 'External Merge creates the final wrapper.',
      relations: [],
      workspaceForest: [finalTree]
    }
  ];

  const completedBase = compile(stages, 'Mia but why').find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  assert.ok(completedBase);
  assert.equal(completedBase.replayUsesFutureLayoutScaffold, true);
  assert.equal(
    collectAllNodes(completedBase.replayCanvasData)
      .some((candidate) => (
        candidate.replayLayoutOnly === true
        && String(candidate.id || '').endsWith('__adv_shared_named_copy')
      )),
    true
  );
});

test('relation substeps retain an authorized detached-workspace placeholder scaffold', () => {
  const left = node('tp_left_relation_scaffold', 'TP', [
    leaf('left_relation_scaffold', 'N', 'Mia')
  ]);
  const currentRight = node('cbar_relation_scaffold', "C'", [
    leaf('c_relation_scaffold', 'C', '∅', { silent: true }),
    node('tp_relation_scaffold', 'TP', [
      node('vp_relation_scaffold', 'VP', [
        node('adv_shared_relation_scaffold', 'AdvP', [
          leaf('why_relation_scaffold', 'Adv', 'why')
        ])
      ])
    ])
  ]);
  const silentRight = node('cbar_relation_scaffold', "C'", [
    leaf('c_relation_scaffold', 'C', '∅', { silent: true }),
    node('tp_relation_scaffold', 'TP', [
      node('vp_relation_scaffold', 'VP', [
        node('adv_shared_relation_scaffold', 'AdvP', [
          leaf('why_relation_scaffold', 'Adv', 'why', { silent: true })
        ], { silent: true })
      ], { silent: true })
    ], { silent: true })
  ]);
  const movedRight = node('cp_relation_scaffold', 'CP', [
    node('adv_shared_relation_scaffold', 'AdvP', [
      leaf('why_relation_scaffold', 'Adv', 'why')
    ]),
    node('cbar_relation_scaffold', "C'", [
      leaf('c_relation_scaffold', 'C', '∅', { silent: true }),
      node('tp_relation_scaffold', 'TP', [
        node('vp_relation_scaffold', 'VP', [
          node('adv_low_relation_scaffold', 'AdvP', [
            leaf('why_low_relation_scaffold', 'Adv', 'why', { silent: true })
          ], { silent: true })
        ], { silent: true })
      ], { silent: true })
    ])
  ]);
  const finalTree = node('coordp_relation_scaffold', 'CoordP', [
    left,
    node('coordbar_relation_scaffold', "Coord'", [
      leaf('coord_relation_scaffold', 'Coord', 'but'),
      movedRight
    ])
  ]);
  const stages = [
    {
      statement: 'The clauses are detached.',
      stageRecord: 'The landing is reserved without becoming visible.',
      relations: [],
      workspaceForest: [left, currentRight]
    },
    {
      statement: 'The right C bears E and its TP is silenced.',
      stageRecord: 'Both relation moments retain the reserved layout.',
      relations: [
        {
          relation: 'FeatureBundle',
          anchors: { licensor: 'c_relation_scaffold' },
          values: { feature: '[E]' }
        },
        {
          relation: 'Ellipsis',
          anchors: { domain: 'tp_relation_scaffold' }
        }
      ],
      workspaceForest: [left, silentRight]
    },
    {
      statement: 'Why moves inside the detached clause.',
      stageRecord: 'The pronounced copy occupies the reserved landing.',
      relations: [{
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'adv_low_relation_scaffold',
          pronouncedCopy: 'adv_shared_relation_scaffold',
          traceWitness: 'why_low_relation_scaffold'
        }
      }],
      workspaceForest: [left, movedRight]
    },
    {
      statement: 'The clauses are coordinated.',
      stageRecord: 'External Merge creates the final wrapper.',
      relations: [],
      workspaceForest: [finalTree]
    }
  ];

  const steps = compile(stages, 'Mia but why');
  const relationSteps = steps.filter((step) => (
    step.replayFrameIndex === 1 && step.replayKind === 'relation'
  ));
  assert.equal(relationSteps.length, 2);
  relationSteps.forEach((step) => {
    assert.equal(step.replayUsesFutureLayoutScaffold, true);
    assert.equal(step.replayVisibleNodeIds?.includes('cp_relation_scaffold'), false);
  });

  const finalStep = steps.find((step) => (
    step.replayFrameIndex === 3 && step.replayKind === 'macro'
  ));
  assert.ok(finalStep);
  const finalPositions = layoutPositions(finalStep.replayCanvasData);
  relationSteps.forEach((step) => {
    const positions = layoutPositions(step.replayCanvasData);
    for (const nodeId of [
      'tp_left_relation_scaffold',
      'cbar_relation_scaffold',
      'tp_relation_scaffold'
    ]) {
      assert.deepEqual(positions.get(nodeId), finalPositions.get(nodeId));
    }
  });
});

test('a non-trajectory pronouncedCopy anchor cannot authorize a duplicate future occurrence', () => {
  const left = node('tp_left_nontrajectory', 'TP', [leaf('left_nontrajectory', 'N', 'Mia')]);
  const currentRight = node('cbar_nontrajectory', "C'", [
    node('adv_shared_nontrajectory', 'AdvP', [leaf('why_nontrajectory', 'Adv', 'why')])
  ]);
  const futureRight = node('cp_nontrajectory', 'CP', [
    node('adv_shared_nontrajectory', 'AdvP', [leaf('why_nontrajectory', 'Adv', 'why')]),
    node('cbar_nontrajectory', "C'", [
      node('adv_low_nontrajectory', 'AdvP', [
        leaf('why_low_nontrajectory', 'Adv', 'why', { silent: true })
      ], { silent: true })
    ])
  ]);
  const stages = [
    {
      statement: 'The clauses are detached.',
      stageRecord: 'The lower workspace contains one occurrence.',
      relations: [],
      workspaceForest: [left, currentRight]
    },
    {
      statement: 'A non-trajectory relation is authored.',
      stageRecord: 'It cannot authorize a duplicate layout occurrence.',
      relations: [{
        relation: 'Identity',
        anchors: { pronouncedCopy: 'adv_shared_nontrajectory' }
      }],
      workspaceForest: [left, futureRight]
    }
  ];

  const completedBase = compile(stages, 'Mia why').find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  assert.ok(completedBase);
  assert.equal(completedBase.replayUsesFutureLayoutScaffold, false);
  assert.equal(
    collectAllNodes(completedBase.replayCanvasData)
      .some((candidate) => String(candidate.id || '').startsWith('__babel_future_layout_')),
    false
  );
});
