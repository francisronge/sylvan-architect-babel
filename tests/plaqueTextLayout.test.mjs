import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fallbackPlaqueTextMeasure,
  preparePlaqueTextLayout
} from '../replay/relations/plaqueTextLayout.ts';
import { bindRelationPlanFrame, boundOverlayBounds } from '../replay/relations/geometryBinding.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const segments = (text) => Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text),
  ({ segment }) => segment);
const measureText = (text, style) => ({
  width: segments(text).length * (style.fontSize * 0.6 + style.letterSpacing),
  ascent: style.fontSize * 0.8,
  descent: style.fontSize * 0.2
});
const content = (count = 12) => ({
  title: 'Authored feature details',
  rows: Array.from({ length: count }, (_, index) => ({ label: `row${index + 1}`, value: `literal${index + 1}` }))
});
const planFor = (contents, plaqueStyle) => ({
  frames: [{ items: contents.map((value, index) => ({
    kind: 'node-plaque', plaqueStyle, anchorNodeIds: ['anchor'], ...value,
    relationRef: { stageIndex: 0, relationIndex: index, relation: 'Literal', anchors: { bearer: 'anchor' } }
  })) }]
});
const positionFor = () => ({ x: 80, y: 100 });
const assertContained = (layout) => {
  for (const block of [layout.title, ...layout.rows].filter(Boolean)) {
    for (const line of block.lines) {
      assert.ok(line.x >= 0);
      assert.ok(line.x + line.width <= layout.width, `${line.text} exceeds the right edge`);
      assert.ok(line.y - line.ascent >= 0, `${line.text} exceeds the top edge`);
      assert.ok(line.y + line.descent <= (layout.overflow?.contentHeight ?? layout.height), `${line.text} exceeds the bottom edge`);
    }
  }
};

test('feature wrapping measures 30px ink plus letter spacing, not the old 22-character limit', () => {
  const input = { title: 'T bearer', rows: [{ label: 'value', value: 'abcdefghijklmnopqrstuv' }] };
  const layout = preparePlaqueTextLayout(input, { variant: 'feature', measureText });
  assert.equal(layout.width, 360);
  const row = layout.rows[0];
  assert.deepEqual(row.style, {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 30, fontWeight: 800, letterSpacing: 0.6
  });
  assert.ok(measureText('abcdefghijklmnopqrstuv', row.style).width > 360 - 18 * 2,
    'the old 22-character chunk cannot fit the accepted rectangle');
  assert.ok(row.lines.length > 1);
  assert.equal(row.lines.map((line) => line.text).join(''), '[value: abcdefghijklmnopqrstuv]');
  row.lines.forEach((line) => assert.ok(line.width <= 324));
  assertContained(layout);
});

test('feature title wrapping measures the existing uppercase title font and leaves input untouched', () => {
  const input = { title: 'An unusually long literal title', rows: [{ label: 'Case', value: 'NOM' }] };
  const before = structuredClone(input);
  const seen = [];
  const layout = preparePlaqueTextLayout(input, {
    variant: 'feature', measureText: (text, style) => {
      seen.push({ text, style });
      return measureText(text, style);
    }
  });
  assert.deepEqual(input, before);
  assert.equal(layout.title.lines.map((line) => line.text).join(''), input.title.toUpperCase());
  assert.ok(layout.title.lines.length > 1);
  assert.ok(seen.some(({ text, style }) => text === input.title.toUpperCase()
    && style.fontSize === 20 && style.fontWeight === 800 && style.letterSpacing === 2.4));
  const lastTitle = layout.title.lines.at(-1);
  const firstRow = layout.rows[0].lines[0];
  assert.ok(lastTitle.y + lastTitle.descent < firstRow.y - firstRow.ascent);
  assertContained(layout);
});

