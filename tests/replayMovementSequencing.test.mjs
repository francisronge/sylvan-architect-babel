import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';

import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import {
  adaptDerivationStagesForReplay,
  applyPreFrontingSentenceInitialCasing,
  applyVizIds,
  buildMovementArrowsFromLinks,
  buildMovementCopyTraceIndexByTerminalId,
  buildPlaybackStepsFromDerivationFrames,
  resolveLexicalMovementTraceDisplayIndex
} from '../replay/replayCompiler.ts';

const clone = (value) => structuredClone(value);

test('a thematic description keeps its authored merge moment without inventing predication', () => {
  const predicate = { id: 'verb', label: 'V', word: 'read' };
  const theme = { id: 'object', label: 'DP', word: 'books' };
  const other = { id: 'other', label: 'C', silent: true };
  const relation = { relation: 'Authored combination', anchors: { predicate: 'verb', theme: 'object', result: 'vp' },
    priorAnchors: { predicate: 'verb', theme: 'object' }, values: { selection: 'a DP theme' } };
  const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations });
  const stages = [stage([predicate, theme, other]), stage([
    { id: 'vp', label: 'VP', children: [predicate, theme] }, other
  ], [relation])];
  const original = clone(stages);
  const prepared = prepareReplay({ derivationStages: stages, sentence: 'read books', includePlayback: true });
  const steps = prepared.playbackSteps;
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
  assert.ok(moment > 0);
  assert.ok(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes('vp')));
  assert.ok(steps[moment].replayVisibleNodeIds.includes('vp'));
  for (const id of ['verb', 'object', 'other']) assert.ok(steps[moment].replayVisibleNodeIds.includes(id));
  assert.ok(!prepared.relationRenderPlan.frames.flatMap(f => f.items).some(item => item.familyId === 'predication.paths'));
  assert.deepEqual(stages, original);
});

// The contract requires a moved occurrence to be shown in place by an earlier
// stage. This builds that base stage from the final tree: the landing is
// absent and the listed lower occurrences are pronounced with their words.
const baseStageBefore = (forest, { landingIds = [], pronounce = {} }, statement = 'The base structure is built.') => {
  const roots = clone(forest);
  const restore = (item) => {
    if (!item || typeof item !== 'object') return;
    if (Object.hasOwn(pronounce, item.id)) {
      delete item.silent;
      if (typeof pronounce[item.id] === 'string') item.word = pronounce[item.id];
    }
    (item.children || []).forEach(restore);
  };
  const withhold = (item) => {
    if (!item?.children) return;
    item.children = item.children.filter((child) => !landingIds.includes(child.id));
    item.children.forEach(withhold);
  };
  roots.forEach(restore);
  roots.forEach(withhold);
  return {
    statement,
    stageRecord: `${statement} The occurrence that later moves is in its base position.`,
    relations: [],
    workspaceForest: roots.filter((root) => !landingIds.includes(root.id))
  };
};

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

test('established movement indices apply to overt and silent occurrences without changing pronunciation', () => {
  const overtRoot = d3.hierarchy(node('dp_overt', 'DP', [
    leaf('d_overt', 'D', 'keoi')
  ]));
  const silentRoot = d3.hierarchy(node('dp_silent', 'DP', [
    leaf('d_silent', 'D', 'which')
  ], { silent: true }));

  assert.equal(
    resolveLexicalMovementTraceDisplayIndex(overtRoot.leaves()[0], 'keoi', '1'),
    '1',
    'a pronounced occurrence can show its chain membership'
  );
  assert.equal(
    resolveLexicalMovementTraceDisplayIndex(silentRoot.leaves()[0], 'which', '1'),
    '1',
    'a silent lexical occurrence can show the same chain membership'
  );
  assert.equal(overtRoot.leaves()[0].data.silent, undefined);
  assert.equal(silentRoot.data.silent, true);
});

