import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalProblem, exceptionGrowth, matchFindings } from './helpers/findings.mjs';
import { EXCEPTIONS as MOTION_EXCEPTIONS } from './helpers/motionExceptions.mjs';

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
const approval = { by: 'Francis Ronge', on: '2026-10-20', note: 'PR review: accepted until the layout rework' };
const approved = (entry, accepts = entry.at) => ({ ...entry, approval: { ...approval, accepts } });
const growth = (base, head) => exceptionGrowth({ 'list#EXCEPTIONS': base }, { 'list#EXCEPTIONS': head });

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
  assert.deepEqual(exceptionGrowth({ 'list#EXCEPTIONS': [unmoved(165.57)] }, { 'list#EXCEPTIONS': [approved(unmoved(196.88))] }), []);
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

test('an approval names the owner, its date, where it was given and what it accepts, and does not expire', () => {
  const check = (changes, entry = relayout) => approvalProblem({ ...entry, approval: { ...approval, accepts: entry.at, ...changes } });
  assert.equal(check({}), null);
  assert.equal(approvalProblem(relayout), 'no approval');
  assert.deepEqual(growth([relayout], [{ ...relayout, at: { ...relayout.at, mobile: { '20>21,21>20': 40 } } }])
    .map(({ problem }) => problem), ['no approval'], 'a grown entry without an approval is rejected');
  assert.match(check({ by: 'Claude' }), /not Francis Ronge/);
  assert.match(check({ on: '20 Oct' }), /date it was given/);
  assert.match(check({ note: '' }), /note/);
  assert.match(check({ accepts: undefined }), /approval needs accepts/);
  assert.match(check({ accepts: { desktop: { '19>20': '44.44' } } }), /approval needs accepts/);
  const old = approved(relayout); old.approval.on = '2025-01-01';
  assert.deepEqual(growth([old], [old]), [], 'an unchanged entry keeps an approval however old it is');
  assert.match(growth([], [{ ...approved(relayout), reason: '' }])[0].problem, /no reason/);
});

test('a bound may grow by at most 5% without a new approval; more places still need one', () => {
  assert.deepEqual(growth([unmoved(165.57)], [unmoved(173.8)]), [], '165.57 → 173.8 is within 5%');
  assert.deepEqual(growth([unmoved(165.57)], [unmoved(174)]).map(({ grown }) => grown), [['mobile: bound 165.57 → 174']]);
  assert.equal(approvalProblem({ ...unmoved(206.7), approval: { ...approval, accepts: unmoved(196.88).at } }), null,
    'within 5% of what the approval accepts');
  assert.match(approvalProblem({ ...unmoved(206.8), approval: { ...approval, accepts: unmoved(196.88).at } }), /beyond what the approval/);
  assert.deepEqual(growth([copy('34')], [copy('40-41')]).map(({ grown }) => grown), [['-: 1 → 2 places']]);
});

test('a finding within 5% above its bound is not beyond it', () => {
  const finding = measure => ({ rule: unmoved(0).rule, subtype: unmoved(0).subtype, record: CATALOG_6, subject: 'stage 3',
    frame: '43>44', viewport: 'mobile', measure });
  assert.deepEqual(matchFindings([finding(100)], [unmoved(100)]).exceeded, []);
  assert.deepEqual(matchFindings([finding(104.9)], [unmoved(100)]).exceeded, []);
  assert.deepEqual(matchFindings([finding(105.1)], [unmoved(100)]).exceeded.map(({ bound }) => bound), [100]);
});

test('a motion exception needs the owner\'s approval, and the committed list has it on every entry', () => {
  const motion = { reason: 'A 30-unit join the owner accepted.', record: 'fixture:movement/clause-context.json#/cases/0', rule: 'motion',
    subtype: 'attachment-site-motion', subject: 'n_vp', at: { '-': { '12': 30 } } };
  const list = entries => exceptionGrowth({}, { 'motionExceptions.mjs#EXCEPTIONS': entries });
  assert.deepEqual(list([motion]).map(({ grown, problem }) => [grown, problem]), [[['new exception'], 'no approval']]);
  assert.deepEqual(list([approved(motion)]), []);
  assert(Array.isArray(MOTION_EXCEPTIONS));
  for (const entry of MOTION_EXCEPTIONS) {
    assert.equal(entry.rule, 'motion');
    assert.equal(approvalProblem(entry), null, `${entry.record} ${entry.subject}`);
  }
});

test('an existing approval is a record of the owner\'s words: #285 rewrote one\'s date and note while narrowing its entry', () => {
  const plaque = at => ({ reason: 'Open: the plaque leaves its pocket when new syntax arrives.', record: CATALOG_6,
    rule: 'plaque-teleport', subtype: 'jump', subject: 'theta 2:1', at });
  const given = { by: 'Francis Ronge', on: '2026-10-23', note: 'Review page: "Plaques: Ok."', accepts: { desktop: { '33-38': 410 } } };
  const base = { ...plaque({ desktop: { '33-38': 410 } }), approval: given };
  const narrowed = plaque({ desktop: { '36-38': 410 } });
  assert.deepEqual(growth([base], [{ ...narrowed, approval: given }]), [], 'narrowing under the same approval needs nothing');
  assert.deepEqual(growth([base], [{ ...narrowed, approval: { note: given.note, accepts: narrowed.at, on: given.on, by: given.by } }]), [],
    'its accepted value may narrow with the entry, in any key order');
  const edited = growth([base], [{ ...narrowed, approval: { ...given, on: '2026-10-27', note: 'takes this pocket a step early' } }]);
  assert.match(edited[0]?.problem ?? '', /existing approval was edited \(on, note\)/);
  assert.match(growth([base], [narrowed])[0]?.problem ?? '', /edited \(removed\)/, 'an approval is never removed');
  assert.match(growth([base], [{ ...base, approval: { ...given, accepts: { desktop: { '33-38': 999 } } } }])[0]?.problem ?? '',
    /edited \(accepts widened\)/, 'an approval never accepts more than the owner did');
  const grown = plaque({ desktop: { '33-39': 410 } });
  assert.deepEqual(growth([base], [{ ...grown, approval: { by: 'Francis Ronge', on: '2026-10-29', note: 'Chat: frame 39 too',
    accepts: grown.at } }]), [], 'a new approval for a value the old one does not accept may replace it');
  assert.match(growth([base], [{ ...grown, approval: { by: 'Francis Ronge', on: '2026-10-20', note: 'Chat: frame 39 too',
    accepts: grown.at } }])[0]?.problem ?? '', /dated earlier/);
});
