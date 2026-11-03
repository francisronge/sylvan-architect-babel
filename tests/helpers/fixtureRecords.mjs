import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/**
 * Every object under fixtures/ that carries a `sentence` with `derivationStages`
 * or `analyses`, labelled by its file and JSON path, as the contract tests read
 * it: the payload, its sentence, saved input tokens and framework. Unlike
 * replayInvariantCorpus.mjs, raw model payloads are included and nothing is
 * inherited from an enclosing object.
 */
export const fixtureRecords = () => {
  const records = [];
  const walk = (value, label) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${label}[${index}]`));
    if (typeof value.sentence === 'string' && (Array.isArray(value.derivationStages) || Array.isArray(value.analyses))) {
      records.push({ label, sentence: value.sentence, framework: value.framework === 'minimalism' ? 'minimalism' : 'xbar',
        inputTokens: value.inputTokens,
        payload: Array.isArray(value.analyses) ? { analyses: value.analyses } : { derivationStages: value.derivationStages } });
      return;
    }
    Object.entries(value).forEach(([key, item]) => walk(item, `${label}.${key}`));
  };
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith('.json')) walk(JSON.parse(fs.readFileSync(full, 'utf8')), path.relative(repoRoot, full));
  });
  visit(path.join(repoRoot, 'fixtures'));
  return records;
};
