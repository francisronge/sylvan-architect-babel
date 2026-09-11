import assert from 'node:assert/strict';
import test from 'node:test';

import { collectPronouncedTerminalSequence } from '../replay/pronouncedTerminals.ts';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';

const localDislocationTree = {
  id: 'kp_local_dislocation',
  label: 'KP',
  children: [
    {
      id: 'poss_p_local_dislocation',
      label: 'PossP',
      children: [
        { id: 'n_local_dislocation', label: 'N', word: 'tery', tokenIndex: 0 },
        { id: 'poss_local_dislocation', label: 'Poss', word: '-maan', tokenIndex: 2 }
      ]
    },
    { id: 'k_local_dislocation', label: 'K', word: '-eer', tokenIndex: 1 }
  ]
};

test('pronounced terminal sequence is tree order; token indexes never reorder it', () => {
  assert.deepEqual(
    collectPronouncedTerminalSequence(localDislocationTree),
    ['tery', '-maan', '-eer']
  );
});

test('pronounced terminal sequence excludes silent leaves and falls back wholly to branch order', () => {
  const tree = {
    label: 'XP',
    children: [
      { label: 'A', word: 'first' },
      { label: 'B', word: 'silent', tokenIndex: 0, silent: true },
      { label: 'C', word: 'second', tokenIndex: 0 }
    ]
  };
  assert.deepEqual(collectPronouncedTerminalSequence(tree), ['first', 'second']);
});

test('replay snapshot derives its sentence from final pronounced terminal order', () => {
  const bundle = {
    analyses: [{
      tree: localDislocationTree,
      derivationStages: []
    }]
  };
  assert.equal(buildReplaySnapshotProjection(bundle).sentence, 'tery -maan -eer');
});
