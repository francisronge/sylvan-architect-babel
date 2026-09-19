import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as d3 from 'd3';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';

// Exercise the renderer's actual path expression, including any label-dependent
// endpoint adjustment, so a tall label cannot silently reshape a native branch.
const source = ts.createSourceFile('TreeVisualizer.tsx',
  fs.readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let pathExpression;
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'attr' && node.arguments[0]?.text === 'd'
    && node.expression.expression.getText(source).includes(".attr('class', 'branch')")) {
    assert.equal(pathExpression, undefined, 'one native branch path authority');
    pathExpression = node.arguments[1].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert(pathExpression, 'renderer native branch path');
const measure = text => [...text].length * 25;
const code = ts.transpile(`const path = ${pathExpression};`, { target: ts.ScriptTarget.ESNext });
const draw = new Function('d3', 'categoryTextLayout', 'measureCategoryText', `${code}\nreturn path;`)(d3, categoryTextLayout, measure);

test('wrapped categories preserve the original downward branch instead of moving its endpoint upward', () => {
  const native = d3.linkVertical().x(d => d.x).y(d => d.y);
  for (const label of ['I', 'I[finite, present, perfect, third-person singular]', 'I[' + 'long feature, '.repeat(12) + ']']) {
    for (const x of [-400, 400]) {
      const link = { source: { x: 0, y: 0 }, target: { x, y: 180, data: { label } } };
      assert.equal(draw(link), native(link), label);
    }
  }
});