// Replay may give a pronounced leaf a stable synthetic id and keep the
// authored id in aliasIds, exactly as the compiler's own lookups resolve it.
const findNode = (root, nodeId) => {
  if (!root) return null;
  if (root.id === nodeId || (Array.isArray(root.aliasIds) && root.aliasIds.includes(nodeId))) return root;
  for (const child of root.children || []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
};

test('successive movement arrows keep one display index across connected occurrences', () => {
  const tree = node('cp_chain', 'CP', [
    node('dp_high', 'DP', [leaf('d_high', 'D', 'Which')]),
    node('dp_mid', 'DP', [leaf('d_mid', 'D', 'which', { silent: true })], { silent: true }),
    node('dp_base', 'DP', [leaf('d_base', 'D', 'which', { silent: true })], { silent: true })
  ]);
  const hierarchy = d3.hierarchy(tree);
  applyVizIds(hierarchy);
  hierarchy.descendants().forEach((candidate, index) => {
    candidate.x = index * 10;
    candidate.y = index * 20;
  });
  const arrows = buildMovementArrowsFromLinks(
    hierarchy.descendants(),
    [
      {
        relationIndex: '2',
        relation: 'AbarMove',
        sourceNodeId: 'dp_base',
        targetNodeId: 'dp_mid',
        witnessNodeId: 'd_base',
        renderFamily: 'trajectory',
        trajectoryKind: 'phrasal',
        stepIndex: 0
      },
      {
        relationIndex: '1',
        relation: 'AbarMove',
        sourceNodeId: 'dp_mid',
        targetNodeId: 'dp_high',
        witnessNodeId: 'd_mid',
        renderFamily: 'trajectory',
        trajectoryKind: 'phrasal',
        stepIndex: 0
      }
    ],
    new Map([
      ['dp_base', 0], ['d_base', 0], ['dp_mid', 0], ['d_mid', 0], ['dp_high', 0]
    ]),
    [{ targetNodeId: 'cp_chain', operation: 'AbarMove' }]
  );

  assert.equal(arrows.length, 2);
  assert.deepEqual(arrows.map((arrow) => arrow.index), ['1', '1']);
  const traceIndices = buildMovementCopyTraceIndexByTerminalId(arrows);
  assert.equal(traceIndices.get('d_base'), '1');
  assert.equal(
    traceIndices.get('d_mid'),
    '1',
    'an intermediate landing becomes a trace after the later movement vacates it'
  );
});

test('independent movement chains receive indices in authored rather than canvas order', () => {
  const tree = node('root', 'Root', [
    node('dp_a_high', 'DP', [leaf('d_a_high', 'D', 'A')]),
    node('dp_a_low', 'DP', [leaf('d_a_low', 'D', 't', { silent: true })], { silent: true }),
    node('dp_b_high', 'DP', [leaf('d_b_high', 'D', 'B')]),
    node('dp_b_low', 'DP', [leaf('d_b_low', 'D', 't', { silent: true })], { silent: true })
  ]);
  const hierarchy = d3.hierarchy(tree);
  applyVizIds(hierarchy);
  hierarchy.descendants().forEach((candidate) => {
    candidate.x = candidate.data.id.startsWith('dp_b') ? 200 : 20;
    candidate.y = candidate.data.id.startsWith('dp_b') ? 300 : 30;
  });
  const arrows = buildMovementArrowsFromLinks(
    hierarchy.descendants(),
    [
      {
        relation: 'AbarMove',
        sourceNodeId: 'dp_a_low',
        targetNodeId: 'dp_a_high',
        witnessNodeId: 'd_a_low',
        renderFamily: 'trajectory',
        trajectoryKind: 'phrasal',
        stepIndex: 0
      },
      {
        relation: 'AbarMove',
        sourceNodeId: 'dp_b_low',
        targetNodeId: 'dp_b_high',
        witnessNodeId: 'd_b_low',
        renderFamily: 'trajectory',
        trajectoryKind: 'phrasal',
        stepIndex: 0
      }
    ],
    new Map(hierarchy.descendants().map((candidate) => [candidate.data.id, 0])),
    [{ targetNodeId: 'root', operation: 'AbarMove' }]
  );

  assert.deepEqual(
    Object.fromEntries(arrows.map((arrow) => [arrow.sourceOccurrence?.data.id, arrow.index])),
    { dp_b_low: '2', dp_a_low: '1' }
  );
});

test('a larger remnant movement does not overwrite its nested object chain index', () => {
  const tree = node('root', 'Root', [
    node('dp_object_high', 'DP', [leaf('d_object_high', 'D', 'book', { lineageId: 'object' })], { lineageId: 'object' }),
    node('vp_high', 'VP', [leaf('v_high', 'V', 'read', { lineageId: 'verb' })], { lineageId: 'carrier' }),
    node('vp_low', 'VP', [
      node('dp_object_low', 'DP', [
        leaf('d_object_low', 'D', 'book', { silent: true })
      ], { silent: true, lineageId: 'object' }),
      leaf('v_low', 'V', 'read', { silent: true, lineageId: 'verb' })
    ], { silent: true, lineageId: 'carrier' })
  ]);
  const hierarchy = d3.hierarchy(tree);
  applyVizIds(hierarchy);
  const byId = new Map(hierarchy.descendants().map((candidate) => [candidate.data.id, candidate]));

  const indices = buildMovementCopyTraceIndexByTerminalId([
    {
      source: byId.get('d_object_low'),
      sourceOccurrence: byId.get('dp_object_low'),
      target: byId.get('dp_object_high'),
      step: 0,
      index: '1',
      trajectoryKind: 'phrasal'
    },
    {
      source: byId.get('v_low'),
      sourceOccurrence: byId.get('vp_low'),
      target: byId.get('vp_high'),
      step: 1,
      index: '2',
      trajectoryKind: 'phrasal'
    }
  ]);

  assert.equal(indices.get('d_object_low'), '1');
  assert.equal(indices.get('v_low'), '2');
});

test('a later passenger movement updates its lineage inside the lower carrier copy', () => {
  const tree = node('root', 'Root', [
    node('dp_book_high', 'DP', [leaf('d_book_high', 'D', 'book', { lineageId: 'book-d' })], { lineageId: 'book-dp' }),
    node('vp_carrier_high', 'VP', [
      leaf('v_high', 'V', 'read', { lineageId: 'verb' }),
      node('dp_book_mid', 'DP', [
        leaf('d_book_mid', 'D', 'book', { silent: true, lineageId: 'book-d' })
      ], { silent: true, lineageId: 'book-dp' })
    ], { lineageId: 'carrier' }),
    node('vp_carrier_low', 'VP', [
      leaf('v_low', 'V', 'read', { silent: true, lineageId: 'verb' }),
      node('dp_book_low', 'DP', [
        leaf('d_book_low', 'D', 'book', { silent: true, lineageId: 'book-d' })
      ], { silent: true, lineageId: 'book-dp' })
    ], { silent: true, lineageId: 'carrier' })
  ]);
  const hierarchy = d3.hierarchy(tree);
  applyVizIds(hierarchy);
  const byId = new Map(hierarchy.descendants().map((candidate) => [candidate.data.id, candidate]));

  const indices = buildMovementCopyTraceIndexByTerminalId([
    {
      source: byId.get('v_low'),
      sourceOccurrence: byId.get('vp_carrier_low'),
      target: byId.get('vp_carrier_high'),
      step: 0,
      index: '1',
      trajectoryKind: 'phrasal'
    },
    {
      source: byId.get('d_book_mid'),
      sourceOccurrence: byId.get('dp_book_mid'),
      target: byId.get('dp_book_high'),
      step: 1,
      index: '2',
      trajectoryKind: 'phrasal'
    }
  ]);

  assert.equal(indices.get('v_low'), '1');
  assert.equal(indices.get('d_book_low'), '2');
  assert.equal(indices.get('d_book_mid'), '2');
});

test('phrasal movement reveals the complete landing and lower traces in one relation moment', () => {
  const baseObject = node('dp_wh_low', 'DP', [
    leaf('d_wh_low', 'D', 'Which', { lineageId: 'wh-d' }),
    node('np_wh_low', 'NP', [
      leaf('n_wh_low', 'N', 'book', { lineageId: 'wh-n' })
    ], { lineageId: 'wh-np' })
  ], { lineageId: 'wh-dp' });
  const baseCBar = node('cbar_wh', "C'", [
    leaf('c_did', 'C', 'did'),
    node('tp_wh', 'TP', [
      node('dp_john', 'DP', [leaf('n_john', 'N', 'John')]),
      node('vp_buy', 'VP', [
        leaf('v_buy', 'V', 'buy'),
        baseObject
      ])
    ])
  ]);

  const lowerCopy = clone(baseObject);
  findNode(lowerCopy, 'd_wh_low').word = 't';
  findNode(lowerCopy, 'd_wh_low').silent = true;
  findNode(lowerCopy, 'n_wh_low').word = 't';
  findNode(lowerCopy, 'n_wh_low').silent = true;
  const finalCBar = clone(baseCBar);
  findNode(finalCBar, 'vp_buy').children[1] = lowerCopy;
  const landing = node('dp_wh_high', 'DP', [
    leaf('d_wh_high', 'D', 'Which', { lineageId: 'wh-d' }),
    node('np_wh_high', 'NP', [
      leaf('n_wh_high', 'N', 'book', { lineageId: 'wh-n' })
    ], { lineageId: 'wh-np' })
  ], { lineageId: 'wh-dp' });
  const finalTree = node('cp_wh', 'CP', [landing, finalCBar]);

  const baseTree = baseCBar;
  const stages = [
    {
      statement: 'The C-prime complement is complete before wh-movement.',
      stageRecord: 'Which book is pronounced in its base object position inside the complete C-prime structure.',
      relations: [],
      workspaceForest: [baseTree]
    },
    {
      statement: 'Which book moves to Spec,CP.',
      stageRecord: 'Internal Merge creates CP, leaves a complete silent lower occurrence, and introduces one A-bar dependency.',
      relations: [{
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'dp_wh_low',
          traceWitness: 'd_wh_low',
          pronouncedCopy: 'dp_wh_high'
        }
      }],
      workspaceForest: [finalTree]
    }
  ];

  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    'Which book did John buy',
    replayPlan
  );
  const stageOneSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 1/2')
  );
  const stageTwoSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );

  const baseFrame = stageOneSteps.at(-1);
  for (const step of stageOneSteps) {
    assert.deepEqual(step.replayRelationLinks || [], []);
    assert.equal(findNode(step.replayCanvasData, 'd_wh_low')?.word, 'Which');
    assert.equal(findNode(step.replayCanvasData, 'n_wh_low')?.word, 'book');
    assert.notEqual(findNode(step.replayCanvasData, 'd_wh_low')?.silent, true);
    assert.notEqual(findNode(step.replayCanvasData, 'n_wh_low')?.silent, true);
  }
  assert.equal(baseFrame?.replayKind, 'macro');
  assert.ok(findNode(baseFrame?.replayCanvasData, 'cbar_wh'));
  assert.ok(findNode(baseFrame?.replayCanvasData, 'cp_wh'));
  assert.ok(findNode(baseFrame?.replayCanvasData, 'dp_wh_high'));
  assert.equal(baseFrame?.replayVisibleNodeIds?.includes('cp_wh'), false);
  assert.equal(baseFrame?.replayVisibleNodeIds?.includes('dp_wh_high'), false);
  assert.notEqual(findNode(baseFrame?.replayCanvasData, 'd_wh_low')?.silent, true);
  assert.notEqual(findNode(baseFrame?.replayCanvasData, 'n_wh_low')?.silent, true);
  assert.deepEqual(baseFrame?.replayRelationLinks || [], []);

  assert.deepEqual(
    stageTwoSteps.map((step) => step.operation),
    ['AbarMove', 'StageRecord'],
    'the movement stage must contain no landing-subtree construction frames'
  );
  assert.deepEqual(
    stageTwoSteps.map((step) => step.replayProgressLabel),
    ['Stage 2/2 · Step 1/2', 'Stage 2/2 · Step 2/2']
  );

  const movementFrame = stageTwoSteps[0];
  assert.equal(movementFrame.replayKind, 'relation');
  assert.deepEqual(movementFrame.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  for (const nodeId of [
    'cp_wh',
    'dp_wh_high',
    'd_wh_high',
    'np_wh_high',
    'n_wh_high',
    'dp_wh_low',
    'd_wh_low',
    'np_wh_low',
    'n_wh_low'
  ]) {
    assert.ok(findNode(movementFrame.replayCanvasData, nodeId), `${nodeId} must appear in the movement moment`);
  }
  assert.equal(findNode(movementFrame.replayCanvasData, 'd_wh_low')?.silent, true);
  assert.equal(findNode(movementFrame.replayCanvasData, 'n_wh_low')?.silent, true);
  assert.deepEqual(
    findNode(movementFrame.replayCanvasData, 'cp_wh')?.children?.map((child) => child.id),
    ['dp_wh_high', 'cbar_wh'],
    'the movement moment must create CP by attaching the landed phrase to C-prime'
  );

  const movementLink = movementFrame.replayRelationLinks?.find((link) => link.relation === 'AbarMove');
  assert.equal(movementLink?.sourceNodeId, 'dp_wh_low');
  assert.equal(movementLink?.targetNodeId, 'dp_wh_high');
  assert.equal(movementLink?.witnessNodeId, 'd_wh_low');
  assert.equal(movementLink?.trajectoryKind, 'phrasal');
});

test('a later movement stage preserves the preceding source subtree until the relation moment', () => {
  const firstTree = node('cbar_remnant', "C'", [
    leaf('c_remnant', 'C', 'did'),
    node('vp_remnant_low', 'VP', [
      leaf('v_remnant_overt', 'V', 'read')
    ], { lineageId: 'remnant-vp' })
  ]);
  const finalTree = node('cp_remnant', 'CP', [
    node('vp_remnant_high', 'VP', [
      leaf('v_remnant_high', 'V', 'read')
    ], { lineageId: 'remnant-vp' }),
    node('cbar_remnant', "C'", [
      leaf('c_remnant', 'C', 'did'),
      node('vp_remnant_low', 'VP', [
        leaf('v_remnant_low', 'V', 'read', { silent: true })
      ], { lineageId: 'remnant-vp', silent: true })
    ])
  ]);
  const stages = [
    {
      statement: 'The complete VP is pronounced in its base position.',
      stageRecord: 'The source VP exists before remnant movement.',
      relations: [],
      workspaceForest: [firstTree]
    },
    {
      statement: 'The complete VP moves to Spec,CP.',
      stageRecord: 'The landed VP and silent lower occurrence appear together.',
      relations: [{
        relation: 'RemnantMovement',
        anchors: {
          lowerCopy: 'vp_remnant_low',
          traceWitness: 'v_remnant_low',
          pronouncedCopy: 'vp_remnant_high'
        }
      }],
      workspaceForest: [finalTree]
    }
  ];
  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'Read did',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const stageTwoSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );
  const relationIndex = stageTwoSteps.findIndex((step) => step.replayKind === 'relation');
  assert.equal(relationIndex, 0, 'the newly created CP landing host belongs to movement');

  for (const step of stageTwoSteps.slice(0, relationIndex)) {
    assert.equal(findNode(step.replayCanvasData, 'v_remnant_overt')?.word, 'read');
    assert.notEqual(findNode(step.replayCanvasData, 'v_remnant_overt')?.silent, true);
    assert.equal(step.replayVisibleNodeIds?.includes('v_remnant_overt'), true);
    assert.equal(step.replayVisibleNodeIds?.includes('vp_remnant_high'), false);
  }

  const movement = stageTwoSteps[relationIndex];
  assert.deepEqual(
    findNode(movement.replayCanvasData, 'cp_remnant')?.children?.map((child) => child.id),
    ['vp_remnant_high', 'cbar_remnant']
  );
  assert.equal(movement.replayVisibleNodeIds?.includes('vp_remnant_high'), true);
  assert.equal(movement.replayVisibleNodeIds?.includes('v_remnant_low'), true);
  assert.equal(findNode(movement.replayCanvasData, 'v_remnant_low')?.silent, true);
});

