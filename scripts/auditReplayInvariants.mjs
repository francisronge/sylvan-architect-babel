// Sweep every Replay invariant and contract warning over committed fixtures and
// saved qualification batches, and write one JSON report.
//
//   node scripts/auditReplayInvariants.mjs [--fixtures] [--archive DIR] [--batch DIR]...
//     [--checkout DIR] [--out FILE] [--examples N] [--sample N] [--fail-on-findings]
//
// With no source option it sweeps the committed fixtures and every batch under
// the default archive, ~/Library/Application Support/Babel/codex-qualification
// (DIR/<batch>/runs/<run>/attempts/<attempt>/bundle.json). `--checkout` prepares
// Replay with another checkout's compiler, such as a pre-fix tree, while the
// checks stay this checkout's. Saved records are read only. The sweep is offline:
// it starts no server, browser or provider request. A batch's records are named
// `<archive>/<batch>/<run>[/<attempt>] a<n>`, and the sweep refuses sources that
// give two analyses one id. It exits 0 after reporting findings, for discovery;
// `--fail-on-findings` exits 1 when any analysis has a finding or an error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ARCHIVE = path.join(os.homedir(), 'Library', 'Application Support', 'Babel', 'codex-qualification');
const { values } = parseArgs({ options: {
  fixtures: { type: 'boolean', default: false },
  archive: { type: 'string', multiple: true, default: [] },
  batch: { type: 'string', multiple: true, default: [] },
  checkout: { type: 'string' },
  out: { type: 'string' },
  examples: { type: 'string', default: '5' },
  sample: { type: 'string', default: '0' },
  'fail-on-findings': { type: 'boolean', default: false }
} });
const fromModule = file => import(pathToFileURL(file).href);
const checkout = path.resolve(values.checkout ?? repoRoot);
const { prepareReplay } = await fromModule(path.join(checkout, 'replay/prepareReplay.ts'));
const invariants = await fromModule(path.join(repoRoot, 'tests/helpers/replayInvariants.mjs'));
const stepInvariants = await fromModule(path.join(repoRoot, 'tests/helpers/replayStepInvariants.mjs'));
const warnings = await fromModule(path.join(repoRoot, 'tests/helpers/replayContractWarnings.mjs'));
const { loadFixtureAnalyses } = await fromModule(path.join(repoRoot, 'tests/helpers/replayInvariantCorpus.mjs'));
const { assertUniqueRecordIds, batchSourceName } = await fromModule(path.join(repoRoot, 'scripts/buildCorpusArchiveManifest.mjs'));

/* Every structural rule replayInvariants.mjs exports takes (replay, record);
 * input-unchanged compares the authored record before and after preparation, and
 * one-letter-per-label's second argument is the letter planner. A step-semantics
 * finding where a construction rule reports the same subject at the same frame
 * is that rule's defect, as in tests/replayInvariants.test.mjs. */
const SPECIAL = new Set(['checkInputUnchanged', 'checkOneLetterPerLabel']);
const structuralChecks = Object.entries(invariants)
  .filter(([name, check]) => typeof check === 'function' && /^check/.test(name) && !SPECIAL.has(name)).map(([, check]) => check);
