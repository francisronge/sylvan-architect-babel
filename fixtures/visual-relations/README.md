# Visual relation fixtures

Saved analyses consumed by the plaque and head-movement tests. Each file carries its own `source`
and `description`.

- `shared-plaque.json`: GPT 5.6 Sol's X-bar analysis of “Ali kitabı okudu.” `tests/plaquePlacement.test.mjs` uses it to check three things. Earlier grids leave room for the later shared plaque and Orchard D6 feature curves. Case arrows stay short. Plaque offsets stay stable through head movement on desktop and mobile.
- `case-collection-growth.json`: GPT-6 Astra's X-bar analysis of the same sentence, used for collection clearance.
- `stable-complex-head-plaques.json`: GPT 5.6 Sol's X-bar analysis of “太郎が本を読んだ。”, used to keep plaques clear of connector curves through complex head movement.
- `successive-head-movement.json`: GPT-6 Astra's German coordination analysis. It is used for successive head landings and plaque layout jobs.

These records are immutable characterization evidence. New browser captures belong outside the
worktree until a focused test needs a compact committed subset.
