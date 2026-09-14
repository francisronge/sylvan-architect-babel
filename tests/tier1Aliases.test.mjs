import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchRelation } from '../replay/relationDispatch/relationDispatch.js';
import {
  productionRelationRegistry
} from '../replay/relationDispatch/productionRegistry.js';
import {
  findRelationRegistryEntry
} from '../replay/relationDispatch/relationRegistry.js';
import {
  TIER1_RELATION_ALIAS_RECORDS
} from '../replay/relationDispatch/tier1Aliases.js';

const forbiddenBroadAliases = new Set([
  'agreement',
  'binding',
  'case',
  'control',
  'copy',
  'deletion',
  'domain',
  'ellipsis',
  'focus',
  'licensing',
  'movement',
  'phase',
  'relation',
  'scope'
]);

test('every conservative Tier-1 alias resolves to its documented canonical entry', () => {
  const aliases = [];

  TIER1_RELATION_ALIAS_RECORDS.forEach((record) => {
    const canonical = findRelationRegistryEntry(productionRelationRegistry, record.canonical);
    assert.ok(canonical, `${record.canonical} is not a production identity`);
    assert.ok(record.rationale.trim(), `${record.canonical} has no rationale`);
    assert.ok(record.evidence.trim(), `${record.canonical} has no evidence`);
    assert.ok(record.aliases.length > 0, `${record.canonical} declares no aliases`);

    record.aliases.forEach((alias) => {
      assert.equal(
        findRelationRegistryEntry(productionRelationRegistry, alias)?.id,
        canonical.id,
        `${alias} does not select ${record.canonical}`
      );
      assert.equal(forbiddenBroadAliases.has(alias.toLowerCase()), false, `${alias} is too broad`);
      aliases.push(alias.toLowerCase().trim().replace(/\s+/gu, ' '));
    });
  });

  assert.ok(aliases.length > 0, 'the alias catalog must not be empty');
  assert.equal(new Set(aliases).size, aliases.length, 'the alias catalog repeats a normalized name');
});

test('Tier-1 aliases keep exclusive dispatch and fail malformed explicit claims closed', () => {
  const malformed = dispatchRelation({
    registry: productionRelationRegistry,
    relation: { relation: 'Head Movement', anchors: {} },
    stageIndex: 0,
    relationIndex: 0
  });
  assert.equal(malformed.outcome, 'signature-incomplete');
  assert.equal(findRelationRegistryEntry(productionRelationRegistry, 'Head Movement Theory'), null);
});

test('construction compositions remain outside the Tier-1 alias catalog', () => {
  [
    'Sluicing',
    'Pseudogapping',
    'RemnantEscape',
    'Remnant Escape',
    'Gapping',
    'AntecedentContainedDeletion',
    'Antecedent-Contained Deletion',
    'ACD'
  ].forEach((name) => {
    assert.equal(findRelationRegistryEntry(productionRelationRegistry, name), null, name);
  });
});

test('Phrasal Movement exactly selects the generic curated phrasal trajectory', () => {
  assert.equal(
    findRelationRegistryEntry(productionRelationRegistry, 'Phrasal Movement')?.id,
    'trajectory.phrasal'
  );
  assert.equal(findRelationRegistryEntry(productionRelationRegistry, 'Movement'), null);
});
