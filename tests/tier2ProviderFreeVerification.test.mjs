import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import {
  compileRelationRenderPlan
} from '../replay/relations/renderPlanCompiler.ts';
import {
  TIER2_FACET_RECIPES,
  TIER2_VISUAL_PRIMITIVE_NAMES,
  buildTier2FacetIdentity,
  buildTier2FacetOutputIdentities,
  evaluateTier2FacetRecipe
} from '../replay/relations/tier2FacetRecipes.ts';
import {
  buildTier2FacetEvidence,
  dispatchRelationClaims
} from '../replay/relations/tier2RelationDispatch.ts';
import { compileTier2RelationOutputs } from '../replay/relations/tier2RenderPlanCompiler.ts';
import {
  TIER2_ROLE_SYNONYMS,
  TIER2_VALUE_SYNONYMS,
  buildTier2SynonymIndex,
  lookupTier2SynonymCandidates,
  normalizeTier2Synonym
} from '../replay/relations/tier2Synonyms.ts';

const leaf = (id, extras = {}) => ({
  id,
  label: 'X',
  word: id,
  children: [],
  ...extras
});

const node = (id, children = [], extras = {}) => ({
  id,
  label: 'XP',
  children,
  ...extras
});

const scalarOrArray = (items) => items.length === 1 ? items[0] : items;

const idsFor = (role, count) => Array.from(
  { length: count },
  (_, index) => `${role.replace(/[^a-z0-9]+/giu, '_')}_${index + 1}`
);

const valueLiteral = (recipe, valueName, index) => {
  if (valueName === 'outcome') return recipe.acceptedOutcomeConcepts[0] ?? 'licensed';
  if (valueName === 'movement.route') return 'curve';
  if (valueName === 'verdict') return '*';
  if (valueName === 'index') return String(index + 1);
  if (valueName === 'label') return 'label';
  if (valueName === 'role.label') return ['Agent', 'Theme', 'Goal'][index] ?? `Role ${index + 1}`;
  if (valueName === 'feature.label') return recipe.id === 'strong-npi' ? 'strong NPI' : 'F';
  if (valueName === 'accent.label') return 'H*';
  if (valueName === 'cycle') return 'C1';
  if (valueName === 'step') return '1';
  if (valueName === 'plaque.rows') return `row ${index + 1}`;
  if (valueName === 'pf.rows') return `PF row ${index + 1}`;
  if (valueName === 'rewrite.rows') return `input ${index + 1} -> output ${index + 1}`;
  if (valueName === 'correspondence.rows') return `pf.sources ${index + 1} => pf.exponents ${index + 1}`;
  if (valueName === 'order.rows') return recipe.id === 'pf.local-dislocation'
    ? index === 0 ? 'a b' : '[a b]' : index === 0 ? 'a < b' : 'b < c';
  if (valueName === 'delink.position') return 'feature.hierarchy 1';

  const tokenCheck = recipe.checks.find((check) => (
    check.kind === 'value-token' && check.value === valueName
  ));
  if (tokenCheck) return tokenCheck.tokens[0];
  return `${valueName} ${index + 1}`;
};

