/** Violations of the general Replay rules that remain in the committed
 * fixtures, each with its reason, for the invariant sweep in
 * tests/replayInvariants.test.mjs. Each entry names the subject nodes one rule
 * reports at one frame and expands to one exception per subject in the format
 * of tests/helpers/findings.mjs. The sweep matches them exactly: a new
 * violation fails, and so does a listed one that no longer occurs. These rules
 * have no measure, so every bound is null. An entry a change adds or lets
 * grow also takes the owner's approval as its last argument
 * (scripts/checkExceptionGrowth.mjs). */

const x = (reason, record, rule, frame, subjects, approval) => subjects.split(' ')
  .map(subject => ({ reason, record, rule, subtype: null, subject, at: { '-': { [String(frame)]: null } }, ...(approval && { approval }) }));

export const EXCEPTIONS = [
].flat();
