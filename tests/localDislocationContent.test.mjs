import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLocalDislocationContent } from '../replay/relations/localDislocationContent.ts';

const leaf = id => ({ id, label: 'X', word: id });
const node = (id, ...children) => ({ id, label: 'XP', children });
const sequenceNodeIds = ['a', 'b', 'c'];
const priorForest = [node('before', leaf('a'), node('bc', leaf('b'), leaf('c')))];
const currentForest = [node('after', node('ab', leaf('a'), leaf('b')), leaf('c'))];
const input = { sequenceNodeIds, priorForest, currentForest };
const expected = { kind: 'local-dislocation', beforeGroupSizes: [1, 2], afterGroupSizes: [2, 1] };
const rowsFor = (before, after) => [
  ...before.map(value => ({ label: 'beforeGroupSizes', value: String(value) })),
  ...after.map(value => ({ label: 'afterGroupSizes', value: String(value) }))
];

test('local dislocation preserves the actual [A][BC] to [AB][C] regrouping', () => {
  const untouched = structuredClone(input);
  assert.deepEqual(prepareLocalDislocationContent(input), expected);
  assert.deepEqual(input, untouched);
});

test('parent renaming and unary projection changes do not establish rebracketing', () => {
  const renamed = [node('renamed', leaf('a'), node('renamed-bc', leaf('b'), leaf('c')))];
  assert.equal(prepareLocalDislocationContent({ ...input, currentForest: renamed }), undefined);
  const wrapped = [node('wrapper', node('renamed', node('a-wrapper', leaf('a')),
    node('bc-wrapper', node('renamed-bc', leaf('b'), leaf('c')))))];
  assert.equal(prepareLocalDislocationContent({ ...input, currentForest: wrapped }), undefined);
  assert.equal(prepareLocalDislocationContent({
    sequenceNodeIds: ['a', 'b'],
    priorForest: [node('old-root', node('old-group', leaf('a'), leaf('b')))],
    currentForest: [node('new-root', leaf('a'), leaf('b'))]
  }), undefined);
});

test('forest evidence requires the same unique sequence occurrences in the same order', () => {
  for (const invalid of [
    { sequenceNodeIds: ['a', 'a', 'c'] },
    { sequenceNodeIds: ['a', 'b', 'missing'] },
    { sequenceNodeIds: ['a'] },
    { priorForest: [] },
    { priorForest: [node('before', leaf('a'), leaf('b'))] },
    { priorForest: [...priorForest, leaf('a')] },
    { currentForest: [...currentForest, leaf('b')] },
    { currentForest: [node('after', node('ac', leaf('a'), leaf('c')), leaf('b'))] },
    { currentForest: [leaf('a'), node('bc', leaf('b'), leaf('c'))] },
    { currentForest: [node('after', node('ab', leaf('a'), leaf('b')), leaf('unlisted'), leaf('c'))] },
    { sequenceNodeIds: ['ab', 'a', 'c'] }
  ]) assert.equal(prepareLocalDislocationContent({ ...input, ...invalid }), undefined, JSON.stringify(invalid));
});

test('sequence items may be whole phrases and unrelated context stays outside the grouping', () => {
  const phrase = id => node(id, leaf(`${id}-head`), leaf(`${id}-complement`));
  assert.deepEqual(prepareLocalDislocationContent({
    sequenceNodeIds,
    priorForest: [node('context-before', leaf('outside'),
      node('before', phrase('a'), node('bc', phrase('b'), phrase('c'))))],
    currentForest: [node('context-after', leaf('outside'),
      node('after', node('ab', phrase('a'), phrase('b')), phrase('c')))]
  }), expected);
});

test('nested brackets are not silently flattened into the designed single-level lanes', () => {
  assert.equal(prepareLocalDislocationContent({
    sequenceNodeIds: ['a', 'b', 'c', 'd'],
    priorForest: [node('before', leaf('a'), node('bcd', leaf('b'), node('cd', leaf('c'), leaf('d'))))],
    currentForest: [node('after', node('ab', leaf('a'), leaf('b')), node('cd2', leaf('c'), leaf('d')))]
  }), undefined);
});

test('complete authored partitions support the existing Tier 1 lanes without a prior forest', () => {
  assert.deepEqual(prepareLocalDislocationContent({
    sequenceNodeIds, currentForest, rows: rowsFor([1, 2], [2, 1])
  }), expected);
  assert.deepEqual(prepareLocalDislocationContent({
    sequenceNodeIds: ['a', 'b'], currentForest: [node('root', leaf('a'), leaf('b'))],
    rows: rowsFor([1, 1], [2])
  }), { kind: 'local-dislocation', beforeGroupSizes: [1, 1], afterGroupSizes: [2] });
});

test('malformed or unchanged authored partitions remain neutral despite valid forest evidence', () => {
  for (const [before, after] of [
    [[], [2, 1]], [[1, 2], []], [[1, 2], [1, 2]], [[1], [2, 1]], [[1, 3], [2, 1]],
    [[0, 3], [2, 1]], [[-1, 4], [2, 1]], [[1.5, 1.5], [2, 1]],
    [['1e0', 2], [2, 1]], [['1.0', 2], [2, 1]], [['1,2'], [2, 1]],
    [[Number.MAX_SAFE_INTEGER + 1], [2, 1]]
  ]) assert.equal(prepareLocalDislocationContent({ ...input, rows: rowsFor(before, after) }), undefined,
    JSON.stringify({ before, after }));
});

test('authored grouping cannot rescue missing, repeated, or overlapping sequence anchors', () => {
  const rows = rowsFor([1, 2], [2, 1]);
  for (const invalid of [
    { sequenceNodeIds: ['a', 'b', 'missing'] },
    { sequenceNodeIds: ['a', 'a', 'c'] },
    { sequenceNodeIds: ['ab', 'a', 'c'] },
    { currentForest: [...currentForest, leaf('a')] }
  ]) assert.equal(prepareLocalDislocationContent({ ...input, rows, ...invalid }), undefined);
});

test('raw grouping values preserve explicitly empty arrays instead of inferring a replacement', () => {
  for (const values of [
    { beforeGroupSizes: [], afterGroupSizes: [] },
    { beforeGroupSizes: [] },
    { afterGroupSizes: [] }
  ]) assert.equal(prepareLocalDislocationContent({ ...input, values }), undefined);
  assert.deepEqual(prepareLocalDislocationContent({
    ...input, values: { beforeGroupSizes: ['1', '2'], afterGroupSizes: ['2', '1'] }
  }), expected);
  assert.equal(prepareLocalDislocationContent({
    ...input, rows: rowsFor([1, 2], [2, 1]), values: { beforeGroupSizes: [], afterGroupSizes: [] }
  }), undefined);
});