// Task 4 locks the reviewed recipe declarations independently. This generator
// verifies that each declared contract is executable through the real evaluator.
const buildFacetFixture = (recipe, options = {}) => {
  const counts = new Map();
  recipe.anchors.forEach((requirement) => {
    const largeMinimum = recipe.checks
      .filter((check) => check.kind === 'large-array' && check.role === requirement.role)
      .reduce((maximum, check) => Math.max(maximum, check.min), 0);
    counts.set(requirement.role, Math.max(requirement.min, largeMinimum));
  });
  recipe.checks
    .filter((check) => check.kind === 'paired-cardinality')
    .forEach((check) => {
      const count = Math.max(...check.roles.map((role) => counts.get(role) ?? 1));
      check.roles.forEach((role) => counts.set(role, count));
    });

  const currentAnchors = {};
  const priorAnchors = {};
  recipe.anchors.forEach((requirement) => {
    const target = requirement.source === 'prior' ? priorAnchors : currentAnchors;
    target[requirement.role] = idsFor(requirement.role, counts.get(requirement.role) ?? 1);
  });

  const values = {};
  recipe.values.forEach((requirement) => {
    const count = Math.max(requirement.min, 1);
    values[requirement.value] = Array.from(
      { length: count },
      (_, index) => valueLiteral(recipe, requirement.value, index)
    );
  });
  if (options.movementRoute) values['movement.route'] = [options.movementRoute];
  // Orders are node lists: the current order in anchors, the prior order in
  // priorAnchors, both resolvable in their stage.
  if (recipe.id === 'pf.linearization') {
    currentAnchors.order = idsFor('order', 2);
    priorAnchors.order = [...currentAnchors.order].reverse();
  }
  // Per-item literals pair with an anchor list through a same-name entry.
  recipe.checks
    .filter((check) => check.kind === 'paired-values')
    .forEach((check) => {
      if ((counts.get(check.role) ?? 1) > 1 && values[check.value]) {
        values[check.role] = values[check.value];
        delete values[check.value];
      }
    });

  const currentNodes = new Map(
    Object.values(currentAnchors).flat().map((id) => [id, leaf(id)])
  );
  const priorNodes = new Map(
    Object.values(priorAnchors).flat().map((id) => [id, leaf(id)])
  );
  const attached = new Set();
  let syntheticIndex = 0;

  const attach = (parent, child) => {
    if (!parent.children.some((candidate) => candidate.id === child.id)) {
      parent.children.push(child);
    }
    attached.add(child.id);
  };

  recipe.checks.forEach((check) => {
    const current = (role) => (currentAnchors[role] ?? []).map((id) => currentNodes.get(id));
    switch (check.kind) {
      case 'movement-evidence':
        current('movement.landing').forEach(member => { member.label = 'DP'; });
        break;
      case 'contains': {
        current(check.containerRole).forEach(container =>
          current(check.memberRole).forEach((member) => attach(container, member)));
        break;
      }
      case 'contains-authored-silent':
      case 'authored-trace-or-gap':
        current(check.role).forEach((member) => {
          member.silent = true;
          member.label = 't';
          delete member.word;
        });
        break;
      case 'shared-lineage':
      case 'shared-root-lineage':
        check.roles.flatMap(current).forEach((member) => {
          member.lineageId = `lineage_${recipe.id}`;
        });
        break;
      case 'multiple-parents': {
        const parents = current('parents');
        current(check.role).forEach((member) => {
          parents.slice(0, check.minParents).forEach((parent) => attach(parent, member));
        });
        break;
      }
      case 'shared-native-parent': {
        const sharedParent = node(`synthetic_shared_parent_${syntheticIndex += 1}`);
        check.roles.flatMap(current).forEach((member) => attach(sharedParent, member));
        currentNodes.set(sharedParent.id, sharedParent);
        break;
      }
      case 'siblings-within-domain': {
        const siblingParent = node(`synthetic_siblings_${syntheticIndex += 1}`);
        current(check.leftRole).forEach((member) => attach(siblingParent, member));
        current(check.rightRole).forEach((member) => attach(siblingParent, member));
        attach(current(check.domainRole)[0], siblingParent);
        break;
      }
      case 'native-parent-branch': {
        current(check.role).forEach((member) => {
          const parent = node(`synthetic_parent_${syntheticIndex += 1}`);
          attach(parent, member);
          currentNodes.set(parent.id, parent);
        });
        break;
      }
      case 'projection-chain': {
        const chain = [...current('accent.bearer'), ...current('projection.nodes')];
        chain.slice(1).forEach((parent, index) => attach(parent, chain[index]));
        break;
      }
      case 'transfer-configuration': {
        const [phase] = current('phase');
        [...current('phase.head'), ...current('phase.edge'), ...current('transfer.domain')].forEach(member => attach(phase, member));
        break;
      }
      case 'movement-carrier': {
        attach(current('movement.carrier')[0], current('movement.source')[0]);
        break;
      }
      case 'rebracketing-configuration': {
        // The prior tree groups the sequence differently; terminal order is unchanged.
        const members = current('sequence');
        const group = node(`synthetic_prior_group_${syntheticIndex += 1}`, members.map((member) => structuredClone(member)));
        priorNodes.set(group.id, group);
        break;
      }
      case 'distinct':
      case 'paired-cardinality':
      case 'value-token':
      case 'accepted-outcome':
      case 'active-lens':
      case 'parent-facet-complete':
      case 'large-array':
        break;
    }
  });

  const topLevel = [...currentNodes.values()].filter((member) => !attached.has(member.id));
  let currentForest;
  if (options.crossWorkspace) {
    const [sourceId] = currentAnchors['movement.source'];
    const [landingId] = currentAnchors['movement.landing'];
    const source = currentNodes.get(sourceId);
    const landing = currentNodes.get(landingId);
    const remainder = topLevel.filter((member) => member !== source && member !== landing);
    currentForest = [
      node('workspace_source', [source]),
      node('workspace_landing', [landing, ...remainder])
    ];
  } else {
    currentForest = [node(`root_${recipe.id}`, topLevel)];
  }
  const priorForest = priorNodes.size > 0
    ? [node(`prior_root_${recipe.id}`, [...priorNodes.values()])]
    : [];

  const relation = {
    relation: `UnknownFacet:${recipe.id}`,
    anchors: Object.fromEntries(
      Object.entries(currentAnchors).map(([role, ids]) => [role, scalarOrArray(ids)])
    ),
    ...(Object.keys(priorAnchors).length > 0
      ? {
          priorAnchors: Object.fromEntries(
            Object.entries(priorAnchors).map(([role, ids]) => [role, scalarOrArray(ids)])
          )
        }
      : {}),
    ...(Object.keys(values).length > 0
      ? {
          values: Object.fromEntries(
            Object.entries(values).map(([name, literals]) => [name, scalarOrArray(literals)])
          )
        }
      : {})
  };

  return {
    relation,
    currentForest,
    priorForest,
    activeLens: true
  };
};

