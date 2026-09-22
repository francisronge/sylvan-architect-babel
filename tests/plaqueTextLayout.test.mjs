import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fallbackPlaqueTextMeasure,
  wrapPlaqueText,
  preparePlaqueTextLayout,
  preparePfPlaqueTextLayout,
  prepareThetaGridTextLayout
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

test('short literal PF plates fit their measured heading and intact multilingual rows', () => {
  for (const value of ['샀다', 'read', 'يقرأن', 'e\u0301']) {
    const rows = [{ label: 'surfaceForm', value, kind: 'literal', rowIndex: 3, isFinal: true }];
    const before = structuredClone(rows);
    const layout = preparePfPlaqueTextLayout(rows, { measureText });
    assert(layout.width < 480, 'short text must be eligible for existing nearby placement');
    assert.equal(layout.height, 132);
    assert.equal(layout.rows[0].rowIndex, 3);
    assert.equal(layout.rows[0].parts[0].block.lines.map(line => line.text).join(''), `surfaceForm: ${value}`);
    for (const block of [layout.title, ...layout.rows.flatMap(row => row.parts.map(part => part.block))]) {
      for (const line of block.lines) assert(line.x + line.width <= layout.width - 26);
    }
    assert.deepEqual(rows, before);
  }
});

test('long literal PF content wraps completely and rewrite columns retain their accepted sizes', () => {
  const literal = 'Long literal morphology content '.repeat(12);
  const rows = [{ label: 'form', value: literal, kind: 'literal', rowIndex: 0, isFinal: true }];
  const layout = preparePfPlaqueTextLayout(rows, { measureText });
  assert.equal(layout.width, 590);
  assert.equal(layout.rows[0].parts[0].block.lines.map(line => line.text).join(''), `form: ${literal}`);
  for (const [value, zero, width, positions] of [['form', false, 590, [26, 314, 370]], ['∅', true, 360, [26, 190, 246]]]) {
    const rewrite = preparePfPlaqueTextLayout([{ label: 'stem', value, kind: 'rewrite', rowIndex: 0, isFinal: true }],
      { measureText, isZeroRealization: zero });
    assert.equal(rewrite.width, width);
    assert.deepEqual(rewrite.rows[0].parts.map(part => part.block.lines[0].x), positions);
  }
});

test('theta grids retain short geometry and give longer predicates their own column', () => {
  const short = prepareThetaGridTextLayout('buy', [{ label: 'Theme', index: 'i' }], { measureText });
  assert.deepEqual([short.width, short.height, short.predicateWidth, short.columns[0].left, short.columns[0].width],
    [430, 126, 104, 104, 302]);
  const longer = prepareThetaGridTextLayout('laughed', [{ label: 'Agent/Experiencer', index: 'i' }], { measureText });
  assert(longer.predicateWidth > short.predicateWidth);
  assert(longer.width > short.width && longer.width <= 480, 'ordinary text still fits a local pocket');
  assert.equal(longer.height, 126);
  assert.equal(longer.columns[0].label.lines.length, 1);
});

