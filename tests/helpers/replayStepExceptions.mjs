/** Step-semantics, mark-persistence and contract-warning findings that remain
 * in the committed fixtures, each with its reason, for the invariant sweep in
 * tests/replayInvariants.test.mjs. Matching follows tests/helpers/findings.mjs:
 * a new finding fails, and so does every listed frame where it no longer
 * occurs. These rules have no measure, so every bound is null. Contract
 * warnings are facts about authored data at 'record'; the movement warning is
 * placed at its relation's moment. */

const UNRESOLVED_ENDPOINTS = 'Open: movement recognition finds no single source and landing (list-valued or competing landing '
  + 'fields), so the claim stays neutral and draws no path; its own moment still introduces the copy.';
const NEEDS_CYCLE = 'Contract conflict (diagnosed RELATION_TIMING_CONFLICT): two relations of the stage each need syntax the '
  + 'other\'s moment introduces, so no Replay order satisfies both. They, and a relation needing either, keep authored order, and '
  + 'structure is not introduced early, so this mark has no displayed anchor at its own moment.';
const CONTEXT_NOT_AWAITED = 'Diagnosed RELATION_TIMING_CONFLICT: the raising chain names, only as context, the verb trace that the '
  + 'later V-to-I movement introduces. A movement keeps its own moment rather than wait for a contextual anchor, so this mark has '
  + 'no displayed anchor at its moment.';
const RENAMED = 'Authored data: the model writes a moved or restated occurrence under a new id, so marks anchored at the old id end.';
const SELF_SPELLED = 'Authored data: a whole unspaced sentence grouped as one word under the spell-out contract.';
const OBJECT_LANGUAGE = 'Authored data: the analysis names relations, roles and labels in Chinese.';
const PRIOR_SOURCE = 'Open: movement recognition cannot prove the source in the preceding stage (a first-stage claim, or a source the '
  + 'stage does not keep), so the movement draws no path.';
const CHAIN_ROLES = 'Open: a chain or licensing relation with movement-shaped roles; recognition finds no single source and landing.';

const x = (reason, record, rule, subtype, subject, frames) => ({ reason, record, rule, subtype, subject, at: { '-': { [frames]: null } } });

export const STEP_EXCEPTIONS = [
  x(UNRESOLVED_ENDPOINTS, 'replay-regressions/landing-at-stage-record.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "2:0", '30'),
  x(UNRESOLVED_ENDPOINTS, 'replay-regressions/unrecognized-movement.json#/cases/1', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "8:1", '51'),
  x(UNRESOLVED_ENDPOINTS, 'replay-regressions/unrecognized-movement.json#/cases/2', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "3:0", '29'),
  x(UNRESOLVED_ENDPOINTS, 'replay-regressions/unrecognized-movement.json#/cases/2', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "7:0", '43'),
  x(UNRESOLVED_ENDPOINTS, 'replay-regressions/unrecognized-movement.json#/cases/3', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "2:0", '30'),
  x(CONTEXT_NOT_AWAITED, 'movement/holdout-transitions.json#/1', 'mark-persistence', 'never-paints', "fallback 1:0", '36'),
  x(CONTEXT_NOT_AWAITED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-persistence', 'never-paints', "fallback 3:0", '38'),
  x(NEEDS_CYCLE, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'never-paints', "fallback 2:1", '28'),
  x(NEEDS_CYCLE, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'late-start', "trajectory tier2.movement-path 2:1", '29'),
  x(NEEDS_CYCLE, 'replay-regressions/case-source-transfer.json#', 'mark-persistence', 'late-start', "node-plaque theta.grid 2:0", '29'),
  x(RENAMED, 'movement/source-occurrence-ownership.json#/0', 'contract-output', 'renamed-anchor', "4:a1_vi", 'record'),
  x(RENAMED, 'replay-regressions/case-source-transfer.json#', 'contract-output', 'renamed-anchor', "3:v2", 'record'),
  x(RENAMED, 'replay-regressions/complex-head-chain-restatement.json#', 'contract-output', 'renamed-anchor', "3:i0", 'record'),
  x(RENAMED, 'replay-regressions/complex-head-chain-restatement.json#', 'contract-output', 'renamed-anchor', "3:v1", 'record'),
  x(RENAMED, 'replay-regressions/complex-head-chain-restatement.json#', 'contract-output', 'renamed-anchor', "4:s0", 'record'),
  x(RENAMED, 'replay-regressions/renamed-head-anchors.json#', 'contract-output', 'renamed-anchor', "3:v1", 'record'),
  x(RENAMED, 'replay-regressions/renamed-head-anchors.json#', 'contract-output', 'renamed-anchor', "3:o2", 'record'),
  x(RENAMED, 'replay-regressions/renamed-head-anchors.json#', 'contract-output', 'renamed-anchor', "4:subject1", 'record'),
  x(SELF_SPELLED, 'replay-regressions/self-spelled-realization.json#', 'contract-output', 'self-spelled-realization', "3:bPronoun,bRun,bGo,bBuy,bRice", 'record'),
  x(OBJECT_LANGUAGE, 'replay-regressions/object-language-metalanguage.json#', 'contract-output', 'object-language-metalanguage', "Han", 'record'),
  x(OBJECT_LANGUAGE, 'replay-regressions/unrecognized-movement.json#/cases/0', 'contract-output', 'object-language-metalanguage', "Han", 'record'),
  x(OBJECT_LANGUAGE, 'replay-regressions/unrecognized-movement.json#/cases/5', 'contract-output', 'object-language-metalanguage', "Han", 'record'),
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
  x(CHAIN_ROLES, 'replay-regressions/obsolete-plaque-pockets.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "3:0", '49'),
  x(CHAIN_ROLES, 'replay-regressions/renamed-head-anchors.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "2:1", '27'),
];
