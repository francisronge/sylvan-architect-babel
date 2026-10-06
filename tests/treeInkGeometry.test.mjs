import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { collectTreeInkMeasurements, treeInkObstacles, prepareTreeInkSubtrees } from '../replay/treeInkGeometry.ts';
import { visibleComponentNodes } from '../replay/visibleComponent.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { REPLAY_GENERATED_TERMINAL_GLYPHS, formatIndexedSurfaceForDisplayValue } from '../replay/replayCompiler.ts';

const widths = text => [...text].length * 20;
const metrics = (text, style) => ({ width: widths(text), left: 0, right: widths(text),
  ascent: style === 'category' ? 31 : 43, descent: style.includes('index') ? 24 : 2,
  fontAscent: style === 'terminal' ? 56 : 42, fontDescent: 14 });
const nodes = () => {
  const root = d3.hierarchy({ id: 'root:with:colons', label: 'V', children: [
    { id: 'word:with:colons', label: 'mér', word: 'mér' }
  ] });
  applyVizIds(root);
  root.each(node => { node.x = 300; node.y = node.depth * 210; });
  return root.descendants();
};

test('composed subtree ink exactly preserves roots, visibility holes, styled variants and precise branch order', () => {
  const root = d3.hierarchy({ id: 'forest', label: 'workspace', replayOrigin: { kind: 'workspace' }, children: [
    { id: 'root', label: 'CP', children: [
      { id: 'left', label: 'NP', children: [{ id: 'word', label: 'N', word: 'Mér' }] },
      { id: 'hidden', label: 'VP', children: [
        { id: 'gap', label: 't_i' }, { id: 'right', label: 'V', word: 'saw' }
      ] }
    ] }, { id: 'other', label: 'C', word: 'that' }
  ] });
  applyVizIds(root);
  root.each((node, i) => { node.x = (i % 2 ? -1 : 1) * (125.25 + i * 200); node.y = node.depth * 210.75; });
  const all = root.descendants();
  const labels = new Map(all.map(node => [getNodeId(node), [
    { kind: 'category', bounds: { x: -48, y: -39, width: 97, height: 46 } },
    { kind: 'category', bounds: { x: -58, y: -41, width: 114, height: 53 } },
    { kind: 'terminal', bounds: { x: -88, y: 66, width: 161, height: 72 } }
  ]]));
  for (const hidden of [[], ['forest'], ['hidden'], ['forest', 'hidden'], ['left', 'word']]) {
    const visible = new Map(all.filter(node => !hidden.includes(getNodeId(node))).map(node => [getNodeId(node), node]));
    for (const precise of [false, true]) for (const inkMeasure of [undefined, metrics])
      for (const styled of [undefined, run => run.bounds, run => run.kind === 'terminal' ? undefined : run.bounds]) {
        const prepared = prepareTreeInkSubtrees(visible, widths, inkMeasure, precise, labels, styled);
        for (const node of [...all].reverse()) assert.deepEqual(prepared(node),
          treeInkObstacles(visibleComponentNodes(node, visible), widths, inkMeasure, precise, labels, styled),
          `${getNodeId(node)} with hidden ${hidden} retains complete ordered ink`);
      }
  }
});

test('missing or nonfinite font metrics preserve the existing rectangles exactly', () => {
  for (const measure of [undefined, () => undefined, () => ({width:1,left:0,right:1}),
    () => ({...metrics('', 'terminal'), descent: NaN})]) {
    const current = nodes();
    assert.deepEqual(treeInkObstacles(current, widths, measure, true), plaqueTreeObstacles(current, widths, true));
  }
});

test('terminal envelope includes case variants, fallback font and every generated index glyph', () => {
  const requests = [];
  const measure = (text, style) => {
    requests.push([text, style]);
    return { ...metrics(text, style),
      descent: text === REPLAY_GENERATED_TERMINAL_GLYPHS && style === 'terminal' ? 29 : 2,
      fontAscent: text === 'Mér' && style === 'terminal' ? 71 : 56 };
  };
  const result = collectTreeInkMeasurements('V', 'mér', widths, measure);
  assert.equal(result.terminal.ascent, 71);
  assert.equal(result.terminal.descent, 29);
  assert(requests.some(([text, style]) => text === 'Mér' && style === 'terminal'));
  for (const index of [...'abcdefghijklmnopqrstuvwxyz', ...Array.from({length:100}, (_, i) => String(i + 1))]) {
    const appended = formatIndexedSurfaceForDisplayValue('word', index).slice(4);
    assert([...appended].every(glyph => REPLAY_GENERATED_TERMINAL_GLYPHS.includes(glyph)));
  }
});