test('ParasiticGap moves the complete real-gap phrase once at its exact relation moment', () => {
  const finalTree = node('cp_pg_replay', 'CP', [
    node('dp_pg_high', 'DP', [
      leaf('d_pg_high', 'D', 'Which', { lineageId: 'pg-d' }),
      node('np_pg_high', 'NP', [
        leaf('n_pg_high', 'N', 'article', { lineageId: 'pg-n' })
      ], { lineageId: 'pg-np' })
    ], { lineageId: 'pg-dp' }),
    node('cbar_pg_replay', "C'", [
      leaf('c_pg_replay', 'C', 'did'),
      node('tp_pg_replay', 'TP', [
        node('vp_pg_replay', 'VP', [
          leaf('v_pg_replay', 'V', 'file'),
          node('dp_pg_low', 'DP', [
            leaf('d_pg_low', 'D', 't', { lineageId: 'pg-d', silent: true }),
            node('np_pg_low', 'NP', [
              leaf('n_pg_low', 'N', 't', { lineageId: 'pg-n', silent: true })
            ], { lineageId: 'pg-np', silent: true })
          ], { lineageId: 'pg-dp', silent: true }),
          node('pp_pg_replay', 'PP', [
            leaf('p_pg_replay', 'P', 'without'),
            node('dp_pg_parasitic', 'DP', [
              leaf('d_pg_parasitic', 'D', 'pg', { silent: true })
            ], { silent: true })
          ])
        ])
      ])
    ])
  ]);
  const stages = [baseStageBefore([finalTree], {
    landingIds: ['dp_pg_high'],
    pronounce: { dp_pg_low: true, np_pg_low: true, d_pg_low: 'Which', n_pg_low: 'article' }
  }), {
    statement: 'One filler licenses an ordinary and a parasitic gap.',
    stageRecord: 'The ordinary object moves once; the parasitic gap receives no arrow.',
    relations: [{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'dp_pg_high',
        realGap: 'dp_pg_low',
        traceWitness: 'd_pg_low',
        parasiticGap: 'dp_pg_parasitic'
      }
    }],
    workspaceForest: [finalTree]
  }];

  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'Which article did file without',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const relationIndex = steps.findIndex((step) => step.replayKind === 'relation');
  assert.ok(relationIndex > 0);
  const beforeRelation = steps[relationIndex - 1];
  assert.equal(beforeRelation.replayVisibleNodeIds?.includes('dp_pg_high'), false);
  assert.ok(
    findNode(beforeRelation.replayCanvasData, 'cp_pg_replay'),
    'the already-built CP shell remains while its landing specifier is withheld'
  );
  assert.equal(findNode(beforeRelation.replayCanvasData, 'd_pg_low')?.word, 'Which');
  assert.equal(findNode(beforeRelation.replayCanvasData, 'n_pg_low')?.word, 'article');
  assert.deepEqual(beforeRelation.replayRelationLinks || [], []);

  const relationFrame = steps[relationIndex];
  assert.deepEqual(relationFrame.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  assert.ok(findNode(relationFrame.replayCanvasData, 'cp_pg_replay'));
  assert.ok(findNode(relationFrame.replayCanvasData, 'dp_pg_high'));
  assert.equal(findNode(relationFrame.replayCanvasData, 'd_pg_low')?.silent, true);
  assert.equal(findNode(relationFrame.replayCanvasData, 'n_pg_low')?.silent, true);
  const links = relationFrame.replayRelationLinks?.filter((link) => link.relation === 'ParasiticGap') || [];
  assert.equal(links.length, 1);
  assert.equal(links[0].sourceNodeId, 'dp_pg_low');
  assert.equal(links[0].targetNodeId, 'dp_pg_high');
  assert.equal(links[0].witnessNodeId, 'd_pg_low');
  assert.equal(links[0].trajectoryKind, 'phrasal');
  assert.notEqual(links[0].sourceNodeId, 'dp_pg_parasitic');
});

test('Replay keeps gap-only ParasiticGap non-trajectory beside an explicit AbarMove', () => {
  const finalTree = node('cp_pg_gated', 'CP', [
    node('dp_pg_gated_high', 'DP', [
      leaf('d_pg_gated_high', 'D', 'Which', { lineageId: 'pg-gated-d' })
    ], { lineageId: 'pg-gated-dp' }),
    node('cbar_pg_gated', "C'", [
      leaf('c_pg_gated', 'C', 'did'),
      node('vp_pg_gated', 'VP', [
        leaf('v_pg_gated', 'V', 'file'),
        node('dp_pg_gated_low', 'DP', [
          leaf('d_pg_gated_low', 'D', 't', {
            lineageId: 'pg-gated-d',
            silent: true
          })
        ], { lineageId: 'pg-gated-dp', silent: true }),
        node('pp_pg_gated', 'PP', [
          leaf('p_pg_gated', 'P', 'without'),
          node('dp_pg_gated_parasitic', 'DP', [
            leaf('d_pg_gated_parasitic', 'D', 'gap', { silent: true })
          ], { silent: true })
        ])
      ])
    ])
  ]);
  const stages = [{
    statement: 'The filler moves and separately licenses a parasitic gap.',
    stageRecord: 'AbarMove owns the movement; ParasiticGap marks only the parasitic site.',
    relations: [
      {
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'dp_pg_gated_low',
          traceWitness: 'd_pg_gated_low',
          pronouncedCopy: 'dp_pg_gated_high'
        }
      },
      {
        relation: 'ParasiticGap',
        anchors: { parasiticGap: 'dp_pg_gated_parasitic' }
      }
    ],
    workspaceForest: [finalTree]
  }];

  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'Which did file without',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const parasiticFrame = steps.find((step) => (
    step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 0
    && step.replayRelationIdentity?.relationIndex === 1
  ));
  assert.ok(parasiticFrame, 'Replay must preserve the gap-only ParasiticGap relation moment');

  const links = parasiticFrame.replayRelationLinks || [];
  const parasiticLink = links.find((link) => link.authoredRelationKey === '0:1');
  assert.equal(parasiticLink?.relation, 'ParasiticGap');
  assert.equal(parasiticLink?.renderFamily, 'authored-anchor-evidence');
  assert.equal(Object.hasOwn(parasiticLink || {}, 'trajectoryKind'), false);
  assert.deepEqual(
    links
      .filter((link) => link.renderFamily === 'trajectory')
      .map((link) => link.relation),
    ['AbarMove'],
    'only the explicitly authored AbarMove may own the Replay trajectory'
  );
});