const evaluateFixture = (recipe, fixture) => {
  const evidence = buildTier2FacetEvidence({
    relation: fixture.relation,
    currentForest: fixture.currentForest,
    priorForest: fixture.priorForest,
    activeLens: fixture.activeLens
  });
  const evaluationEvidence = {
    ...evidence,
    parentFacetComplete: true
  };
  return {
    evidence: evaluationEvidence,
    evaluation: evaluateTier2FacetRecipe(recipe, evaluationEvidence)
  };
};

const compileFixture = (recipe, fixture) => {
  const { evidence, evaluation } = evaluateFixture(recipe, fixture);
  const parentFacetIdentities = recipe.outputIdentity.kind === 'inherit-parent'
    ? [JSON.stringify({ facet: 'task-9-parent-fixture', currentAnchors: {} })]
    : undefined;
  const identityInput = {
    recipe,
    evaluation,
    evidence,
    authoredStageIndex: 0,
    ...(parentFacetIdentities ? { parentFacetIdentities } : {})
  };
  const facetIdentity = buildTier2FacetIdentity(identityInput);
  assert.ok(facetIdentity, `${recipe.id} fixture has no facet identity`);
  const resolvedFacet = {
    recipe,
    evaluation,
    facetIdentity,
    outputIdentities: buildTier2FacetOutputIdentities(identityInput),
    parentFacetIds: []
  };
  const relationRef = {
    stageIndex: 0,
    relationIndex: 0,
    relation: fixture.relation.relation,
    anchors: fixture.relation.anchors,
    ...(fixture.relation.priorAnchors ? { priorAnchors: fixture.relation.priorAnchors } : {}),
    ...(fixture.relation.values ? { values: fixture.relation.values } : {})
  };
  const compiled = compileTier2RelationOutputs({
    relation: fixture.relation,
    relationRef,
    dispatch: {
      evidence,
      tier: 2,
      outcome: 'tier-2',
      facets: [resolvedFacet],
      diagnostics: []
    },
    currentForest: fixture.currentForest,
    priorForest: fixture.priorForest,
    activeLens: fixture.activeLens
  });
  return { evaluation, compiled };
};

const withoutTier2Metadata = (item) => Object.fromEntries(
  Object.entries(item).filter(([key]) => !key.startsWith('tier2'))
);

const planForItems = (items) => ({
  registryVersion: 'task-9',
  frames: [{ stageIndex: 0, items }],
  diagnostics: [],
  unregistered: []
});

const pointFor = (nodeId, attachment = 'position') => {
  const seed = [...`${nodeId}:${attachment}`]
    .reduce((total, character) => total + character.codePointAt(0), 0);
  return { x: 40 + (seed % 700), y: 40 + ((seed * 17) % 420) };
};

