import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(repoRoot, 'fixtures', 'raw');
const normalizedDir = path.join(repoRoot, 'fixtures', 'normalized');
const volatileProvenanceFields = [
  'timestamp',
  'promptVersion',
  'parserVersion',
  'uiVersion'
];

const stripVolatileProvenance = (bundle) => {
  for (const analysis of bundle.analyses || []) {
    if (!analysis.provenance || typeof analysis.provenance !== 'object') continue;
    for (const field of volatileProvenanceFields) {
      delete analysis.provenance[field];
    }
  }
  return bundle;
};

const buildFixture = (rawPath) => {
  const fixture = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const { sentence, framework, modelRoute, payload } = fixture;
  if (!sentence || !framework || !modelRoute || !payload || typeof payload !== 'object') {
    throw new Error(`${path.basename(rawPath)} must contain sentence, framework, modelRoute, and payload`);
  }

  const bundle = normalizeParseBundle(
    payload,
    framework,
    sentence,
    modelRoute,
    true,
    { payloadIntegrityFlags: [] }
  );
  stripVolatileProvenance(bundle);

  const outputPath = path.join(normalizedDir, path.basename(rawPath));
  fs.mkdirSync(normalizedDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(path.relative(repoRoot, outputPath));
};

try {
  const rawPaths = fs.readdirSync(rawDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(rawDir, entry.name))
    .sort();

  if (rawPaths.length === 0) {
    throw new Error('No raw parse fixtures found.');
  }
  rawPaths.forEach(buildFixture);
} catch (error) {
  console.error(`Fixture build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
