import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';

const sharedUrl = new URL('../docs/research/relation-orchard/relation-visuals.css', import.meta.url);
const css = await readFile(sharedUrl, 'utf8');
const sheet = postcss.parse(css);
const properties = selector => {
  const result = {};
  sheet.walkRules(rule => { if (rule.selectors.includes(selector)) rule.walkDecls(d => { result[d.prop] = d.value; }); });
  return result;
};

test('the application and both Orchard pages load one drawing stylesheet', async () => {
  const app = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(app, /@import '\.\/docs\/research\/relation-orchard\/relation-visuals.css';/);
  for (const location of ['../docs/design/babel-visual-relations-research.production-only-audit.html',
    '../docs/research/relation-orchard/orchard.html']) {
    const url = new URL(location, import.meta.url), html = await readFile(url, 'utf8');
    const href = html.match(/<link rel="stylesheet" href="([^"]*relation-visuals.css)"/)[1];
    assert.equal(new URL(href, url).href, sharedUrl.href);
    const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    assert.doesNotMatch(inline, /\.babel-agree-cycle-badge circle|\.babel-control-domain\s*\{/);
  }
  assert.doesNotMatch(css, /\.babel-replay-|\.babel-render-card|opacity:\s*0;/,
    'drawing paint cannot hide layers or change page layout');
});

test('cycle labels keep their approved size and badge outline independently of page fonts', () => {
  assert.equal(properties('.babel-agree-cycle-badge text').font, '800 34px/1 "JetBrains Mono", monospace');
  assert.equal(properties('.babel-agree-cycle-badge circle')['stroke-width'], '1.4px');
});

test('production agreement curves cannot use SVG default black fills', () => {
  const curve = properties('.babel-agree-directed-path');
  assert.equal(curve.fill, 'none');
  assert.match(curve.stroke, /rgba?\(/);
  assert.equal(curve['vector-effect'], 'non-scaling-stroke');
  assert.match(properties('.babel-agree-arrowhead').fill, /rgba?\(/);
});

test('native paths and deletion marks cannot inherit invisible strokes or opaque default fills', () => {
  for (const name of ['control-domain', 'control-dependency', 'predication-path', 'feature-sharing-vine',
    'dependent-case-elbow', 'phase-arc', 'accord-path', 'strong-npi-path', 'intervention-search-path',
    'multidominance-branch', 'constituent-enclosure']) {
    const style = properties(`.babel-${name}`);
    assert.equal(style.fill, 'none', name);
    assert(style.stroke && style.stroke !== 'none', name);
    assert(style['stroke-width'], name);
  }
  for (const name of ['partial-copy-deletion-strike', 'lf-strike']) {
    assert(properties(`.babel-${name}`).stroke, name);
  }
});

test('hover is restricted to shared ink and halo, leaving opacity and geometry to stage state', () => {
  assert.deepEqual(Object.keys(properties('.vr-relation-hovered')).sort(), ['--babel-relation-ink', 'filter']);
  assert.equal(properties('.vr-relation-hovered').filter, properties('.vr-relation-active').filter);
  assert.equal(properties('.vr-relation-quiet').opacity, '0.3');
});
