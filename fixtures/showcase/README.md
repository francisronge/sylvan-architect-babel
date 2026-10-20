# Showcase analyses

Strong saved analyses, kept as a positive quality bar. Every other directory holds regression cases
and controls; this one shows what good output looks like, and requires Replay to keep handling it
cleanly.

The four files group the analyses by theme: `movement.json`, `agreement-and-case.json`,
`scope-ellipsis-coordination.json` and `relatives-and-clitics.json`. Together they hold 29 cases and
43 analyses, in 15 languages, in both frameworks.

- **Origin.** Each case is an exact copy of a saved GPT-6.1 Sol or GPT-6 Astra analysis with high
  reasoning, from the Codex OAuth qualification batches of 18–19 October 2026 under the
  character-spellout-v3 contract.
- **Fields.** Each case records:
  - `description`: what the analysis shows;
  - `source`: model, effort, harness, contract, commit, batch, run, analysis and archive path;
  - `contract`: the run's spell-out contract;
  - `sentence` and `inputTokens`: the run's shared word list.
- **Selection.** The analyses were read for linguistic plausibility. They were then kept only if
  they had no finding from the invariant sweep, the contract warnings, the offline visual and camera
  audits, or the right-to-left mirror check.
- **Registration.** `fixtures/replay-corpus/manifest.json` lists every analysis under the required
  `showcase` mechanism, so `npm run verify:corpus` compares them between checkouts.

No showcase analysis has an exception in `tests/helpers/*Exceptions.mjs`. If a change produces a new
finding here, fix the change. Do not list the finding as an exception.