const CONSTRUCTION = new Set(['no-early-reveal', 'stable-construction', 'attach-at-merge', 'existing-not-remerged']);
const runChecks = (prepared, record, snapshot, contract) => {
  const found = [...invariants.checkInputUnchanged(snapshot, record), ...invariants.checkOneLetterPerLabel(prepared),
    ...structuralChecks.flatMap(check => check(prepared, record))];
  const subject = item => item.detail.split(' ')[0];
  return [...found, ...[...stepInvariants.checkStepSemantics(prepared, record), ...stepInvariants.checkMarkPersistence(prepared, record)]
    .filter(item => item.rule !== 'step-semantics' || !found.some(other => CONSTRUCTION.has(other.rule)
      && other.frame === item.frame && subject(other) === item.subject)),
  ...warnings.checkContractWarnings(prepared, record, { contract })];
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
/** Every analysis of every attempt of one batch, with its run's input contract. */
function batchRecords(batchDirectory) {
  const runs = path.join(batchDirectory, 'runs'), records = [], skipped = [];
  if (!fs.existsSync(runs)) return { records, skipped: [{ id: batchDirectory, reason: 'no runs directory' }] };
  for (const run of fs.readdirSync(runs).sort()) {
    const attempts = path.join(runs, run, 'attempts');
    if (!fs.existsSync(attempts)) continue;
    const spellout = path.join(runs, run, 'spellout.json');
    const contract = fs.existsSync(spellout) ? readJson(spellout).contract : undefined;
    for (const attempt of fs.readdirSync(attempts).sort()) {
      const file = path.join(attempts, attempt, 'bundle.json');
      if (!fs.existsSync(file)) continue;
      const id = `${batchSourceName(batchDirectory)}/${run}${attempt === 'parse' ? '' : `/${attempt}`}`;
      const { request, response } = readJson(file);
      if (!Array.isArray(response?.analyses)) { skipped.push({ id, reason: 'bundle has no analyses' }); continue; }
      const receipt = path.join(attempts, attempt, 'attempt-receipt.json');
      const inputTokens = response.inputTokens ?? (fs.existsSync(receipt) ? readJson(receipt).request?.inputTokens : undefined);
      response.analyses.forEach((analysis, index) => records.push({ id: `${id} a${index + 1}`, contract,
        record: { sentence: request.sentence, ...(inputTokens ? { inputTokens } : {}), derivationStages: analysis.derivationStages } }));
    }
  }
  return { records, skipped };
}

const sourceGiven = values.fixtures || values.archive.length || values.batch.length;
const archives = values.archive.length ? values.archive : sourceGiven ? [] : [DEFAULT_ARCHIVE];
const batches = [...values.batch, ...archives.flatMap(root => fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name)).sort() : [])];
const records = [], skipped = [];
if (values.fixtures || !sourceGiven) {
  const fixtures = loadFixtureAnalyses();
  records.push(...fixtures.records.map(entry => ({ ...entry, id: `fixtures/${entry.id}` })));
  skipped.push(...fixtures.excluded.map(entry => ({ id: `fixtures/${entry.id}`, reason: entry.reason })));
}
for (const batch of batches) { const found = batchRecords(path.resolve(batch)); records.push(...found.records); skipped.push(...found.skipped); }
assertUniqueRecordIds(records);
const sample = Number(values.sample);
const chosen = sample > 0 ? records.filter((_record, index) => index % Math.ceil(records.length / sample) === 0) : records;

const started = Date.now(), examples = Number(values.examples), rules = new Map(), results = [], errors = [];
let frames = 0;
for (const { id, record, contract } of chosen) {
  try {
    const authored = structuredClone(record), snapshot = JSON.stringify(authored);
    const prepared = prepareReplay({ ...authored, includePlayback: true });
    const found = runChecks(prepared, authored, snapshot, contract);
    frames += prepared.playbackSteps.length;
    for (const item of found) {
      const key = item.subtype ? `${item.rule}:${item.subtype}` : item.rule;
      if (!rules.has(key)) rules.set(key, { violations: 0, analyses: new Set(), examples: [] });
      const entry = rules.get(key);
      entry.violations += 1;
      if (!entry.analyses.has(id) && entry.examples.length < examples) entry.examples.push({ id, frame: item.frame, detail: item.detail });
      entry.analyses.add(id);
    }
    if (found.length) results.push({ id, frames: prepared.playbackSteps.length, violations: found });
  } catch (error) {
    errors.push({ id, error: String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ') });
  }
}
const report = {
  checkout, sources: { fixtures: Boolean(values.fixtures || !sourceGiven), batches: batches.map(batch => path.resolve(batch)) },
  analyses: chosen.length, loaded: records.length, frames, durationMs: Date.now() - started, skipped, errors,
  rules: Object.fromEntries([...rules].sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) =>
    [key, { violations: entry.violations, analyses: entry.analyses.size, examples: entry.examples }])),
  records: results
};
if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.analyses} of ${records.length} loaded analyses, ${frames} frames, ${errors.length} errors, ${skipped.length} skipped, ${report.durationMs} ms`);
for (const [key, entry] of Object.entries(report.rules)) console.log(`  ${key}: ${entry.violations} in ${entry.analyses} analyses`);
if (values.out) console.log(`report: ${values.out}`);
if (values['fail-on-findings'] && (results.length || errors.length)) {
  console.log(`--fail-on-findings: ${results.length} analyses with findings, ${errors.length} errors`);
  process.exitCode = 1;
}
