import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelationRegistry, findRelationRegistryEntry } from '../replay/relationDispatch/relationRegistry.js';

const registry = entries => createRelationRegistry({ registryId: 'lookup-test', version: '1', entries });
const entry = (id, name, normalization) => ({ id, version: '1', identities: [{ name, normalization }] });

test('indexed identities retain the declared normalization and cross-mode ambiguity', () => {
  const r = registry([
    entry('exact', 'Exact', 'exact'), entry('case', 'Fold', 'case'),
    entry('spaces', 'Two Words', 'whitespace'), entry('both', 'Fold Spaces', 'case-whitespace')
  ]);
  const bytes = JSON.stringify(r);
  for (const [name, expected] of [['Exact', 'exact'], ['exact', undefined], ['FOLD', 'case'],
    ['  Two\tWords ', 'spaces'], ['two words', undefined], [' FOLD\n SPACES ', 'both'], ['unknown', undefined]]) {
    assert.equal(findRelationRegistryEntry(r, name)?.id, expected, name);
  }
  assert.equal(JSON.stringify(r), bytes, 'lookup state must not alter the serializable registry');
  assert(Object.isFrozen(r));
  const overlap = registry([entry('one', 'Fold', 'exact'), entry('two', 'fold', 'case')]);
  assert.throws(() => findRelationRegistryEntry(overlap, 'Fold'), /Ambiguous registry identity/);
});

test('lookups of caller-owned registry copies observe subsequent edits', () => {
  const original = registry([entry('first', 'First', 'exact')]);
  const copy = structuredClone(original);
  assert.equal(findRelationRegistryEntry(copy, 'First').id, 'first');
  copy.matchers[0].normalizedName = 'Second';
  copy.entries[0].version = '2';
  assert.equal(findRelationRegistryEntry(copy, 'First'), null);
  assert.equal(findRelationRegistryEntry(copy, 'Second').version, '2');
  assert.equal(findRelationRegistryEntry(original, 'First').version, '1');
});