test('every declared Tier-2 alias resolves to the complete deterministic candidate set', () => {
  const groups = [...TIER2_ROLE_SYNONYMS, ...TIER2_VALUE_SYNONYMS];
  const index = buildTier2SynonymIndex();

  groups.forEach((group) => {
    group.aliases.forEach((alias) => {
      const normalized = normalizeTier2Synonym(alias);
      const expected = groups
        .filter((candidate) => (
          candidate.scope === group.scope
          && candidate.aliases.some((entry) => normalizeTier2Synonym(entry) === normalized)
        ))
        .map((candidate) => candidate.concept)
        .sort((left, right) => left.localeCompare(right, 'en-US'));
      assert.deepEqual(
        lookupTier2SynonymCandidates(index, group.scope, alias),
        expected,
        `${group.scope} alias ${JSON.stringify(alias)} lost or selected a candidate by order`
      );
    });
  });
});

test('every Tier-2 facet has a provider-free complete and incomplete form', () => {
  assert.equal(TIER2_FACET_RECIPES.length, 52, 'the reviewed facet inventory changed');
  TIER2_FACET_RECIPES.forEach((recipe) => {
    const fixture = buildFacetFixture(recipe);
    const complete = evaluateFixture(recipe, fixture).evaluation;
    assert.equal(complete.complete, true, `${recipe.id}: ${complete.failures.join(', ')}`);
    assert.ok(complete.outputs.length > 0, `${recipe.id} emitted no visual piece`);

    const incompleteFixture = structuredClone(fixture);
    const requiredAnchor = recipe.anchors.find((requirement) => !requirement.optional);
    if (requiredAnchor) {
      delete incompleteFixture.relation.anchors[requiredAnchor.role];
      if (incompleteFixture.relation.priorAnchors) {
        delete incompleteFixture.relation.priorAnchors[requiredAnchor.role];
      }
    } else {
      incompleteFixture.activeLens = false;
    }
    const incomplete = evaluateFixture(recipe, incompleteFixture).evaluation;
    assert.equal(incomplete.complete, false, `${recipe.id} accepted its incomplete form`);
    assert.deepEqual(incomplete.outputs, [], `${recipe.id} drew from incomplete evidence`);
  });
});

test('all recipes reject absent or unresolved required participants, independently of the other fields', () => {
  for (const recipe of TIER2_FACET_RECIPES) {
    const fixture = buildFacetFixture(recipe);
    assert(evaluateFixture(recipe, fixture).evaluation.complete, recipe.id);
    for (const requirement of recipe.anchors.filter(r => !r.optional)) {
      const field = requirement.source === 'prior' ? 'priorAnchors' : 'anchors';
      for (const replacement of [undefined, 'not-in-either-stage']) {
        const changed = structuredClone(fixture);
        if (replacement === undefined) delete changed.relation[field][requirement.role];
        else changed.relation[field][requirement.role] = replacement;
        const result = evaluateFixture(recipe, changed).evaluation;
        assert(!result.complete, `${recipe.id}: ${field}.${requirement.role}=${replacement}`);
        assert(result.failures.some(f => f.startsWith('anchor:')), recipe.id);
      }
    }
  }
});

test('all recipes preserve interpretation under field reordering and unrelated open relation names', () => {
  for (const recipe of TIER2_FACET_RECIPES) {
    const fixture = buildFacetFixture(recipe);
    const before = structuredClone(fixture);
    const original = evaluateFixture(recipe, fixture).evaluation;
    const changed = structuredClone(fixture);
    changed.relation.relation = 'Unfamiliar authored description';
    for (const field of ['anchors', 'priorAnchors', 'values']) {
      if (changed.relation[field]) changed.relation[field] = Object.fromEntries(Object.entries(changed.relation[field]).reverse());
    }
    const reordered = evaluateFixture(recipe, changed).evaluation;
    assert.equal(reordered.complete, original.complete, recipe.id);
    assert.deepEqual(reordered.outputs, original.outputs, recipe.id);
    assert.deepEqual(reordered.earnedTransitions, original.earnedTransitions, recipe.id);
    assert.deepEqual(fixture, before, `${recipe.id}: evaluation mutated the authored evidence`);
  }
});

