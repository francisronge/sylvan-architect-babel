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
  activeStep: steps[index], playbackSteps: steps, derivationStages: stages, sentence: 'word',
  activeStepIndex: index, activeStageDisplayLabel: `Stage 1/1 · Step ${index + 1}/3`,
  canStepBackward: index > 0, canStepForward: index < 2,
  isAutoPlaying: false, isScrubbing: false,
  handlePrevStep: noop, handleNextStep: noop, handleTogglePlayback: noop,
  onFit: noop, onPause: noop, onScrubbingChange: noop, onStepChange: noop,
  ...overrides
});
const render = props => renderToStaticMarkup(React.createElement(ReplayPanel, props));

test('Replay panel retains one measured root, ownership attributes and frame controls', () => {
  const html = render(properties(1, { isAutoPlaying: true }));
  assert.match(html.replace(/^<link[^>]*>/, ''), /^<div data-babel-replay-panel="true"/);
  assert.equal((html.match(/data-babel-replay-panel=/g) || []).length, 1);
  assert.match(html, /data-babel-active-relation-stage-index="0"/);
  assert.match(html, /data-babel-active-relation-index="0"/);
  assert.match(html, /data-babel-played-relation-indices="0"/);
  assert.match(html, /style="bottom:24px;right:32px"/);
  assert.match(html, />Pause<\/button>/);
  assert.match(html, /aria-label="Replay frame" min="0" max="2"/);
  assert.match(html, /value="1"/);
  assert.match(html, /width:50%/);
  assert.match(html, /Replay 2\/3/);
  assert.match(html, /aria-label="Fit tree"/);
});

test('Replay start and end keep their navigation limits and scrubbing presentation', () => {
  const first = render(properties(0));
  const last = render(properties(2, { isScrubbing: true }));
  assert.match(first, /<button[^>]*disabled=""[^>]*>Prev<\/button>/);
  assert.doesNotMatch(first, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
  assert.match(first, />Play<\/button>/);
  assert.match(first, /width:0%/);
  assert.doesNotMatch(last, /<button[^>]*disabled=""[^>]*>Prev<\/button>/);
  assert.match(last, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
  assert.match(last, />Replay<\/button>/);
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
