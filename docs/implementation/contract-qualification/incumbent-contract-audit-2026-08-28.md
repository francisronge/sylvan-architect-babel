# Incumbent contract audit

Date: 2026-08-28

> Historical baseline. The eight defects recorded here were addressed in
> [`contract-defect-closeout-2026-08-28.md`](contract-defect-closeout-2026-08-28.md).
> The exact-surface and JSON delimiter-repair policies remain open.

This is the Program 1 audit of Babel's current model-facing interface. It covers
the path from browser request through prompt construction, provider transport,
JSON ingress, normalization, deterministic compilation, Replay handoff,
failures, and generation provenance.

No Babel parse provider was called. No model, prompt, route, recovery policy,
or parser behavior was changed. Fable reviewed this source audit separately
after the provider-free inspection.

## Frozen boundary

The exact audited source is recorded by
[`incumbent-contract.manifest.json`](incumbent-contract.manifest.json). The
manifest is reproducibly generated with:

```sh
node scripts/captureContractFingerprint.mjs
```

Its audited source is bound to repository commit
`f87c4aed81a1b5990df27782b10adb9151fe337b`. The manifest separately hashes
the authored prompt, request boundary, provider boundary, deterministic ingress,
Replay engine, provider-free fixtures, tests, dependency lock, and capture tool.
It records no credentials or local environment values. The capture refuses to
run when an audited source differs from `HEAD`. The audit artifacts themselves
are committed separately from the source commit they describe; the content
digest, rather than a self-referential commit hash, is the reproducible identity.

## Current interface

1. The browser submits a sentence, framework, provider route, and reasoning
   effort to `/api/parse`.
2. The API validates those fields and currently rewrites the sentence through
   `sanitizeSentenceInput`.
3. Babel builds a framework-specific system instruction and a sentence prompt.
4. One of three public routes sends a provider-specific request:
   - Gemini: `responseMimeType: application/json`
   - OpenAI: Responses API with `json_object` output
   - Anthropic: prompt-only JSON instruction
5. Babel records prompt hashes, the exact selected model, sent scalar settings,
   timing, attempts, finish state, and token counts on successful generations.
6. Babel parses the response as JSON. The strict parser may repair delimiter
   damage. The Gemini route may additionally invoke a model-based payload
   transcriber.
7. The normalizer enforces the exact envelope and four-field stage contract,
   expands immediate-prior references, derives a final tree, and classifies
   failures.
8. Replay and relation rendering are derived downstream from the normalized
   stages.

The active source defaults are Gemini `gemini-3.1-pro-preview`, OpenAI
`gpt-5.5`, Anthropic `claude-opus-4-8`, and the non-public local helper
`gemma3:4b`. These are incumbent facts, not the proposed catalog.

## Confirmed defects

### 1. The API silently changes the sentence

`server/parseApi.js` removes repeated backticks, strips strings such as
`[INST]`, removes line-leading speaker labels such as `User:`, collapses all
whitespace, and then treats the result as the submitted sentence.

That contradicts the model-facing instruction to analyze the exact input as
written. It can also change legitimate linguistic data. A provider-free probe
confirmed:

- `User: saw whom?` becomes `saw whom?`
- a repeated-backtick token is deleted
- a line break becomes a space

This is an identity defect. Babel may reject unsupported input or delimit it
safely, but it must not silently analyze a different string.

### 2. An earlier tree can replace a nonconverged final stage

`findLatestCommittedDerivationFrame` searches backward through every stage and
selects the latest stage containing a root whose terminals match the input. It
does not require that stage to be the final authored stage.

A provider-free probe appended a fifth, final stage containing separate NP and
VP workspaces after a valid completed TP. Babel accepted all five stages but
returned the fourth-stage TP as the final tree. The result therefore says both:

- the final authored state is nonconverged; and
- the returned final tree is an earlier converged state.

This contradicts the prompt's rule that the last stage is the converged
structure and breaks agreement between the saved stages, final tree, and Replay.

### 3. The raw-output transcriber can alter relation values

When raw provider text cannot be parsed, no authoritative JSON object exists for
an exact before/after comparison. The current fallback gate protects selected
string keys (`id`, `refId`, `lineageId`, `word`, `relation`, and
`label`) and three prose fields (`statement`, `stageRecord`, and
`relation`).

It does not bind arbitrary open-ontology role names or `values` literals. A
provider-free probe changed a relation outcome from `blocked` to `licensed`;
both current gates returned `ok: true`.

The blind spot is broader:

- the gates compare sets, so duplicate counts are not preserved;
- the structural check rejects additions but permits deletions;
- array-valued anchors are not collected;
- anchor role names are not bound to their values, so role swaps can pass.

This makes the transcriber capable of changing authored linguistic content while
being reported as successful transport recovery. The parsed-payload path is
safer because it requires an exact fingerprint, except for its explicit
stage-field relocation rule.

### 4. Stage Record validation assumes whitespace-delimited prose

A Stage Record is accepted only when it has at least 24 characters and at least
four whitespace-separated words. The authored contract requires substantive
reader-facing prose but does not require English or whitespace-delimited
language.

A detailed Japanese Stage Record was rejected solely because it counted as one
whitespace-delimited word. The heuristic therefore creates false contract
failures for valid writing systems.

There is a second error-reporting defect around this path. Invalid stages are
filtered before later `refId` expansion. If a later stage refers to a filtered
stage, reference expansion can throw a generic malformed-workspace error before
the recorded precise validation issue is reported.

### 5. Non-length completed stop states are not classified

`assertGenerationComplete` recognizes output-limit stops only. Other completed
provider stop states pass through as if they were ordinary completed text.

