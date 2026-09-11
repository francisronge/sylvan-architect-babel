import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findRelationRegistryEntry,
  productionRelationRegistry
} from '../replay/relationDispatch/index.js';
import {
  compileRelationRenderPlan,
  visiblePlanFrameItems
} from '../replay/relations/renderPlanCompiler.ts';
import { PRODUCTION_RENDER_FAMILIES } from '../replay/relations/renderFamilies.ts';

/**
 * The production coverage gate. This committed manifest records every
 * identity in the accepted relation catalog. Each must be production-wired to
 * a specialized compiler —
 * exact registry entry plus render family — or explicitly excluded with a
 * reason. The gate deliberately does not read the local-only research Lab.
 */
const ACCEPTED_RELATION_IDENTITIES = [
  'AMove',
  'AbarMove',
  'Accord',
  'AcrossTheBoardMovement',
  'Agree',
  'AntiLocality',
  'ArgumentSharing',
  'Binding',
  'BlockedExtraction',
  'BoundingNodeCrossing',
  'CaseAssignment',
  'Control',
  'CooperStorage',
  'CopyOccurrence',
  'Coreference',
  'CyclicAgree',
  'CyclicLinearization',
  'DependentCase',
  'EllipsisDeletion',
  'EllipsisRecoverability',
  'FProjection',
  'FeatureBundle',
  'FeatureSharing',
  'Fission',
  'FocusMarking',
  'GappingAlignment',
  'HeadMove',
  'Identity',
  'IdiomChunkCointerpretation',
  'Impoverishment',
  'ImproperMovement',
  'IllicitAnalysis',
  'Intervention',
  'LFReconstruction',
  'LocalDislocation',
  'Lowering',
  'ManyToManyCorrespondence',
  'Multidominance',
  'MultipleAgree',
  'MultiplePronunciation',
  'OperatorVariableBinding',
  'PFRealization',
  'PairMerge',
  'ParasiticGap',
  'PartialCopyDeletion',
  'Phase',
  'PhrasalSpellOut',
  'PostTransferAccess',
  'Predication',
  'QuantifierRaising',
  'RemnantMovement',
  'RollUpMovement',
  'Scrambling',
  'SidewardMovement',
  'Smuggling',
  'SplitAntecedence',
  'StrongNPILicensing',
  'ThetaAssignment',
  'TransferDomain',
  'VocabularyInsertion'
].sort();

test('every accepted relation identity is production-wired', () => {
  const authoredNames = ACCEPTED_RELATION_IDENTITIES;
  assert.equal(authoredNames.length, 60, 'accepted relation manifest changed unexpectedly');

  const wired = [];
  const uncovered = [];
  authoredNames.forEach((name) => {
    const entry = findRelationRegistryEntry(productionRelationRegistry, name);
    if (entry && PRODUCTION_RENDER_FAMILIES[entry.id]) {
      wired.push(name);
      return;
    }
    uncovered.push(name);
  });

  assert.deepEqual(
    uncovered,
    [],
    `accepted active relations without production wiring: ${uncovered.join(', ')}`
  );
  assert.ok(wired.length >= 49, `wired count regressed: ${wired.length}`);
});

/**
 * Real accepted anchor shapes for every wired identity beyond the movement
 * core (covered in relationRenderPlan.test.mjs). Fixtures mirror the
 * accepted Lab cards' authored shapes so an omitted registry role cannot
 * silently produce signature-incomplete.
 */
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (relations, forest) => ({
  statement: 'statement',
  stageRecord: 'record',
  relations: relations,
  workspaceForest: forest
});

const fixtureForest = () => [node('root_fx', 'TP', [
  node('src_fx', 'XP', [leaf('w_fx', 'X', 't₁', { silent: true })], { silent: true }),
  node('tgt_fx', 'YP', [leaf('t_fx', 'Y', 'word')]),
  node('a_fx', 'AP', [leaf('a_leaf_fx', 'A', 'a')]),
  node('b_fx', 'BP', [leaf('b_leaf_fx', 'B', 'b')]),
  node('c_fx', 'CPx', [leaf('c_leaf_fx', 'C', 'c')]),
  node('d_fx', 'DPx', [leaf('d_leaf_fx', 'D', 'd')]),
  node('dom_fx', 'ZP', [
    node('in_a_fx', 'ZA', [leaf('in_a_leaf_fx', 'Z', 'za')]),
    node('in_b_fx', 'ZB', [leaf('in_b_leaf_fx', 'Z', 'zb')])
  ])
])];

