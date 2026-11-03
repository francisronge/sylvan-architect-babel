#!/usr/bin/env node
// Decides which checks a change needs, so CI and agents skip work a change
// cannot affect.
//
//   markdown-only: every changed file is Markdown. No check reads Markdown as
//     an input, so every heavy job is skipped.
//   replay: a changed file is something the Replay checks read: the static
//     geometry and camera audit, Replay motion against the base, renderer
//     performance and the painted browser-visual check. Each of them builds
//     its own page around the renderer (never App.tsx), so a change to the
//     app's own screens skips them and still runs typecheck, the offline
//     tests, the build and browser behavior.
//
// "Something the Replay checks read" is the import graph of their entry
// points, followed through static, dynamic, worker, `new URL` and CSS
// imports, plus the inputs no import names (fixtures, dependency locks,
// build configuration and these rules themselves). Tailwind scans
// components for class names, so a screen change can alter the generated
// stylesheet the renderer page also loads; that changes no Replay geometry
// and is not counted.
//
// Usage:
//   node scripts/ciChangeScope.mjs --files <file with one path per line> [--github-output]
//   node scripts/ciChangeScope.mjs --base origin/main     (committed and uncommitted changes)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// What the Replay jobs run (package.json scripts and .github/workflows).
export const REPLAY_ENTRY_POINTS = [
  'scripts/auditReplayVisuals.mjs',
  'scripts/compareReplayCorpus.mjs',
  'scripts/replayCorpusSnapshot.mjs',
  'scripts/buildCorpusArchiveManifest.mjs',
  'scripts/checkRendererPerformance.mjs',
  'scripts/verifyBrowserVisual.mjs',
  'scripts/auditReplayBrowser.mjs'
];

// Inputs no import statement names. A path ending in "/" covers its folder.
export const REPLAY_FIXED_INPUTS = [
  'fixtures/',
  'tests/helpers/',
  'scripts/visualAudit/',
  'public/',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'tailwind.config.cjs',
  'postcss.config.cjs',
  '.github/workflows/',
  'scripts/ciChangeScope.mjs'
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json', '.css'];
const SPECIFIER_PATTERNS = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bnew URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
  /@import\s+(?:url\()?['"]([^'"]+)['"]/g
];

// Scripts also load modules by root-relative name, for example the list of
// entry modules scripts/replayCorpusSnapshot.mjs imports from each checkout.
const ROOT_RELATIVE = /['"`]((?:replay|components|server|services|hooks|scripts|tests|fixtures)\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|json|css))['"`]/g;

const isFile = (file) => fs.existsSync(file) && fs.statSync(file).isFile();

function resolveFrom(dir, specifier) {
  const base = path.resolve(dir, specifier.replace(/[?#].*$/, ''));
  for (const candidate of [base, ...EXTENSIONS.map(ext => base + ext), ...EXTENSIONS.map(ext => path.join(base, 'index' + ext))]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

// Scripts build virtual entries whose imports are relative to the repository
// root (esbuild `resolveDir: root`), so an import a script cannot resolve
// beside itself is tried from the root.
// A specifier naming a folder (`new URL('../', import.meta.url)` is the
// repository root) imports nothing.
function resolveSpecifier(from, specifier, root) {
  if (!specifier.startsWith('.') || /(^|\/)\.{0,2}\/?$/.test(specifier)) return null;
  return resolveFrom(path.dirname(from), specifier) ?? resolveFrom(root, specifier);
}

export function replaySurface(root = repoRoot) {
  const seen = new Set();
  const queue = REPLAY_ENTRY_POINTS.map(file => path.join(root, file));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const resolved = resolveSpecifier(file, match[1], root);
        if (resolved && !resolved.includes(`${path.sep}node_modules${path.sep}`)) queue.push(resolved);
      }
    }
    for (const match of source.matchAll(ROOT_RELATIVE)) {
      const resolved = path.join(root, match[1]);
      if (isFile(resolved)) queue.push(resolved);
    }
  }
  return new Set([...seen].map(file => path.relative(root, file).split(path.sep).join('/')));
}

export function changeScope(changedFiles, { root = repoRoot } = {}) {
  const files = changedFiles.map(file => file.trim()).filter(Boolean);
  // An empty or truncated list (the files API stops at 3,000) is not trusted.
  if (files.length === 0 || files.length >= 3000) return { markdownOnly: false, replay: true, replayFiles: ['(file list not trusted)'] };
  const markdownOnly = files.every(file => file.endsWith('.md'));
  const surface = replaySurface(root);
  const replayFiles = files.filter(file => surface.has(file)
    || REPLAY_FIXED_INPUTS.some(input => input.endsWith('/') ? file.startsWith(input) : file === input));
  return { markdownOnly, replay: replayFiles.length > 0, replayFiles };
}

function changedSince(base) {
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).split('\n');
  return [...new Set([
    ...git('diff', '--name-only', `${base}...HEAD`),
    ...git('diff', '--name-only', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard')
  ])].filter(Boolean);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { files: { type: 'string' }, base: { type: 'string' }, 'github-output': { type: 'boolean' } } });
  if (!values.files === !values.base) throw Error('Pass exactly one of --files or --base.');
  const files = values.files ? fs.readFileSync(values.files, 'utf8').split('\n') : changedSince(values.base);
  const scope = changeScope(files);
  const count = files.filter(Boolean).length;
  console.log(`${count} changed file(s); Markdown only: ${scope.markdownOnly}; Replay checks needed: ${scope.replay}`);
  for (const file of scope.replayFiles.slice(0, 20)) console.log(`  Replay input: ${file}`);
  if (values['github-output']) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `markdown-only=${scope.markdownOnly}\nreplay=${scope.replay}\n`);
  }
}
