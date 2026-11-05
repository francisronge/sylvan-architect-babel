#!/usr/bin/env node
// Decides which checks a change needs, so CI and agents skip work a change
// cannot affect.
//
//   markdown-only: every changed file is Markdown that no check reads, and
//     none was deleted or renamed, so every heavy job is skipped. A check
//     reads a Markdown file when a test or script names it (README.md's
//     browser list, the Tier 2 dispatch spec's audit table, the documents
//     whose links the release check follows); a deleted or renamed file
//     can break a link one of those documents holds.
//   replay: a changed file is something the Replay checks read: the static
//     geometry and camera audit, Replay motion against the base, renderer
//     performance and the painted browser-visual check. Each of them builds
//     its own page around the renderer (never App.tsx), so a change to the
//     app's own screens skips them and still runs typecheck, the offline
//     tests, the build and browser behavior.
//
// "Something the Replay checks read" is the import graph of their entry
// points (scripts/importGraph.mjs), the files their package.json commands
// name (the exception lists and the layout fingerprint), plus the inputs no
// import names (fixtures, dependency locks, build configuration and these
// rules themselves). Tailwind scans components for class names, so a screen
// change can alter the generated stylesheet the renderer page also loads;
// that changes no Replay geometry and is not counted.
//
// Usage:
//   node scripts/ciChangeScope.mjs --files <file> [--github-output]
//     one changed file per line, as a path or as "status<TAB>path" with the
//     GitHub files API status (added, modified, removed, renamed, ...)
//   node scripts/ciChangeScope.mjs --base origin/main     (committed and uncommitted changes)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importClosure } from './importGraph.mjs';

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

// Inputs no import statement or command names. A path ending in "/" covers its folder.
export const REPLAY_FIXED_INPUTS = [
  'fixtures/',
  'public/',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'tailwind.config.cjs',
  'postcss.config.cjs',
  '.github/workflows/',
  'scripts/ciChangeScope.mjs',
  'scripts/importGraph.mjs'
];

const REPOSITORY_FILE = /^[\w./-]+\.(?:mjs|cjs|js|ts|tsx|json|css)$/;

/** The repository files the package.json commands running a Replay entry point
 * name as arguments: `--exceptions tests/helpers/visualExceptions.mjs`, the
 * layout fingerprint. No import statement reaches them. */
export function replayCommandInputs(root = repoRoot) {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const inputs = new Set();
  for (const command of Object.values(scripts)) {
    if (!REPLAY_ENTRY_POINTS.some(entry => command.includes(entry))) continue;
    for (const word of command.split(/\s+/)) {
      if (REPOSITORY_FILE.test(word) && fs.existsSync(path.join(root, word))) inputs.add(word);
    }
  }
  return inputs;
}

export const replaySurface = (root = repoRoot) => new Set([...importClosure(REPLAY_ENTRY_POINTS, root), ...replayCommandInputs(root)]);

const SOURCE_FILE = /\.(?:mjs|cjs|js|ts|tsx)$/;
const MARKDOWN_NAME = /['"`]([\w./-]*\.md)['"`]/g;

// Every Markdown name a test or script spells out, by path and by file name
// (some scripts join a folder and a file name), so a match is conservative.
export function markdownCheckInputs(root = repoRoot) {
  const names = new Set();
  for (const dir of ['tests', 'scripts']) {
    for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      // These rules and their test name Markdown only as examples.
      if (!SOURCE_FILE.test(file) || file.includes('node_modules') || /(^|\/)ciChangeScope\.(test\.)?mjs$/.test(file)) continue;
      const source = fs.readFileSync(path.join(root, dir, file), 'utf8');
      for (const match of source.matchAll(MARKDOWN_NAME)) {
        const named = match[1];
        names.add(path.basename(named));
        if (named.startsWith('.')) names.add(path.relative(root, path.resolve(root, dir, path.dirname(file), named)).split(path.sep).join('/'));
        else names.add(named);
      }
    }
  }
  return names;
}

const parseLine = (line) => {
  const [status, file] = line.includes('\t') ? line.split('\t') : ['modified', line];
  return { status: status.trim(), file: file.trim() };
};

export function changeScope(changedFiles, { root = repoRoot } = {}) {
  const changes = changedFiles.map(line => line.trim() ? parseLine(line) : null).filter(Boolean);
  const files = changes.map(change => change.file);
  // An empty or truncated list (the files API stops at 3,000) is not trusted.
  if (files.length === 0 || files.length >= 3000) return { markdownOnly: false, replay: true, replayFiles: ['(file list not trusted)'] };
  const checkedMarkdown = markdownCheckInputs(root);
  const markdownOnly = changes.every(({ status, file }) => file.endsWith('.md')
    && !['removed', 'renamed'].includes(status)
    && !checkedMarkdown.has(file) && !checkedMarkdown.has(path.basename(file)));
  const surface = replaySurface(root);
  const replayFiles = files.filter(file => surface.has(file)
    || REPLAY_FIXED_INPUTS.some(input => input.endsWith('/') ? file.startsWith(input) : file === input));
  return { markdownOnly, replay: replayFiles.length > 0, replayFiles };
}

const GIT_STATUS = { A: 'added', M: 'modified', D: 'removed', R: 'renamed', C: 'copied', T: 'changed' };

function changedSince(base) {
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean);
  // A rename lists both paths; each is reported as renamed.
  const fromDiff = (...range) => git('diff', '--name-status', ...range).flatMap(line => {
    const [code, ...paths] = line.split('\t');
    return paths.map(file => `${GIT_STATUS[code[0]] ?? 'changed'}\t${file}`);
  });
  return [...new Set([...fromDiff(`${base}...HEAD`), ...fromDiff('HEAD'),
    ...git('ls-files', '--others', '--exclude-standard').map(file => `added\t${file}`)])];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { files: { type: 'string' }, base: { type: 'string' }, 'github-output': { type: 'boolean' } } });
  if (!values.files === !values.base) throw Error('Pass exactly one of --files or --base.');
  const files = values.files ? fs.readFileSync(values.files, 'utf8').split('\n') : changedSince(values.base);
  const scope = changeScope(files);
  const count = files.filter(line => line.trim()).length;
  console.log(`${count} changed file(s); Markdown only: ${scope.markdownOnly}; Replay checks needed: ${scope.replay}`);
  for (const file of scope.replayFiles.slice(0, 20)) console.log(`  Replay input: ${file}`);
  if (values['github-output']) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `markdown-only=${scope.markdownOnly}\nreplay=${scope.replay}\n`);
  }
}
