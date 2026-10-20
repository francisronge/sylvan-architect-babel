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

const NEXT_PINNED = 'Open (camera, low severity): reached by Next inside the completed stage, the retained pose keeps the wide '
  + 'final tree against the header edge, leaving just over a third of the view empty below; a direct selection fits it.';

const x = (reason, record, rule, subtype, subject, at, approval) => ({ reason, record, rule, subtype, subject, at, ...(approval && { approval }) });

export const EXCEPTIONS = [
  x(MOVED_OFF_CANVAS, 'movement/clause-context.json#/cases/2', 'first-paint-continuity', 'off-canvas:moved', 'stage 2',
    { mobile: { '54>55': 68.72 } }),
  x(MOVED_OFF_CANVAS, 'movement/clause-context.json#/cases/3', 'first-paint-continuity', 'off-canvas:moved', 'stage 2',
    { mobile: { '50>51': 53.04 } }),
  x(MOVED_OFF_CANVAS, 'movement/clause-context.json#/cases/7', 'first-paint-continuity', 'off-canvas:moved', 'stage 2',
    { mobile: { '26>27': 76.59 } }),
  x(MOVED_OFF_CANVAS, 'movement/holdout-transitions.json#/0', 'first-paint-continuity', 'off-canvas:moved', 'stage 2',
    { mobile: { '33>34': 31.98 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/clitic-displacement.json#/fixtures/1/analysis', 'first-paint-continuity', 'off-canvas:moved', 'stage 4',
    { mobile: { '25>26': 83.23 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/diverse-recovery.json#/examples/3/analysis', 'first-paint-continuity', 'off-canvas:moved', 'stage 6',
    { mobile: { '58>59': 38.7 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/nested-premovement-width.json#', 'first-paint-continuity', 'off-canvas:moved', 'stage 4',
    { mobile: { '59>60': 28.17 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/relative-clause-waiting-clearance.json#', 'first-paint-continuity', 'off-canvas:moved', 'stage 5',
    { mobile: { '61>62': 147.98 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/reviewed-construction.json#/cases/0', 'first-paint-continuity', 'off-canvas:moved', 'stage 12',
    { mobile: { '50>51': 57.45 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/sol-spanish-qr.json#/analyses/1', 'first-paint-continuity', 'off-canvas:moved', 'stage 3',
    { mobile: { '32>33': 27.4 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/workspace-component-lifetime.json#/cases/2', 'first-paint-continuity', 'off-canvas:moved', 'stage 5',
    { mobile: { '61>62': 147.98 } }),
  x(MOVED_OFF_CANVAS, 'replay-regressions/workspace-reservation.json#/cases/0', 'first-paint-continuity', 'off-canvas:moved', 'stage 8',
    { mobile: { '48>49': 28.03 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/dissolved-constituent-rebuild.json#', 'first-paint-continuity', 'jump:relayout', 'stage 5',
    { desktop: { '33>34,34>33': 71.88 }, mobile: { '33>34,34>33': 34.7 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/diverse-recovery.json#/examples/0/analysis', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '38>39,39>38': 33.2 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/diverse-recovery.json#/examples/6/analysis', 'first-paint-continuity', 'jump:relayout', 'stage 3',
    { desktop: { '45>46,46>45': 32.44 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/reviewed-construction.json#/cases/1', 'first-paint-continuity', 'jump:relayout', 'stage 3',
    { desktop: { '37>38,38>37': 30.82 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/workspace-arabic-continuity.json#/cases/6', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '42>43,43>42': 27.73 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/workspace-arabic-continuity.json#/cases/8', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '42>43,43>42': 27.73 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/workspace-arabic-continuity.json#/cases/9', 'first-paint-continuity', 'jump:relayout', 'stage 2',
    { desktop: { '43>44,44>43': 37.56 } }),
  x(STAGE_RELAYOUT, 'movement/clause-context.json#/cases/3', 'first-paint-continuity', 'jump:camera', 'stage 1',
    { desktop: { '51>50': 72.03 }, mobile: { '51>50': 29.47 } }),
  x(STAGE_RELAYOUT, 'movement/clause-context.json#/cases/3', 'first-paint-continuity', 'jump:camera', 'stage 2',
    { desktop: { '50>51': 63.58 }, mobile: { '50>51': 34.18 } }),
  x(STAGE_RELAYOUT, 'movement/holdout-transitions.json#/0', 'first-paint-continuity', 'jump:camera', 'stage 1',
    { desktop: { '34>33': 38.71 } }),
  x(STAGE_RELAYOUT, 'movement/holdout-transitions.json#/0', 'first-paint-continuity', 'jump:camera', 'stage 2',
    { desktop: { '33>34': 38.71 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/compact-current-root.json#/cases/0', 'first-paint-continuity', 'off-canvas:unmoved', 'stage 3',
    { mobile: { '22>23': 56.53 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/diverse-recovery.json#/examples/3/analysis', 'first-paint-continuity', 'jump:camera', 'stage 5',
    { desktop: { '59>58': 77.96 }, mobile: { '59>58': 28.52 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/diverse-recovery.json#/examples/3/analysis', 'first-paint-continuity', 'jump:camera', 'stage 6',
    { desktop: { '58>59': 68.81 }, mobile: { '58>59': 33.14 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/shared-landing-source.json#', 'first-paint-continuity', 'jump:camera', 'stage 1',
    { desktop: { '41>40': 30.4 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/shared-landing-source.json#', 'first-paint-continuity', 'jump:camera', 'stage 2',
    { desktop: { '40>41': 27.11 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/shared-landing-source.json#', 'first-paint-continuity', 'off-canvas:unmoved', 'stage 2',
    { mobile: { '40>41': 33.53 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/sol-spanish-qr.json#/analyses/1', 'first-paint-continuity', 'off-canvas:unmoved', 'stage 3',
    { mobile: { '32>33': 27.4 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/sol-spanish-qr.json#/analyses/1', 'first-paint-continuity', 'off-canvas:unmoved', 'stage 4',
    { mobile: { '35>36': 59.47 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/unproven-second-landing.json#', 'first-paint-continuity', 'off-canvas:unmoved', 'stage 2',
    { mobile: { '32>33': 38.86 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/workspace-source-continuity.json#/cases/0', 'first-paint-continuity', 'jump:camera', 'stage 5',
    { desktop: { '56>55': 46.18 }, mobile: { '56>55': 24.92 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/workspace-source-continuity.json#/cases/0', 'first-paint-continuity', 'jump:camera', 'stage 6',
    { desktop: { '55>56': 43.47 }, mobile: { '55>56': 24.7 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/workspace-spanish-continuity.json#', 'first-paint-continuity', 'jump:camera', 'stage 1',
    { desktop: { '9>8': 51.01 }, mobile: { '9>8': 29.98 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/workspace-spanish-continuity.json#', 'first-paint-continuity', 'jump:camera', 'stage 2',
    { desktop: { '8>9': 61.11 }, mobile: { '8>9': 37.53 } }),
  // Catalog #24's record (47-zh-relative.r1.B a6), also committed as the waiting-root fixture. Waiting slots
  // fixed catalog #19-#21 (16>17) and the off-canvas first paint into stage 3; its stage relayout remains.
  // The subject movement now brings T' at 43>44, so the clause rises a row while 我 and 昨天 stay; the
  // insertion of the T that 昨天 adjoins to is its own External Merge at 45>46, no longer the scope claim's 48>49.
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'first-paint-continuity', 'jump:relayout',
    'stage 3', { desktop: { '45>46,46>45': 26.72 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 2', { desktop: { '44>43': 65.74 }, mobile: { '44>43': 35.63 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 3', { desktop: { '43>44': 65.74 }, mobile: { '43>44': 32.12 } },
    { by: 'Francis Ronge', on: '2026-10-20', expires: '2027-01-20', note: 'plaque reach: far plaque-frames 5,514→3,862; +1.16 px stage-crossing jump accepted' }),
  x(SPREAD_RETENTION, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'settled-path-independence', 'retention',
    'stage 3', { desktop: { '43>44': 30.03 }, mobile: { '43>44': 37.77 } }),
  x(RELAYOUT_WITHIN_STAGE, 'replay-regressions/waiting-root-continuity.json#', 'first-paint-continuity', 'jump:relayout',
    'stage 3', { desktop: { '45>46,46>45': 26.72 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/waiting-root-continuity.json#', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 2', { desktop: { '44>43': 65.74 }, mobile: { '44>43': 35.63 } }),
  x(STAGE_RELAYOUT, 'replay-regressions/waiting-root-continuity.json#', 'first-paint-continuity', 'jump:stage-coordinates',
    'stage 3', { desktop: { '43>44': 65.74 }, mobile: { '43>44': 32.12 } },
    { by: 'Francis Ronge', on: '2026-10-20', expires: '2027-01-20', note: 'plaque reach: far plaque-frames 5,514→3,862; +1.16 px stage-crossing jump accepted' }),
  x(SPREAD_RETENTION, 'replay-regressions/waiting-root-continuity.json#', 'settled-path-independence', 'retention',
    'stage 3', { desktop: { '43>44': 30.03 }, mobile: { '43>44': 37.77 } }),
  x(NEXT_PINNED, 'performance/turkish-embedded.json#', 'content-placement', 'pinned', 'stage 5', { desktop: { '89': 0.34 } }),
  // Binding each hop to its new trace removes the saved analysis's off-canvas
  // unmoved pose at stage 10 on 711ef7d; the final subject raising now first
  // paints part of its landing beyond the canvas.
  x(MOVED_OFF_CANVAS, 'replay-regressions/successive-cyclic-source.json#/cases/0', 'first-paint-continuity', 'off-canvas:moved', 'stage 12',
    { desktop: { '121>122': 27.71 }, mobile: { '121>122': 56.45 } }),
];
