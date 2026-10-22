import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Stamps each Vite build with `<package version>+<commit>` for rollback and
// bug reports. The page carries it as <meta name="babel-build">, and app code
// can read the `__BABEL_BUILD__` constant. Vercel builds take the commit from
// VERCEL_GIT_COMMIT_SHA; local builds ask git and mark uncommitted changes.

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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

/** @returns {import('vite').Plugin} */
export const buildVersionPlugin = ({ root = process.cwd(), env = process.env } = {}) => {
  let buildId;
  return {
    name: 'babel-build-version',
    config() {
      buildId = readBuildId({ root, env });
      return { define: { __BABEL_BUILD__: JSON.stringify(buildId) } };
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'babel-build', content: buildId }, injectTo: 'head' }];
    }
  };
};
