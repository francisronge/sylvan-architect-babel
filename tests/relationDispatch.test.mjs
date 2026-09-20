import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRelationRegistry,
  dispatchRelation,
  productionRelationRegistry,
  summarizeUnregisteredRelations
} from '../replay/relationDispatch/index.js';

const createTestRegistry = () => createRelationRegistry({
  registryId: 'test.registry',
  version: '7',
  entries: [{
    id: 'test.transition',
    version: '3',
    identities: [
      { name: 'Exact Relation', normalization: 'exact' },
      { name: 'Folded Relation', normalization: 'case-whitespace' }
    ],
    signature: {
      anchors: {
        required: {
          landing: { minItems: 1, maxItems: 1 }
        },
        optional: {
          companions: { minItems: 1, maxItems: null }
        }
      },
      priorAnchors: {
        required: {
          source: { minItems: 1, maxItems: 1 }
        }
      },
      values: {
        optional: {
          notation: { minItems: 1, maxItems: null }
        }
      }
    },
    marks: [{
      id: 'test-mark',
      licenses: [
        { field: 'relation' },
        { field: 'anchors', key: 'landing' },
        { field: 'priorAnchors', key: 'source' }
      ]
    }, {
      id: 'optional-value-mark',
      licenses: [
        { field: 'values', key: 'notation' }
      ]
    }]
  }]
});

const completeRelation = () => ({
  relation: 'Exact Relation',
  anchors: {
    landing: 'node-now',
    companions: ['node-a', 'node-b']
  },
  priorAnchors: {
    source: 'node-before'
  },
  values: {
    notation: ['α', '', 'α']
  }
});

test('the production relation registry is versioned and populated with exact identities', () => {
  assert.equal(productionRelationRegistry.registryId, 'babel.semantic-visual-grammar');
  assert.equal(productionRelationRegistry.version, '18');
  assert.ok(productionRelationRegistry.entries.length > 0);
  assert.ok(Object.isFrozen(productionRelationRegistry));
  // Every identity is exact or declared case/whitespace folding — nothing else.
  productionRelationRegistry.entries.forEach((entry) => {
    entry.identities.forEach((identity) => {
      assert.ok(['exact', 'case', 'whitespace', 'case-whitespace'].includes(identity.normalization));
    });
  });
  // Accepted names dispatch; unlisted coinages do not, even when they contain
  // movement-flavored substrings.
  const dispatchOutcome = (name) => dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation: name, anchors: { role: 'node-1' } },
    stageIndex: 0,
    relationIndex: 0
  }).outcome;
  assert.notEqual(dispatchOutcome('AbarMove'), 'unregistered');
  assert.notEqual(dispatchOutcome('abarmove'), 'unregistered');
  assert.notEqual(dispatchOutcome('wh-movement'), 'unregistered');
  assert.equal(dispatchOutcome('CliticCluster'), 'unregistered');
  assert.equal(dispatchOutcome('AbarMovementParty'), 'unregistered');
  assert.equal(dispatchOutcome('bespoke-open-agreement'), 'unregistered');
});

test('alternative required roles and minimum authored items fail closed', () => {
  const missingWitness = dispatchRelation({
    registry: productionRelationRegistry,
    relation: {
      relation: 'AbarMove',
      anchors: { lowerCopy: 'low', pronouncedCopy: 'high' }
    },
    stageIndex: 0,
    relationIndex: 0
  });
  assert.equal(missingWitness.outcome, 'signature-incomplete');
  assert.ok(missingWitness.signatureIssues.some((issue) => (
    issue.kind === 'missing-role-group'
    && issue.roles.includes('traceWitness')
  )));

  const singletonIdentity = dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation: 'Identity', anchors: { occurrence: 'only-one' } },
    stageIndex: 0,
    relationIndex: 1
  });
  assert.equal(singletonIdentity.outcome, 'signature-incomplete');
  assert.ok(singletonIdentity.signatureIssues.some((issue) => (
    issue.kind === 'insufficient-items'
    && issue.minPresentItems === 2
  )));
});