test('every recipe diagnoses competing groups in all evidence it uses', () => {
  for (const recipe of TIER2_FACET_RECIPES) {
    const { evidence, evaluation } = evaluateFixture(recipe, buildFacetFixture(recipe));
    assert(evaluation.complete, `${recipe.id}: ${evaluation.failures.join(', ')}`);
    for (const [field, entriesKey, concepts] of [
      ['anchors', 'authoredCurrentAnchors', recipe.anchors.filter(r => r.source !== 'prior').map(r => r.role)],
      ['priorAnchors', 'authoredPriorAnchors', recipe.anchors.map(r => r.role)],
      ['values', 'authoredValues', recipe.values.map(r => r.value)]
    ]) {
      for (const concept of new Set(concepts)) {
        if (field === 'values' ? ['plaque.rows', 'pf.rows'].includes(concept)
          : ['phase.edge', 'large.anchor.array'].includes(concept)) continue;
        const original = evidence[entriesKey]?.find(entry => entry.concepts.includes(concept));
        if (!original) continue;
        const items = original.conceptItemIndices?.[concept]?.map(index => original.items[index]) ?? original.items;
        if (!items.length) continue;
        const changed = structuredClone(evidence);
        changed[entriesKey].push({ key: 'competing authored group', concepts: [concept], items: [...items, items[0]] });
        const result = evaluateTier2FacetRecipe(recipe, changed);
        assert(!result.complete, `${recipe.id}: ${field}.${concept}`);
        assert.deepEqual(result.outputs, []);
        assert(result.failures.some(f => f.startsWith(`ambiguous-group:${field}:${concept}:`)), `${recipe.id}: ${result.failures}`);
        assert.deepEqual(result.consumedEvidence, []);
      }
    }
  }
});

test('all required value fields are necessary and unknown additions remain attached to the original relation', () => {
  for (const recipe of TIER2_FACET_RECIPES) {
    const fixture = buildFacetFixture(recipe);
    for (const requirement of recipe.values.filter(r => !r.optional)) {
      const changed = structuredClone(fixture);
      delete changed.relation.values[requirement.value];
      recipe.checks
        .filter((check) => check.kind === 'paired-values' && check.value === requirement.value)
        .forEach((check) => delete changed.relation.values[check.role]);
      assert(!evaluateFixture(recipe, changed).evaluation.complete, `${recipe.id}: missing ${requirement.value}`);
    }
    const changed = structuredClone(fixture);
    changed.relation.anchors.unfamiliarWitness = changed.currentForest[0].id;
    changed.relation.values = { ...changed.relation.values, unfamiliarDetail: ['preserve this', 'and this'] };
    const dispatch = dispatchRelationClaims({ ...changed, stageIndex: 1, relationIndex: 0 });
    assert.deepEqual(dispatch.evidenceCoverage.authoredRelation, changed.relation, recipe.id);
    for (const key of ['unfamiliarWitness', 'unfamiliarDetail']) {
      const field = dispatch.evidenceCoverage.fields.find(f => f.key === key);
      assert.deepEqual(field.recognizedBy, [], recipe.id);
      assert.deepEqual(field.unrecoveredItemIndices, key === 'unfamiliarDetail' ? [0, 1] : [0], recipe.id);
    }
    const expected = evaluateFixture(recipe, fixture).evaluation;
    const actual = evaluateFixture(recipe, changed).evaluation;
    assert.deepEqual(actual.outputs, expected.outputs, recipe.id);
    assert.deepEqual(actual.earnedTransitions, expected.earnedTransitions, recipe.id);
  }
});

test('every Tier-2 claim survives exclusive dispatch and reaches shared production lowering', () => {
  const failures = [];

  TIER2_FACET_RECIPES
    .filter((recipe) => recipe.kind === 'claim')
    .forEach((recipe) => {
      const fixture = buildFacetFixture(recipe);
      const dispatch = dispatchRelationClaims({
        relation: fixture.relation,
        stageIndex: fixture.priorForest.length > 0 ? 1 : 0,
        relationIndex: 0,
        currentForest: fixture.currentForest,
        ...(fixture.priorForest.length > 0 ? { priorForest: fixture.priorForest } : {}),
        activeLens: fixture.activeLens
      });
      const selected = dispatch.facets.find((facet) => facet.recipe.id === recipe.id);
      if (!selected) {
        failures.push({
          recipe: recipe.id,
          claimTiers: dispatch.claims.map(({ tier }) => tier),
          selected: dispatch.facets.map((facet) => facet.recipe.id),
          diagnostics: dispatch.diagnostics
        });
        return;
      }

      const priorStage = {
        statement: 'prior',
        stageRecord: 'prior',
        relations: [],
        workspaceForest: fixture.priorForest
      };
      const currentStage = {
        statement: 'current',
        stageRecord: 'current',
        relations: [fixture.relation],
        workspaceForest: fixture.currentForest
      };
      const frameIndex = fixture.priorForest.length > 0 ? 1 : 0;
      const plan = compileRelationRenderPlan(
        fixture.priorForest.length > 0 ? [priorStage, currentStage] : [currentStage],
        { activeLens: fixture.activeLens }
      );
      const items = plan.frames[frameIndex].items.filter(
        (item) => item.tier2FacetId === recipe.id
      );
      const loweredPieces = new Set(items.flatMap((item) => item.tier2OutputPieces ?? []));
      selected.evaluation.outputs.forEach((piece) => {
        if (!loweredPieces.has(piece)) {
          failures.push({
            recipe: recipe.id,
            missingPiece: piece,
            loweredPieces: [...loweredPieces],
            diagnostics: plan.diagnostics
          });
        }
      });
    });

  assert.deepEqual(failures, []);
});

