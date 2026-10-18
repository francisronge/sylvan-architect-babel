/** Static frame geometry faults that remain in the committed fixtures on main,
 * with the reason each one stays. tests/visualInvariants.test.mjs fails on a
 * violation that is not listed and on a listed one that no longer occurs, so
 * this list shrinks as fixes land. An entry is [reason, fixture analysis id,
 * rule, subjects]; subjects are the stable keys tests/helpers/visualInvariants.mjs
 * reports (node ids, or a mark's relation, text and anchor). Entries were
 * attributed by auditing the fixtures with each open PR's diff applied to main:
 * every subject listed under a PR disappears with that PR and with no other. */

export const PR73 = 'PR #73 (fix/renderer-label-wrap-brackets): a label with no space or comma left to break at wraps at the '
  + 'overflowing grapheme, leaving a closing mark alone on its last line.';
export const PR74 = 'PR #74 (fix/renderer-plaque-near-anchor): a free-standing plaque keeps one pocket for its whole lifetime '
  + 'while its anchor moves, so it ends far from the anchor.';
export const PR75 = 'PR #75 (fix/renderer-single-index-letter): co-visible marks that share a chain letter (operator-variable '
  + 'binding, quantifier raising, identity coindexing) each paint it at the same occurrence.';
export const PR76 = 'PR #76 (fix/renderer-zoom-stable-relation-clearance): a neutral fan spoke is cut exactly at a visible plaque, '
  + 'so its round cap touches the plaque outline at some Fit sizes.';
export const HANGING_WORD = 'Open (catalog #9; a fix is in progress on fix/layout-terminal-stem-clearance): a higher specifier\'s '
  + 'word hangs into the branch of the specifier below it.';
export const PLAQUE_CROWDED = 'Open (catalog #3): no nearby pocket stays clear for the plaque\'s lifetime, so the allocator takes '
  + 'the nearest clear pocket beyond its nearby candidates.';
export const LANE = 'Open: a neutral counter-lane connector runs its lane through tree text. Only its stems are clipped around '
  + 'labels, and the lane sits just below the participants, above deeper unrelated syntax.';
export const ROLE_CROWDED = 'Open: every preferred spot beside the witness label is taken, so the role placer steps outward until '
  + 'free and the label lands beside other syntax.';
export const MOBILE_ROLE = 'Open, mobile Fit only: neutral role labels keep a readable size at a 390-pixel Fit, which makes them '
  + 'wide in tree units; crowded or clamped into the viewport, they land far from their witnesses.';