const CASES = [
  { relation: 'Identity', anchors: { occurrences: ['a_fx', 'b_fx', 'c_fx'] } },
  { relation: 'Identity', anchors: { pronouncedCopy: 'a_fx', lowerCopy: 'b_fx' } },
  { relation: 'Control', anchors: { controller: 'a_fx', controllee: 'in_a_fx', domain: 'dom_fx' } },
  { relation: 'Predication', anchors: { predicand: 'a_fx', predicate: 'b_fx' } },
  { relation: 'Predication', anchors: { predicand: 'a_fx', predicates: ['b_fx', 'c_fx'] } },
  {
    relation: 'SplitAntecedence',
    anchors: { antecedents: ['a_fx', 'b_fx'], dependent: 'c_fx' },
    values: { antecedentIndices: ['1', '2'], dependentIndex: '1⊕2' }
  },
  {
    relation: 'ParasiticGap',
    anchors: { filler: 'a_fx', realGap: 'src_fx', traceWitness: 'w_fx', parasiticGap: 'b_fx' }
  },
  {
    relation: 'ParasiticGap',
    anchors: {
      filler: 'a_fx', realGap: 'src_fx', traceWitness: 'w_fx', parasiticGap: 'b_fx',
      primaryPath: ['a_fx', 'b_fx', 'c_fx'],
      secondaryPath: ['d_fx', 'in_a_fx'],
      blockedEdge: 'in_b_fx'
    },
    values: { outcome: 'blocked' }
  },
  { relation: 'PairMerge', anchors: { pairMember: 'a_fx', host: 'b_fx' } },
  { relation: 'Multidominance', anchors: { parents: ['dom_fx', 'a_fx'], shared: 'in_a_fx' } },
  { relation: 'ArgumentSharing', anchors: { domains: ['dom_fx', 'a_fx'], shared: 'in_b_fx' } },
  {
    relation: 'IdiomChunkCointerpretation',
    anchors: { predicateChunk: 'a_fx', argumentChunk: 'b_fx', interpretationDomain: 'dom_fx' }
  },
  { relation: 'Agree', anchors: { probe: 'a_fx', goal: 'b_fx' }, values: { feature: 'φ', value: '3SG' } },
  { relation: 'FeatureBundle', anchors: { bearer: 'a_fx' }, values: { Case: 'NOM' } },
  { relation: 'MultipleAgree', anchors: { probe: 'a_fx', goals: ['b_fx', 'c_fx'] }, values: { outcome: 'agree' } },
  { relation: 'CyclicAgree', anchors: { probe: 'a_fx', goal: 'b_fx' }, values: { cycle: '1', outcome: 'fails' } },
  { relation: 'FeatureSharing', anchors: { bearers: ['a_fx', 'b_fx', 'c_fx'] }, values: { feature: 'φ', value: '□' } },
  { relation: 'CaseAssignment', anchors: { assigner: 'a_fx', bearer: 'b_fx' }, values: { feature: 'Case', value: 'NOM' } },
  {
    relation: 'DependentCase',
    anchors: { probe: 'a_fx', goal: 'b_fx' },
    values: { step: '1', Case: 'ACC', probeLabel: '[*φ*]', goalLabel: '[CASE: ACC]' }
  },
  { relation: 'Accord', anchors: { source: 'a_fx', goal: 'b_fx' }, values: { index: '1', feature: 'POL', value: '−' } },
  { relation: 'BoundingNodeCrossing', anchors: { domain: 'dom_fx', boundary: ['a_fx', 'b_fx'] } },
  { relation: 'Phase', anchors: { phase: 'dom_fx', edge: 'in_a_fx' } },
  { relation: 'TransferDomain', anchors: { phase: 'dom_fx', edge: 'in_a_fx', spellOutDomain: 'in_b_fx' } },
  { relation: 'PostTransferAccess', anchors: { source: 'a_fx', target: 'in_b_fx', spellOutDomain: 'in_b_fx' }, values: { outcome: 'blocked' } },
  {
    relation: 'AntiLocality',
    anchors: { source: 'src_fx', traceWitness: 'w_fx', landing: 'tgt_fx' },
    values: { outcome: 'blocked' }
  },
  {
    relation: 'AntiLocality',
    anchors: { source: 'src_fx', traceWitness: 'w_fx', landing: 'tgt_fx', facilitator: 'a_fx' },
    values: { outcome: 'licensed' }
  },
  {
    relation: 'ImproperMovement',
    anchors: {
      source: 'src_fx', traceWitness: 'w_fx', licensedLanding: 'tgt_fx',
      licensedLandingHosts: ['a_fx'], rejectedLandingHosts: ['b_fx'], forbiddenRegion: ['c_fx', 'd_fx']
    }
  },
  {
    relation: 'BlockedExtraction',
    anchors: { source: 'in_a_fx', target: 'a_fx', adjunctDomain: 'dom_fx' },
    values: { label: '* extraction' }
  },
  {
    relation: 'AdjunctInaccessibility',
    anchors: { source: 'in_a_fx', target: 'a_fx', adjunctDomain: 'dom_fx' }
  },
  { relation: 'Intervention', anchors: { landing: 'a_fx', intervener: 'b_fx', target: 'c_fx' }, values: { outcome: 'blocked' } },
  { relation: 'EllipsisDeletion', anchors: { domain: 'dom_fx' } },
  { relation: 'MultiplePronunciation', anchors: { higherCopy: 'a_fx', lowerCopy: 'b_fx' } },
  { relation: 'CopyOccurrence', anchors: { occurrences: ['a_fx', 'b_fx'] } },
  { relation: 'PartialCopyDeletion', anchors: { deletedSubconstituent: 'in_a_fx' } },
  { relation: 'PhrasalSpellOut', anchors: { phrase: 'dom_fx' }, values: { exponent: '-nak' } },
  {
    relation: 'ManyToManyCorrespondence',
    anchors: { word: 'a_fx' },
    values: { sources: ['K', 'Poss'], exponents: ['-eer', '-maan'], correspondence: ['K => -eer', 'Poss => -maan'] }
  },
  { relation: 'Impoverishment', anchors: { terminal: 'a_fx' }, values: { featureHierarchy: ['π', 'PART'], delinkAfter: 'π' } },
  { relation: 'LocalDislocation', anchors: { sequence: ['a_fx', 'b_fx', 'c_fx'] }, values: { beforeGroupSizes: ['1', '2'], afterGroupSizes: ['2', '1'] } },
  {
    relation: 'QuantifierRaising',
    anchors: { pronouncedQP: 'a_fx', lfQP: 'b_fx', scopeDomain: 'dom_fx' }
  },
  { relation: 'LFReconstruction', anchors: { neglectedCopy: 'a_fx', interpretedCopy: 'b_fx', binder: 'c_fx' } },
  {
    relation: 'CooperStorage',
    anchors: { scope: 'dom_fx', quantifier: 'a_fx' },
    values: { category: 'S', qstore: ['⟨every book⟩'] }
  },
  {
    relation: 'StrongNPILicensing',
    anchors: { licensor: 'a_fx', npi: 'b_fx', focusOperator: 'c_fx', focusAssociate: 'd_fx' },
    values: { feature: 'D' }
  },
  { relation: 'FocusMarking', anchors: { focus: 'in_a_fx', background: 'in_b_fx', domain: 'dom_fx' } },
  { relation: 'FProjection', anchors: { accentBearer: 'in_a_fx', projections: ['dom_fx', 'root_fx'] }, values: { accent: 'H*', feature: 'F' } },
  { relation: 'ThetaAssignment', anchors: { predicate: 'a_fx', agent: 'b_fx', theme: 'c_fx' } },
  {
    relation: 'GappingAlignment',
    anchors: { correlates: ['c_fx', 'd_fx'], remnants: ['in_a_fx', 'in_b_fx'] },
    values: { labels: ['1', '2'] }
  }
];