test('every movement geometry variant traverses exclusive dispatch and production lowering', () => {
  const movementRecipe = TIER2_FACET_RECIPES.find((recipe) => recipe.id === 'movement.path');
  assert.ok(movementRecipe);
  const variants = [
    {
      piece: 'Orthogonal movement',
      fixture: buildFacetFixture(movementRecipe, { movementRoute: 'orthogonal' })
    },
    {
      piece: 'Cross-workspace crest',
      fixture: buildFacetFixture(movementRecipe, { crossWorkspace: true })
    }
  ];

  variants.forEach(({ piece, fixture }) => {
    const dispatch = dispatchRelationClaims({
      relation: fixture.relation,
      stageIndex: 0,
      relationIndex: 0,
      currentForest: fixture.currentForest
    });
    assert.ok(dispatch.claims.every(({ tier }) => tier === 2));
    const movement = dispatch.facets.find((facet) => facet.recipe.id === 'movement.path');
    assert.ok(movement?.evaluation.outputs.includes(piece), `${piece} did not survive dispatch`);

    const plan = compileRelationRenderPlan([{
      statement: 'current',
      stageRecord: 'current',
      relations: [fixture.relation],
      workspaceForest: fixture.currentForest
    }]);
    const loweredPieces = new Set(
      plan.frames[0].items.flatMap((item) => item.tier2OutputPieces ?? [])
    );
    assert.ok(loweredPieces.has(piece), `${piece} did not reach production lowering`);
  });
});

test('all 69 audited primitives lower through production and Tier-2 metadata changes no bound drawing data', () => {
  assert.equal(
    TIER2_VISUAL_PRIMITIVE_NAMES.length,
    69,
    'the reviewed visual-piece inventory changed'
  );
  const fixtures = TIER2_FACET_RECIPES.map((recipe) => ({
    recipe,
    fixture: buildFacetFixture(recipe)
  }));
  const movementRecipe = TIER2_FACET_RECIPES.find((recipe) => recipe.id === 'movement.path');
  assert.ok(movementRecipe);
  fixtures.push(
    {
      recipe: movementRecipe,
      fixture: buildFacetFixture(movementRecipe, { movementRoute: 'orthogonal' })
    },
    {
      recipe: movementRecipe,
      fixture: buildFacetFixture(movementRecipe, { crossWorkspace: true })
    }
  );

  const observedPieces = new Set();
  fixtures.forEach(({ recipe, fixture }) => {
    const { evaluation, compiled } = compileFixture(recipe, fixture);
    assert.deepEqual(compiled.diagnostics, [], `${recipe.id} emitted compiler diagnostics`);
    assert.ok(compiled.items.length > 0, `${recipe.id} lowered no production plan item`);
    const loweredPieces = new Set(
      compiled.items.flatMap((item) => item.tier2OutputPieces ?? [])
    );
    evaluation.outputs.forEach((piece) => {
      observedPieces.add(piece);
      assert.ok(loweredPieces.has(piece), `${recipe.id} did not lower ${piece}`);
    });

    const tier2Bound = bindRelationPlanFrame(planForItems(compiled.items), 0, pointFor);
    const sharedBound = bindRelationPlanFrame(
      planForItems(compiled.items.map(withoutTier2Metadata)),
      0,
      pointFor
    );
    assert.deepEqual(
      tier2Bound,
      sharedBound,
      `${recipe.id} Tier-2 metadata changed production geometry`
    );
  });

  assert.deepEqual(
    [...observedPieces].sort(),
    [...TIER2_VISUAL_PRIMITIVE_NAMES].sort(),
    'every audited visual piece must have a provider-free lowering proof'
  );
});

