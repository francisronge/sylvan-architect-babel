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

const git = (root, args) => {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 ** 3
    }).trim();
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

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** `clean`, a digest of the uncommitted tracked changes and the untracked paths
 * git reports (not their contents), or `unknown` without git. */
export const readWorktreeDigest = ({ root = process.cwd() } = {}) => {
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status === null) return 'unknown';
  if (!status) return 'clean';
  return sha256(`${status}\0${git(root, ['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv']) ?? ''}`);
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
