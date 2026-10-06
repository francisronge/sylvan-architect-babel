import assert from 'node:assert/strict';
import test from 'node:test';
import { createTreeInkTextMeasure, TERMINAL_FONT, TERMINAL_INDEX_FONT } from '../components/treeInkTextMeasure.ts';

function documentStub(fail = false) {
  const probes = [], nodes = [];
  let removed = 0, appended = 0;
  const canvas = { measureText: text => ({width: text.length * 10,
    actualBoundingBoxLeft: -2, actualBoundingBoxRight: text.length * 10 + 3,
    actualBoundingBoxAscent: 40, actualBoundingBoxDescent: 7,
    fontBoundingBoxAscent: 56, fontBoundingBoxDescent: 14}) };
  const doc = {
    body: {appendChild(node) {appended++;}},
    createElement: () => ({getContext: () => canvas}),
    createElementNS: (_, tag) => {
      const attributes = new Map(), node = {style: {}, children: [],
        appendChild(child) {this.children.push(child);},
        setAttribute(key, value) {attributes.set(key, value);},
        removeAttribute(key) {attributes.delete(key);},
        remove() {removed++;},
        getBBox() {
          probes.push({font:node.style.font, attributes:new Map(attributes)});
          if (fail) throw new Error('unavailable SVG');
          return attributes.has('baseline-shift') ? {x:1,y:-20,width:35,height:47} : {x:0,y:-16,width:40,height:36};
        }
      };
      nodes.push([tag,node]);
      return node;
    }
  };
  return {doc,canvas,probes,nodes,counts:() => ({removed,appended})};
}

test('base text metrics use the renderer font and preserve glyph overhang', () => {
  const state = documentStub(), measure = createTreeInkTextMeasure(state.doc);
  assert.deepEqual(measure('word','terminal'), {width:40,left:2,right:43,ascent:40,descent:7,fontAscent:56,fontDescent:14});
  assert.equal(state.canvas.font, TERMINAL_FONT);
  assert.equal(state.canvas.textBaseline,'alphabetic');
  assert.equal(state.canvas.textAlign,'left');
});

test('index metrics union native subscript and explicit theta baselines once then remove the SVG', () => {
  const state = documentStub(), measure = createTreeInkTextMeasure(state.doc);
  assert.deepEqual(measure('ijk','terminal-index'),
    {width:40,left:0,right:40,ascent:20,descent:27,fontAscent:20,fontDescent:27});
  assert.equal(state.probes[0].font, TERMINAL_INDEX_FONT);
  assert.equal(state.probes[0].attributes.get('baseline-shift'),'sub');
  assert.equal(state.probes[1].attributes.get('dy'),'14');
  assert(!state.probes[1].attributes.has('baseline-shift'));
  assert.equal(state.nodes.find(([tag]) => tag === 'text')[1].style.font, TERMINAL_FONT);
  measure('ijk','terminal-index');
  assert.deepEqual(state.counts(),{removed:1,appended:1});
  assert.equal(state.probes.length,2);
});

test('failed native measurement removes the probe and reports unavailable metrics', () => {
  const state = documentStub(true), measure = createTreeInkTextMeasure(state.doc);
  assert.equal(measure('i','category-index'),undefined);
  assert.deepEqual(state.counts(),{removed:1,appended:1});
  assert.equal(createTreeInkTextMeasure(undefined)('word','terminal'),undefined);
});
