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
const today = '2026-10-21';
const approval = { by: 'Francis Ronge', on: '2026-10-20', expires: '2026-12-01', note: 'PR review: accepted until the layout rework' };
const approved = (entry, accepts = entry.at) => ({ ...entry, approval: { ...approval, accepts } });
const growth = (base, head) => exceptionGrowth({ 'list#EXCEPTIONS': base }, { 'list#EXCEPTIONS': head }, { today });

test('a raised bound needs approval: #94 raised the unmoved-syntax bound from 165.57 to 196.88 px', () => {
  assert.deepEqual(growth([unmoved(165.57)], [unmoved(196.88)]).map(({ grown, problem }) => [grown, problem]),
    [[['mobile: bound 165.57 → 196.88'], 'no approval']]);
  assert.deepEqual(growth([unmoved(165.57)], [unmoved(160)]), [], 'a smaller bound is not growth');
  assert.deepEqual(growth([unmoved(165.57)], [approved(unmoved(196.88))]), []);
});

test('a new exception needs approval: #122 listed its 75.75 px relayout under an existing reason', () => {
  assert.deepEqual(growth([], [relayout]).map(({ grown, problem }) => [grown, problem]), [[['new exception'], 'no approval']]);
  assert.deepEqual(growth([], [approved(relayout)]), []);
});

test('frames renumbered by an inserted step are not growth, but a fault at more places is', () => {
  assert.deepEqual(growth([copy('34')], [copy('40')]), []);
  assert.deepEqual(growth([copy('34')], [copy('40-41')]).map(({ grown }) => grown), [['-: 1 → 2 places']]);
  assert.deepEqual(growth([relayout], [{ ...relayout, at: { ...relayout.at, desktop: { '19>20,20>19': 75.75, '20>21,21>20': 44.44 } } }]), [],
    'bounds are compared largest first, whichever frames carry them');
});

test('an approval binds to the value it accepts, not to the date of the base: 20 Oct survives main\'s commit after midnight', () => {
  // The base gained an unrelated commit dated after the approval; nothing in the entry changed since it was given.
  assert.deepEqual(exceptionGrowth({ 'list#EXCEPTIONS': [unmoved(165.57)] }, { 'list#EXCEPTIONS': [approved(unmoved(196.88))] },
    { today: '2026-11-15' }), []);
  assert.deepEqual(growth([approved(unmoved(196.88))], [approved(unmoved(196.88))]), [], 'an approved entry carried unchanged stays valid');
  assert.deepEqual(growth([approved(copy('34'))], [approved(copy('40'), copy('34').at)]), [],
    'renumbered frames stay within what was accepted');
});

test('growth beyond the approved value needs the owner again', () => {
  const raised = growth([approved(unmoved(196.88))], [{ ...unmoved(210.4), approval: { ...approval, accepts: unmoved(196.88).at } }]);
  assert.deepEqual(raised.map(({ grown, problem }) => [grown, problem]), [[['mobile: bound 196.88 → 210.4'],
    'grown beyond what the approval of 2026-10-20 accepts (mobile: bound 196.88 → 210.4); the owner must accept the new value']]);
  assert.match(growth([], [approved(copy('40-41'), copy('34').at)])[0].problem, /beyond what the approval .* accepts \(-: 1 → 2 places\)/,
    'an approval of one place does not cover two');
  assert.match(growth([], [approved(relayout, { desktop: relayout.at.desktop })])[0].problem, /mobile: 0 → 2 places/,
    'an approval does not cover a viewport it did not accept');
});

test('an approval names the owner, its dates, where it was given and what it accepts, and does not outlive its expiry', () => {
  const check = (changes, entry = relayout) => approvalProblem({ ...entry, approval: { ...approval, accepts: entry.at, ...changes } }, { today });
  assert.equal(check({}), null);
  assert.equal(approvalProblem(relayout, { today }), 'no approval');
  assert.deepEqual(growth([relayout], [{ ...relayout, at: { ...relayout.at, mobile: { '20>21,21>20': 40 } } }])
    .map(({ problem }) => problem), ['no approval'], 'a grown entry without an approval is rejected');
  assert.match(check({ by: 'Claude' }), /not Francis Ronge/);
  assert.match(check({ on: '20 Oct' }), /on and expires dates/);
  assert.match(check({ expires: '2026-10-19' }), /expires after on/);
  assert.match(check({ note: '' }), /note/);
  assert.match(check({ accepts: undefined }), /approval needs accepts/);
  assert.match(check({ accepts: { desktop: { '19>20': '44.44' } } }), /approval needs accepts/);
  assert.match(check({ on: '2026-10-01', expires: '2026-10-19' }), /approval expired on 2026-10-19/);
  const expired = approved(relayout); expired.approval.on = '2026-10-01'; expired.approval.expires = '2026-10-19';
  assert.match(growth([expired], [expired])[0].problem, /expired/, 'an unchanged entry fails once its approval expires');
  assert.match(growth([], [{ ...approved(relayout), reason: '' }])[0].problem, /no reason/);
});
