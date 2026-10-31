import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [new URL('../components/FailurePanel.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'local-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const { default: FailurePanel, dismissesFailure } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

const evidence = {
  message: 'The response was rejected.',
  failure: { class: 'contract', ruleId: 'STAGE_FIELDS', stageIndex: 1, fieldPath: 'derivationStages[1]', offendingValue: { extra: true } },
  rawOutput: { data: 'e30=', mediaType: 'text/plain', sha256: 'a'.repeat(64), retainedByteLength: 2, truncated: false },
  generationRecord: { runId: 'controlled' },
  sentence: 'Nia laughed.'
};
const render = props => renderToStaticMarkup(React.createElement(FailurePanel, props));
const dismissControl = /<button type="button" aria-label="Dismiss failure" title="Dismiss failure \(Esc\)"[^>]*>.*?<\/button>/;

test('a dismissible failure offers one named button and keeps its diagnostics and downloads', () => {
  const markup = render({ ...evidence, onDismiss: () => {} });
  assert.match(markup, dismissControl);
  assert.equal(markup.match(/aria-label="Dismiss failure"/g).length, 1);
  assert.match(markup, /role="alert"[^>]*>The response was rejected\.</);
  for (const retained of ['STAGE_FIELDS', 'derivationStages[1]', 'Offending value', 'Download raw output (2 bytes)',
    'Inspect failed output', 'Download failure record'])
    assert.ok(markup.includes(retained), `the panel still offers ${retained}`);
});

test('without a dismiss handler the panel is otherwise identical and offers no dismissal', () => {
  const plain = render(evidence);
  assert.doesNotMatch(plain, /Dismiss failure/);
  assert.equal(plain, render({ ...evidence, onDismiss: () => {} }).replace(dismissControl, ''));
});

test('Escape dismisses from the console, but not inside the inspection dialog or while composing', () => {
  const inside = selector => ({ closest: wanted => (wanted === selector ? {} : null) });
  const key = (overrides = {}) => ({ key: 'Escape', defaultPrevented: false, isComposing: false, target: inside(null), ...overrides });
  assert.equal(dismissesFailure(key()), true, 'Escape in the sentence input or panel');
  assert.equal(dismissesFailure(key({ target: null })), true);
  assert.equal(dismissesFailure(key({ target: inside('dialog') })), false, 'the dialog closes itself only');
  assert.equal(dismissesFailure(key({ isComposing: true })), false, 'Escape cancels a composition first');
  assert.equal(dismissesFailure(key({ defaultPrevented: true })), false, 'a handled Escape is left alone');
  assert.equal(dismissesFailure(key({ key: 'Enter' })), false);
});
