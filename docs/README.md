# Babel Documentation Map

This file answers one question: which document should be trusted for what?

## Canonical

| Document | Authority |
| --- | --- |
| [`ROADMAP.md`](../ROADMAP.md) | The single ordered list of remaining work. |
| [`CONTEXT.md`](../CONTEXT.md) | Canonical names and boundaries for the product, renderer, qualification work, archives, corpus, and benchmark. |
| [`AGENTS.md`](../AGENTS.md) | Repository operating contract for coding agents. |
| [`docs/verification.md`](verification.md) | What every check proves, how to run it and what it cannot see. |
| [`docs/qualification-runs.md`](qualification-runs.md) | Generating model analyses with the Codex and Anthropic runners. |
| [`README.md`](../README.md) | Product overview and local-use guide. |
| [`server/babelParser/systemInstruction.js`](../server/babelParser/systemInstruction.js) and [`prompts.js`](../server/babelParser/prompts.js) | Model-facing authored contract. |
| [`docs/implementation/invention-boundary.md`](implementation/invention-boundary.md) | Deterministic compiler and elaboration boundary. |
| [`docs/implementation/baselines/provider-free-baseline-spec.md`](implementation/baselines/provider-free-baseline-spec.md) | Provider-free baseline contract. |
| [`docs/design/visual-relations-tier2-shape-dispatch-spec.md`](design/visual-relations-tier2-shape-dispatch-spec.md) | Intended Tier-2 behavior and earlier fixture verification; open renderer work is listed in the roadmap. |
| [`docs/design/visual-relations-renderer-closeout-2026-08-25.md`](design/visual-relations-renderer-closeout-2026-08-25.md) | Renderer behavior contract: rules only; open renderer work is listed in the roadmap. |

## Supporting Implementation Records

- [`derivationalDatabase/README.md`](../derivationalDatabase/README.md): exact
  scope of the persistence-free W17a-d record layer.
- [`bench/README.md`](../bench/README.md): exact scope of provider-free W13-W16
  benchmark plumbing.
- [`docs/design/benchmark-provenance-conditions.md`](design/benchmark-provenance-conditions.md):
  benchmark provenance conditions.
- [`contractQualification/program-1.item-set.json`](../contractQualification/program-1.item-set.json)
  and the manifests in
  [`docs/implementation/contract-qualification/`](implementation/contract-qualification/):
  the frozen 14-item qualification set and the contract fingerprints read by
  `scripts/captureContractFingerprint.mjs` and the qualification smoke plan.
  They are historical baselines and do not describe today's contract.

## Renderer Research Archive

The remaining `docs/design/visual-relations-*` research notes, inventories,
source records, and proof pages explain how the renderer was developed. They
are useful provenance, not open tasks. The Tier-2 specification records intended
behavior. The roadmap lists current work.

Some of those historical notes refer to locally recovered copies of academic
figures under `docs/design/visual-relations-assets/`. Those third-party copies
are intentionally not distributed; the notes retain their source citations and
links as the release record.

The public artifact is [`docs/research/relation-orchard/`](research/relation-orchard/).

## Research Site And Studies

[`docs/index.md`](index.md) and [`docs/research/`](research/index.md) are the
published research site (GitHub Pages). Its
[archive](research/archive/index.md) keeps earlier Codex-generated papers as
project history. Two dated studies sit beside them and record the state they
measured:

- [`input-segmentation.md`](research/input-segmentation.md): how Babel split
  input into tokens (17 Oct 2026). Babel no longer tokenizes before the model
  sees the sentence; [`AGENTS.md`](../AGENTS.md#derivation-contract) states
  today's rule.
- [`morphology-realization-audit.md`](research/morphology-realization-audit.md):
  morphology and surface realization, and the `realizations` contract it led
  to.

## History

`docs/history/` keeps two records. Historical text is intentionally not
rewritten to look current; read the README beside each set before using it.

- The [Fable Zero Unknowns packet](history/architecture/fable-zero-unknowns-2026-07-17/README.md)
  is a primary architecture source preserved in full. Its
  [reconciliation audit](history/architecture/2026-07-fable-packet-audit.md)
  maps the packet's decisions and W0-W18 program to the code and roadmap as
  they stood on 25 Aug 2026.
- [`docs/history/renderer/`](history/renderer/README.md) keeps the renderer
  closeout's audit ledger and review receipts.

Older plans, device handoffs and dated reports were removed; Git history keeps
them.

## Generated And Local-Only Material

- `.artifacts/`: ignored research outputs. Only explicitly unignored harness
  entrypoints and helpers belong to the repository.
- `bench-baseline/`: local benchmark baseline output.
- `dist/`: frontend build output.
- `test-results/`: browser/test output.
- `docs/design/*.bundle.js`: generated renderer bundles. Only the current
  immutable Orchard bundle survives; Tier-2 review output is rebuilt on demand.

Default verification must use committed files under `fixtures/` and `tests/`,
never an ignored local artifact directory.