for (const variant of ['generic', 'feature']) {
  test(`${variant} binding retains all rows and their exact ownership beyond row eight`, () => {
    const input = content();
    input.rows[11].value = 'A long literal value retained completely after row eight. '.repeat(8);
    input.rowRefs = input.rows.map((_, index) => ({ stageIndex: 0, relationIndex: index }));
    const plan = planFor([input], variant === 'feature' ? 'feature' : 'correspondence');
    const before = structuredClone(plan);
    const frame = bindRelationPlanFrame(plan, 0, positionFor, {
      plaqueTextLayout: { maxWidth: 360, measureText }
    });
    assert.deepEqual(frame.failed, []);
    const plaque = frame.primitives[0];
    assert.deepEqual(plan, before);
    assert.deepEqual(plaque.rows, input.rows);
    assert.deepEqual(plaque.rowRefs, input.rowRefs);
    assert.equal(plaque.textLayout.rows.length, 12);
    assert.deepEqual(plaque.textLayout.rows.map((row) => row.rowIndex), Array.from({ length: 12 }, (_, i) => i));
    assert.deepEqual(plaque.textLayout, preparePlaqueTextLayout(input, { variant, maxWidth: 360, measureText }));
    assert.equal(plaque.width, plaque.textLayout.width);
    assert.equal(plaque.height, plaque.textLayout.height);
    assertContained(plaque.textLayout);
    const shorter = preparePlaqueTextLayout({ ...input, rows: input.rows.slice(0, 8) }, { variant, measureText });
    assert.ok(plaque.height > shorter.height);
  });

  test(`${variant} uses the complete measured footprint for same-anchor collision placement at counter-scales`, () => {
    for (const markerScale of [0.5, 1, 2]) {
      const input = content();
      const plan = planFor([input, input], variant === 'feature' ? 'feature' : 'correspondence');
      const frame = bindRelationPlanFrame(plan, 0, positionFor, { markerScale, plaqueTextLayout: { measureText } });
      const [first, second] = frame.primitives;
      assert.ok(second.y >= first.y + first.textLayout.height * markerScale + 14 * markerScale);
      if (variant === 'generic') {
        const bounds = boundOverlayBounds(frame, { markerScale });
        assert.equal(bounds.maxX, second.x + second.textLayout.width * markerScale);
        assert.equal(bounds.maxY, second.y + second.textLayout.height * markerScale);
      } else {
        assert.equal(boundOverlayBounds(frame, { markerScale }), null,
          'accepted feature annotations retain their existing tree-first fit policy');
      }
    }
  });
}

test('generic wrapping uses its measured font, preserves literal case, and keeps empty values label-only', () => {
  const input = { title: 'Literal Mixed Case', rows: [
    { label: 'label only', value: '' },
    { label: 'name', value: 'AnUnbrokenLiteralToken'.repeat(8) }
  ] };
  const layout = preparePlaqueTextLayout(input, { maxWidth: 150, measureText });
  assert.equal(layout.width, 150);
  assert.equal(layout.title.text, input.title);
  assert.equal(layout.rows[0].text, 'label only');
  assert.equal(layout.rows[1].lines.map((line) => line.text).join(''), `name: ${input.rows[1].value}`);
  assert.deepEqual(layout.rows[0].style, {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 400, letterSpacing: 0
  });
  assertContained(layout);
});

test('a narrower measured width wraps more, growing height without dropping text', () => {
  const input = content(3);
  const wide = preparePlaqueTextLayout(input, { variant: 'feature', measureText });
  const narrow = preparePlaqueTextLayout(input, { variant: 'feature', maxWidth: 220, measureText });
  assert.equal(narrow.width, 220);
  assert.ok(narrow.height > wide.height);
  assert.deepEqual(narrow.rows.map((row) => row.text), wide.rows.map((row) => row.text));
  assertContained(narrow);
});

test('measured ascent and descent expand line boxes and plaque height without overlapping', () => {
  const layout = preparePlaqueTextLayout(content(2), { variant: 'feature', maxWidth: 200,
    measureText: (text, style) => ({ ...measureText(text, style), ascent: 45, descent: 18 }) });
  const lines = [layout.title, ...layout.rows].flatMap((block) => block.lines);
  for (let index = 1; index < lines.length; index += 1) {
    assert.ok(lines[index - 1].y + lines[index - 1].descent <= lines[index].y - lines[index].ascent);
  }
  assertContained(layout);
});

test('wrapping preserves whitespace, explicit blank lines, and complete Unicode graphemes', () => {
  const literal = '  e\u0301\u{1f469}\u200d\u{1f4bb}\u4e2d  '.repeat(8);
  const layout = preparePlaqueTextLayout({ rows: [{ label: literal, value: '' }, { label: 'first\n\nlast', value: '' }] },
    { maxWidth: 60, measureText });
  const lines = layout.rows[0].lines.map((line) => line.text);
  assert.equal(lines.join(''), literal);
  assert.deepEqual(lines.flatMap(segments), segments(literal), 'combining marks and joined emoji remain attached');
  assert.deepEqual(layout.rows[1].lines.map((line) => line.text), ['first', '', 'last']);
  assertContained(layout);
});

test('an indivisible measured grapheme grows the plaque rather than clipping or disappearing', () => {
  const layout = preparePlaqueTextLayout({ rows: [{ label: '\u{1f469}\u200d\u{1f4bb}', value: '' }] }, {
    maxWidth: 40, measureText: () => ({ width: 100, ascent: 10, descent: 2 })
  });
  assert.equal(layout.width, 116);
  assert.equal(layout.rows[0].lines.length, 1);
  assertContained(layout);
});