test('equivalent Tier-1 and Tier-2 movement evidence binds to identical production geometry', () => {
  const recipe = TIER2_FACET_RECIPES.find((entry) => entry.id === 'movement.path');
  assert.ok(recipe);
  const fixture = buildFacetFixture(recipe);
  const source = fixture.relation.anchors['movement.source'];
  const witness = fixture.relation.anchors['movement.witness'];
  const landing = fixture.relation.anchors['movement.landing'];
  const stage = (relation) => ({
    statement: 'statement',
    stageRecord: 'record',
    relations: [relation],
    workspaceForest: fixture.currentForest
  });
  const tier1Plan = compileRelationRenderPlan([stage({
    relation: 'AbarMove',
    anchors: {
      lowerCopy: source,
      traceWitness: witness,
      pronouncedCopy: landing
    }
  })]);
  const tier2Plan = compileRelationRenderPlan([stage(fixture.relation)]);

  assert.equal(tier1Plan.frames[0].items[0].tier2FacetId, undefined);
  assert.equal(tier2Plan.frames[0].items[0].tier2FacetId, 'movement.path');
  assert.deepEqual(
    bindRelationPlanFrame(tier2Plan, 0, pointFor).primitives,
    bindRelationPlanFrame(tier1Plan, 0, pointFor).primitives
  );
});

test('independent multi-stage Tier-2 plaques stack at one stable anchor', () => {
  const forest = [node('same_anchor_root', [leaf('same_anchor')])];
  const plaque = (relation, row) => ({
    relation,
    anchors: { 'plaque anchor': 'same_anchor' },
    values: { 'plaque rows': row }
  });
  const plan = compileRelationRenderPlan([
    {
      statement: 'first plaque',
      stageRecord: 'first plaque',
      relations: [plaque('UnknownFirstPlaque', 'first: alpha')],
      workspaceForest: forest
    },
    {
      statement: 'second plaque',
      stageRecord: 'second plaque',
      relations: [plaque('UnknownSecondPlaque', 'second: beta')],
      workspaceForest: forest
    }
  ]);

  const frame = plan.frames[1];
  const plaques = bindRelationPlanFrame(plan, 1, pointFor).primitives
    .filter((primitive) => primitive.type === 'plaque');
  assert.equal(frame.items.filter((item) => item.tier2FacetId === 'plaque.structured').length, 2);
  assert.equal(plaques.length, 2);
  assert.ok(
    plaques[0].y + plaques[0].height <= plaques[1].y
      || plaques[1].y + plaques[1].height <= plaques[0].y,
    'persisted plaques at one anchor must not overlap'
  );
});

test('every executable canonical Atlas card remains entirely Tier 1', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent'
  });

  try {
    const { canonicalCases } = await server.ssrLoadModule(
      '/docs/design/visual-relations-current-lab.tsx'
    );
    assert.equal(canonicalCases.length, 55, 'the canonical Atlas inventory changed unexpectedly');
    assert.equal(
      canonicalCases.some(({ title }) => [
        'Ellipsis / Sluicing',
        'Remnant Escape / Pseudogapping',
        'Remnant Escape / Gapping'
      ].includes(title)),
      false,
      'construction compositions stay executable research fixtures, not public canonical cards'
    );

    canonicalCases.forEach((card) => {
      const context = `${card.archetype} ${card.title}`;
      assert.deepEqual(card.unregistered, [], `${context} has an unregistered relation`);

      const plan = compileRelationRenderPlan(card.rendererStages);
      assert.deepEqual(plan.unregistered, [], `${context} left exclusive Tier-1 dispatch`);
      assert.deepEqual(plan.diagnostics, [], `${context} emitted production diagnostics`);
      plan.frames.flatMap((frame) => frame.items).forEach((item) => {
        assert.notEqual(item.kind, 'fallback', `${context} compiled fallback pixels`);
        assert.equal(item.tier2FacetId, undefined, `${context} dispatched through Tier 2`);
      });
    });
  } finally {
    await server.close();
  }
});

