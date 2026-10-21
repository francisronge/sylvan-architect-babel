import assert from 'node:assert/strict';
import test from 'node:test';
import { rawCases } from '../docs/design/visual-relations-lab-cards.ts';

const collectFeaturePronunciationFailures = (
  node,
  inheritedSilent,
  context,
  failures
) => {
  if (!node) return;
  const silent = inheritedSilent || node.silent === true || node.ghost === true;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length > 0) {
    children.forEach((child) => collectFeaturePronunciationFailures(
      child,
      silent,
      context,
      failures
    ));
    return;
  }

  const surface = String(node.word || node.label || '').trim();
  if (/^\[[^\]]+\]$/.test(surface) && !silent) {
    failures.push(`${context}: ${node.id || '(missing id)'} renders ${surface} as pronounced`);
  }
};

test('Atlas feature notation is silent in every Replay stage', () => {
  const failures = [];

  rawCases.forEach((card) => {
    (card.derivationStages || []).forEach((stage, stageIndex) => {
      (stage.workspaceForest || []).forEach((root) => collectFeaturePronunciationFailures(
        root,
        false,
        `${card.title} stage ${stageIndex + 1}`,
        failures
      ));
    });
  });

  assert.deepEqual(failures, []);
});
