# Sylvan Architect Babel

Sylvan Architect Babel is a syntax tree generator built for research and learning.

It helps you test how large language models reason about syntax under explicit theoretical prompts, while also giving students a clean and practical way to generate, inspect, and compare syntactic trees.

Babel is not a general chatbot. Its core purpose is syntactic analysis and structure visualization.

Babel is generative syntax, implemented as an interactive derivation and structure analysis environment.

## Why Babel exists

Many tree tools either use rigid templates or return black-box output with little transparency.

Babel is designed to make the model's structural decisions inspectable:

- The analysis is generated inside a chosen syntactic framework.
- You get both final structures and derivational metadata.
- You can compare analyses under different theory settings.
- You can inspect ambiguous inputs through multiple parses.

## Who Babel is for

### Researchers

- A structural reasoning benchmark for language models.
- Can large language models construct syntactic derivations that obey formal grammatical constraints?
- Evaluate whether output reflects framework constraints vs shallow pattern matching.
- Run prompt-level comparisons between X-bar and Minimalist settings.
- Inspect movement, derivational order, and structural alternatives.
- Export bracketed notation for external workflows.

### Students

- Generate trees quickly for study and practice.
- Learn how framework choice changes structure.
- Move from final tree reading to derivation-level understanding.
- Use visual + textual explanations together.

## Full feature guide

### 1) Theory mode switch

Babel includes two theory modes:

- `X-Bar Theory`
- `Minimalist Program`

Switching mode changes the analysis behavior and explanatory framing.

### 2) Constituent Glyphing toggle

Babel includes a `Constituent Glyphing` abstraction toggle.

This gives an alternate visual layer for reading structure at a higher level of abstraction, while preserving the underlying parse output.

### 3) Input console (Arboretum Link)

The bottom control panel supports:

- Sentence entry and submission
- Expand/collapse behavior
- Temporary hide/show behavior
- Framework-sensitive placeholder guidance
- In-panel error/status feedback

### 4) Parse execution flow

When you submit a sentence, Babel shows:

- Loading state
- Parse success state (tree + supporting views)
- Parse error state with user-readable messages

### 5) Ambiguity handling (Parse 1 / Parse 2)

If Babel detects clear syntactic ambiguity, it can return two analyses.

You can toggle `Parse 1` and `Parse 2`, and the active parse updates across the entire app state (tree view, growth simulation, catalog, notes).

### 6) Canopy view

`Canopy` is the clean final-tree view.

It is optimized for readability of the resulting structure.

### 7) Growth Simulation view

`Growth Simulation` is the derivation playback environment.

It includes:

- Step-based reveal of structural construction
- Playback controls (`Prev`, `Play/Replay`, `Next`)
- Timeline scrubber with sprout slider
- Operation labels per step
- Feature-checking visibility during derivation steps
- Workspace/derivation-set style state updates
- Movement visualization with arrows
- Trace visibility for derivation inspection

This view is designed to expose process, not just endpoint.

### 8) Catalog view

`Catalog` displays token-level parts-of-speech output from the active parse.

This helps users cross-check lexical categorization against the generated tree.

### 9) Notes view

`Notes` includes:

- Framework-specific explanation text
- Optional interpretation label (useful when ambiguity exists)
- Bracketed notation block
- One-click copy for bracketed notation
- Direct external link support for notation tooling
- Use bracketed notation in traditional tools (for example, MShang) when you want a classic tree workflow outside Babel's renderer.

### 10) Output artifacts

Each parse can include structured outputs such as:

- Tree
- Explanation
- Parts of speech
- Bracketed notation
- Derivation steps
- Movement events

These outputs are intended for both human reading and downstream inspection workflows.

### 11) Tree Bank

`Tree Bank` is Babel's local save-and-reopen workspace.

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
4. Inspect derivational behavior in Growth Simulation.
5. Compare outputs across frameworks and across reruns.
6. Record differences in structure, movement, and explanation.

## Limits and caveats

- Output quality can vary with model behavior and service availability.
- Any single tree should be treated as an analysis proposal, not final theoretical truth.

## Project direction

Babel is being built as an open resource for linguistics and AI interpretability work.

Current direction includes:

- Stronger derivation fidelity
- Better movement grounding
- Better experimental reproducibility
- Better support for classroom and research use