test('every remaining wired identity compiles its real accepted anchor shape into semantic items', () => {
  CASES.forEach(({ relation, anchors, values }) => {
    const plan = compileRelationRenderPlan([
      stage([{ relation, anchors, ...(values ? { values } : {}) }], fixtureForest())
    ]);
    assert.deepEqual(plan.unregistered, [], `${relation} must dispatch through its exact registry entry`);
    const signatureFailures = plan.diagnostics.filter((d) => d.kind === 'signature-incomplete');
    assert.deepEqual(signatureFailures, [], `${relation} signature-incomplete: ${JSON.stringify(signatureFailures)}`);
    const semanticItems = plan.frames[0].items
      .filter((item) => item.kind !== 'fallback' && item.kind !== 'anchor-set');
    assert.ok(
      semanticItems.length >= 1,
      `${relation} compiled no semantic item; diagnostics: ${JSON.stringify(plan.diagnostics)}`
    );
    assert.equal(
      semanticItems.every((item) => item.tier2FacetId === undefined),
      true,
      `${relation} is canonical production evidence and must remain entirely Tier 1`
    );
  });
});

test('ParasiticGap owns exactly one ordinary movement path from real gap to filler', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'tgt_fx',
        realGap: 'src_fx',
        traceWitness: 'w_fx',
        parasiticGaps: ['b_fx', 'c_fx']
      }
    }], fixtureForest())
  ]);
  const items = plan.frames[0].items;
  const trajectories = items.filter((item) => item.kind === 'trajectory');
  assert.deepEqual(trajectories.map((item) => ({
    kind: item.trajectoryKind,
    source: item.sourceNodeId,
    target: item.targetNodeId,
    witness: item.witnessNodeId,
    sourceAttachment: item.sourceAttachment,
    targetAttachment: item.targetAttachment
  })), [{
    kind: 'parasitic-gap',
    source: 'src_fx',
    target: 'tgt_fx',
    witness: 'w_fx',
    sourceAttachment: 'shell-bottom',
    targetAttachment: 'shell-bottom'
  }]);
  assert.equal(
    trajectories.some((item) => ['b_fx', 'c_fx'].includes(item.sourceNodeId)),
    false,
    'a parasitic gap is never a movement source'
  );
  const copyFork = items.find((item) => item.kind === 'parasitic-gap-copy');
  assert.deepEqual(copyFork && {
    content: copyFork.contentNodeId,
    ordinaryGap: copyFork.ordinaryGapNodeId,
    parasiticGaps: copyFork.parasiticGapNodeIds
  }, {
    content: 'tgt_fx',
    ordinaryGap: 'src_fx',
    parasiticGaps: ['b_fx', 'c_fx']
  });
  assert.equal(items.some((item) => item.kind === 'coindex'), false);
  assert.equal(
    items.some((item) => item.kind === 'node-badges' && item.badgeStyle === 'gap-notation'),
    false,
    'the reusable copy fork, not a pg subscript, is the generic relation mark'
  );
});

