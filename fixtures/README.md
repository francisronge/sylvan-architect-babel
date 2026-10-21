# Provider-free fixtures

These committed records are Babel's offline verification surface. No fixture makes a provider or
network call.

| Directory | Contents |
|---|---|
| `raw/` | Two hand-authored, model-shaped parser payloads (`Mia laughed.`, `What did Mia see?`). Each has `sentence`, `framework`, `modelRoute` and a `derivationStages` payload. `modelRoute: "gemini"` is the parser's default route label, not the model that wrote them. |
| `normalized/` | Whole-output snapshots of `raw/` after normalization, built by `npm run fixtures:build`. The builder drops only the volatile provenance fields `timestamp`, `promptVersion`, `parserVersion` and `uiVersion`. |
| `replay-snapshots/` | Replay playback snapshots of `normalized/`. |
| `movement/` | Saved analyses and excerpts for movement recognition, endpoints and context. |
| `replay-regressions/` | Saved analyses that reproduce a past Replay, relation or layout defect, plus a few controls. |
| `performance/` | The renderer startup case and long-sentence preparation cases; see `performance/README.md`. |
| `visual-relations/` | Saved analyses for plaque placement and head-movement landings. |
| `replay-corpus/` | The corpus-comparison manifest and its synthetic relation controls. |
| `qualification/` | Malformed outputs for the qualification plumbing smoke plan. |

Every committed analysis outside `raw/` also runs through the Replay invariant sweep
(`tests/helpers/replayInvariantCorpus.mjs`) and the offline visual and camera audits.

## Labels

Each analysis records where it came from and what it protects, beside its stages. A single-analysis
file carries the labels at its top level. A multi-case file carries a `description` at its top level
and a `source` on each case.

- `description`: the behaviour or past defect the record guards, or the control it provides.
- `source`: the model and reasoning effort as recorded, the harness, and the batch, run and analysis.
  It also names any stages that were trimmed and the archive where the source is saved, and says
  whether the record is an exact copy or how it was changed. Hand-built records say so.

Some older files record their origin in a `provenance` field instead. In `movement/restated-chains.json`,
`source` names a movement source, so the origin is in `provenance`. Labelling never adds a `contract`
field: the invariant sweep reads `contract`, so it is part of the record's behaviour.

Most saved sources come from GPT-6.1 Sol, GPT-6 Astra or GPT 5.6 Sol Codex OAuth qualification
runs. They are archived outside the repository in `~/Library/Application Support/Babel/codex-qualification`
and in `~/Library/Application Support/Babel/fixture-sources/codex-workspace-01a0971f-0986-7370-904b-e4a1c4693d82`.
The second is a copy of the earlier Codex desktop workspace under
`~/.codex/visualizations/2026/09/12/01a0971f-0986-7370-904b-e4a1c4693d82`.

## Changing fixtures

- A diff in `normalized/` or `replay-snapshots/` is a behaviour change; review it and never accept a
  blind regeneration.
- Keep a saved analysis exactly as the model wrote it. A trimmed record keeps whole consecutive stages.
- Label an intentional variant or hand-built control as such.
- Check provider-free behaviour with `npm run verify:all`.
