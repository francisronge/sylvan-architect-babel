import assert from 'node:assert/strict';
import test from 'node:test';
import { hierarchy } from 'd3';

import {
  __TEST_ONLY__,
  buildAuthoredRelationLinksForFrames,
  buildDerivationReplaySnapshot,
  buildReplaySupportLines,
  buildResolvedLinkOperatorVariableIndexMap,
  buildResolvedLinkTraceIndexMap
} from '../replay/replayCompiler.ts';

const { materializeReplayPreterminals } = __TEST_ONLY__;

test('silent syntax preserves authored labels, lineage, and complete subtrees', () => {
  const silentPro = {
    id: 'pro_dp',
    label: 'DP',
    silent: true,
    lineageId: 'controller-john',
    children: [{
      id: 'pro_terminal',
      label: 'PRO',
      silent: true,
      lineageId: 'controller-john'
    }]
  };

  const result = materializeReplayPreterminals(silentPro);
  assert.equal(result.label, 'DP');
  assert.equal(result.silent, true);
  assert.equal(result.lineageId, 'controller-john');
  assert.equal(result.children?.[0]?.label, 'PRO');
  assert.equal(result.children?.[0]?.silent, true);
});

test('silent lexical material is muted without being rewritten as a trace', () => {
  const result = materializeReplayPreterminals({
    id: 'silent_v',
    label: 'V',
    word: 'read',
    silent: true,
    lineageId: 'ellipsis-read'
  });

  assert.equal(result.label, 'V');
  assert.equal(result.silent, true);
  assert.equal(result.lineageId, 'ellipsis-read');
  assert.equal(result.children?.[0]?.label, 'read');
  assert.equal(result.children?.[0]?.silent, true);
});

test('synthetic replay terminals preserve authored lineage identity', () => {
  const materialized = __TEST_ONLY__.materializeReplayPreterminals({
    id: 'd-copy',
    label: 'D',
    word: 'who',
    silent: true,
    lineageId: 'who-chain'
  });

  assert.equal(materialized.children?.[0]?.lineageId, 'who-chain');
  assert.equal(materialized.children?.[0]?.silent, true);
});

test('authored traces and authored nulls retain their own surfaces', () => {
  const trace = materializeReplayPreterminals({
    id: 'trace_d',
    label: 'D',
    word: 't₁',
    silent: true,
    lineageId: 'wh-chain'
  });
  assert.equal(trace.label, 'D');
  assert.equal(trace.children?.[0]?.label, 't₁');

  const authoredNull = materializeReplayPreterminals({
    id: 'null_terminal',
    label: '∅',
    silent: true
  });
  assert.equal(authoredNull.label, '∅');
  assert.equal(authoredNull.children, undefined);
});

test('a nonmovement relation cannot turn its silent head anchor into a trace', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'c_ellipsis',
        label: 'C',
        children: [{ id: 'c_ellipsis__null', label: '∅', silent: true }]
      },
      { id: 'tp_silent', label: 'TP', silent: true, children: [] }
    ]
  }];
  const traceIndices = buildResolvedLinkTraceIndexMap(forest, [{
    relationIndex: '2',
    relation: 'Agree',
    sourceNodeId: 'c_ellipsis',
    targetNodeId: 'tp_silent',
    renderFamily: 'authored-anchor-link',
    operation: 'Relation',
    stepIndex: 0
  }], 0);

  assert.equal(traceIndices.has('c_ellipsis'), false);
  assert.equal(traceIndices.has('c_ellipsis__null'), false);
  assert.equal(traceIndices.has('tp_silent'), false);
});

test('a nonmovement relation cannot enter the movement-arrow builder', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'c_ellipsis',
        label: 'C',
        children: [{ id: 'c_ellipsis__null', label: '∅', silent: true }]
      },
      { id: 'tp_silent', label: 'TP', silent: true, children: [] }
    ]
  }];
  const frames = [{
    workspaceForest: forest,
    change: {
      details: {
        derivationStageRelations: [{
          relation: 'Agree',
          anchors: { probe: 'c_ellipsis', goal: 'tp_silent' }
        }]
      }
    }
  }];
  const links = buildAuthoredRelationLinksForFrames(frames, null, 0, forest);
  const visibleNodes = hierarchy(forest[0]).descendants();
  const arrows = __TEST_ONLY__.buildMovementArrowsFromLinks(
    visibleNodes,
    links,
    new Map(),
    []
  );

  assert.equal(links[0].renderFamily, 'authored-anchor-link');
  assert.deepEqual(arrows, []);
});

