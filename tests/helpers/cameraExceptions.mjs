/** Camera faults that remain in the committed fixtures on main, each with its
 * reason, for `npm run verify:camera-offline` (desktop and mobile canvases).
 * Matching follows tests/helpers/findings.mjs: a new finding fails, so does one
 * beyond its bound, and so does every listed frame where the fault no longer
 * occurs. Each place keeps its own bound, the rule's measure in CSS pixels;
 * frames are steps 'a>b'. An entry a change adds or lets
 * grow also takes the owner's approval as its last argument
 * (scripts/checkExceptionGrowth.mjs). */

const STAGE_RELAYOUT = 'Open (layout): the new stage lays out the unmoved shared syntax differently, not merely shifted, so the '
  + 'first pose carried by its median shift (PR #77) still leaves it jumping or partly beyond the canvas.';
const RELAYOUT_WITHIN_STAGE = 'Open (construction/layout, not camera): with the camera unchanged inside one stage, an inserted node '
  + 'or rebuilt workspace displaces syntax whose attachment is unchanged.';
const SPREAD_RETENTION = 'Open (layout): the new stage spreads the unmoved shared syntax in opposite directions, so its carried '
  + 'median shift is near zero and the retained view holds that syntax a few pixels less still than a fresh fit would.';
const MOVED_OFF_CANVAS = 'Open (camera, low severity): the moved constituent\'s landing first paints beyond the canvas while the '
  + 'unmoved syntax stays in place; the camera then travels to it.';

const CONTINUED_RECENTRE = 'Open (layout): the stage builds a new N above the continued nominal\'s noun (N + P -> N), and the '
  + 'continued D and Num, which keep their slot and daughters, re-centre over the wider N as the stage begins. D stays attached, '
  + 'but the preceding layout reserved only the noun\'s width, so they shift sideways.';

const LOWERED_SUBTREE = 'Accepted (camera, fixes A+B): at a stage crossing whose movement inserts a parent above an existing '
  + 'subtree, the camera holds the syntax that did not move still, so the lowered subtree slides to its new place instead of the '
  + 'rest of the tree jumping.';
const CROSSING_CENTRE = 'Accepted (camera, fixes A+B): entering a new stage, an axis the camera has to pan is centred at the '
  + 'retained zoom, so the settled pose differs by a few pixels (or, with a lowered subtree, more) from a direct selection.';

const x = (reason, record, rule, subtype, subject, at, approval) => ({ reason, record, rule, subtype, subject, at, ...(approval && { approval }) });