test('AcrossTheBoardMovement withholds one shared landing and restores every lower occurrence before movement', () => {
  const source = (suffix) => node(`dp_atb_${suffix}`, 'DP', [
    leaf(`d_atb_${suffix}`, 'D', 'who', {
      silent: true,
      lineageId: 'atb-shared-d'
    })
  ], { silent: true, lineageId: 'atb-shared-dp' });
  const finalTree = node('cp_atb_replay', 'CP', [
    node('dp_atb_high', 'DP', [
      leaf('d_atb_high', 'D', 'Who', { lineageId: 'atb-shared-d' })
    ], { lineageId: 'atb-shared-dp' }),
    node('cbar_atb_replay', "C'", [
      leaf('c_atb_replay', 'C', 'did'),
      node('coordp_atb_replay', 'CoordP', [
        node('vp_atb_left', 'VP', [leaf('v_atb_left', 'V', 'praise'), source('left')]),
        node('vp_atb_right', 'VP', [leaf('v_atb_right', 'V', 'thank'), source('right')])
      ])
    ])
  ]);
  const stages = [baseStageBefore([finalTree], {
    landingIds: ['dp_atb_high'],
    pronounce: { dp_atb_left: true, dp_atb_right: true, d_atb_left: 'Who', d_atb_right: 'Who' }
  }), {
    statement: 'One wh-DP is extracted across both conjuncts.',
    stageRecord: 'Both lower occurrences share one pronounced landing.',
    relations: [{
      relation: 'AcrossTheBoardMovement',
      anchors: {
        sources: ['dp_atb_left', 'dp_atb_right'],
        traceWitnesses: ['d_atb_left', 'd_atb_right'],
        pronouncedCopy: 'dp_atb_high'
      }
    }],
    workspaceForest: [finalTree]
  }];

  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'Who did praise and thank',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const relationIndex = steps.findIndex((step) => step.replayKind === 'relation');
  assert.ok(relationIndex > 0);
  const beforeRelation = steps[relationIndex - 1];
  assert.equal(beforeRelation.replayVisibleNodeIds?.includes('dp_atb_high'), false);
  assert.equal(beforeRelation.replayVisibleNodeIds?.includes('d_atb_high'), false);
  assert.equal(findNode(beforeRelation.replayCanvasData, 'd_atb_left')?.silent, undefined);
  assert.equal(findNode(beforeRelation.replayCanvasData, 'd_atb_right')?.silent, undefined);
  assert.equal(findNode(beforeRelation.replayCanvasData, 'd_atb_left')?.word, 'Who');
  assert.equal(findNode(beforeRelation.replayCanvasData, 'd_atb_right')?.word, 'Who');
  assert.deepEqual(beforeRelation.replayRelationLinks || [], []);
  assert.ok(
    steps.slice(0, relationIndex).every((step) =>
      !['dp_atb_high', 'd_atb_high'].includes(String(step.targetNodeId || ''))),
    'no landing-subtree construction microstep may precede the relation'
  );

  const relationFrame = steps[relationIndex];
  assert.deepEqual(relationFrame.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  assert.ok(findNode(relationFrame.replayCanvasData, 'dp_atb_high'));
  assert.equal(findNode(relationFrame.replayCanvasData, 'd_atb_left')?.silent, true);
  assert.equal(findNode(relationFrame.replayCanvasData, 'd_atb_right')?.silent, true);
  const links = relationFrame.replayRelationLinks
    ?.filter((link) => link.relation === 'AcrossTheBoardMovement') || [];
  assert.ok(links.length >= 1, 'the composite relation is active in its exact Replay moment');
  assert.ok(links.every((link) => link.targetNodeId === 'dp_atb_high'));
});

test('SidewardMovement atomically transfers the complete phrase between workspaces', () => {
  const finalForest = [
    node('vp_sideward_target', 'VP', [
      leaf('v_sideward_target', 'V', 'stood'),
      node('dp_sideward_high', 'DP', [
        leaf('d_sideward_high', 'D', 'a', { lineageId: 'sideward-d' }),
        leaf('n_sideward_high', 'N', 'tamer', { lineageId: 'sideward-n' })
      ], { lineageId: 'sideward-dp' })
    ]),
    node('vp_sideward_source', 'VP', [
      node('dp_sideward_low', 'DP', [
        leaf('d_sideward_low', 'D', 'a', { lineageId: 'sideward-d', silent: true }),
        leaf('n_sideward_low', 'N', 'tamer', { lineageId: 'sideward-n', silent: true })
      ], { lineageId: 'sideward-dp', silent: true }),
      leaf('v_sideward_source', 'V', 'stroked')
    ])
  ];
  const stages = [baseStageBefore(finalForest, {
    landingIds: ['dp_sideward_high'],
    pronounce: { dp_sideward_low: true, d_sideward_low: 'a', n_sideward_low: 'tamer' }
  }), {
    statement: 'The subject moves between workspaces.',
    stageRecord: 'The complete subject leaves one workspace and is remerged in the other.',
    relations: [{
      relation: 'SidewardMovement',
      anchors: {
        lowerCopy: 'dp_sideward_low',
        traceWitness: 'd_sideward_low',
        pronouncedCopy: 'dp_sideward_high'
      }
    }],
    workspaceForest: finalForest
  }];
  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'A tamer stood and stroked',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const relationIndex = steps.findIndex((step) => step.operation === 'SidewardMovement');
  assert.ok(relationIndex > 0);
  const before = steps[relationIndex - 1];
  const movement = steps[relationIndex];
  assert.equal(before.replayVisibleNodeIds?.includes('dp_sideward_high'), false);
  assert.equal(findNode(before.replayCanvasData, 'd_sideward_low')?.word, 'a');
  assert.equal(findNode(before.replayCanvasData, 'n_sideward_low')?.word, 'tamer');
  assert.notEqual(findNode(before.replayCanvasData, 'd_sideward_low')?.silent, true);
  assert.notEqual(findNode(before.replayCanvasData, 'n_sideward_low')?.silent, true);
  assert.ok(findNode(movement.replayCanvasData, 'dp_sideward_high'));
  assert.equal(findNode(movement.replayCanvasData, 'd_sideward_low')?.silent, true);
  assert.equal(findNode(movement.replayCanvasData, 'n_sideward_low')?.silent, true);
  assert.deepEqual(movement.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
});

test('a one-stage OperatorVariableBinding waits for complete syntax and changes no tree material', () => {
  const finalTree = node('cp_operator', 'CP', [
    node('dp_operator_high', 'DP', [
      leaf('d_operator_high', 'D', 'Who', { lineageId: 'operator-d' })
    ], { lineageId: 'operator-dp' }),
    node('cbar_operator', "C'", [
      leaf('c_operator', 'C', 'did'),
      node('tp_operator', 'TP', [
        node('vp_operator', 'VP', [
          leaf('v_operator', 'V', 'leave'),
          node('dp_operator_low', 'DP', [
            leaf('d_operator_low', 'D', 't', {
              lineageId: 'operator-d',
              silent: true
            })
          ], { lineageId: 'operator-dp', silent: true })
        ])
      ])
    ])
  ]);
  const stages = [{
    statement: 'Who binds the lower variable.',
    stageRecord: 'The complete operator-variable dependency is present.',
    relations: [{
      relation: 'OperatorVariableBinding',
      anchors: {
        operator: 'dp_operator_high',
        variable: 'dp_operator_low',
        traceWitness: 'd_operator_low',
        scopeDomain: 'tp_operator'
      }
    }],
    workspaceForest: [finalTree]
  }];

  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    'Who did leave',
    replayPlan
  );
  const relationIndex = steps.findIndex((step) => step.replayKind === 'relation');
  assert.ok(relationIndex > 0);

  const beforeRelation = steps[relationIndex - 1];
  for (const nodeId of [
    'cp_operator',
    'dp_operator_high',
    'd_operator_high',
    'cbar_operator',
    'tp_operator',
    'dp_operator_low',
    'd_operator_low'
  ]) {
    assert.ok(findNode(beforeRelation.replayCanvasData, nodeId), `${nodeId} must exist before the semantic relation`);
    assert.ok(beforeRelation.replayVisibleNodeIds?.includes(nodeId), `${nodeId} must be visible before the semantic relation`);
  }
  assert.equal(findNode(beforeRelation.replayCanvasData, 'd_operator_low')?.word, 't');
  assert.equal(findNode(beforeRelation.replayCanvasData, 'd_operator_low')?.silent, true);

  const relationFrame = steps[relationIndex];
  assert.deepEqual(relationFrame.replayRelationIdentity, { stageIndex: 0, relationIndex: 0 });
  assert.deepEqual(relationFrame.replayCanvasData, beforeRelation.replayCanvasData);
  assert.deepEqual(relationFrame.replayVisibleNodeIds, beforeRelation.replayVisibleNodeIds);
  assert.equal(findNode(relationFrame.replayCanvasData, 'd_operator_low')?.word, 't');
  assert.equal(findNode(relationFrame.replayCanvasData, 'd_operator_low')?.silent, true);
  const semanticLink = relationFrame.replayRelationLinks?.find((link) => link.authoredRelationKey === '0:0');
  assert.equal(semanticLink?.renderFamily, 'operator-variable-binding');
  assert.equal(semanticLink?.trajectoryKind, undefined);
  assert.equal(semanticLink?.sourceNodeId, 'dp_operator_low');
  assert.equal(semanticLink?.targetNodeId, 'dp_operator_high');
  assert.equal(semanticLink?.witnessNodeId, 'd_operator_low');
  assert.deepEqual(
    findNode(relationFrame.replayCanvasData, 'cp_operator')?.children?.map((child) => child.id),
    ['dp_operator_high', 'cbar_operator']
  );

  const macroFrame = steps.at(-1);
  assert.equal(macroFrame?.replayKind, 'macro');
  assert.ok(findNode(macroFrame?.replayCanvasData, 'cp_operator'));
  assert.ok(findNode(macroFrame?.replayCanvasData, 'dp_operator_high'));
});

test('head movement starts with the auxiliary in T and creates its C occurrence and trace together', () => {
  const baseTree = node('cp_head', 'CP', [
    leaf('c_head', 'C', '∅', { silent: true }),
    node('tp_head', 'TP', [
      node('dp_noa', 'DP', [leaf('n_noa', 'N', 'Noa')]),
      node('tbar_head', "T'", [
        leaf('t_did', 'T', 'Did', { lineageId: 'did-chain' }),
        node('vp_leave', 'VP', [leaf('v_leave', 'V', 'leave')])
      ])
    ])
  ]);
  const finalTree = clone(baseTree);
  findNode(finalTree, 'c_head').word = 'Did';
  findNode(finalTree, 'c_head').lineageId = 'did-chain';
  delete findNode(finalTree, 'c_head').silent;
  findNode(finalTree, 't_did').word = 't';
  findNode(finalTree, 't_did').silent = true;

  const stages = [
    {
      statement: 'The complete clause is assembled with the auxiliary in T and an empty C.',
      stageRecord: 'Did is pronounced in its base T position before head movement.',
      relations: [],
      workspaceForest: [baseTree]
    },
    {
      statement: 'Did moves from T to C.',
      stageRecord: 'Head movement realizes Did in C and leaves a silent T-head trace.',
      relations: [{
        relation: 'HeadMove',
        anchors: { source: 't_did', target: 'c_head' }
      }],
      workspaceForest: [finalTree]
    }
  ];

  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    'Did Noa leave',
    replayPlan
  );
  const stageOneSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 1/2')
  );
  const stageTwoSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );

  for (const step of stageOneSteps) {
    assert.deepEqual(step.replayRelationLinks || [], []);
    assert.equal(findNode(step.replayCanvasData, 't_did')?.word, 'Did');
    assert.notEqual(findNode(step.replayCanvasData, 't_did')?.silent, true);
    assert.equal(findNode(step.replayCanvasData, 'c_head')?.word, '∅');
  }
  assert.deepEqual(stageTwoSteps.map((step) => step.operation), ['HeadMove', 'StageRecord']);
  assert.deepEqual(
    stageTwoSteps.map((step) => step.replayProgressLabel),
    ['Stage 2/2 · Step 1/2', 'Stage 2/2 · Step 2/2']
  );

  const movementFrame = stageTwoSteps[0];
  assert.equal(movementFrame.replayKind, 'relation');
  assert.deepEqual(movementFrame.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  assert.equal(findNode(movementFrame.replayCanvasData, 'c_head')?.word, 'Did');
  assert.notEqual(findNode(movementFrame.replayCanvasData, 'c_head')?.silent, true);
  assert.equal(findNode(movementFrame.replayCanvasData, 't_did')?.word, 't');
  assert.equal(findNode(movementFrame.replayCanvasData, 't_did')?.silent, true);
  const movementLink = movementFrame.replayRelationLinks?.find((link) => link.relation === 'HeadMove');
  assert.equal(movementLink?.sourceNodeId, 't_did');
  assert.equal(movementLink?.targetNodeId, 'c_head');
  assert.equal(movementLink?.trajectoryKind, 'head');
});

