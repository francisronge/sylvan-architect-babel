/** Step-semantics, mark-persistence and contract-warning findings that remain
 * in the committed fixtures, each with its reason, for the invariant sweep in
 * tests/replayInvariants.test.mjs. Matching follows tests/helpers/findings.mjs:
 * a new finding fails, and so does every listed frame where it no longer
 * occurs. These rules have no measure, so every bound is null. Contract
 * warnings are facts about authored data at 'record'; the movement warning is
 * placed at its relation's moment. */

const UNRECOGNIZED_MOVEMENT = 'Defect: movement recognition does not resolve this movement, so the moved copy is built at an unrelated '
  + 'step or only at the Stage Record, and the chain\'s marks have no landing at their moments.';
const RESTATED_BEFORE_MOMENT = 'Defect: a feature or pronunciation change on retained syntax that a relation of the stage names is '
  + 'painted at the stage\'s first step, before that relation\'s moment.';
const ORDER_BEFORE_CONTEXT = 'Defect (authored relation order): the relation precedes the movement moment that introduces its anchor, '
  + 'so its mark has no displayed anchor at its own moment.';
const VANISHED_AT_STAGE_START = 'Defect: the plan drops a persistent mark for a whole stage when an anchor is absent from that stage, '
  + 'so the mark ends at the stage\'s first step while the anchor is still displayed, before its removal plays.';
const COMPOSED_BEFORE_MOMENT = 'Defect: composing a theta grid with a later relation of the stage removes the earlier theta badges at '
  + 'the stage\'s first step, before the composing relation\'s moment.';
const RENAMED = 'Authored data: the model writes a moved or restated occurrence under a new id, so marks anchored at the old id end.';
const SELF_SPELLED = 'Authored data: a whole unspaced sentence grouped as one word under the spell-out contract.';
const OBJECT_LANGUAGE = 'Authored data: the analysis names relations, roles and labels in Chinese.';
const SPACED_ROLES = 'Open: space-separated role names ("host head") defeat head-movement recognition, so the movement draws no arrow.';
const PRIOR_SOURCE = 'Open: movement recognition cannot prove the source in the preceding stage (a first-stage claim, or a source the '
  + 'stage does not keep), so the movement draws no path.';
const CHAIN_ROLES = 'Open: a chain or licensing relation with movement-shaped roles; recognition finds no single source and landing.';

const x = (reason, record, rule, subtype, subject, frames) => ({ reason, record, rule, subtype, subject, at: { '-': { [frames]: null } } });