export const EXCEPTIONS = [
  x(MOVED_OFF_CANVAS, 'movement/clause-context.json#/cases/2', 'first-paint-continuity', 'off-canvas:moved', 'stage 2',
    { mobile: { '43>44': 68.72 } }),
  x(MOVED_OFF_CANVAS, 'movement/clause-context.json#/cases/7', 'first-paint-continuity', 'off-canvas:moved', 'stage 2',
    { mobile: { '20>21': 76.59 } }),
  x(MOVED_OFF_CANVAS, 'movement/holdout-transitions.json#/0', 'first-paint-continuity', 'off-canvas:moved', 'stage 2',
    { mobile: { '27>28': 31.98 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/clitic-displacement.json#/fixtures/1/analysis', 'first-paint-continuity', 'off-canvas:moved', 'stage 4',
    { mobile: { '21>22': 83.23 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/nested-premovement-width.json#', 'first-paint-continuity', 'off-canvas:moved', 'stage 4',
    { mobile: { '48>49': 28.17 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/relative-clause-waiting-clearance.json#', 'first-paint-continuity', 'off-canvas:moved', 'stage 5',
    { mobile: { '53>54': 144.66 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/reviewed-construction.json#/cases/0', 'first-paint-continuity', 'off-canvas:moved', 'stage 12',
    { mobile: { '43>44': 57.45 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/workspace-component-lifetime.json#/cases/2', 'first-paint-continuity', 'off-canvas:moved', 'stage 5',
    { mobile: { '53>54': 144.66 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/diverse-recovery.json#/examples/0/analysis', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '30>31,31>30': 33.2 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/reviewed-construction.json#/cases/1', 'first-paint-continuity', 'jump:relayout', 'stage 3',
    { desktop: { '28>29,29>28': 30.82 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/workspace-arabic-continuity.json#/cases/6', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '35>36,36>35': 27.73 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/workspace-arabic-continuity.json#/cases/8', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '35>36,36>35': 27.73 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/workspace-arabic-continuity.json#/cases/9', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '36>37,37>36': 38.19 } },
    { by: 'Francis Ronge', on: '2026-10-27', note: 'plaque reach: the theta Speaker plaque moves from 1.15x its reach to beside its anchor, zooming the stage 1.7%; "I explicitly appove the arabic camera jump" (lead session)',
      accepts: { desktop: { '43>44,44>43': 38.19 } } }),
  x(STAGE_RELAYOUT, 'replay-regressions/compact-current-root.json#/cases/0', 'first-paint-continuity', 'off-canvas:unmoved', 'stage 3',
    { mobile: { '16>17': 56.53 } }),
  // Catalog #24's record (47-zh-relative.r1.B a6), also committed as the waiting-root fixture. Waiting slots
  // fixed catalog #19-#21 (13>14) and the off-canvas first paint into stage 3; its stage relayout remains.
  // The subject movement now brings T' at 34>35, so the clause rises a row while 我 and 昨天 stay; the
  // insertion of the T that 昨天 adjoins to is its own External Merge, no longer the scope claim's 39>40. Built
  // bottom-up, that T merges before the Top head is selected, at 35>36.
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'first-paint-continuity', 'jump:relayout',
    'stage 3', { desktop: { '35>36,36>35': 26.72 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 2', { desktop: { '35>34': 65.74 }, mobile: { '35>34': 35.63 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 3', { desktop: { '34>35': 65.74 }, mobile: { '34>35': 32.12 } },
    { by: 'Francis Ronge', on: '2026-10-21', note: 'plaque reach: far plaque-frames 5,514→3,862; +1.16 px stage-crossing jump accepted (approved 20 Oct, reconfirmed 21 Oct in the lead session)',
      accepts: { desktop: { '43>44': 65.74 }, mobile: { '43>44': 32.12 } } }),
  x(SPREAD_RETENTION, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'settled-path-independence', 'retention',
    'stage 3', { desktop: { '34>35': 30.03 }, mobile: { '34>35': 37.77 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/waiting-root-continuity.json#', 'first-paint-continuity', 'jump:relayout',
    'stage 3', { desktop: { '35>36,36>35': 26.72 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/waiting-root-continuity.json#', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 2', { desktop: { '35>34': 65.74 }, mobile: { '35>34': 35.63 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/waiting-root-continuity.json#', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 3', { desktop: { '34>35': 65.74 }, mobile: { '34>35': 32.12 } },
    { by: 'Francis Ronge', on: '2026-10-21', note: 'plaque reach: far plaque-frames 5,514→3,862; +1.16 px stage-crossing jump accepted (approved 20 Oct, reconfirmed 21 Oct in the lead session)',
      accepts: { desktop: { '43>44': 65.74 }, mobile: { '43>44': 32.12 } } }),
  x(SPREAD_RETENTION, 'replay-regressions/waiting-root-continuity.json#', 'settled-path-independence', 'retention',
    'stage 3', { desktop: { '34>35': 30.03 }, mobile: { '34>35': 37.77 } }),
  // Binding each hop to its new trace removes the saved analysis's off-canvas
  // unmoved pose at stage 10 on 711ef7d; the final subject raising now first
  // paints part of its landing beyond the canvas.
  x(MOVED_OFF_CANVAS, 'replay-regressions/successive-cyclic-source.json#/cases/0', 'first-paint-continuity', 'off-canvas:moved', 'stage 12',
    { desktop: { '99>100': 27.83 }, mobile: { '99>100': 56.45 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Structural movement on (fix/structural-movement-live): drawing the movements it recovers carries their slot and landing reservations back into earlier stages, so lifetime plaque pockets shift. Francis, 23 Oct in the lead session, told the change is invisible: \'If I won\'t even see them, then I won\'t waste time worrying about it, merge\': a held movement-slot clearance shifts stage 5 by 3.46 units, so the landing first paints 27.83 px beyond the canvas instead of 27.71.',
      accepts: { desktop: { '121>122': 27.83 }, mobile: { '121>122': 56.45 } } }),
  x(CONTINUED_RECENTRE, 'replay-regressions/renamed-continuing-nominal.json#', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 2', { desktop: { '13>14': 26.08 } },
    { by: 'Francis Ronge', on: '2026-10-21', note: 'there-insertion: D and Num re-centre over the wider rebuilt N (~26 px) instead of D separating; accepted for now until a layout reserves N\'s final width (approved 21 Oct in the lead session)',
      accepts: { desktop: { '18>19': 26.08 } } }),
  x(LOWERED_SUBTREE, 'movement/holdout-transitions.json#/3', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 2',
    { desktop: { '28>29': 74.06 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '39>40': 74.06 } } }),
  x(LOWERED_SUBTREE, 'movement/holdout-transitions.json#/3', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 1',
    { desktop: { '29>28': 64.82 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '40>39': 64.82 } } }),
  x(CROSSING_CENTRE, 'replay-regressions/successive-cyclic-source.json#/cases/0', 'settled-path-independence', 'retention', 'stage 12',
    { desktop: { '99>100': 9.61 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '121>122': 9.61 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/unproven-second-landing.json#', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 4',
    { desktop: { '19>20': 196.81 }, mobile: { '19>20': 71.74 } },
    { by: 'Francis Ronge', on: '2026-10-24', note: 'Camera fixes A+B accepted 22 Oct ("1-3 looks good"); after the fixture regained its stages before T-to-C (so T-to-C shows as movement) the same jump measures 196.81 (was 195.14), accepted on the side-by-side on 24 Oct in the lead session: "It looks good."',
      accepts: { desktop: { '25>26': 196.81 }, mobile: { '25>26': 71.74 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/unproven-second-landing.json#', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 3',
    { desktop: { '20>19': 164.13 }, mobile: { '20>19': 48.82 } },
    { by: 'Francis Ronge', on: '2026-10-24', note: 'Reverse of the stage 4 jump above; accepted with it on 24 Oct in the lead session: "It looks good."',
      accepts: { desktop: { '26>25': 164.13 }, mobile: { '26>25': 48.82 } } }),
  x(CROSSING_CENTRE, 'replay-regressions/unrecognized-movement.json#/cases/3', 'settled-path-independence', 'retention', 'stage 3',
    { desktop: { '25>26': 68.46 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '29>30': 68.46 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/unrecognized-movement.json#/cases/3', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 3',
    { desktop: { '25>26': 94.17 }, mobile: { '25>26': 63.01 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '29>30': 94.17 }, mobile: { '29>30': 63.01 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/unrecognized-movement.json#/cases/3', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 2',
    { desktop: { '26>25': 103.54 }, mobile: { '26>25': 52.73 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '30>29': 103.54 }, mobile: { '30>29': 52.73 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/workspace-arabic-continuity.json#/cases/0', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 2',
    { desktop: { '23>24': 27.53 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '29>30': 27.53 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/workspace-arabic-continuity.json#/cases/2', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 2',
    { desktop: { '23>24': 27.53 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '29>30': 27.53 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/workspace-arabic-continuity.json#/cases/4', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 2',
    { desktop: { '24>25': 103.35 }, mobile: { '24>25': 52.75 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '30>31': 103.35 }, mobile: { '30>31': 52.75 } } }),
  x(LOWERED_SUBTREE, 'replay-regressions/workspace-arabic-continuity.json#/cases/4', 'first-paint-continuity', 'jump:stage-coordinates', 'stage 1',
    { desktop: { '25>24': 88.63 }, mobile: { '25>24': 42.53 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { desktop: { '31>30': 88.63 }, mobile: { '31>30': 42.53 } } }),
  x(CROSSING_CENTRE, 'showcase/relatives-and-clitics.json#/cases/4', 'settled-path-independence', 'retention', 'stage 3',
    { mobile: { '30>31': 7.78 } },
    { by: 'Francis Ronge', on: '2026-10-22', note: 'Camera fixes A+B accepted on the side-by-side reviews ("fix A seems good. B looks good too"; on the three largest slides: "1-3 looks good"), 22 Oct in the lead session',
      accepts: { mobile: { '36>37': 7.78 } } }),
];