A provider-free probe with Anthropic-style `REFUSAL` status was accepted by
that guard and passed to the JSON parser as ordinary output. This would turn a
provider refusal into a misleading malformed-JSON or contract error. The same
gap applies to other non-length incomplete OpenAI stop reasons.

This must be resolved before qualifying models that expose refusal as a normal
HTTP 200 response.

### 6. Failed generations lose the successful-generation receipt

Babel constructs a `generationRecord` after a provider returns. It attaches
that record to successful parse bundles. If JSON parsing or normalization then
fails, the thrown API error does not carry the complete generation record.

The exact prompt hashes, sent settings, run ID, attempts, and complete token
receipt can therefore be absent from the failure artifact. Program 1 needs
successes and failures to be comparable under the same provenance standard.

The routes are also asymmetric. OpenAI and Anthropic attach a capped raw-output
artifact to every normalization failure. Gemini does so for `BAD_MODEL_RESPONSE`
paths, but a `GENERATION_DID_NOT_CONVERGE` normalization failure is rethrown
without the raw bytes or the route's usual stage/model/finish diagnostics.

### 7. One Gemini timeout setting affects every hosted provider

`resolveModelTimeoutMs` applies `GEMINI_ROUTE_TIMEOUT_MS` to every non-local
route when that variable is set. A Gemini-specific override can therefore
silently alter OpenAI and Anthropic timeouts.

This is a configuration ownership defect. Shared and provider-specific settings
need distinct names and behavior.

### 8. The transcriber integrity flag names the wrong model

Every successful transcription adds `payload_transcribed_by_flash_lite` even
though the configured transcriber defaults to the primary Gemini model and may
be changed through configuration. Separate provenance records the actual model,
so the evidence is recoverable, but the integrity label itself is false.

## Unfinished boundaries, not current defects

### Provider and model are one UI choice

The current public API and UI expose `gemini`, `gpt`, and `claude` as
routes, with one environment-selected model behind each. They cannot represent
multiple models from one provider or express per-model capability differences.
That is the known catalog work to discuss next; this audit does not choose its
replacement.

### The local helper is not a public route

A local-model parser exists, but the public request validator and browser types
do not allow `local`. Its returned `requestedModelRoute: local` also falls
outside the current `ParseBundle` type. This is dormant legacy surface, not an
active public capability.

### The durable record layer is not connected

The live parser emits `generationRecord` schema version 2. The
`derivationalDatabase/` package defines a richer
`babel-durable-generation-evidence-v1` schema. No adapter currently converts
the live receipt into that durable evidence record.

The durable package explicitly describes itself as persistence-free and not
product-integrated, so this is accurately unfinished Program 4 work rather than
a regression in the current parser.

## Decisions that remain open

These behaviors exist today but should not be silently preserved or removed by
the audit:

1. **Exact surface enforcement.** Babel currently rejects an analysis when no
   authored tree has overt terminals matching the input. Francis has not yet
   accepted this as the final product policy.
2. **Delimiter repair.** The strict JSON parser can add or discard closing
   delimiters and records `json_delimiter_damage_repaired`.
3. **Payload transcriber.** The Gemini route can run a second model after JSON or
   normalization failure. Whether it survives at all depends on observed
   failures; any surviving role must be transport-only and provably
   content-preserving.
4. **Stage-field relocation.** A parsed payload may move leaked
   `statement`, `stageRecord`, or `relations` fields into one inferred
   stage. This is a compatibility repair, not pure JSON transport repair.
5. **Failure bytes in the client.** Production errors can return a capped,
   base64-encoded raw provider output to the browser. That supports research
   inspection but needs an explicit public/research-surface policy.
6. **Ambiguity envelope.** Babel currently accepts every analysis in an
   `analyses` array without deduplicating or ranking it. The shape is tested;
   its provider behavior is not yet qualified.

## What is already strong

- The top-level envelope and derivation-stage fields are exact.
- Relation names, role names, and literal values remain open ontology.
- Immediate-prior references are expanded deterministically.
- Provider request builders have provider-free wire-shape tests.
- Successful runs preserve the exact selected model and prompt hashes.
- Retries are bounded to transport, rate-limit, and server failures.
- Raw failure output is byte-capped and SHA-256-bound.
- The six failure classes and many exact rule paths have provider-free tests.
- Parser and Replay tokenization agree across several scripts, symbols, emoji,
  and private-use characters.
- The deterministic renderer remains downstream of the authored contract.

## Evidence still missing

The current suite has no permanent test for:

- byte-identity of the submitted sentence through request validation;
- rejection of a nonconverged final stage after an earlier completed stage;
- preservation of open relation roles and `values` during raw transcription;
- preservation of array anchors, structural counts, and structural deletions
  during raw transcription;
- substantive Stage Records in non-space-delimited languages;
- refusal and non-length incomplete stop states;
- a complete generation receipt on post-generation failure;
- provider-specific timeout ownership.

The committed provider-free parse set contains only two English examples. No
current frontier-model output has yet been run through this frozen boundary.

## Audit conclusion

The renderer can remain closed. The incumbent model interface is now
fingerprinted, but it should not be called frozen or provider-qualified yet.
The exact-input, final-stage, transcriber-integrity, Stage Record, stop-state,
failure-provenance, timeout, and provenance-label findings need resolution or
explicit disposition first.

Fable independently confirmed all eight findings and the decision/defect split.
Its full review is preserved in
[`fable-review-2026-08-28.md`](fable-review-2026-08-28.md).

After that, Francis and the implementation agent can define the new research
model catalog and decide the open policies above before making paid provider
calls.
