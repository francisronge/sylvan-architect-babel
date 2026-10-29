import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { anchorSetBadgeOuterRadius, RELATION_BINDING_METRICS } from '../replay/rendererMetrics.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { clearAnchorBadgeY, planAnchorSetLayout } from '../replay/relations/overlayGeometry.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { visiblePlanFrameItems } from '../replay/relations/relationFrame.ts';
import { classifyText } from '../scripts/visualAudit/pageProbe.mjs';
import { toFrameModel } from '../scripts/visualAudit/frameModel.mjs';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkFrame, checkGlyphOverlap } from './helpers/visualRules.mjs';

const members = ['a', 'b', 'c', 'd', 'e'];
const stage = relations => ({ statement: 'Test', stageRecord: 'Test', relations,
  workspaceForest: members.map(id => ({ id, label: 'V', word: 'read' })) });
const plan = compileRelationRenderPlan([stage([{ relation: 'Current forms', anchors: { verb: members },
  values: { verbForm: members.map(() => 'past') } }])]);
// Markers at three times their size, as at a zoomed-out Fit.
const markerScale = 3;
const bind = badgeObstacles => bindRelationPlanFrame({ ...plan,
  frames: plan.frames.map((frame, i) => i === 0 ? { ...frame, items: visiblePlanFrameItems(plan, 0, new Set([0])) } : frame) }, 0,
  id => ({ x: members.indexOf(id) * 400, y: 0 }), { ...RELATION_BINDING_METRICS, markerScale, ...(badgeObstacles ? { badgeObstacles } : {}) });
const badges = bound => bound.primitives.filter(mark => mark.type === 'anchor-set-badge');
const covers = (badge, box) => {
  const r = anchorSetBadgeOuterRadius(badge.badgeSize) * markerScale;
  return badge.x + r > box.x && badge.x - r < box.x + box.width && badge.y + r > box.y && badge.y - r < box.y + box.height;
};

test('a badge that would cover a wrapped label below its node moves up its own column to clear it', () => {
  const nominal = badges(bind());
  assert.equal(nominal.length, 5);
  // A two-line label on the next row reaches up to where b's badge nominally sits.
  const b = nominal.find(badge => badge.nodeId === 'b');
  const wrapped = [{ x: b.x - 150, y: b.y - 35, width: 300, height: 52 }, { x: b.x - 170, y: b.y + 13, width: 340, height: 52 }];
  assert(wrapped.some(box => covers(b, box)), 'the nominal badge covers the label');
  const cleared = badges(bind(wrapped));
  const moved = cleared.find(badge => badge.nodeId === 'b');
  assert(!wrapped.some(box => covers(moved, box)), 'the badge clears every line of the label');
  assert.equal(moved.x, b.x, 'it stays in its own column');
  assert(moved.y < b.y && moved.y - anchorSetBadgeOuterRadius(moved.badgeSize) * markerScale >= RELATION_BINDING_METRICS.labelHeight / 2,
    'it moves toward its own node and stays below its nominal box');
  assert.deepEqual(cleared.filter(badge => badge.nodeId !== 'b'), nominal.filter(badge => badge.nodeId !== 'b'),
    'badges that already clear their labels keep their places');
});

test('the clear height prefers the side of the badge\'s own node and falls back below', () => {
  const box = { x: -10, y: 100, width: 20, height: 40 };
  assert.equal(clearAnchorBadgeY(0, 60, 20, 10, [box]), 60, 'a clear badge keeps its height');
  assert.equal(clearAnchorBadgeY(0, 135, 20, 10, [box]), 90, 'nearer below, but the clear height above wins');
  assert.equal(clearAnchorBadgeY(0, 105, 100, 10, [box]), 150, 'nothing clear above: the nearest height below');
  assert.equal(clearAnchorBadgeY(30, 120, 20, 10, [box]), 120, 'an obstacle beside the column does not move it');
});