test('a feature dependency survives replay without becoming a second movement chain', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'high_dp',
        label: 'DP',
        children: [{ id: 'high_d', label: 'D', children: [{ id: 'who', label: 'Who' }] }]
      },
      {
        id: 'cbar',
        label: "C'",
        children: [
          {
            id: 'c_ellipsis',
            label: 'C',
            children: [{ id: 'c_ellipsis__null', label: '∅', silent: true }]
          },
          {
            id: 'tp_silent',
            label: 'TP',
            silent: true,
            children: [{
              id: 'low_dp',
              label: 'DP',
              silent: true,
              children: [{ id: 'low_d', label: 'D', word: 't', silent: true }]
            }]
          }
        ]
      }
    ]
  }];
  const frames = [
    {
      workspaceForest: forest,
      change: {
        details: {
          derivationStageRelations: [{
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'low_dp',
              traceWitness: 'low_d',
              pronouncedCopy: 'high_dp'
            }
          }]
        }
      }
    },
    {
      workspaceForest: forest,
      change: {
        details: {
          derivationStageRelations: [{
            relation: 'Agree',
            anchors: { probe: 'c_ellipsis', goal: 'tp_silent' }
          }]
        }
      }
    }
  ];
  const authoredLinks = buildAuthoredRelationLinksForFrames(frames, null, 1, forest);
  const snapshot = buildDerivationReplaySnapshot(
    forest,
    1,
    authoredLinks,
    undefined,
    undefined,
    frames
  );
  const movement = snapshot.relationLinks.find((link) => link.relation === 'AbarMove');
  const licensing = snapshot.relationLinks.find((link) => link.relation === 'Agree');
  const traceIndices = buildResolvedLinkTraceIndexMap(forest, snapshot.relationLinks, 1);

  assert.equal(movement?.sourceNodeId, 'low_dp');
  assert.equal(movement?.targetNodeId, 'high_dp');
  assert.equal(movement?.witnessNodeId, 'low_d');
  assert.equal(movement?.renderFamily, 'trajectory');
  assert.equal(licensing?.renderFamily, 'authored-anchor-link');
  assert.equal(traceIndices.get('low_d'), '1');
  assert.equal(traceIndices.has('c_ellipsis'), false);
  assert.equal(traceIndices.has('c_ellipsis__null'), false);
});

test('partial copy deletion does not rewrite the deleted lower material as a movement trace', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'vp_high',
        label: 'VP',
        children: [
          { id: 'v_high', label: 'V', word: 'kan' },
          { id: 'dp_high', label: 'DP', children: [{ id: 'n_high', label: 'N', word: 'xiaoshuo' }] }
        ]
      },
      {
        id: 'vp_low',
        label: 'VP',
        children: [
          { id: 'v_low', label: 'V', word: 'kan' },
          {
            id: 'dp_low',
            label: 'DP',
            silent: true,
            children: [{ id: 'n_low', label: 'N', word: 'xiaoshuo', silent: true }]
          }
        ]
      }
    ]
  }];
  const frames = [
    {
      workspaceForest: forest,
      change: {
        details: {
          derivationStageRelations: [{
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'vp_low',
              traceWitness: 'v_low',
              pronouncedCopy: 'vp_high'
            }
          }]
        }
      }
    },
    {
      workspaceForest: forest,
      change: {
        details: {
          derivationStageRelations: [{
            relation: 'PartialCopyDeletion',
            anchors: { lowerCopy: 'vp_low', deletedSubconstituent: 'dp_low' }
          }]
        }
      }
    }
  ];
  const authoredLinks = buildAuthoredRelationLinksForFrames(frames, null, 1, forest);
  const snapshot = buildDerivationReplaySnapshot(
    forest,
    1,
    authoredLinks,
    undefined,
    undefined,
    frames
  );
  const traceIndices = buildResolvedLinkTraceIndexMap(forest, snapshot.relationLinks, 1);

  assert.equal(traceIndices.get('v_low'), '1');
  assert.equal(traceIndices.has('vp_low'), false);
  assert.equal(traceIndices.has('dp_low'), false);
  assert.equal(traceIndices.has('n_low'), false);
});