test('the pure fallback is deterministic and invalid measurements do not poison geometry', () => {
  const input = content();
  const first = preparePlaqueTextLayout(input, { variant: 'feature' });
  const invalid = preparePlaqueTextLayout(input, { variant: 'feature', maxWidth: NaN,
    measureText: () => ({ width: NaN, ascent: -1, descent: Infinity }) });
  assert.deepEqual(preparePlaqueTextLayout(input, { variant: 'feature' }), first);
  assert.deepEqual(invalid, first);
  assert.ok(fallbackPlaqueTextMeasure('literal', first.rows[0].style).width > 0);
  assertContained(first);
});

test('ordinary one-line plaques keep their existing baselines and feature width', () => {
  const input = { title: 'T bearer', rows: [{ label: 'Case', value: 'NOM' }] };
  const feature = preparePlaqueTextLayout(input, { variant: 'feature', measureText });
  assert.equal(feature.width, 360);
  assert.equal(feature.height, 106);
  assert.equal(feature.title.lines[0].y, 25);
  assert.equal(feature.rows[0].lines[0].y, 71);
  const generic = preparePlaqueTextLayout(input, { measureText });
  assert.equal(generic.height, 35);
  assert.equal(generic.title.lines[0].y, 14);
  assert.equal(generic.rows[0].lines[0].y, 28);
});

test('a feature plaque binds to its exact wordless category without requiring a terminal child', () => {
  const wordless = { id: 'wordless-v', label: 'v' };
  const plan = compileRelationRenderPlan([{
    statement: 'The authored feature bundle holds on v.',
    stageRecord: 'The current category has its authored features but no realized word.',
    workspaceForest: [wordless],
    relations: [{ relation: 'FeatureBundle', anchors: { bearer: wordless.id }, values: { Case: 'NOM' } }]
  }]);
  const attachments = [];
  const point = { x: 120, y: 80 };
  const frame = bindRelationPlanFrame(plan, 0, (nodeId, attachment = 'position') => {
    attachments.push({ nodeId, attachment });
    return nodeId === wordless.id && attachment !== 'terminal' ? point : null;
  }, { plaqueTextLayout: { measureText } });
  assert.deepEqual(frame.failed, []);
  const plaque = frame.primitives.find((item) => item.type === 'plaque');
  assert.ok(plaque, 'the binder provides drawable content even though no lexical terminal exists');
  assert.deepEqual(plaque.anchorPoints, [point]);
  assert.equal(plaque.textLayout.rows[0].text, '[Case: NOM]');
  assert.ok(attachments.every(({ nodeId, attachment }) => nodeId === wordless.id && attachment !== 'terminal'));
  assertContained(plaque.textLayout);
  assert.deepEqual(wordless, { id: 'wordless-v', label: 'v' });
});

test('only extreme plaques use a bounded viewport, while every authored row remains available', async () => {
  const { preparePfPlaqueTextLayout, reservePlaqueViewport } = await import('../replay/relations/plaqueTextLayout.ts');
  const prepare = [
    rows => preparePlaqueTextLayout({ title: 'Context', rows }, { variant: 'generic' }),
    rows => preparePlaqueTextLayout({ title: 'Context', rows }, { variant: 'feature' }),
    rows => preparePfPlaqueTextLayout(rows.map((row, rowIndex) => ({ ...row, rowIndex, kind: 'literal', isFinal: false })))
  ];
  for (const layoutFor of prepare) {
    const ordinary = layoutFor([{ label: 'Case', value: 'nominative' }]);
    assert.equal(ordinary.overflow, undefined);
    const input = Array.from({ length: 100 }, (_, i) => ({ label: `row ${i}`, value: `exact value ${i}` }));
    const layout = layoutFor(input);
    assert.equal(layout.rows.length, 100);
    assert.ok(layout.overflow.contentHeight > layout.height * 2);
    const last = layout.rows.at(-1);
    const blocks = last.parts?.map(part => part.block) ?? [last];
    assert.ok(blocks.flatMap(block => block.lines).map(line => line.text).join('').includes('exact value 99'));
    for (const block of blocks) for (const line of block.lines) {
      assert.ok(line.y + line.descent <= layout.overflow.contentHeight);
    }
    const partlyRevealed = { height: layout.height + 20, rows: layout.rows.slice(0, 20) };
    const reserved = reservePlaqueViewport(partlyRevealed, layout.height);
    assert.equal(reserved.height, layout.height);
    assert.equal(reserved.overflow.contentHeight, partlyRevealed.height);
    assert.equal(reserved.rows, partlyRevealed.rows);
  }
});
