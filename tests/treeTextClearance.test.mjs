import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { clearTreeText } from '../replay/treeTextClearance.ts';
import { auditVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

const leaf = (id, label, word) => ({ id, label, word, children: [] });
const node = (id, label, ...children) => ({ id, label, children });
const clause = () => node('ip', 'IP', node('np', 'NP', leaf('pronoun', 'N⁰[pronoun]', '佢')),
  node('vp', 'VP', leaf('verb', 'V⁰', '食')));
const stage = (statement, forest) => ({ statement, stageRecord: statement, relations: [], workspaceForest: [forest] });

// Reduced from GPT-6.1 Sol's Cantonese analysis of "佢食咗飯未呀？" (qualification
// run n3-04-yue-sfp): two head-final C heads stand on the right edge. The lower
// head's label wraps onto three lines and grows up into the row of the higher
// head's word, whose fork D3 placed only by its own row.
const stackedHeadFinalHeads = {
  sentence: '佢食未呀？', inputTokens: ['佢', '食', '未', '呀'],
  derivationStages: [
    stage('Build the clause.', clause()),
    stage('Complete the clause with interrogative 未 and discourse-final 呀.',
      node('cp_discourse', 'CP[discourse]', node('cbar_discourse', 'C′[discourse]',
        node('cp_question', 'CP[interrogative]', node('cbar_question', 'C′[interrogative]', clause(),
          leaf('c_question', 'C⁰[polar question, not-yet alternative]', '未'))),
        leaf('c_discourse', 'C⁰[discourse particle]', '呀'))))
  ]
};

test('a wrapped label below a word on the row above keeps clear of it in every frame and the Canopy', () => {
  const { findings } = auditVisualRecord('stacked-head-final-heads', stackedHeadFinalHeads, { viewports: VIEWPORTS });
  const overlaps = findings.filter(finding => finding.rule === 'glyph-overlap');
  assert.deepEqual(overlaps.map(finding => `${finding.frame}@${finding.viewport}: ${finding.detail}`), []);
  // Widening a fork keeps rows, sister order and centring.
  assert.deepEqual(findings.filter(finding => ['branch-geometry', 'parent-centring'].includes(finding.rule)), []);
});

// A fork's left daughter carries a deep word; its right daughter's text sits a
// row lower and further left than D3's own-row spacing can see.
const tree = () => {
  const root = d3.hierarchy(node('root', 'R', node('left', 'L', leaf('word', 'W', 'w')), node('right', 'Q',
    node('rightInner', 'Q2', leaf('low', 'X', 'x')))));
  const points = { root: [0, 0], left: [-100, 100], word: [-100, 200], right: [100, 100], rightInner: [100, 200], low: [100, 300] };
  root.each(item => { [item.x, item.y] = points[item.data.id]; });
  return root;
};
const boxes = { word: [{ x: -30, y: 60, width: 60, height: 40, halo: 4 }], low: [{ x: -200, y: -50, width: 400, height: 40, halo: 5 }] };

test('clearTreeText widens only the fork where the colliding paths divide, keeping rows and centring', () => {
  const root = tree(), before = new Map(root.descendants().map(item => [item.data.id, [item.x, item.y]]));
  const widenings = clearTreeText(root, () => true, item => boxes[item.data.id] ?? []);
  assert.equal(widenings, 1);
  const at = new Map(root.descendants().map(item => [item.data.id, item]));
  // The word ends at -70 with its outline at -66; the label starts at -100, less its outline at -105, so it moves 47 right.
  assert.equal(at.get('low').x - before.get('low')[0], 47);
  assert.equal(at.get('left').x, before.get('left')[0]);
  assert.equal(at.get('word').x, before.get('word')[0]);
  for (const item of root.descendants()) {
    assert.equal(item.y, before.get(item.data.id)[1]);
    if (item.children) assert.equal(item.x, (item.children[0].x + item.children.at(-1).x) / 2);
  }
  // Text that already clears, or meets on one row, or grazes by less than an outline, is left alone.
  const clear = tree();
  assert.equal(clearTreeText(clear, () => true, item => item.data.id === 'low' ? [{ ...boxes.low[0], x: 0 }] : boxes[item.data.id] ?? []), 0);
  const grazing = tree();
  assert.equal(clearTreeText(grazing, () => true, item => item.data.id === 'low' ? [{ ...boxes.low[0], y: -5 }] : boxes[item.data.id] ?? []), 0);
});
