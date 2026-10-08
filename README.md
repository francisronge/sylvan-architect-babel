# Sylvan Architect Babel

Sylvan Architect Babel is a syntax tree generator built for research and learning.

Production app: temporarily paused; deployment history and configuration are retained.
Research site: [francisronge.github.io/sylvan-architect-babel/research](https://francisronge.github.io/sylvan-architect-babel/research/)

Development status: the renderer and Replay have extensive local verification;
remaining qualification and the unfinished application work are tracked in the
[Babel Master Roadmap](./ROADMAP.md). Babel is not yet qualified for public launch.
The documentation authority map is in [docs/README.md](./docs/README.md).

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
2. For development status and dependencies, read [ROADMAP.md](./ROADMAP.md).
3. For current documentation authority, read [docs/README.md](./docs/README.md).
4. Browse the [Babel Relation Orchard](./docs/research/relation-orchard/orchard.html).
5. Production-facing environment guidance lives in [.env.example](./.env.example).

## Source ownership

- `App.tsx` composes the workspace and owns the current analysis and view selection.
  `hooks/useGeneration.ts` and `services/generationState.ts` own request progress
  and retained failures; `services/parseService.ts` owns the browser HTTP call.
- `services/treeBankRecords.ts` and `services/treeBankStore.ts` own immutable local
  records and atomic saves. Snapshot capture and bracket serialization live in
  `services/treeSnapshot.ts` and `services/milesNotation.ts`.
- `replay/` contains React-free construction and inspection. The compiler retains
  movement ownership and scheduling; panel formatting and surface notation have
  separate pure modules. Authored workspace and realization rules are shared by
  server validation and browser diagnostic inspection.
- `components/AsyncTreeVisualizer.tsx` owns preparation and view recovery.
  `TreeVisualizer.tsx` owns D3 drawing, camera and playback state;
  `ReplayPanel.tsx` owns the existing controls and detail presentation.
- `FailurePanel.tsx` preserves request diagnostics and downloads. Its diagnostic
  dialog can inspect readable failed stages without accepting or repairing them.
  Error boundaries sit below analysis ownership, so retrying a view does not
  generate another analysis.

## Why Babel exists

This section will be rewritten for Babel's full public launch.

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

Configure server-side keys using `.env.example`. The app sends `modelId` and
native `settings` to `/api/parse`; the server rejects unsupported choices without
switching models. Older `modelRoute` API callers remain unchanged. Their environment
overrides do not change an explicitly selected model.

These integrations have offline transport and parser tests, not live model
qualification. The model-facing derivation contract and renderer are unchanged.
Generation records preserve the selected and returned model, settings, request
hash, timing, token usage, stop state, and raw provider response. Raw artifacts use
the existing bounded-copy format, with byte counts, a hash, and an explicit
truncation flag. Tree Bank retains this evidence; failed requests offer a
downloadable failure record.

#### Subscription-funded development checks

To enter sentences manually in Babel's normal app interface:

```sh
npm run qualification:codex:app
```

Open `http://127.0.0.1:8454/`. The sentence box, framework selector, Canopy,
Replay, Notes and browser-local Tree Bank are the actual app components.
GPT-6.1 Sol / high is selected initially; Astra and Sol are also available.
Each Parse invokes the existing OAuth qualification runner once and saves its
usual artifacts under `~/Library/Application Support/Babel/codex-qualification`.
The app explicitly fingerprints the working tree, including uncommitted changes;
the receipt records whether those sources match the named commit.
Use `-- --out DIRECTORY --port NUMBER` to change the archive or local port.
Closing the page cancels its unfinished request and retains received output.
This local interface does not enable OAuth on Babel's public provider routes.

`npm run qualification:codex` sends Babel's exact prompts directly to the Codex
Responses endpoint using a ChatGPT subscription login. It does not launch an
agent or load Codex instructions, history, tools, skills, project files or profile
configuration. It reads only the login credential file, in memory, without
copying or changing it. It never uses API keys or retries a request.

From a checkout with committed contract sources:

```sh
npm run qualification:codex -- --sentence 'Mia laughed.' --framework xbar \
  --out /tmp/babel-sol-check --run
npm run qualification:review -- --run /tmp/babel-sol-check
```

Omit `--run` to save and inspect the request without authentication or network
access. Add `--working-tree` to explicitly fingerprint current uncommitted sources;
without it, the CLI still requires committed contract sources.
Each invocation requires a new output directory. The subscription default
is GPT-6.1 Sol at high reasoning effort. An explicit `--model` selects a retained
alternative. Astra uses
`--model openai:gpt-6-astra`. An explicit `--auth-file` can select a separate Codex
login; the default is `$CODEX_HOME/auth.json` or `~/.codex/auth.json`. An expired
token requires a fresh `codex login`; the runner does not manage the account.
Keep credentials out of artifacts, repositories and public CI.

Artifacts include the exact request, source fingerprint, received SSE bytes,
terminal provider response and usage, extracted output, and the usual Babel
inspection, normalization, repairs and Replay evidence. Only a provider-confirmed
complete response enters Babel processing. Partial output remains available in
`output.txt` and `response.sse`. Cancellation saves what has arrived. There is no
client-imposed generation time limit.

The subscription endpoint requires streaming and `store: false`; background
polling and the API output-token limit are omitted and recorded as transport
differences. These are subscription development checks, not verification of the
public API request route or proof that the backend behaves identically to the
paid API. No application provider route is changed. The runner works from a
local or private remote checkout with Node 24 and `npm ci`; it does not provision
a remote machine or copy a login there.

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

An optional `realizations` field associates existing syntax nodes with input-token positions. For example, separate `walk` and `-ed` leaves may jointly correspond to the input token `walked`. The model supplies the association; Babel preserves the pieces and checks input coverage without deriving spelling or changing the tree. Ordinary whole-word analyses omit the field. See the [realization contract](docs/research/morphology-realization-audit.md#contract-reuse-check-and-proposed-extension).

Babel validates those stages, replays them, and derives the final forest, surface order, relation render plans, and replay steps. A single-root analysis also has a `tree` convenience field. Several final roots are allowed when their combined pronounced terminals account for the exact input; that structural check does not decide whether the analysis is linguistically convincing. A malformed relation stays attached to its stage as a neutral Replay moment with its original payload and field diagnostic, while intact sibling relations remain drawable. A malformed workspace or incomplete surface coverage still fails the analysis. Relation names and anchor-role names remain open rather than being projected into a fixed ontology.

These outputs are intended for both human reading and downstream inspection workflows.

### 11) Tree Bank

`Tree Bank` is Babel's local save-and-reopen workspace.

The current implementation is the legacy IndexedDB v1 workspace. It is
functional, but the master roadmap replaces whole-bundle saves with immutable
per-analysis durable records and a thin saved-work wrapper.

It includes:

- Save current parse state from the header (`Save to Tree Bank`)
- Reopen saved analyses with their active framework and parse selection
- Store rendered tree snapshot previews for quick browsing
- Delete saved entries directly from the Tree Bank panel
- Keep data local to the current browser/device (IndexedDB-backed)

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
derivational database. Provider tests are a separate empirical program from
default renderer and engine verification.
