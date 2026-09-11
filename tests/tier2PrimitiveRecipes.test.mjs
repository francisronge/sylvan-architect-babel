import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { VISUAL_PRIMITIVE_SEARCH_SYNONYMS } from '../docs/design/visual-relations-primitive-search-synonyms.ts';
import { findRelationRegistryEntry } from '../replay/relationDispatch/relationRegistry.js';
import { productionRelationRegistry } from '../replay/relationDispatch/productionRegistry.js';
import { OUTCOME_CONCEPTS } from '../replay/relations/outcomeResolver.ts';
import {
  TIER2_FACET_ACCEPTED_OUTCOME_CONCEPTS,
  TIER2_FACET_RECIPE_BY_ID,
  TIER2_FACET_RECIPES,
  TIER2_VISUAL_PRIMITIVE_NAMES,
  buildTier2FacetIdentity,
  buildTier2FacetOutputIdentities,
  evaluateTier2FacetRecipe
} from '../replay/relations/tier2FacetRecipes.ts';
import {
  TIER2_ROLE_SYNONYMS,
  TIER2_VALUE_SYNONYMS,
  buildTier2SynonymIndex,
  lookupTier2SynonymCandidates,
  normalizeTier2Synonym
} from '../replay/relations/tier2Synonyms.ts';

const vocabularySourceUrl = new URL(
  '../docs/design/visual-relations-vocabulary.tsx',
  import.meta.url
);
const tier2SpecUrl = new URL(
  '../docs/design/visual-relations-tier2-shape-dispatch-spec.md',
  import.meta.url
);
const tier2SynonymSourceUrl = new URL(
  '../replay/relations/tier2Synonyms.ts',
  import.meta.url
);

const readVocabularyNames = async () => {
  const source = await readFile(vocabularySourceUrl, 'utf8');
  const list = source.match(/export const visualPrimitiveNames: PrimitiveName\[\] = \[([\s\S]*?)\n\];/u);
  assert.ok(list, 'visualPrimitiveNames must remain statically inspectable');
  return Array.from(list[1].matchAll(/'([^']+)'/gu), (match) => match[1]);
};

