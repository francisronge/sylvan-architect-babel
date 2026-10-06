# Renderer startup case

`german-embedded.json` preserves the six authored stages and input tokens from
the German Codex OAuth startup-confirmation request of 3 October 2026. The raw
response SHA-256 is `bb2df1a8c5fef555bb17a11784656664e4ec90eb692f5bdbfca97b385c6a4a56`.
The model was GPT-6.1 Sol with high reasoning effort. This case exercises 74 Replay
frames, multiple workspaces, scrambling, head movement, plaques and native fonts.
It previously exceeded the two-second local opening target.

The PR check renders this same record through the production React/D3 components
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
