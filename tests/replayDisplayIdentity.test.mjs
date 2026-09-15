import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { buildRenderableDerivationCanvasData, projectAuthoredSyntaxNode, isSyntheticWorkspaceRootNode } from '../replay/replayCompiler.ts';
import { replayOwnerId, isReplayDisplayChild } from '../replay/displayIdentity.ts';

const nodes = tree => tree ? [tree, ...(tree.children ?? []).flatMap(nodes)] : [];
const head = { id: 'head', label: 'V', word: 'read' };

test('authored display-like IDs and workspace labels remain ordinary syntax', () => {
  const authored = { id: 'head::__leaf', label: '__DERIVATION_WORKSPACE__', word: 'books' };
  const canvas = buildRenderableDerivationCanvasData([head, authored]);
  const all = nodes(canvas);
  assert.equal(new Set(all.map(n => n.id)).size, all.length);
  const genuine = all.find(n => n.id === authored.id);
  assert.equal(genuine.word, 'books');
  assert.equal(isSyntheticWorkspaceRootNode(d3.hierarchy(genuine)), false);
  assert.equal(replayOwnerId(canvas, authored.id), authored.id);
  assert.equal(isReplayDisplayChild(genuine, head.id), false);
  const word = all.find(n => n.replayOrigin?.kind === 'word' && n.replayOrigin.ownerId === head.id);
  assert.equal(word.word, 'read');
  assert.notEqual(word.id, authored.id);
  assert.equal(replayOwnerId(canvas, word.id), head.id);
  assert.equal(replayOwnerId(canvas, 'foreign::__leaf'), 'foreign::__leaf');
  assert.deepEqual(projectAuthoredSyntaxNode({ ...head, replayOrigin: { kind: 'workspace' } }), head);
});

test('future authored collisions are reserved before the first lexical selection', () => {
  const later = { id: 'head::__leaf', label: 'N', word: 'books' };
  const stages = [[head], [{ id: 'root', label: 'VP', children: [head, later] }]].map((workspaceForest, index) => ({
    statement: `Stage ${index}`, stageRecord: 'Identity control.', relations: [], workspaceForest
  }));
  const steps = buildReplayPlayback({ sentence: 'read books', analyses: [{ derivationStages: stages }] }).steps;
  const words = steps.flatMap(step => nodes(step.replayCanvasData).filter(n => n.replayOrigin?.kind === 'word' && n.replayOrigin.ownerId === 'head'));
  assert(words.length > 0);
  assert.equal(new Set(words.map(n => n.id)).size, 1);
  assert.notEqual(words[0].id, later.id);
  for (const step of steps.filter(step => step.replayFrameIndex === 0)) {
    assert(!step.replayVisibleNodeIds.includes(later.id), 'future authored syntax must not be revealed through an ID collision');
  }
});

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
for (const record of records) for (const spelling of ['display-like', 'whitespace']) test(`${record.name}: ${spelling} authored IDs preserve every Replay event and visible occurrence`, () => {
  const ids = new Map(record.derivationStages.flatMap(stage => stage.workspaceForest.flatMap(nodes)).map(n => [n.id, spelling === 'whitespace' ? ` ${n.id} ` : `__babel_future_layout_1__${n.id}::__leaf`]));
  const reverse = new Map([...ids].map(([a,b]) => [b,a]));
  const renamed = structuredClone(record);
  for (const stage of renamed.derivationStages) {
    stage.workspaceForest.flatMap(nodes).forEach(n => { n.id = ids.get(n.id); });
    for (const relation of stage.relations) for (const field of ['anchors', 'priorAnchors']) {
      for (const [key, value] of Object.entries(relation[field] ?? {})) relation[field][key] = Array.isArray(value) ? value.map(id => ids.get(id) ?? id) : ids.get(value) ?? value;
    }
  }
  const state = (analysis, decode) => buildReplayPlayback({ sentence: record.sentence, analyses: [analysis] }).steps.map(step => ({
    operation: step.operation, stage: step.replayFrameIndex, relation: step.replayRelationIdentity,
    visible: nodes(step.replayCanvasData).filter(n => step.replayVisibleNodeIds.includes(n.id)).map(n => {
      const origin = n.replayOrigin;
      return [origin?.kind ?? 'authored', decode(origin?.authoredId ?? origin?.ownerId ?? n.id), n.label, n.word];
    }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }));
  assert.deepEqual(state(renamed, id => reverse.get(id) ?? id), state(record, id => id));
});
