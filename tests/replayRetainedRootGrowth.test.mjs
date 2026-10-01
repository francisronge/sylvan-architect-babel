import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/retained-root-growth.json', import.meta.url)));
const node = (id, label, children = []) => ({ id, label, children });
const stage = workspaceForest => ({ statement: 'Complete the current objects.', stageRecord: 'The nominal grows while a separate clause receives its C.', relations: [], workspaceForest });
const reduced = () => {
  const nominal = node('nominal', 'DP', [node('determiner', 'D'), node('noun', 'N')]);
  const relativeBody = node('relativeBody', 'TP', [node('relativeVerb', 'V')]);
  const mainBody = node('mainBody', 'TP', [node('mainVerb', 'V')]);
  return { sentence: '', derivationStages: [stage([nominal, relativeBody, mainBody]), stage([
    node('nominal', 'DP', [nominal.children[0], node('modifiedNominal', 'NP', [nominal.children[1],
      node('relativeClause', 'CP', [node('operator', 'DP'), node('relativeProjection', "C'", [node('relativeHead', 'C'), relativeBody])])])]),
    node('mainClause', 'CP', [node('mainHead', 'C'), mainBody])
  ])] };
};
const shape = root => ({ id: root.id, label: root.label, children: (root.children ?? []).map(shape) });
const visibleForest = step => {
  const visible = new Set(step.replayVisibleNodeIds);
  const visit = current => {
    if (current.replayOrigin?.kind === 'word') return [];
    const children = (current.children ?? []).flatMap(visit);
    if (!visible.has(current.id) || current.replayOrigin?.kind === 'workspace') return children;
    return [{ id: current.replayOrigin?.kind === 'lexical' ? current.replayOrigin.authoredId : current.id, label: current.label, children }];
  };
  return visit(step.replayCanvasData).sort((a, b) => a.id.localeCompare(b.id));
};

for (const [name, make, parents] of [
  ['mixed retained and new workspace roots', reduced, ['relativeProjection', 'relativeClause', 'modifiedNominal']],
  ['fresh GPT-6.1 Sol Arabic', () => structuredClone(saved), ['rCProjection', 'rCP', 'bookNominal']]
]) test(`${name}: new roots do not discard construction inside a retained root`, () => {
  const record = make(), original = structuredClone(record);
  const { playbackSteps } = prepareReplay({ ...record, includePlayback: true });
  const currentSteps = playbackSteps.filter(step => step.replayFrameIndex === 1);
  for (const id of parents) {
    const mergeIndex = currentSteps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === id && step.operation === 'ExternalMerge');
    assert(mergeIndex >= 0, `${id} must receive its own binary merge`);
    assert(currentSteps.slice(0, mergeIndex).every(step => !step.replayVisibleNodeIds.includes(id)), `${id} must wait for its merge`);
    for (const source of currentSteps[mergeIndex].sourceNodeIds) assert(currentSteps[mergeIndex - 1].replayVisibleNodeIds.includes(source), `${source} must precede its parent`);
  }
  const completed = currentSteps.find(step => step.replayKind === 'macro');
  const expected = record.derivationStages[1].workspaceForest.map(shape).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(visibleForest(completed), expected, 'completed Replay must retain every binary internal parent and exact child order');
  assert.deepEqual(record, original);
});
