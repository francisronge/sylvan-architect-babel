import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

// The just-in-time sister order reads structure only, so writing the same analysis in bare
// phrase-structure labels (T, C, D for TP/T′, CP/C′, DP/D′) changes no construction step.
const bareLabel = label => {
  const shape = readCategoryLabel(label);
  if (!shape || shape.compound) return label;
  const match = /^(\s*)([A-Za-z]+)(?:_[A-Za-z0-9_-]+)?(⁰|°|\^?0|[′’'])?(.*)$/su.exec(label);
  return match ? `${match[1]}${shape.head}${match[4]}` : label;
};
const bare = record => {
  const copy = structuredClone(record);
  const visit = node => ({ ...node, ...(node.label ? { label: bareLabel(node.label) } : {}), ...(node.children ? { children: node.children.map(visit) } : {}) });
  copy.derivationStages.forEach(stage => { stage.workspaceForest = stage.workspaceForest.map(visit); });
  return copy;
};
const order = record => prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps
  .map(step => `${step.replayFrameIndex}:${step.replayKind}:${step.operation}:${step.targetNodeId}`);
const withRank = run => {
  const saved = [process.env.BABEL_REPLAY_KERNEL, process.env.BABEL_REPLAY_STRUCTURAL_RANK];
  process.env.BABEL_REPLAY_KERNEL = '1'; process.env.BABEL_REPLAY_STRUCTURAL_RANK = '2';
  try { return run(); } finally {
    if (saved[0] === undefined) delete process.env.BABEL_REPLAY_KERNEL; else process.env.BABEL_REPLAY_KERNEL = saved[0];
    if (saved[1] === undefined) delete process.env.BABEL_REPLAY_STRUCTURAL_RANK; else process.env.BABEL_REPLAY_STRUCTURAL_RANK = saved[1];
  }
};

test('X-bar fixtures rewritten in bare labels construct in the same order', () => withRank(() => {
  const differing = loadFixtureAnalyses().records.filter(({ record }) => JSON.stringify(bare(record)) !== JSON.stringify(record))
    .filter(({ record }) => JSON.stringify(order(record)) !== JSON.stringify(order(bare(record)))).map(({ id }) => id);
  assert.deepEqual(differing, []);
}));