export const STEP_EXCEPTIONS = [
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/landing-at-stage-record.json#', 'step-semantics', 'child-count', "outerCbar", '30'),
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/landing-at-stage-record.json#', 'mark-persistence', 'never-paints', "fallback 2:0", '31'),
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/landing-at-stage-record.json#', 'mark-persistence', 'never-paints', "fallback 2:1", '32'),
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/landing-at-stage-record.json#', 'mark-persistence', 'never-paints', "fallback 2:3", '34'),
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/landing-at-stage-record.json#', 'mark-persistence', 'late-start', "coindex identity.occurrences 2:0", '35'),
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/landing-at-stage-record.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "2:0", '31'),
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/object-language-metalanguage.json#', 'step-semantics', 'unowned-repaint', "rSubjectBase", '21'),
  x(UNRECOGNIZED_MOVEMENT, 'replay-regressions/object-language-metalanguage.json#', 'step-semantics', 'unowned-repaint', "rSubjectBase::__leaf", '21'),
  x(RESTATED_BEFORE_MOMENT, 'movement/holdout-transitions.json#/1', 'step-semantics', 'unowned-repaint', "matrixI", '32'),
  x(RESTATED_BEFORE_MOMENT, 'replay-regressions/obsolete-plaque-pockets.json#', 'step-semantics', 'unowned-repaint', "v", '43'),
  x(RESTATED_BEFORE_MOMENT, 'replay-regressions/workspace-reservation.json#/cases/2', 'step-semantics', 'unowned-repaint', "matrixI", '35'),
  x(ORDER_BEFORE_CONTEXT, 'movement/holdout-transitions.json#/1', 'mark-persistence', 'never-paints', "fallback 1:0", '36'),
  x(ORDER_BEFORE_CONTEXT, 'movement/projected-head-landing.json#/analyses/0', 'mark-persistence', 'never-paints', "fallback 1:1", '27'),
  x(ORDER_BEFORE_CONTEXT, 'movement/restated-chains.json#/0', 'mark-persistence', 'never-paints', "fallback 3:6", '62'),
  x(ORDER_BEFORE_CONTEXT, 'movement/saved-qualification.json#/1', 'mark-persistence', 'never-paints', "fallback 4:0", '32'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'late-start', "node-badges theta.grid 1:0", '21'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'late-start', "node-plaque theta.grid 1:0", '21'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'never-paints', "fallback 2:1", '28'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'late-start', "trajectory tier2.movement-path 2:1", '29'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'late-start', "node-plaque theta.grid 2:0", '29'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'late-start', "coindex identity.occurrences 2:3", '31'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/scaffold-parent-visibility.json#', 'mark-persistence', 'never-paints', "fallback 2:0", '17'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/workspace-component-lifetime.json#/cases/3', 'mark-persistence', 'never-paints', "fallback 4:1", '36'),
  x(ORDER_BEFORE_CONTEXT, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-persistence', 'never-paints', "fallback 3:0", '38'),
  x(VANISHED_AT_STAGE_START, 'movement/source-occurrence-ownership.json#/0', 'mark-persistence', 'ends-before-removal', "trajectory tier2.movement-path 2:0", '38'),
  x(VANISHED_AT_STAGE_START, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'ends-before-removal', "trajectory tier2.movement-path 1:1", '26'),
  x(VANISHED_AT_STAGE_START, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'ends-before-removal', "node-plaque theta.grid 1:0", '26'),
  x(VANISHED_AT_STAGE_START, 'replay-regressions/review-workspace-boundaries.json#/cases/1', 'mark-persistence', 'ends-before-removal', "node-plaque pf.realization 0:0", '55'),
  x(COMPOSED_BEFORE_MOMENT, 'replay-regressions/clitic-displacement.json#/fixtures/1/analysis', 'mark-persistence', 'composed-before-moment', "node-badges theta.grid 0:0", '29'),
  x(COMPOSED_BEFORE_MOMENT, 'replay-regressions/review-workspace-boundaries.json#/cases/2', 'mark-persistence', 'composed-before-moment', "node-badges theta.grid 2:4", '52'),
  x(COMPOSED_BEFORE_MOMENT, 'replay-regressions/workspace-historical-continuity.json#/cases/1', 'mark-persistence', 'composed-before-moment', "node-badges theta.grid 2:4", '52'),
  x(RENAMED, 'movement/source-occurrence-ownership.json#/0', 'contract-output', 'renamed-anchor', "4:a1_vi", 'record'),
  x(RENAMED, 'replay-regressions/case-source-transfer.json#', 'contract-output', 'renamed-anchor', "3:v2", 'record'),
  x(RENAMED, 'replay-regressions/complex-head-chain-restatement.json#', 'contract-output', 'renamed-anchor', "3:i0", 'record'),
  x(RENAMED, 'replay-regressions/complex-head-chain-restatement.json#', 'contract-output', 'renamed-anchor', "3:v1", 'record'),
  x(RENAMED, 'replay-regressions/complex-head-chain-restatement.json#', 'contract-output', 'renamed-anchor', "4:s0", 'record'),
  x(RENAMED, 'replay-regressions/renamed-head-anchors.json#', 'contract-output', 'renamed-anchor', "3:v1", 'record'),
  x(RENAMED, 'replay-regressions/renamed-head-anchors.json#', 'contract-output', 'renamed-anchor', "3:o2", 'record'),
  x(RENAMED, 'replay-regressions/renamed-head-anchors.json#', 'contract-output', 'renamed-anchor', "4:subject1", 'record'),
  x(RENAMED, 'replay-regressions/unrendered-head-movement.json#', 'contract-output', 'renamed-anchor', "3:verb", 'record'),
  x(SELF_SPELLED, 'replay-regressions/self-spelled-realization.json#', 'contract-output', 'self-spelled-realization', "3:bPronoun,bRun,bGo,bBuy,bRice", 'record'),
  x(OBJECT_LANGUAGE, 'replay-regressions/object-language-metalanguage.json#', 'contract-output', 'object-language-metalanguage', "Han", 'record'),
  x(SPACED_ROLES, 'replay-regressions/unrendered-head-movement.json#', 'movement-unrendered', 'MOVEMENT_CONTEXT_UNRESOLVED', "2:0", '43'),
  x(PRIOR_SOURCE, 'movement/clause-context.json#/cases/6', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '4'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/0', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '16'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/2', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '19'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/2', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:1", '20'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/3', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '37'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/4', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '37'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/6', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '7'),
  x(PRIOR_SOURCE, 'replay-regressions/astra-turkish-relative-2.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "2:0", '47'),
  x(PRIOR_SOURCE, 'replay-regressions/coordination-and-ellipsis.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '41'),
  x(PRIOR_SOURCE, 'replay-regressions/independent-clause-and-realization.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '14'),
  x(PRIOR_SOURCE, 'replay-regressions/independent-clause-and-realization.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:1", '20'),
  x(PRIOR_SOURCE, 'replay-regressions/receiving-head-material.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '20'),
  x(PRIOR_SOURCE, 'replay-regressions/retained-root-growth.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '11'),
  x(PRIOR_SOURCE, 'replay-regressions/retained-root-growth.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:1", '28'),
  x(PRIOR_SOURCE, 'replay-regressions/unproven-second-landing.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '31'),
  x(PRIOR_SOURCE, 'replay-regressions/unproven-second-landing.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "1:1", '34'),
  x(CHAIN_ROLES, 'movement/holdout-transitions.json#/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "0:1", '32'),
  x(CHAIN_ROLES, 'movement/shared-landing.json#/analyses/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "1:3", '51'),
  x(CHAIN_ROLES, 'replay-regressions/compact-current-root.json#/cases/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "6:2", '55'),
  x(CHAIN_ROLES, 'replay-regressions/construction-slot-continuity.json#/cases/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "3:4", '37'),
  x(CHAIN_ROLES, 'replay-regressions/independent-clause-and-realization.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "0:2", '22'),
  x(CHAIN_ROLES, 'replay-regressions/obsolete-plaque-pockets.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "3:0", '50'),
  x(CHAIN_ROLES, 'replay-regressions/renamed-head-anchors.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "2:1", '27'),
];
