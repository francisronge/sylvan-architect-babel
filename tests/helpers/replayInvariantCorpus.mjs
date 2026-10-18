/** Every committed analysis under fixtures/ that has `derivationStages`, for the
 * Replay invariant sweep. A record keeps the nearest enclosing `sentence` and
 * `inputTokens`, as scripts/replayCorpusInputs.mjs resolves them for manifest
 * records. Nothing is dropped silently: excluded sources carry a reason, and a
 * record without a saved sentence says which sentence it is checked with. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPronouncedTerminalSequence } from '../../replay/pronouncedTerminals.ts';

const FIXTURE_ROOT = fileURLToPath(new URL('../../fixtures/', import.meta.url));

const EXCLUDED_SOURCES = new Map([
  ['raw/', 'pre-normalization model payloads that reference repeated syntax by refId; Replay prepares only '
    + 'normalized analyses, and fixtures/normalized/ holds these payloads after normalization']
]);

const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? files(file) : file.endsWith('.json') ? [file] : [];
}).sort();

const contextValue = (ancestors, read) => ancestors.map(read).find(value => value !== undefined);

export function loadFixtureAnalyses() {
  const records = [], excluded = [];
  for (const file of files(FIXTURE_ROOT)) {
    const source = path.relative(FIXTURE_ROOT, file).split(path.sep).join('/');
    const document = JSON.parse(readFileSync(file, 'utf8'));
    const visit = (value, pointer, ancestors) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${pointer}/${index}`, ancestors)); return; }
      const context = [value, ...ancestors];
      if (!Array.isArray(value.derivationStages)) {
        for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${key}`, context);
        return;
      }
      const id = `${source}#${pointer}`;
      const exclusion = [...EXCLUDED_SOURCES].find(([prefix]) => source.startsWith(prefix));
      if (exclusion) { excluded.push({ id, reason: exclusion[1] }); return; }
      const saved = contextValue(context, item => [item.sentence, item.request?.sentence, item.input?.sentence, item.response?.sentence]
        .find(sentence => typeof sentence === 'string' && sentence.trim()));
      const inputTokens = contextValue(context, item => [item.inputTokens, item.response?.inputTokens].find(Array.isArray));
      // As replay/replaySnapshot.ts does for a bundle without a sentence: the
      // final stage's pronounced words, in tree order.
      const sentence = saved ?? collectPronouncedTerminalSequence(value.derivationStages.at(-1)?.workspaceForest).join(' ');
      // The input contract the analysis was authored under, when the fixture records it.
      const contract = contextValue(context, item => typeof item.contract === 'string' && /^[\w.-]+$/.test(item.contract) ? item.contract : undefined);
      records.push({ id, sentenceSource: saved ? 'saved' : 'final pronounced words', ...(contract ? { contract } : {}),
        record: { sentence, ...(inputTokens ? { inputTokens } : {}), derivationStages: value.derivationStages } });
    };
    visit(document, '', []);
  }
  return { records, excluded };
}