test('ordered phrase and head movements do not leak the later head trace into earlier moments', () => {
  const finalTree = node('cp_ordered', 'CP', [
    node('dp_what_high', 'DP', [
      leaf('d_what_high', 'D', 'What', { lineageId: 'what-terminal', tokenIndex: 0 })
    ], { lineageId: 'what-chain' }),
    node('cbar_ordered', "C'", [
      node('c_ordered', 'C', [
        leaf('did_high', 'did', 'did', { lineageId: 'did-terminal', tokenIndex: 1 })
      ], { lineageId: 'did-chain' }),
      node('tp_ordered', 'TP', [
        node('dp_mia', 'DP', [leaf('d_mia', 'D', 'Mia')]),
        node('tbar_ordered', "T'", [
          node('t_did', 'T', [
            leaf('did_low', 'did', undefined, {
              lineageId: 'did-terminal',
              silent: true
            })
          ], { lineageId: 'did-chain', silent: true }),
          node('vp_see', 'VP', [
            leaf('v_see', 'V', 'see'),
            node('dp_what_low', 'DP', [
              leaf('d_what_low', 'D', undefined, {
                lineageId: 'what-terminal',
                silent: true
              })
            ], { lineageId: 'what-chain', silent: true })
          ])
        ])
      ])
    ])
  ]);
  const stages = [baseStageBefore([finalTree], {
    landingIds: ['dp_what_high', 'did_high'],
    pronounce: { dp_what_low: true, d_what_low: 'what', t_did: true, did_low: 'did' }
  }), {
    statement: 'The complete question is derived.',
    stageRecord: 'The object moves before the auxiliary moves.',
    relations: [
      {
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'dp_what_low',
          traceWitness: 'd_what_low',
          pronouncedCopy: 'dp_what_high'
        }
      },
      {
        relation: 'HeadMove',
        anchors: { source: 't_did', target: 'c_ordered' }
      }
    ],
    workspaceForest: [finalTree]
  }];

  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    'What did Mia see',
    replayPlan
  );
  const phraseMoveIndex = steps.findIndex((step) => step.operation === 'AbarMove');
  const headMoveIndex = steps.findIndex((step) => step.operation === 'HeadMove');
  assert.ok(phraseMoveIndex > 0);
  assert.equal(headMoveIndex, phraseMoveIndex + 1);

  for (const step of steps.slice(0, phraseMoveIndex).filter((step) => step.replayFrameIndex === 1)) {
    assert.notEqual(findNode(step.replayCanvasData, 'did_high')?.replayLayoutOnly, false);
    assert.equal(step.replayVisibleNodeIds?.includes('dp_what_high'), false);
    assert.equal(step.replayVisibleNodeIds?.includes('did_high'), false);
    assert.equal(
      findNode(step.replayCanvasData, 'd_what_low')?.word
        || findNode(step.replayCanvasData, 'd_what_low')?.label,
      'what'
    );
    assert.notEqual(findNode(step.replayCanvasData, 'd_what_low')?.silent, true);
    assert.equal(
      findNode(step.replayCanvasData, 'did_low')?.word
        || findNode(step.replayCanvasData, 'did_low')?.label,
      'did'
    );
    assert.notEqual(findNode(step.replayCanvasData, 'did_low')?.silent, true);
  }

  const phraseMove = steps[phraseMoveIndex];
  assert.ok(findNode(phraseMove.replayCanvasData, 'dp_what_high'));
  assert.equal(findNode(phraseMove.replayCanvasData, 'd_what_low')?.silent, true);
  assert.equal(findNode(phraseMove.replayCanvasData, 'did_high'), null);
  assert.equal(
    findNode(phraseMove.replayCanvasData, 'did_low')?.word
      || findNode(phraseMove.replayCanvasData, 'did_low')?.label,
    'did'
  );
  assert.notEqual(findNode(phraseMove.replayCanvasData, 'did_low')?.silent, true);

  const headMove = steps[headMoveIndex];
  assert.ok(findNode(headMove.replayCanvasData, 'dp_what_high'));
  assert.equal(
    findNode(headMove.replayCanvasData, 'c_ordered')?.children?.[0]?.word
      || findNode(headMove.replayCanvasData, 'c_ordered')?.children?.[0]?.label,
    'did'
  );
  assert.equal(findNode(headMove.replayCanvasData, 'did_low')?.silent, true);
});

test('a non-movement relation waits for its exact new anchor and never reveals syntax', () => {
  const firstCycleTree = node('vp_cyclic', 'vP', [
    leaf('v_probe', 'v', '[uφ]', { silent: true }),
    node('vp_domain', 'VP', [
      leaf('v_saw', 'V', 'saw'),
      node('dp_internal', 'DP', [leaf('d_noa', 'D', 'Noa')])
    ])
  ]);
  const secondCycleTree = node('vp_cyclic', 'vP', [
    node('dp_external', 'DP', [leaf('d_mia', 'D', 'Mia')]),
    node('vbar_cyclic', "v'", [
      leaf('v_probe', 'v', '[uφ]', { silent: true }),
      node('vp_domain', 'VP', [
        leaf('v_saw', 'V', 'saw'),
        node('dp_internal', 'DP', [leaf('d_noa', 'D', 'Noa')])
      ])
    ])
  ]);
  const stages = [
    {
      statement: 'The first Agree cycle searches the probe complement.',
      stageRecord: 'Cycle 1 reaches the internal DP before the external argument exists.',
      relations: [{ relation: 'CyclicAgree', anchors: { probe: 'v_probe', goal: 'dp_internal' } }],
      workspaceForest: [firstCycleTree]
    },
    {
      statement: 'The external argument is merged for cycle 2.',
      stageRecord: 'Cycle 2 reaches the newly available external DP.',
      relations: [{ relation: 'CyclicAgree', anchors: { probe: 'v_probe', goal: 'dp_external' } }],
      workspaceForest: [secondCycleTree]
    }
  ];

  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(frames, 'Mia saw Noa', replayPlan);
  const stageTwoSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );
  const relationStepIndex = stageTwoSteps.findIndex((step) => step.replayKind === 'relation');
  assert.ok(relationStepIndex > 0, 'cycle 2 must follow a structural frame containing its new goal');

  const beforeRelation = stageTwoSteps[relationStepIndex - 1];
  const relationStep = stageTwoSteps[relationStepIndex];
  assert.deepEqual(relationStep.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  assert.ok(findNode(beforeRelation.replayCanvasData, 'dp_external'));
  assert.ok(findNode(beforeRelation.replayCanvasData, 'd_mia'));
  assert.deepEqual(
    new Set(relationStep.replayVisibleNodeIds),
    new Set(beforeRelation.replayVisibleNodeIds),
    'a non-movement relation moment must not change which syntax is visible'
  );
  assert.deepEqual(
    relationStep.replayCanvasData,
    beforeRelation.replayCanvasData,
    'the relation frame must reuse the complete preceding structural state'
  );
});

test('a later PF relation owns the tree change at its exact authored moment', () => {
  const priorTree = node('tp_pf_order', 'TP', [
    node('dp_mia_pf_order', 'DP', [leaf('d_mia_pf_order', 'D', 'Mia')]),
    node('vp_pf_order', 'VP', [leaf('v_go_pf_order', 'V', '√GO')])
  ]);
  const currentTree = node('tp_pf_order', 'TP', [
    node('dp_mia_pf_order', 'DP', [leaf('d_mia_pf_order', 'D', 'Mia')]),
    node('vp_pf_order', 'VP', [leaf('v_go_pf_order', 'V', 'went')])
  ]);
  const stages = [
    {
      statement: 'The abstract root is present.',
      stageRecord: 'The root has not been pronounced.',
      relations: [],
      workspaceForest: [priorTree]
    },
    {
      statement: 'Vocabulary insertion realizes the root.',
      stageRecord: 'The root is pronounced as went.',
      relations: [
        {
          relation: 'Coreference',
          anchors: { antecedent: 'dp_mia_pf_order', pronoun: 'dp_mia_pf_order' }
        },
        {
          relation: 'VocabularyInsertion',
          anchors: { terminal: 'v_go_pf_order' },
          values: { input: '√GO', output: 'went' }
        }
      ],
      workspaceForest: [currentTree]
    }
  ];

  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'Mia went',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const firstRelation = steps.find((step) => (
    step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity?.relationIndex === 0
  ));
  const vocabularyInsertion = steps.find((step) => (
    step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity?.relationIndex === 1
  ));

  assert.ok(firstRelation);
  assert.ok(vocabularyInsertion);
  assert.equal(findNode(firstRelation.replayCanvasData, 'v_go_pf_order')?.word, '√GO');
  assert.equal(findNode(vocabularyInsertion.replayCanvasData, 'v_go_pf_order')?.word, 'went');
  assert.equal(
    steps.some((step) => (
      step.replayKind === 'micro'
      && String(step.replayProgressLabel || '').startsWith('Stage 2/2')
    )),
    false,
    'no structural frame may reveal the realized exponent before VocabularyInsertion'
  );
});

