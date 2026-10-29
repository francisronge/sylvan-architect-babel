/**
 * Plain descriptions of the Tier-2 families and slots Jev chooses between.
 *
 * Each family says what kind of claim it is and what Babel draws for it; each
 * slot says which participant fills it. They are written from what the recipe
 * in `replay/relations/tier2FacetRecipes.ts` checks and draws, so a description
 * must change with its recipe. Every family offered to Jev and every one of its
 * slots needs an entry (`tests/jev.test.mjs`).
 */
export const JEV_FAMILY_DESCRIPTIONS = {
  'gap.notation': {
    means: 'An authored gap or trace: a silent position that a displaced phrase left behind.',
    draws: 'A label on the gap.',
    slots: { gap: 'the silent gap or trace itself', index: 'the index the gap carries', label: 'the label written on the gap' }
  },
  'identity.occurrences': {
    means: 'Two or more occurrences that are the same syntactic object, such as the copies of one moved phrase.',
    draws: 'A shared index and a light on every occurrence.',
    slots: { occurrences: 'each occurrence of the one object', index: 'the index the occurrences share' }
  },
  'coreference.coindex': {
    means: 'Exactly two expressions that refer to the same thing or are coindexed, such as a relative operator and its head noun, or a pronoun and its antecedent, with no binding domain claimed.',
    draws: 'A shared index on both.',
    slots: { 'coreference.participants': 'each of the two coindexed expressions', index: 'the shared index' }
  },
  'control.dependency': {
    means: 'Control: a controller determines the reference of a silent subject (PRO) or controlled argument.',
    draws: 'A connector from controller to controllee, with an optional domain box and an index.',
    slots: { controller: 'the argument that controls', controllee: 'the controlled, usually silent, subject', domain: 'the clause in which control holds', index: 'the shared index' }
  },
  'binding.dependency': {
    means: 'Binding of an anaphor or pronoun by an antecedent in a binding domain (Binding Theory), or its failure.',
    draws: 'A variable-binding path from binder to bound element, inside an optional domain ellipse.',
    slots: { binder: 'the antecedent that binds', dependent: 'the anaphor, pronoun or bound element', domain: 'the binding domain', outcome: 'whether binding succeeds or fails', index: 'the shared index' }
  },
  'predication.dependency': {
    means: 'Predication: a predicate is said of a subject (predicand), as in small clauses or secondary predicates.',
    draws: 'A predication connector from predicate to predicand.',
    slots: { predicand: 'the subject the predicate is said of', predicate: 'the predicate phrase' }
  },
  'parasitic-gap.paths': {
    means: 'A parasitic gap construction drawn as two paths of nodes from one filler.',
    draws: 'Rings on the nodes of the primary and secondary paths.',
    slots: { 'primary.path': 'the nodes of the ordinary extraction path', 'secondary.path': 'the nodes of the parasitic path' }
  },
  'parasitic-gap.copy': {
    means: 'A parasitic gap: one filler licenses an ordinary gap and a parasitic gap.',
    draws: 'A fork from the filler to both gaps.',
    slots: { filler: 'the displaced phrase', 'ordinary.gap': 'the ordinary gap', 'parasitic.gap': 'the parasitic gap' }
  },
  'locality.boundary': {
    means: 'A locality boundary, such as an island or barrier, inside a domain.',
    draws: 'A cut across the boundary.',
    slots: { domain: 'the domain that contains the boundary', boundary: 'the node that is the barrier or island edge', outcome: 'whether crossing is blocked' }
  },
  'ellipsis.site': {
    means: 'An ellipsis site: material left unpronounced under identity.',
    draws: 'Ghosting over the elided material.',
    slots: { 'ellipsis.site': 'the elided constituent' }
  },
  'correspondence.alignment': {
    means: 'Elements of one structure correspond one to one with elements of another.',
    draws: 'Curves joining each source to its target, with an index.',
    slots: { 'correspondence.source': 'the elements on one side', 'correspondence.target': 'their counterparts on the other side', index: 'the index of each pair' }
  },
  'deletion.site': {
    means: 'Material deleted from the structure.',
    draws: 'A strike through it.',
    slots: { 'deleted.material': 'the deleted constituent' }
  },
  'constituent.occurrence': {
    means: 'One constituent picked out as a unit.',
    draws: 'An enclosure around it.',
    slots: { constituent: 'the constituent' }
  },
  'pair-merge': {
    means: 'Pair-merge or adjunction: a member is attached to a host without projecting.',
    draws: 'An overlay on the adjunction branch.',
    slots: { host: 'the phrase adjoined to', 'pair.member': 'the adjoined element' }
  },
  multidominance: {
    means: 'Multidominance: one node has two or more parents.',
    draws: 'A shared branch to each parent.',
    slots: { parents: 'each parent node', shared: 'the node they share' }
  },
  'argument-sharing': {
    means: 'One argument is shared by two or more predicates, as in serial verbs or across-the-board constructions.',
    draws: 'Crossed ovals around the predicate domains and a role label.',
    slots: { 'predicate.domains': 'each predicate or its domain', 'shared.argument': 'the shared argument', 'role.label': 'the theta role of the shared argument' }
  },
  'idiom.chunks': {
    means: 'Pieces that together form one idiom with a non-compositional meaning.',
    draws: 'Underlines on the chunks and an optional bracket over their domain.',
    slots: { chunks: 'each piece of the idiom', 'interpretation.domain': 'the domain in which the idiom is interpreted' }
  },
  'plaque.structured': {
    means: 'Rows of authored information shown on one node.',
    draws: 'A plaque with those rows.',
    slots: { 'plaque.anchor': 'the node the plaque sits on', 'plaque.rows': 'the rows the plaque shows' }
  },
  'feature-sharing': {
    means: 'Several nodes share one set of features, with no direction claimed.',
    draws: 'A feature vine joining them.',
    slots: { 'feature.bearers': 'each node that shares the features', 'feature.rows': 'the shared features or values', outcome: 'whether sharing succeeds' }
  },
  'agreement.cycle': {
    means: 'Cyclic agreement: a probe agrees in successive cycles with goals.',
    draws: 'A cycle badge.',
    slots: { probe: 'the probing head', goal: 'each goal it agrees with', cycle: 'which cycle', outcome: 'whether agreement succeeds' }
  },
  'feature.dependency': {
    means: 'A directed feature relation: Agree, agreement, concord or case assignment, in which one node values features or case on another.',
    draws: 'A connector from the source to each target, labelled with the features or case.',
    slots: { 'feature.source': 'the node that supplies or assigns the features or case (the controller, valuer or assigner)', 'feature.target': 'each node that receives them (the agreeing, valued or case-marked node)', 'feature.rows': 'the features valued, such as person, number, gender', 'case.literal': 'the case assigned, such as nominative', outcome: 'whether valuation succeeds' }
  },
  'dependent-case': {
    means: 'Dependent case: case assigned to one nominal because another nominal is in its domain.',
    draws: 'A dependent-case elbow.',
    slots: { probe: 'the nominal whose presence triggers the case', goal: 'the nominal that receives the dependent case', 'feature.rows': 'the dependent case', step: 'the step of the computation' }
  },
  accord: {
    means: 'Polarity accord only: a head agrees in polarity (positive or negative) with a goal. Not ordinary person, number or gender agreement.',
    draws: 'An accord connector and a boxed index.',
    slots: { 'feature.source': 'the polarity head', goal: 'the element that matches its polarity', 'feature.rows': 'the polarity value', index: 'the shared index' }
  },
  'phase.domain': {
    means: 'A phase (CP, vP) marked as a phase.',
    draws: 'An arc over the phase.',
    slots: { phase: 'the phase' }
  },
  'transfer.domain': {
    means: 'Transfer (Spell-Out) of a phase complement to the interfaces.',
    draws: 'Arcs over the transferred domain.',
    slots: { phase: 'the phase', 'phase.head': 'the phase head', 'phase.edge': 'the phase edge that stays accessible', 'transfer.domain': 'the complement that is transferred' }
  },
  'domain.annotation': {
    means: 'A domain given a named label.',
    draws: 'An overlay annotation on the domain.',
    slots: { domain: 'the domain', label: 'its label' }
  },
  'phase.edge': {
    means: 'The edge of a phase.',
    draws: 'An outline around the edge.',
    slots: { 'phase.edge': 'each edge position' }
  },
  'transfer.access': {
    means: 'An attempt to reach into a transferred domain, which fails (the Phase Impenetrability Condition).',
    draws: 'An access path that is blocked.',
    slots: { 'access.source': 'the probe trying to reach in', 'access.target': 'the element it cannot reach', 'transfer.domain': 'the transferred domain', outcome: 'that access fails' }
  },
  'judgment.verdict': {
    means: 'A grammaticality or acceptability verdict on a node.',
    draws: 'A verdict glyph and label.',
    slots: { 'analysis.anchor': 'the node judged', verdict: 'the verdict', label: 'its label' }
  },
  'judgment.blocked': {
    means: 'A node judged blocked or ill-formed.',
    draws: 'A blocking cross.',
    slots: { 'judged.anchor': 'the node judged', outcome: 'the negative outcome' }
  },
  'judgment.licensed': {
    means: 'A node judged licensed or well-formed.',
    draws: 'A check mark.',
    slots: { 'judged.anchor': 'the node judged', outcome: 'the positive outcome' }
  },
  intervention: {
    means: 'Intervention: an intervener blocks a relation between a target and its landing (minimality).',
    draws: 'A path from target to landing interrupted by the intervener.',
    slots: { 'intervention.target': 'the element that would move or be probed', 'intervention.landing': 'where it would go or the probe', intervener: 'the element in between that blocks it', outcome: 'that the relation is blocked' }
  },
  'blocked-extraction': {
    means: 'Extraction out of an adjunct that is blocked (adjunct island).',
    draws: 'A blocked curve out of the adjunct.',
    slots: { 'extraction.source': 'the position extracted from', 'extraction.target': 'where extraction would land', 'adjunct.domain': 'the adjunct island', outcome: 'that extraction is blocked' }
  },
  'focus.prominence': {
    means: 'Focus against background inside one domain, as sisters.',
    draws: 'Prominence marks on the focus and background branches.',
    slots: { focus: 'the focused constituent', background: 'its backgrounded sister', domain: 'the domain containing both' }
  },
  'focus.projection': {
    means: 'Focus projection: focus spreads from an accented word up a chain of nodes.',
    draws: 'Hops up the projection and accent and feature annotations.',
    slots: { 'accent.bearer': 'the accented word', 'projection.nodes': 'each node focus projects to', 'feature.label': 'the focus feature', 'accent.label': 'the accent' }
  },
  'focus.association': {
    means: 'A focus-sensitive particle (only, even, also) associated with its focus.',
    draws: 'Nested curves from particle to associate.',
    slots: { 'association.particle': 'the focus particle', 'association.associate': 'the focused associate' }
  },
  'strong-npi': {
    means: 'A strong negative polarity item (such as "in years", "lift a finger") licensed by an anti-additive licensor. Not pro-drop, mood, aspect or ellipsis licensing.',
    draws: 'Nested curves from licensor to the NPI and a feature note.',
    slots: { licensor: 'the negative or anti-additive licensor', licensee: 'the strong NPI', 'feature.label': 'the polarity feature' }
  },
  'polarity.licensing': {
    means: 'A polarity item (an NPI or PPI such as "any", "ever") licensed by a licensor such as negation or a question. Not pro-drop, mood, aspect or ellipsis licensing.',
    draws: 'Nested curves from licensor to the polarity item.',
    slots: { licensor: 'the negation or other licensor', 'polarity.item': 'the polarity item', outcome: 'whether it is licensed' }
  },
  'storage.ledger': {
    means: 'Cooper storage of quantifiers, with what is stored and retrieved.',
    draws: 'A ledger frame on the scope node.',
    slots: { scope: 'the node where storage is shown', 'storage.category': 'the category', 'storage.qstore': 'the stored quantifiers', 'storage.retrieved': 'the retrieved quantifiers' }
  },
  'operator-binding': {
    means: 'An operator (a wh-operator, relative operator or quantifier) binds a variable: its own trace, gap, resumptive or in-situ phrase inside its scope. The variable is a position inside the clause, never a head noun or antecedent outside it.',
    draws: 'A variable-binding path from operator to variable, with optional scope hulls.',
    slots: { operator: 'the operator that binds', variable: 'the variable it binds: its trace, gap, resumptive or in-situ phrase', 'scope.domain': 'the domain over which it takes scope, containing the variable', index: 'the shared index' }
  },
  'theta-grid': {
    means: 'Theta-role assignment: a predicate assigns theta roles (Agent, Theme, Goal, Experiencer) to its arguments.',
    draws: 'A role grid on the predicate with each argument and its role.',
    slots: { predicate: 'the predicate that assigns the roles', 'theta.arguments': 'each argument that receives a role', 'role.label': 'the theta role name for each argument' }
  },
  'pf.structured': {
    means: 'Rows of PF (morphophonological) information on output nodes.',
    draws: 'A PF plate with rows.',
    slots: { 'rewrite.output': 'each output node', 'pf.rows': 'the PF rows' }
  },
  'pf.rewrite': {
    means: 'A PF rewrite of one terminal into another form.',
    draws: 'A rewrite arrow from input to output.',
    slots: { 'rewrite.input': 'the input terminal', 'rewrite.output': 'the rewritten output', 'rewrite.rows': 'the rewrite rule rows' }
  },
  'pf.correspondence': {
    means: 'Which morphosyntactic sources a terminal\'s exponents realize (Vocabulary Insertion).',
    draws: 'A correspondence map on the terminal.',
    slots: { terminal: 'the terminal', 'pf.sources': 'the features or morphemes realized', 'pf.exponents': 'the exponents inserted' }
  },
  'pf.fission': {
    means: 'Fission: one terminal splits into two exponents.',
    draws: 'A bundle shell around the outputs.',
    slots: { 'rewrite.input': 'the terminal that splits', 'rewrite.outputs': 'the two outputs', 'fission.input': 'the input features', 'fission.output': 'the features of each output' }
  },
  'pf.impoverishment': {
    means: 'Impoverishment: features deleted from a terminal before insertion.',
    draws: 'A delinking mark on the terminal.',
    slots: { terminal: 'the terminal', 'feature.hierarchy': 'the feature hierarchy', 'delink.position': 'the feature delinked' }
  },
  'pf.local-dislocation': {
    means: 'Local dislocation: adjacent pieces rebracket at PF.',
    draws: 'Lanes showing each state of the sequence.',
    slots: { sequence: 'each element of the sequence' }
  },
  'pf.linearization': {
    means: 'Linear order computed at PF for nodes of the tree.',
    draws: 'A column comparing orders.',
    slots: { order: 'each ordered element' }
  }
};