test('ParasiticGap accepts each complete facet alternative and rejects an incomplete movement facet', () => {
  const dispatch = (anchors, relationIndex) => dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation: 'ParasiticGap', anchors },
    stageIndex: 0,
    relationIndex
  });

  [
    { filler: 'filler', realGap: 'ordinary-gap', traceWitness: 'trace' },
    { parasiticGaps: ['parasitic-gap-a', 'parasitic-gap-b'] },
    { primaryPath: ['primary-a', 'primary-b'], secondaryPath: ['secondary-a'] }
  ].forEach((anchors, relationIndex) => {
    const result = dispatch(anchors, relationIndex);
    assert.equal(
      result.outcome,
      'resolved',
      `complete ParasiticGap facet should resolve: ${JSON.stringify(result.signatureIssues)}`
    );
  });

  const incompleteMovement = dispatch(
    { filler: 'filler', realGap: 'ordinary-gap' },
    3
  );
  assert.equal(incompleteMovement.outcome, 'signature-incomplete');
  assert.ok(incompleteMovement.signatureIssues.some((issue) => (
    issue.kind === 'missing-role-alternative'
  )));
});

test('production signatures reject relations that their render families cannot draw', () => {
  const dispatch = (relation, anchors, relationIndex = 0) => dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation, anchors },
    stageIndex: 0,
    relationIndex
  });
  const rejectsWith = (relation, anchors, kind, relationIndex = 0) => {
    const result = dispatch(relation, anchors, relationIndex);
    assert.equal(result.outcome, 'signature-incomplete', relation);
    assert.ok(
      result.signatureIssues.some((issue) => issue.kind === kind),
      `${relation} should report ${kind}: ${JSON.stringify(result.signatureIssues)}`
    );
  };

  rejectsWith(
    'AcrossTheBoardMovement',
    { sources: ['s1', 's2'], traceWitnesses: ['w1', 'w2'] },
    'missing-role-group'
  );
  rejectsWith(
    'AcrossTheBoardMovement',
    {
      sources: ['s1', 's2'],
      traceWitnesses: ['w1', 'w2', 'w3'],
      pronouncedCopy: 'landing'
    },
    'unequal-role-lengths',
    1
  );
  rejectsWith('CyclicAgree', { probe: 'probe' }, 'missing-role-group', 2);
  rejectsWith(
    'Intervention',
    { intervener: 'closer', target: 'lower' },
    'missing-role-group',
    3
  );
  rejectsWith(
    'IdiomChunkCointerpretation',
    { first: 'a', second: 'b', third: 'c' },
    'missing-role-group',
    4
  );
  rejectsWith(
    'CyclicLinearization',
    { lowerCopy: 'low', traceWitness: 'trace', pronouncedCopy: 'high' },
    'missing-role',
    5
  );
  rejectsWith(
    'StrongNPILicensing',
    { licensor: 'exh', npi: 'npi', focusOperator: 'only' },
    'incomplete-role-group',
    6
  );

  [
    ['SplitAntecedence', { antecedents: ['only'], dependent: 'dependent' }],
    ['Multidominance', { parents: ['only'], shared: 'shared' }],
    ['ArgumentSharing', { domains: ['only'], shared: 'shared' }],
    ['FeatureSharing', { bearers: ['only'] }]
  ].forEach(([relation, anchors], index) => {
    rejectsWith(relation, anchors, 'invalid-arity', index + 7);
  });
});

test('production signatures preserve every complete alternative shape', () => {
  const resolves = (relation, anchors, relationIndex, values) => {
    const result = dispatchRelation({
      registry: productionRelationRegistry,
      relation: { relation, anchors, ...(values ? { values } : {}) },
      stageIndex: 0,
      relationIndex
    });
    assert.equal(
      result.outcome,
      'resolved',
      `${relation} should resolve: ${JSON.stringify(result.signatureIssues)}`
    );
  };

  resolves(
    'AcrossTheBoardMovement',
    {
      sources: ['s1', 's2'],
      traceWitnesses: ['w1', 'w2'],
      pronouncedCopy: 'landing'
    },
    0
  );
  resolves('CyclicAgree', { probe: 'probe', searchDomain: 'domain' }, 1);
  resolves(
    'Intervention',
    { probe: 'higher', intervener: 'closer', target: 'lower' },
    2,
    { outcome: 'blocked' }
  );
  resolves(
    'IdiomChunkCointerpretation',
    { interpretationDomain: 'vp', predicateChunk: 'v', argumentChunk: 'dp' },
    3
  );
  resolves('CyclicLinearization', { order: ['first', 'second'] }, 4);
  resolves('StrongNPILicensing', { licensor: 'exh', npi: 'npi' }, 5);
  resolves(
    'StrongNPILicensing',
    {
      licensor: 'exh',
      npi: 'npi',
      focusOperator: 'only',
      focusAssociate: 'subject'
    },
    6
  );
});

