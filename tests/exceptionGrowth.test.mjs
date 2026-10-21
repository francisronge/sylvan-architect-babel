import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalProblem, exceptionGrowth } from './helpers/findings.mjs';

// Entries as they stood before and after real changes.
const CATALOG_6 = 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0';
const unmoved = bound => ({ reason: 'Open (layout): the new stage lays out the unmoved shared syntax differently.', record: CATALOG_6,
  rule: 'first-paint-continuity', subtype: 'off-canvas:unmoved', subject: 'stage 3', at: { mobile: { '43>44': bound } } });
const relayout = { reason: 'Open (construction/layout, not camera): an inserted node or rebuilt workspace displaces syntax.',
  record: 'replay-regressions/dissolved-root-rebuild.json#', rule: 'first-paint-continuity', subtype: 'jump:relayout', subject: 'stage 2',
  at: { desktop: { '19>20,20>19': 44.44, '20>21,21>20': 75.75 }, mobile: { '20>21,21>20': 32.49 } } };
const copy = frames => ({ reason: 'Open: no field of the claim names a movement direction or occurrence role.',
  record: 'replay-regressions/unrecognized-movement.json#/cases/4', rule: 'movement-unrendered', subtype: 'COPY_WITHOUT_PATH',
  subject: '3:0', at: { '-': { [frames]: null } } });
const dates = { baseDate: '2026-10-19', today: '2026-10-20' };
const approval = { by: 'Francis Ronge', on: '2026-10-20', expires: '2026-12-01', note: 'PR review: accepted until the layout rework' };
const growth = (base, head) => exceptionGrowth({ 'list#EXCEPTIONS': base }, { 'list#EXCEPTIONS': head }, dates);

test('a raised bound needs approval: #94 raised the unmoved-syntax bound from 165.57 to 196.88 px', () => {
  assert.deepEqual(growth([unmoved(165.57)], [unmoved(196.88)]).map(({ grown, problem }) => [grown, problem]),
    [[['mobile: bound 165.57 → 196.88'], 'no approval']]);
  assert.deepEqual(growth([unmoved(165.57)], [unmoved(160)]), [], 'a smaller bound is not growth');
  assert.deepEqual(growth([unmoved(165.57)], [{ ...unmoved(196.88), approval }]), []);
});

test('a new exception needs approval: #122 listed its 75.75 px relayout under an existing reason', () => {
  assert.deepEqual(growth([], [relayout]).map(({ grown, problem }) => [grown, problem]), [[['new exception'], 'no approval']]);
  assert.deepEqual(growth([], [{ ...relayout, approval }]), []);
});

test('frames renumbered by an inserted step are not growth, but a fault at more places is', () => {
  assert.deepEqual(growth([copy('34')], [copy('40')]), []);
  assert.deepEqual(growth([copy('34')], [copy('40-41')]).map(({ grown }) => grown), [['-: 1 → 2 places']]);
  assert.deepEqual(growth([relayout], [{ ...relayout, at: { ...relayout.at, desktop: { '19>20,20>19': 75.75, '20>21,21>20': 44.44 } } }]), [],
    'bounds are compared largest first, whichever frames carry them');
});

test('an approval names the owner, its dates and where it was given, and does not outlive its expiry', () => {
  assert.equal(approvalProblem(approval, dates), null);
  assert.match(approvalProblem({ ...approval, by: 'Claude' }, dates), /not Francis Ronge/);
  assert.match(approvalProblem({ ...approval, on: '2026-10-01' }, dates), /predates this change/);
  assert.match(approvalProblem({ ...approval, expires: '2026-10-19' }, dates), /expires after on|expired/);
  assert.match(approvalProblem({ ...approval, note: '' }, dates), /note/);
  assert.match(growth([{ ...relayout, approval: { ...approval, expires: '2026-10-19', on: '2026-10-01' } }],
    [{ ...relayout, approval: { ...approval, expires: '2026-10-19', on: '2026-10-01' } }])[0].problem, /expired/,
  'an unchanged entry fails once its approval expires');
  assert.match(growth([], [{ ...relayout, reason: '' , approval }])[0].problem, /no reason/);
});
