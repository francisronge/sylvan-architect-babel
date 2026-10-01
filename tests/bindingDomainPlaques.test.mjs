import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingDomainEllipse, bindingDomainPlaques } from '../replay/relations/bindingDomainGeometry.ts';

const rect = { x: 2544, y: 358, width: 2996, height: 1696 };
const insidePlaque = { x: 2158, y: 578, width: 360, height: 110 };
const cornerDistances = (ellipse, box, pad = 0) => [box.x - pad, box.x + box.width + pad]
  .flatMap(x => [box.y - pad, box.y + box.height + pad].map(y =>
    ((x - ellipse.cx) / ellipse.rx) ** 2 + ((y - ellipse.cy) / ellipse.ry) ** 2));

test('a subject plaque inside its binding domain cannot peek across the ellipse', () => {
  const ordinary = bindingDomainEllipse(rect);
  assert(Math.min(...cornerDistances(ordinary, insidePlaque)) < 1);
  assert(Math.max(...cornerDistances(ordinary, insidePlaque)) > 1, 'reproduce the Mandarin subject plaque crossing');
  const enclosed = bindingDomainEllipse(rect, [insidePlaque]);
  assert(Math.max(...cornerDistances(enclosed, insidePlaque, 8)) <= 1 + 1e-12);
  assert.equal(enclosed.cx, ordinary.cx);
  assert.equal(enclosed.cy, ordinary.cy);
  assert(enclosed.rx / ordinary.rx < 1.02, 'only the required small enclosure clearance changes');
  for (const k of [0.08, 0.5, 2.5]) {
    const project = box => ({ x: box.x * k + 120, y: box.y * k - 80, width: box.width * k, height: box.height * k });
    const ellipse = { cx: enclosed.cx * k + 120, cy: enclosed.cy * k - 80, rx: enclosed.rx * k, ry: enclosed.ry * k };
    assert(Math.max(...cornerDistances(ellipse, project(insidePlaque))) < 1, 'zoom preserves the clearance');
  }
});

test('fitting annotations and outside plaques retain the accepted ellipse exactly', () => {
  const ordinary = bindingDomainEllipse(rect);
  assert.deepEqual(bindingDomainEllipse(rect, [{ x: ordinary.cx - 100, y: ordinary.cy - 50, width: 200, height: 100 }]), ordinary);
  assert.deepEqual(bindingDomainEllipse(rect, [{ x: ordinary.cx - ordinary.rx - 150, y: ordinary.cy, width: 200, height: 100 }]), ordinary);
});

test('an outside topic annotation is not pulled into the authored IP enclosure', () => {
  const items = [
    { kind: 'node-plaque', anchorNodeIds: ['subject'] },
    { kind: 'node-plaque', anchorNodeIds: ['topic'] },
    { kind: 'node-plaque', anchorNodeIds: ['subject', 'topic'] },
    { kind: 'directed-path', fromNodeId: 'subject' }
  ];
  const placements = new Map(items.map((_, index) => [index, { ...insidePlaque, x: insidePlaque.x + index }]));
  assert.deepEqual(bindingDomainPlaques(['ip', 'subject', 'pronoun'], items, placements), [placements.get(0)]);
});

test('actual domain ink can exclude an ancestor that the padded rectangle ellipse captured', () => {
  const domain = { x: 0, y: 200, width: 1600, height: 1200 };
  const members = [
    { x: 760, y: 200, width: 80, height: 50 },
    { x: 0, y: 700, width: 100, height: 50 },
    { x: 1500, y: 1300, width: 100, height: 100 }
  ];
  const ancestors = [{ x: 770, y: 40, width: 60, height: 50 }];
  const plaque = { x: 40, y: 780, width: 260, height: 100 };
  const old = bindingDomainEllipse(domain, [plaque]);
  assert(Math.max(...cornerDistances(old, ancestors[0])) < 1, 'reproduce the included ancestor');
  const result = bindingDomainEllipse(domain, [plaque], members, ancestors);
  assert.notDeepEqual(result, old);
  for (const member of [...members, plaque]) assert(Math.max(...cornerDistances(result, member, 8)) < 1 + 1e-10);
  assert(Math.min(...cornerDistances(result, ancestors[0])) > 1, 'the complete ancestor label stays outside');
});

test('clear accepted domains retain their exact ellipse and impossible exclusions retain their established drawing', () => {
  const members = [{ x: rect.x + 100, y: rect.y + 100, width: 100, height: 100 }];
  const accepted = bindingDomainEllipse(rect, [insidePlaque]);
  assert.deepEqual(bindingDomainEllipse(rect, [insidePlaque], members,
    [{ x: accepted.cx, y: accepted.cy - accepted.ry - 200, width: 100, height: 100 }]), accepted);
  assert.deepEqual(bindingDomainEllipse(rect, [insidePlaque], members, members), accepted,
    'an exclusion intersecting authored member ink cannot produce a misleading replacement');
});

test('an asymmetric binding domain can shift its ellipse center instead of widening empty sides', () => {
  const domain = { x: 0, y: 200, width: 1600, height: 1200 };
  const members = [
    { x: 600, y: 200, width: 80, height: 50 },
    { x: 0, y: 700, width: 100, height: 50 },
    { x: 950, y: 1250, width: 100, height: 100 },
    { x: 1500, y: 750, width: 100, height: 100 }
  ];
  const ancestor = { x: 1000, y: 40, width: 60, height: 50 };
  const accepted = bindingDomainEllipse(domain);
  const ellipse = bindingDomainEllipse(domain, [], members, [ancestor]);
  assert.notEqual(ellipse.cx, accepted.cx, 'the center can follow the actual domain contour');
  assert(ellipse.rx <= accepted.rx, 'ancestor exclusion does not create a wider oval');
  for (const member of members) assert(Math.max(...cornerDistances(ellipse, member, 8)) <= 1 + 1e-10);
  assert(Math.min(...cornerDistances(ellipse, ancestor)) > 1);
});

test('a small-scale browser ink box cannot clip the normal glyph envelope after zoom', () => {
  const rect = { x: 0, y: 200, width: 1600, height: 1150 };
  const measured = [
    { x: 760, y: 200, width: 80, height: 38 },
    { x: 0, y: 700, width: 100, height: 38 },
    { x: 900, y: 1300, width: 100, height: 50 }
  ];
  const normalGlyph = { x: 900, y: 1285, width: 110, height: 100 };
  const ancestor = { x: 770, y: 40, width: 60, height: 50 };
  const undermeasured = bindingDomainEllipse(rect, [], measured, [ancestor]);
  assert(Math.max(...cornerDistances(undermeasured, normalGlyph)) > 1, 'reproduce the Korean glyph changing its reported height on zoom');
  const reserved = bindingDomainEllipse(rect, [], [...measured, normalGlyph], [ancestor]);
  assert(Math.max(...cornerDistances(reserved, normalGlyph, 8)) < 1 + 1e-10);
  assert(Math.min(...cornerDistances(reserved, ancestor)) > 1);
});
