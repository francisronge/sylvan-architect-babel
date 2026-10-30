import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { select } from 'd3';
import { hasTreeGapNotation } from '../components/renderer/treeNotation.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { isOwnNodeNotation } from '../replay/replaySurfaceNotation.ts';
import { createSvgDom } from './helpers/svgDom.mjs';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

/* Babel adds nothing to the model's notation (Francis, PR #322). The Tier-2 gap
 * label shows the label the model wrote for a gap; when that is the node's own
 * label or word, the tree already shows it. The tree may paint the label with a
 * chain index run (the node label "NP (tᵢ)" painted as "NP (tᵢ)ᵢ"); main compared
 * that painted string and drew a second "NP (tᵢ)" beside the node. */

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}`, import.meta.url), 'utf8'));
const drawnGapBadges = (record, steps) => layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps })
  .flatMap(frame => frame.marks.filter(mark => mark.type === 'text-badge' && mark.badgeStyle === 'gap-notation'
    && !mark.reuseExistingNotation).map(mark => `${frame.frame}:${mark.nodeId} ${mark.text}`));

test('a gap label that is the node\'s own indexed label is not drawn again beside it', () => {
  assert.deepEqual(drawnGapBadges(fixture('independent-clause-and-realization.json'), [20, 36, 53]), []);
  const continuity = fixture('workspace-historical-continuity.json').cases[3];
  assert.deepEqual(drawnGapBadges(continuity, [26, 40, 67]), []);
});

const { Element, restore } = createSvgDom();
after(restore);
const paintedLabel = (painted, data, kind = 'category') => {
  const root = new Element('g');
  const label = new Element('text', { class: `${kind}-label`, [kind === 'category' ? 'data-category-node-id' : 'data-node-id']: 'low' },
    { data: { id: 'low', ...data } });
  label.text = painted;
  root.children.push(label);
  return select(root);
};

test('the painter reads the node\'s authored label, not the label with the index runs it appends', () => {
  assert.equal(hasTreeGapNotation(paintedLabel('NP (tᵢ)ᵢ', { label: 'NP (tᵢ)' }), 'low', 'NP (tᵢ)'), true);
  assert.equal(hasTreeGapNotation(paintedLabel('V⁰ (t)ᵢ', { label: 'V⁰ (t)' }), 'low', 'V⁰ (t)'), true);
  assert.equal(hasTreeGapNotation(paintedLabel('NP (tᵢ)ᵢ', { label: 'NP (tᵢ)' }), 'other', 'NP (tᵢ)'), false,
    'another node\'s label never absorbs the badge');
});

test('control: a gap label the model wrote apart from the node\'s label is still drawn', () => {
  const stage = (workspaceForest, relations = []) => ({ statement: '', stageRecord: '', workspaceForest, relations });
  const low = { id: 'low', label: 'NP', lineageId: 'chain' };
  const verb = { id: 'verb', label: 'V', word: 'wrote' };
  const plan = compileRelationRenderPlan([
    stage([{ id: 'vp', label: 'VP', children: [low, verb] }]),
    stage([{ id: 'cp', label: 'CP', children: [
      { id: 'high', label: 'NP[Op]', lineageId: 'chain' },
      { id: 'vp', label: 'VP', children: [{ ...low, label: 'NP (tᵢ)', silent: true }, verb] }
    ] }], [{ relation: 'relative-operator movement', anchors: { landingOccurrence: 'high', trace: 'low' },
      priorAnchors: { source: 'low' }, values: { label: 'e', index: 'i' } }])
  ]);
  const tree = paintedLabel('NP (tᵢ)ᵢ', { label: 'NP (tᵢ)' });
  const bound = bindRelationPlanFrame(plan, 1, () => ({ x: 0, y: 0 }), {
    hasExistingGapNotation: (id, text) => hasTreeGapNotation(tree, id, text)
  });
  const badges = bound.primitives.filter(primitive => primitive.type === 'text-badge' && primitive.badgeStyle === 'gap-notation');
  assert.deepEqual(badges.map(badge => [badge.nodeId, badge.text, badge.reuseExistingNotation]), [['low', 'e', undefined]]);
});

/* Sol, reviewing ecf4c9e: the tree paints only one of a leaf's label and word
 * unless Replay expands it into a category above its word. For {label: "t",
 * word: "t_i"} only "t_i" is painted, so a model-written gap label "t" is new
 * text and must be drawn. */
test('only the authored text the tree paints counts as the node\'s own', () => {
  const traceWord = { label: 't', word: 't_i' };
  assert.equal(isOwnNodeNotation(traceWord, 't'), false, 'a trace-like label above a word is not painted');
  assert.equal(isOwnNodeNotation(traceWord, 't_i'), true);
  assert.equal(hasTreeGapNotation(paintedLabel('t_i', traceWord, 'terminal'), 'low', 't'), false);
  assert.equal(hasTreeGapNotation(paintedLabel('t_i', traceWord, 'terminal'), 'low', 't_i'), true);
  // An expanded preterminal paints its category and its word.
  const preterminal = { label: 'V⁰', word: 't' };
  assert.equal(isOwnNodeNotation(preterminal, 'V⁰'), true);
  assert.equal(isOwnNodeNotation(preterminal, 't'), true);
  const expanded = { id: 'low', ...preterminal, children: [{ id: 'low::__leaf', label: 't', word: 't', replayOrigin: { kind: 'word', ownerId: 'low' } }] };
  assert.equal(isOwnNodeNotation(expanded, 'V⁰'), true, 'Replay\'s display word does not hide the category\'s word');
  assert.equal(isOwnNodeNotation(expanded, 't'), true);
  // A phrase paints its category label, never a word field.
  assert.equal(isOwnNodeNotation({ label: 'NP', word: 'x', children: [{ id: 'n', label: 'N', word: 'x' }] }, 'x'), false);
});
