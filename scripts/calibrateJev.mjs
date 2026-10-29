#!/usr/bin/env node
// Calibrates JEV_CONFIDENCE_THRESHOLD (replay/relations/jev.ts) on a live Jev run.
//
//   node scripts/calibrateJev.mjs --cases cases.json --run DIR [--reference readings.json] [--out report.json]
//
// DIR is the output of `scripts/runJev.mjs --run` over the same cases. For each
// threshold from 0.50 to 1.00 it reapplies every saved record and counts the
// readings that reach it and the readings that stand (Babel's checks draw the
// family Jev named). --reference lists reviewed readings as
// [{ "key": "<case key>", "id": "s2r1", "relation": "...", "answer": { family, roles, values } }];
// a standing reading at the same claim with another answer is a disagreement.
// The suggested threshold is the lowest with no disagreement. Readings that stand
// with no reference are listed for review before a threshold is adopted.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { neutralJevClaims } from '../replay/jevClaims.ts';
import { projectRelationStages } from '../replay/relationStages.ts';
import { dispatchRelationStagesForPlan } from '../replay/relations/renderPlanCompiler.ts';

const { values: args } = parseArgs({ options: {
  cases: { type: 'string' }, run: { type: 'string' }, reference: { type: 'string' }, out: { type: 'string' }
} });
if (!args.cases || !args.run) throw new Error('Use --cases FILE --run DIR.');
const cases = JSON.parse(fs.readFileSync(args.cases, 'utf8'));
const reference = new Map((args.reference ? JSON.parse(fs.readFileSync(args.reference, 'utf8')) : [])
  .map(entry => [`${entry.key} ${entry.id}`, entry]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const THRESHOLDS = Array.from({ length: 11 }, (_unused, index) => Math.round((0.5 + index * 0.05) * 100) / 100);

const analyses = cases.flatMap((entry, index) => {
  const file = path.join(args.run, String(index).padStart(4, '0'), 'jev.json');
  if (!fs.existsSync(file)) return [];
  const stages = JSON.parse(fs.readFileSync(entry.source, 'utf8')).response.analyses[entry.analysis].derivationStages;
  return [{ key: entry.key ?? `${entry.source}#${entry.analysis}`, stages: projectRelationStages(stages),
    claims: neutralJevClaims(stages), jev: JSON.parse(fs.readFileSync(file, 'utf8')) }];
});

const sweep = THRESHOLDS.map(threshold => {
  const row = { threshold, reached: 0, standing: 0, agreeing: 0, disagreeing: [], unreviewed: [] };
  for (const { key, stages, claims, jev } of analyses) {
    const { dispatches } = dispatchRelationStagesForPlan(stages, { jev, jevThreshold: threshold });
    for (const mapping of jev.mappings) {
      if (mapping.answer.family === 'none' || !(mapping.confidence >= threshold)) continue;
      row.reached += 1;
      if (!dispatches[mapping.stageIndex]?.[mapping.relationIndex]?.jev) continue;
      row.standing += 1;
      const id = claims.find(claim => claim.stageIndex === mapping.stageIndex && claim.relationIndex === mapping.relationIndex)?.id;
      const expected = reference.get(`${key} ${id}`);
      const reading = { key, id, relation: mapping.terms.relation, confidence: mapping.confidence, answer: mapping.answer };
      if (!expected) row.unreviewed.push(reading);
      else if (same(expected.answer, mapping.answer)) row.agreeing += 1;
      else row.disagreeing.push({ ...reading, reference: expected.answer });
    }
  }
  return row;
});

const suggested = sweep.find(row => !row.disagreeing.length)?.threshold ?? null;
const report = { analyses: analyses.length, referenceReadings: reference.size, suggested, sweep };
if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 1), { flag: 'wx' });
for (const row of sweep) console.log(`${row.threshold.toFixed(2)}  reached ${row.reached}  standing ${row.standing}  agree ${row.agreeing}  disagree ${row.disagreeing.length}  unreviewed ${row.unreviewed.length}`);
console.log(`suggested threshold: ${suggested ?? 'none without disagreement'}`);