test('syntax validation uses exact baselines and stroke while plaque placement is unchanged', () => {
  const current = nodes(), old = plaqueTreeObstacles(current, widths, true);
  const ink = treeInkObstacles(current, widths, metrics, true);
  assert.deepEqual(plaqueTreeObstacles(current, widths, true), old);
  const id = getNodeId(current[1]);
  const terminal = ink.find(rect => rect.connectorAttachment === `${id}:terminal`);
  const oldTerminal = old.find(rect => rect.connectorAttachment === `${id}:terminal`);
  assert.equal(terminal.x, oldTerminal.x);
  assert.equal(terminal.width, oldTerminal.width);
  assert.equal(terminal.y, 210 + 115 - 56 - 4);
  assert.equal(terminal.y + terminal.height, 210 + 115 + 24 + 4);
  assert.deepEqual(ink.find(rect => rect.terminalStemNodeId === id),
    {x: 298.5, y:228.5, width:3, height:48, terminalStemNodeId:id});
  const category = ink.find(rect => rect.connectorAttachment === 'root:with:colons:category');
  assert.equal(category.y, -10 - 43 - 5);
  assert.equal(category.y + category.height, -10 + 24 + 5);
});

test('an unavailable index baseline prevents a smaller terminal envelope', () => {
  const current = nodes();
  const measure = (text, style) => style === 'terminal-index' ? undefined : metrics(text, style);
  const original = plaqueTreeObstacles(current, widths);
  const changed = treeInkObstacles(current, widths, measure);
  for (const rect of original.filter(rect => rect.terminalStemNodeId || rect.connectorAttachment?.endsWith(':terminal'))) {
    assert(changed.some(other => JSON.stringify(other) === JSON.stringify(rect)));
  }
});

test('wrapped category lines are measured separately with native 48px baselines', () => {
  const current = nodes(); current[0].data.label = 'a very long category label that wraps over several lines';
  const requests = [];
  const measure = (text, style) => { requests.push([text, style]); return metrics(text, style); };
  const measured = collectTreeInkMeasurements(current[0].data.label, undefined, widths, measure);
  assert(measured.category.length > 1);
  assert.equal(measured.category.map(run => run.line).join(''), current[0].data.label);
  assert(measured.category.every(run => requests.some(([text, style]) => text === run.line && style === 'category')));
  const ink = treeInkObstacles(current, widths, measure).filter(rect => rect.connectorAttachment === 'root:with:colons:category');
  assert.equal(ink[1].y - ink[0].y, 48);
});

test('a coincident foreign stem keeps its old envelope when its metrics are unavailable', () => {
  const current = nodes();
  const foreign = {...current[1], data: {...current[1].data, id:'foreign', label:'unavailable', word:'unavailable'}};
  delete foreign.__vizId;
  const all = [...current, foreign];
  const measure = (text, style) => text.toLowerCase() === 'unavailable' ? undefined : metrics(text, style);
  const old = plaqueTreeObstacles(all, widths);
  const ownStem = old.find(rect => rect.terminalStemNodeId === getNodeId(current[1]));
  const foreignStem = old.find(rect => rect.terminalStemNodeId === 'foreign');
  assert.deepEqual([ownStem.x, ownStem.y, ownStem.width, ownStem.height],
    [foreignStem.x, foreignStem.y, foreignStem.width, foreignStem.height]);
  const after = treeInkObstacles(all, widths, measure);
  assert.deepEqual(after.find(rect => rect.terminalStemNodeId === 'foreign'), foreignStem);
  assert.equal(after.find(rect => rect.terminalStemNodeId === getNodeId(current[1])).height, 48);
});

test('a glyph wider than the old word reserve keeps that entire conservative envelope', () => {
  const current = nodes();
  const measure = (text, style) => ({...metrics(text, style),
    ...(style === 'terminal' && text === 'mér' ? {width:300,right:300} : {})});
  const old = plaqueTreeObstacles(current, widths), after = treeInkObstacles(current, widths, measure);
  const key = `${getNodeId(current[1])}:terminal`;
  assert.deepEqual(after.find(rect => rect.connectorAttachment === key), old.find(rect => rect.connectorAttachment === key));
  assert.equal(after.find(rect => rect.terminalStemNodeId).height, 130);
});
