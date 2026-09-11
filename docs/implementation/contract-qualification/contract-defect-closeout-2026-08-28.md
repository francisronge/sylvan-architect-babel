# Contract defect closeout

Date: 2026-08-28

This closes the eight defects found in the incumbent Program 1 contract audit.
No parse provider was called. The fixes were tested against committed local
fixtures and reviewed as one source diff before external review.

## Fixed

1. **Exact request input is preserved.** Request validation still rejects a
   blank sentence or one longer than the existing limit, but it no longer
   strips speaker labels, bracketed strings, backticks, whitespace, or line
   breaks before sending the sentence to a provider.
2. **Only the final authored stage can supply the final tree.** Babel no longer
   searches backward for an earlier converged tree when the model's last stage
   remains split. A split final workspace whose combined words match the input
   is reported as nonconvergence; a split workspace whose words also differ
   still reaches the existing surface-mismatch failure. This does not settle
   the separate policy for a single final tree whose words differ from the input.
3. **The model-based payload transcriber is removed.** A second model can no
   longer rewrite malformed JSON or a contract-invalid payload. Its firewall,
   route configuration, provenance fields, and debug labels were removed with
   it. Failures remain attributable to the provider that produced them.
4. **Stage Record validation is language-neutral.** The deterministic boundary
   requires a nonempty string; it no longer assumes English-like word spacing
   or a minimum character count. Exact stage validation errors are reported
   before reference expansion can mask them.
5. **Completed provider stops are explicit.** `STOP`, `COMPLETED`, `END_TURN`,
   and `STOP_SEQUENCE` are accepted. Length stops retain their existing typed
   failure. Refusal, content-filter, unknown, and other non-success stops become
   `GENERATION_COMPLETED_STOP_FAILURE` before JSON parsing.
6. **Failed runs retain the same request receipt as successful runs.** Typed
   errors now carry the generation record, run and attempt evidence, and the
   capped hash-bound raw output after a provider response. The generation
   record survives the HTTP error boundary without exposing unrelated internal
   error details.
7. **Gemini timeout settings are Gemini-only.** OpenAI and Anthropic use the
   shared hosted-provider timeout unless their own routing gains an explicit
   setting later. Legacy `GEMINI_MODEL_TIMEOUT_MS` remains Gemini-only.
8. **The false Flash Lite integrity marker no longer exists.** It disappeared
   from current generations with the transcriber. Tree Bank loading removes the
   false marker from legacy snapshots while retaining any accurate historical
   transcriber model and token-count provenance already stored with the parse.

## Confirmed current behavior

- Multiple analyses are already preserved as separate analyses in one bundle.
  The product presents them as Parse 1, Parse 2, Parse 3, and so on. No new
  storage or presentation rule was needed in this change.
- "Raw provider output" means the exact text returned by the provider,
  especially the text behind a failed parse. This change preserves it as a
  capped, hash-bound failure artifact; it does not decide which future public
  or `/research` screens may display it.

## Still open

1. **Final-tree surface mismatch.** Babel currently rejects a single final tree
   whose overt words do not match the input. This closeout neither endorses nor
   changes that policy.
2. **JSON delimiter repair.** The current repair is broader than safe
   end-of-file closure: it may insert closing delimiters inside a document and
   discard unmatched closing delimiters. Historical architecture work rejected
   that broader rewriting and found no modern evidence requiring it. It remains
   unchanged here so removal or narrowing can be decided explicitly.
3. **Raw-output visibility.** Failure bytes are preserved, but the eventual
   public-versus-research display policy is separate product work.

## Verification

- Focused parser, request, stop-state, receipt, timeout, and contract tests pass.
- The complete `npm test` suite passes.
- Repository typecheck passes.
