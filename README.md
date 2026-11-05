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

#### Babel as a benchmark framework

Babel has not published a benchmark yet; a reviewed, claim-bearing benchmark comes after the public app (see [ROADMAP.md](./ROADMAP.md), Programs 7 and 8).

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

- `Minimalist Program` (the default, using Bare Phrase Structure)
- `X-Bar Theory`

Click the active theory pill in the header to toggle between them.

Switching theory changes the analysis behavior, tree style, replay, and explanatory framing.

### 2) Model selection

Babel's local model menu selects an exact model:

- GPT-6 Astra and GPT-6 Sol (OpenAI)
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

### 4) Input screen and tree screen

Babel has two screens around an analysis. The input screen holds the sentence
bar:

- Sentence entry and submission
- Framework-sensitive placeholder guidance
- In-panel error/status feedback

A finished analysis opens on the tree screen, where nothing but the header and
the parse selector takes the tree's room. Click the Babel logo in the header to
return to the input screen and parse another sentence; the Tree Bank's
`Back to Arboretum` returns to the analysis you were reading.

A failed request stays on the input screen with your draft. Dismiss the failure
with its close button or Escape: if an analysis is open you return to it at its
paused frame, your draft and Tree Bank stay, and no request is made. Download
its raw output or failure record first if you want them; the next request
clears the failure in any case.

### 5) Parse execution flow

When you submit a sentence, Babel shows:

- Loading state
- Parse success state (the tree in Replay)
- Parse error state with user-readable messages

If the tree fails to display, its area shows a notice with the error details
and `Retry view`; the header stays, and so does the analysis, which you can
still save. Choosing another parse or analysis, or leaving for the input screen
or the Tree Bank, also clears the notice. If Babel as a whole fails, the page shows `Restart
Babel` instead of going blank; your Tree Bank is kept, but an unsaved analysis
may need to be generated again.

### 6) Ambiguity handling

An ambiguous sentence may have more than one meaning and more than one corresponding tree. Babel's internal parse bundle preserves every supplied distinct analysis rather than imposing a two-parse ceiling.

The parse selector exposes `Parse 1`, `Parse 2`, and any additional analyses. Selecting one shows it in Replay, resuming at the frame you left it on.

### 7) Derivation Replay

Replay is Babel's only view of an analysis. A new analysis opens in Replay and
plays; its last frame is the finished tree. It presents the ordered structural
states compiled from `derivationStages`.

It includes:

- Step-based reveal of structural construction
- Playback controls (previous step, play or pause, next step, and Fit)
- A stage rail: one segment per stage, sized by its steps, to drag or tap through
- Operation labels per step, with the stage's statement as its goal
- Each stage's `stageRecord`, shown with that stage's frames
- On construction steps, the workspace and the lexical array in labelled bracketing (WS = [ … ], LA = { … })
- Workspace-forest state updates
- Open `relations` rendered when Babel has a supported visual treatment
- Trace visibility for derivation inspection

This view is designed to expose process, not just endpoint.

### 8) Output artifacts

The authored model output is exactly `derivationStages`. Every stage has five required fields:

- `statement`
- `stageRecord`
- `relations`
- `workspace` (the stage's current roots)
- `nodes` (only what the stage introduces or changes, written as trees)

Babel expands `workspace` and `nodes` into a nested `workspaceForest` before any other check. Analyses written directly as nested forests, including every record saved earlier, are read unchanged.

Babel sends the model only the sentence; the model decides where its words are, and Babel checks that the final stage spells the sentence. A complete tree whose words are the sentence's in another order is still drawn, marked as an invalid analysis: the header says how many words are out of order, and the last step shows the sentence beside the model's tree, with those words in amber. An optional `realizations` field associates existing syntax nodes with the text they realize. For example, separate `walk` and `-ed` leaves may jointly realize `walked`, and one node may realize separate pieces such as French *ne … pas*. The model supplies the association; Babel preserves the pieces and checks the spelling without deriving morphology or changing the tree. Analyses whose nodes' own words spell the sentence omit the field. See the [realization contract](docs/research/morphology-realization-audit.md#contract-reuse-check-and-proposed-extension).

Babel validates those stages, replays them, and derives the final forest, surface order, relation render plans, and replay steps. A single-root analysis also has a `tree` convenience field. Several final roots are allowed when their combined pronounced terminals account for the exact input; that structural check does not decide whether the analysis is linguistically convincing. A malformed relation stays attached to its stage as a neutral Replay moment with its original payload and field diagnostic, while intact sibling relations remain drawable. A malformed workspace or incomplete surface coverage still fails the analysis. Relation names and anchor-role names remain open rather than being projected into a fixed ontology.

These outputs are intended for both human reading and downstream inspection workflows.

### 9) Tree Bank

`Tree Bank` is Babel's local save-and-reopen workspace.

It includes:

- Save current parse state from the header (`Save to Tree Bank`)
- Reopen saved analyses with their active framework, parse selection and Replay frame; saves made in the retired Canopy or Notes views open paused on the finished tree
- Store rendered tree snapshot previews for quick browsing
- Delete saved entries directly from the Tree Bank panel
- Keep data local to the current browser/device

## Practical research workflow

1. Choose a framework (Minimalism, the default, or X-bar).
2. Parse a sentence.
3. Inspect derivational behavior in Replay, and the final structure on its last frame.
4. Compare outputs across frameworks and across reruns.
5. Record differences in structure, visual relations, and stage records.

## Supported browsers

Babel needs a browser with these features, which its code uses without a
fallback:

- JavaScript modules (the app and its Replay workers are module code)
- `Intl.Segmenter` (spelling checks and label layout)
- `structuredClone` (copying trees while Replay is built)
- `Array.prototype.at` and `Object.hasOwn`
- `ResizeObserver` (keeping the tree fitted to its view)

In practice that means Chrome or Edge 98, Firefox 125, Safari 15.4 or newer.
Before the app loads, `public/browser-support.js` checks for each feature
(never the browser's name or version) and, if any is missing, shows a short
message asking you to update instead of a broken page.

Saving and reopening Tree Bank entries also need a secure page (`https://` or
`localhost`), because records are hashed with the Web Crypto API.

## Limits and caveats

- Output quality can vary with model behavior and service availability.
- Any single tree should be treated as a committed analysis proposal, not final theoretical truth.
- The former public Vercel app is temporarily paused; current development and benchmark work run locally.
- On the hosted app, a generation that runs past about 4¾ minutes stops with a "Generation took too long" message. Nothing is retried automatically; try again, or choose a lower effort, which usually answers faster.

## Project direction

Babel is being built as an open resource for linguistics and AI interpretability work.

The remaining work is maintained in [ROADMAP.md](./ROADMAP.md). The current
focus is the public app: a simple interface built around Replay, and a Tree
Bank that grows into a minimal syntactician's workbench. Hosting, a generation
archive, a reviewed derivational corpus and, last, benchmark releases follow.
The model and effort menus described above belong to the local app; the
public app will not show them.
