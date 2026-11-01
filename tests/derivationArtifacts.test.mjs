import assert from 'node:assert/strict';
import test from 'node:test';

import { createTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { adaptDerivationStagesForReplay } from '../replay/authoredFrames.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCanvas.ts';

test('an explicitly empty workspace is not replaced by the previous stage', () => {
  const stages = [
    { statement: 'First', stageRecord: 'One object.', relations: [], workspaceForest: [{ id: 'a', label: 'X', children: [] }] },
    { statement: 'Second', stageRecord: 'No objects.', relations: [], workspaceForest: [] }
  ];
  const original = structuredClone(stages);
  const frames = adaptDerivationStagesForReplay(stages);
  assert.deepEqual(frames[1].workspaceForest, []);
  assert.deepEqual(stages, original);
});

test('authored node IDs are not collapsed by a stage-suffix spelling convention', () => {
  const forest = ['dp_stage1', 'dp_stage3'].map(id => ({ id, label: 'DP', children: [] }));
  const canvas = buildRenderableDerivationCanvasData(forest);
  assert.deepEqual(canvas.children.map(node => node.id), forest.map(node => node.id));
});

test('Tree Bank snapshots keep only current parse artifacts without mutating the source bundle', () => {
  const bundle = {
    transientBundleField: 'not persisted',
    analyses: [
      {
        tree: { id: 'root', label: 'TP', children: [] },
        derivationStages: [],
        transientAnalysisField: 'not persisted',
        provenance: {
          treeSource: 'derivationStages',
          hasDerivationStages: false,
          transientProvenanceField: 'not persisted'
        }
      }
    ],
    ambiguityDetected: false
  };

  const snapshot = createTreeBankBundleSnapshot(bundle);
  const analysis = snapshot.analyses[0];

  assert.equal('transientBundleField' in snapshot, false);
  assert.equal('transientAnalysisField' in analysis, false);
  assert.equal('transientProvenanceField' in analysis.provenance, false);
  assert.equal(analysis.provenance.treeSource, 'derivationStages');
  assert.deepEqual(analysis.derivationStages, []);
  analysis.tree.label = 'Changed snapshot';
  assert.equal(bundle.analyses[0].tree.label, 'TP');
});