test('theta grids wrap intact literals and keep all text inside its own column and below its header', () => {
  for (const [predicate, roles] of [
    ['laughed', [{ label: 'Agent/Experiencer', index: 'i' }]],
    ['recontextualized', [{ label: 'Agent' }, { label: 'Instrument / Means' }, { label: 'Theme' }]],
    ['A very long predicate expression that must wrap', [
      { label: 'An intentionally long authored thematic role with more than one line', index: 'authored-index' },
      { label: '受益者・経験者', index: 'j' }]]
  ]) {
    const layout = prepareThetaGridTextLayout(predicate, roles);
    const check = (block, left, right, centered) => {
      for (const line of block.lines) {
        const x = centered ? line.x - line.width / 2 : line.x;
        assert(x >= left && x + line.width <= right, line.text);
        assert(line.y - line.ascent >= 39 && line.y + line.descent < layout.height, line.text);
      }
    };
    check(layout.predicate, 16, layout.predicateWidth - 16, false);
    assert.equal(layout.predicate.lines.map(line => line.text).join(''), predicate);
    layout.columns.forEach((column, index) => {
      check(column.label, column.left + 12, column.left + column.width - 12, true);
      check(column.index, column.left + 12, column.left + column.width - 12, true);
      assert.equal(column.label.lines.map(line => line.text).join(''), roles[index].label);
      assert.equal(column.index.lines.map(line => line.text).join(''), roles[index].index || '');
      const roleBottom = Math.max(...column.label.lines.map(line => line.y + line.descent));
      assert(column.index.lines[0].y - column.index.lines[0].ascent > roleBottom);
    });
    assert.equal(new Set(layout.columns.map(column => column.index.lines[0].y)).size, 1,
      'all columns share the grid index row even when one role wraps');
  }
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

test('wrapping agrees with a greedy line oracle across varied widths and Unicode', () => {
  const alphabet = ['a', 'W', ' ', '\t', '中', 'e\u0301', '👩‍💻', '\n', '\r\n'];
  let seed = 721;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let sample = 0; sample < 120; sample++) {
    const literal = Array.from({ length: 10 + random() % 100 }, () => alphabet[random() % alphabet.length]).join('');
    const maxWidth = 17 + random() % 140;
    const layout = preparePlaqueTextLayout({ rows: [{ label: literal, value: '' }] }, { maxWidth, measureText });
    const style = layout.rows[0].style;
    const expected = literal.split(/\r\n|\r|\n/u).flatMap(paragraph => {
      const remaining = segments(paragraph), lines = [];
      if (!remaining.length) return [''];
      while (remaining.length) {
        let count = 1;
        while (count < remaining.length && measureText(remaining.slice(0, count + 1).join(''), style).width <= maxWidth - 16) count++;
        if (count < remaining.length) {
          for (let index = count - 1; index >= 0; index--) {
            if (/\s/u.test(remaining[index])) { count = index + 1; break; }
          }
        }
        lines.push(remaining.splice(0, count).join(''));
      }
      return lines;
    });
    assert.deepEqual(layout.rows[0].lines.map(line => line.text), expected, `sample ${sample}`);
    assertContained(layout);
  }
});

test('a long literal does not repeatedly measure distant text to wrap each short line', () => {
  let seed = 42;
  const literal = Array.from({ length: 8000 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(33 + seed % 90);
  }).join('');
  let measuredCharacters = 0;
  const layout = preparePlaqueTextLayout({ rows: [{ label: literal, value: '' }] }, {
    maxWidth: 160,
    measureText: text => {
      measuredCharacters += text.length;
      return { width: text.length * 6, ascent: 8, descent: 2 };
    }
  });
  assert.equal(layout.rows[0].lines.map(line => line.text).join(''), literal);
  assert.ok(measuredCharacters < literal.length * 20, `measured ${measuredCharacters} characters`);
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
  const fallback = fallbackPlaqueTextMeasure('literal', first.rows[0].style);
  assert.ok(fallback.width > 0);
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

test('untitled plaques use ordinary padding without an empty heading band', () => {
  const rows = [{ label: 'agreement', value: 'third-person singular' }];
  for (const variant of ['feature', 'generic']) {
    const options = { variant, measureText };
    const untitled = preparePlaqueTextLayout({ rows }, options);
    const titled = preparePlaqueTextLayout({ title: 'T bearer', rows }, options);
    assert.equal(untitled.title, undefined);
    assert(untitled.rows[0].lines[0].y - untitled.rows[0].lines[0].ascent <= 20,
      'first-row ink begins inside normal padding rather than a reserved title row');
    assert(untitled.height < titled.height);
    assert.deepEqual(untitled.rows.map(row => row.lines.map(line => line.text)),
      titled.rows.map(row => row.lines.map(line => line.text)), 'wrapping and literal content survive');
    assertContained(untitled);
    for (const title of ['', '  \n  ']) {
      assert.deepEqual(preparePlaqueTextLayout({ title, rows }, options), untitled);
    }
  }
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

test('native bundle wrapping fits the Orchard column without interpreting comma-separated literals', () => {
  const text = 'Case: α, βparticipant, −author';
  const style = { fontFamily: 'monospace', fontSize: 7, fontWeight: 800, letterSpacing: 0 };
  const measure = text => measureText(text, style);
  const rows = wrapPlaqueText(text, 70, measure);
  assert.equal(rows.join(''), text, 'all literal punctuation and whitespace survive');
  assert.ok(rows.length > 1);
  assert.ok(rows.every(row => measure(row).width <= 70));
  assert.deepEqual(wrapPlaqueText('−author', 70, measure), ['−author']);
});
