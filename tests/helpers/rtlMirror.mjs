/** The committed analyses whose right-to-left Replay layout is not the
 * reflection of their left-to-right layout, as replayCorpusLayout.test.mjs
 * finds them (`id kind[ frame n]`). Everywhere else right-to-left continuity
 * follows from the left-to-right checks, so a layout continuity check runs
 * right to left only for the records listed here. */
export const MIRROR_EXCEPTIONS = new Set([
  'movement/clause-context.json#/cases/3 stage-axis',
  'movement/clause-context.json#/cases/7 stage-axis',
  'movement/holdout-transitions.json#/0 stage-axis',
  'movement/saved-qualification.json#/3 stage-axis',
  'movement/source-occurrence-ownership.json#/1 stage-axis',
  'movement/source-occurrence-ownership.json#/2 stage-axis',
  'replay-regressions/diverse-recovery.json#/examples/3/analysis stage-axis',
  'replay-regressions/later-occupant-intermediate-landing.json# stage-axis',
  'replay-regressions/visual-human-catalog.json#/cases/3/analyses/0 stage-axis',
  'replay-regressions/workspace-source-continuity.json#/cases/2 stage-axis',
  'replay-regressions/merged-material-construction.json#/cases/0 frame-axis frame 9',
  'replay-regressions/pending-source-pronunciation.json# frame-axis frame 2',
  'replay-regressions/receiving-slot-width-control.json# frame-axis frame 10',
  'replay-regressions/unnamed-movement-roles.json#/cases/1 frame-axis frame 9',
  'replay-regressions/review-workspace-boundaries.json#/cases/0 not-mirrored frame 1',
  'replay-regressions/review-workspace-boundaries.json#/cases/1 not-mirrored frame 1',
  'replay-regressions/review-workspace-boundaries.json#/cases/2 not-mirrored frame 1',
  'replay-regressions/shared-landing-source.json# not-mirrored frame 1',
  'replay-regressions/workspace-attachment-continuity.json#/cases/0 not-mirrored frame 5',
  'replay-regressions/workspace-historical-continuity.json#/cases/1 not-mirrored frame 1',
  'replay-regressions/wrapper-contour-reservation.json# not-mirrored frame 1'
]);

/** The reading directions a layout continuity check runs for the committed
 * analysis `id` (a replayInvariantCorpus id such as `replay-regressions/x.json#/cases/0`). */
export const directionsFor = id => [...MIRROR_EXCEPTIONS].some(entry => entry.startsWith(`${id} `)) ? ['ltr', 'rtl'] : ['ltr'];