test('a persistent projected ancestor never reveals later descendants ahead of their microsteps', () => {
  const firstCycleTree = node('cp_embedded_cycle', 'CP', [
    leaf('c_that_cycle', 'C', 'that'),
    node('vbar_embedded_cycle', "v'", [
      leaf('v_probe_embedded_cycle', 'v', '[uφ]', { silent: true }),
      node('vp_embedded_cycle', 'VP', [
        leaf('v_saw_embedded_cycle', 'V', 'saw'),
        node('dp_internal_embedded_cycle', 'DP', [leaf('d_noa_embedded_cycle', 'D', 'Noa')])
      ])
    ])
  ]);
  const secondCycleTree = node('cp_embedded_cycle', 'CP', [
    leaf('c_that_cycle', 'C', 'that'),
    node('vp_external_embedded_cycle', 'vP', [
      node('dp_external_embedded_cycle', 'DP', [leaf('d_mia_embedded_cycle', 'D', 'Mia')]),
      node('vbar_embedded_cycle', "v'", [
        leaf('v_probe_embedded_cycle', 'v', '[uφ]', { silent: true }),
        node('vp_embedded_cycle', 'VP', [
          leaf('v_saw_embedded_cycle', 'V', 'saw'),
          node('dp_internal_embedded_cycle', 'DP', [leaf('d_noa_embedded_cycle', 'D', 'Noa')])
        ])
      ])
    ])
  ]);
  const stages = [
    {
      statement: 'The embedded probe searches its complement.',
      stageRecord: 'Cycle 1 reaches the internal DP.',
      relations: [{ relation: 'CyclicAgree', anchors: { probe: 'v_probe_embedded_cycle', goal: 'dp_internal_embedded_cycle' } }],
      workspaceForest: [firstCycleTree]
    },
    {
      statement: 'The external argument is merged.',
      stageRecord: 'Cycle 2 reaches the new external DP.',
      relations: [{ relation: 'CyclicAgree', anchors: { probe: 'v_probe_embedded_cycle', goal: 'dp_external_embedded_cycle' } }],
      workspaceForest: [secondCycleTree]
    }
  ];

  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'that Mia saw Noa',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const stageTwoSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );
  assert.deepEqual(
    stageTwoSteps.map((step) => [step.replayKind, step.operation, step.targetNodeId]),
    [
      ['micro', 'LexicalSelect', 'd_mia_embedded_cycle::__leaf'],
      ['micro', 'Project', 'd_mia_embedded_cycle'],
      ['micro', 'Project', 'dp_external_embedded_cycle'],
      ['micro', 'ExternalMerge', 'vp_external_embedded_cycle'],
      ['relation', 'CyclicAgree', 'v_probe_embedded_cycle'],
      ['macro', 'StageRecord', 'cp_embedded_cycle']
    ]
  );

  const lexicalStep = stageTwoSteps[0];
  const dProjectionStep = stageTwoSteps[1];
  const dpProjectionStep = stageTwoSteps[2];
  assert.equal(
    new Set(lexicalStep.replayVisibleNodeIds).has('dp_external_embedded_cycle'),
    false,
    'selecting Mia must not reveal its DP shell'
  );
  assert.equal(
    new Set(dProjectionStep.replayVisibleNodeIds).has('vp_external_embedded_cycle'),
    false,
    'projecting D must not reveal the later vP host'
  );
  assert.equal(
    new Set(dpProjectionStep.replayVisibleNodeIds).has('vp_external_embedded_cycle'),
    false,
    'projecting DP must not perform the later external merge'
  );
});

test('A-movement folds a complete phrasal landing before a following identity moment', () => {
  const lowerObject = node('dp_book_low', 'DP', [
    leaf('d_book_low', 'D', 'The', { lineageId: 'book-d' }),
    node('np_book_low', 'NP', [
      leaf('n_book_low', 'N', 'book', { lineageId: 'book-n' })
    ], { lineageId: 'book-np' })
  ], { lineageId: 'book-dp' });
  const baseTBar = node('tbar_passive', "T'", [
    leaf('t_was', 'T', 'was'),
    node('vp_passive', 'VP', [leaf('v_read', 'V', 'read'), lowerObject])
  ]);
  const baseTree = node('tp_passive', 'TP', [baseTBar]);

  const finalLowerObject = clone(lowerObject);
  findNode(finalLowerObject, 'd_book_low').word = 't';
  findNode(finalLowerObject, 'd_book_low').silent = true;
  findNode(finalLowerObject, 'n_book_low').word = 't';
  findNode(finalLowerObject, 'n_book_low').silent = true;
  const finalTBar = clone(baseTBar);
  findNode(finalTBar, 'vp_passive').children[1] = finalLowerObject;
  const highObject = node('dp_book_high', 'DP', [
    leaf('d_book_high', 'D', 'The', { lineageId: 'book-d' }),
    node('np_book_high', 'NP', [
      leaf('n_book_high', 'N', 'book', { lineageId: 'book-n' })
    ], { lineageId: 'book-np' })
  ], { lineageId: 'book-dp' });
  const finalTree = node('tp_passive', 'TP', [highObject, finalTBar]);

  const stages = [
    {
      statement: 'The passive predicate contains the object in its base position.',
      stageRecord: 'The book is overt inside VP before A-movement.',
      relations: [],
      workspaceForest: [baseTree]
    },
    {
      statement: 'The object raises to subject position.',
      stageRecord: 'A-movement creates the complete higher occurrence; Identity then inspects the chain.',
      relations: [
        {
          relation: 'AMove',
          anchors: {
            lowerCopy: 'dp_book_low',
            traceWitness: 'd_book_low',
            pronouncedCopy: 'dp_book_high'
          }
        },
        {
          relation: 'Identity',
          anchors: {
            pronouncedCopy: 'dp_book_high',
            lowerCopy: 'dp_book_low'
          }
        }
      ],
      workspaceForest: [finalTree]
    }
  ];

  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    'The book was read',
    replayPlan
  );
  const casedSteps = applyPreFrontingSentenceInitialCasing(steps, 'The book was read');
  const baseStageSteps = casedSteps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 1/2')
  );
  assert.equal(
    baseStageSteps.find((step) => step.targetNodeId === 'd_book_low::__leaf')?.targetLabel,
    'the',
    'a determiner in the base object position must not inherit sentence-initial capitalization'
  );
  assert.equal(
    findNode(baseStageSteps.at(-1)?.replayCanvasData, 'd_book_low::__leaf')?.word,
    'the'
  );
  const stageTwoSteps = steps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );

  assert.deepEqual(
    stageTwoSteps.map((step) => step.operation),
    ['AMove', 'Identity', 'StageRecord'],
    'the complete landing must not be constructed in separate microsteps'
  );
  assert.deepEqual(
    stageTwoSteps.slice(0, 2).map((step) => step.replayRelationIdentity),
    [
      { stageIndex: 1, relationIndex: 0 },
      { stageIndex: 1, relationIndex: 1 }
    ]
  );
  const movementFrame = stageTwoSteps[0];
  for (const nodeId of [
    'tp_passive',
    'dp_book_high',
    'd_book_high',
    'np_book_high',
    'n_book_high',
    'dp_book_low',
    'd_book_low',
    'np_book_low',
    'n_book_low'
  ]) {
    assert.ok(findNode(movementFrame.replayCanvasData, nodeId), `${nodeId} must appear in the A-movement moment`);
  }
  assert.equal(findNode(movementFrame.replayCanvasData, 'd_book_low')?.silent, true);
  assert.equal(findNode(movementFrame.replayCanvasData, 'n_book_low')?.silent, true);
});

test('AMove builds the chain before AntiLocality judges it without changing syntax', () => {
  const baseTree = node('vp_single_stage', 'vP', [
    node('vbar_single', "v'", [
      leaf('v_single', 'V', 'arrived', { tokenIndex: 2 }),
      node('dp_single_low', 'DP', [
        leaf('d_single_low_surface', 'D', 'A', {
          lineageId: 'single-d',
          tokenIndex: 0
        }),
        node('np_single_low', 'NP', [
          leaf('n_single_low_surface', 'N', 'package', {
            lineageId: 'single-n',
            tokenIndex: 1
          })
        ], { lineageId: 'single-np' })
      ], { lineageId: 'single-dp' })
    ])
  ]);
  const finalTree = node('vp_single_stage', 'vP', [
    node('dp_single_high', 'DP', [
      leaf('d_single_high', 'D', 'A', { lineageId: 'single-d', tokenIndex: 0 }),
      node('np_single_high', 'NP', [
        leaf('n_single_high', 'N', 'package', { lineageId: 'single-n' })
      ], { lineageId: 'single-np' })
    ], { lineageId: 'single-dp' }),
    node('vbar_single', "v'", [
      leaf('v_single', 'V', 'arrived', { tokenIndex: 2 }),
      node('dp_single_low', 'DP', [
        node('d_single_low', 'D', [
          leaf('d_single_low_surface', 'a', undefined, {
            silent: true,
            lineageId: 'single-d'
          })
        ], { silent: true, lineageId: 'single-d' }),
        node('np_single_low', 'NP', [
          node('n_single_low', 'N', [
            leaf('n_single_low_surface', 'package', undefined, {
              silent: true,
              lineageId: 'single-n'
            })
          ], { silent: true, lineageId: 'single-n' })
        ], { silent: true })
      ], { silent: true, lineageId: 'single-dp' })
    ])
  ]);
  const stages = [
    {
      statement: 'The package is merged as the internal argument.',
      stageRecord: 'The complete lower DP is present before movement.',
      relations: [],
      workspaceForest: [baseTree]
    },
    {
      statement: 'The package moves to Spec,vP.',
      stageRecord: 'AMove creates the higher occurrence and silent lower copy.',
      relations: [{
        relation: 'AMove',
        anchors: {
          lowerCopy: 'dp_single_low',
          traceWitness: 'n_single_low',
          pronouncedCopy: 'dp_single_high'
        }
      }],
      workspaceForest: [finalTree]
    },
    {
      statement: 'The completed movement is too short.',
      stageRecord: 'AntiLocality judges the existing chain and introduces no syntax.',
      relations: [{
        relation: 'AntiLocality',
        anchors: {
          source: 'dp_single_low',
          traceWitness: 'n_single_low',
          landing: 'dp_single_high'
        },
        values: { outcome: 'blocked' }
      }],
      workspaceForest: [finalTree]
    }
  ];

  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    'A package arrived',
    replayPlan
  );
  const movementIndex = steps.findIndex((step) => step.operation === 'AMove');
  const judgmentIndex = steps.findIndex((step) => step.operation === 'AntiLocality');
  assert.ok(movementIndex > 0);
  assert.ok(judgmentIndex > movementIndex);
  const beforeMovement = steps[movementIndex - 1];
  const movement = steps[movementIndex];

  assert.equal(findNode(beforeMovement.replayCanvasData, 'd_single_low_surface')?.word, 'A');
  assert.equal(findNode(beforeMovement.replayCanvasData, 'n_single_low_surface')?.word, 'package');
  assert.notEqual(findNode(beforeMovement.replayCanvasData, 'd_single_low_surface')?.silent, true);
  assert.notEqual(findNode(beforeMovement.replayCanvasData, 'n_single_low_surface')?.silent, true);
  assert.notEqual(findNode(beforeMovement.replayCanvasData, 'np_single_low')?.silent, true);
  const pendingLanding = findNode(beforeMovement.replayCanvasData, 'dp_single_high');
  assert.ok(!pendingLanding || pendingLanding.replayLayoutOnly === true);
  assert.equal(beforeMovement.replayVisibleNodeIds?.includes('dp_single_high'), false);
  assert.deepEqual(beforeMovement.replayRelationLinks || [], []);

  assert.ok(findNode(movement.replayCanvasData, 'dp_single_high'));
  assert.equal(findNode(movement.replayCanvasData, 'd_single_high')?.word, 'A');
  assert.equal(findNode(movement.replayCanvasData, 'd_single_low_surface')?.silent, true);
  assert.equal(findNode(movement.replayCanvasData, 'n_single_low_surface')?.silent, true);
  assert.deepEqual(movement.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  assert.deepEqual(steps[judgmentIndex].replayCanvasData, movement.replayCanvasData);
  assert.deepEqual(steps[judgmentIndex].replayRelationIdentity, { stageIndex: 2, relationIndex: 0 });
});

