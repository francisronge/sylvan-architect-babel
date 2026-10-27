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
export const EXCEPTIONS = [];
