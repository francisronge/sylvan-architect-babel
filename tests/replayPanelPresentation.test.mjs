import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [new URL('../components/ReplayPanel.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'local-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const { default: ReplayPanel } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const noop = () => {};
const canvas = { id: 'n', label: 'N', word: 'word', children: [] };
const steps = [
  { operation: 'LexicalSelect', replayKind: 'micro', targetNodeId: 'n', targetLabel: 'word', sourceLabels: [] },
  { operation: 'Relation', replayKind: 'relation', targetNodeId: 'n', targetLabel: 'N', sourceLabels: [],
    replayCanvasData: canvas, replayFrameIndex: 0, replayRelationIdentity: { stageIndex: 0, relationIndex: 0 } },
  { operation: 'Derivation', replayKind: 'macro', targetNodeId: 'n', targetLabel: 'N', sourceLabels: [],
    replayFrameIndex: 0, stageRecord: 'An authored explanation.',
    detailBlocks: [{ title: 'Stage Record', lines: ['An authored explanation.'] }] }
];
const stages = [{ statement: 'An authored statement.', stageRecord: 'An authored explanation.',
  workspaceForest: [canvas],
  relations: [{ relation: 'Open relation', anchors: { bearer: 'n' }, values: { bearer: '', note: '<original>' } }] }];
const properties = (index, overrides = {}) => ({
  panelRef: { current: null }, bottom: 24, right: 32,
  currentReplayKind: steps[index].replayKind,
  activeRelationMoment: index === 1 ? { stageIndex: 0, relationIndex: 0 } : null,
  playedRelationIndicesAttribute: index > 0 ? '0' : '',
  activeStep: steps[index], playbackSteps: steps, derivationStages: stages, sentence: 'word', inputTokens: ['word'],
  activeStepIndex: index,
  canStepBackward: index > 0, canStepForward: index < 2,
  isAutoPlaying: false, isScrubbing: false,
  handlePrevStep: noop, handleNextStep: noop, handleTogglePlayback: noop,
  onFit: noop, onPause: noop, onScrubbingChange: noop, onStepChange: noop,
  ...overrides
});
const render = props => renderToStaticMarkup(React.createElement(ReplayPanel, props));
// The playback buttons are icons; each keeps its name as hidden text.
const button = (html, name) => html.match(new RegExp(`<button(?:(?!</button>).)*<span class="sr-only">${name}</span></button>`))?.[0] ?? '';

test('Replay panel retains one measured root, ownership attributes and frame controls', () => {
  const html = render(properties(1, { isAutoPlaying: true }));
  assert.match(html.replace(/^<link[^>]*>/, ''), /^<div data-babel-replay-panel="true"/);
  assert.equal((html.match(/data-babel-replay-panel=/g) || []).length, 1);
  assert.match(html, /data-babel-active-relation-stage-index="0"/);
  assert.match(html, /data-babel-active-relation-index="0"/);
  assert.match(html, /data-babel-played-relation-indices="0"/);
  assert.match(html, /style="bottom:24px;right:32px"/);
  assert.ok(button(html, 'Pause'));
  assert.match(html, /aria-label="Replay frame" min="0" max="2"/);
  assert.match(html, /value="1"/);
  assert.match(html, /<input type="range"[^>]*aria-valuetext="Replay 2\/3"/, 'the slider announces the visible Replay position');
  assert.match(html, /style="left:50%;transform/, 'the knob is halfway along');
  assert.match(html, /Replay 2\/3/);
  assert.match(html, /aria-label="Fit tree"/);
});

test('Replay start and end keep their navigation limits and scrubbing presentation', () => {
  const first = render(properties(0));
  const last = render(properties(2, { isScrubbing: true }));
  assert.match(button(first, 'Prev'), /disabled=""/);
  assert.doesNotMatch(button(first, 'Next'), /disabled=""/);
  assert.ok(button(first, 'Play'));
  assert.match(first, /width:0%/);
  assert.doesNotMatch(button(last, 'Prev'), /disabled=""/);
  assert.match(button(last, 'Next'), /disabled=""/);
  assert.ok(button(last, 'Replay'));
  assert.match(last, /width:100%/);
  assert.doesNotMatch(last, /transition-all duration-150/);
  assert.doesNotMatch(last, /data-babel-active-relation-index=/);
});

test('authored literals and stage explanations survive panel extraction unchanged', () => {
  const before = structuredClone({ steps, stages });
  const relation = render(properties(1));
  assert.match(relation, />Open relation<\/div>/);
  assert.match(relation, /word.*· &quot;&quot;/);
  assert.match(relation, /&lt;original&gt;/);
  assert.doesNotMatch(relation, /<original>/);
  const macro = render(properties(2));
  assert.equal((macro.match(/An authored explanation\./g) || []).length, 1);
  assert.deepEqual({ steps, stages }, before);
});

test('the stage rail has one segment per stage, sized by its steps, filled up to the current step', async () => {
  const { buildReplayStageRuns } = await import('../replay/replayPanel.ts');
  const staged = [0, 0, 0, 1, undefined, 2, 2].map((replayFrameIndex, index) => ({ ...steps[0], replayFrameIndex, replayKind: 'micro', replayRelationIdentity: undefined, targetNodeId: `n${index}` }));
  assert.deepEqual(buildReplayStageRuns(staged), [{ start: 0, count: 3 }, { start: 3, count: 2 }, { start: 5, count: 2 }],
    'a step with no stage joins the run before it');
  const html = render(properties(0, { playbackSteps: staged, activeStep: staged[4], activeStepIndex: 4, canStepForward: true }));
  const segments = [...html.matchAll(/data-babel-replay-stage-segment="(\w+)"[^>]*style="left:calc\(([\d.]+)%[^"]*"><div[^>]*style="width:([\d.]+)%"/g)]
    .map(([, state, left, width]) => [state, Math.round(Number(left)), Math.round(Number(width))]);
  // Stage edges sit halfway between neighbouring stages' steps: (3 - 0.5) / 6 and (5 - 0.5) / 6.
  assert.deepEqual(segments, [['played', 0, 100], ['active', 42, 75], ['ahead', 75, 0]]);
  assert.match(html, /aria-valuetext="Replay 5\/7"/);
});

test('the knob is painted where the range input puts that step, so pressing it keeps the step', () => {
  const staged = [0, 0, 1, 2, 2].map(replayFrameIndex => ({ ...steps[0], replayFrameIndex, replayKind: 'micro', replayRelationIdentity: undefined }));
  staged.forEach((step, index) => {
    const html = render(properties(0, { playbackSteps: staged, activeStep: step, activeStepIndex: index }));
    const knob = html.match(/pointer-events-none[^"]*" style="left:([\d.]+)%/)?.[1];
    assert.equal(Number(knob), (index / (staged.length - 1)) * 100, `step ${index + 1}`);
  });
});

test('the header tree starts with its first branches and gains a level each third of the derivation', async () => {
  const { replayGrowthLevel } = await import('../replay/replayPanel.ts');
  // 43 steps: thirds begin at indices 14 and 28.
  assert.deepEqual([0, 13, 14, 27, 28, 42].map(index => replayGrowthLevel(index, 43)), [2, 2, 3, 3, 4, 4]);
  assert.equal(replayGrowthLevel(0, 1), 4, 'a one-step Replay is complete');
  assert.equal(replayGrowthLevel(-3, 10), 2, 'never only a root');
  assert.equal(replayGrowthLevel(99, 10), 4);
});

test("a stage's own step leads with its statement and names its record with a run-in label", () => {
  const html = render(properties(2));
  assert.equal(steps[2].replayKind, 'macro');
  assert.doesNotMatch(html, /data-babel-replay-summary/, 'no "Stage Record" title');
  assert.match(html, /An authored statement\./);
  assert.match(html, /text-\[13px\] leading-\[1\.5\][^"]*"><span[^>]*>Stage record<\/span>An authored explanation\./,
    'the Stage Record at 13px, named by a run-in label');
});

test('workspace labels sit on the words baseline, not dropped as subscripts', () => {
  const tree = { id: 'dp', label: 'DP', children: [{ id: 'd', label: 'D', word: 'the' }, { id: 'n2', label: 'N', word: 'cat' }] };
  const micro = { ...steps[0], replayCanvasData: tree, replayVisibleNodeIds: ['dp', 'd', 'n2'], replayFrameIndex: 0, targetNodeId: 'dp' };
  const html = render(properties(0, { activeStep: micro, playbackSteps: [micro, steps[1], steps[2]], inputTokens: ['the', 'cat'] }));
  assert.match(html, /data-babel-replay-workspace/);
  assert.doesNotMatch(html, /<sub/, 'a subscript drops the label below the words');
});


test('relation lines are two columns: role names in lower case beside their values, in the serif', async () => {
  const { relationLineLabel } = await import('../replay/replayPanel.ts');
  const html = render(properties(1));
  assert.match(html, /data-babel-replay-relation-lines="true"[^>]*class="grid grid-cols-\[fit-content\(40%\)_minmax\(0,1fr\)\]/);
  assert.match(html, /class="grid grid-cols-subgrid col-span-2"/, 'each line is one row of the shared columns');
  assert.match(html, /<span class="serif italic[^"]*text-right[^"]*">bearer<\/span><span class="serif [^"]*text-emerald-50[^"]*border-l/,
    'the role name right-aligned in lower case, its value after the rule');
  assert.deepEqual(['Theta Role', 'EPP Feature', 'vP', 'PRO Controller', 'Goal (previous stage)', 'Ποιος'].map(relationLineLabel),
    ['theta role', 'EPP feature', 'vP', 'PRO controller', 'goal (previous stage)', 'Ποιος']);
});
