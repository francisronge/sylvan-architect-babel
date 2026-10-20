// Fails when a change adds an exception, or lets a listed one grow, without the
// owner's approval. Exceptions are the exported entry lists of
// tests/helpers/*Exceptions.mjs, in the format of tests/helpers/findings.mjs,
// which also defines growth and a valid approval (`exceptionGrowth`). An
// exception is never the way to make a failing check pass: fix the finding.
//   node scripts/checkExceptionGrowth.mjs [--base REV] [--head REV]
// The base is --base, else $BABEL_EXCEPTION_BASE, else the merge base of HEAD
// and origin/main; the head is --head, else the working tree.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { exceptionGrowth } from '../tests/helpers/findings.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPERS = 'tests/helpers';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const isException = item => item && typeof item === 'object' && typeof item.rule === 'string' && 'record' in item && 'subject' in item && item.at;

/** Every exported exception list of the helpers directory at `root`, by file and export name. */
async function exceptionLists(root, files) {
  const lists = {};
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(root, HELPERS, file)).href);
    for (const [name, value] of Object.entries(module))
      if (Array.isArray(value) && value.length && value.every(isException)) lists[`${file}#${name}`] = value;
  }
  return lists;
}

const exceptionFiles = names => names.filter(name => /Exceptions\.mjs$/.test(name)).sort();

/** A revision's helpers, unpacked outside the worktree so their own imports resolve. */
async function listsAt(revision, scratch) {
  const root = path.join(scratch, revision.replace(/[^\w.-]/g, '_'));
  execFileSync('sh', ['-c', `mkdir -p "$1" && git archive "$2" ${HELPERS} | tar -x -C "$1"`, 'sh', root, revision], { cwd: ROOT });
  return exceptionLists(root, exceptionFiles(git('ls-tree', '--name-only', `${revision}:${HELPERS}`).split('\n')));
}

function resolveBase(option) {
  const named = option || process.env.BABEL_EXCEPTION_BASE;
  try { return git('rev-parse', '--verify', `${named || git('merge-base', 'HEAD', 'origin/main')}^{commit}`); } catch {
    throw Error(`Cannot resolve the base revision${named ? ` ${named}` : ' (merge base of HEAD and origin/main)'}. `
      + 'Fetch it, or pass --base REV or BABEL_EXCEPTION_BASE.');
  }
}

const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' } } });
const base = resolveBase(values.base), scratch = mkdtempSync(path.join(tmpdir(), 'babel-exceptions-'));
try {
  const head = values.head ? await listsAt(values.head, scratch)
    : await exceptionLists(ROOT, exceptionFiles(readdirSync(path.join(ROOT, HELPERS))));
  const problems = exceptionGrowth(await listsAt(base, scratch), head, {
    baseDate: git('show', '-s', '--format=%cs', base), today: new Date().toISOString().slice(0, 10) });
  const count = Object.values(head).reduce((total, list) => total + list.length, 0);
  if (!problems.length) {
    console.log(`${count} exceptions; none added or grown since ${base.slice(0, 7)} without the owner's approval.`);
  } else {
    console.error(`${problems.length} exceptions added or grown since ${base.slice(0, 7)} without a valid approval:`);
    for (const { name, grown, problem } of problems) console.error(`  ${name}${grown?.length ? ` (${grown.join('; ')})` : ''}: ${problem}`);
    console.error('Fix the finding instead: an exception never makes a failing check pass. Only the owner accepts a fault. '
      + 'When he does, put his decision on that entry as approval: { by: \'Francis Ronge\', on: \'YYYY-MM-DD\', '
      + 'expires: \'YYYY-MM-DD\', note: \'where he approved it\' }. Never write an approval you did not receive.');
    process.exitCode = 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
