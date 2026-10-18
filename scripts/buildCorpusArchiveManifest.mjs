// Build a corpus archive manifest that names every committed fixture analysis and,
// optionally, every analysis of saved qualification runs, for
// `npm run verify:corpus -- --archive-manifest <file>`. Records name a source file
// and a JSON pointer; the comparator itself resolves sentences and tokens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ROOT = path.join(repoRoot, 'fixtures');
// Pre-normalization payloads reference repeated syntax by refId; Replay prepares
// normalized analyses, which fixtures/normalized/ holds for these sources.
const EXCLUDED_FIXTURE_PREFIXES = ['raw/'];

const pointer = keys => keys.length ? `/${keys.map(key => String(key).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` : '';
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? files(file) : file.endsWith('.json') ? [file] : [];
}).sort();
const savedSentence = item => [item?.sentence, item?.request?.sentence, item?.input?.sentence, item?.response?.sentence]
  .find(sentence => typeof sentence === 'string' && sentence.trim());

/** Every analysis with derivationStages under fixtures/, with the nearest ancestor
 * that carries its sentence as context. Analyses without a saved sentence are
 * reported, never given an invented one. */
export function fixtureRecords(root = FIXTURE_ROOT) {
  const records = [], skipped = [];
  for (const file of files(root)) {
    const source = path.relative(root, file).split(path.sep).join('/');
    if (EXCLUDED_FIXTURE_PREFIXES.some(prefix => source.startsWith(prefix))) continue;
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    const visit = (value, keys, ancestors) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, [...keys, index], ancestors)); return; }
      const here = { value, keys };
      if (!Array.isArray(value.derivationStages)) {
        for (const [key, child] of Object.entries(value)) visit(child, [...keys, key], [here, ...ancestors]);
        return;
      }
      const id = `fixture:${source}#${pointer(keys)}`;
      const context = [here, ...ancestors].find(item => savedSentence(item.value));
      if (!context) { skipped.push({ id, reason: 'no saved sentence' }); return; }
      records.push({ id, source: file, selector: pointer(keys),
        ...(context !== here ? { contextSelector: pointer(context.keys) } : {}) });
    };
    visit(document, [], []);
  }
  return { records, skipped };
}

/** Every analysis in each run's attempts/<attempt>/bundle.json. */
export function runRecords(runsDirectory) {
  const records = [];
  for (const run of fs.readdirSync(runsDirectory).sort()) {
    const attempts = path.join(runsDirectory, run, 'attempts');
    if (!fs.existsSync(attempts)) continue;
    for (const attempt of fs.readdirSync(attempts).sort()) {
      const file = path.join(attempts, attempt, 'bundle.json');
      if (!fs.existsSync(file)) continue;
      const { response } = JSON.parse(fs.readFileSync(file, 'utf8'));
      (response?.analyses ?? []).forEach((_, index) => records.push({
        id: `run:${path.basename(path.dirname(runsDirectory))}/${run}/${attempt}#${index}`,
        source: file, selector: `/response/analyses/${index}`
      }));
    }
  }
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    out: { type: 'string' }, fixtures: { type: 'boolean', default: false }, runs: { type: 'string', multiple: true, default: [] }
  } });
  if (!values.out || (!values.fixtures && !values.runs.length)) {
    throw Error('Usage: node scripts/buildCorpusArchiveManifest.mjs --out /tmp/manifest.json [--fixtures] [--runs /path/to/run/runs ...]');
  }
  const fixtures = values.fixtures ? fixtureRecords() : { records: [], skipped: [] };
  const records = [...fixtures.records, ...values.runs.flatMap(runsDirectory => runRecords(path.resolve(runsDirectory)))];
  if (!records.length) throw Error('No analyses found.');
  fs.writeFileSync(path.resolve(values.out), `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`);
  console.log(JSON.stringify({ records: records.length, fixtures: fixtures.records.length,
    skipped: fixtures.skipped, output: path.resolve(values.out) }));
}
