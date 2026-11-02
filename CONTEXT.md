# Babel Context

Babel turns model-authored syntactic derivations into inspectable, replayable,
durable analyses. This glossary separates the released research artifact from
the product and evaluation work that still remains.

## Language

**Babel product**:
The not-yet-shipped application comprising the public syntax generator and the
research workbench over one shared contract, engine, renderer, Tree Bank, and
derivational record system. Its roadmap is a minimum product boundary, not a
frozen feature list.
_Avoid_: Relation Orchard, research release

**Relation Orchard**:
The already-published research artifact that presents Babel's curated relation
fixtures and visual vocabulary. It demonstrates the renderer but is not the
Babel product or an end-to-end provider-integration proof.
_Avoid_: Babel product, Atlas

**Renderer subsystem**:
The deterministic Tier 1, Tier 2, and Tier 3 relation renderer and Replay
behavior verified provider-free against committed fixtures.
_Avoid_: complete Babel renderer integration

**Renderer integration**:
The complete path from provider-authored contract output through normalization,
compilation, Replay, and rendering inside the shipped Babel product.
_Avoid_: renderer subsystem

**Contract qualification**:
Pre-launch empirical testing of whether selected providers reliably produce
usable Babel analyses under the model-facing contract.
_Avoid_: benchmark

**Public generation policy**:
The single empirically selected model and settings that power the public syntax
generator without exposing provider controls to ordinary users.
_Avoid_: research model picker

**Research model access**:
Explicit provider, model, and native-control access for inspecting and comparing
runs across proprietary and open-weight candidates. Francis chooses every model
in the configured catalog. Every route must meet the same product-quality
standard even though model analyses may differ.
_Avoid_: public generation policy

**Babel product launch**:
Public Babel at `/` working in production: qualified public generation,
complete Replay, the Personal Tree Bank, bounded operations and the Generation
Archive (every hosted parse kept for our own use, disclosed in the privacy
note). The research workbench at `/research`, the Reviewed Derivational Corpus
and the benchmark come after launch. Francis, 31 Oct 2026: "we're only
shipping public babel".
_Avoid_: Relation Orchard publication, benchmark release

**Benchmark**:
The deferred, claim-bearing evaluation of model syntactic performance that
requires qualified review, methods authority, and independently reconstructable
evidence.
_Avoid_: contract qualification, product verification

**Personal Tree Bank**:
The user's browser-local library of explicitly saved Babel work, annotations,
collections, and exports. Saving or deleting here does not control backend
research retention by the official hosted service.
_Avoid_: Generation Archive, Reviewed Derivational Corpus

**Generation Archive**:
The official hosted service's automatic backend record of generation attempts,
including successful analyses and separately typed failed or malformed outputs.
It is not an initial ordinary-user interface.
_Avoid_: Personal Tree Bank, Reviewed Derivational Corpus

**Reviewed Derivational Corpus**:
The human-selected collection of research- and training-grade complete
derivations promoted from archived generations with evidence and provenance.
This is a technical working name; public branding remains unresolved.
_Avoid_: Generation Archive, final-tree treebank

**Failed generation**:
A provider attempt that does not become a valid Babel analysis because of
transport, malformed data, contract, or deterministic-engine failure. A valid
analysis of an ungrammatical sentence is not a failed generation.
_Avoid_: illicit analysis, corrupt sentence

## Boundaries

Babel's product, its benchmark and its derivational data (Personal Tree Bank,
Generation Archive and Reviewed Derivational Corpus) are separate systems. They
share the derivation contract and durable record types but not product state.
None quietly copies another's derivation bytes, and benchmark controls never
become ordinary interface settings.

- No confirmed-worse derivational output is acceptable for formatting,
  reliability, cost, latency, convenience or implementation simplicity.
- Babel requests complete derivations. The output allowance is never inferred
  from sentence length.
- One analysis produces one canonical immutable durable record.
- Archive raw provider response bytes, parsed values and canonical
  reserialization separately. They are three different fidelity layers.
- Provider settings keep their native names and meanings. Do not manufacture a
  temperature, equate effort labels across providers, or treat lower effort as
  harmless without an approved comparison. Every run records its effective
  settings and documented defaults.
- Keep the model-facing contract provider-neutral, with no worked language
  examples, role menus, hidden provider-specific linguistic patches or closed
  relation ontology.
- One parse request makes at most one provider generation request. Babel never
  retries automatically: a connection reset or server error can arrive after
  the provider accepted, and billed, the generation. The failure returns to the
  user as an ordinary error they may retry (decided 2026-10-23, Francis). An
  uncertain timeout does not prove that a generation stopped; recovering an
  existing response is distinct from creating a new one.
- The derivational database never supplies benchmark answers or held-out
  material. A released benchmark bundle may enter it only afterward, through an
  explicit one-way import marked with its benchmark origin.

## Contract qualification rules

Qualification is product reliability work over selected cases, not a benchmark.

- Start each batch from a concrete unresolved question with acceptance criteria
  stated in advance. Freeze its inputs, and state the models, native settings and
  approved maximum run count or spend before it runs.
- Preserve failures, valid unexpected analyses and every returned alternative.
  Show Francis the questionable examples with the full batch still inspectable;
  already-approved records do not need repeated review.
- Classify transport completion, contract validity, linguistic adequacy and
  deterministic engine or rendering defects separately.
- Do not silently repair linguistic content or add speculative prompt rules to
  prevent individual model errors. Model mistakes and defensible alternative
  analyses stay inspectable; they are neither automatic shipping blockers nor
  permission to rewrite records.
- Neutral prose or context without another drawable dependency is not a missed
  drawing, and an unfamiliar language alone is not evidence of a defect.
- Keep genuinely unseen cases for evaluating a frozen candidate. Once a case
  guides a fix, it is a regression, not untouched holdout evidence. Assess
  defensible alternative analyses rather than demanding one gold tree.
- A count of selected parses is not a benchmark, a population error estimate or
  a measure of diminishing returns. Controlled sentence contrasts can isolate a
  claimed phenomenon. Report morphology, language, provider and ambiguity
  coverage honestly.