test('ParasiticGap gap-only authorship compiles specialized gap notation without movement', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: { parasiticGaps: ['b_fx', 'c_fx'] }
    }], fixtureForest())
  ]);
  const items = plan.frames[0].items;
  const gapBadges = items
    .filter((item) => item.kind === 'node-badges' && item.badgeStyle === 'gap-notation')
    .flatMap((item) => item.badges);

  assert.deepEqual(plan.unregistered, []);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(gapBadges, [
    { nodeId: 'b_fx', text: 'pgᵢ', shape: 'plain' },
    { nodeId: 'c_fx', text: 'pgᵢ', shape: 'plain' }
  ]);
  assert.equal(items.some((item) => item.kind === 'trajectory'), false);
  assert.equal(items.some((item) => item.kind === 'parasitic-gap-copy'), false);
  assert.equal(items.some((item) => item.kind === 'fallback'), false);
});

test('ParasiticGap paths-only authorship compiles path status without movement or gap notation', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        primaryPath: ['root_fx', 'a_fx'],
        secondaryPath: ['b_fx', 'c_fx'],
        blockedEdge: 'd_fx'
      },
      values: { outcome: 'blocked' }
    }], fixtureForest())
  ]);
  const items = plan.frames[0].items;
  const pathStatus = items.find((item) => item.kind === 'path-status');

  assert.deepEqual(plan.unregistered, []);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(pathStatus && {
    primary: pathStatus.primaryNodeIds,
    secondary: pathStatus.secondaryNodeIds,
    blockedEdge: pathStatus.blockedEdgeNodeId,
    outcome: pathStatus.outcome
  }, {
    primary: ['root_fx', 'a_fx'],
    secondary: ['b_fx', 'c_fx'],
    blockedEdge: 'd_fx',
    outcome: 'blocked'
  });
  assert.equal(items.some((item) => item.kind === 'trajectory'), false);
  assert.equal(
    items.some((item) => item.kind === 'node-badges' && item.badgeStyle === 'gap-notation'),
    false
  );
  assert.equal(items.some((item) => item.kind === 'fallback'), false);
});

