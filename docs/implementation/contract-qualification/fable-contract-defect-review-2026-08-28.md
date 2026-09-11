# Fable review: contract defect closeout

Date: 2026-08-28

Fable reviewed the complete working-tree diff after the eight incumbent-contract
fixes. The review was read-only and used no provider parse calls.

## Findings and resolutions

1. Unexpected normalization exceptions were being presented as model contract
   failures and could expose an internal exception message. They now become a
   generic `PARSE_ENGINE_FAILED` with the deterministic-engine failure class;
   typed model failures retain their original code and message.
2. Generation attempt messages could enter the production generation receipt.
   The HTTP boundary now projects an allowlisted public attempt receipt and
   omits provider or internal exception text.
3. The split-final closeout wording was broader than the implementation. The
   closeout and tests now distinguish token-matching nonconvergence from the
   existing surface-mismatch result.
4. The legacy Gemini timeout had only negative non-leakage coverage. A positive
   test now proves that it still applies to Gemini when the newer route-specific
   override is absent.
5. Failure receipts had helper coverage but no route-level proof. Provider-free
   route tests now cover a terminal provider failure and a post-generation
   deterministic normalization failure.
6. Legacy Tree Bank data could retain the false Flash-Lite integrity marker
   while losing truthful transcriber identity. Loading now removes only that
   false marker and preserves accurate historical model and token-count fields;
   current parses never write transcriber provenance.
7. The Stage Record correction initially made every recorded stage validation
   issue fail early. Early failure is now limited to the missing Stage Record;
   other stage validation keeps its previous timing.

Fable also confirmed the original exact-input, final-stage, transcriber-removal,
language-neutral Stage Record, stop-state, timeout, multiple-analysis, and open-
decision boundaries before raising the findings above.

## Final re-review availability

A second Fable invocation was attempted after the resolutions, but Claude
rejected it before review because the account had reached its session limit.
The corrected state was instead re-reviewed locally and passed the complete
provider-free verification gate.
