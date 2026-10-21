/** Painted faults that remain in the human-catalogue analyses in a real browser,
 * each with its reason, for `npm run verify:browser-visual` (1440×900 'desktop'
 * and 390×844 'mobile'). Each exception is `{ rule, subtype, record, subject, at,
 * reason }` with `at` bounding every place: viewport → frame list → bound, for
 * example `{ desktop: { '39': 1.48 }, mobile: { '38-39': 1.2 } }` (null for a
 * rule without a measure). Matching follows tests/helpers/findings.mjs: a new
 * finding fails, so does one beyond its place's bound, and so does every listed
 * place where the fault no longer occurs. Records use the offline audit's
 * fixture ids (replay-regressions/visual-human-catalog.json#/cases/N/analyses/M);
 * frames are Replay frames, 'canopy', 'a>b' for a Next step or camera step,
 * 'rapid:a>b' for a rapid run and 'resize:WxH>WxH@frame' for a resize. Line
 * clearance distinguishes a connector that touches a plaque ('connector-plaque')
 * from one that runs into it ('connector-plaque-crossing'). A run writes
 * candidates for unexpected findings to proposed-exceptions.json; add one only
 * with a reason and the owner's approval as its last argument
 * (scripts/checkExceptionGrowth.mjs). A painted motion fault that an
 * immediate re-run does not show again is a warning in the receipt, not a
 * failure, so it is never listed.
 * Reviewed against the first native run of the gate (Chromium, 18 October). */

const PLAQUE_CROWDED = 'Open (catalog #3): no nearby pocket stays clear for the plaque\'s lifetime, so the allocator takes '
  + 'the nearest clear pocket beyond its nearby candidates. #74 and #84 relocate plaques whose anchor moves, not these.';
const MOBILE = 'mobile canvas: role label/landing past the canvas edge';
const STAGE_CROSSING = 'Open (stage-crossing layout): entering the last stage at 43>44, the subject movement relays out the clause, so '
  + '了, 走 and the matrix T slide into the raised subject\'s gap (the motion comparator\'s remaining frame-44 motion). '
  + 'Waiting pieces (#95) no longer move here; this slide is deferred to the stage-crossing layout work.';
const CATALOGUE = index => `replay-regressions/visual-human-catalog.json#/cases/${index}/analyses/0`;
const x = (reason, record, rule, subtype, subject, at, approval) => ({ reason, record, rule, subtype, subject, at, ...(approval && { approval }) });

export const EXCEPTIONS = [
  x(MOBILE, CATALOGUE(2), 'first-paint-continuity', 'off-canvas:moved', 'stage 7', { mobile: { '61>62': 30.59 } }),
  x(PLAQUE_CROWDED, CATALOGUE(6), 'mark-distance', 'plaque', 'plaque(0:1 θ GRID; v; experiencer; j)@relativeSubject',
    { desktop: { '14-43': 1.19 }, mobile: { '14-43': 1.19 } }),
  x(STAGE_CROSSING, CATALOGUE(6), 'first-paint-continuity', 'jump:stage-coordinates', 'stage 4',
    { desktop: { '43>44': 76.31 }, mobile: { '43>44': 38.15 } }),
  x(STAGE_CROSSING, CATALOGUE(6), 'rapid-motion', 'node-jump', '@view',
    { desktop: { 'rapid:42>48': 274.7 } }),
  x(STAGE_CROSSING, CATALOGUE(6), 'step-motion', 'node-jump', '@view',
    { desktop: { '43>44': 274.7 } }),
  x(STAGE_CROSSING, CATALOGUE(6), 'settled-path-independence', 'retention', 'stage 4',
    { mobile: { '43>44': 41.13 } })
];
