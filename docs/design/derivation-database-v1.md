# Derivation Database V1

This note captures the safest current plan for turning Babel into a richer derivational syntax system without contaminating the Pro route or overwhelming the student-facing UI.

## Core Principle

Babel should record every syntactic claim the model explicitly commits to in typed data.

Babel should not silently invent richer theory after the fact.

The model commits. Babel records, validates, and renders.

## UI Principle

Do not try to infer whether the user is a student or a researcher.

Instead:

- Keep the default experience simple: `Canopy`, `Growth`, `Notes`
- Add progressive disclosure rather than a second product
- Let richer derivational data exist in the backend even when it is not surfaced prominently
- Use click-based inspection for advanced data, not hover-heavy overlays

The right design is:

- `Canopy`: clean structural view
- `Growth`: clean derivational replay
- `Notes`: clean prose explanation
- Optional advanced surfaces later:
  - node inspector
  - chain inspector
  - research trace panel
  - case / argument / phase ledgers

This preserves the simplicity of the current interface while allowing research richness underneath.

## Student vs Researcher

Babel should not guess.

The system should support two depths of use:

- `default surface`
  - always simple
  - always tree-first
  - suitable for students
- `advanced surface`
  - explicit opt-in
  - suitable for researchers

This is a UI choice, not a user-identity choice.

## What Babel Is Becoming

The important shift is:

- from a tree renderer with replay
- to a derivation database

That means a sentence is no longer just:

- tree
- movement
- spellout

It becomes a linked set of theoretical commitments:

- tree
- derivation steps
- chains
- feature valuation
- case assignment
- argument structure
- phase/spellout domains
- morphology realization
- research trace
- provenance

This is the beginning of a derivational syntax corpus.

## Mandatory Safety Rules

1. No Pro-route ad hoc enrichment.
2. Richer data must be additive, optional, and typed.
3. If the model does not commit, the field stays absent or sparse.
4. Internal validation is allowed, but student-facing tree display should not collapse into visible failure.
5. Research-trace data should be structured and auditable, not a raw scratchpad dump.

## Structured Research Trace

The research trace should be mandatory in principle, but structured rather than freeform.

It should not try to expose raw hidden chain-of-thought.

Instead it should capture the model's explicit decision journal:

- what decision point existed
- what observations were relevant
- what alternatives were considered
- what was selected
- what evidence supported the commitment
- what final nodes, steps, and chains that decision licensed

### Why This Is Better Than Raw Thinking Text

- more stable across runs
- easier to validate
- less provider-dependent
- safer to render to users
- closer to scientific annotation than to hidden scratchpad text

### Research Trace Shape

Each trace item should look conceptually like:

```json
{
  "decisionId": "d4",
  "stage": "movement",
  "decisionPoint": "dp_fronting_analysis",
  "observations": [
    "fronted XP at clause edge",
    "lower copy in VP domain",
    "feature bundle includes [wh]"
  ],
  "alternatives": [
    { "id": "wh_movement", "status": "selected" },
    { "id": "focus_movement", "status": "rejected", "reason": "no focus-specific commitment elsewhere" },
    { "id": "base_generation", "status": "rejected", "reason": "lower copy already present" }
  ],
  "commitment": "wh_movement",
  "supports": {
    "nodeIds": ["n4", "n19"],
    "chainIds": ["ch1"],
    "stepIds": ["s7", "s8"]
  },
  "status": "committed"
}
```

### Required Trace Fields

- `decisionId`
- `stage`
- `decisionPoint`
- `observations`
- `alternatives`
- `commitment`
- `supports`
- `status`

### Trace Stages

The minimal mandatory stages should be:

- clause spine decision
- argument structure decision
- movement decision
- pronunciation/spellout decision

Sentence-specific additional stages can include:

- case decision
- agreement decision
- focus/topic decision
- phase decision
- morphology decision

## Derivation Database V1 Top-Level Objects

The safest V1 top-level structure is:

- `syntaxTree`
- `derivationSteps`
- `chains`
- `researchTrace`
- `provenance`

Optional additive ledgers:

- `caseAssignments`
- `argumentStructure`
- `phaseLog`
- `morphologyRealization`
- `featureLedger`

## Richer Derivation Steps

`derivationSteps` should stop being a replay script and become a typed state log.

### Required Step Fields

- `stepId`
- `operation`
- `affectedNodeIds`

### Strongly Preferred Step Fields

- `trigger`
- `featureChecking`
- `preFeatures`
- `postFeatures`
- `chainId`
- `thetaRole`
- `introducerHead`
- `phase`
- `spelloutDomain`
- `labelDecision`
- `linearizationEffect`
- `morphologyEffect`
- `note`

### Minimal Step Example

```json
{
  "stepId": "s8",
  "operation": "Move",
  "trigger": "wh",
  "affectedNodeIds": ["n4", "n19"],
  "chainId": "ch1",
  "preFeatures": ["uWh"],
  "postFeatures": ["uWh checked"],
  "note": "Move the wh-phrase to the clause edge."
}
```

## Chains Ledger

`chains` should be a separate table rather than implicit in arrows and traces.

Each chain should store:

- `chainId`
- `type`
  - `A`
  - `A-bar`
  - `head`