test('ParasiticGap complete movement authorship compiles its trajectory without requiring gap facets', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'tgt_fx',
        realGap: 'src_fx',
        lowerWitness: 'w_fx'
      }
    }], fixtureForest())
  ]);
  const items = plan.frames[0].items;
  const trajectories = items.filter((item) => item.kind === 'trajectory');

  assert.deepEqual(plan.unregistered, []);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(trajectories.map((item) => ({
    family: item.familyId,
    kind: item.trajectoryKind,
    source: item.sourceNodeId,
    target: item.targetNodeId,
    witness: item.witnessNodeId
  })), [{
    family: 'parasitic-gap.composition',
    kind: 'parasitic-gap',
    source: 'src_fx',
    target: 'tgt_fx',
    witness: 'w_fx'
  }]);
  assert.equal(items.some((item) => item.kind === 'parasitic-gap-copy'), false);
  assert.equal(items.some((item) => item.kind === 'fallback'), false);
});

test('AbarMove plus gap-only ParasiticGap keeps movement and parasitic notation separate', () => {
  const plan = compileRelationRenderPlan([
    stage([
      {
        relation: 'AbarMove',
        anchors: {
          lowerCopy: 'src_fx',
          traceWitness: 'w_fx',
          pronouncedCopy: 'tgt_fx'
        }
      },
      {
        relation: 'ParasiticGap',
        anchors: { parasiticGap: 'b_fx' }
      }
    ], fixtureForest())
  ]);
  const items = plan.frames[0].items;
  const trajectories = items.filter((item) => item.kind === 'trajectory');
  const gapBadges = items
    .filter((item) => item.kind === 'node-badges' && item.badgeStyle === 'gap-notation')
    .flatMap((item) => item.badges);

  assert.deepEqual(plan.unregistered, []);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(trajectories.map((item) => ({
    family: item.familyId,
    relationIndex: item.relationRef.relationIndex,
    kind: item.trajectoryKind
  })), [{
    family: 'trajectory.phrasal',
    relationIndex: 0,
    kind: 'phrasal'
  }]);
  assert.deepEqual(gapBadges, [
    { nodeId: 'b_fx', text: 'pgᵢ', shape: 'plain' }
  ]);
  assert.equal(items.some((item) => item.kind === 'fallback'), false);
});

test('a failed ParasiticGap movement facet does not abort valid gap and path facets', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'missing_filler',
        realGap: 'src_fx',
        traceWitness: 'w_fx',
        parasiticGap: 'b_fx',
        primaryPath: ['root_fx', 'a_fx']
      }
    }], fixtureForest())
  ]);
  const items = plan.frames[0].items;

  assert.ok(plan.diagnostics.some((diagnostic) => (
    diagnostic.kind === 'anchor-unresolved'
    && diagnostic.detail.includes('missing_filler')
  )));
  assert.equal(items.some((item) => item.kind === 'trajectory'), false);
  assert.equal(items.some((item) => item.kind === 'path-status'), true);
  assert.equal(
    items.some((item) => item.kind === 'node-badges' && item.badgeStyle === 'gap-notation'),
    true
  );
  assert.equal(items.some((item) => item.kind === 'fallback'), false);
});

test('EllipsisDeletion strikes lexical terminals and compiles no ghost set', () => {
  const deletionTree = {
    id: 'dp_delete',
    label: 'DP',
    silent: true,
    children: [
      { id: 'd_delete', label: 'D', silent: true, children: [
        { id: 'the_delete', label: 'The', silent: true, children: [] }
      ] },
      { id: 'np_delete', label: 'NP', silent: true, children: [
        { id: 'n_delete', label: 'N', silent: true, children: [
          { id: 'students_delete', label: 'students', silent: true, children: [] }
        ] }
      ] }
    ]
  };
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'EllipsisDeletion', anchors: { domain: 'dp_delete' } }], [deletionTree])
  ]);
  const items = plan.frames[0].items;
  const strike = items.find((item) => item.kind === 'strike-ghost');
  assert.deepEqual(strike?.strikeNodeIds, ['dp_delete']);
  assert.deepEqual(strike?.ghostNodeIds, []);
  assert.equal(items.some((item) => item.kind === 'ellipsis-site'), false);
});

