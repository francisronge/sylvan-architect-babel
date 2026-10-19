# Renderer startup case

`german-embedded.json` preserves the six authored stages and input tokens from
the German Codex OAuth startup-confirmation request of 3 October 2026. The raw
response SHA-256 is `bb2df1a8c5fef555bb17a11784656664e4ec90eb692f5bdbfca97b385c6a4a56`.
The model was GPT-6.1 Sol with high reasoning effort. This case exercises 74 Replay
frames, multiple workspaces, scrambling, head movement, plaques and native fonts.
It previously exceeded the two-second local opening target.

The PR check renders only this record through the production React/D3 components
and workers in Chromium. It compares the base and candidate on the same runner,
alternating five fresh browser contexts per version after one discarded warm-up
each. Time starts at navigation and ends after fonts, the first Replay frame and
its fitted camera are ready for two animation frames. The check also waits for
complete finite layout output and verifies that the final Replay frame renders.
For the older base renderer, which returns only plaque schedules from its worker,
the check validates all six completed stages and the final Replay instead;
candidate builds must also supply finite layout coordinates.

The check fails if the candidate median grows by more than both 10% and 100 ms.
A sample spread above 25% fails as inconclusive runner noise, not a product
regression. It never retries or updates its baseline automatically. The 2,000 ms
target remains the local reference-device target; hosted CI hardware is not
calibrated to that Mac. Both absolute timings and the relative decision appear
in the CI summary. A passing relative comparison is not a universal two-second
latency guarantee.

Run `npm run verify:renderer-performance -- --baseline-root /path/to/base-checkout`.
Both checkouts need their own locked dependencies installed. `--self-check` uses
the current source for both sides to validate the measurement setup locally.
The command saves one small JSON report, normally in the OS temporary directory,
and no screenshots, recordings or traces. No model requests are made.

Do not weaken the fixture, thresholds or measurement to make a slowed PR pass.
Inspect the timing report and fix the responsible change. Intentional changes to
this guard require explicit review, like changes to other release requirements.
Configure the `Renderer performance` status check as required in branch
protection to enforce it at merge time. Adding the workflow alone does not alter
GitHub repository settings.

## Long-sentence preparation cases

`portuguese-coordination.json`, `french-relative.json` and `turkish-embedded.json`
are the three slowest analyses of the 19 October 2026 long-sentence batch (night4,
GPT-6.1 Sol with high reasoning effort, character spell-out contract). Each file
records its source run and the run's shared word list; the table gives the SHA-256
of each run's `attempts/parse/raw-output.txt` (the model's raw response text). Replay
preparation of the Portuguese case is dominated by stage coordinate reservations;
the French and Turkish cases by the plaque schedule. They are ordinary committed
fixtures for offline preparation timing and the fixture sweeps. The renderer
performance gate reads `german-embedded.json` by name, so these cases change
neither its fixture nor its budget.

| File | Run and analysis | `raw-output.txt` SHA-256 |
|---|---|---|
| `portuguese-coordination.json` | `16-pt-long-coordination`, analysis 1 | `8a1a169c04d98c49cb698871596f9a6ed28ee67f77c66402ded291d56dac1920` |
| `french-relative.json` | `13-fr-long-relative`, analysis 1 | `363bc4b063be985e5134ac28743a32e5b0f96c8e0e0a502b0c8e148d689f4dd2` |
| `turkish-embedded.json` | `26-tr-long-embedded`, analysis 2 | `ae139c5c41ecffef53314707008084597ed5ee65175249ec59b327ff93435caa` |
