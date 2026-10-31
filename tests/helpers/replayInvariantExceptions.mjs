/** Violations of the general Replay rules that remain in the committed
 * fixtures, each with its reason, for the invariant sweep in
 * tests/replayInvariants.test.mjs. Each entry names the subject nodes one rule
 * reports at one frame and expands to one exception per subject in the format
 * of tests/helpers/findings.mjs. The sweep matches them exactly: a new
 * violation fails, and so does a listed one that no longer occurs. These rules
 * have no measure, so every bound is null. An entry a change adds or lets
 * grow also takes the owner's approval as its last argument
 * (scripts/checkExceptionGrowth.mjs). */

const FIRST_STAGE_REWRITE = 'Defect: a first-stage movement claim with no preceding stage to prove its source becomes a neutral rewrite; '
  + 'its moment shows only the anchored root of the rewritten phrase, and the rest of that phrase appears later with an ordinary merge.';

const UNPROVEN_SOURCE_LANDING = 'Open: movement recognition cannot prove the source in the preceding stage (a first-stage claim, '
  + 'or a source the stage does not keep), so the claim stays neutral; its moment still introduces the authored landing, which no '
  + 'construction step builds.';

const x = (reason, record, rule, frame, subjects, approval) => subjects.split(' ')
  .map(subject => ({ reason, record, rule, subtype: null, subject, at: { '-': { [String(frame)]: null } }, ...(approval && { approval }) }));

export const EXCEPTIONS = [
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/0', 'parent-after-children', 16, 'detP portraitBar'),
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/0', 'no-early-reveal', 17,
    'detP portraitBar detBar nPortrait ofPP detWhich nPortrait::__leaf ofPbar detWhich::__leaf pOf npSelf pOf::__leaf selfBar nSelf nSelf::__leaf'),
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/2', 'parent-after-children', 19, 'argumentDbar'),
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/2', 'no-early-reveal', 23,
    'argumentDbar demonstrativeD childrenNP demonstrativeD::__leaf childrenNbar childrenN childrenN::__leaf'),
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/3', 'parent-after-children', 37, 'sdh moh'),
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/3', 'no-early-reveal', 38,
    'sdh moh donoh studenth moh::__leaf donoh::__leaf studenth::__leaf'),
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/4', 'parent-after-children', 37, 'sdh moh'),
  x(FIRST_STAGE_REWRITE, 'movement/holdout-transitions.json#/4', 'no-early-reveal', 38,
    'sdh moh donoh studenth moh::__leaf donoh::__leaf studenth::__leaf'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/independent-clause-and-realization.json#', 'parent-after-children', 20, 'operatorHighNbar'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/independent-clause-and-realization.json#', 'no-early-reveal', 21, 'operatorHighNbar operatorHighN'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/receiving-head-material.json#', 'parent-after-children', 20, 'booksDbar'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/receiving-head-material.json#', 'no-early-reveal', 21,
    'booksDbar booksD booksNP booksNbarOuter booksNbarInner demP bookN demBar bookN::__leaf dem dem::__leaf'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'parent-after-children', 20, 'rVAtT rvAtTLeaf'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'no-early-reveal', 21, 'rVAtT rvAtTLeaf rVAtT::__leaf'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'parent-after-children', 37, 'mVAtT mvAtTLeaf'),
  x(FIRST_STAGE_REWRITE, 'replay-regressions/retained-root-growth.json#', 'no-early-reveal', 38, 'mVAtT mvAtTLeaf mVAtT::__leaf'),
  x(UNPROVEN_SOURCE_LANDING, 'movement/clause-context.json#/cases/6', 'relation-construction', 50, 'was1'),
  x(UNPROVEN_SOURCE_LANDING, 'movement/holdout-transitions.json#/0', 'relation-construction', 16, 'wh'),
  x(UNPROVEN_SOURCE_LANDING, 'movement/holdout-transitions.json#/2', 'relation-construction', 19, 'matrixSubjectDP'),
  x(UNPROVEN_SOURCE_LANDING, 'movement/holdout-transitions.json#/2', 'relation-construction', 20, 'finiteV'),
  x(UNPROVEN_SOURCE_LANDING, 'movement/holdout-transitions.json#/3', 'relation-construction', 37, 'sqh'),
  x(UNPROVEN_SOURCE_LANDING, 'movement/holdout-transitions.json#/4', 'relation-construction', 37, 'sqh'),
  x(UNPROVEN_SOURCE_LANDING, 'movement/holdout-transitions.json#/6', 'relation-construction', 5, 'verb'),
  x(UNPROVEN_SOURCE_LANDING, 'replay-regressions/coordination-and-ellipsis.json#', 'relation-construction', 40, 'bruno2'),
  x(UNPROVEN_SOURCE_LANDING, 'replay-regressions/independent-clause-and-realization.json#', 'relation-construction', 6, 'readRaised'),
  x(UNPROVEN_SOURCE_LANDING, 'replay-regressions/independent-clause-and-realization.json#', 'relation-construction', 20, 'operatorHigh'),
  x(UNPROVEN_SOURCE_LANDING, 'replay-regressions/receiving-head-material.json#', 'relation-construction', 20, 'booksDP'),
  x(UNPROVEN_SOURCE_LANDING, 'replay-regressions/retained-root-growth.json#', 'relation-construction', 20, 'rvAtT'),
  x(UNPROVEN_SOURCE_LANDING, 'replay-regressions/retained-root-growth.json#', 'relation-construction', 37, 'mvAtT'),
].flat();
