/** Step-semantics, mark-persistence and contract-warning findings that remain
 * in the committed fixtures, each with its reason, for the invariant sweep in
 * tests/replayInvariants.test.mjs. Matching follows tests/helpers/findings.mjs:
 * a new finding fails, and so does every listed frame where it no longer
 * occurs. These rules have no measure, so every bound is null. Contract
 * warnings are facts about authored data at 'record'; the movement warning is
 * placed at its relation's moment. An entry a change adds or lets
 * grow also takes the owner's approval as its last argument
 * (scripts/checkExceptionGrowth.mjs). */

const UNRESOLVED_ENDPOINTS = 'Open: movement recognition finds no single source and landing (list-valued or competing landing '
  + 'fields), so the claim stays neutral and draws no path; its own moment still introduces the copy.';
const CONTEXT_NOT_AWAITED = 'Diagnosed RELATION_TIMING_CONFLICT: the raising chain names, only as context, the verb trace that the '
  + 'later V-to-I movement introduces. A movement keeps its own moment rather than wait for a contextual anchor, so this mark has '
  + 'no displayed anchor at its moment.';
const RENAMED = 'Authored data: the model writes a moved or restated occurrence under a new id, so marks anchored at the old id end.';
const SELF_SPELLED = 'Authored data: a whole unspaced sentence grouped as one word under the spell-out contract.';
const OBJECT_LANGUAGE = 'Authored data: the analysis names relations, roles and labels in Chinese.';
const PRIOR_SOURCE = 'Open: movement recognition cannot prove the source in the preceding stage (a first-stage claim, or a source the '
  + 'stage does not keep), so the movement draws no path.';
const CHAIN_ROLES = 'Open: a chain or licensing relation with movement-shaped roles; recognition finds no single source and landing.';
const OPEN_ROLES = 'Open: no field of the claim names a movement direction or occurrence role (subject, thetaPosition, topic, '
  + 'edgeOccurrence, sourceBeforeMovement), and the Tier 2 contract infers no movement from geometry, so the displacement '
  + 'stays a neutral copy at its moment without an arrow.';
const INTERMEDIATE_TRACE = 'Open: the claim calls its lower occurrence intermediateTrace, which cannot select the endpoint because '
  + 'operator-variable chain claims use that name for a middle copy of the chain, and no other field names a movement role, so '
  + 'the copy stays neutral at its moment without an arrow.';

const x = (reason, record, rule, subtype, subject, frames, approval) => ({ reason, record, rule, subtype, subject, at: { '-': { [frames]: null } },
  ...(approval && { approval }) });

export const STEP_EXCEPTIONS = [
  x(UNRESOLVED_ENDPOINTS, 'replay-regressions/unrecognized-movement.json#/cases/3', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "2:0", '26'),
  x(CONTEXT_NOT_AWAITED, 'movement/holdout-transitions.json#/1', 'mark-persistence', 'never-paints', "fallback 1:0", '28'),
  x(CONTEXT_NOT_AWAITED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-persistence', 'never-paints', "fallback 3:0", '31'),
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
  x(PRIOR_SOURCE, 'movement/clause-context.json#/cases/6', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '35'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/0', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '13'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/2', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '16'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/2', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:1", '17'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/3', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '26'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/4', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '26'),
  x(PRIOR_SOURCE, 'movement/holdout-transitions.json#/6', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '5'),
  x(PRIOR_SOURCE, 'replay-regressions/astra-turkish-relative-2.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "2:0", '41'),
  x(PRIOR_SOURCE, 'replay-regressions/coordination-and-ellipsis.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '31'),
  x(PRIOR_SOURCE, 'replay-regressions/independent-clause-and-realization.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '6'),
  x(PRIOR_SOURCE, 'replay-regressions/independent-clause-and-realization.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:1", '18'),
  x(PRIOR_SOURCE, 'replay-regressions/receiving-head-material.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '17'),
  x(PRIOR_SOURCE, 'replay-regressions/retained-root-growth.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:0", '14'),
  x(PRIOR_SOURCE, 'replay-regressions/retained-root-growth.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "0:1", '27'),
  x(PRIOR_SOURCE, 'replay-regressions/unproven-second-landing.json#', 'movement-unrendered', 'MOVEMENT_PRIOR_SOURCE_UNPROVEN', "3:1", '21',
    { by: 'Francis Ronge', on: '2026-10-24', note: 'The existing listed unproven second wh hop (was relation 1:1 at frame 34, the behaviour this fixture tests), renumbered after two stages were restored before T-to-C. Francis on editing this fixture, 24 Oct in the lead session: "do whatever you want with it"; he then reviewed the result ("It looks good.")',
      accepts: { '-': { '27': null } } }),
  x(CHAIN_ROLES, 'movement/holdout-transitions.json#/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "0:1", '26'),
  x(CHAIN_ROLES, 'movement/shared-landing.json#/analyses/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "1:3", '38'),
  x(CHAIN_ROLES, 'replay-regressions/compact-current-root.json#/cases/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "6:2", '44'),
  x(CHAIN_ROLES, 'replay-regressions/construction-slot-continuity.json#/cases/0', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "3:4", '32'),
  x(CHAIN_ROLES, 'replay-regressions/independent-clause-and-realization.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "0:2", '20'),
  x(CHAIN_ROLES, 'replay-regressions/obsolete-plaque-pockets.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "3:0", '42'),
  x(CHAIN_ROLES, 'replay-regressions/renamed-head-anchors.json#', 'movement-unrendered', 'MOVEMENT_ENDPOINTS_UNRESOLVED', "2:1", '24'),
  x(OPEN_ROLES, 'replay-regressions/kept-id-landing.json#', 'movement-unrendered', 'COPY_WITHOUT_PATH', "4:0", '37'),
  x(OPEN_ROLES, 'replay-regressions/unrecognized-movement.json#/cases/4', 'movement-unrendered', 'COPY_WITHOUT_PATH', "3:0", '31'),
  x(OPEN_ROLES, 'replay-regressions/unrecognized-movement.json#/cases/4', 'movement-unrendered', 'COPY_WITHOUT_PATH', "3:1", '32'),
  x(INTERMEDIATE_TRACE, 'replay-regressions/rewrite-stage-new-head.json#', 'movement-unrendered', 'COPY_WITHOUT_PATH', "3:0", '45'),
];
