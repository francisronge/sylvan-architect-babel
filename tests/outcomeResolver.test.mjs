import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLiteralRelationDisplays } from '../replay/relationDispatch/relationDispatch.js';
import { PRODUCTION_RENDER_FAMILIES } from '../replay/relations/renderFamilies.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import {
  OUTCOME_ALIAS_GROUPS,
  OUTCOME_CONCEPTS,
  acceptedOutcomeConcept,
  normalizeOutcomeLiteral,
  resolveOutcomeLiteral
} from '../replay/relations/outcomeResolver.ts';

const leaf = (id, label, word, extra = {}) => ({ id, label, word, children: [], ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (relations, workspaceForest) => ({
  statement: 'test',
  stageRecord: 'test',
  relations,
  workspaceForest
});

test('outcome resolution preserves the authored literal', () => {
  assert.deepEqual(resolveOutcomeLiteral('  FAILURE  '), {
    literal: '  FAILURE  ',
    normalized: 'failure',
    concept: 'failed'
  });
});

test('negative outcome concepts remain distinct', () => {
  assert.deepEqual(
    ['blocked', 'failed', 'crashed', 'illicit', 'rejected']
      .map((literal) => resolveOutcomeLiteral(literal)?.concept),
    ['blocked', 'failed', 'crashed', 'illicit', 'rejected']
  );
});

test('normalization and aliases are exact without fuzzy repair', () => {
  assert.equal(normalizeOutcomeLiteral(' WELL_formed '), 'well formed');
  assert.equal(resolveOutcomeLiteral('well formed')?.concept, 'well-formed');
  assert.equal(resolveOutcomeLiteral('fails')?.concept, 'failed');
  assert.equal(resolveOutcomeLiteral('unsuccessful')?.concept, 'failed');
  assert.equal(resolveOutcomeLiteral('prevented')?.concept, 'blocked');
  assert.equal(resolveOutcomeLiteral('not accessible')?.concept, 'blocked');
  assert.equal(resolveOutcomeLiteral('not licensed')?.concept, 'unlicensed');
  assert.equal(resolveOutcomeLiteral('ruled out')?.concept, 'rejected');
  assert.equal(resolveOutcomeLiteral('cannot occur')?.concept, 'impossible');
  assert.equal(resolveOutcomeLiteral('constraint violation')?.concept, 'violation');
  assert.equal(resolveOutcomeLiteral('ungrammatical')?.concept, 'illicit');
  assert.equal(resolveOutcomeLiteral('permitted')?.concept, 'allowed');
  assert.equal(resolveOutcomeLiteral('blockd')?.concept, null);
  assert.equal(resolveOutcomeLiteral('  '), null);
});

test('family acceptance does not turn one recognized concept into another', () => {
  const failure = resolveOutcomeLiteral('failure');
  assert.equal(acceptedOutcomeConcept(failure, ['licensed', 'failed']), 'failed');
  assert.equal(failure?.concept, 'failed');
  assert.equal(acceptedOutcomeConcept(failure, ['licensed', 'blocked']), undefined);
});

test('Tier-1 compilation uses the family policy while preserving the literal panel value', () => {
  const tree = node('tp_outcome', 'TP', [
    node('source_outcome', 'DP', [leaf('witness_outcome', 'D', 't', { silent: true })]),
    node('landing_outcome', 'DP', [leaf('word_outcome', 'D', 'word')]),
    node('domain_outcome', 'VP', [leaf('domain_leaf_outcome', 'V', 'saw')])
  ]);
  const bindingRelation = {
    relation: 'Binding',
    anchors: {
      binder: 'source_outcome',
      bound: 'landing_outcome',
      domain: 'tp_outcome'
    },
    values: { outcome: ' FAILURE ' }
  };
  const bindingPlan = compileRelationRenderPlan([
    stage([bindingRelation], [tree])
  ]);
  const binding = bindingPlan.frames[0].items.find((item) => item.kind === 'binding-domain');
  assert.equal(binding?.outcome, 'failed');
  assert.equal(
    bindingPlan.diagnostics.some((diagnostic) => diagnostic.kind === 'value-unrecognized'),
    false
  );

  const display = buildLiteralRelationDisplays({
    relation: bindingRelation,
    stageIndex: 0,
    relationIndex: 0
  });
  assert.ok(display.some((row) => (
    row.kind === 'value-row'
    && row.role === 'outcome'
    && row.values[0] === ' FAILURE '
  )));

  const antiLocalityPlan = compileRelationRenderPlan([
    stage([{
      relation: 'AntiLocality',
      anchors: {
        source: 'source_outcome',
        traceWitness: 'witness_outcome',
        landing: 'landing_outcome'
      },
      values: { outcome: 'failure' }
    }], [tree])
  ]);
  const path = antiLocalityPlan.frames[0].items.find((item) => (
    item.kind === 'directed-path' && item.pathStyle === 'anti-locality'
  ));
  assert.equal(path?.outcome, 'blocked');
  assert.equal(
    antiLocalityPlan.diagnostics.some((diagnostic) => diagnostic.kind === 'value-unrecognized'),
    false
  );
});

test('AntiLocality maps every reviewed concept to its native visual state', () => {
  const tree = node('tp_anti_outcomes', 'TP', [
    node('source_anti_outcomes', 'DP', [
      leaf('witness_anti_outcomes', 'D', 't', { silent: true })
    ]),
    node('landing_anti_outcomes', 'DP', [leaf('word_anti_outcomes', 'D', 'word')])
  ]);

  for (const [outcome, expected] of [
    ['licensed', 'licensed'],
    ['succeeded', 'licensed'],
    ['permitted', 'licensed'],
    ['acceptance', 'licensed'],
    ['legitimate', 'licensed'],
    ['prevented', 'blocked'],
    ['failure', 'blocked'],
    ['unlicensed', 'blocked'],
    ['cannot occur', 'blocked'],
    ['ruled out', 'blocked'],
    ['constraint violation', 'blocked'],
    ['illicit', 'blocked']
  ]) {
    const plan = compileRelationRenderPlan([
      stage([{
        relation: 'AntiLocality',
        anchors: {
          source: 'source_anti_outcomes',
          traceWitness: 'witness_anti_outcomes',
          landing: 'landing_anti_outcomes'
        },
        values: { outcome }
      }], [tree])
    ]);
    const path = plan.frames[0].items.find((item) => (
      item.kind === 'directed-path' && item.pathStyle === 'anti-locality'
    ));
    assert.equal(path?.outcome, expected, `${outcome} did not earn the expected path state`);
    assert.equal(
      plan.diagnostics.some((diagnostic) => diagnostic.kind === 'value-unrecognized'),
      false,
      `${outcome} was unexpectedly rejected`
    );
  }
});

test('reviewed local-failure concepts reach each Tier-1 locality family', () => {
  const tree = node('tp_local_outcomes', 'TP', [
    node('source_local_outcomes', 'DP', [
      leaf('witness_local_outcomes', 'D', 't', { silent: true })
    ]),
    node('landing_local_outcomes', 'DP', [leaf('word_local_outcomes', 'D', 'word')]),
    node('intervener_local_outcomes', 'DP', [leaf('intervener_word_local_outcomes', 'D', 'closer')]),
    node('domain_local_outcomes', 'VP', [leaf('domain_word_local_outcomes', 'V', 'inside')])
  ]);

  const cases = [
    {
      relation: 'BoundingNodeCrossing',
      anchors: { domain: 'tp_local_outcomes', boundary: ['domain_local_outcomes'] },
      expected: (item) => item.kind === 'node-badges' && item.badgeStyle === 'boundary-cut'
    },
    {
      relation: 'PostTransferAccess',
      anchors: {
        source: 'source_local_outcomes',
        target: 'landing_local_outcomes',
        spellOutDomain: 'domain_local_outcomes'
      },
      expected: (item) => item.kind === 'blocked-access-lane'
    },
    {
      relation: 'BlockedExtraction',
      anchors: {
        source: 'source_local_outcomes',
        target: 'landing_local_outcomes',
        adjunctDomain: 'domain_local_outcomes'
      },
      expected: (item) => (
        item.kind === 'directed-path'
        && item.pathStyle === 'blocked-extraction'
        && item.outcome === 'blocked'
      )
    },
    {
      relation: 'Intervention',
      anchors: {
        landing: 'landing_local_outcomes',
        intervener: 'intervener_local_outcomes',
        target: 'source_local_outcomes'
      },
      expected: (item) => (
        item.kind === 'directed-path'
        && item.pathStyle === 'intervention'
        && item.outcome === 'blocked'
      )
    }
  ];

  for (const fixture of cases) {
    const plan = compileRelationRenderPlan([
      stage([{
        relation: fixture.relation,
        anchors: fixture.anchors,
        values: { outcome: 'failure' }
      }], [tree])
    ]);
    assert.ok(
      plan.frames[0].items.some(fixture.expected),
      `${fixture.relation} did not compile its reviewed failure state`
    );
    assert.equal(
      plan.diagnostics.some((diagnostic) => diagnostic.kind === 'value-unrecognized'),
      false,
      `${fixture.relation} rejected a reviewed failure concept`
    );
  }
});

test('outcome aliases have no cross-concept collisions', () => {
  const ownerByAlias = new Map();
  OUTCOME_ALIAS_GROUPS.forEach(({ concept, aliases }) => {
    aliases.map(normalizeOutcomeLiteral).forEach((alias) => {
      assert.equal(
        ownerByAlias.has(alias),
        false,
        `${alias} is assigned to both ${ownerByAlias.get(alias)} and ${concept}`
      );
      ownerByAlias.set(alias, concept);
    });
  });
});

test('every Tier-1 family declares only known accepted outcome concepts', () => {
  const known = new Set(OUTCOME_CONCEPTS);
  Object.entries(PRODUCTION_RENDER_FAMILIES).forEach(([familyId, family]) => {
    assert.ok(Array.isArray(family.acceptedOutcomeConcepts), `${familyId} has no outcome policy`);
    family.acceptedOutcomeConcepts.forEach((concept) => {
      assert.ok(known.has(concept), `${familyId} accepts unknown outcome concept ${concept}`);
    });
  });
});

test('Tier-1 judgment families accept only their reviewed concepts', () => {
  assert.deepEqual(
    PRODUCTION_RENDER_FAMILIES['binding.domain'].acceptedOutcomeConcepts,
    [
      'licensed', 'successful', 'allowed', 'accepted', 'valid',
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  );
  assert.deepEqual(
    PRODUCTION_RENDER_FAMILIES['anti-locality.paths'].acceptedOutcomeConcepts,
    [
      'licensed', 'successful', 'allowed', 'accepted', 'valid',
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  );
  assert.deepEqual(
    PRODUCTION_RENDER_FAMILIES['blocked-extraction.diagnostic'].acceptedOutcomeConcepts,
    ['blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation']
  );
  assert.deepEqual(
    PRODUCTION_RENDER_FAMILIES['intervention.blocked-path'].acceptedOutcomeConcepts,
    ['blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation']
  );
  assert.deepEqual(
    PRODUCTION_RENDER_FAMILIES['analysis.illicit'].acceptedOutcomeConcepts,
    ['illicit']
  );
});

test('stage prose and processing success do not create a judgment graphic', () => {
  const tree = node('analysis', 'TP', [leaf('word', 'N', 'Mia')]);
  for (const prose of ['The derivation converges.', 'This sentence is grammatical.', 'The request completed successfully.', '✓']) {
    const record = { ...stage([{ relation: prose, anchors: { analysis: 'analysis' } }], [tree]),
      statement: prose, stageRecord: prose, processingStatus: 'completed' };
    const items = compileRelationRenderPlan([record]).frames[0].items;
    assert.equal(items.some(item => item.kind === 'analysis-verdict' || item.badgeStyle === 'local-judgment'), false, prose);
  }
});

test('a local check requires an authored positive outcome and preserves its literal', () => {
  const tree = node('analysis', 'TP', [leaf('word', 'N', 'Mia')]);
  for (const outcome of ['licensed', 'converged', 'The derivation converges.', 'completed', 'not licensed']) {
    const relation = { relation: 'Model judgment', anchors: { 'judged.anchor': 'word' }, values: { outcome } };
    const items = compileRelationRenderPlan([stage([relation], [tree])]).frames[0].items;
    const check = items.find(item => item.badgeStyle === 'local-judgment');
    assert.equal(Boolean(check), outcome === 'licensed', outcome);
    assert.ok(buildLiteralRelationDisplays({ relation, stageIndex: 0, relationIndex: 0 })
      .some(row => row.kind === 'value-row' && row.values.includes(outcome)));
  }
});
