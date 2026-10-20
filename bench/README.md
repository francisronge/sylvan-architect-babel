# Provider-free benchmark plumbing

“BM §n” refers to sections of the archived benchmark architecture,
`docs/history/architecture/fable-zero-unknowns-2026-07-17/babel-provider-grade-benchmark-architecture.md`.

Parked until the future benchmark (Program 7) is built. Nothing in the product
imports it, and its tests are left out of `npm test`; run them with
`npm run test:bench`.

This directory is a dry-run infrastructure boundary, separate from the Babel
product and any derivational database.

The caller supplies every run identity and condition: provider, model,
reasoning setting, carrier, framework, partition, request configuration,
factor assignments, item reference, and provenance. This package supplies no
roster, tier policy, carrier choice, sample design, benchmark content, reviewer
allocation, scoring rule, measurement model, claim, or publication default.

`runBenchmarkDryRun` accepts only the bundled provider-free stub boundaries. It
hashes exact raw bytes, records an artifact reference, passes the unmodified
output to an injected stub engine, preserves normative typed failures, and
returns a deterministic comparison receipt. Receipts contain references and
hashes rather than raw or normalized linguistic content.

The W13 manifest boundary builds and freezes only externally supplied release
selections. Registry entries record per-model documentation and version facts;
admission-probe receipts are externally produced evidence that this package
compares mechanically. The tooling never discovers candidates, launches a
probe, chooses a tier scope, or treats a development fixture as release
authorization. Actual selections, probes, launch authorization, and scored
runs remain Francis-gated (ROADMAP Program 7).

The W13 runner-planning boundary binds externally supplied carrier, framework,
host, tier, request-parameter, service-metadata, and partition identities to a
frozen manifest. It expands only the item references and rerun counts in an
external design record, covers every manifest-required host/tier combination,
and hashes the resulting condition matrix. Each deterministic run identity
binds that matrix hash plus the external design, partition, item reference, and
rerun index. Archives resolve a run from a fully revalidated schedule and accept
only a hash-valid dry-run receipt carrying the canonical run-plan contract.
No carrier, framework, item, rerun count, or partition is defaulted.

The W13 contract-validation boundary is an engineering traceability tool, not a
conformance score. Externally supplied register IDs and source references bind
rules from a hash-bound engine catalog to provider-free fixtures with exact
expected counts. Comparison receipts report only matched or mismatched fixture
evidence. They do not convert instruction-stated constraints into measured
model capability.

The W13 clustered-estimator base computes item-cluster robust proportions and
paired differences. Callers must supply the estimand identity, confidence
level, critical value and its source, and cluster specification. Intervals are
not clipped, inputs are hash-bound, and fewer than two clusters yields an
explicit `insufficient-clusters` result. Equal-observation weighting and the
intercept-only CR1 cluster-sandwich estimator and symmetric two-sided interval
must be named explicitly; none is silently selected. Resampling policy and
measurement-model selection are not part of this base.

The W13 wild-cluster-bootstrap boundary consumes an explicit, externally
produced cluster-multiplier schedule. The caller supplies its distribution
identity, source reference and canonical hash, every multiplier, the confidence
identity, and the two order-statistic indices. The tooling supplies no
random-number generator, seed convention, replication count, multiplier
distribution, quantile convention, interval level, or adoption rule. It
preserves the supplied replication order in the receipt and supports both
clustered proportions and paired shared-item differences without clipping.

The W13 variance-component boundary is an end-to-end provider-free dry run for
a future method-approved local fitter. Callers supply and hash-bind the outcome,
model formula, crossed component definitions, complete prior parameters,
sampler implementation/configuration, exact input data, execution identity,
posterior draws, diagnostics, and provenance. The stub validates complete
posterior component coverage and returns immutable comparison receipts. It does
not fit data, invent priors, choose a sampler, interpret diagnostics, or adopt a
measurement model; non-stub fitters remain refused until separately approved.

The W13 S2 boundary expands externally supplied candidate designs across an
externally selected posterior-draw set and requires one hash-bound simulator
result for every candidate/draw cell. It mechanically evaluates externally
declared at-least/at-most targets and reports complete or incomplete candidate
evidence without ranking candidates or selecting a design. Posterior-window
selection, N, k, adjudicated-subset size, double-rating share, thresholds,
simulation implementation/configuration, and random schedule remain external.
Only the provider-free simulator stub is admitted in this package.

The W13 agreement boundary computes Gwet's AC1 for externally declared nominal
categories using explicitly named equal-unit weighting and multicategory chance
agreement. Every unit retains its authored rater/category evidence, and the
caller supplies the missingness and confidence policy identities and sources,
plus a hash-bound unit-bootstrap schedule and percentile order indices. Inputs
are copied without recoding and hash-bound; the receipt preserves the supplied
replication order and reports an explicit insufficient-unit outcome. This
boundary supplies no category ontology, adjudication policy, missingness rule,
resampling generator, confidence convention, coefficient-ranking rule, or
adoption default. Ordinal coefficients remain separate method-gated work.

