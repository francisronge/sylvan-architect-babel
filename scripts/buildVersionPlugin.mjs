import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Stamps each Vite build with `<package version>+<commit>` for rollback and
// bug reports. The page carries it as <meta name="babel-build">, and app code
// can read the `__BABEL_BUILD__` constant. Vercel builds take the commit from
// VERCEL_GIT_COMMIT_SHA; local builds ask git and mark uncommitted changes.
// <meta name="babel-worktree"> digests those uncommitted changes, so the local
// server (server/distFreshness.js) can tell whether dist/ is this checkout's build.

const git = (root, args, { trim = true } = {}) => {
  try {
    const output = execFileSync('git', args, {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 ** 3
    });
    return trim ? output.trim() : output;
  } catch {
    return null;
  }
};

export const readBuildId = ({ root = process.cwd(), env = process.env } = {}) => {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deployed = String(env.VERCEL_GIT_COMMIT_SHA || '').trim();
  if (deployed) return `${version}+${deployed}`;
  const commit = git(root, ['rev-parse', 'HEAD']);
  if (!commit) return `${version}+unknown`;
  const dirty = git(root, ['status', '--porcelain']);
  return `${version}+${commit}${dirty ? '.dirty' : ''}`;
};

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** `clean`, a digest of each path git reports as changed or untracked with its
 * current content, or `unknown` without git. It reads the working tree alone,
 * so staging a change leaves it unchanged. An untracked directory git reports
 * whole counts by its path. */
export const readWorktreeDigest = ({ root = process.cwd() } = {}) => {
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], { trim: false });
  if (status === null) return 'unknown';
  if (!status) return 'clean';
  const fields = status.split('\0'), paths = new Set();
  for (let index = 0; index < fields.length; index++) {
    if (!fields[index]) continue;
    paths.add(fields[index].slice(3));
    // A rename or copy names its source in the next field.
    if (/[RC]/.test(fields[index].slice(0, 2))) paths.add(fields[++index]);
  }
  const content = file => {
    const absolute = path.join(root, file);
    try {
      const stat = fs.lstatSync(absolute);
      return stat.isSymbolicLink() ? `link ${fs.readlinkSync(absolute)}` : stat.isFile() ? sha256(fs.readFileSync(absolute)) : 'directory';
    } catch {
      return 'missing';
    }
  };
  return sha256([...paths].sort().map(file => `${file}\0${content(file)}`).join('\0'));
};

/** The <meta> tags a build of this checkout carries. */
export const buildStampTags = ({ root = process.cwd(), env = process.env, buildId = readBuildId({ root, env }) } = {}) => [
  { tag: 'meta', attrs: { name: 'babel-build', content: buildId }, injectTo: 'head' },
  { tag: 'meta', attrs: { name: 'babel-worktree', content: readWorktreeDigest({ root }) }, injectTo: 'head' }
];

/** @returns {import('vite').Plugin} */
export const buildVersionPlugin = ({ root = process.cwd(), env = process.env } = {}) => {
  let tags;
  return {
    name: 'babel-build-version',
    config() {
      const buildId = readBuildId({ root, env });
      tags = buildStampTags({ root, env, buildId });
      return { define: { __BABEL_BUILD__: JSON.stringify(buildId) } };
    },
    transformIndexHtml() {
      return tags;
    }
  };
};
