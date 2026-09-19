# Benchmark provenance conditions

Babel records the conditions of each model generation in one bundle-level `generationRecord`. The record supports future benchmark joins and reruns; it is not a benchmark runner, score, or claim that provider output is deterministic.

## Schema

```json
{
  "schemaVersion": 2,
  "provider": "gemini | gpt | claude | local",
  "promptContract": {
    "framework": "xbar | minimalism",
    "promptRoute": "gemini | gpt | claude",
    "systemInstructionSha256": "64 lowercase hex characters",
    "promptSha256": "64 lowercase hex characters",
    "promptTemplateSha256": "64 lowercase hex characters"
  },
  "sentGenerationConfig": {
    "model": "provider model identifier"
  },
  "timing": {
    "requestStartedAt": "ISO 8601 timestamp",
    "durationMs": 0
  },
  "outcome": {
    "sentMaxOutputTokens": 0,
    "finishReason": "provider finish reason",
    "finishStatus": "provider completion status",
    "runId": "generation run identifier",
    "attempts": []
  }
}
```

`systemInstructionSha256` and `promptSha256` identify the exact strings sent for that request without storing their contents. `promptTemplateSha256` identifies the framework, route, input-tokenization version and prompt template using a fixed probe sentence. It remains stable across sentences. The local route records its own prompt route.

The product bundle also carries `inputTokens`, the exact ordered token list sent
to the model. Normalization, Replay and saved snapshots preserve these addresses
instead of segmenting the sentence again. This is request metadata, not a new
model-authored stage field or a prescribed morphological analysis. The
`unicode-word-v2` tokenizer removes the former Latin apostrophe-s split. Native
Unicode word segmentation remains a source of input addresses, not syntactic
constituents; realization groups may associate several tokens with one node or
several nodes with one token.

Older saved bundles without `inputTokens` use the legacy segmentation path,
including its apostrophe-s split. They are not rewritten on load. Since those
records never stored the original list, native segmentation differences across
future ICU versions cannot be reconstructed with certainty. Saved-output
qualification accepts an explicit original token list when it is available.

`sentGenerationConfig` is derived from the same pure request-body builder used by the transport. It records resolved provider-shaped scalar settings, including the model and output limit. Gemini and local requests record temperature. GPT and Claude records intentionally omit temperature because their current request bodies do not send it. No API key, header, secret, environment-variable name, raw instruction, or raw prompt belongs in this object.

Timing covers the primary provider generation await only. It excludes JSON parsing, normalization, rendering, and client latency.

Tree Bank snapshots preserve `generationRecord` at bundle level because one provider request produces every ambiguity analysis in that bundle. Existing per-analysis provenance and token accounting retain their current meanings.

## Reproducibility boundary

A conditions-identical rerun requires the same input sentence, framework, provider/model identifier, prompt hashes, sent generation config, and relevant runtime version identifiers. Matching those conditions does not promise byte-identical output: current provider APIs expose no stable seed, may update a model behind an identifier, and include network and service variance.

Volatile values such as request timestamps, duration, per-analysis timestamps, and optional environment-supplied parser/UI versions should not be used for snapshot equality. Bundles without `generationRecord` are pre-schema artifacts; their missing conditions cannot be reconstructed reliably.

## Deferred to the benchmark architecture

This contract deliberately leaves out:

- benchmark suite and dataset selection;
- correctness criteria, scoring, and adjudication;
- runner orchestration and raw provider-payload archival;
- repeated-run variance, statistics, and cost policy;
- seed or provider system-fingerprint capture if APIs later expose them.