The W13 rater-effect propagation boundary consumes separately hash-bound score
draws and signed rater-effect draws from an external method, pairs them by exact
draw ID, and reports the base, effect, and propagated empirical distributions.
The caller must declare how the base score treated rater effects, the common
additive scale, joint-draw construction, pairing and combination identities,
confidence identity, source references, and percentile order indices. Paired
draws retain their externally established covariance; inputs are neither clipped
nor repaired. This boundary does not fit a rater model, estimate an effect,
assume independence, choose a confidence convention, set a reliability
threshold, classify precision, or authorize claim-bearing reporting.

The W13 judged-unit planning boundary validates an externally produced blinded
assignment plan. Its target set is every valid run whose item version is in the
externally declared adjudicated set; invalid and out-of-set runs cannot receive
assignments. The caller supplies the complete randomized run order, reviewer
pool, one-or-two-reviewer assignments, blinded artifacts, and exact complete
reviewer-pair counts. The validator enforces no self-review, complete coverage,
source-run binding, declared model and item-author blinding, and pair counts
differing by at most one. Reviewer workloads are reported descriptively,
not constrained by an invented balancing policy. It generates no assignments
and chooses no reviewer quantity, adjudicated set, double-rating share, or
workload.
Judgment content, rationales, split adjudication, calibration, and expert
recruitment remain separate gated work.

The W13 exposure-ledger boundary requires exactly one evidence event for every
externally declared execution. Provider-API execution is always recorded as
exposure with provider, date, retention tier, and retention evidence; retention
commitments remain observations and never reverse exposure. Operator-controlled
local open-weight execution records custody evidence but creates no provider
exposure state. The externally supplied complete chronological order determines
first exposure; the ledger retains every later exposure event without call
budgets, provider rosters, risk scores, rotation rules, or non-exposure claims
beyond the ledger evidence.

The W13 twin-gap boundary consumes externally matched exposed-anchor and
unexposed-twin records for externally named providers, per-window conditions,
outcomes, and chronologically ordered window pairs. Every record carries
exposure-ledger, twin-non-exposure, matching, outcome, and four-run evidence.
The tooling reports signed anchor-minus-twin gaps and their absolute magnitudes
without clipping or recoding. Only an increase in the absolute gap is labeled
`widening-evidence-not-proof`, under an externally sourced method identity;
there is no gap aggregation, threshold, cadence, causal conclusion, memorization
verdict, rotation action, or provider call.

The W13 memorization-probe evidence boundary compares raw continuation bytes
that an external method has already extracted. Probe definitions bind the
input and expected-continuation artifacts; observations bind the provider,
condition, window, exposure-ledger event, and observed continuation artifact.
Only exact byte equality is reported, with no Unicode normalization, repair,
fuzzy matching, threshold, or memorization verdict. An externally supplied
complete observation order mechanically marks a probe spent and exposed at its
first declared use; timestamps are retained as opaque evidence and never order
observations. Unobserved probes are described only as unspent in the declared
observation set. The boundary chooses no provider roster, probe content,
extraction method, cadence, risk budget, rotation trigger, retirement action,
or study conclusion.

The W13 item-audit boundary validates an externally declared complete
item-version scope and one externally authored human-audit disposition per
target. It recognizes exactly the five lifecycle error classes and the three
settled dispositions: verified, revised, and documented-uncertain. Verified
records contain no defect finding; revised records bind the next item version,
affected-score set, and an external dual-version republication plan;
documented-uncertain records are mechanically excluded from claim-bearing
scores until resolved. A verified record removes only this audit exclusion and
never authorizes a release. The tooling performs no linguistic review, creates
no item content, samples no audit targets, recruits no reviewer, chooses no
retirement trigger, and changes no item or score artifact.

The W13 rolling-intake boundary records candidate item versions accompanied by
externally supplied review-record evidence as an additive queue. Each snapshot
hash-binds complete prior and current entry sets, requires the prior order as an
unchanged prefix, and preserves every prior candidate record exactly. Entries
carry item, submission, submitter, review-record, review-authority, and
opaque-time provenance. The boundary preserves those external declarations; it
does not validate the referenced review artifact at its archive join, activate
an item, or authorize a release. The tooling chooses no content, reviewer,
ordering, cadence, quota, ranking, score, retirement action, or publication
rule.

The W13 star-schema report boundary emits the eight BM §12 tables for one
externally declared release. It hash-binds every source table, validates primary
keys and the Condition→Release/Model, Run→Condition/ItemVersion,
Judgment→Run, Score→Condition, and Correction→ItemVersion/Score joins, and
preserves every row without computing or rewriting a score. Resolved model
versions and alias windows stay mutually exclusive, measured token/cost/latency
facts remain non-negative, and score intervals remain finite but unclipped.
Generating this deterministic dataset does not select a model, method, measure,
view, claim, composite, ranking, figure, publication policy, or release action.

