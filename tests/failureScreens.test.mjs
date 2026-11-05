import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeFailure } from '../components/workspace/failureKinds.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const loadComponent = async (file) => {
  const compiled = await build({
    entryPoints: [path.join(root, file)], bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'local-test-dependencies', setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({ path: pathToFileURL(require.resolve(specifier)).href, external: true }));
    } }]
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)).default;
};

const failure = (cls, ruleId) => ({ class: cls, ruleId, stageIndex: null, fieldPath: '$', offendingValue: null });

test('each failure Babel can send shows the screen for what happened, with the action that can help', () => {
  const cases = [
    // The model wrote an analysis Babel cannot use: another try usually works.
    [{ code: 'BAD_MODEL_RESPONSE', failure: failure('linguistic_failure', 'SPELLOUT_MISMATCH') }, 'broken', /didn't hold together/, ['retry', 'edit']],
    [{ code: 'BAD_MODEL_RESPONSE', failure: failure('linguistic_failure', 'SPELLOUT_WORD_ORDER') }, 'broken', /didn't hold together/, ['retry', 'edit']],
    [{ code: 'BAD_MODEL_RESPONSE', failure: failure('linguistic_failure', 'SPELLOUT_GROUP_SPLIT') }, 'broken', /didn't hold together/, ['retry', 'edit']],
    [{ code: 'INCOMPLETE_GENERATION', failure: failure('incomplete_generation', 'GENERATION_COMPLETED_STOP_FAILURE') }, 'broken', /didn't hold together/, ['retry', 'edit']],
    [{ code: 'BAD_MODEL_RESPONSE', failure: failure('transport_serialization', 'TRANSPORT_JSON_DELIMITERS_BALANCED') }, 'broken', /didn't hold together/, ['retry', 'edit']],
    [{ code: 'BAD_MODEL_RESPONSE', failure: failure('contract_misunderstanding', 'STAGE_WORKSPACE_ROOTS') }, 'broken', /didn't hold together/, ['retry', 'edit']],
    // No answer: another try usually works.
    [{ code: 'PROVIDER_TIMEOUT' }, 'noAnswer', /took too long/, ['retry', 'edit']],
    [{ code: 'PROVIDER_UNAVAILABLE' }, 'noAnswer', /busy, or the connection dropped/, ['retry', 'edit']],
    [{ code: 'LIMITS_UNAVAILABLE' }, 'noAnswer', /busy/, ['retry', 'edit']],
    [{ code: 'HTTP_ERROR' }, 'noAnswer', /busy/, ['retry', 'edit']],
    [{}, 'noAnswer', /busy/, ['retry', 'edit']],
    // A provider refusing Babel's request is not the visitor's sentence.
    [{ code: 'INVALID_REQUEST', failure: failure('transport_serialization', 'PROVIDER_REQUEST') }, 'noAnswer', /busy/, ['retry', 'edit']],
    // Today's parses are used up: only tomorrow helps.
    [{ code: 'RATE_LIMITED_DAILY' }, 'visitorLimit', /Tree Bank/, ['treeBank']],
    [{ code: 'DAILY_CAPACITY_REACHED' }, 'siteLimit', /Come back tomorrow/, ['treeBank']],
    [{ code: 'PROVIDER_QUOTA' }, 'siteLimit', /Come back tomorrow/, ['treeBank']],
    // Babel would not send the sentence.
    [{ code: 'INVALID_REQUEST', failure: failure('transport_serialization', 'REQUEST_SENTENCE_LENGTH') }, 'sentence', /600 characters/, ['edit']]
  ];
  for (const [error, kind, explanation, actions] of cases) {
    const copy = describeFailure({ message: 'provider text that is never shown', ...error });
    assert.equal(copy.kind, kind, JSON.stringify(error));
    assert.match(copy.explanation, explanation, JSON.stringify(error));
    assert.deepEqual(copy.actions, actions, JSON.stringify(error));
    assert.ok(!`${copy.headline} ${copy.explanation}`.includes('provider text'), 'the provider message never shows');
  }
});

test('each failure screen shows the sentence, its tree, what happened and its actions, and nothing of the provider', async () => {
  const FailureScreen = await loadComponent('components/workspace/FailureScreen.tsx');
  const render = (error) => renderToStaticMarkup(React.createElement(FailureScreen, {
    error: { message: 'OpenAI org-secret said no', ...error }, sentence: 'Mia <laughed>.', onRetry() {}, onEdit() {}, onOpenTreeBank() {}
  }));
  const broken = render({ code: 'BAD_MODEL_RESPONSE', failure: failure('linguistic_failure', 'SPELLOUT_MISMATCH') });
  assert.match(broken, /data-babel-failure-screen="broken"/);
  assert.match(broken, /“Mia &lt;laughed&gt;\.”/);
  assert.match(broken, /class="failure-arm"/, 'the snapped arm falls');
  assert.match(broken, /role="alert"[^>]*><h2[^>]*>This tree came out broken\./);
  assert.match(broken, />Try again</);
  assert.match(broken, />Edit sentence</);
  assert.ok(!broken.includes('org-secret'));

  const rained = render({ code: 'PROVIDER_UNAVAILABLE' });
  assert.match(rained, /data-babel-failure-screen="noAnswer"/);
  assert.match(rained, /class="failure-cloud"/);
  assert.equal((rained.match(/class="failure-rain"/g) ?? []).length, 3, 'a sparse drizzle of teardrops');

  const treesIn = html => (html.match(/<g transform="translate/g) ?? []).length;
  for (const [code, trees] of [['RATE_LIMITED_DAILY', 0], ['DAILY_CAPACITY_REACHED', 3]]) {
    const resting = render({ code });
    assert.match(resting, /class="failure-moon"/);
    assert.equal((resting.match(/class="failure-star"/g) ?? []).length, 3);
    assert.equal(treesIn(resting), trees, code === 'RATE_LIMITED_DAILY' ? "the visitor's one tree" : "Babel's grove of three");
    assert.match(resting, />Open Tree Bank</);
    assert.ok(!resting.includes('Try again'), 'no retry that cannot work until tomorrow');
  }
});

test('every failure tree animates; only the drizzle keeps going, and reduced motion starts at rest', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(path.join(root, 'styles.css'), 'utf8');
  for (const name of ['failure-arm', 'failure-cloud', 'failure-rain', 'failure-moon', 'failure-star']) {
    const rule = css.match(new RegExp(`\\.${name} \\{[^}]*animation:([^;]*);`));
    assert.ok(rule, `${name} animates`);
    // Rain is weather, not progress; nothing that grows may loop, or it would look as if it were still waiting.
    if (name !== 'failure-rain') assert.ok(!/infinite/.test(rule[1]), `${name} plays once`);
  }
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.failure-arm, \.failure-cloud, \.failure-rain, \.failure-moon, \.failure-star \{ animation: none; \}/);
});