test('a badge that clears its obstacles still clears the badge before it on the same node', () => {
  const sets = [{ relation: 'Forms', instanceIndex: 0, roles: [{ role: 'verb', large: true,
    anchors: [0, 1].map(arrayIndex => ({ nodeId: 'a', arrayIndex, resolved: true })) }] }];
  // A label under the first badge's nominal height (34) pushes it down toward the second's (48).
  const label = { x: -10, y: 23, width: 20, height: 12 }, radius = 7;
  const { badges } = planAnchorSetLayout(sets, () => ({ x: -10, y: 0, width: 20, height: 20 }),
    { clearance: { obstacles: [label], radiusFor: () => radius, gap: 1 } });
  assert.equal(badges.length, 2);
  for (const badge of badges) assert(badge.y - radius >= label.y + label.height || badge.y + radius <= label.y, `badge ${badge.arrayIndex} clears the label`);
  assert(Math.abs(badges[1].y - badges[0].y) >= 2 * radius, `badges at ${badges.map(badge => badge.y)} must not overlap`);
});

test('the audit judges two anchor-set badges of one claim against each other', () => {
  const badge = (numeral, y) => ({ id: `badge(0:4 ${numeral})@a#${numeral - 1}`, kind: 'badge', text: String(numeral),
    boxes: [{ x: 0, y, width: 20, height: 20 }], halo: 0, nodes: [], claims: ['0:4'] });
  const frame = texts => ({ frame: 1, viewport: 'desktop', zoom: 1, texts, plaques: [] });
  assert.deepEqual(checkGlyphOverlap(frame([badge(1, 0), badge(2, 5)])).map(finding => finding.subject),
    ['badge(0:4 1)@a#0 badge(0:4 2)@a#1']);
  assert.deepEqual(checkGlyphOverlap(frame([badge(1, 0), badge(2, 21)])), [], 'separate badges of one claim pass');
  const role = { id: 'role(0:4 verb)@a', kind: 'role', text: 'verb', boxes: [{ x: 0, y: 5, width: 20, height: 20 }], halo: 0, nodes: [], claims: ['0:4'] };
  assert.deepEqual(checkGlyphOverlap(frame([badge(1, 0), role])), [], 'other mark text of one claim is still laid out with it');
});

test('a badge is mark text: it may not cover a label, even its own anchor\'s, in either audit adapter', () => {
  const category = { id: 'subjectHad:category', kind: 'category', text: 'I⁰', boxes: [{ x: 0, y: 0, width: 300, height: 40 }],
    halo: 5, nodes: ['subjectHad'], claims: [] };
  const badge = { id: 'badge(0:4 1)@subjectHad#0', kind: 'badge', text: '1', boxes: [{ x: 120, y: 20, width: 58, height: 58 }],
    halo: 0, nodes: [], claims: ['0:4'] };
  assert.deepEqual(checkGlyphOverlap({ frame: 1, viewport: 'desktop', zoom: 0.1, texts: [category, badge], plaques: [] })
    .map(finding => finding.subject), ['badge(0:4 1)@subjectHad#0 subjectHad:category']);
  // The browser probe records the badge circle as the numeral's box.
  assert.equal(classifyText({ tag: 'text', classes: [], owned: true, badge: true }), 'badge');
  const { model } = toFrameModel({ camera: { x: 0, y: 0, k: 1 }, nodes: [], edges: [], plaques: [], connectors: [], branches: [],
    texts: [{ uid: 't0', kind: 'badge', text: '1', nodeId: null, owners: ['0:4'], refs: ['subjectHad'],
      box: { x: 0, y: 0, width: 20, height: 20 }, inkBoxes: [{ x: 0, y: 0, width: 20, height: 20 }], strokePx: 0, lines: [], opacity: 1 }] },
  { frame: 1, viewport: 'desktop' });
  assert.deepEqual(model.texts.map(text => [text.kind, text.nodes, text.claims]), [['badge', [], ['0:4']]]);
});

test('Sol n4-18-sv-long-v2: no anchor-set badge covers a label or plaque at the desktop Fits', () => {
  const record = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/anchor-set-badge-label-clearance.json', import.meta.url)));
  const steps = Array.from({ length: 21 }, (_, index) => 71 + index);
  const frames = layoutVisualFrames(prepareVisualRecord(record), VIEWPORTS.filter(viewport => viewport.name !== 'mobile'), { steps });
  assert.equal(frames.length, 2 * steps.length);
  for (const frame of frames) {
    assert(frame.texts.some(text => text.kind === 'badge'), `frame ${frame.frame} paints badges`);
    assert.deepEqual(checkFrame(frame).filter(finding => finding.subject.includes('badge(')).map(finding => finding.detail), [],
      `${frame.viewport} frame ${frame.frame}`);
  }
});
