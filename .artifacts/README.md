# Babel Harnesses

This folder contains a lot of historical sweep and capture scripts.

Current trusted harnesses before the 100-tree gauntlet:

- `pro_novel5_sweep.cjs`
  Quick Pro-only API warm-up through the live app on `http://127.0.0.1:5177`.
- `capture_flavor_mixed10.cjs`
  Trustworthy UI warm-up covering Canopy, Growth, and Notes on the live app.
- `direct_consistency_world_sweep.cjs`
  Broader direct consistency sweep using `parseSentenceWithGemini`; now self-loads local env.
- `api_consistency_multilang.cjs`
  API-based movement/notes consistency smoke through the live app.
- `random20_dual_showcase.cjs`
  Paired Pro vs Flash Lite showcase capture on the live app.
- `live_consistency_gauntlet.cjs`
  Direct Flash Lite gauntlet helper; now self-loads local env.
- `direct_consistency_gauntlet.cjs`
  Focused direct gauntlet helper; now self-loads local env.
- `novel_gauntlet_20.cjs`
  Direct 20-case gauntlet helper; now self-loads local env.

Current topology:

- Live UI/API harnesses should default to `http://127.0.0.1:5177`
- Direct Gemini harnesses should self-load `.env.local` and call `parseSentenceWithGemini`

Historical, stale, or one-off harnesses have been moved under `quarantine/legacy-harnesses/`.
