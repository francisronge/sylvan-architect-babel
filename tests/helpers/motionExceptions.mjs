/** Motion faults the owner has accepted, for the corpus motion gate
 * (scripts/compareReplayCorpus.mjs, CI job `corpus-motion`). Each entry covers
 * one fault of scripts/replayMotionContinuity.mjs in one corpus record:
 * `{ reason, record, rule: 'motion', subtype: <fault kind>, subject: <node id>,
 * at: { '-': { '<frame>': <distance in tree units> } }, approval }`, where
 * `record` is the comparator's record id (for the fixture archive manifest,
 * `fixture:<source>#<pointer>`). A new or worsened fault that an entry covers
 * within its bound (tests/helpers/findings.mjs) is reported, not a violation.
 * Every entry needs Francis's approval: { by, on, note, accepts }
 * (scripts/checkExceptionGrowth.mjs). Motion below the gate's noticeable
 * tolerance never needs an entry. */
const REASON = 'Accepted trade-off (case 3, 27 Oct): with no one-branch N\u2032 frame, attaching the relative clause beside an N\u2032 that already has a parent slides the old N\u2032 and the waiting clause into their slots at that merge; main shows a wrong one-branch frame and then slides the spine. Avoiding any slide would need room kept in earlier frames, which widens trees.';
const APPROVAL = at => ({ by: 'Francis Ronge', on: '2026-10-27', note: 'Reviewed case 3 on the unary and option-2 pages; after option 2 did not remove the slide: \u201calright. then it\u2019s whatever.\u201d (lead session, 27 Oct)', accepts: at });
const x = (record, subtype, subject, at) => ({ reason: REASON, record, rule: 'motion', subtype, subject, at, approval: APPROVAL(at) });

const LOWERED_REASON = 'Existing jump on main (C 464, I and VP 66 at the CP-extraposition crossing): the lowered matrix IP is laid out again one row down and slides under C, and the camera carry falls back to it. Putting the chain index on the moved CP label narrows its words, which grows the same jump. Fixing the slide is shared layout work across 11 such crossings, owed next.';
const LOWERED_APPROVAL = at => ({ by: 'Francis Ronge', on: '2026-10-29', note: 'Asked to approve the jump growing to 574 so the index change can merge, with the 11-tree lowered-subtree jump as the next layout job: \u201cyes\u201d; for I and VP 66\u219292 at the same step: \u201cyeah yeah, I ALREADY SAID YES, GIVEN THAT YOU WILL DEAL WITH IT AFTERWARDS.\u201d (lead session, 29 Oct)', accepts: at });
const lowered = (subtype, subject, at) => ({ reason: LOWERED_REASON, record: 'fixture:movement/clause-context.json#/cases/2', rule: 'motion', subtype, subject, at, approval: LOWERED_APPROVAL(at) });

const WIDER_THETA_LABEL = 'Accepted trade-off (theta letters, 29 Oct): What is the Theme of bought and ends the embedded clause that say takes, so it correctly shows both grids\u2019 letters; the shared lifetime-contour layout amplifies that wider label into a different layout of this tree.';
const WIDER_THETA_APPROVAL = at => ({ by: 'Francis Ronge', on: '2026-10-29', note: 'Asked \u201c\u03b8 fix: accept that one tree\u2019s slightly bigger jump (shared-landing-source: the correctly wider \u201cWhat\u201d label shifts syntax 196 units at frame 41 and moves the say grid\u2019s plaque), so it can merge?\u201d: \u201c1. YES IDC, IF IT\u2019S NOT SIGNIFICANT DON\u2019T ASK ME.\u201d (lead session, 29 Oct)', accepts: at });
const widerTheta = (subject, at) => ({ reason: WIDER_THETA_LABEL, record: 'fixture:replay-regressions/shared-landing-source.json#', rule: 'motion',
  subtype: 'unowned-motion', subject, at, approval: WIDER_THETA_APPROVAL(at) });

export const EXCEPTIONS = [
  x('relative-clause-waiting-clearance', 'attachment-site-motion', 'letterInnerNBar', { '-': { '58': 678.46 } }),
  x('relative-clause-waiting-clearance', 'attachment-site-motion', 'relativeCP', { '-': { '58': 428.6 } }),
  x('relative-clause-waiting-clearance', 'shape-motion', 'matrixIBar', { '-': { '57': 256.54 } }),
  x('fixture:replay-regressions/relative-clause-waiting-clearance.json#', 'attachment-site-motion', 'letterInnerNBar', { '-': { '58': 678.46 } }),
  x('fixture:replay-regressions/relative-clause-waiting-clearance.json#', 'attachment-site-motion', 'relativeCP', { '-': { '58': 428.6 } }),
  x('fixture:replay-regressions/relative-clause-waiting-clearance.json#', 'shape-motion', 'matrixIBar', { '-': { '57': 256.54 } }),
  x('fixture:replay-regressions/workspace-component-lifetime.json#/cases/2', 'attachment-site-motion', 'letterInnerNBar', { '-': { '58': 678.46 } }),
  x('fixture:replay-regressions/workspace-component-lifetime.json#/cases/2', 'attachment-site-motion', 'relativeCP', { '-': { '58': 428.6 } }),
  x('fixture:replay-regressions/workspace-component-lifetime.json#/cases/2', 'shape-motion', 'matrixIBar', { '-': { '57': 256.54 } }),
  lowered('unowned-motion', 'matrixC', { '-': { '55': 573.67 } }),
  lowered('shape-motion', 'matrixI', { '-': { '55': 92.19 } }),
  lowered('shape-motion', 'matrixVP', { '-': { '55': 92.19 } }),
  ...['buyV', 'embeddedI', 'maryNP', 'thatC'].map(subject => widerTheta(subject, { '-': { '41': 283.59 } })),
];
