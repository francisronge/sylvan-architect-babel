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
 * with a reason.
 *
 * Empty until the first native run on this branch is reviewed. */
export const EXCEPTIONS = [];
