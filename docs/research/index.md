---
title: Research Notes
permalink: /research/
---

This section collects short papers and devlogs produced from Babel benchmark batches.

## May 2026

### [Three Frontier Models Under One Babel Prompt](./frontier-provider-wh-question-2026-05/)

Mini research devlog: a one-sentence Babel comparison of Gemini 3.1 Pro, GPT-5.5, and Claude Opus 4.7 on a Minimalist wh-question.

- Date: May 16, 2026
- Assets: [frontier-provider-wh-question-2026-05](./assets/frontier-provider-wh-question-2026-05/)
- Focus: frontier-model syntactic commitment, derivation-stage prose, wh movement, do-support, and cost/time comparison

| Gemini 3.1 Pro | GPT-5.5 | Claude Opus 4.7 |
| --- | --- | --- |
| ![Gemini replay](./assets/frontier-provider-wh-question-2026-05/gemini-replay.gif) | ![GPT replay](./assets/frontier-provider-wh-question-2026-05/gpt-replay.gif) | ![Claude replay](./assets/frontier-provider-wh-question-2026-05/claude-replay.gif) |

## April 2026

### [From Tree-First to Derivation-First](./from-tree-first-to-derivation-first/)

Research Journal v1: why Babel had to be refactored, why derivation-first changed the system, and why smaller models now fall short of full Babel.

- Date: April 10, 2026
- Assets: [derivation-first-refactor-v1](./assets/derivation-first-refactor-v1/)
- Focus: refactor rationale, renderer repair, cost pressure, and smaller-model failure under the stronger Babel standard

| Refactored Gemini Portuguese Growth | Qwen Portuguese Growth |
| --- | --- |
| ![Refactored Portuguese growth](./assets/derivation-first-refactor-v1/pro-pt-replay-final.png) | ![Qwen Portuguese growth](./assets/derivation-first-refactor-v1/qwen-pt-growth.png) |

## March 2026

### [One Hundred Trees, One Hundred Public Syntactic Theories](./one-hundred-trees-under-forced-commitment/)

Research Note v1: the first benchmark of public syntax in frontier language models.

- Date: March 13, 2026
- Data: [gauntlet100-v1-report.json](./data/gauntlet100-v1-report.json)
- Capture script: [gauntlet100_dual.cjs](./data/gauntlet100_dual.cjs)
- Full atlas: [all 100 trees with sentence-by-sentence analysis](./one-hundred-trees-under-forced-commitment/atlas/)

| Gemini 3.1 Pro | Gemini 3.1 Flash Lite |
| --- | --- |
| ![Pro English long-distance wh growth](./assets/gauntlet100-v1/pro-en-longwh-growth.png) | ![Flash Lite English long-distance wh growth](./assets/gauntlet100-v1/flash-en-longwh-growth.png) |

### [Explicit Syntax Under Forced Commitment](./explicit-syntax-benchmark-random20/)

Mini Paper v1: a paired 20-case Babel benchmark of Gemini 3.1 Pro and Gemini 3.1 Flash Lite.

- Date: March 11, 2026
- Data: [random20-v1-report.json](./data/random20-v1-report.json)
- Capture script: [random20_dual_showcase.cjs](./data/random20_dual_showcase.cjs)

| Gemini 3.1 Pro | Gemini 3.1 Flash Lite |
| --- | --- |
| ![Pro English long-distance wh growth](./assets/random20-v1/pro-en-longwh-growth.png) | ![Flash Lite English long-distance wh growth](./assets/random20-v1/flash-en-longwh-growth.png) |