- `copies`
- `pronouncedCopy`
- `silentCopies`
- `features`
- `note`

This avoids overloading movement arrows with too much theory.

## Case Assignments Ledger

This ledger should be optional and only present when the model explicitly commits to case.

Each item should store:

- `assignmentId`
- `nodeId`
- `case`
- `assigner`
- `mechanism`
- `evidence`
- `overt`

This should support both overt and abstract case.

## Argument Structure Ledger

This tracks who introduced an argument and with what role.

Each item should store:

- `argumentId`
- `nodeId`
- `role`
- `introducer`
- `position`
- `note`

Examples:

- external argument introduced by `v`
- goal introduced by `Appl`
- theme merged as complement of `V`

## Phase Log

This should be added later, after the core trace is stable.

Each item should store:

- `phaseId`
- `phaseHead`
- `complementDomain`
- `transferredNodes`
- `edgeNodes`
- `spelloutDomain`

## Morphology Realization Ledger

Also later-stage, but important for rich morphosyntax.

Each item should store:

- `realizationId`
- `nodeId`
- `surfaceExponent`
- `featuresRealized`
- `hostHead`
- `isPortmanteau`
- `note`

## Provenance

This is mandatory if Babel becomes a derivational corpus generator.

Each analysis should store:

- `modelRoute`
- `framework`
- `language`
- `timestamp`
- `promptVersion`
- `parserVersion`
- `uiVersion` or `siteVersion` when relevant
- `hasResearchTrace`
- `hasCaseAssignments`
- `hasArgumentStructure`
- `hasPhaseLog`
- `hasMorphologyRealization`

Without provenance, the corpus becomes hard to interpret scientifically.

## Validation Philosophy

Do not expose visible failure to ordinary users.

But do validate internally.

Rules:

- every referenced `nodeId` must exist
- every referenced `stepId` must exist
- every referenced `chainId` must exist
- a research-trace commitment must point to supporting objects in the committed parse
- advanced ledgers may be sparse
- sparse is acceptable
- contradiction should not be normalized into the final displayed object

Externally:

- students still get trees
- researchers can see richness level

Possible internal completeness statuses:

- `full`
- `partial`
- `minimal`

These are preferable to student-facing hard errors.

## Lite Safety

Lite should use the same schema but with lower density.

This means:

- same top-level objects
- fewer populated fields
- shorter research trace
- fewer alternatives
- fewer ledgers
- minimal but valid structure

Do not force Lite to emit Pro-level theoretical density.

The architecture should be shared.
The richness should scale by route.

## Highest-Value Additions First

The best implementation order is:

1. richer `derivationSteps`
2. `chains`
3. `researchTrace`
4. `caseAssignments`
5. `argumentStructure`
6. richer `featureChecking`
7. `phaseLog`
8. `morphologyRealization`

This maximizes research value without destabilizing the current system too early.

## Safest Step-By-Step Plan

### Phase 0: Freeze principles

- no Pro-route ad hoc enrichment
- mandatory structured research trace
- typed data first, prose second
- no student-facing failure mode
- simple UI remains primary

### Phase 1: Schema-only groundwork

- define the V1 top-level schema
- define required vs optional fields
- define stable ids:
  - `stepId`
  - `chainId`
  - `decisionId`
  - `assignmentId`

No UI change yet.

### Phase 2: Richer derivation steps

- upgrade `derivationSteps` from replay log to state log
- add `trigger`, `preFeatures`, `postFeatures`, `chainId`
- keep old replay UI working

### Phase 3: Chains ledger

- add explicit chain table
- connect arrows and traces to chain ids
- record pronounced vs silent copies

### Phase 4: Research trace

- add structured decision journal
- keep it hidden or debug-only at first
- validate references to nodes/steps/chains

### Phase 5: Case and argument structure

- add `caseAssignments`
- add `argumentStructure`
- keep them sparse and model-driven

### Phase 6: Research UI surface

- do not overload hover
- add click-based inspector
- expose:
  - node facts
  - chain facts
  - step facts
  - linked research-trace facts

### Phase 7: Phase and morphology

- add `phaseLog`
- add `morphologyRealization`
- connect them to steps and nodes

### Phase 8: Corpus export

Export:

- sentence
- tree
- derivation steps
- chains
- research trace
- case assignments
- argument structure
- phase log
- morphology realization
- surface order
- provenance

At that point Babel becomes a derivational syntax corpus generator.

## What Can Be Added Now With Near-Zero Risk

These additions are the safest because they are additive and do not force UI or route behavior changes:

- document the V1 schema
- add stable optional ids in the type layer:
  - `stepId`
  - `chainId`
  - `decisionId`
- add top-level empty/sparse containers in the analysis schema:
  - `chains`
  - `researchTrace`
  - `caseAssignments`
  - `argumentStructure`
- add provenance fields
- enrich prompt language so models may emit richer `featureChecking` when relevant
- keep all new ledgers hidden from the main UI until the structure is stable

These are not literally zero-risk, but they are the closest safe moves because they are additive and do not require visible behavioral change.

## Final Design Rule

The database stores the theory.

The notes narrate the theory.

The tree renders the theory.

The research trace explains the commitments behind the theory.

That is the architecture that keeps Babel simple on the surface and unusually powerful underneath.