test('ParasiticGap Phillips path topology leaves from the unique real-gap terminal', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'tgt_fx',
        realGap: 'src_fx',
        traceWitness: 'w_fx',
        parasiticGap: 'b_fx',
        primaryPath: ['root_fx', 'src_fx'],
        secondaryPath: ['d_fx', 'b_fx']
      }
    }], fixtureForest())
  ]);
  const trajectories = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  assert.deepEqual(trajectories.map((item) => ({
    source: item.sourceNodeId,
    target: item.targetNodeId,
    sourceAttachment: item.sourceAttachment,
    targetAttachment: item.targetAttachment
  })), [{
    source: 'src_fx',
    target: 'tgt_fx',
    sourceAttachment: 'terminal',
    targetAttachment: 'shell-bottom'
  }]);
  assert.equal(
    trajectories.some((item) => item.sourceNodeId === 'b_fx'),
    false,
    'the Phillips secondary path never becomes a movement source'
  );
});

test('Agree composed with CaseAssignment is presented once in either authored order', () => {
  const agree = {
    relation: 'Agree',
    anchors: { probe: 'b_fx', goal: 'c_fx' },
    values: { feature: 'Number', value: 'PL' }
  };
  const caseAssignment = {
    relation: 'CaseAssignment',
    anchors: { assigner: 'a_fx', bearer: 'b_fx' },
    values: { feature: 'Case', value: 'DAT' }
  };
  [
    [agree, caseAssignment],
    [caseAssignment, agree]
  ].forEach((relations) => {
    const plan = compileRelationRenderPlan([stage(relations, fixtureForest())]);
    const items = plan.frames[0].items;
    assert.equal(items.some((item) => item.kind === 'fallback'), false);
    assert.equal(
      items.filter((item) => item.kind === 'directed-path' && item.pathStyle === 'case-agree').length,
      1
    );
  });
});

test('PFRealization collects same-stage VocabularyInsertion rows into one plate, verbatim and in authored order', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'PFRealization', anchors: { root: 'a_fx', tense: 'b_fx' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'a_fx' }, values: { input: '√LAUGH', output: 'laugh' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'b_fx' }, values: { input: 'T[past]', output: '-ed' } }
    ], fixtureForest())
  ]);
  assert.deepEqual(plan.unregistered, []);
  const plates = plan.frames[0].items.filter((item) => item.kind === 'node-plaque');
  assert.equal(plates.length, 1, 'insertions fold into the realization plate, not separate plates');
  assert.deepEqual(plates[0].rows, [
    { label: '√LAUGH', value: 'laugh' },
    { label: 'T[past]', value: '-ed' }
  ]);
  assert.deepEqual(plates[0].rowRefs.map((ref) => ref?.relationIndex ?? null), [1, 2]);
  // A standalone insertion keeps its own plate.
  const alone = compileRelationRenderPlan([
    stage([
      { relation: 'VocabularyInsertion', anchors: { terminal: 'a_fx' }, values: { input: 'X', output: 'x' } }
    ], fixtureForest())
  ]);
  assert.equal(alone.frames[0].items.filter((item) => item.kind === 'node-plaque').length, 1);
});