test('unregistered names receive literal displays and no semantic marks', () => {
  const result = dispatchRelation({
    registry: productionRelationRegistry,
    relation: {
      relation: 'Open relation 名',
      anchors: {
        'open.role': ['node-2', 'node-1']
      },
      priorAnchors: {
        'earlier role': 'node-0'
      },
      values: {
        notation: ['β', '', 'β']
      }
    },
    stageIndex: 4,
    relationIndex: 2
  });

  assert.equal(result.outcome, 'unregistered');
  assert.deepEqual(result.licensedMarks, []);
  assert.deepEqual(result.literalDisplays, [
    {
      kind: 'relation-name',
      text: 'Open relation 名',
      provenance: { classification: 'authored', field: 'relation' }
    },
    {
      kind: 'witness-row',
      field: 'anchors',
      role: 'open.role',
      values: ['node-2', 'node-1'],
      provenance: { classification: 'authored', field: 'anchors', role: 'open.role' }
    },
    {
      kind: 'witness-row',
      field: 'priorAnchors',
      role: 'earlier role',
      values: ['node-0'],
      provenance: {
        classification: 'authored',
        field: 'priorAnchors',
        role: 'earlier role'
      }
    },
    {
      kind: 'value-row',
      field: 'values',
      role: 'notation',
      values: ['β', '', 'β'],
      provenance: { classification: 'authored', field: 'values', role: 'notation' }
    },
    {
      kind: 'ordinal-badge',
      ordinal: 3,
      provenance: {
        classification: 'derived-presentation',
        inputs: ['relationIndex']
      }
    },
    {
      kind: 'stage-timing-badge',
      stageNumber: 5,
      provenance: {
        classification: 'derived-presentation',
        inputs: ['stageIndex']
      }
    }
  ]);
  assert.equal(JSON.stringify(result).includes('geometry'), false);
  assert.equal(JSON.stringify(result).includes('arrow'), false);
});

test('identity dispatch is exact unless an entry declares case and whitespace folding', () => {
  const registry = createTestRegistry();
  const exact = completeRelation();
  const typo = { ...exact, relation: 'Exact Relation typo' };
  const partial = { ...exact, relation: 'Exact' };
  const wrongCase = { ...exact, relation: 'exact relation' };
  const folded = { ...exact, relation: '  FOLDED   relation  ' };

  assert.equal(dispatchRelation({
    registry,
    relation: exact,
    stageIndex: 1,
    relationIndex: 0
  }).outcome, 'resolved');
  assert.equal(dispatchRelation({
    registry,
    relation: typo,
    stageIndex: 1,
    relationIndex: 0
  }).outcome, 'unregistered');
  assert.equal(dispatchRelation({
    registry,
    relation: partial,
    stageIndex: 1,
    relationIndex: 0
  }).outcome, 'unregistered');
  assert.equal(dispatchRelation({
    registry,
    relation: wrongCase,
    stageIndex: 1,
    relationIndex: 0
  }).outcome, 'unregistered');
  assert.equal(dispatchRelation({
    registry,
    relation: folded,
    stageIndex: 1,
    relationIndex: 0
  }).outcome, 'resolved');
});

test('signature validation degrades without guessing missing roles', () => {
  const relation = completeRelation();
  delete relation.anchors.landing;
  const result = dispatchRelation({
    registry: createTestRegistry(),
    relation,
    stageIndex: 1,
    relationIndex: 0
  });

  assert.equal(result.outcome, 'signature-incomplete');
  assert.deepEqual(result.signatureIssues, [{
    kind: 'missing-role',
    field: 'anchors',
    role: 'landing'
  }]);
  assert.deepEqual(result.licensedMarks, []);
  assert.deepEqual(
    result.omittedMarks.map(({ markId }) => markId),
    ['test-mark', 'optional-value-mark']
  );
  assert.ok(result.literalDisplays.some(
    (display) => display.kind === 'witness-row' && display.role === 'source'
  ));
});

