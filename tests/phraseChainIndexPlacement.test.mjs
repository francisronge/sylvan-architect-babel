import { hierarchy } from 'd3';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { paintSyntaxTree } from '../components/renderer/syntaxDrawing.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import * as movementIndices from '../replay/movementIndices.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';
import { createSvgDom, descendants, select } from './helpers/svgDom.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

// A moved phrase carries its chain index once, on the category label of each
// occurrence; the words inside it carry none unless they head a chain of their
// own. A moved head keeps the index on its word. Theta and identity letters stay put.
const fixture = path => JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'));
const prepare = ({ sentence, inputTokens, derivationStages }) =>
  prepareReplay({ sentence, inputTokens, derivationStages, includePlayback: true });
const finalLabels = prepared => {
  const index = prepared.playbackSteps.length - 1, step = prepared.playbackSteps[index];
  const runs = treeLabelRunsForStep(prepared, index, undefined, { includeRelationIndices: true });
  const tree = hierarchy(step.replayCanvasData);
  applyVizIds(tree);
  // Tests name the final stage's nodes by their authored ids; Replay may rename a moved occurrence.
  const id = name => canonicalId(prepared, name);
  const node = name => tree.descendants().find(candidate => getNodeId(candidate) === id(name));
  const runsOf = nodeId => runs.get(nodeId);
  const text = (name, kind) => runsOf(id(name))?.find(run => run.kind === kind)?.text;
  const letters = name => runsOf(id(name))?.find(run => run.kind === 'terminal')?.indices.map(run => run.text) ?? [];
  const wordsUnder = name => node(name).leaves().map(getNodeId)
    .map(nodeId => runsOf(nodeId)?.find(run => run.kind === 'terminal')?.text).filter(Boolean);
  return { step, index, node, text, letters, wordsUnder, id, runsOf };
};
const CHAIN_DIGIT = /[₀-₉]/;

test('a moved CP shows its index on its label and its trace, not on each of its words', () => {
  // Lena vermutet, dass der neue Nachbar den alten Wagen reparieren wird: the
  // embedded CP extraposes. Before, every word of it read dass₁ der₁ neue₁ …
  const labels = finalLabels(prepare(fixture('movement/clause-context.json').cases[2]));
  assert.equal(labels.text('embeddedCP', 'category'), 'CP₁');
  assert.equal(labels.text('contentTrace', 'category'), 'CP trace₁');
  const words = labels.wordsUnder('embeddedCP');
  assert.deepEqual(words, ['dass', 'der', 'neue', 'Nachbar', 'den', 'alten', 'Wagen', 'reparieren', 'wird']);
  assert(words.every(word => !CHAIN_DIGIT.test(word)));
  // The theta letters each word already had stay where they were.
  assert.deepEqual(labels.letters('neighborN::__leaf'), ['i']);
  assert.deepEqual(labels.letters('carN::__leaf'), ['j']);
  assert.deepEqual(labels.letters('lenaN::__leaf'), ['k']);
});

test('a moved head keeps its index on its word, and a phrase copy shows its index once', () => {
  // What did Mia see? The wh-phrase indexes both DP labels; did keeps its own.
  const labels = finalLabels(prepare(fixture('normalized/what-did-mia-see.xbar.json').analyses[0]));
  assert.equal(labels.text('did_high', 'terminal'), 'did₂');
  assert.equal(labels.text('c_question', 'category'), 'C');
  assert.equal(labels.text('dp_what_high', 'category'), 'DP₁');
  assert.equal(labels.text('what_high', 'terminal'), 'What');
  assert.equal(labels.text('dp_what_low', 'category'), 'DP₁');
  // The trace witness lies inside the lower copy whose label already shows ₁.
  assert.equal(labels.text('what_low', 'category'), 'what');
});

test('a phrase inside a moved phrase keeps the index of its own chain', () => {
  // The woman whose car was stolen: [D₂ the woman [whose car]₁ … D[trace]₁ …].
  const labels = finalLabels(prepare(fixture('replay-regressions/later-occupant-intermediate-landing.json')));
  assert.equal(labels.text('womanDP', 'category'), 'D₂');
  assert.equal(labels.text('carDP', 'category'), 'D₁');
  assert.equal(labels.text('carSubjectTrace', 'category'), 'D[trace]₁');
  const words = labels.wordsUnder('womanDP');
  assert(words.includes('whose') && words.includes('stolen'));
  assert(words.every(word => !CHAIN_DIGIT.test(word)), words.join(' '));
  // The leaf of carDP that shows "car", under whatever id Replay gives it.
  const car = labels.node('carDP').leaves().map(getNodeId).map(id => labels.runsOf(id)?.find(run => run.kind === 'terminal'))
    .find(run => run?.text === 'car');
  assert.deepEqual(car.indices.map(run => run.text), ['i']);
});

const { Element, restore } = createSvgDom();
after(restore);

test('the painter draws the same category and word texts as the label runs', () => {
  const prepared = prepare(fixture('movement/clause-context.json').cases[2]);
  const { step, index, text, id: canonical } = finalLabels(prepared);
  assert.equal(typeof movementIndices.buildResolvedLinkChainIndices, 'function');
  const frame = prepared.replayDerivationFrames[step.replayFrameIndex];
  const chain = movementIndices.buildResolvedLinkChainIndices(frame.workspaceForest, step.replayRelationLinks,
    step.replayFrameIndex, prepared.movementChainIndexCatalogue);
  const canvas = step.replayCanvasData, tree = hierarchy(canvas), root = new Element('g');
  applyVizIds(tree);
  tree.descendants().forEach((node, order) => { node.x = order * 100; node.y = node.depth * 180; });
  paintSyntaxTree({ treeData: tree, rootHierarchy: tree, clonedCanvasData: canvas, g: select(root),
    playbackSteps: [], animated: false, activeStepIndex: index, replayVisibleNodeIdSet: null,
    traceDisplayIndexByNodeId: chain.terminals, phraseChainIndexByNodeId: chain.phrases, traceDisplayFrame: frame,
    traceDisplayRelationLinks: step.replayRelationLinks, traceDisplayFrameIndex: step.replayFrameIndex,
    usesDerivationFrames: true, activeDerivationArrowLinks: [], terminalMorphRef: { current: new Map() },
    firstSentenceReplayToken: '', firstSentenceReplayDisplayToken: '', relationRenderPlan: null,
    measureCategoryText: value => [...value].length * 25, currentReplayStep: step,
    pendingPhraseFrontingSourceNodeIds: new Set(), hasDerivationFrames: true });
  const painted = (kind, name) => descendants(root).find(element => element.attrs.class === `${kind}-label`
    && element.attrs[kind === 'category' ? 'data-category-node-id' : 'data-node-id'] === canonical(name));
  const content = element => element.children.length ? element.children.map(child => child.text).join('') : element.text;
  for (const id of ['embeddedCP', 'contentTrace', 'embeddedC'])
    assert.equal(content(painted('category', id)), text(id, 'category'), id);
  for (const id of ['embeddedC::__leaf', 'neighborD::__leaf', 'embeddedI::__leaf', 'carN::__leaf'])
    assert.equal(content(painted('terminal', id)), text(id, 'terminal'), id);
  assert.equal(content(painted('category', 'embeddedCP')), 'CP₁');
});