test('AbarMove builds the chain before Intervention judges it without changing syntax', () => {
  const finalTree = node('cp_intervention', 'CP', [
    node('dp_what_high', 'DP', [
      leaf('d_what_high', 'D', 'What', { lineageId: 'what-d', tokenIndex: 0 })
    ], { lineageId: 'what-dp' }),
    node('cbar_intervention', "C'", [
      leaf('c_do', 'C', 'do'),
      node('tp_intervention', 'TP', [
        node('dp_intervener', 'DP', [leaf('d_intervener', 'D', 'which student')]),
        node('vp_intervention', 'VP', [
          leaf('v_bought', 'V', 'bought'),
          node('dp_what_low', 'DP', [
            leaf('d_what_low', 'D', 'What', { lineageId: 'what-d', silent: true })
          ], { lineageId: 'what-dp' })
        ])
      ])
    ])
  ]);
  const stages = [
    baseStageBefore([finalTree], { landingIds: ['dp_what_high'], pronounce: { d_what_low: 'what' } }),
    {
      statement: 'The object wh-DP moves to the matrix edge.',
      stageRecord: 'AbarMove builds the chain required by the deviant input.',
      relations: [{
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'dp_what_low',
          traceWitness: 'd_what_low',
          pronouncedCopy: 'dp_what_high'
        }
      }],
      workspaceForest: [finalTree]
    },
    {
      statement: 'The closer wh subject blocks the completed object dependency.',
      stageRecord: 'Intervention judges the existing chain and adds no syntax.',
      relations: [{
        relation: 'Intervention',
        anchors: {
          target: 'dp_what_low',
          landing: 'dp_what_high',
          intervener: 'dp_intervener'
        },
        values: { outcome: 'blocked' }
      }],
      workspaceForest: [finalTree]
    }
  ];
  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'What do which student bought',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const movementIndex = steps.findIndex((step) => step.operation === 'AbarMove');
  const interventionIndex = steps.findIndex((step) => step.operation === 'Intervention');
  assert.ok(movementIndex > 0);
  assert.ok(interventionIndex > movementIndex);

  const before = steps[movementIndex - 1];
  assert.equal(before.replayVisibleNodeIds?.includes('dp_what_high'), false);
  assert.equal(findNode(before.replayCanvasData, 'd_what_low')?.word, 'what');
  assert.notEqual(findNode(before.replayCanvasData, 'd_what_low')?.silent, true);

  const movement = steps[movementIndex];
  assert.deepEqual(movement.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  assert.ok(findNode(movement.replayCanvasData, 'dp_what_high'));
  assert.equal(findNode(movement.replayCanvasData, 'd_what_low')?.silent, true);

  const beforeIntervention = steps[interventionIndex - 1];
  const intervention = steps[interventionIndex];
  assert.deepEqual(intervention.replayRelationIdentity, { stageIndex: 2, relationIndex: 0 });
  assert.deepEqual(
    [...(intervention.replayVisibleNodeIds || [])].sort(),
    [...(beforeIntervention.replayVisibleNodeIds || [])].sort()
  );
  assert.deepEqual(intervention.replayCanvasData, beforeIntervention.replayCanvasData);
  assert.equal(
    intervention.replayRelationLinks?.filter((link) => link.relation === 'Intervention').length,
    1
  );
  assert.equal(
    intervention.replayRelationLinks?.some((link) => link.relation === 'AbarMove'),
    true
  );
});

test('AbarMove builds the copy chain before LF Reconstruction selects its interpreted occurrence', () => {
  const baseTree = node('cbar_lf_reconstruction', "C'", [
    leaf('c_did_lf_reconstruction', 'C', 'did'),
    node('vp_lf_reconstruction', 'VP', [
      leaf('v_file_lf_reconstruction', 'V', 'file'),
      node('dp_low_lf_reconstruction', 'DP', [
        leaf('d_low_lf_reconstruction', 'D', 'Which', {
          lineageId: 'lf-reconstruction-d',
          tokenIndex: 0
        })
      ], { lineageId: 'lf-reconstruction-dp' })
    ])
  ]);
  const finalTree = node('cp_lf_reconstruction', 'CP', [
    node('dp_high_lf_reconstruction', 'DP', [
      leaf('d_high_lf_reconstruction', 'D', 'Which', {
        lineageId: 'lf-reconstruction-d',
        tokenIndex: 0
      })
    ], { lineageId: 'lf-reconstruction-dp' }),
    node('cbar_lf_reconstruction', "C'", [
      leaf('c_did_lf_reconstruction', 'C', 'did'),
      node('vp_lf_reconstruction', 'VP', [
        leaf('v_file_lf_reconstruction', 'V', 'file'),
        node('dp_low_lf_reconstruction', 'DP', [
          leaf('d_low_lf_reconstruction', 'D', 'which', {
            lineageId: 'lf-reconstruction-d',
            silent: true
          })
        ], { lineageId: 'lf-reconstruction-dp', silent: true })
      ])
    ])
  ]);
  const stages = [
    {
      statement: 'The wh-DP is merged in object position.',
      stageRecord: 'The complete DP is pronounced only in its base position.',
      relations: [],
      workspaceForest: [baseTree]
    },
    {
      statement: 'The wh-DP moves to Spec,CP.',
      stageRecord: 'AbarMove creates the higher and lower occurrences.',
      relations: [{
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'dp_low_lf_reconstruction',
          traceWitness: 'd_low_lf_reconstruction',
          pronouncedCopy: 'dp_high_lf_reconstruction'
        }
      }],
      workspaceForest: [finalTree]
    },
    {
      statement: 'The lower copy is interpreted at LF.',
      stageRecord: 'LF Reconstruction selects between the existing copies.',
      relations: [{
        relation: 'LFReconstruction',
        anchors: {
          neglectedCopy: 'dp_high_lf_reconstruction',
          interpretedCopy: 'dp_low_lf_reconstruction'
        }
      }],
      workspaceForest: [finalTree]
    }
  ];
  const steps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(stages),
    'Which did file',
    buildDerivationReplayPlan({ derivationStages: stages })
  );
  const movementIndex = steps.findIndex((step) => step.operation === 'AbarMove');
  const reconstructionIndex = steps.findIndex((step) => step.operation === 'LFReconstruction');

  assert.ok(movementIndex > 0);
  assert.ok(reconstructionIndex > movementIndex);
  const beforeMovement = steps[movementIndex - 1];
  assert.equal(beforeMovement.replayVisibleNodeIds?.includes('dp_high_lf_reconstruction'), false);
  assert.notEqual(findNode(beforeMovement.replayCanvasData, 'd_low_lf_reconstruction')?.silent, true);

  const movement = steps[movementIndex];
  assert.deepEqual(movement.replayRelationIdentity, { stageIndex: 1, relationIndex: 0 });
  assert.equal(movement.replayVisibleNodeIds?.includes('dp_high_lf_reconstruction'), true);
  assert.equal(findNode(movement.replayCanvasData, 'd_low_lf_reconstruction')?.silent, true);

  const beforeReconstruction = steps[reconstructionIndex - 1];
  const reconstruction = steps[reconstructionIndex];
  assert.deepEqual(reconstruction.replayRelationIdentity, { stageIndex: 2, relationIndex: 0 });
  assert.deepEqual(reconstruction.replayCanvasData, beforeReconstruction.replayCanvasData);
  assert.deepEqual(
    [...(reconstruction.replayVisibleNodeIds || [])].sort(),
    [...(beforeReconstruction.replayVisibleNodeIds || [])].sort()
  );
  assert.equal(
    reconstruction.replayRelationLinks?.some((link) => link.relation === 'AbarMove'),
    true
  );
});

test('repeated lexical surfaces keep distinct selection microsteps by node identity', () => {
  const repeatedTree = node('coord_repeat', 'CoordP', [
    node('left_repeat', 'DP', [leaf('left_repeat_d', 'D', 'the')]),
    node('right_repeat', 'DP', [leaf('right_repeat_d', 'D', 'the')])
  ]);
  const stages = [{
    statement: 'Build both repeated determiners.',
    stageRecord: 'Both occurrences are independently selected and projected.',
    relations: [],
    workspaceForest: [repeatedTree]
  }];
  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(frames, 'the the', replayPlan);
  const selectedTargets = steps
    .filter((step) => step.replayKind === 'micro' && step.operation === 'LexicalSelect')
    .map((step) => step.targetNodeId);
  assert.ok(selectedTargets.some((nodeId) => String(nodeId).includes('left_repeat_d')));
  assert.ok(selectedTargets.some((nodeId) => String(nodeId).includes('right_repeat_d')));
  assert.equal(new Set(selectedTargets).size, selectedTargets.length,
    'one existing surface must not erase another occurrence\'s lexical selection');
});

