/** Static geometry faults that remain in the committed fixtures on main, each
 * with its reason, for `npm run verify:visual-offline` (the 1440×900 and
 * 2560×1440 Fit passes). Matching follows tests/helpers/findings.mjs: a new
 * finding fails, so does one beyond its bound, and so does every listed frame
 * where the fault no longer occurs. Each frame list carries the bound of the
 * rule's measure at those frames: missing clearance, depth or row deviation in
 * CSS pixels, or a mark's distance as a ratio of its reach. An entry a change adds or lets
 * grow also takes the owner's approval as its last argument
 * (scripts/checkExceptionGrowth.mjs). */

const SPOKE_ATTACHED = 'Accepted since #76: keeping the gap would cut off the spoke\'s labelled end, so attachment wins '
  + 'and the spoke meets the plaque\'s edge.';
const PLAQUE_CROWDED = 'Accepted (catalog #3; ROADMAP Explicitly Not Active, Francis on 23 and 24 Oct): no nearby pocket stays clear for the plaque\'s lifetime, so the allocator takes '
  + 'the nearest clear pocket beyond its nearby candidates. #74 and #84 relocate plaques whose anchor moves, not these.';

const STABLE_FARTHER_NOTE = '27 Oct, in chat: asked "Plaques that would jump take the farther stretch-clear pocket?", Francis answered "Yes"';
const WIDER_THETA_LABEL = 'Accepted trade-off (theta letters, 29 Oct): What is the Theme of bought and ends the embedded clause that say takes, so it correctly shows both grids\u2019 letters; the shared lifetime-contour layout amplifies that wider label into a different layout of this tree.';
const WIDER_THETA_NOTE = 'Asked \u201c\u03b8 fix: accept that one tree\u2019s slightly bigger jump (shared-landing-source: the correctly wider \u201cWhat\u201d label shifts syntax 196 units at frame 41 and moves the say grid\u2019s plaque), so it can merge?\u201d: \u201c1. YES IDC, IF IT\u2019S NOT SIGNIFICANT DON\u2019T ASK ME.\u201d (lead session, 29 Oct)';
const LANDING_ROOM = 'Accepted trade-off (#333, 31 Oct): keeping a movement\u2019s landing room during construction and a waiting verb beside its phrase lays this tree out differently, so these plaques stand farther from their words until the end of Replay.';
const LANDING_ROOM_NOTE = 'Asked \u201cShould #333 ship, accepting two small flaws? 1) In the Spanish sentence, one phrase re-centres by 307 units when the subject lands (limit 210). 2) In the English sentence, three small plaques sit a bit farther from their words than usual.\u201d after viewing the comparison page main b82e630 vs #333 ac7fe9f: \u201cyep it\'s fine\u201d (primary Claude Code session, 31 Oct)';
const LANDING_ROOM_APPROVAL = (note, at) => ({ by: 'Francis Ronge', on: '2026-10-31', note, accepts: at });
const x = (reason, record, rule, subtype, subject, at, approval) => ({ reason, record, rule, subtype, subject, at, ...(approval && { approval }) });

