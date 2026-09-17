// Offline synthetic benchmark. Timings are observations, not a machine-dependent test gate.
import { performance } from 'node:perf_hooks';
import { prepareReplay } from '../replay/prepareReplay.ts';

const counts = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [16, 32, 64];
if (counts.some(count => !Number.isSafeInteger(count) || count < 1)) {
  throw new Error('Provide positive integer stage counts, for example: node scripts/benchmarkReplay.mjs 64 192');
}
const balancedTree = nodes => {
  if (nodes.length === 1) return nodes[0];
  let span = 1;
  while (span * 2 < nodes.length) span *= 2;
  return { id: `p${nodes[0].id}_${nodes.at(-1).id}`, label: 'XP',
    children: [balancedTree(nodes.slice(0, span)), balancedTree(nodes.slice(span))] };
};

for (const direction of ['left', 'right', 'balanced']) {
  for (const count of counts) {
    let tree;
    const stages = [];
    const terminals = [];
    for (let i = 0; i < count; i++) {
      const word = { id: `w${i}`, label: 'N', word: `word${i}`, children: [], tokenIndex: i };
      terminals.push(word);
      tree = direction === 'balanced' ? balancedTree(terminals)
        : tree ? { id: `p${i}`, label: 'XP', children: direction === 'left' ? [tree, word] : [word, tree] } : word;
      stages.push({ statement: `Add ${i}`, stageRecord: 'Synthetic control, no linguistic claim.', workspaceForest: [tree],
        relations: [{ relation: 'Context', anchors: { participant: `w${i}` }, values: { note: `context ${i}` } }] });
    }
    const words = Array.from({ length: count }, (_, i) => `word${i}`);
    const input = { sentence: (direction === 'right' ? words.reverse() : words).join(' '),
      derivationStages: stages, includePlayback: true };
    const milliseconds = [];
    let frames;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      frames = prepareReplay(input).playbackSteps.length;
      milliseconds.push(Math.round(performance.now() - start));
    }
    console.log(JSON.stringify({ node: process.version, direction, stages: count, frames, milliseconds }));
  }
}