test('relation-owned PF and Fission outputs appear in their relation frames, never lexical microsteps', () => {
  const pfInput = node('tp_pf_transition', 'TP', [
    leaf('root_pf_transition', 'Root', '√GO')
  ]);
  const pfOutput = node('tp_pf_transition', 'TP', [
    leaf('root_pf_transition', 'Root', 'went')
  ]);
  const pfStages = [
    {
      statement: 'Build the abstract PF input.',
      stageRecord: 'The root is abstract.',
      relations: [],
      workspaceForest: [pfInput]
    },
    {
      statement: 'Realize the root.',
      stageRecord: 'PF realizes the root as went.',
      relations: [{
        relation: 'PFRealization',
        anchors: { root: 'root_pf_transition', exponent: 'root_pf_transition' }
      }],
      workspaceForest: [pfOutput]
    }
  ];
  const pfSteps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(pfStages),
    'went',
    buildDerivationReplayPlan({ derivationStages: pfStages })
  );
  const pfStageTwo = pfSteps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );
  assert.deepEqual(pfStageTwo.map((step) => step.operation), ['PFRealization', 'StageRecord']);
  const beforePf = pfSteps[pfSteps.indexOf(pfStageTwo[0]) - 1];
  assert.equal(findNode(beforePf.replayCanvasData, 'root_pf_transition')?.word, '√GO');
  assert.equal(findNode(pfStageTwo[0].replayCanvasData, 'root_pf_transition')?.word, 'went');

  const fissionInput = node('auxp_fission_transition', 'AuxP', [
    leaf('clitic_fission_transition_input', 'Clitic', '[2PL]')
  ]);
  const fissionOutput = node('auxp_fission_transition', 'AuxP', [
    leaf('clitic_fission_transition_person', 'Clitic', '-su'),
    leaf('clitic_fission_transition_plural', 'Num', '-e')
  ]);
  const fissionStages = [
    {
      statement: 'Build one clitic terminal.',
      stageRecord: 'One terminal bears the complete bundle.',
      relations: [],
      workspaceForest: [fissionInput]
    },
    {
      statement: 'Split the terminal.',
      stageRecord: 'Fission creates two outputs.',
      relations: [{
        relation: 'Fission',
        anchors: { outputs: ['clitic_fission_transition_person', 'clitic_fission_transition_plural'] },
        priorAnchors: { input: 'clitic_fission_transition_input' }
      }],
      workspaceForest: [fissionOutput]
    }
  ];
  const fissionSteps = buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(fissionStages),
    '-su -e',
    buildDerivationReplayPlan({ derivationStages: fissionStages })
  );
  const fissionStageTwo = fissionSteps.filter((step) =>
    String(step.replayProgressLabel || '').startsWith('Stage 2/2')
  );
  assert.deepEqual(fissionStageTwo.map((step) => step.operation), ['Fission', 'StageRecord']);
  const beforeFission = fissionSteps[fissionSteps.indexOf(fissionStageTwo[0]) - 1];
  assert.ok(findNode(beforeFission.replayCanvasData, 'clitic_fission_transition_input'));
  assert.equal(findNode(beforeFission.replayCanvasData, 'clitic_fission_transition_person'), null);
  assert.equal(findNode(fissionStageTwo[0].replayCanvasData, 'clitic_fission_transition_input'), null);
  assert.ok(findNode(fissionStageTwo[0].replayCanvasData, 'clitic_fission_transition_person'));
  assert.ok(findNode(fissionStageTwo[0].replayCanvasData, 'clitic_fission_transition_plural'));
});

test('head movement owns the new path back to its source workspace, not an unrelated higher projection', () => {
  const base = node('tp', 'TP', [
    leaf('tLow', 'T', 'did', { lineageId: 'tense' }),
    node('vp', 'VP', [leaf('v', 'V', 'buy')])
  ]);
  const q = leaf('cQ', 'C[Q]', '', { silent: true });
  const lower = clone(base);
  lower.children[0].silent = true;
  const landing = node('cComplex', 'C', [
    leaf('tHigh', 'T', 'did', { lineageId: 'tense' }), q
  ]);
  const clause = node('cPrime', 'C′', [landing, lower]);
  const stages = [
    { statement: 'The clause and C are available.', stageRecord: 'C is separately selected.', relations: [], workspaceForest: [base, q] },
    { statement: 'The head moves and higher structure is merged.', stageRecord: 'T moves to C, then a separate higher projection is formed.',
      relations: [{ relation: 'T-to-C head chain', anchors: { lowerHeadOccurrence: 'tLow', higherHeadOccurrence: 'tHigh', attractingHead: 'cQ' }, priorAnchors: { source: 'tLow' } }],
      workspaceForest: [node('higher', 'XP', [clause, leaf('particle', 'X', 'x')])] }
  ];
  const steps = prepareReplay({ derivationStages: stages, sentence: 'did buy x', includePlayback: true }).playbackSteps;
  const movementIndex = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1);
  assert(movementIndex > 0);
  const before = steps[movementIndex - 1], movement = steps[movementIndex];
  for (const id of ['cComplex', 'cPrime', 'tHigh']) {
    assert(!before.replayVisibleNodeIds.includes(id), `${id} must wait for movement`);
    assert(movement.replayVisibleNodeIds.includes(id), `${id} belongs in the movement moment`);
  }
  for (const id of ['tp', 'vp', 'v', 'tLow', 'cQ']) assert(movement.replayVisibleNodeIds.includes(id));
  assert(!movement.replayVisibleNodeIds.includes('higher'), 'unrelated higher projection retains its own step');
  assert(steps.slice(movementIndex + 1).some(step => step.replayKind === 'micro'
    && step.targetNodeId === 'higher'), 'higher projection is still constructed normally');
  assert(!steps.slice(movementIndex + 1).some(step => step.replayKind === 'micro'
    && step.targetNodeId === 'cPrime'), 'no delayed attachment after movement');
});

test('a pending head complex preserves the existing host branch until movement', () => {
  const head = leaf('v0', 'v[transitive]', '', { silent: true });
  const verb = leaf('vLow', 'V', 'read', { lineageId: 'verb' });
  const phrase = node('vp', 'VP', [verb, leaf('object', 'DP', 'books')]);
  const previous = node('shell', 'vP', [head, phrase]);
  const current = clone(previous);
  current.children[0] = node('complex', 'v', [leaf('vHigh', 'V', 'read', { lineageId: 'verb' }), head]);
  current.children[1].children[0].silent = true;
  const stages = [
    { statement: 'Base', stageRecord: 'Base', workspaceForest: [previous], relations: [] },
    { statement: 'Head adjunction', stageRecord: 'Head adjunction', workspaceForest: [current], relations: [
      { relation: 'Earlier observation', anchors: { witness: 'v0' } },
      { relation: 'Head adjunction', anchors: { higherOccurrence: 'vHigh', lowerOccurrence: 'vLow', host: 'v0', resultingHead: 'complex' },
        priorAnchors: { source: 'vLow', target: 'v0' } }
    ] }
  ];
  const original = clone(stages);
  const steps = prepareReplay({ derivationStages: stages, sentence: 'read books', includePlayback: true }).playbackSteps;
  const before = steps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert.deepEqual(findNode(before.replayCanvasData, 'shell').children.map(n => n.id), ['v0', 'vp']);
  assert(before.replayVisibleNodeIds.includes('v0'));
  const movement = steps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 1);
  assert.deepEqual(findNode(movement.replayCanvasData, 'complex').children.map(n => n.id), ['vHigh', 'v0']);
  assert.deepEqual(stages, original);
});

test('head adjunction attaches its receiving head before a later pronunciation change', () => {
  const source = leaf('vBase', 'V', 'read', { lineageId: 'verb' });
  const infl = leaf('infl', 'I[past]', '', { silent: true });
  const previous = node('ibar', "I'", [node('vp', 'VP', [source]), infl]);
  const current = node('ibar', "I'", [node('vp', 'VP', [leaf('trace', 'V trace', '', { silent: true, lineageId: 'verb' })]),
    node('complex', 'I', [leaf('raised', 'V', 'read', { lineageId: 'verb' }), leaf('infl', 'I[past]', '-ed')])]);
  const stages = [
    { statement: 'Base', stageRecord: 'Base', workspaceForest: [previous], relations: [] },
    { statement: 'Inflected head', stageRecord: 'Inflected head', workspaceForest: [current], relations: [
      { relation: 'V-to-I head movement', anchors: { inflectionalHost: 'infl', landingHead: 'complex', raisedHead: 'raised', sourceTrace: 'trace' },
        priorAnchors: { sourceHead: 'vBase', targetHead: 'infl' } },
      { relation: 'Finite realization', anchors: { complexHead: 'complex', inflection: 'infl', stem: 'raised' },
        priorAnchors: { inflection: 'infl', stem: 'vBase' }, values: { exponent: '-ed' } }
    ] }
  ];
  const original = clone(stages);
  const steps = prepareReplay({ derivationStages: stages, sentence: 'read', includePlayback: true }).playbackSteps;
  const move = steps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert.deepEqual(findNode(move.replayCanvasData, 'ibar').children.map(n => n.id), ['vp', 'complex']);
  assert.deepEqual(findNode(move.replayCanvasData, 'complex').children.map(n => n.id), ['raised', 'infl']);
  assert.equal(findNode(move.replayCanvasData, 'infl').word || '', '');
  const realize = steps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 1);
  assert.equal(findNode(realize.replayCanvasData, 'infl').word, '-ed');
  assert.deepEqual(stages, original);
});
