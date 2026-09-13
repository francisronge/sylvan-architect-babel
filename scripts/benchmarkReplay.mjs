// Offline synthetic benchmark. Timings are observations, not a machine-dependent test gate.
import { performance } from 'node:perf_hooks';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

for (const direction of ['left', 'right']) {
  for (const count of [16, 32, 64]) {
    let tree;
    const stages = [];
    for (let i = 0; i < count; i++) {
      const word = { id: `w${i}`, label: 'N', word: `word${i}`, children: [], tokenIndex: i };
      tree = tree ? { id: `p${i}`, label: 'XP', children: direction === 'left' ? [tree, word] : [word, tree] } : word;
      stages.push({ statement: `Add ${i}`, stageRecord: 'Synthetic control, no linguistic claim.', workspaceForest: [tree],
        relations: [{ relation: 'Context', anchors: { participant: `w${i}` }, values: { note: `context ${i}` } }] });
    }
    const words = Array.from({ length: count }, (_, i) => `word${i}`);
    const bundle = { sentence: (direction === 'left' ? words : words.reverse()).join(' '), analyses: [{ derivationStages: stages }] };
    const milliseconds = [];
    let frames;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      frames = buildReplayPlayback(bundle).steps.length;
      milliseconds.push(Math.round(performance.now() - start));
    }
    console.log(JSON.stringify({ node: process.version, direction, stages: count, frames, milliseconds }));
  }
}
