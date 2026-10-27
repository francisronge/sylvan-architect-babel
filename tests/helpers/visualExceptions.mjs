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
const SOURCE_POCKET = 'Accepted with the held movement slot: the complete source keeps its sister clearance until its '
  + 'movement, so the plaque pocket beside its anchor, clear for the plaque\'s whole lifetime, lies just beyond its reach.';

const x = (reason, record, rule, subtype, subject, at, approval) => ({ reason, record, rule, subtype, subject, at, ...(approval && { approval }) });

export const EXCEPTIONS = [
  x(SPOKE_ATTACHED, 'performance/german-embedded.json#', 'line-clearance', 'connector-plaque',
    'connector(0:4)reportNP→reportN plaque(0:1 directed-path case-assignment)@read', { desktop: { '57': 1.44 } }),
  // The long-sentence preparation cases, as on their saved night4 analyses.
  x(PLAQUE_CROWDED, 'performance/french-relative.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta theme)@read', { desktop: { '19-22': 1.15 }, 'desktop-large': { '19-22': 1.15 } }),
  x(PLAQUE_CROWDED, 'performance/french-relative.json#', 'mark-distance', 'plaque',
    'plaque(0:1 theta agent)@embeddedVoice', { desktop: { '20-106': 1.13 }, 'desktop-large': { '20-106': 1.13 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Structural movement on (fix/structural-movement-live): drawing the movements it recovers carries their slot and landing reservations back into earlier stages, so lifetime plaque pockets shift. Francis, 23 Oct in the lead session, told the change is invisible: \'If I won\'t even see them, then I won\'t waste time worrying about it, merge\': the agent plaque sits at 1.13 of its reach instead of 1.12.',
      accepts: { desktop: { '20-106': 1.13 }, 'desktop-large': { '20-106': 1.13 } } }),
  x(PLAQUE_CROWDED, 'performance/french-relative.json#', 'mark-distance', 'plaque',
    'plaque(7:2 theta theme)@find', { desktop: { '96-98': 1.19, '102-106': 1.16 }, 'desktop-large': { '96-98': 1.19, '102-106': 1.16 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Accepted 20 Oct on the side-by-side review of '
      + 'T′ arriving at the subject movement (theme plaque up to 1.19 of its reach in frames 96-98 and 104-106). '
      + 'Structural movement on (fix/structural-movement-live): drawing the movements it recovers carries their slot and landing reservations back into earlier stages, so lifetime plaque pockets shift. Francis, 23 Oct in the lead session, told the change is invisible: \'If I won\'t even see them, then I won\'t waste time worrying about it, merge\': the movement now plays before C is built, so the accepted 1.16 state also covers frames 102-103.',
      accepts: { desktop: { '96-98': 1.19, '102-106': 1.16 }, 'desktop-large': { '96-98': 1.19, '102-106': 1.16 } } }),
  x(PLAQUE_CROWDED, 'movement/restated-chains.json#/0', 'mark-distance', 'plaque',
    'plaque(1:3 theta Experiencer/Proposition)@vWant', { desktop: { '31-34': 1.34 }, 'desktop-large': { '31-34': 1.34 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Clearing the painted control-dependency elbow (no plaque on its dashed runs) leaves this theta grid no nearer clear pocket: a neutral-link stem below to blocks the left and the elbow the rest, so it sits at 1.34 of its reach instead of 1.30. Francis accepted it on the side-by-side on 23 Oct in the lead session (\'Yes, this is probably fine.\' … \'I think it looks messier\' to have the plaque colliding).',
      accepts: { desktop: { '31-34': 1.34 }, 'desktop-large': { '31-34': 1.34 } } }),
  x(PLAQUE_CROWDED, 'movement/restated-chains.json#/0', 'mark-distance', 'plaque',
    'plaque(1:3/2:3 theta Experiencer/Proposition)@vWant', { desktop: { '35-55': 1.34 }, 'desktop-large': { '35-55': 1.34 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Clearing the painted control-dependency elbow (no plaque on its dashed runs) leaves this theta grid no nearer clear pocket: a neutral-link stem below to blocks the left and the elbow the rest, so it sits at 1.34 of its reach instead of 1.30. Francis accepted it on the side-by-side on 23 Oct in the lead session (\'Yes, this is probably fine.\' … \'I think it looks messier\' to have the plaque colliding).',
      accepts: { desktop: { '35-55': 1.34 }, 'desktop-large': { '35-55': 1.34 } } }),
  x(PLAQUE_CROWDED, 'movement/restated-chains.json#/0', 'mark-distance', 'plaque',
    'plaque(1:3/2:3/3:3 theta Experiencer/Proposition)@vWant', { desktop: { '56-69': 1.34 }, 'desktop-large': { '56-69': 1.34 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Clearing the painted control-dependency elbow (no plaque on its dashed runs) leaves this theta grid no nearer clear pocket: a neutral-link stem below to blocks the left and the elbow the rest, so it sits at 1.34 of its reach instead of 1.30. Francis accepted it on the side-by-side on 23 Oct in the lead session (\'Yes, this is probably fine.\' … \'I think it looks messier\' to have the plaque colliding).',
      accepts: { desktop: { '56-69': 1.34 }, 'desktop-large': { '56-69': 1.34 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/case-source-transfer.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta Experiencer/Theme)@v1', { desktop: { '15-18': 1.13 }, 'desktop-large': { '15-18': 1.13 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/compact-current-root.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(0:0 theta Agent/Theme)@v', { desktop: { '27-38': 1.19 }, 'desktop-large': { '27-38': 1.19 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/diverse-recovery.json#/examples/7/analysis', 'mark-distance', 'plaque',
    'plaque(0:0 theta Theme)@verbBase', { desktop: { '24-44': 1.35 }, 'desktop-large': { '24-44': 1.35 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/diverse-recovery.json#/examples/7/analysis', 'mark-distance', 'plaque',
    'plaque(2:1 tense: past)@verbAtT', { desktop: { '33-39': 1.18 }, 'desktop-large': { '33-39': 1.18 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/head-movement-ordinary-wrapper.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta external participant in living)@i_v', { desktop: { '28-36': 1.22 }, 'desktop-large': { '28-36': 1.22 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/inserted-adjunction-segment.json#', 'mark-distance', 'plaque',
    'plaque(1:7 agreement: third-person masculine singular; tens)@mi', { desktop: { '44-49': 1.54 }, 'desktop-large': { '44-49': 1.54 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Move first, then adjoin: the movement now plays before the phrase it lands in is merged into a larger one. Francis reviewed the click-through side-by-side of all seven changed fixtures on 23 Oct in the lead session (\'Looked at the replay page, looks good.\'): the relative clause\'s movements play before the matrix builds, so stage 3 is laid out differently and this plaque sits at 1.55 of its reach instead of 1.29.',
      accepts: { desktop: { '45-50': 1.55 }, 'desktop-large': { '45-50': 1.55 } } }),
  x(SOURCE_POCKET, 'replay-regressions/unnamed-movement-roles.json#/cases/0', 'mark-distance', 'plaque',
    'plaque(0:0 theta Addressee/Agent)@d_v', { desktop: { '17-36': 1.13 }, 'desktop-large': { '17-36': 1.13 } }),
  x(SOURCE_POCKET, 'replay-regressions/later-occupant-source-before-movement.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta Addressee/Agent)@d_v', { desktop: { '17-36': 1.13 }, 'desktop-large': { '17-36': 1.13 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/native-plaque-footprints.json#', 'mark-distance', 'plaque',
    'plaque(1:2 theta Agent)@v', { desktop: { '24-29': 1.19 }, 'desktop-large': { '24-29': 1.19 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/ordinary-receiving-width-control.json#', 'mark-distance', 'plaque',
    'plaque(0:0/0:1/1:2 theta theme)@p_v', { desktop: { '34-41': 1.14 }, 'desktop-large': { '34-41': 1.14 } },
    { by: 'Francis Ronge', on: '2026-10-23', note: 'Accepted 21 Oct on the plaque-gap side-by-side review '
      + '("The plaque changes are fine."): a plaque brought near keeps the full gap from movement arrows, so this theme grid '
      + 'has no nearer pocket and returns to its spot from before #150. Move first, then adjoin (reviewed 23 Oct: '
      + '"Looked at the replay page, looks good.") plays the raising two frames earlier, so the same state starts at frame 34.',
      accepts: { desktop: { '34-41': 1.14 }, 'desktop-large': { '34-41': 1.14 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/receiving-slot-width-control.json#', 'mark-distance', 'plaque',
    'plaque(3:1 clauseType: declarative personal infinitive)@infinitivalC', { desktop: { '33-48': 1.2 }, 'desktop-large': { '33-48': 1.2 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/relocated-plaque-anchor.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta Experiencer/Theme)@v', { desktop: { '21-24': 1.53 }, 'desktop-large': { '21-24': 1.53 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/review-workspace-boundaries.json#/cases/0', 'mark-distance', 'plaque',
    'plaque(3:1 agreement: third person singular; case: nominati)@rT', { desktop: { '34-58': 1.6 }, 'desktop-large': { '34-58': 1.6 } },
    { by: 'Francis Ronge', on: '2026-10-24', note: 'Plaque text breaks between words: this plaque loses a line and moves 20 units closer to its node, but its reach shrinks with its size, so the ratio goes 1.59 -> 1.60. Shown on the side-by-side page 24 Oct in the lead session; Francis: "2. ok."',
      accepts: { desktop: { '34-58': 1.6 }, 'desktop-large': { '34-58': 1.6 } } }),
  x(PLAQUE_CROWDED, 'replay-regressions/reviewed-construction.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(0:1 theta theme)@vRestored', { desktop: { '14-42': 1.12 }, 'desktop-large': { '14-42': 1.12 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/shared-landing-source.json#', 'mark-distance', 'plaque',
    'plaque(0:0 theta Agent/Theme)@buyV', { desktop: { '33-53': 1.22 }, 'desktop-large': { '33-53': 1.22 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/shared-landing-source.json#', 'mark-distance', 'plaque',
    'plaque(0:3 theta Agent/propositional Content)@sayV', { desktop: { '36-53': 1.67 }, 'desktop-large': { '36-53': 1.67 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/shared-landing-source.json#', 'mark-distance', 'plaque',
    'plaque(0:5 lexicalVerbForm: bare)@sayV', { desktop: { '38-53': 1.29 }, 'desktop-large': { '38-53': 1.29 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/shared-landing-source.json#', 'mark-distance', 'plaque',
    'plaque(0:6 tense: past)@buyV', { desktop: { '39-53': 1.15 }, 'desktop-large': { '39-53': 1.15 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/sol-spanish-qr.json#/analyses/0', 'mark-distance', 'plaque',
    'plaque(0:0 theta Agent/Theme)@v', { desktop: { '27-38': 1.19 }, 'desktop-large': { '27-38': 1.19 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/sol-spanish-qr.json#/analyses/1', 'mark-distance', 'plaque',
    'plaque(0:0 theta Agent/Theme)@v', { desktop: { '27-38': 1.19 }, 'desktop-large': { '27-38': 1.19 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/visual-human-catalog.json#/cases/1/analyses/0', 'mark-distance', 'plaque',
    'plaque(0:0 theta Experiencer/Theme)@v', { desktop: { '21-24': 1.53 }, 'desktop-large': { '21-24': 1.53 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-arabic-continuity.json#/cases/9', 'mark-distance', 'plaque',
    'plaque(0:2 theta Speaker)@rv', { desktop: { '36-50': 1.15 }, 'desktop-large': { '36-50': 1.15 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(0:0 theta beneficiary or help-recipient)@helpV', { desktop: { '20-45': 1.17 }, 'desktop-large': { '20-45': 1.17 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(0:1 participialForm: default neuter singular, not ag)@helpV', { desktop: { '21-45': 1.37 }, 'desktop-large': { '21-45': 1.37 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(3:2 finiteFeatures: present, third-person singular)@matrixI', { desktop: { '40-41': 1.33 }, 'desktop-large': { '40-41': 1.33 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0 theta Theme)@vRead', { desktop: { '27-30': 1.16 }, 'desktop-large': { '27-30': 1.16 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0/2:0 theta Theme)@vRead', { desktop: { '31-42': 1.16 }, 'desktop-large': { '31-42': 1.16 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0/2:0/3:0 theta Theme)@vRead', { desktop: { '43-57': 1.16 }, 'desktop-large': { '43-57': 1.16 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:1 theta Agent)@vRead', { desktop: { '28-57': 1.27 }, 'desktop-large': { '28-57': 1.27 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(2:4 theta Agent)@vRead', { desktop: { '38-42': 1.39 }, 'desktop-large': { '38-42': 1.39 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(2:4/3:4 theta Agent)@vRead', { desktop: { '43-57': 1.39 }, 'desktop-large': { '43-57': 1.39 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/2', 'mark-distance', 'plaque',
    'plaque(1:1 theta Agent)@v', { desktop: { '38-44': 1.27, '45-48': 1.28 }, 'desktop-large': { '38-44': 1.27, '45-48': 1.28 } }),
  x(PLAQUE_CROWDED, 'visual-relations/stable-complex-head-plaques.json#', 'mark-distance', 'plaque',
    'plaque(2:0 resultingStem: 読ん)@vComplex', { desktop: { '34-61': 1.32 }, 'desktop-large': { '34-61': 1.32 } }),
  x(PLAQUE_CROWDED, 'visual-relations/stable-complex-head-plaques.json#', 'mark-distance', 'plaque',
    'plaque(3:0 resultingStem: 読ん)@vComplex', { desktop: { '40-61': 1.35 }, 'desktop-large': { '40-61': 1.35 } }),
  x(PLAQUE_CROWDED, 'visual-relations/stable-complex-head-plaques.json#', 'mark-distance', 'plaque',
    'plaque(4:0 resultingStem: 読ん)@vComplex', { desktop: { '52-61': 1.43 }, 'desktop-large': { '52-61': 1.43 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'mark-distance', 'plaque',
    'plaque(0:1 theta experiencer)@relativeLightVerb', { desktop: { '14-43': 1.23 }, 'desktop-large': { '14-43': 1.23 } }),
  x(PLAQUE_CROWDED, 'replay-regressions/waiting-root-continuity.json#', 'mark-distance', 'plaque',
    'plaque(0:1 theta experiencer)@relativeLightVerb', { desktop: { '14-43': 1.23 }, 'desktop-large': { '14-43': 1.23 } }),
  // The same finding, with the same measure, occurs on origin/main for the saved
  // analysis this fixture case copies (night3 33-grc-article.r2); only its frame numbers moved.
  x(PLAQUE_CROWDED, 'replay-regressions/compound-movement-roles.json#/cases/1', 'mark-distance', 'plaque',
    'plaque(1:0 theta Theme)@V0', { desktop: { '26-38': 1.13 }, 'desktop-large': { '26-38': 1.13 } }),
];
