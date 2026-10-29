/** The committed analyses whose right-to-left Replay layout is not the
 * reflection of their left-to-right layout, as tests/replayCorpusLayoutPart*.test.mjs
 * finds them (`id kind[ frame n]`). Right-to-left Replay reuses the
 * left-to-right plan (stageCoordinates.ts, `reflectedReservations`), so none
 * departs today. Everywhere the reflection holds, right-to-left continuity
 * follows from the left-to-right checks, so a layout continuity check runs
 * right to left only for the records listed here. */
export const MIRROR_EXCEPTIONS = new Set([]);

/** The reading directions a layout continuity check runs for the committed
 * analysis `id` (a replayInvariantCorpus id such as `replay-regressions/x.json#/cases/0`). */
export const directionsFor = id => [...MIRROR_EXCEPTIONS].some(entry => entry.startsWith(`${id} `)) ? ['ltr', 'rtl'] : ['ltr'];
