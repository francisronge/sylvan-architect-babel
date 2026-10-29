#!/usr/bin/env node
// A review sheet for a live Jev run: every reading that stands, with what Babel would draw, to judge by hand.
//
//   node scripts/reviewJev.mjs --cases cases.json --run DIR --out sheet.md [--threshold 0.7]
//
// DIR is the output of `scripts/runJev.mjs --run`. For each analysis the saved record is
// applied with every mapping at or above --threshold (default JEV_CONFIDENCE_THRESHOLD)
// treated as applied. Each reading that stands is listed with the sentence, the claim's
// keys and the nodes they name, its values, Jev's family, reading and confidence, and every
// Tier-2 mark Babel draws for it with the nodes it is drawn on. Readings that reach the
// threshold but do not stand are listed after, with Jev's answer.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { neutralJevClaims } from '../replay/jevClaims.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { projectRelationStages } from '../replay/relationStages.ts';
import { JEV_CONFIDENCE_THRESHOLD, JEV_NONE } from '../replay/relations/jev.ts';
import { dispatchRelationStagesForPlan } from '../replay/relations/renderPlanCompiler.ts';

const { values: args } = parseArgs({ options: {
  cases: { type: 'string' }, run: { type: 'string' }, out: { type: 'string' },
  threshold: { type: 'string', default: String(JEV_CONFIDENCE_THRESHOLD) }
} });
if (!args.cases || !args.run || !args.out) throw new Error('Use --cases FILE --run DIR --out sheet.md.');
const threshold = Number(args.threshold);
const cases = JSON.parse(fs.readFileSync(args.cases, 'utf8'));

const nodeIndex = forest => {
  const nodes = new Map();
  const visit = node => { if (!node || typeof node !== 'object') return; if (node.id) nodes.set(node.id, node); (node.children ?? []).forEach(visit); };
  (forest ?? []).forEach(visit);
  return nodes;
};
const nodeText = (nodes, id) => {
  const node = nodes.get(id);
  return node ? `${node.label ?? '?'}${node.word ? ` "${node.word}"` : ''} [${id}]` : `[${id}]`;
};
// The nodes a mark is drawn on, by field: `operatorNodeId` reads as `operator`. Witness lists and
// fields the item derives from a whole subtree (`subtreeDerived`) are left out.
const markEndpoints = (item, nodes) => {
  const skipped = new Set(['priorWitnessNodeIds', 'tier2WitnessNodeIds', 'subtreeDerived', ...(item.subtreeDerived ?? []).map(entry => entry.field)]);
  const parts = [];
  const walk = (value, field, owner) => {
    if (skipped.has(field)) return;
    if (/NodeIds?$/u.test(field ?? '') || field === 'nodeId') {
      const name = field === 'nodeId' ? owner : field.replace(/NodeIds?$/u, '');
      list(value).forEach(id => typeof id === 'string' && parts.push(`${name}: ${nodeText(nodes, id)}`));
    } else if (Array.isArray(value)) value.forEach(entry => walk(entry, undefined, field ?? owner));
    else if (value && typeof value === 'object' && field !== 'relationRef')
      for (const [inner, entry] of Object.entries(value)) walk(entry, inner, field ?? owner);
  };
  for (const [field, value] of Object.entries(item)) walk(value, field, field);
  return [...new Set(parts)];
};
const list = value => (Array.isArray(value) ? value : [value]);
const reading = answer => [...Object.entries(answer.roles), ...Object.entries(answer.values)].map(([key, slot]) => `${key} → ${slot}`).join('; ');

const standing = [], unstanding = [];
cases.forEach((entry, index) => {
  const file = path.join(args.run, String(index).padStart(4, '0'), 'jev.json');
  if (!fs.existsSync(file)) return;
  const bundle = JSON.parse(fs.readFileSync(entry.source, 'utf8')).response;
  const { derivationStages } = bundle.analyses[entry.analysis];
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Mappings at or above the review threshold are applied as if fully confident.
  const reached = saved.mappings.filter(mapping => mapping.answer.family !== JEV_NONE && mapping.confidence >= threshold);
  if (!reached.length) return;
  const jev = { ...saved, mappings: reached.map(mapping => ({ ...mapping, confidence: 1 })) };
  const stages = projectRelationStages(derivationStages);
  const { dispatches } = dispatchRelationStagesForPlan(stages, { jev });
  const plan = prepareReplay({ derivationStages, sentence: bundle.sentence, inputTokens: bundle.inputTokens, includePlayback: false, jev }).relationRenderPlan;
  const claims = neutralJevClaims(derivationStages);
  for (const mapping of reached) {
    const { stageIndex, relationIndex } = mapping;
    const relation = stages[stageIndex].relations[relationIndex];
    const nodes = nodeIndex(stages[stageIndex].workspaceForest);
    const row = { key: entry.key ?? `${entry.source}#${entry.analysis}`, sentence: bundle.sentence,
      id: claims.find(claim => claim.stageIndex === stageIndex && claim.relationIndex === relationIndex)?.id,
      relation: relation.relation, confidence: mapping.confidence, answer: mapping.answer,
      keys: Object.entries(relation.anchors ?? {}).map(([key, ids]) => `${key}: ${list(ids).map(id => nodeText(nodes, id)).join(', ')}`),
      values: relation.values ?? {} };
    if (!dispatches[stageIndex]?.[relationIndex]?.jev) { unstanding.push(row); continue; }
    const items = (plan?.frames ?? []).flatMap(frame => frame?.items ?? []).filter(item => item.claimTier === 2
      && item.relationRef?.stageIndex === stageIndex && item.relationRef?.relationIndex === relationIndex);
    const marks = [...new Map(items.map(item => {
      const text = `${(item.tier2OutputPieces ?? []).join(', ')} (${item.kind}): ${markEndpoints(item, nodes).join('; ') || 'no node'}`;
      return [text, text];
    })).values()];
    standing.push({ ...row, marks });
  }
});

const section = row => [
  `### ${row.key} ${row.id}: ${row.relation}`, '',
  `- Sentence: ${row.sentence}`,
  `- Keys: ${row.keys.join(' | ') || 'none'}`,
  `- Values: ${JSON.stringify(row.values)}`,
  `- Jev: **${row.answer.family}**, ${reading(row.answer)} (confidence ${row.confidence.toFixed(2)})`,
  ...(row.marks ? [`- Babel draws:`, ...row.marks.map(mark => `  - ${mark}`), '- [ ] the picture is right', ''] : [''])
].join('\n');

const sheet = [`# Jev review sheet`, '',
  `Run: ${args.run}. Threshold ${threshold}. ${standing.length} readings stand; ${unstanding.length} more reach the threshold and are refused by Babel's checks.`, '',
  `## Readings that stand`, '', ...standing.map(section),
  `## Reaching the threshold but refused by Babel's checks`, '', ...unstanding.map(section)].join('\n');
fs.writeFileSync(args.out, sheet, { flag: 'wx' });
console.log(`${standing.length} standing, ${unstanding.length} refused; written to ${args.out}`);
