# Babel Documentation Map

This file answers one question: which document should be trusted for what?

## Canonical

| Document | Authority |
| --- | --- |
| [`ROADMAP.md`](../ROADMAP.md) | The only active implementation plan and status map. |
| [`CONTEXT.md`](../CONTEXT.md) | Canonical names and boundaries for the product, renderer, qualification work, archives, corpus, and benchmark. |
| [`AGENTS.md`](../AGENTS.md) | Repository operating contract for coding agents. |
| [`README.md`](../README.md) | Product overview and local-use guide. |
| [`server/babelParser/systemInstruction.js`](../server/babelParser/systemInstruction.js) and [`prompts.js`](../server/babelParser/prompts.js) | Model-facing authored contract. |
| [`docs/implementation/invention-boundary.md`](implementation/invention-boundary.md) | Deterministic compiler and elaboration boundary. |
| [`docs/implementation/baselines/provider-free-baseline-spec.md`](implementation/baselines/provider-free-baseline-spec.md) | Provider-free baseline contract. |
| [`docs/design/visual-relations-tier2-shape-dispatch-spec.md`](design/visual-relations-tier2-shape-dispatch-spec.md) | Intended Tier-2 behavior and earlier fixture verification; current defects are tracked in Program 1. |
| [`docs/design/visual-relations-renderer-closeout-2026-08-25.md`](design/visual-relations-renderer-closeout-2026-08-25.md) | Historical fixture closeout, not a sign-off on the later live-output failures. |

## Supporting Implementation Records

- [`docs/implementation/contract-qualification/system-audit.md`](implementation/contract-qualification/system-audit.md):
  September live-output audit covering 39 findings, all 36 original relations, linguistic
  issues, Fable failures, costs, and review limitations. Program 1 in `ROADMAP.md`
  owns the active checklist and status. Linked raw and generated evidence is
  local-only under the ignored `.artifacts/` run directory.
- [`derivationalDatabase/README.md`](../derivationalDatabase/README.md): exact
  scope of the persistence-free W17a-d record layer.
- [`bench/README.md`](../bench/README.md): exact scope of provider-free W13-W16
  benchmark plumbing.
- [`docs/design/benchmark-provenance-conditions.md`](design/benchmark-provenance-conditions.md):
  benchmark provenance conditions.
- [`docs/implementation/contract-qualification/incumbent-contract-audit-2026-08-28.md`](implementation/contract-qualification/incumbent-contract-audit-2026-08-28.md):
  Program 1 fingerprint and audit of the current model-facing interface.
- [`docs/implementation/contract-qualification/fable-review-2026-08-28.md`](implementation/contract-qualification/fable-review-2026-08-28.md):
  independent review of that Program 1 audit and fingerprint.

## Renderer Research Archive

The remaining `docs/design/visual-relations-*` research notes, inventories,
source records, and proof pages explain how the renderer was developed. They
are useful provenance, not open tasks. The Tier-2 specification records intended
behavior; the September audit supplies reproducible defects that reopen the
earlier closeout. Follow Program 1 for current work and status.

Some of those historical notes refer to locally recovered copies of academic
figures under `docs/design/visual-relations-assets/`. Those third-party copies
are intentionally not distributed; the notes retain their source citations and
links as the release record.

The public artifact is [`docs/research/relation-orchard/`](research/relation-orchard/).

## History

`docs/history/` preserves old plans, Mac handoffs, checkpoints, audit ledgers,
and reviewer receipts. Historical text is intentionally not rewritten to look
current. Read the README beside each history set before using it.

The [Fable Zero Unknowns packet](history/architecture/fable-zero-unknowns-2026-07-17/README.md)
is a primary architecture source preserved in full. Its
[live reconciliation audit](history/architecture/2026-07-fable-packet-audit.md)
maps the packet's decisions, residual unknowns, W0-W18 program, and later
workspace plan to live code and the master roadmap.

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