test('a movement relation still assigns its index to the authored trace witness', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      { id: 'high_dp', label: 'DP', children: [] },
      {
        id: 'low_dp',
        label: 'DP',
        silent: true,
        children: [{ id: 'low_d', label: 'D', word: 't', silent: true }]
      }
    ]
  }];
  const traceIndices = buildResolvedLinkTraceIndexMap(forest, [{
    relationIndex: '1',
    relation: 'AbarMove',
    sourceNodeId: 'low_dp',
    targetNodeId: 'high_dp',
    witnessNodeId: 'low_d',
    renderFamily: 'trajectory',
    trajectoryKind: 'phrasal',
    stepIndex: 0
  }], 0);

  assert.equal(traceIndices.get('low_dp'), '1');
  assert.equal(traceIndices.get('low_d'), '1');
  assert.equal(traceIndices.has('high_dp'), false);
});

test('successive movement links preserve one authored index across the chain', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      { id: 'high_dp', label: 'DP', children: [] },
      {
        id: 'mid_dp',
        label: 'DP',
        silent: true,
        children: [{ id: 'mid_d', label: 'D', word: 't_1', silent: true }]
      },
      {
        id: 'low_dp',
        label: 'DP',
        silent: true,
        children: [{ id: 'low_d', label: 'D', word: 't_1', silent: true }]
      },
      {
        id: 'base_dp',
        label: 'DP',
        silent: true,
        children: [{ id: 'base_d', label: 'D', word: 't_1', silent: true }]
      }
    ]
  }];
  const traceIndices = buildResolvedLinkTraceIndexMap(forest, [
    {
      relationIndex: '1',
      relation: 'AbarMove',
      sourceNodeId: 'base_dp',
      targetNodeId: 'low_dp',
      witnessNodeId: 'base_d',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    },
    {
      relationIndex: '2',
      relation: 'AbarMove',
      sourceNodeId: 'low_dp',
      targetNodeId: 'mid_dp',
      witnessNodeId: 'low_d',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    },
    {
      relationIndex: '3',
      relation: 'AbarMove',
      sourceNodeId: 'mid_dp',
      targetNodeId: 'high_dp',
      witnessNodeId: 'mid_d',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    }
  ], 0);

  for (const nodeId of ['base_dp', 'base_d', 'low_dp', 'low_d', 'mid_dp', 'mid_d']) {
    assert.equal(traceIndices.get(nodeId), '1');
  }
});

test('successive movement links share one fallback index without authored trace numerals', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      { id: 'high_dp', label: 'DP', children: [] },
      { id: 'mid_dp', label: 'DP', silent: true, children: [{ id: 'mid_d', label: 'D', word: 'Which', silent: true }] },
      { id: 'base_dp', label: 'DP', silent: true, children: [{ id: 'base_d', label: 'D', word: 'Which', silent: true }] }
    ]
  }];
  const traceIndices = buildResolvedLinkTraceIndexMap(forest, [
    {
      relationIndex: '2',
      relation: 'AbarMove',
      sourceNodeId: 'base_dp',
      targetNodeId: 'mid_dp',
      witnessNodeId: 'base_d',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    },
    {
      relationIndex: '1',
      relation: 'AbarMove',
      sourceNodeId: 'mid_dp',
      targetNodeId: 'high_dp',
      witnessNodeId: 'mid_d',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    }
  ], 0);

  for (const nodeId of ['base_dp', 'base_d', 'mid_dp', 'mid_d']) {
    assert.equal(traceIndices.get(nodeId), '1');
  }
});