test('strict signatures report arity, value types, and unexpected roles', () => {
  const relation = completeRelation();
  relation.anchors.landing = ['one', 'two'];
  relation.anchors.unapproved = 'three';
  relation.values.notation = 7;
  const result = dispatchRelation({
    registry: createTestRegistry(),
    relation,
    stageIndex: 1,
    relationIndex: 0
  });

  assert.equal(result.outcome, 'signature-incomplete');
  assert.deepEqual(result.signatureIssues, [
    {
      kind: 'invalid-arity',
      field: 'anchors',
      role: 'landing',
      observedItems: 2,
      minItems: 1,
      maxItems: 1
    },
    {
      kind: 'unexpected-role',
      field: 'anchors',
      role: 'unapproved'
    },
    {
      kind: 'invalid-role-value',
      field: 'values',
      role: 'notation',
      offendingValue: 7
    }
  ]);
});

test('every licensed mark records registry, instance, and exact authored licenses', () => {
  const result = dispatchRelation({
    registry: createTestRegistry(),
    relation: completeRelation(),
    stageIndex: 1,
    relationIndex: 4
  });

  assert.equal(result.outcome, 'resolved');
  assert.deepEqual(result.licensedMarks, [{
    markId: 'test-mark',
    provenance: {
      registryId: 'test.registry',
      registryVersion: '7',
      registryEntryId: 'test.transition',
      registryEntryVersion: '3',
      relationInstance: {
        stageIndex: 1,
        relationIndex: 4
      },
      licensingFields: [{
        field: 'relation',
        value: 'Exact Relation'
      }, {
        field: 'anchors',
        key: 'landing',
        value: 'node-now'
      }, {
        field: 'priorAnchors',
        key: 'source',
        value: 'node-before'
      }]
    }
  }, {
    markId: 'optional-value-mark',
    provenance: {
      registryId: 'test.registry',
      registryVersion: '7',
      registryEntryId: 'test.transition',
      registryEntryVersion: '3',
      relationInstance: {
        stageIndex: 1,
        relationIndex: 4
      },
      licensingFields: [{
        field: 'values',
        key: 'notation',
        value: ['α', '', 'α']
      }]
    }
  }]);
});

test('optional marks disappear when their authored license is absent', () => {
  const relation = completeRelation();
  delete relation.values;
  const result = dispatchRelation({
    registry: createTestRegistry(),
    relation,
    stageIndex: 1,
    relationIndex: 0
  });

  assert.equal(result.outcome, 'resolved');
  assert.deepEqual(result.licensedMarks.map(({ markId }) => markId), ['test-mark']);
  assert.deepEqual(result.omittedMarks, [{
    markId: 'optional-value-mark',
    missingLicenses: [{
      field: 'values',
      key: 'notation'
    }]
  }]);
});

test('literal content remains exact and input objects are never rewritten', () => {
  const relation = completeRelation();
  relation.relation = '  FOLDED   relation  ';
  const before = structuredClone(relation);
  const result = dispatchRelation({
    registry: createTestRegistry(),
    relation,
    stageIndex: 1,
    relationIndex: 0
  });

  assert.deepEqual(relation, before);
  assert.equal(result.authoredRelationName, '  FOLDED   relation  ');
  assert.equal(result.literalDisplays[0].text, '  FOLDED   relation  ');
  assert.deepEqual(
    result.literalDisplays.find(({ kind }) => kind === 'value-row').values,
    ['α', '', 'α']
  );
});

test('identical inputs produce byte-identical dispatch receipts', () => {
  const input = {
    registry: createTestRegistry(),
    relation: completeRelation(),
    stageIndex: 2,
    relationIndex: 1
  };
  const first = JSON.stringify(dispatchRelation(input));
  const second = JSON.stringify(dispatchRelation(input));

  assert.equal(second, first);
});

test('adding and removing a test entry changes only its exact dispatch outcome', () => {
  const relation = completeRelation();
  const withoutEntry = dispatchRelation({
    registry: productionRelationRegistry,
    relation,
    stageIndex: 1,
    relationIndex: 0
  });
  const withEntry = dispatchRelation({
    registry: createTestRegistry(),
    relation,
    stageIndex: 1,
    relationIndex: 0
  });
  const removedAgain = dispatchRelation({
    registry: productionRelationRegistry,
    relation,
    stageIndex: 1,
    relationIndex: 0
  });

  assert.equal(withoutEntry.outcome, 'unregistered');
  assert.equal(withEntry.outcome, 'resolved');
  assert.deepEqual(removedAgain, withoutEntry);
  assert.deepEqual(withEntry.literalDisplays, withoutEntry.literalDisplays);
});