export const KNOWN_VISUAL_DEFECTS = [
  [PR73, 'replay-regressions/diverse-recovery.json#/examples/0/analysis', 'label-typography', ['aCe:category ["D⁰[demonstrative","]"]']],
  [PR73, 'replay-regressions/receiving-slot-width-control.json#', 'label-typography', [
    'arrivalHigher:category ["V[unaccusative,","personal-infinitive","]"]',
    'arrivalLower:category ["V[unaccusative,","personal-infinitive","]"]']],
  [PR73, 'replay-regressions/scaffold-parent-visibility.json#', 'label-typography', [
    'av0:category ["v [active, ","agent-introducing","]"]',
    'av1:category ["v [active, ","agent-introducing","]"]']],
  [PR73, 'replay-regressions/visual-human-catalog.json#/cases/0/analyses/0', 'label-typography', [
    'b-coordination:category ["Coord[alternative","]"]',
    'b-coordinator-complement:category ["Coord[alternative","]"]',
    'b-or:category ["Coord[alternative","]"]']],
  [PR73, 'replay-regressions/workspace-reservation.json#/cases/0', 'label-typography', ['restricted-books:category ["D ","[relative-adjoined","]"]']],
  [PR73, 'replay-regressions/workspace-reservation.json#/cases/1', 'label-typography', ['restricted-books:category ["D ","[relative-adjoined","]"]']],
  [PR74, 'replay-regressions/native-plaque-footprints.json#', 'mark-distance', [
    'plaque(0:2 subjectHead: proper name; nominative singular)@m',
    'plaque(3:2 case: nominative)@mNP']],
  [PR74, 'replay-regressions/ordinary-receiving-width-control.json#', 'mark-distance', ['plaque(2:2 case: nominative)@p_pro']],
  [PR74, 'replay-regressions/visual-human-catalog.json#/cases/1/analyses/0', 'mark-distance', [
    'plaque(1:0 tense: past)@i',
    'plaque(1:3 case: nominative)@subject']],
  [PR74, 'replay-regressions/visual-human-catalog.json#/cases/2/analyses/0', 'mark-distance', ['plaque(3:2 case: Nominative)@mSubject']],
  [PR74, 'replay-regressions/workspace-reservation.json#/cases/1', 'mark-distance', ['plaque(6:0 case: nominative)@matrix-pro']],
  [PR75, 'replay-regressions/independent-clause-and-realization.json#', 'duplicate-glyph', ['operatorHigh i', 'operatorTrace i']],
  [PR75, 'replay-regressions/review-workspace-boundaries.json#/cases/2', 'duplicate-glyph', ['rObjectTrace i', 'rOperator i']],
  [PR75, 'replay-regressions/visual-human-catalog.json#/cases/5/analyses/0', 'duplicate-glyph', ['obj i', 'objhigh i', 'subj j', 'subjhigh j']],
  [PR75, 'replay-regressions/visual-human-catalog.json#/cases/5/analyses/1', 'duplicate-glyph', ['obj j', 'objhigh j', 'subj i', 'subjhigh i']],
  [PR75, 'replay-regressions/workspace-historical-continuity.json#/cases/1', 'duplicate-glyph', ['rObjectTrace i', 'rOperator i']],
  [PR75, 'replay-regressions/workspace-historical-continuity.json#/cases/3', 'duplicate-glyph', ['operatorHigh i', 'operatorTrace i']],
  [PR76, 'performance/german-embedded.json#', 'line-clearance', ['connector(0:4)reportNP→reportN plaque(0:1 directed-path case-assignment)@read']],
  [PR76, 'replay-regressions/native-plaque-footprints.json#', 'line-clearance', [
    'connector(4:3)iBase→mNP plaque(3:2 agreement: third-person singular)@iRaised',
    'connector(4:3)iBase→mTraceVP plaque(4:0 clauseType: matrix declarative)@cBase']],
  [PR76, 'replay-regressions/visual-human-catalog.json#/cases/4/analyses/0', 'line-clearance', [
    'connector(3:3)root-cp→subject-np plaque(3:2 clauseType: declarative)@declarative-c']],
  [PR76, 'visual-relations/shared-plaque.json#', 'line-clearance', [
    'connector(3:3)ipClause→npBook plaque(2:1 theta Agent)@vpOku',
    'connector(3:4)ipClause→npBook plaque(2:1 theta Agent)@vpOku']],
  [HANGING_WORD, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'line-clearance', ['juan->juan::__leaf what1::__leaf:word']],
  [PLAQUE_CROWDED, 'movement/clause-context.json#/cases/7', 'mark-distance', ['plaque(0:0 theta Agent/Theme)@ev']],
  [PLAQUE_CROWDED, 'movement/restated-chains.json#/0', 'mark-distance', [
    'plaque(1:3 theta Experiencer/Proposition)@vWant',
    'plaque(1:3/2:3 theta Experiencer/Proposition)@vWant',
    'plaque(1:3/2:3/3:3 theta Experiencer/Proposition)@vWant']],
  [PLAQUE_CROWDED, 'replay-regressions/case-source-transfer.json#', 'mark-distance', [
    'plaque(0:0 theta Experiencer/Theme)@v1',
    'plaque(2:0 theta Experiencer/Theme)@v3']],
  [PLAQUE_CROWDED, 'replay-regressions/clitic-displacement.json#/fixtures/1/analysis', 'mark-distance', ['plaque(0:0 theta Agent/Theme)@readV']],
  [PLAQUE_CROWDED, 'replay-regressions/compact-current-root.json#/cases/1', 'mark-distance', ['plaque(0:0 theta Agent/Theme)@v']],
  [PLAQUE_CROWDED, 'replay-regressions/diverse-recovery.json#/examples/2/analysis', 'mark-distance', ['plaque(1:1 theta agent)@littleV']],
  [PLAQUE_CROWDED, 'replay-regressions/diverse-recovery.json#/examples/6/analysis', 'mark-distance', ['plaque(0:4 tense: past)@v0']],
  [PLAQUE_CROWDED, 'replay-regressions/diverse-recovery.json#/examples/7/analysis', 'mark-distance', [
    'plaque(0:0 theta Theme)@verbBase',
    'plaque(1:1 finiteness: finite)@tense',
    'plaque(2:1 tense: past)@verbAtT']],
  [PLAQUE_CROWDED, 'replay-regressions/head-movement-ordinary-wrapper.json#', 'mark-distance', [
    'plaque(0:0 theta external participant in living)@i_v']],
  [PLAQUE_CROWDED, 'replay-regressions/inserted-adjunction-segment.json#', 'mark-distance', [
    'plaque(0:3 agreement: first-person singular; tense: past)@ri',
    'plaque(1:7 agreement: third-person masculine singular; tens)@mi']],
  [PLAQUE_CROWDED, 'replay-regressions/native-plaque-footprints.json#', 'mark-distance', ['plaque(1:0 theta Theme)@v', 'plaque(1:2 theta Agent)@v']],
  [PLAQUE_CROWDED, 'replay-regressions/ordinary-receiving-width-control.json#', 'mark-distance', ['plaque(0:0/0:1/1:2 theta theme)@p_v']],
  [PLAQUE_CROWDED, 'replay-regressions/receiving-slot-width-control.json#', 'mark-distance', [
    'plaque(3:1 clauseType: declarative personal infinitive)@infinitivalC']],
  [PLAQUE_CROWDED, 'replay-regressions/review-workspace-boundaries.json#/cases/0', 'mark-distance', [
    'plaque(3:1 agreement: third person singular; case: nominati)@rT']],
  [PLAQUE_CROWDED, 'replay-regressions/reviewed-construction.json#/cases/2', 'mark-distance', ['plaque(0:1 theta theme)@vRestored']],
  [PLAQUE_CROWDED, 'replay-regressions/shared-landing-source.json#', 'mark-distance', [
    'plaque(0:0 theta Agent/Theme)@buyV',
    'plaque(0:3 theta Agent/propositional Content)@sayV',
    'plaque(0:5 lexicalVerbForm: bare)@sayV',
    'plaque(0:6 tense: past)@buyV']],
  [PLAQUE_CROWDED, 'replay-regressions/sol-spanish-qr.json#/analyses/0', 'mark-distance', ['plaque(0:0 theta Agent/Theme)@v']],
  [PLAQUE_CROWDED, 'replay-regressions/sol-spanish-qr.json#/analyses/1', 'mark-distance', ['plaque(0:0 theta Agent/Theme)@v']],
  [PLAQUE_CROWDED, 'replay-regressions/visual-human-catalog.json#/cases/1/analyses/0', 'mark-distance', ['plaque(0:0 theta Experiencer/Theme)@v']],
  [PLAQUE_CROWDED, 'replay-regressions/visual-human-catalog.json#/cases/3/analyses/0', 'mark-distance', ['plaque(0:1 theta Theme)@stolen']],
  [PLAQUE_CROWDED, 'replay-regressions/visual-human-catalog.json#/cases/6/analyses/0', 'mark-distance', [
    'plaque(5:0 clauseType: direct constituent question)@question']],
  [PLAQUE_CROWDED, 'replay-regressions/workspace-arabic-continuity.json#/cases/9', 'mark-distance', ['plaque(0:2 theta Speaker)@rv']],
  [PLAQUE_CROWDED, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-distance', [
    'plaque(0:0 theta beneficiary or help-recipient)@helpV',
    'plaque(0:1 participialForm: default neuter singular, not ag)@helpV',
    'plaque(3:2 finiteFeatures: present, third-person singular)@matrixI']],
  [PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/1', 'mark-distance', [
    'plaque(1:0 theta Theme)@vRead',
    'plaque(1:0/2:0 theta Theme)@vRead',
    'plaque(1:0/2:0/3:0 theta Theme)@vRead',
    'plaque(1:1 theta Agent)@vRead',
    'plaque(2:4 theta Agent)@vRead',
    'plaque(2:4/3:4 theta Agent)@vRead']],
  [PLAQUE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/2', 'mark-distance', [
    'plaque(0:0 agreement: noun class 8; aspect: perfect; voice:)@v']],
  [PLAQUE_CROWDED, 'visual-relations/stable-complex-head-plaques.json#', 'mark-distance', [
    'plaque(1:3 theta Agent)@vComplex',
    'plaque(1:3/2:3 theta Agent)@vComplex',
    'plaque(1:3/2:3/3:3 theta Agent)@vComplex',
    'plaque(1:3/2:3/3:3/4:3 theta Agent)@vComplex',
    'plaque(2:0 resultingStem: 読ん)@vComplex',
    'plaque(3:0 resultingStem: 読ん)@vComplex',
    'plaque(4:0 resultingStem: 読ん)@vComplex']],
  [LANE, 'movement/source-occurrence-ownership.json#/0', 'line-clearance', ['connector(1:1)a1_tense→a1_nps a1_vbar0:category']],
  [LANE, 'replay-regressions/astra-turkish-relative-2.json#', 'line-clearance', [
    'connector(1:1)b_letters_n→b_op_spec b_ayse:category',
    'connector(1:1)b_letters_n→b_op_spec b_rel_ibar:category',
    'connector(1:2)b_letters_n→b_possessor b_ayse:category',
    'connector(1:2)b_letters_n→b_possessor b_rel_ibar:category',
    'connector(1:5)b_yesterday→b_read b_student_n:category']],
  [LANE, 'replay-regressions/construction-slot-continuity.json#/cases/0', 'line-clearance', ['connector(3:1)vRaised→iTense subjectD:category']],
  [LANE, 'replay-regressions/diverse-recovery.json#/examples/2/analysis', 'line-clearance', [
    'connector(3:2)raisedSubjectK→pastAuxiliary littleV:category']],
  [LANE, 'replay-regressions/diverse-recovery.json#/examples/3/analysis', 'line-clearance', [
    'connector(2:1)book→ropHigh rc:category',
    'connector(2:1)book→ropHigh rtp:category']],
  [LANE, 'replay-regressions/diverse-recovery.json#/examples/5/analysis', 'line-clearance', [
    'connector(3:1)t→s eg::__leaf:word',
    'connector(3:1)t→s gv::__leaf:word',
    'connector(3:1)t→s yh::__leaf:word']],
  [LANE, 'replay-regressions/shared-landing-source.json#', 'line-clearance', ['connector(2:1)whMatrix→edgeTrace sayV::__leaf:word']],
  [LANE, 'replay-regressions/sol-spanish-qr.json#/analyses/1', 'line-clearance', ['connector(1:1)i→vh sd:category']],
  [LANE, 'replay-regressions/workspace-arabic-continuity.json#/cases/9', 'line-clearance', ['connector(1:4)mpro→prnp n::__leaf:word']],
  [LANE, 'replay-regressions/workspace-reservation.json#/cases/0', 'line-clearance', [
    'connector(7:1)negative-copula→matrix-predication v-complement:category']],
  [ROLE_CROWDED, 'movement/displayed-endpoints.json#/1', 'mark-distance', ['role(1:1 associate)@mary', 'role(4:0 full Associate)@mary']],
  [ROLE_CROWDED, 'replay-regressions/adjunct-attachment-continuity.json#', 'mark-distance', ['role(3:0 realized Finite Head)@iB']],
  [ROLE_CROWDED, 'replay-regressions/complex-head-chain-restatement.json#', 'mark-distance', ['role(2:0 raised Inflection)@i2']],
  [ROLE_CROWDED, 'replay-regressions/workspace-source-continuity.json#/cases/0', 'mark-distance', ['role(7:0 contained Verb)@glaubeV']],
  [ROLE_CROWDED, 'visual-relations/stable-complex-head-plaques.json#', 'mark-distance', [
    'role(2:0 complex Head)@vComplex',
    'role(2:2 governor)@vComplex',
    'role(3:0 complex Head)@vComplex',
    'role(3:2 governor)@vComplex',
    'role(4:0 complex Head)@vComplex',
    'role(4:2 governor)@vComplex']],
  [MOBILE_ROLE, 'movement/clause-context.json#/cases/2', 'mark-distance', ['role(1:0 licensing Predicate)@matrixVerb']],
  [MOBILE_ROLE, 'movement/clause-context.json#/cases/3', 'mark-distance', ['role(1:1 licenser)@borrowLittleV']],
  [MOBILE_ROLE, 'movement/clause-context.json#/cases/6', 'mark-distance', ['role(1:1 predicate)@misquoted', 'role(1:1 variable Position)@reportDP0']],
  [MOBILE_ROLE, 'movement/clause-context.json#/cases/8', 'mark-distance', ['role(0:3 lexical Verb)@mv']],
  [MOBILE_ROLE, 'movement/displayed-endpoints.json#/0', 'mark-distance', ['role(3:0 lower Occurrence)@h_baca_lower']],
  [MOBILE_ROLE, 'movement/displayed-endpoints.json#/1', 'mark-distance', ['role(4:0 remnant Recipient)@recipient', 'role(4:0 source)@cliticLow']],
  [MOBILE_ROLE, 'movement/holdout-transitions.json#/3', 'mark-distance', ['role(1:0 operator)@existh']],
  [MOBILE_ROLE, 'movement/holdout-transitions.json#/4', 'mark-distance', ['role(1:0 operator)@existh']],
  [MOBILE_ROLE, 'movement/restated-chains.json#/1', 'mark-distance', [
    'role(3:3 participial Predicate)@vRead',
    'role(4:3 participial Predicate)@vRead']],
  [MOBILE_ROLE, 'movement/shared-landing.json#/analyses/0', 'mark-distance', [
    'role(1:2 case Licensers[1])@vN',
    'role(1:2 case Licensers[2])@vE',
    'role(1:2 selecting Verbs[1])@bought',
    'role(1:3 finite Licensers[2])@tenseE',
    'role(1:3 lower Occurrences[1])@noraLow',
    'role(1:3 lower Occurrences[2])@eliLow',
    'role(1:3 upper Occurrences[2])@eliHigh']],
  [MOBILE_ROLE, 'performance/german-embedded.json#', 'mark-distance', [
    'role(5:1 finite Head Position)@matrixCHead',
    'role(5:1 finite Verb)@believe']],
  [MOBILE_ROLE, 'replay-regressions/collection-pocket-continuity.json#', 'mark-distance', [
    'role(1:0 lower Trace)@tvm',
    'role(1:0 moved Verb)@vm',
    'role(1:1 lower Trace)@tvl',
    'role(1:1 moved Verb)@vl',
    'role(2:3 moved Subject)@sl',
    'role(2:4 accusative Objects[1])@om',
    'role(2:4 accusative Objects[2])@ol',
    'role(2:4 head Traces[2])@tvm',
    'role(2:4 head Traces[4])@tvl',
    'role(2:4 referential Subjects[2])@sl',
    'role(2:4 subject Traces[2])@tsl']],
  [MOBILE_ROLE, 'replay-regressions/compact-current-root.json#/cases/0', 'mark-distance', [
    'role(5:0 phase Head)@matrixLittleV',
    'role(5:1 lexical Predicate)@say',
    'role(6:0 landing)@didHigh',
    'role(6:0 resulting Head)@invertedC',
    'role(6:1 attractor)@questionC',
    'role(6:2 intermediate Occurrences[1])@whMatrixV',
    'role(6:2 intermediate Occurrences[2])@whEmbeddedC',
    'role(6:2 intermediate Occurrences[3])@whEmbeddedV',
    'role(6:2 selecting Predicate)@revised']],
  [MOBILE_ROLE, 'replay-regressions/complex-head-chain-restatement.json#', 'mark-distance', ['role(3:1 predicate)@v2']],
  [MOBILE_ROLE, 'replay-regressions/construction-slot-continuity.json#/cases/1', 'mark-distance', [
    'role(0:1 possessive Head)@l_nya',
    'role(0:1 relational Noun)@l_adik',
    'role(1:0 applicative Head)@l_kan_lower',
    'role(1:1 applicative Head)@l_kan_lower',
    'role(3:0 lower Occurrence)@l_kan_lower']],
  [MOBILE_ROLE, 'replay-regressions/coordination-and-ellipsis.json#', 'mark-distance', [
    'role(0:0 lower Occurrence)@bruno1',
    'role(1:0 ellipsis Remnants[1])@bruno2',
    'role(1:0 ellipsis Remnants[2])@coffee1',
    'role(1:1 surviving Remnants[1])@bruno2',
    'role(1:1 surviving Remnants[2])@coffee1']],
  [MOBILE_ROLE, 'replay-regressions/dissolved-constituent-rebuild.json#', 'mark-distance', ['role(5:1 force Head)@declarativeC']],
  [MOBILE_ROLE, 'replay-regressions/diverse-recovery.json#/examples/3/analysis', 'mark-distance', ['role(5:0 thematic Predicate)@return']],
  [MOBILE_ROLE, 'replay-regressions/diverse-recovery.json#/examples/7/analysis', 'mark-distance', [
    'role(5:1 pronounced Verb)@verbAtT',
    'role(5:1 subject Argument Trace)@subjectBase']],
  [MOBILE_ROLE, 'replay-regressions/inserted-adjunction-segment.json#', 'mark-distance', ['role(1:4 referential Antecedent)@hcore']],
  [MOBILE_ROLE, 'replay-regressions/native-plaque-footprints.json#', 'mark-distance', [
    'role(4:1 moved Finite Head)@iRaised',
    'role(4:3 case Licensing Head)@iBase',
    'role(4:4 finite Occurrences[1])@iRaised']],
  [MOBILE_ROLE, 'replay-regressions/nested-premovement-width.json#', 'mark-distance', ['role(3:1 finite Verb)@matrixVerbInI']],
  [MOBILE_ROLE, 'replay-regressions/obsolete-plaque-pockets.json#', 'mark-distance', [
    'role(2:0 moved Head)@clitic',
    'role(3:0 lower Occurrence)@clitictrace',
    'role(3:0 resumptive)@clitic']],
  [MOBILE_ROLE, 'replay-regressions/paired-retained-movement.json#', 'mark-distance', ['role(1:0 predicate[1])@p1']],
  [MOBILE_ROLE, 'replay-regressions/receiving-slot-width-control.json#', 'mark-distance', [
    'role(3:0 landing Domain)@embeddedSubjectT',
    'role(4:2 associated Proposition)@infinitivalClause',
    'role(6:0 licensing Head)@finiteT',
    'role(6:0 lower Occurrence)@expletiveLower']],
  [MOBILE_ROLE, 'replay-regressions/relative-clause-waiting-clearance.json#', 'mark-distance', [
    'role(2:2 governor)@relativeVerb',
    'role(2:2 verbal Chain Head)@relativeVerbRaised',
    'role(4:2 governor)@matrixVerb']],
  [MOBILE_ROLE, 'replay-regressions/retained-root-growth.json#', 'mark-distance', ['role(0:1 lower Complex)@mvHead', 'role(1:1 operator)@rOperator']],
  [MOBILE_ROLE, 'replay-regressions/review-final-framing.json#/cases/2', 'mark-distance', ['role(5:0 licensing Head)@topicHead']],
  [MOBILE_ROLE, 'replay-regressions/review-workspace-boundaries.json#/cases/0', 'mark-distance', [
    'role(1:0 introducer)@rv',
    'role(1:0 predicate)@rV',
    'role(3:2 licensing Head)@rT',
    'role(3:2 lower Trace)@anaBase',
    'role(4:0 higher Occurrence)@qTop',
    'role(4:0 licensing Head)@rC',
    'role(4:0 lower Occurrence)@qEdge',
    'role(4:1 operator)@qTop',
    'role(5:0 nominal Head)@bookN',
    'role(5:0 operator)@qTop',
    'role(5:0 relative Clause)@rCP',
    'role(6:0 light Verb)@mv',
    'role(8:2 licensing Head)@mT',
    'role(8:2 lower Trace)@bookBase',
    'role(8:3 force Head)@mC']],
  [MOBILE_ROLE, 'replay-regressions/review-workspace-boundaries.json#/cases/1', 'mark-distance', ['role(1:1 morphological Exponent)@oCase']],
  [MOBILE_ROLE, 'replay-regressions/review-workspace-boundaries.json#/cases/2', 'mark-distance', ['role(2:2 object Trace)@rObjectTrace']],
  [MOBILE_ROLE, 'replay-regressions/rewrite-stage-new-head.json#', 'mark-distance', [
    'role(0:0 predicate)@s1V',
    'role(0:2 accusative Licenser)@s1V',
    'role(0:3 accusative Licenser)@s2V',
    'role(0:4 selected Predicates[1])@s1VP',
    'role(0:4 selected Predicates[2])@s2VP']],
  [MOBILE_ROLE, 'replay-regressions/visual-human-catalog.json#/cases/0/analyses/0', 'mark-distance', ['role(2:1 introducer)@b-v-coffee-head']],
  [MOBILE_ROLE, 'replay-regressions/visual-human-catalog.json#/cases/2/analyses/0', 'mark-distance', ['role(4:0 moved Head)@mKnow']],
  [MOBILE_ROLE, 'replay-regressions/workspace-arabic-continuity.json#/cases/5', 'mark-distance', ['role(1:5 cCommandingSubject)@mpro']],
  [MOBILE_ROLE, 'replay-regressions/workspace-arabic-continuity.json#/cases/7', 'mark-distance', ['role(1:5 cCommandingSubject)@mpro']],
  [MOBILE_ROLE, 'replay-regressions/workspace-component-lifetime.json#/cases/1', 'mark-distance', [
    'role(9:0 raised Occurrence)@matrixTAtC',
    'role(9:0 source)@matrixTHeadComplex']],
  [MOBILE_ROLE, 'replay-regressions/workspace-component-lifetime.json#/cases/2', 'mark-distance', [
    'role(2:2 governor)@relativeVerb',
    'role(2:2 verbal Chain Head)@relativeVerbRaised',
    'role(4:2 governor)@matrixVerb']],
  [MOBILE_ROLE, 'replay-regressions/workspace-component-lifetime.json#/cases/3', 'mark-distance', [
    'role(5:0 lower Occurrence)@rdp',
    'role(5:1 higher Occurrence)@htH',
    'role(5:1 resulting Head)@hf']],
  [MOBILE_ROLE, 'replay-regressions/workspace-historical-continuity.json#/cases/1', 'mark-distance', ['role(2:2 object Trace)@rObjectTrace']],
  [MOBILE_ROLE, 'replay-regressions/workspace-historical-continuity.json#/cases/2', 'mark-distance', [
    'role(4:0 source Occurrence)@a_tlow',
    'role(4:3 controlled Subject)@a_pro']],
  [MOBILE_ROLE, 'replay-regressions/workspace-historical-continuity.json#/cases/3', 'mark-distance', [
    'role(3:0 raised Head)@buyRaised',
    'role(3:2 local Verbal Head)@buyHeadTrace',
    'role(3:2 raised Verbal Head)@buyRaised']],
  [MOBILE_ROLE, 'replay-regressions/workspace-historical-continuity.json#/cases/5', 'mark-distance', [
    'role(2:0 predicate)@admired',
    'role(5:0 phase Head)@mv',
    'role(6:1 higher Occurrence)@mira1',
    'role(6:1 licensing Head)@did0',
    'role(6:1 lower Occurrence)@mira0',
    'role(8:0 attracting Head)@cq',
    'role(8:0 lower Occurrence)@w3',
    'role(8:2 antecedent)@leila1']],
  [MOBILE_ROLE, 'replay-regressions/workspace-historical-continuity.json#/cases/6', 'mark-distance', [
    'role(2:0 predicate)@admired',
    'role(5:0 phase Head)@mv',
    'role(6:1 higher Occurrence)@mira1',
    'role(6:1 licensing Head)@did0',
    'role(6:1 lower Occurrence)@mira0',
    'role(8:0 attracting Head)@cq',
    'role(8:0 lower Occurrence)@w3',
    'role(8:1 restrictor Occurrence)@w2',
    'role(8:2 anaphor)@herself2',
    'role(8:2 antecedent)@mira1',
    'role(8:2 interpreted Nominal)@w2']],
  [MOBILE_ROLE, 'replay-regressions/workspace-historical-continuity.json#/cases/7', 'mark-distance', [
    'role(1:0 lower Trace)@tvm',
    'role(1:0 moved Verb)@vm',
    'role(1:1 lower Trace)@tvl',
    'role(1:1 moved Verb)@vl',
    'role(2:3 moved Subject)@sl',
    'role(2:4 accusative Objects[1])@om',
    'role(2:4 accusative Objects[2])@ol',
    'role(2:4 head Traces[2])@tvm',
    'role(2:4 head Traces[4])@tvl',
    'role(2:4 referential Subjects[2])@sl',
    'role(2:4 subject Traces[2])@tsl']],
  [MOBILE_ROLE, 'replay-regressions/workspace-reservation.json#/cases/1', 'mark-distance', [
    'role(4:0 clitic Exponent)@verb',
    'role(7:0 lower Trace)@matrix-pro-trace']],
  [MOBILE_ROLE, 'replay-regressions/workspace-reservation.json#/cases/2', 'mark-distance', ['role(4:2 theta Governor)@helpV']],
  [MOBILE_ROLE, 'replay-regressions/workspace-source-continuity.json#/cases/0', 'mark-distance', ['role(5:0 selecting Verb)@glaubeV']],
  [MOBILE_ROLE, 'replay-regressions/workspace-source-continuity.json#/cases/2', 'mark-distance', ['role(3:0 moved Head)@v']],
  [MOBILE_ROLE, 'replay-regressions/workspace-spanish-continuity.json#', 'mark-distance', [
    'role(2:3 embedded Tense)@b_embT',
    'role(4:2 attracting Head)@b_matrixT',
    'role(4:2 lower Occurrence)@b_proLow',
    'role(4:3 licensor)@b_matrixT']],
  [MOBILE_ROLE, 'visual-relations/stable-complex-head-plaques.json#', 'mark-distance', [
    'role(1:0 complex Head)@vComplex',
    'role(1:2 governor)@vComplex',
    'role(3:0 lexical Root)@vRoot',
    'role(3:0 nasal Exponent)@mOnbin',
    'role(4:0 lexical Root)@vRoot',
    'role(4:0 nasal Exponent)@mOnbin']],
  [MOBILE_ROLE, 'visual-relations/successive-head-movement.json#', 'mark-distance', [
    'role(1:0 lower Trace)@tvm',
    'role(1:0 moved Verb)@vm',
    'role(1:1 lower Trace)@tvl',
    'role(1:1 moved Verb)@vl',
    'role(2:3 moved Subject)@sl',
    'role(2:4 accusative Objects[1])@om',
    'role(2:4 accusative Objects[2])@ol',
    'role(2:4 head Traces[2])@tvm',
    'role(2:4 head Traces[4])@tvl',
    'role(2:4 referential Subjects[2])@sl',
    'role(2:4 subject Traces[2])@tsl']],
];
