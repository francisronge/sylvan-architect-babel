import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);

export async function runtimeBuildTools() {
  const packages = await Promise.all(['esbuild', 'postcss', 'tailwindcss'].map(async name => [name,
    JSON.parse(await fs.readFile(require.resolve(`${name}/package.json`), 'utf8')).version]));
  const scripts = await Promise.all(['buildContractQualificationReviewRuntime.mjs', 'inlineWorkerPlugin.mjs', 'reviewRuntimeProvenance.mjs']
    .map(async name => ({ path: `scripts/${name}`, sha256: sha256(await fs.readFile(path.join(import.meta.dirname, name))) })));
  return { node: process.version, ...Object.fromEntries(packages), scripts };
}

const relativeInput = (root, file) => {
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`Runtime input must be inside its checkout: ${file}`);
  }
  return relative;
};

export async function resolveStyleContent(root, patterns) {
  const normalized = patterns.filter(item => typeof item === 'string').map(item => {
    const excluded = item.startsWith('!');
    return (excluded ? '!' : '') + relativeInput(root, excluded ? item.slice(1) : item);
  });
  const included = normalized.filter(item => !item.startsWith('!'));
  const excluded = normalized.filter(item => item.startsWith('!')).map(item => item.slice(1));
  const files = new Set();
  for await (const file of fs.glob(included, { cwd: root, exclude: excluded })) {
    if ((await fs.stat(path.join(root, file))).isFile()) files.add(file.split(path.sep).join('/'));
  }
  return { patterns: normalized, files: [...files].sort() };
}

export async function createRuntimeProvenance({ root, inputFiles, bundleInputFiles, styleContent, entrySource, tools, js, css, consumedSources }) {
  // The bundle graph is independent of Tailwind-only inputs. A scanned template
  // can also be a real import, so neither set may be derived by subtraction.
  const bundleInputs = [...new Set(bundleInputFiles.filter(file => file !== '<stdin>')
    .map(file => relativeInput(root, file)))].sort();
  const files = new Set([...inputFiles, ...bundleInputs].filter(file => file !== '<stdin>' && !file.startsWith('node_modules/'))
    .map(file => relativeInput(root, file)));
  files.add('package-lock.json');
  for (const file of styleContent.files) files.add(file);
  const sources = await Promise.all([...files].map(file => relativeInput(root, file)).sort().map(async file => ({
    path: file, sha256: sha256(await fs.readFile(path.join(root, file)))
  })));
  for (const file of sources) {
    if (consumedSources.get(path.resolve(root, file.path)) !== file.sha256) {
      throw new Error(`Build input differs from its compiled bytes: ${file.path}`);
    }
  }
  if (JSON.stringify(await resolveStyleContent(root, styleContent.patterns)) !== JSON.stringify(styleContent)) {
    throw new Error('Tailwind content membership changed during compilation.');
  }
  const entry = entrySource ? { kind: 'virtual', sha256: sha256(entrySource) }
    : { kind: 'file', path: 'contractQualification/reviewApp.tsx' };
  const sourceSha256 = sha256(JSON.stringify({ sources, bundleInputs, styleContent, entry, tools }));
  const jsSha256 = sha256(js), cssSha256 = sha256(css);
  return { schemaVersion: 2, kind: 'production-tree-visualizer', sources, bundleInputs, styleContent, entry, tools,
    lockfile: sources.find(file => file.path === 'package-lock.json'), sourceSha256, jsSha256, cssSha256,
    buildSha256: sha256(JSON.stringify({ sourceSha256, jsSha256, cssSha256 })) };
}

/** Saved bundles are usable only when both input bytes and content-glob membership still match. */
export async function verifyRuntimeFreshness(metadata, { root, entrySource } = {}) {
  if (metadata?.schemaVersion !== 2 || !metadata.sources?.length || !Array.isArray(metadata.bundleInputs) || !metadata.styleContent?.patterns
    || !metadata.entry || !metadata.lockfile || !metadata.sourceSha256 || !metadata.buildSha256) {
    return { fresh: false, mismatches: ['Incomplete runtime provenance; rebuild the saved runtime.'], sources: [] };
  }
  root = path.resolve(root);
  const mismatches = [];
  const bundleInputs = [...new Set(metadata.bundleInputs.map(file => relativeInput(root, file)))].sort();
  if (JSON.stringify(bundleInputs) !== JSON.stringify(metadata.bundleInputs)
    || bundleInputs.some(file => !file.startsWith('node_modules/') && !metadata.sources.some(source => source.path === file))) {
    mismatches.push('Bundle input manifest');
  }
  const sources = await Promise.all(metadata.sources.map(async item => {
    const file = relativeInput(root, item.path);
    let currentSha256 = null;
    try { currentSha256 = sha256(await fs.readFile(path.join(root, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const match = currentSha256 === item.sha256;
    if (!match) mismatches.push(file);
    return { path: file, builtSha256: item.sha256, currentSha256, match };
  }));
  const currentContent = await resolveStyleContent(root, metadata.styleContent.patterns);
  if (JSON.stringify(currentContent) !== JSON.stringify(metadata.styleContent)) mismatches.push('Tailwind content membership');
  if (JSON.stringify(await runtimeBuildTools()) !== JSON.stringify(metadata.tools)) mismatches.push('Runtime build tools');
  if (!metadata.sources.some(item => item.path === 'package-lock.json' && item.sha256 === metadata.lockfile.sha256)) {
    mismatches.push('Dependency lock identity');
  }
  if (metadata.entry.kind === 'virtual' && (typeof entrySource !== 'string' || sha256(entrySource) !== metadata.entry.sha256)) {
    mismatches.push('Virtual entry source is missing or differs from the expected entry.');
  }
  const sourceSha256 = sha256(JSON.stringify({ sources: metadata.sources, bundleInputs: metadata.bundleInputs, styleContent: metadata.styleContent,
    entry: metadata.entry, tools: metadata.tools }));
  if (sourceSha256 !== metadata.sourceSha256) mismatches.push('Source manifest identity');
  if (sha256(JSON.stringify({ sourceSha256, jsSha256: metadata.jsSha256, cssSha256: metadata.cssSha256 })) !== metadata.buildSha256) {
    mismatches.push('Build identity');
  }
  return { fresh: mismatches.length === 0, mismatches, sources };
}
