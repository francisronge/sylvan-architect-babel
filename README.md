# Sylvan Architect Babel

Sylvan Architect Babel is a syntax tree generator built for research and learning.

Production app: temporarily paused.
Research site: [francisronge.github.io/sylvan-architect-babel/research](https://francisronge.github.io/sylvan-architect-babel/research/)

Babel logo design by Lona Noury.

It helps researchers test how large language models reason about syntax under explicit theoretical prompts, while also giving students a clean and practical way to generate, inspect, and compare syntactic trees.

Babel is generative syntax: an interactive environment where model-produced analyses can be inspected as derivations, trees, and syntactic relations.

## License

Babel-owned source code and documentation are licensed under the
[Apache License 2.0](./LICENSE), except where a file or notice says otherwise.
Bundled software, fonts, research material, and model-output records retain
their own terms; see [Third-Party Notices](./THIRD_PARTY_NOTICES.md). The
official names and logo are not licensed for use as fork branding; see
[Names and Logo](./TRADEMARKS.md).

## Start Here

1. For local use, install dependencies and run `npm run dev`; the former public Vercel app is temporarily paused.
2. Configure provider keys using [.env.example](./.env.example).
3. Browse the [Babel Relation Orchard](./docs/research/relation-orchard/orchard.html).

## Why Babel exists

Many tree tools either use rigid templates or return black-box output with little transparency.

Babel is designed to make the model's structural decisions inspectable:

- The model is required to commit to a concrete analysis inside a chosen syntactic framework.
- You get a final structure reconstructed from the same authored derivation stages shown in replay.
- You can compare analyses under different theory settings.
- When multiple genuinely distinct analyses are available, Babel preserves all of them for comparison.

## Who Babel is for

Babel has two primary users:
- students who want syntax to be legible, visual, and explorable
- researchers who want to inspect what theory a model is actually making public

### Researchers

- A structural reasoning benchmark for language models.
- Can large language models construct syntactic derivations that obey formal grammatical constraints?
- Evaluate whether output reflects framework constraints vs shallow pattern matching.
- Run prompt-level comparisons between X-bar and Minimalist settings.
- Inspect movement, derivational order, and structural alternatives.
- Export bracketed notation for external workflows.

#### Babel as a benchmark framework

With Babel's model routes in the local runtime, you can run controlled syntax sweeps, for example:

- hundreds of syntactic test sentences in a short evaluation window.
- Multi-phenomenon suites covering `wh-movement`, `island constraints`, `agreement`, `control`, `raising`, and `attachment ambiguity`.
- Cross-linguistic evaluation across all human languages, not only high-resource benchmark languages.

Researchers can use Babel to build hypothesis-driven syntax studies: run controlled sentence suites, compare analyses across frameworks and model routes, inspect stage records and open visual relations across languages, and document where models converge or diverge from formal grammatical expectations.

This pushes Babel beyond a tree tool and toward an evaluation framework for explicit LLM structural reasoning.

#### Why this is different from standard syntax benchmarks

Many established benchmarks evaluate syntactic recognition behavior:

- `BLiMP`: grammatical vs ungrammatical preference.
- `SyntaxGym`: surprisal-based sentence processing effects.
- `CoLA`: acceptability classification.

Those are valuable, but they usually do not require explicit derivation construction.

Babel asks a different question:

- Not only: "Does the model behave like it knows syntax?"
- But: "Can the model explicitly produce syntactic structure?"

In Babel, every returned analysis must commit to a concrete, replayable derivation. Ambiguous sentences may have multiple committed analyses when their meanings require different structures.

Babel is designed around forced commitment within each analysis: Babel evaluates the coherence of the authored stages rather than completing the syntax on the model's behalf.

### Students

- Generate trees quickly for study and practice.
- Learn how framework choice changes structure.
- Move from final tree reading to derivation-level understanding.
- Read open visual relations alongside the ordered human-readable stage records.

## Full feature guide

### 1) Theory mode switch

Babel includes two theory modes:

- `X-Bar Theory`
- `Minimalist Program`

Click the active theory pill in the header to toggle between them.

Switching theory changes the analysis behavior, tree style, replay, and explanatory framing.

### 2) Model selection

Babel's local model menu selects an exact model:

- GPT-6 Astra and GPT 5.6 Sol (OpenAI)
- Claude Opus 5 and Claude Fable 5.1 (Anthropic)
- Kimi K3 (Moonshot)
- Grok 4.6 (xAI)

The adjacent effort menu offers the selected model's supported settings, starting
at `high`. Meta and GLM are on hold; Gemini is not offered in the menu.

Babel uses the selected model and settings without silently switching models.
Generation records retain model information, timing, token usage and the provider
response. Tree Bank saves that evidence alongside the analysis. Failed requests
offer a downloadable failure record.

### 3) Constituent Glyphing toggle

Babel includes a `Constituent Glyphing` abstraction toggle.

This gives an alternate visual layer for reading structure at a higher level of abstraction, while preserving the underlying parse output.

### 4) Input console (Arboretum Link)

The bottom control panel supports:

- Sentence entry and submission
- Expand/collapse behavior
- Temporary hide/show behavior
- Framework-sensitive placeholder guidance
- In-panel error/status feedback

### 5) Parse execution flow

When you submit a sentence, Babel shows:

- Loading state
- Parse success state (tree + supporting views)
- Parse error state with user-readable messages

### 6) Ambiguity handling

An ambiguous sentence may have more than one meaning and more than one corresponding tree. Babel's internal parse bundle preserves every supplied distinct analysis rather than imposing a two-parse ceiling.

The parse selector exposes `Parse 1`, `Parse 2`, and any additional analyses. Selecting one updates Canopy, Derivation Replay, and Notes together.

### 7) Canopy view

`Canopy` is the clean final-workspace view. It shows each authored final root without adding a syntactic parent.

It is optimized for readability of the resulting structure.

### 8) Derivation Replay view

`Derivation Replay` presents the ordered structural states compiled from `derivationStages`.

It includes:

- Step-based reveal of structural construction
- Playback controls (`Prev`, `Play/Replay`, `Next`)
- Timeline scrubber with sprout slider
- Operation labels per step
- Workspace-forest state updates
- Open `relations` rendered when Babel has a supported visual treatment
- Trace visibility for derivation inspection

This view is designed to expose process, not just endpoint.

### 9) Notes view

`Notes` presents the ordered, non-empty `derivationStages[].stageRecord` strings directly. Babel does not synthesize a parallel explanation or compiled analysis layer.

The view also includes:

- Labeled bracketing derived from each final root
- One-click copy for bracketed notation
- Direct external link support for notation tooling
- Use bracketed notation in traditional tools (for example, MShang) when you want a classic tree workflow outside Babel's renderer.

### 10) Output artifacts

The authored model output is exactly `derivationStages`. Every stage has four required fields:

- `statement`
- `stageRecord`
- `relations`
- `workspaceForest`

Babel sends the model only the sentence; the model decides where its words are, and Babel checks that the final stage spells the sentence. An optional `realizations` field associates existing syntax nodes with the text they realize. For example, separate `walk` and `-ed` leaves may jointly realize `walked`, and one node may realize separate pieces such as French *ne … pas*. The model supplies the association; Babel preserves the pieces and checks the spelling without deriving morphology or changing the tree. Analyses whose nodes' own words spell the sentence omit the field. See the [realization contract](docs/research/morphology-realization-audit.md#contract-reuse-check-and-proposed-extension).

Babel validates those stages, replays them, and derives the final forest, surface order, relation render plans, and replay steps. A single-root analysis also has a `tree` convenience field. Several final roots are allowed when their combined pronounced terminals account for the exact input; that structural check does not decide whether the analysis is linguistically convincing. A malformed relation stays attached to its stage as a neutral Replay moment with its original payload and field diagnostic, while intact sibling relations remain drawable. A malformed workspace or incomplete surface coverage still fails the analysis. Relation names and anchor-role names remain open rather than being projected into a fixed ontology.

These outputs are intended for both human reading and downstream inspection workflows.

### 11) Tree Bank

`Tree Bank` is Babel's local save-and-reopen workspace.

It includes:

- Save current parse state from the header (`Save to Tree Bank`)
- Reopen saved analyses with their active framework and parse selection
- Store rendered tree snapshot previews for quick browsing
- Delete saved entries directly from the Tree Bank panel
- Keep data local to the current browser/device

## Practical research workflow

1. Choose a framework (X-bar or Minimalism).
2. Parse a sentence.
3. Inspect the final structure in Canopy.
4. Inspect derivational behavior in Derivation Replay.
5. Compare outputs across frameworks and across reruns.
6. Record differences in structure, visual relations, and stage records.

## Limits and caveats

- Output quality can vary with model behavior and service availability.
- Any single tree should be treated as a committed analysis proposal, not final theoretical truth.
- The former public Vercel app is temporarily paused; current development and benchmark work run locally.

## Project direction

Babel is being built as an open resource for linguistics and AI interpretability work.

The current dependency order is maintained in [ROADMAP.md](./ROADMAP.md):
contract qualification, durable Tree Bank integration, the new workbench,
syntactician workspace features, benchmark releases, and a governed public
derivational database.
