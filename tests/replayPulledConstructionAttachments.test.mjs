import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const node = (id, label, children) => ({ id, label, children });
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const stage = (workspaceForest, relations = []) => ({
  statement: 'Completed state', stageRecord: 'Authored state', workspaceForest, relations
});
const find = (root, id) => root?.id === id ? root : root?.children?.map(child => find(child, id)).find(Boolean);

// Two clauses whose bare I heads each become [I V tense] in one stage. The one
// claim listing both head movements needs the landings' new parents, so the
// upper clause's tense selection is pulled ahead of the lower I's merge.
function record() {
  const clause = (k, verb, subject, complement, moved) => node(`ip${k}`, 'IP', [node(`ib${k}`, 'I′', [
    moved
      ? node(`i${k}`, 'I', [leaf(`m${k}`, 'V', verb, { lineageId: `verb${k}` }), leaf(`tense${k}`, 'I', undefined, { silent: true })])
      : leaf(`i${k}`, 'I', undefined, { silent: true }),
    node(`vp${k}`, 'VP', [subject, node(`vb${k}`, 'V′', [
      moved ? leaf(`v${k}`, 'V', undefined, { silent: true, lineageId: `verb${k}` }) : leaf(`v${k}`, 'V', verb, { lineageId: `verb${k}` }),
      complement])])])]);
  const tree = moved => clause('0', 'said', leaf('teacher', 'NP', 'the teacher'),
    clause('1', 'was', leaf('book', 'NP', 'the book'), leaf('place', 'PP', 'on the table'), moved), moved);
  return {
    sentence: 'said the teacher was the book on the table',
    derivationStages: [stage([tree(false)]), stage([tree(true)], [{
      relation: 'V-to-I-head-movement',
      anchors: { source: ['v0', 'v1'], landing: ['m0', 'm1'], target: ['i0', 'i1'] }
    }])],
    includePlayback: true
  };
}

test('a construction step pulled ahead of a parent merge keeps that parent unattached until its merge', () => {
  const steps = prepareReplay(record()).playbackSteps;
  const stageStart = steps.findIndex(step => step.replayKind === 'macro') + 1;
  const stageSteps = steps.slice(stageStart);
  const at = (operation, id) => stageSteps.findIndex(step => step.operation === operation && step.targetNodeId === id);
  assert(at('LexicalSelect', 'tense0') >= 0 && at('LexicalSelect', 'tense0') < at('ExternalMerge', 'i1'),
    'the upper selection plays before the lower I merges');
  for (const head of ['0', '1']) {
    const merge = at('ExternalMerge', `i${head}`);
    assert(merge >= 0);
    stageSteps.slice(0, merge).forEach((step, offset) => assert.deepEqual(
      (find(step.replayCanvasData, `i${head}`)?.children || []).map(child => child.id), [],
      `i${head} gains no daughter before its merge (stage step ${offset + 1}, ${step.operation} ${step.targetNodeId})`));
    stageSteps.slice(merge).forEach(step => assert.deepEqual(
      find(step.replayCanvasData, `i${head}`)?.children?.map(child => child.id), [`m${head}`, `tense${head}`]));
  }
});