The W13 BM §13 release-bundle boundary accepts only a first-D3 bundle candidate.
It requires the exact ten externally attested preconditions, binds every
attestation to the same release and frozen-manifest hash, reconstructs the
frozen manifest and W13 star-schema receipt, and verifies their release tuple
and selected-model set agree. The resulting immutable receipt is an integrity
and completeness record only: it does not verify the truth or authority of an
external attestation, publish artifacts, authorize a release, or implement a
release workflow. Evidence authenticity remains the
responsibility of each referenced authority/archive join.

The W14a draft-item boundary records externally authored BM §5 content axes,
purpose flags, conditional checklist entries, draft family-documentation
artifacts, ambiguity metadata, exact UTF-8 input text, and provenance. Its lint
is structural only: framework and phenomenon names remain open, checklist prose
is never interpreted, family documentation is explicitly draft and
non-normative, and foundational/adversarial flags never become gates or scoring
keys. Every output remains lifecycle `draft`; human linguistic-validity review,
taxonomy audit, piloting, activation, scoring, and release authorization remain
outside this boundary.

The W14b draft taxonomy-audit boundary requires one externally authored,
hash-bound audit record for every W14a draft item. Each record names its
auditors, opaque audit time, evidence artifact, external taxonomy catalog, and
either no recorded findings or exact finding references. The boundary verifies
only receipt reconstruction, source integrity, evidence shape, and complete
item coverage. It does not perform a linguistic or taxonomy judgment, validate
the truth or authority of the referenced evidence, choose an auditor count,
resolve findings, change lifecycle, activate an item, score it, or authorize a
release. Every item remains a W14a `draft`.

The W14c manifest launch-integrity boundary computes the canonical hash of a
fully reconstructed W13 manifest draft before freezing it. Externally supplied
launch authorization must name that exact draft hash and carry its own evidence
hash; the final frozen-manifest hash then covers both the reconstructed draft
and the authorization record. This closes stale or cross-draft authorization
reuse without generating an authorization, selecting a model, validating the
external authority or evidence artifact, launching a run, or authorizing
publication.

The W15a report-preview boundary reconstructs an exact W13 star-schema receipt
and binds development-only preview artifacts to their declared BM12 source
tables, external reproducer artifacts, output hashes, order, and provenance.
Artifact roles stay externally supplied and no view, score, transformation,
figure, accessibility result, or claim is inferred. The receipt is a
reproducibility manifest for development data only: it creates no site,
publication authorization, deployment target, or release action.

The W15b accessibility-evidence boundary reconstructs the W15a preview chain
and requires one external observation for each preview artifact across BM12's
colorblind-safety, non-color-redundancy, reduced-motion, and static-
reproducibility checks. Each observation binds the exact preview artifact,
auditor, opaque observation time, evidence artifact, optional finding
artifacts, and provenance. Observation labels remain external and open; the
inventory computes no accessibility verdict, design approval, publication
authorization, deployment state, or release action.

The W16a benchmark-stage boundary mechanically pairs D0–D3 with their settled
BM8 identities and claim boundaries, then binds a nonempty, externally authored
evidence set to that label. Evidence roles, authorities, and opaque observation
times remain external. The receipt does not validate evidence authority or
truth, infer stage readiness, advance a stage, authorize a release, or publish
anything. In particular, a D3 label still requires the separate BM13 release
bundle before any claim scope exists.

The W16b development-bundle boundary reconstructs an exact D0 stage receipt and
W13 report receipt, requires exactly BM13 preconditions 1–5, and refuses
Judgment, Score, or Correction rows. Run-level validity and typed-failure
evidence remains unchanged; no conformance or linguistic-adequacy layer is
created. The resulting self-contained integrity receipt validates evidence
shape and binding only. It does not validate external authority or truth,
publish development results, authorize a release, or satisfy any D3 gate.

The W16c correction-ledger boundary joins one complete external item-audit cycle
to one W13 report receipt. Every revised audit must have exactly one correction
row and one republication record; every correction row must trace back to a
revised audit. Per-score from/to artifact pairs exactly cover the affected score
set, including an honestly empty set. Item/version coordinates, finding
taxonomy, the external affected-score-set artifact, and the external
republication-plan artifact are bound without interpreting their linguistic or
statistical content. The versioned score artifacts remain external evidence.
The receipt performs no audit, score computation, republication, release, or
publication action and makes no claim that an external authority or archive is
truthful.

Provider transports, authored benchmark item content, review workflows, statistical models,
publication tooling, and product/database integration remain separately gated.