test('cross-family combinations preserve claims or expose a specific ambiguity without losing evidence', () => {
  const prefix = (fixture, prefix) => {
    const copy = structuredClone(fixture);
    const visited = new WeakSet();
    const visit = node => {
      if (visited.has(node)) return;
      visited.add(node);
      node.id = prefix + node.id;
      if (node.lineageId) node.lineageId = prefix + node.lineageId;
      (node.children || []).forEach(visit);
    };
    copy.currentForest.forEach(visit);
    copy.priorForest.forEach(visit);
    for (const field of ['anchors', 'priorAnchors']) {
      if (!copy.relation[field]) continue;
      copy.relation[field] = Object.fromEntries(Object.entries(copy.relation[field]).map(([key, ids]) =>
        [key, Array.isArray(ids) ? ids.map(id => prefix + id) : prefix + ids]));
    }
    return copy;
  };
  const claims = TIER2_FACET_RECIPES.filter(recipe => recipe.kind === 'claim');
  const counts = { complete: 0, competingRoles: 0, competingStages: 0, includedByLargerDrawing: 0 };
  for (let a = 0; a < claims.length; a++) for (let b = a + 1; b < claims.length; b++) {
    const left = prefix(buildFacetFixture(claims[a]), 'left:');
    const right = prefix(buildFacetFixture(claims[b]), 'right:');
    const fields = ['anchors', 'priorAnchors', 'values'];
    if (fields.some(field => Object.keys(left.relation[field] || {}).some(key => Object.hasOwn(right.relation[field] || {}, key)))) continue;
    const fixture = {
      relation: { relation: 'Two independent authored claims', ...Object.fromEntries(fields.map(field =>
        [field, { ...left.relation[field], ...right.relation[field] }])) },
      currentForest: [...left.currentForest, ...right.currentForest],
      priorForest: [...left.priorForest, ...right.priorForest], activeLens: true, stageIndex: 1, relationIndex: 0
    };
    const original = structuredClone(fixture);
    const result = dispatchRelationClaims(fixture);
    const missing = [claims[a], claims[b]].filter(recipe => !result.facets.some(facet => facet.recipe.id === recipe.id));
    const failures = missing.flatMap(recipe => evaluateFixture(recipe, fixture).evaluation.failures);
    const context = `${claims[a].id} + ${claims[b].id}`;
    if (!missing.length) counts.complete++;
    else if (failures.length && failures.every(failure => failure.startsWith('ambiguous-group:'))) counts.competingRoles++;
    else if (failures.length === 1 && failures[0] === 'anchor:either:rewrite.input:cardinality:2,expected:1..1') counts.competingStages++;
    else {
      assert.deepEqual(missing.map(recipe => recipe.id), ['phase.edge'], context);
      assert.ok(result.facets.some(facet => facet.recipe.id === 'transfer.domain'), context);
      assert.ok(result.diagnostics.some(diagnostic => diagnostic.collision === 'transfer-owns-edge'), context);
      counts.includedByLargerDrawing++;
    }
    for (const field of result.evidenceCoverage.fields) {
      const values = fixture.relation[field.field][field.key];
      const length = Array.isArray(values) ? values.length : 1;
      const accounted = new Set([...field.recognizedBy.flatMap(claim => claim.itemIndices), ...field.unrecoveredItemIndices]);
      assert.equal(accounted.size, length, `${context}: ${field.field}.${field.key}`);
    }
    const reversed = { ...fixture, relation: { relation: fixture.relation.relation,
      ...Object.fromEntries(fields.map(field => [field, Object.fromEntries(Object.entries(fixture.relation[field]).reverse())])) } };
    assert.deepEqual(dispatchRelationClaims(reversed).facets.map(f => f.recipe.id).sort(), result.facets.map(f => f.recipe.id).sort(), context);
    assert.deepEqual(fixture, original, context);
  }
  // These are interpreter controls. In particular, the legacy sharing fixtures
  // do not establish admission under the public single-position ID contract.
  assert.deepEqual(counts, { complete: 1070, competingRoles: 37, competingStages: 1, includedByLargerDrawing: 1 });
});

test('legacy sharing topology controls are not valid public single-position trees', async () => {
  const { __test__ } = await import('../server/babelParser.js');
  for (const id of ['multidominance', 'argument-sharing']) {
    const fixture = buildFacetFixture(TIER2_FACET_RECIPES.find(recipe => recipe.id === id));
    const stages = [{ statement: 'Sharing control.', stageRecord: 'Topology-only control.',
      relations: [fixture.relation], workspaceForest: fixture.currentForest }];
    const inspected = __test__.inspectDerivationWorkspaces(stages);
    assert.ok(inspected[0].anchorChecks.some(check => check.status === 'duplicate'), id);
    assert.throws(() => __test__.normalizeParseBundle({ derivationStages: stages }, 'xbar', 'word', 'claude', true),
      error => error.failure.ruleId === 'DERIVATION_WORKSPACE_VALID', id);
  }
});