test('CyclicLinearization keeps earlier instances visible and retains the backward cue', () => {
  const forest = fixtureForest();
  const plan = compileRelationRenderPlan([
    stage([], forest),
    stage([{
      relation: 'CyclicLinearization',
      anchors: { order: ['a_fx', 'b_fx'], edgePosition: 'a_fx' },
      priorAnchors: { order: ['a_fx', 'b_fx'] },
      values: { outcome: 'licensed' }
    }], forest),
    stage([{
      relation: 'CyclicLinearization',
      anchors: { order: ['a_fx', 'b_fx', 'c_fx'], conflictWitness: 'c_fx' },
      priorAnchors: { order: ['a_fx', 'b_fx'] },
      values: { outcome: 'conflict' }
    }], forest)
  ]);
  const frameZero = plan.frames[1].items.filter((item) => item.kind === 'node-plaque');
  const frameOne = visiblePlanFrameItems(plan, 2, null)
    .filter((item) => item.kind === 'node-plaque');
  assert.equal(frameZero.length, 1);
  assert.equal(frameOne.length, 2);
  assert.equal(frameOne[0].title, 'licensed', 'the earlier authored instance persists');
  assert.equal(frameOne[1].title, 'conflict', 'the later instance is added as a separate claim');
  assert.equal(frameOne[1].backward, true);
  assert.deepEqual(frameOne[1].priorWitnessNodeIds, ['a_fx', 'b_fx']);
});

test('CooperStorage keeps same-stage scope ledgers together and replaces the prior stage atomically', () => {
  const forest = fixtureForest();
  const plan = compileRelationRenderPlan([
    stage([
      {
        relation: 'CooperStorage',
        anchors: { scope: 'dom_fx', quantifier: 'a_fx' },
        values: { category: 'VP', qstore: ['every book'], retrieved: [] }
      },
      {
        relation: 'CooperStorage',
        anchors: { scope: 'root_fx', quantifier: 'a_fx' },
        values: { category: 'S', qstore: ['every book'], retrieved: [] }
      }
    ], forest),
    stage([{
      relation: 'CooperStorage',
      anchors: { scope: 'root_fx', quantifier: 'a_fx' },
      values: { category: 'S', qstore: [], retrieved: ['every book'] }
    }], forest),
    stage([{
      relation: 'CooperStorage',
      anchors: { scope: 'root_fx', quantifier: 'a_fx' },
      values: { category: 'S', qstore: [], retrieved: ['someone'] }
    }], forest)
  ]);

  const plaques = (frameIndex, played) => visiblePlanFrameItems(plan, frameIndex, played)
    .filter((item) => item.kind === 'node-plaque');
  assert.equal(plaques(0, null).length, 2, 'same-stage VP and S ledgers coexist');
  assert.equal(plaques(1, new Set()).length, 2, 'the prior state remains through structural microsteps');
  assert.equal(plaques(1, new Set([0])).length, 1, 'the new relation moment replaces the prior stage');
  assert.equal(plaques(1, null).length, 1, 'the committed second stage contains only its current state');
  assert.equal(plaques(2, null).length, 1, 'the committed final stage contains only its current state');
});

test('multidominance trusts fully resolved authored parent roles without inferring a native mother', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'Multidominance',
      anchors: { parents: ['a_fx', 'b_fx'], shared: 'c_fx' }
    }], fixtureForest())
  ]);
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'shared-node').length, 1);
  assert.deepEqual(plan.diagnostics, []);
});

test('shared-subject multidominance uses one structural mother as its witness and adds the other', () => {
  const shared = node('coord_md_subject', 'CoordP', [
    node('tp_left_md_subject', 'TP', [
      node('dp_shared_subject', 'DP', [leaf('n_shared_subject', 'N', 'Noa')]),
      node('vp_left_md_subject', 'VP', [leaf('v_left_md_subject', 'V', 'sang')])
    ]),
    node('tp_right_md_subject', 'TP', [
      node('vp_right_md_subject', 'VP', [leaf('v_right_md_subject', 'V', 'danced')])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'Multidominance',
      anchors: {
        parents: ['tp_left_md_subject', 'tp_right_md_subject'],
        shared: 'dp_shared_subject'
      }
    }], [shared])
  ]);
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'shared-node').length, 1);
  assert.deepEqual(plan.diagnostics, []);
});

test('LF reconstruction compiles strike/ghost plus shared index and no connector of any kind', () => {
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'LFReconstruction',
      anchors: { neglectedCopy: 'dom_fx', interpretedCopy: 'a_fx', binder: 'b_fx' }
    }], fixtureForest())
  ]);
  const kinds = plan.frames[0].items.map((item) => item.kind).sort();
  assert.deepEqual(kinds, ['coindex', 'strike-ghost']);
  assert.equal(plan.frames[0].items.find((item) => item.kind === 'coindex')?.index, 'i');
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'directed-path'), false);
});
