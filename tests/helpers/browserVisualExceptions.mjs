/** Painted faults that remain in the human-catalogue analyses in a real browser,
 * each with its reason, for `npm run verify:browser-visual` (1440×900 'desktop'
 * and 390×844 'mobile'). Matching follows tests/helpers/findings.mjs: a new
 * finding fails, so does one beyond its bound, and so does every listed place
 * where the fault no longer occurs. Records use the offline audit's fixture ids
 * (replay-regressions/visual-human-catalog.json#/cases/N/analyses/M) and frames
 * are Replay frames, 'canopy', 'a>b' for a Next step, 'rapid:a>b' for a rapid
 * run and 'resize:WxH>WxH@frame' for a resize. A run writes candidates for
 * unexpected findings to proposed-exceptions.json; add one only with a reason.
 *
 * Empty until the first native run on this branch is reviewed. */
export const EXCEPTIONS = [];