export const EXCEPTIONS = [
  x(SPOKE_ATTACHED, 'performance/german-embedded.json#', 'line-clearance', 'connector-plaque',
    'connector(0:4)reportNP→reportN plaque(0:1 directed-path case-assignment)@read', { desktop: { '45': 1.44 } }),
  // The long-sentence preparation cases, as on their saved night4 analyses.
  x(PLAQUE_CROWDED, 'performance/french-relative.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta theme)@read', { desktop: { '13-16': 1.15 }, 'desktop-large': { '13-16': 1.15 } }),
  x(PLAQUE_CROWDED, 'performance/french-relative.json#', 'mark-distance', 'plaque',
    'plaque(0:1 theta agent)@embeddedVoice', { desktop: { '14-87': 1.13 }, 'desktop-large': { '14-87': 1.13 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Structural movement on (fix/structural-movement-live): drawing the movements it recovers carries their slot and landing reservations back into earlier stages, so lifetime plaque pockets shift. Francis, 23 Oct in the lead session, told the change is invisible: \'If I won\'t even see them, then I won\'t waste time worrying about it, merge\': the agent plaque sits at 1.13 of its reach instead of 1.12.',
      accepts: { desktop: { '20-106': 1.13 }, 'desktop-large': { '20-106': 1.13 } } }),
  x(PLAQUE_CROWDED, 'performance/french-relative.json#', 'mark-distance', 'plaque',
    'plaque(7:2 theta theme)@find', { desktop: { '83-87': 1.16 }, 'desktop-large': { '83-87': 1.16 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Accepted 20 Oct on the side-by-side review of '
      + 'T′ arriving at the subject movement (theme plaque up to 1.19 of its reach in frames 96-98 and 104-106). '
      + 'Structural movement on (fix/structural-movement-live): drawing the movements it recovers carries their slot and landing reservations back into earlier stages, so lifetime plaque pockets shift. Francis, 23 Oct in the lead session, told the change is invisible: \'If I won\'t even see them, then I won\'t waste time worrying about it, merge\': the movement now plays before C is built, so the accepted 1.16 state also covers frames 102-103.',
      accepts: { desktop: { '96-98': 1.19, '102-106': 1.16 }, 'desktop-large': { '96-98': 1.19, '102-106': 1.16 } } }),
  x(PLAQUE_CROWDED, 'movement/restated-chains.json#/0', 'mark-distance', 'plaque',
    'plaque(1:3 theta Experiencer/Proposition)@vWant', { desktop: { '24-27': 1.34 }, 'desktop-large': { '24-27': 1.34 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Clearing the painted control-dependency elbow (no plaque on its dashed runs) leaves this theta grid no nearer clear pocket: a neutral-link stem below to blocks the left and the elbow the rest, so it sits at 1.34 of its reach instead of 1.30. Francis accepted it on the side-by-side on 23 Oct in the lead session (\'Yes, this is probably fine.\' … \'I think it looks messier\' to have the plaque colliding).',
      accepts: { desktop: { '31-34': 1.34 }, 'desktop-large': { '31-34': 1.34 } } }),
  x(PLAQUE_CROWDED, 'movement/restated-chains.json#/0', 'mark-distance', 'plaque',
    'plaque(1:3/2:3 theta Experiencer/Proposition)@vWant', { desktop: { '28-45': 1.34 }, 'desktop-large': { '28-45': 1.34 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Clearing the painted control-dependency elbow (no plaque on its dashed runs) leaves this theta grid no nearer clear pocket: a neutral-link stem below to blocks the left and the elbow the rest, so it sits at 1.34 of its reach instead of 1.30. Francis accepted it on the side-by-side on 23 Oct in the lead session (\'Yes, this is probably fine.\' … \'I think it looks messier\' to have the plaque colliding).',
      accepts: { desktop: { '35-55': 1.34 }, 'desktop-large': { '35-55': 1.34 } } }),
  x(PLAQUE_CROWDED, 'movement/restated-chains.json#/0', 'mark-distance', 'plaque',
    'plaque(1:3/2:3/3:3 theta Experiencer/Proposition)@vWant', { desktop: { '46-59': 1.34 }, 'desktop-large': { '46-59': 1.34 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Clearing the painted control-dependency elbow (no plaque on its dashed runs) leaves this theta grid no nearer clear pocket: a neutral-link stem below to blocks the left and the elbow the rest, so it sits at 1.34 of its reach instead of 1.30. Francis accepted it on the side-by-side on 23 Oct in the lead session (\'Yes, this is probably fine.\' … \'I think it looks messier\' to have the plaque colliding).',
      accepts: { desktop: { '56-69': 1.34 }, 'desktop-large': { '56-69': 1.34 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/case-source-transfer.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta Experiencer/Theme)@v1', { desktop: { '11-14': 1.13 }, 'desktop-large': { '11-14': 1.13 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/compact-current-root.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(0:0 theta Agent/Theme)@v', { desktop: { '31-33': 1.19 }, 'desktop-large': { '31-33': 1.19 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/head-movement-ordinary-wrapper.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta external participant in living)@i_v', { desktop: { '23-31': 1.22 }, 'desktop-large': { '23-31': 1.22 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/inserted-adjunction-segment.json#', 'mark-distance', 'plaque',
    'plaque(1:7 agreement: third-person masculine singular; tens)@mi', { desktop: { '38-43': 1.54 }, 'desktop-large': { '38-43': 1.54 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Move first, then adjoin: the movement now plays before the phrase it lands in is merged into a larger one. Francis reviewed the click-through side-by-side of all seven changed fixtures on 23 Oct in the lead session (\'Looked at the replay page, looks good.\'): the relative clause\'s movements play before the matrix builds, so stage 3 is laid out differently and this plaque sits at 1.55 of its reach instead of 1.29.',
      accepts: { desktop: { '45-50': 1.55 }, 'desktop-large': { '45-50': 1.55 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/native-plaque-footprints.json#', 'mark-distance', 'plaque',
    'plaque(1:2 theta Agent)@v', { desktop: { '20-25': 1.19, '26-31': 1.29 }, 'desktop-large': { '20-25': 1.19, '26-31': 1.29 } },
    { by: 'Francis Ronge', on: '2026-10-27', note: 'Frames 24-29 are main\'s entry, unchanged and listed for the reason given; '
      + 'this answer covers only frames 30-35, though an approval names the whole entry. Frames 30-35: ' + STABLE_FARTHER_NOTE
      + '. Its anchor moves where stage 3 begins at frame 30; main gives it a pocket there that syntax of stage 3 takes at frame 31, '
      + 'where main moves it beside its still anchor. It takes instead the nearest pocket that stays clear until its anchor moves '
      + 'at frame 36, and keeps it until then.',
      accepts: { desktop: { '24-29': 1.19, '30-35': 1.29 }, 'desktop-large': { '24-29': 1.19, '30-35': 1.29 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/ordinary-receiving-width-control.json#', 'mark-distance', 'plaque',
    'plaque(0:0/0:1/1:2 theta theme)@p_v', { desktop: { '28-36': 1.14 }, 'desktop-large': { '28-36': 1.14 } },
    { by: 'Francis Ronge', on: '2026-10-27', note: 'Accepted 21 Oct on the plaque-gap side-by-side review '
      + '("The plaque changes are fine."): a plaque brought near keeps the full gap from movement arrows, so this theme grid '
      + 'has no nearer pocket and returns to its spot from before #150. Move first, then adjoin (reviewed 23 Oct: '
      + '"Looked at the replay page, looks good.") plays the raising two frames earlier, so the same state starts at frame 34.'
      + ' Frame 33: ' + STABLE_FARTHER_NOTE + '. Stage 2 begins at frame 33 and paints syntax or a mark in the grid\'s earlier '
      + 'pocket at frame 34, where main moves it to this pocket; it now takes this pocket at frame 33 and keeps it through the stage.',
      accepts: { desktop: { '33-41': 1.14 }, 'desktop-large': { '33-41': 1.14 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/receiving-slot-width-control.json#', 'mark-distance', 'plaque',
    'plaque(3:1 clauseType: declarative personal infinitive)@infinitivalC', { desktop: { '27-42': 1.2 }, 'desktop-large': { '27-42': 1.2 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/reviewed-construction.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(0:1 theta theme)@vRestored', { desktop: { '10-13': 1.12 }, 'desktop-large': { '10-13': 1.12 } }),
  x(PLAQUE_CROWDED + ' ' + LANDING_ROOM, 'replay-regressions/shared-landing-source.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta Agent/Theme)@buyV', { desktop: { '26-33': 1.22, '34-46': 1.19 }, 'desktop-large': { '26-33': 1.22, '34-46': 1.19 } },
    LANDING_ROOM_APPROVAL('Frames 26-33 are main\'s entry, unchanged and listed for the reason given; this answer covers only frames 34-46, '
      + 'though an approval names the whole entry. ' + LANDING_ROOM_NOTE,
      { desktop: { '26-33': 1.22, '34-46': 1.19 }, 'desktop-large': { '26-33': 1.22, '34-46': 1.19 } })),
  x(PLAQUE_CROWDED + ' ' + WIDER_THETA_LABEL + ' ' + LANDING_ROOM, 'replay-regressions/shared-landing-source.json#', 'mark-distance', 'plaque',
    'plaque(0:3 theta Agent/propositional Content)@sayV', { desktop: { '29-46': 1.77 }, 'desktop-large': { '29-46': 1.77 } },
    LANDING_ROOM_APPROVAL('Accepted 29 Oct at 1.67 (frames 29-33) and 1.65 (frames 34-46): ' + WIDER_THETA_NOTE + '. Then at 1.77 (frames 29-46): '
      + LANDING_ROOM_NOTE, { desktop: { '29-46': 1.77 }, 'desktop-large': { '29-46': 1.77 } })),
  x(PLAQUE_CROWDED + ' ' + LANDING_ROOM, 'replay-regressions/shared-landing-source.json#', 'mark-distance', 'plaque',
    'plaque(0:6 tense: past)@buyV', { desktop: { '32-46': 1.22 }, 'desktop-large': { '32-46': 1.22 } },
    LANDING_ROOM_APPROVAL(LANDING_ROOM_NOTE, { desktop: { '32-46': 1.22 }, 'desktop-large': { '32-46': 1.22 } })),
  x(PLAQUE_CROWDED, 'replay-regressions/sol-spanish-qr.json#/analyses/0', 'mark-distance', 'plaque',
    'plaque(0:0 theta Agent/Theme)@v', { desktop: { '31-33': 1.19 }, 'desktop-large': { '31-33': 1.19 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(0:1 participialForm: default neuter singular, not ag)@helpV', { desktop: { '16-30': 1.37 }, 'desktop-large': { '16-30': 1.37 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(3:2 finiteFeatures: present, third-person singular)@matrixI', { desktop: { '34-35': 1.33 }, 'desktop-large': { '34-35': 1.33 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0 theta Theme)@vRead', { desktop: { '21-24': 1.16 }, 'desktop-large': { '21-24': 1.16 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0/2:0 theta Theme)@vRead', { desktop: { '25-35': 1.16 }, 'desktop-large': { '25-35': 1.16 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0/2:0/3:0 theta Theme)@vRead', { desktop: { '36-50': 1.16 }, 'desktop-large': { '36-50': 1.16 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:1 theta Agent)@vRead', { desktop: { '22-24': 1.27 }, 'desktop-large': { '22-24': 1.27 } }),
  // The same crowded Agent grid from frame 31, which now also carries the restatements 2:4 and 3:4
  // instead of painting them as two more identical grids (duplicate-plaque).
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:1/2:4 theta Agent)@vRead', { desktop: { '25-35': 1.21 }, 'desktop-large': { '25-35': 1.21 } },
    { by: 'Francis Ronge', on: '2026-10-30', note: 'Asked: "Approve the two renamed entries?" (the same crowded Agent plaque he already accepted, now nearer, 1.21 vs 1.27 of reach, renamed because two claims now share it); answered: "yeah yeah whatever yes, sure then" (lead session, 30 Oct)',
      accepts: { desktop: { '31-42': 1.21 }, 'desktop-large': { '31-42': 1.21 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:1/2:4/3:4 theta Agent)@vRead', { desktop: { '36-50': 1.21 }, 'desktop-large': { '36-50': 1.21 } },
    { by: 'Francis Ronge', on: '2026-10-30', note: 'Asked: "Approve the two renamed entries?" (the same crowded Agent plaque he already accepted, now nearer, 1.21 vs 1.27 of reach, renamed because two claims now share it); answered: "yeah yeah whatever yes, sure then" (lead session, 30 Oct)',
      accepts: { desktop: { '43-57': 1.21 }, 'desktop-large': { '43-57': 1.21 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(1:1 theta Agent)@v', { desktop: { '33-39': 1.27, '40-43': 1.28 }, 'desktop-large': { '33-39': 1.27, '40-43': 1.28 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'mark-distance', 'plaque',
    'plaque(0:1 theta experiencer)@relativeLightVerb', { desktop: { '11-34': 1.23 }, 'desktop-large': { '11-34': 1.23 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/waiting-root-continuity.json#', 'mark-distance', 'plaque',
    'plaque(0:1 theta experiencer)@relativeLightVerb', { desktop: { '11-34': 1.23 }, 'desktop-large': { '11-34': 1.23 } }),
  // The same finding, with the same measure, occurs on origin/main for the saved
  // analysis this fixture case copies (night3 33-grc-article.r2); only its frame numbers moved.
  x(PLAQUE_CROWDED, 'replay-regressions/compound-movement-roles.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0 theta Theme)@V0', { desktop: { '21-33': 1.13 }, 'desktop-large': { '21-33': 1.13 } }),
];