const readFacetOwnershipAudit = async () => {
  const source = await readFile(tier2SpecUrl, 'utf8');
  const audit = source.match(
    /<!-- tier2-piece-audit:start -->([\s\S]*?)<!-- tier2-piece-audit:end -->/u
  );
  assert.ok(audit, 'the Tier-2 specification must contain the visual-piece ownership audit');

  return Array.from(
    audit[1].matchAll(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \|$/gmu),
    (match) => ({
      facet: match[1],
      kind: match[2].trim(),
      pieces: Array.from(match[3].matchAll(/`([^`]+)`/gu), (piece) => piece[1])
    })
  );
};

const facet = (id) => {
  const entry = TIER2_FACET_RECIPE_BY_ID.get(id);
  assert.ok(entry, `missing facet recipe ${id}`);
  return entry;
};

const leaf = (id, word, extras = {}) => ({ id, label: 'X', word, ...extras });
const node = (id, label, children = [], extras = {}) => ({ id, label, children, ...extras });
const evidence = ({ currentAnchors, currentForest, priorAnchors, priorForest, values = {}, ...rest }) => ({
  currentAnchors,
  currentForest,
  ...(priorAnchors ? { priorAnchors } : {}),
  ...(priorForest ? { priorForest } : {}),
  values,
  ...rest
});

test('the complete Tier-2 recipes cover 69 primitives with only Branch overlay shared', async () => {
  const vocabularyNames = await readVocabularyNames();
  const ownedPieces = TIER2_FACET_RECIPES.flatMap((entry) => entry.outputs.map((output) => output.piece));
  const ownershipCounts = ownedPieces.reduce((counts, piece) => {
    counts.set(piece, (counts.get(piece) || 0) + 1);
    return counts;
  }, new Map());

  assert.equal(TIER2_VISUAL_PRIMITIVE_NAMES.length, 69);
  assert.equal(ownedPieces.length, 70);
  assert.equal(new Set(ownedPieces).size, 69);
  assert.equal(ownershipCounts.get('Branch overlay'), 2);
  assert.deepEqual(
    [...ownershipCounts.entries()].filter(([piece]) => piece !== 'Branch overlay'),
    [...ownershipCounts.entries()]
      .filter(([piece]) => piece !== 'Branch overlay')
      .map(([piece]) => [piece, 1])
  );
  assert.deepEqual([...new Set(ownedPieces)].sort(), [...TIER2_VISUAL_PRIMITIVE_NAMES].sort());
  assert.deepEqual(vocabularyNames, TIER2_VISUAL_PRIMITIVE_NAMES);
});

test('Pair Merge earns the shared branch overlay only for one native sibling fork', () => {
  const recipe = facet('pair-merge');
  const anchors = { host: ['host'], 'pair.member': ['member'] };
  const sharedFork = evaluateTier2FacetRecipe(recipe, evidence({
    currentAnchors: anchors,
    currentForest: [node('parent', 'XP', [leaf('host', 'Host'), leaf('member', 'Member')])]
  }));
  assert.equal(sharedFork.complete, true);
  assert.deepEqual(sharedFork.outputs, ['Branch overlay']);

  const separateBranches = evaluateTier2FacetRecipe(recipe, evidence({
    currentAnchors: anchors,
    currentForest: [
      node('left-parent', 'XP', [leaf('host', 'Host')]),
      node('right-parent', 'YP', [leaf('member', 'Member')])
    ]
  }));
  assert.equal(separateBranches.complete, false);
  assert.ok(separateBranches.failures.includes('check:shared-native-parent'));
});

test('the reviewed ownership audit matches the 52 executable facet recipes', async () => {
  const auditedFacets = await readFacetOwnershipAudit();
  const kindLabel = {
    claim: 'claim',
    'presentation-companion': 'presentation companion',
    'organizational-companion': 'organizational companion'
  };

  assert.equal(TIER2_FACET_RECIPES.length, 52);
  assert.equal(TIER2_FACET_RECIPE_BY_ID.size, 52);
  assert.equal(TIER2_FACET_RECIPES.filter((entry) => entry.kind === 'claim').length, 50);
  assert.deepEqual(
    auditedFacets,
    TIER2_FACET_RECIPES.map((entry) => ({
      facet: entry.id,
      kind: kindLabel[entry.kind],
      pieces: entry.outputs.map((output) => output.piece)
    }))
  );
});

test('every facet recipe declares complete executable evidence fields', () => {
  const knownPieces = new Set(TIER2_VISUAL_PRIMITIVE_NAMES);
  const knownRoles = new Set(TIER2_ROLE_SYNONYMS.map((entry) => entry.concept));
  const knownValues = new Set(TIER2_VALUE_SYNONYMS.map((entry) => entry.concept));

  TIER2_FACET_RECIPES.forEach((entry) => {
    assert.ok(entry.anchors.length > 0, `${entry.id} has no anchor requirements`);
    assert.ok(entry.outputs.length > 0, `${entry.id} has no outputs`);
    entry.anchors.forEach((requirement) => {
      assert.ok(knownRoles.has(requirement.role), `${entry.id} uses undeclared role ${requirement.role}`);
      assert.ok(requirement.min > 0, `${entry.id}:${requirement.role} has an invalid minimum`);
      if (requirement.max !== undefined) {
        assert.ok(requirement.max >= requirement.min, `${entry.id}:${requirement.role} has an invalid maximum`);
      }
    });
    entry.values.forEach((requirement) => {
      assert.ok(knownValues.has(requirement.value), `${entry.id} uses undeclared value ${requirement.value}`);
      assert.ok(requirement.min > 0, `${entry.id}:${requirement.value} has an invalid minimum`);
    });
    entry.checks.forEach((check) => {
      if (check.kind !== 'value-token') return;
      assert.ok(
        entry.values.some((requirement) => requirement.value === check.value),
        `${entry.id} checks undeclared value ${check.value}`
      );
      assert.ok(check.tokens.length > 0, `${entry.id}:${check.value} has no distinguishing tokens`);
      assert.equal(Object.hasOwn(check, 'match'), false, `${entry.id}:${check.value} uses the retired token-match policy`);
    });
    entry.outputs.forEach((output) => {
      assert.ok(knownPieces.has(output.piece), `${entry.id} owns unknown output ${output.piece}`);
      assert.ok(
        ['inherit-facet', 'while-active'].includes(output.persistence),
        `${entry.id}:${output.piece} has no output persistence policy`
      );
      if (output.gate.kind === 'value-present') {
        assert.ok(
          entry.values.some((requirement) => requirement.value === output.gate.value),
          `${entry.id}:${output.piece} gates on an undeclared value`
        );
      }
    });
  });
});

test('facet persistence and replacement are explicit and conservative', () => {
  const claims = TIER2_FACET_RECIPES.filter((entry) => entry.kind === 'claim');
  claims.forEach((entry) => {
    assert.deepEqual(
      entry.persistence,
      { kind: 'while-witnesses-resolve' },
      `${entry.id} must persist while its authored witnesses survive`
    );
    assert.deepEqual(
      entry.replacement,
      {
        kind: 'authored-prior-continuity',
        priorStage: 'immediate',
        requireCompleteResolution: true
      },
      `${entry.id} must require complete authored continuity before replacement`
    );
  });

  assert.deepEqual(facet('presentation.lens').persistence, { kind: 'while-active' });
  assert.deepEqual(facet('presentation.lens').replacement, { kind: 'none' });
  assert.deepEqual(facet('organization.large-anchor-set').persistence, { kind: 'inherit-parent' });
  assert.deepEqual(facet('organization.large-anchor-set').replacement, { kind: 'inherit-parent' });

  const outputOverrides = TIER2_FACET_RECIPES.flatMap((entry) => entry.outputs
    .filter((output) => output.persistence !== 'inherit-facet')
    .map((output) => [entry.id, output.piece, output.persistence]));
  assert.deepEqual(outputOverrides, []);

  const identity = evaluateTier2FacetRecipe(facet('identity.occurrences'), evidence({
    currentAnchors: { occurrences: ['lower', 'higher'] },
    currentForest: [
      leaf('lower', 't1', { lineageId: 'identity-lineage' }),
      leaf('higher', 'book', { lineageId: 'identity-lineage' })
    ],
    activeLens: false
  }));
  assert.deepEqual(identity.outputs, ['Coindex', 'Forest light']);
});

test('every facet declares whether output identity is complete or inherited', () => {
  TIER2_FACET_RECIPES
    .filter((entry) => entry.kind === 'claim')
    .forEach((entry) => assert.deepEqual(
      entry.outputIdentity,
      { kind: 'complete-facet-evidence', includeAuthoredMoment: true },
      `${entry.id} must key its visual pieces from complete facet evidence`
    ));
  TIER2_FACET_RECIPES
    .filter((entry) => entry.kind !== 'claim')
    .forEach((entry) => assert.deepEqual(
      entry.outputIdentity,
      { kind: 'inherit-parent' },
      `${entry.id} must inherit its parent facet identity`
    ));
});

test('facet output identity ignores relation provenance but preserves all normalized evidence and moment', () => {
  const movementRecipe = facet('movement.path');
  const movementEvidence = evidence({
    currentAnchors: {
      'movement.source': ['source'],
      'movement.witness': ['trace'],
      'movement.landing': ['landing']
    },
    currentForest: [node('root', 'TP', [
      node('source', 'DP', [leaf('trace', 't1', { silent: true, lineageId: 'chain' })], { lineageId: 'chain' }),
      node('landing', 'DP', [leaf('word', 'book', { lineageId: 'chain' })], { lineageId: 'chain' })
    ])],
    values: { outcome: ['licensed'] }
  });
  const movementEvaluation = evaluateTier2FacetRecipe(movementRecipe, movementEvidence);
  const first = buildTier2FacetOutputIdentities({
    recipe: movementRecipe,
    evaluation: movementEvaluation,
    evidence: movementEvidence,
    authoredStageIndex: 2
  });
  const second = buildTier2FacetOutputIdentities({
    recipe: movementRecipe,
    evaluation: movementEvaluation,
    evidence: movementEvidence,
    authoredStageIndex: 2
  });

  assert.deepEqual(first, second, 'relation name and relation index are not output identity');
  assert.deepEqual(first.map(({ piece }) => piece), ['Movement curve', 'Path states']);

  const blockedEvidence = evidence({
    ...movementEvidence,
    values: { outcome: ['blocked'] }
  });
  const blockedEvaluation = evaluateTier2FacetRecipe(movementRecipe, blockedEvidence);
  const blocked = buildTier2FacetOutputIdentities({
    recipe: movementRecipe,
    evaluation: blockedEvaluation,
    evidence: blockedEvidence,
    authoredStageIndex: 2
  });
  assert.notEqual(first[0].key, blocked[0].key, 'authored values remain meaning-bearing');

  const labeledEvidence = evidence({
    ...movementEvidence,
    values: { ...movementEvidence.values, label: ['movement one'] }
  });
  const labeled = buildTier2FacetOutputIdentities({
    recipe: movementRecipe,
    evaluation: evaluateTier2FacetRecipe(movementRecipe, labeledEvidence),
    evidence: labeledEvidence,
    authoredStageIndex: 2
  });
  assert.notEqual(first[0].key, labeled[0].key, 'extra authored values keep claims separate');

  const priorEvidence = evidence({
    ...movementEvidence,
    priorAnchors: { 'movement.source': ['prior-source'] },
    priorForest: [leaf('prior-source', 'book', { lineageId: 'chain' })]
  });
  const prior = buildTier2FacetOutputIdentities({
    recipe: movementRecipe,
    evaluation: evaluateTier2FacetRecipe(movementRecipe, priorEvidence),
    evidence: priorEvidence,
    authoredStageIndex: 2
  });
  assert.notEqual(first[0].key, prior[0].key, 'authored prior continuity keeps claims separate');

  const later = buildTier2FacetOutputIdentities({
    recipe: movementRecipe,
    evaluation: movementEvaluation,
    evidence: movementEvidence,
    authoredStageIndex: 3
  });
  assert.notEqual(first[0].key, later[0].key, 'a different authored moment remains a different operation');
});

test('companion output identity requires parents and preserves its own evidence', () => {
  const lensRecipe = facet('presentation.lens');
  const lensEvidence = evidence({
    currentAnchors: { 'facet.anchors': ['anchor'] },
    currentForest: [leaf('anchor', 'x')],
    activeLens: true,
    parentFacetComplete: true
  });
  const lensEvaluation = evaluateTier2FacetRecipe(lensRecipe, lensEvidence);
  assert.equal(buildTier2FacetIdentity({
    recipe: lensRecipe,
    evaluation: lensEvaluation,
    evidence: lensEvidence,
    authoredStageIndex: 0
  }), null);
  assert.equal(buildTier2FacetOutputIdentities({
    recipe: lensRecipe,
    evaluation: lensEvaluation,
    evidence: lensEvidence,
    authoredStageIndex: 0,
    parentFacetIdentities: ['parent-claim']
  })[0].piece, 'Lens emphasis');

  const otherLensEvidence = evidence({
    ...lensEvidence,
    currentAnchors: { 'facet.anchors': ['other-anchor'] },
    currentForest: [leaf('other-anchor', 'y')]
  });
  const firstLens = buildTier2FacetOutputIdentities({
    recipe: lensRecipe,
    evaluation: lensEvaluation,
    evidence: lensEvidence,
    authoredStageIndex: 0,
    parentFacetIdentities: ['parent-claim']
  });
  const otherLens = buildTier2FacetOutputIdentities({
    recipe: lensRecipe,
    evaluation: evaluateTier2FacetRecipe(lensRecipe, otherLensEvidence),
    evidence: otherLensEvidence,
    authoredStageIndex: 0,
    parentFacetIdentities: ['parent-claim']
  });
  assert.notEqual(firstLens[0].key, otherLens[0].key);
});

test('one complete operator-binding facet earns its own ranked scope hull', () => {
  const operatorBinding = evaluateTier2FacetRecipe(facet('operator-binding'), evidence({
    currentAnchors: {
      operator: ['operator'],
      variable: ['variable'],
      'scope.domain': ['domain']
    },
    currentForest: [node('domain', 'TP', [
      leaf('operator', 'every'),
      leaf('variable', 'their')
    ])]
  }));
  assert.deepEqual(operatorBinding.outputs, ['Ranked scope hulls', 'Variable-binding path']);
});

test('outcome policies are facet-local and include the reviewed landing-candidate set', () => {
  const outcomeFacets = TIER2_FACET_RECIPES
    .filter((entry) => entry.values.some((requirement) => requirement.value === 'outcome'));
  assert.deepEqual(
    Object.keys(TIER2_FACET_ACCEPTED_OUTCOME_CONCEPTS).sort(),
    outcomeFacets.map((entry) => entry.id).sort()
  );

  const known = new Set(OUTCOME_CONCEPTS);
  outcomeFacets.forEach((entry) => {
    assert.ok(entry.acceptedOutcomeConcepts.length > 0, `${entry.id} has no accepted outcomes`);
    entry.acceptedOutcomeConcepts.forEach((concept) => {
      assert.ok(known.has(concept), `${entry.id} accepts unknown outcome ${concept}`);
    });
  });

  assert.deepEqual(TIER2_FACET_ACCEPTED_OUTCOME_CONCEPTS['judgment.blocked'], ['blocked']);
  assert.ok(TIER2_FACET_ACCEPTED_OUTCOME_CONCEPTS['landing-candidates'].includes('illicit'));
  assert.ok(TIER2_FACET_ACCEPTED_OUTCOME_CONCEPTS['landing-candidates'].includes('violation'));
});

test('transition ownership is explicit and judgment facets own no tree change', () => {
  const transitionOwners = Object.fromEntries(
    TIER2_FACET_RECIPES
      .filter((entry) => entry.transitionRules.length > 0)
      .map((entry) => [entry.id, entry.transitionRules])
  );
  assert.deepEqual(transitionOwners, {
    'movement.path': [{ kind: 'movement', evidence: 'overt-movement-stage-difference' }],
    'movement.carrier': [{ kind: 'movement', evidence: 'overt-movement-stage-difference' }],
    'ellipsis.site': [{ kind: 'deletion', evidence: 'deletion-stage-difference' }],
    'deletion.site': [{ kind: 'deletion', evidence: 'deletion-stage-difference' }],
    'scope.movement': [{ kind: 'movement', evidence: 'covert-movement-stage-difference' }],
    'pf.structured': [{ kind: 'pronunciation', evidence: 'pronunciation-stage-difference' }],
    'pf.rewrite': [
      { kind: 'pronunciation', evidence: 'pronunciation-stage-difference' },
      { kind: 'rewrite', evidence: 'rewrite-stage-difference' }
    ],
    'pf.fission': [{ kind: 'fission', evidence: 'fission-stage-difference' }],
    'pf.impoverishment': [{ kind: 'rewrite', evidence: 'rewrite-stage-difference' }],
    'pf.local-dislocation': [{ kind: 'rebracketing', evidence: 'rebracketing-stage-difference' }]
  });

  [
    'locality.boundary',
    'transfer.access',
    'judgment.verdict',
    'landing-candidates',
    'judgment.blocked',
    'judgment.licensed',
    'intervention',
    'blocked-extraction'
  ].forEach((id) => assert.deepEqual(facet(id).transitionRules, [], `${id} must not own a transition`));
});

test('movement needs three real anchors, containment, and shared lineage', () => {
  const priorSource = node('source', 'DP', [leaf('word-before', 'book', { lineageId: 'word' })], { lineageId: 'chain' });
  const source = node('source', 'DP', [{ id: 'trace', label: 't1', silent: true, lineageId: 'word' }], { lineageId: 'chain' });
  const landing = node('landing', 'DP', [leaf('word-after', 'book', { lineageId: 'word' })], { lineageId: 'chain' });
  const currentForest = [node('cp', 'CP', [landing, node('vp', 'VP', [source])])];
  const priorForest = [node('vp-before', 'VP', [priorSource])];
  const completeEvidence = evidence({
    currentAnchors: {
      'movement.source': ['source'],
      'movement.witness': ['trace'],
      'movement.landing': ['landing']
    },
    currentForest,
    priorForest,
    values: { outcome: ['prevented'] }
  });

  const complete = evaluateTier2FacetRecipe(facet('movement.path'), completeEvidence);
  assert.equal(complete.complete, true);
  assert.equal(complete.outcomeConcept, 'blocked');
  assert.deepEqual(complete.outputs, ['Movement curve', 'Path states']);
  assert.deepEqual(complete.earnedTransitions, ['movement']);

  const incomplete = evaluateTier2FacetRecipe(facet('movement.path'), {
    ...completeEvidence,
    currentAnchors: {
      'movement.source': ['source'],
      'movement.landing': ['landing']
    }
  });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.outputs, []);
  assert.deepEqual(incomplete.earnedTransitions, []);
});

test('movement timing pairs the same lower terminal across stages', () => {
  const priorSource = node('source', 'DP', [
    { id: 'old-trace', label: 't1', silent: true, lineageId: 'old-gap', children: [] },
    leaf('word', 'book', { lineageId: 'word' })
  ], { lineageId: 'chain' });
  const currentSource = node('source', 'DP', [
    { id: 'old-trace', label: 't1', silent: true, lineageId: 'old-gap', children: [] },
    leaf('word', 'book', { lineageId: 'word' })
  ], { lineageId: 'chain' });
  const landing = node('landing', 'DP', [leaf('landing-word', 'book', { lineageId: 'word' })], { lineageId: 'chain' });
  const result = evaluateTier2FacetRecipe(facet('movement.path'), evidence({
    currentAnchors: {
      'movement.source': ['source'],
      'movement.witness': ['old-trace'],
      'movement.landing': ['landing']
    },
    currentForest: [node('cp', 'CP', [landing, node('vp', 'VP', [currentSource])])],
    priorForest: [node('vp-before', 'VP', [priorSource])]
  }));

  assert.equal(result.complete, true);
  assert.deepEqual(result.earnedTransitions, []);
});

test('movement geometry is selected from structure, not a relation name', () => {
  const source = node('source', 'DP', [{ id: 'trace', label: 't1', silent: true, lineageId: 'word' }], { lineageId: 'chain' });
  const landing = node('landing', 'DP', [leaf('word', 'book', { lineageId: 'word' })], { lineageId: 'chain' });
  const anchors = {
    'movement.source': ['source'],
    'movement.witness': ['trace'],
    'movement.landing': ['landing']
  };

  const orthogonal = evaluateTier2FacetRecipe(facet('movement.path'), evidence({
    currentAnchors: anchors,
    currentForest: [node('root', 'CP', [landing, source])],
    values: { 'movement.route': ['orthogonal'] }
  }));
  assert.deepEqual(orthogonal.outputs, ['Orthogonal movement']);

  const descriptiveRoute = evaluateTier2FacetRecipe(facet('movement.path'), evidence({
    currentAnchors: anchors,
    currentForest: [node('root', 'CP', [landing, source])],
    values: { 'movement.route': ['not orthogonal'] }
  }));
  assert.deepEqual(
    descriptiveRoute.outputs,
    ['Movement curve'],
    'route selection remains exact after normalization'
  );

  const crossWorkspace = evaluateTier2FacetRecipe(facet('movement.path'), evidence({
    currentAnchors: anchors,
    currentForest: [node('left-root', 'DP', [landing]), node('right-root', 'VP', [source])],
    values: {}
  }));
  assert.deepEqual(crossWorkspace.outputs, ['Cross-workspace crest']);
});

test('gap notation requires an authored trace or gap', () => {
  const trace = evaluateTier2FacetRecipe(facet('gap.notation'), evidence({
    currentAnchors: { gap: ['trace'] },
    currentForest: [node('dp', 'DP', [{ id: 'trace', label: 't2', silent: true }])]
  }));
  assert.equal(trace.complete, true);
  assert.deepEqual(trace.outputs, ['Gap label']);

  const overt = evaluateTier2FacetRecipe(facet('gap.notation'), evidence({
    currentAnchors: { gap: ['overt'] },
    currentForest: [node('dp', 'DP', [leaf('overt', 'book')])]
  }));
  assert.equal(overt.complete, false);
  assert.deepEqual(overt.outputs, []);
});

test('contract-conformant silent traces need no word field', () => {
  const result = evaluateTier2FacetRecipe(facet('gap.notation'), evidence({
    currentAnchors: { gap: ['trace'] },
    currentForest: [{ id: 'trace', label: 'gap', silent: true }]
  }));
  assert.equal(result.complete, true);
  assert.deepEqual(result.outputs, ['Gap label']);
});

test('ghosting requires authored silence and deletion timing requires a real stage change', () => {
  const currentSite = node('site', 'VP', [
    { id: 'verb', label: 'read', silent: true, lineageId: 'verb-lineage', children: [] }
  ], { lineageId: 'site-lineage' });
  const priorSite = node('site', 'VP', [leaf('verb', 'read')], { lineageId: 'site-lineage' });
  const complete = evaluateTier2FacetRecipe(facet('ellipsis.site'), evidence({
    currentAnchors: { 'ellipsis.site': ['site'] },
    currentForest: [currentSite],
    priorForest: [priorSite]
  }));
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.outputs, ['Ghosting']);
  assert.deepEqual(complete.earnedTransitions, ['deletion']);

  const overt = evaluateTier2FacetRecipe(facet('ellipsis.site'), evidence({
    currentAnchors: { 'ellipsis.site': ['site'] },
    currentForest: [priorSite]
  }));
  assert.equal(overt.complete, false);
  assert.deepEqual(overt.outputs, []);
});

test('unchanged mixed ellipsis material does not earn deletion timing', () => {
  const mixedSite = node('site', 'VP', [
    leaf('verb', 'read', { lineageId: 'verb-lineage' }),
    { id: 'object', label: 'book', silent: true, lineageId: 'object-lineage', children: [] }
  ], { lineageId: 'site-lineage' });
  const result = evaluateTier2FacetRecipe(facet('ellipsis.site'), evidence({
    currentAnchors: { 'ellipsis.site': ['site'] },
    currentForest: [mixedSite],
    priorForest: [mixedSite]
  }));

  assert.equal(result.complete, true);
  assert.deepEqual(result.outputs, ['Ghosting']);
  assert.deepEqual(result.earnedTransitions, []);
});

test('outcome facets accept only their declared concepts', () => {
  const tree = [leaf('judged', '*')];
  const blocked = evaluateTier2FacetRecipe(facet('judgment.blocked'), evidence({
    currentAnchors: { 'judged.anchor': ['judged'] },
    currentForest: tree,
    values: { outcome: ['barred'] }
  }));
  assert.equal(blocked.complete, true);
  assert.equal(blocked.outcomeConcept, 'blocked');
  assert.deepEqual(blocked.outputs, ['Blocking cross']);

  const failed = evaluateTier2FacetRecipe(facet('judgment.blocked'), evidence({
    currentAnchors: { 'judged.anchor': ['judged'] },
    currentForest: tree,
    values: { outcome: ['failed'] }
  }));
  assert.equal(failed.complete, false);
  assert.equal(failed.outcomeConcept, null);
  assert.deepEqual(failed.outputs, []);
});

test('presentation and organization companions cannot complete independently', () => {
  const anchors = Array.from({ length: 5 }, (_, index) => leaf(`a${index + 1}`, String(index + 1)));
  const lensRecipe = facet('presentation.lens');
  const lensEvidence = evidence({
    currentAnchors: { 'facet.anchors': ['a1'] },
    currentForest: anchors,
    activeLens: true,
    parentFacetComplete: false
  });
  assert.equal(evaluateTier2FacetRecipe(lensRecipe, lensEvidence).complete, false);
  assert.deepEqual(
    evaluateTier2FacetRecipe(lensRecipe, { ...lensEvidence, parentFacetComplete: true }).outputs,
    ['Lens emphasis']
  );

  const organizationRecipe = facet('organization.large-anchor-set');
  const organizationEvidence = evidence({
    currentAnchors: { 'large.anchor.array': anchors.map((anchor) => anchor.id) },
    currentForest: anchors,
    parentFacetComplete: true
  });
  assert.deepEqual(
    evaluateTier2FacetRecipe(organizationRecipe, organizationEvidence).outputs,
    ['Anchor badge', 'Anchor rail']
  );
  assert.equal(
    evaluateTier2FacetRecipe(organizationRecipe, {
      ...organizationEvidence,
      currentAnchors: { 'large.anchor.array': anchors.slice(0, 4).map((anchor) => anchor.id) }
    }).complete,
    false
  );
});

test('all six transition kinds require their authored stage difference', () => {
  const pronunciation = evaluateTier2FacetRecipe(facet('pf.structured'), evidence({
    currentAnchors: { 'rewrite.output': ['word'] },
    currentForest: [leaf('word', 'laughed', { lineageId: 'word-lineage' })],
    priorForest: [leaf('word', 'laugh', { lineageId: 'word-lineage' })],
    values: { 'pf.rows': ['root: LAUGH -> laughed'] }
  }));
  assert.deepEqual(pronunciation.earnedTransitions, ['pronunciation']);

  const rewrite = evaluateTier2FacetRecipe(facet('pf.rewrite'), evidence({
    currentAnchors: { 'rewrite.output': ['surface'] },
    priorAnchors: { 'rewrite.input': ['underlying'] },
    currentForest: [leaf('surface', 'went')],
    priorForest: [leaf('underlying', 'go')],
    values: { 'rewrite.rows': ['go -> went'] }
  }));
  assert.deepEqual(rewrite.earnedTransitions, ['rewrite']);

  const unchangedRewrite = evaluateTier2FacetRecipe(facet('pf.rewrite'), evidence({
    currentAnchors: { 'rewrite.input': ['form'], 'rewrite.output': ['form'] },
    currentForest: [leaf('form', 'go')],
    priorForest: [leaf('form', 'go')],
    values: { 'rewrite.rows': ['go -> go'] }
  }));
  assert.deepEqual(unchangedRewrite.earnedTransitions, []);

  const fission = evaluateTier2FacetRecipe(facet('pf.fission'), evidence({
    currentAnchors: { 'rewrite.outputs': ['person', 'plural'] },
    priorAnchors: { 'rewrite.input': ['bundle'] },
    currentForest: [node('word', 'Word', [leaf('person', '-su'), leaf('plural', '-e')])],
    priorForest: [leaf('bundle', '-sue')],
    values: { 'fission.input': ['person', 'plural'], 'fission.first': ['person'], 'fission.second': ['plural'] }
  }));
  assert.deepEqual(fission.earnedTransitions, ['fission']);

  const impoverishment = evaluateTier2FacetRecipe(facet('pf.impoverishment'), evidence({
    currentAnchors: { terminal: ['terminal'], 'feature.hierarchy': ['f1', 'f2'] },
    currentForest: [node('bundle', 'Bundle', [leaf('terminal', '2'), leaf('f1', 'person'), leaf('f2', 'plural')])],
    priorForest: [node('bundle', 'Bundle', [leaf('terminal', '2pl'), leaf('f1', 'person'), leaf('f2', 'plural')])],
    values: { 'feature.hierarchy': ['person', 'plural'], 'delink.position': ['person'] }
  }));
  assert.deepEqual(impoverishment.earnedTransitions, ['rewrite']);

  const priorOrder = [node('root', 'XP', [node('group', 'YP', [leaf('a', 'A'), leaf('b', 'B')])])];
  const currentOrder = [node('root', 'XP', [leaf('a', 'A'), node('group2', 'YP', [leaf('b', 'B')])])];
  const rebracketing = evaluateTier2FacetRecipe(facet('pf.local-dislocation'), evidence({
    currentAnchors: { sequence: ['a', 'b'] },
    currentForest: currentOrder,
    priorForest: priorOrder,
    values: { 'order.rows': ['A B', '[A B]'] }
  }));
  assert.deepEqual(rebracketing.earnedTransitions, ['rebracketing']);

  const scope = evaluateTier2FacetRecipe(facet('scope.movement'), evidence({
    currentAnchors: {
      'scope.source': ['lower'],
      'scope.landing': ['higher'],
      'scope.domain': ['tp']
    },
    currentForest: [node('tp', 'TP', [
      leaf('higher', 'every book', { lineageId: 'qp' }),
      leaf('lower', 'every book', { lineageId: 'qp' })
    ])],
    priorForest: [node('tp-before', 'TP', [leaf('lower', 'every book', { lineageId: 'qp' })])]
  }));
  assert.deepEqual(scope.earnedTransitions, ['movement']);

  const unchangedScopeWithFreshIds = evaluateTier2FacetRecipe(facet('scope.movement'), evidence({
    currentAnchors: {
      'scope.source': ['lower'],
      'scope.landing': ['higher-new'],
      'scope.domain': ['tp-new']
    },
    currentForest: [node('tp-new', 'TP', [
      leaf('higher-new', 'every book', { lineageId: 'qp' }),
      leaf('lower', 'every book', { lineageId: 'qp' })
    ])],
    priorForest: [node('tp-old', 'TP', [
      leaf('higher-old', 'every book', { lineageId: 'qp' }),
      leaf('lower', 'every book', { lineageId: 'qp' })
    ])]
  }));
  assert.equal(unchangedScopeWithFreshIds.complete, true);
  assert.deepEqual(unchangedScopeWithFreshIds.earnedTransitions, []);

  const noChange = evaluateTier2FacetRecipe(facet('pf.structured'), evidence({
    currentAnchors: { 'rewrite.output': ['word'] },
    currentForest: [leaf('word', 'laugh')],
    priorForest: [leaf('word', 'laugh')],
    values: { 'pf.rows': ['root: LAUGH -> laugh'] }
  }));
  assert.deepEqual(noChange.earnedTransitions, []);
});

test('every primitive keeps a curated search alias group', () => {
  const byConcept = new Map(VISUAL_PRIMITIVE_SEARCH_SYNONYMS.map((entry) => [entry.concept, entry]));
  assert.equal(byConcept.size, 69);
  TIER2_VISUAL_PRIMITIVE_NAMES.forEach((name) => {
    const synonymGroup = byConcept.get(name);
    assert.ok(synonymGroup, `${name} has no primitive synonym group`);
    assert.ok(synonymGroup.aliases.length >= 4, `${name} needs canonical plus three curated aliases`);
  });
});

test('synonym normalization is exact, deterministic, and collision-preserving', () => {
  assert.equal(normalizeTier2Synonym('  LOWER_occurrence  '), 'lower occurrence');
  assert.equal(normalizeTier2Synonym('  SPELL-OUT_domain  '), 'spell out domain');
  assert.equal(normalizeTier2Synonym('adjunctDomain'), 'adjunct domain');
  assert.equal(normalizeTier2Synonym('CPDomain'), 'cp domain');
  const index = buildTier2SynonymIndex();
  const sourceCandidates = lookupTier2SynonymCandidates(index, 'role', 'source');

  assert.ok(sourceCandidates.includes('movement.source'));
  assert.ok(sourceCandidates.includes('feature.source'));
  assert.ok(sourceCandidates.includes('access.source'));
  assert.deepEqual(
    sourceCandidates,
    [...sourceCandidates].sort((left, right) => left.localeCompare(right, 'en-US'))
  );
  assert.deepEqual(lookupTier2SynonymCandidates(index, 'role', 'SOURCE'), sourceCandidates);
  assert.deepEqual(lookupTier2SynonymCandidates(index, 'role', 'sorce'), []);
});

test('the Tier-2 runtime index contains only shared roles and value keys', async () => {
  const index = buildTier2SynonymIndex();
  const candidates = [...index.values()].flat();
  const source = await readFile(tier2SynonymSourceUrl, 'utf8');

  assert.deepEqual([...new Set(candidates.map((candidate) => candidate.scope))].sort(), ['role', 'value']);
  assert.equal(buildTier2SynonymIndex.length, 0);
  assert.doesNotMatch(source, /productionRegistry|primitive-search-synonyms/u);
  assert.deepEqual(lookupTier2SynonymCandidates(index, 'value', 'result'), ['outcome']);
  assert.deepEqual(lookupTier2SynonymCandidates(index, 'value', 'failed'), []);

  const identityOverlaps = productionRelationRegistry.entries.flatMap((entry) => (
    entry.identities.flatMap((identity) => {
      const matchingCandidates = index.get(normalizeTier2Synonym(identity.name)) ?? [];
      return matchingCandidates.length > 0
        ? [{ entryId: entry.id, identity: identity.name, candidates: matchingCandidates }]
        : [];
    })
  ));
  assert.deepEqual(identityOverlaps, [
    {
      entryId: 'parasitic-gap.composition',
      identity: 'ParasiticGap',
      candidates: [{ scope: 'role', concept: 'parasitic.gap' }]
    },
    {
      entryId: 'parasitic-gap.composition',
      identity: 'Parasitic Gap',
      candidates: [{ scope: 'role', concept: 'parasitic.gap' }]
    },
    {
      entryId: 'feature-bundle.plaque',
      identity: 'FeatureBundle',
      candidates: [{ scope: 'value', concept: 'feature.rows' }]
    },
    {
      entryId: 'feature-bundle.plaque',
      identity: 'Feature Bundle',
      candidates: [{ scope: 'value', concept: 'feature.rows' }]
    },
    {
      entryId: 'phase.arc',
      identity: 'Phase',
      candidates: [{ scope: 'role', concept: 'phase' }]
    },
    {
      entryId: 'transfer.domain',
      identity: 'TransferDomain',
      candidates: [{ scope: 'role', concept: 'transfer.domain' }]
    },
    {
      entryId: 'transfer.domain',
      identity: 'Transfer Domain',
      candidates: [{ scope: 'role', concept: 'transfer.domain' }]
    },
    {
      entryId: 'transfer.domain',
      identity: 'Spell-Out Domain',
      candidates: [{ scope: 'role', concept: 'transfer.domain' }]
    },
    {
      entryId: 'transfer.domain',
      identity: 'Spell Out Domain',
      candidates: [{ scope: 'role', concept: 'transfer.domain' }]
    }
  ]);
});

test('every production identity remains private to exact Tier-1 matching', () => {
  productionRelationRegistry.entries.forEach((entry) => {
    entry.identities.forEach((identity) => {
      assert.equal(
        findRelationRegistryEntry(productionRelationRegistry, identity.name)?.id,
        entry.id,
        `${identity.name} must resolve through Tier 1`
      );
    });
  });
});

test('the analysis verdict owns its optional label while blocked extraction owns neither verdict part', async () => {
  const source = await readFile(vocabularySourceUrl, 'utf8');
  const specimen = source.match(/case 'Verdict label':([\s\S]*?)case 'Prominence branches':/u);
  assert.ok(specimen);
  assert.match(specimen[1], />\s*diagnosis\s*</u);

  const verdict = facet('judgment.verdict');
  assert.ok(verdict.outputs.some((output) => output.piece === 'Verdict glyph'));
  assert.ok(verdict.outputs.some((output) => (
    output.piece === 'Verdict label'
    && output.gate.kind === 'value-present'
    && output.gate.value === 'label'
  )));
  assert.ok(!facet('blocked-extraction').outputs.some((output) => (
    output.piece === 'Verdict glyph' || output.piece === 'Verdict label'
  )));
});

test('the specification names every collision deferred to exclusive dispatch', async () => {
  const source = await readFile(tier2SpecUrl, 'utf8');
  [
    'movement.carrier',
    'movement.path',
    'pf.structured',
    'plaque.structured',
    'feature.dependency',
    'dependent-case',
    'accord',
    'constituent.occurrence',
    'constituent.region',
    'storage.ledger',
    'judgment.verdict',
    'judgment.blocked',
    'judgment.licensed'
  ].forEach((id) => assert.ok(source.includes(`\`${id}\``), `${id} is not named`));
  assert.match(source, /These rules are encoded explicitly in runtime dispatch/u);
  assert.match(source, /Vocabulary order never\s+selects a\s+winner/u);
  assert.match(source, /`pf\.rewrite` and `pf\.fission` are not an implicit collision/u);
});

test('cycle and large-anchor badges remain visually distinct', async () => {
  const source = await readFile(vocabularySourceUrl, 'utf8');
  const cycle = source.match(/case 'Cycle badge':([\s\S]*?)case 'Feature connectors':/u);
  const anchor = source.match(/case 'Anchor badge':([\s\S]*?)case 'Anchor rail':/u);
  assert.ok(cycle);
  assert.ok(anchor);
  assert.match(cycle[1], />C1</u);
  assert.match(anchor[1], />1</u);
  assert.doesNotMatch(anchor[1], />C1</u);
});
