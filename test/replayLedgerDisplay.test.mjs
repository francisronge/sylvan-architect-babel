import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLedgerDisplay,
  formatAgreementReplayEntry,
  formatSelectionReplayEntry,
  formatCaseAssignmentReplayEntry,
  formatThetaAssignmentReplayEntry,
  formatBindingReplayEntry,
  formatClausalDependencyReplayEntry,
  formatPredicateClassReplayEntry,
  formatProbeReplayEntry,
  formatNullElementReplayEntry,
  formatDiagnosticReplayEntry,
  formatParameterReplayEntry,
  humanizeLedgerStructuralHead
} from '../replayLedgerDisplay.js';

test('normalizeLedgerDisplay collapses silent category wrappers', () => {
  assert.equal(normalizeLedgerDisplay('Infl (null past)'), 'Infl');
  assert.equal(normalizeLedgerDisplay('v (null)'), 'v');
  assert.equal(normalizeLedgerDisplay('C (∅)'), 'C');
});

test('formatSelectionReplayEntry drops placeholder selections and cleans categories', () => {
  assert.equal(
    formatSelectionReplayEntry({
      selector: 'V (leave)',
      selectedLabel: 'none',
      selectedCategory: 'none'
    }),
    ''
  );

  assert.equal(
    formatSelectionReplayEntry({
      selector: 'Infl (to)',
      selectedLabel: 'VP (leave)',
      selectedCategory: 'VP',
      relation: 'complement'
    }),
    'Infl (to) selects VP (leave) (complement)'
  );

  assert.equal(
    formatSelectionReplayEntry({
      selector: 'V (bought)',
      selectedLabel: 'DP (Which book)',
      selectedCategory: 'DP'
    }),
    'V (bought) selects DP (Which book)'
  );
});

test('formatCaseAssignmentReplayEntry keeps assigners readable', () => {
  assert.equal(humanizeLedgerStructuralHead('V_higher'), 'V');
  assert.equal(humanizeLedgerStructuralHead('Infl_to'), 'Infl');

  assert.equal(
    formatCaseAssignmentReplayEntry({
      assignee: 'John',
      assignedCase: 'Nominative',
      assigner: 'Infl (null past)',
      mechanism: 'Agree'
    }),
    'John: Nominative (by Infl, via Agree)'
  );

  assert.equal(
    formatCaseAssignmentReplayEntry({
      assignee: 'Mary',
      assignedCase: 'Accusative',
      assigner: 'v (null)'
    }),
    'Mary: Accusative (by v)'
  );
});

test('formatThetaAssignmentReplayEntry filters underspecified junk', () => {
  assert.equal(
    formatThetaAssignmentReplayEntry({
      referent: '',
      role: 'Theme',
      predicate: 'leave'
    }),
    ''
  );

  assert.equal(
    formatThetaAssignmentReplayEntry({
      referent: 'Mary',
      role: 'Experiencer',
      predicate: 'persuade',
      introducer: 'v',
      position: 'Spec,VP'
    }),
    'Mary: Experiencer (of persuade, introduced by v, at Spec,VP)'
  );
});

test('formatBindingReplayEntry and formatClausalDependencyReplayEntry stay concrete', () => {
  assert.equal(
    formatBindingReplayEntry({
      antecedent: 'Mary',
      dependent: 'herself',
      principle: 'A',
      status: 'satisfied'
    }),
    'Mary -> herself (Principle A, satisfied)'
  );

  assert.equal(
    formatClausalDependencyReplayEntry({
      label: 'object-control',
      controller: 'Mary',
      dependent: 'PRO',
      predicate: 'persuade',
      clause: 'embedded CP'
    }),
    'object-control: Mary controls PRO (predicate persuade, clause embedded CP)'
  );

  assert.equal(
    formatClausalDependencyReplayEntry({
      label: 'non-finite-complement',
      dependent: 'to leave'
    }),
    'non-finite-complement: to leave'
  );

  assert.equal(
    formatClausalDependencyReplayEntry({
      label: 'raising-to-subject',
      dependent: 'InflP (to like Mary)',
      predicate: 'seems'
    }),
    'raising-to-subject: from InflP (to like Mary) (predicate seems)'
  );

  assert.equal(
    formatClausalDependencyReplayEntry({
      label: 'raising-to-subject',
      dependent: 'InflP (to like Mary)',
      predicate: 'seems',
      clause: 'to like Mary'
    }),
    'raising-to-subject: from InflP (to like Mary) (predicate seems)'
  );
});

test('new ledger replay formatters stay readable', () => {
  assert.equal(
    formatAgreementReplayEntry({
      probe: 'Infl (u-)',
      goal: 'uZinhle',
      feature: 'noun class',
      value: '1',
      status: 'valued'
    }),
    'Infl (u-) agrees with uZinhle in noun class = 1 (status valued)'
  );

  assert.equal(
    formatPredicateClassReplayEntry({
      predicate: 'fanele',
      classification: 'raising',
      diagnostics: ['default agreement', 'idiom preserved']
    }),
    'fanele: raising (diagnostics default agreement; idiom preserved)'
  );

  assert.equal(
    formatProbeReplayEntry({
      probe: 'Infl',
      goal: 'uZinhle',
      feature: 'noun class',
      direction: 'downward',
      outcome: 'matched'
    }),
    'Infl probes uZinhle for noun class (direction downward, outcome matched)'
  );

  assert.equal(
    formatNullElementReplayEntry({
      label: '∅',
      kind: 'silent-complementizer',
      licensing: 'finite clause'
    }),
    '∅: silent-complementizer (licensed by finite clause)'
  );

  assert.equal(
    formatDiagnosticReplayEntry({
      diagnostic: 'idiom preservation',
      observation: 'literal reading only with thanda',
      supports: 'control'
    }),
    'idiom preservation: literal reading only with thanda (supports control)'
  );

  assert.equal(
    formatParameterReplayEntry({
      parameter: 'probe directionality',
      value: 'downward',
      domain: 'agreement'
    }),
    'probe directionality: downward (domain agreement)'
  );
});
