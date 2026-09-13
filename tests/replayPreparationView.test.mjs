import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../components/AsyncTreeVisualizer.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('AsyncTreeVisualizer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = parsed.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportAssignment(node))
  .map(node => node.getText(parsed)).join('\n');
const code = ts.transpile(body + '\nreturn AsyncTreeVisualizer;', { target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.React });

// Deterministic hook scheduling lets a new input render before effect cleanup,
// and lets worker completions arrive in either order without browser timing.
const mount = () => {
  const slots = [], effects = [], jobs = [];
  let cursor = 0;
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  const useRef = initial => useState(() => ({ current: initial }))[0];
  const changed = (previous, next) => !previous || next.some((value, index) => !Object.is(value, previous[index]));
  const useMemo = (create, deps) => {
    const index = cursor++;
    if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: create() };
    return slots[index].value;
  };
  const useEffect = (create, deps) => {
    const index = cursor++;
    if (changed(slots[index]?.deps, deps)) effects.push(() => {
      slots[index]?.cleanup?.();
      slots[index] = { deps, cleanup: create() };
    });
  };
  const start = (input, ready, error) => {
    const job = { input, ready, error, cancelled: false };
    jobs.push(job);
    return () => { job.cancelled = true; };
  };
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  const component = new Function('React', 'useEffect', 'useMemo', 'useRef', 'useState', 'TreeVisualizer', 'startReplayPreparation', code)(
    React, useEffect, useMemo, useRef, useState, 'tree', start
  );
  return { jobs, render: props => { cursor = 0; return component(props); }, flush: () => { while (effects.length) effects.shift()(); } };
};

test('loading never exposes an old analysis, including before effect cleanup', () => {
  const app = mount(), first = { data: { id: 'a' }, derivationStages: [], animated: true, sentence: 'A' };
  assert.notEqual(app.render(first).type, 'tree');
  app.flush();
  const result = { playbackSteps: ['A'] };
  app.jobs[0].ready(result);
  assert.equal(app.render(first).props.preparedReplay, result);
  const second = { ...first, data: { id: 'b' }, derivationStages: [], sentence: 'B' };
  assert.notEqual(app.render(second).type, 'tree');
  app.flush();
  assert(app.jobs[0].cancelled);
  app.jobs[0].ready(result);
  assert.notEqual(app.render(second).type, 'tree');
  app.jobs[1].ready({ playbackSteps: ['B'] });
  assert.equal(app.render(second).props.data, second.data);
});

test('Canopy and Replay share the chosen camera across asynchronous preparation', () => {
  const app = mount(), canopy = { data: { id: 'a' }, derivationStages: [], animated: false };
  app.render(canopy); app.flush(); app.jobs[0].ready({ playbackSteps: [] });
  const camera = app.render(canopy).props.manualCameraState;
  camera.current = { transform: { x: 30, y: 40, k: 0.5 } };
  const replay = { ...canopy, animated: true };
  assert.notEqual(app.render(replay).type, 'tree');
  app.flush(); app.jobs[1].ready({ playbackSteps: ['frame'] });
  assert.equal(app.render(replay).props.manualCameraState, camera);
  const glyph = app.render({ ...replay, abstractionMode: true });
  app.flush();
  assert.equal(app.jobs.length, 2, 'display-only changes must not recompile Replay');
  assert.equal(glyph.props.manualCameraState, camera);
});

test('preparation failures expose retry and keep stale results hidden during retry', () => {
  const app = mount(), props = { derivationStages: [], animated: true };
  app.render(props); app.flush(); app.jobs[0].error(new Error('failed'));
  const failed = app.render(props);
  const find = (node, predicate) => !node || typeof node !== 'object' ? undefined
    : predicate(node) ? node : node.children?.flat(Infinity).map(child => find(child, predicate)).find(Boolean);
  assert(find(failed, node => node.props?.role === 'alert'));
  find(failed, node => node.type === 'button').props.onClick();
  assert.notEqual(app.render(props).type, 'tree');
  app.flush(); assert(app.jobs[0].cancelled);
  app.jobs[1].ready({ playbackSteps: ['frame'] });
  assert.equal(app.render(props).type, 'tree');
});