test('authored relation links preserve literal anchor roles and use shared lineage only as identity', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'high_dp',
        label: 'DP',
        children: [{ id: 'high_d', label: 'D', word: 'Which', lineageId: 'wh-d' }]
      },
      {
        id: 'low_dp',
        label: 'DP',
        silent: true,
        children: [{ id: 'low_d', label: 'D', word: 't₁', silent: true, lineageId: 'wh-d' }]
      }
    ]
  }];
  const frames = [{
    workspaceForest: forest,
    change: {
      details: {
        derivationStageRelations: [{
          relation: 'AbarMove',
          anchors: { lowerCopy: 'low_dp', pronouncedCopy: 'high_dp' }
        }]
      }
    }
  }];

  const links = buildAuthoredRelationLinksForFrames(frames, null, 0, forest);
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].anchors, [
    { role: 'lowerCopy', nodeId: 'low_dp' },
    { role: 'pronouncedCopy', nodeId: 'high_dp' }
  ]);
  assert.equal(links[0].sourceNodeId, 'low_dp');
  assert.equal(links[0].targetNodeId, 'high_dp');
  assert.equal(links[0].endpointOrderProvenance, 'registered-role-order');
  assert.ok(String(links[0].relationIndex || '').length > 0);
  assert.equal(links[0].relationIndexProvenance, 'derived-presentation');
  assert.equal(links[0].identityProvenance, 'authored-shared-lineage');
  assert.match(links[0].identityKey, /wh-d/);
  assert.equal(links[0].chainId, undefined);

  const distinctForest = structuredClone(forest);
  distinctForest[0].children[0].children[0].lineageId = 'high-only';
  distinctForest[0].children[1].children[0].lineageId = 'low-only';
  const distinctFrames = [{
    ...frames[0],
    workspaceForest: distinctForest
  }];
  const [distinctLink] = buildAuthoredRelationLinksForFrames(
    distinctFrames,
    null,
    0,
    distinctForest
  );
  assert.equal(distinctLink.sourceNodeId, 'low_dp');
  assert.equal(distinctLink.targetNodeId, 'high_dp');
  assert.equal(distinctLink.identityKey, undefined);
});

test('authored relation display indices are derived without prescribing index symbols or inferred pairing', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'who_high',
        label: 'DP',
        children: [{ id: 'who_high_d', label: 'D', word: 'Who', lineageId: 'who-chain' }]
      },
      {
        id: 'who_low',
        label: 'DP',
        silent: true,
        children: [{ id: 'who_low_d', label: 'D', word: 't', silent: true, lineageId: 'who-chain' }]
      },
      {
        id: 'what_high',
        label: 'DP',
        children: [{ id: 'what_high_d', label: 'D', word: 'What', lineageId: 'what-chain' }]
      },
      {
        id: 'what_low',
        label: 'DP',
        silent: true,
        children: [{ id: 'what_low_d', label: 'D', word: 't', silent: true, lineageId: 'what-chain' }]
      }
    ]
  }];
  const frames = [{
    workspaceForest: forest,
    change: {
      details: {
        derivationStageRelations: [
          {
            relation: 'OperatorVariableBinding',
            anchors: { operator: 'who_high', variable: 'who_low' }
          },
          {
            relation: 'OperatorVariableBinding',
            anchors: { operator: 'what_high', variable: 'what_low' }
          }
        ]
      }
    }
  }];

  const links = buildAuthoredRelationLinksForFrames(frames, null, 0, forest);
  assert.equal(links.length, 2);
  assert.equal(new Set(links.map((link) => link.relationIndex)).size, 2);
  links.forEach((link) => {
    assert.ok(String(link.relationIndex || '').length > 0);
    assert.equal(link.relationIndexProvenance, 'derived-presentation');
    assert.equal(link.endpointOrderProvenance, 'registered-role-order');
    assert.equal(link.identityProvenance, 'authored-shared-lineage');
    assert.equal(link.chainId, undefined);
  });
  assert.deepEqual(links[0].anchors, [
    { role: 'operator', nodeId: 'who_high' },
    { role: 'variable', nodeId: 'who_low' }
  ]);
  assert.deepEqual(links[1].anchors, [
    { role: 'operator', nodeId: 'what_high' },
    { role: 'variable', nodeId: 'what_low' }
  ]);
  assert.match(links[0].identityKey, /who-chain/);
  assert.match(links[1].identityKey, /what-chain/);
  assert.notEqual(links[0].identityKey, links[1].identityKey);
});

test('operator-variable shared indices cover the operator and authored trace witness', () => {
  const forest = [{
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'operator_dp',
        label: 'DP',
        children: [{ id: 'operator_d', label: 'D', word: 'Who' }]
      },
      {
        id: 'variable_dp',
        label: 'DP',
        silent: true,
        children: [{ id: 'variable_trace', label: 't', silent: true }]
      }
    ]
  }];
  const indices = buildResolvedLinkOperatorVariableIndexMap(forest, [{
    relationIndex: '1',
    relation: 'OperatorVariableBinding',
    sourceNodeId: 'variable_dp',
    targetNodeId: 'operator_dp',
    witnessNodeId: 'variable_trace',
    renderFamily: 'operator-variable-binding',
    stepIndex: 0
  }], 0);

  assert.equal(indices.get('operator_dp'), '1');
  assert.equal(indices.get('operator_d'), '1');
  assert.equal(indices.get('variable_trace'), '1');
  assert.equal(indices.has('variable_dp'), false);
});