test('registry construction rejects fuzzy identities and ambiguous normalized names', () => {
  assert.throws(() => createRelationRegistry({
    registryId: 'bad',
    version: '1',
    entries: [{
      id: 'bad',
      version: '1',
      identities: [{ name: 'Move.*', normalization: 'regex' }]
    }]
  }), /normalization is not supported/);

  assert.throws(() => createRelationRegistry({
    registryId: 'bad',
    version: '1',
    entries: [{
      id: 'one',
      version: '1',
      identities: [{ name: ' A ', normalization: 'case-whitespace' }]
    }, {
      id: 'two',
      version: '1',
      identities: [{ name: 'a', normalization: 'case-whitespace' }]
    }]
  }), /Duplicate registry identity/);
});

test('dispatch fails closed when declared normalization policies overlap', () => {
  const registry = createRelationRegistry({
    registryId: 'ambiguous',
    version: '1',
    entries: [{
      id: 'exact',
      version: '1',
      identities: [{ name: 'Relation', normalization: 'exact' }]
    }, {
      id: 'case-folded',
      version: '1',
      identities: [{ name: 'relation', normalization: 'case' }]
    }]
  });

  assert.throws(() => dispatchRelation({
    registry,
    relation: { relation: 'Relation', anchors: {} },
    stageIndex: 0,
    relationIndex: 0
  }), /Ambiguous registry identity/);
});

test('mark licenses can cite only exact structured authored fields', () => {
  assert.throws(() => createRelationRegistry({
    registryId: 'bad',
    version: '1',
    entries: [{
      id: 'bad',
      version: '1',
      identities: [{ name: 'Bad', normalization: 'exact' }],
      marks: [{
        id: 'bad-mark',
        licenses: [{ field: 'statement', key: 'inferred' }]
      }]
    }]
  }), /must name relation or a structured relation field/);

  assert.throws(() => createRelationRegistry({
    registryId: 'bad',
    version: '1',
    entries: [{
      id: 'bad',
      version: '1',
      identities: [{ name: 'Bad', normalization: 'exact' }],
      marks: [{
        id: 'bad-mark',
        licenses: [{ field: 'anchors', key: 'undeclared' }]
      }]
    }]
  }), /licenses undeclared anchors role undeclared/);
});

test('registry entries cannot carry renderer or geometry instructions', () => {
  assert.throws(() => createRelationRegistry({
    registryId: 'bad',
    version: '1',
    entries: [{
      id: 'bad',
      version: '1',
      identities: [{ name: 'Bad', normalization: 'exact' }],
      renderer: 'trajectory'
    }]
  }), /unsupported fields: renderer/);
});

test('dispatch requires stable stage and relation coordinates for provenance', () => {
  assert.throws(() => dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation: 'Unknown', anchors: { witness: 'n1' } },
    stageIndex: -1,
    relationIndex: 0
  }), /stageIndex must be a non-negative integer/);
  assert.throws(() => dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation: 'Unknown', anchors: { witness: 'n1' } },
    stageIndex: 0,
    relationIndex: 0.5
  }), /relationIndex must be a non-negative integer/);
  assert.throws(() => dispatchRelation({
    registry: productionRelationRegistry,
    relation: null,
    stageIndex: 0,
    relationIndex: 0
  }), /relation must be an object/);
  assert.throws(() => dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation: ' ', anchors: {} },
    stageIndex: 0,
    relationIndex: 0
  }), /relation.relation must be a non-empty string/);
});

test('unregistered-name counts preserve exact authored identities and input order', () => {
  const results = ['Unknown', 'unknown', 'Unknown'].map((relation, relationIndex) => (
    dispatchRelation({
      registry: productionRelationRegistry,
      relation: { relation, anchors: { witness: `n${relationIndex}` } },
      stageIndex: 0,
      relationIndex
    })
  ));

  assert.deepEqual(summarizeUnregisteredRelations(results), [
    { relation: 'Unknown', count: 2 },
    { relation: 'unknown', count: 1 }
  ]);
});
