# Deterministic invention boundary

`derivationStages` is the only authored linguistic source. The compiler may:

- expand an exact prior-stage `refId`;
- clone authored nodes without changing their linguistic scalar fields;
- validate surface order and derive `tokenIndex` / `surfaceSpan` alignment;
- resolve authored `relations` anchors without inventing relation labels.

It must reject malformed or incomplete authored evidence instead of:

- generating node IDs, null exponents, traces, movement shells, or duplicate-root repairs;
- promoting a structural category label into an overt word;
- stripping authored movement indices;
- inferring movement from prose, role names, lineage, labels, or ID stems;
- inventing derivation operations such as `Checkpoint`, `StateChange`, or `SpellOut`.

Replay is a declared presentation transform. It may expand an authored
`{ label, word }` terminal into a stable display node. Exact authored IDs are
reserved before generated IDs are allocated; `replayOrigin` identifies each
display node's authored owner. ID spelling never establishes that ownership.
The generic operations and display-origin kinds are listed by
`DECLARED_PRESENTATION_TRANSFORMS` in
`server/babelParser/inventionDetector.js`. It may not create linguistic nulls,
traces, shells, dependency labels, or movement operations.

Open `relations` role names and relation labels remain literal authored
data. After exact registry dispatch fails, the renderer may recognize only
declared generic visual facets from the curated Tier-2 synonym catalog over
authored role names and values, resolved anchors, stage structure, lineage, and
authored silence. It must not infer missing anchors, syntax, relation identity,
or theoretical claims from prose, labels, node-id stems, or an unknown
construction name.

`tests/inventionDetector.test.mjs` is the permanent provider-free enforcement
surface. It checks compiled trees, expanded stages, resolved relations, replay
plans, and full Replay playback against the authored node and relation inventory.
Full playback supplies display provenance that compact snapshots omit.

Committed replay-snapshot parity currently covers projected step order,
operations, node ids, and visibility, but its projection does not serialize
`replayRelationLinks`. Relation-link completeness therefore has a separate
tracked dual: every replay-plan relation with at least one exactly resolved
authored anchor must appear in the renderer link evidence, with every resolved
anchor and literal role preserved in authored order. Two anchors permit a drawn
link using positional authored order only; shared authored lineage may supply an
identity key, never endpoint pairing or direction.
