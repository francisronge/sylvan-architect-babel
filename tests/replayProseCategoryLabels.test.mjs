import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { readCategoryLabel } from '../replay/categoryLabel.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/unrendered-head-movement.json', import.meta.url), 'utf8'));

const movementMoments = record => prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps
  .filter(step => step.replayKind === 'relation' && /head movement/u.test(step.operation))
  .map(step => {
    const key = `${step.replayRelationIdentity.stageIndex}:${step.replayRelationIdentity.relationIndex}`;
    return {
      key,
      arrows: (step.replayRelationLinks ?? []).filter(link => link.authoredRelationKey === key && link.renderFamily === 'trajectory')
        .map(link => `${link.trajectoryKind}:${link.sourceNodeId}->${link.targetNodeId}`),
      diagnostics: (step.movementDiagnostics ?? []).map(diagnostic => diagnostic.split(':')[0])
    };
  });

test('head movement between prose-labelled heads draws a head arrow from its structure', () => {
  assert.equal(readCategoryLabel('Honorific head: complex'), undefined, 'the labels spell no category notation');
  assert.deepEqual(movementMoments(fixture), [
    { key: '2:0', arrows: ['head:verbTrace->verbAtHonorific'], diagnostics: [] },
    { key: '3:0', arrows: ['head:honorificTrace->honorificAtInflection'], diagnostics: [] },
    { key: '4:0', arrows: ['head:inflectionTrace->inflectionAtComplementizer'], diagnostics: [] }
  ]);
});

test('a prose-labelled complex is not a head adjunction unless it takes its unchanged host\'s slot', () => {
  const moved = structuredClone(fixture);
  const find = nodes => nodes.map(node => node.id === 'honorificComplex' ? node : find(node.children ?? [])).find(Boolean);
  const complex = find(moved.derivationStages[2].workspaceForest);
  complex.children[1] = { ...complex.children[1], word: '시' };
  const [verbToHonorific] = movementMoments(moved);
  assert.equal(verbToHonorific.key, '2:0');
  assert.deepEqual(verbToHonorific.arrows.filter(arrow => arrow.startsWith('head:')), [], 'a changed host proves no adjunction');
});

test('each member of a compound head may carry its own features', () => {
  assert.deepEqual(readCategoryLabel('Asp⁰[progressive]+Pred+v+V'), { category: 'Asp', head: 'Asp', kind: 'head', compound: true });
  assert.equal(readCategoryLabel('Asp⁰[progressive'), undefined, 'malformed notation stays uninterpreted');
});
