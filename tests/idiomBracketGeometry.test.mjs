import assert from 'node:assert/strict';
import test from 'node:test';
import { idiomDomainBracketPath } from '../replay/relations/markGeometry.ts';

const domain = { x: 40, y: 100, width: 460, height: 600 };

test('the desktop idiom bracket retains its accepted gutter, cap, and vertical margins', () => {
  const accepted = 'M 724.0 20.0 H 820.0 V 780.0 H 724.0';
  assert.equal(idiomDomainBracketPath(domain), accepted);
  assert.equal(idiomDomainBracketPath(domain, 820), accepted);
  assert.equal(idiomDomainBracketPath(domain, 1400), accepted);
});

test('a narrow fitted viewport keeps the whole bracket visible without changing its domain', () => {
  const before = structuredClone(domain);
  assert.equal(idiomDomainBracketPath(domain, 630), 'M 534.0 20.0 H 630.0 V 780.0 H 534.0');
  assert.deepEqual(domain, before);

  const fittedScale = 0.4577669902912621;
  const fittedPan = 83.13592233009709;
  const viewportRight = (390 - 12 - fittedPan) / fittedScale;
  const path = idiomDomainBracketPath({ x: 0, y: 141.8, width: 512.9, height: 566.3 }, viewportRight);
  const bracketRight = Number(path.match(/H ([\d.]+)/)[1]);
  assert.ok(bracketRight * fittedScale + fittedPan <= 378.05, 'the reported390px viewport reserves its right inset');
});

test('the cap shortens only when the available gutter is smaller than the accepted cap', () => {
  assert.equal(idiomDomainBracketPath(domain, 596), 'M 500.0 20.0 H 596.0 V 780.0 H 500.0');
  assert.equal(idiomDomainBracketPath(domain, 540), 'M 500.0 20.0 H 540.0 V 780.0 H 500.0');
  assert.equal(idiomDomainBracketPath(domain, 500), 'M 500.0 20.0 H 500.0 V 780.0 H 500.0');
});

test('the initial bracket remains in tree coordinates when later zoom and pan transform its domain', () => {
  const path = idiomDomainBracketPath(domain, 630);
  const [capLeft, top, bracketRight, bottom] = path.match(/-?[\d.]+/g).map(Number);
  for (const scale of [0.1, 0.5, 1, 3]) for (const pan of [-250, 0, 700]) {
    const transform = value => value * scale + pan;
    assert.ok(Math.abs((transform(bracketRight) - transform(domain.x + domain.width)) / scale - 130) < 1e-9);
    assert.ok(Math.abs((transform(bracketRight) - transform(capLeft)) / scale - 96) < 1e-9);
    assert.ok(Math.abs((transform(domain.y) - transform(top)) / scale - 80) < 1e-9);
    assert.ok(Math.abs((transform(bottom) - transform(domain.y + domain.height)) / scale - 80) < 1e-9);
  }
  assert.equal(path, 'M 534.0 20.0 H 630.0 V 780.0 H 534.0');
});

test('nonfinite viewport measurements preserve the accepted path and invalid domains cannot emit invalid SVG', () => {
  for (const right of [NaN, Infinity, -Infinity]) {
    assert.equal(idiomDomainBracketPath(domain, right), idiomDomainBracketPath(domain));
  }
  for (const key of ['x', 'y', 'width', 'height']) for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(idiomDomainBracketPath({ ...domain, [key]: value }, 630), null);
  }
  assert.equal(idiomDomainBracketPath({ ...domain, width: -1 }, 630), null);
  assert.equal(idiomDomainBracketPath({ ...domain, height: -1 }, 630), null);
  assert.equal(idiomDomainBracketPath({ ...domain, x: Number.MAX_VALUE, width: Number.MAX_VALUE }, 630), null);
});
