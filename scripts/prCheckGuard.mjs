// Claude Code Stop hook: a turn may not end silently while a pull request it is
// responsible for has a failing check. On the first stop of a turn it lists the
// failures and asks the agent to act on each one or say how it is already being
// handled; the second stop (`stop_hook_active`) always passes, so it never loops.
// Local gates do not cover CI's corpus records, so "checks pass" means GitHub's.
// From the main branch it covers every open PR; from a PR branch, that PR only.
//   echo '{"cwd":"."}' | node scripts/prCheckGuard.mjs
// It never blocks when GitHub cannot be reached.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'francisronge/sylvan-architect-babel';
const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
// The Vercel preview deployment reports failure on every PR, merged ones included;
// it is a hosting status, not a repository check. It is named in every report.
export const IGNORED = new Map([['Vercel', 'preview deployment, failing on every PR']]);

const checkName = check => check.name ?? check.context ?? '(unnamed check)';
const checkResult = check => check.conclusion ?? check.state ?? check.status ?? '';

/** Open PRs (gh `statusCheckRollup` shape) with their failing checks; from a PR branch, only that PR. */
export function failingPullRequests(pullRequests, branch, defaultBranch = 'main') {
  const relevant = branch && branch !== defaultBranch
    ? pullRequests.filter(pr => pr.headRefName === branch)
    : pullRequests;
  return relevant
    .map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      head: pr.headRefOid?.slice(0, 7),
      failing: (pr.statusCheckRollup ?? [])
        .filter(check => FAILED.has(checkResult(check).toUpperCase()) && !IGNORED.has(checkName(check)))
        .map(checkName),
    }))
    .filter(pr => pr.failing.length);
}

/** The block message for the Stop hook. */
export function blockReason(failing) {
  const lines = failing.map(pr => `- #${pr.number} ${pr.title} (head ${pr.head}): ${pr.failing.join(', ')}`);
  const ignored = [...IGNORED].map(([name, why]) => `${name} (${why})`).join('; ');
  return [
    'Open pull requests have failing CI checks:',
    ...lines,
    `Read each failure (gh pr checks <n> -R ${REPOSITORY}) and act on it now, or state in your reply`,
    'how each is already being handled (which fix is running, and that the PR is watched).',
    'Never call a PR ready or its checks passing while it is listed here.',
    'Keep the reply you were about to give in full: answer this in one added line, and if a listed PR',
    'is outside your task, say so and leave it to the agent that owns it.',
    `Ignored: ${ignored}.`,
  ].join('\n');
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
  if (input.stop_hook_active) return;
  const cwd = input.cwd || process.cwd();
  const run = (command, args) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim();
  let branch;
  let pullRequests;
  try {
    branch = run('git', ['branch', '--show-current']);
    pullRequests = JSON.parse(run('gh', ['pr', 'list', '-R', REPOSITORY, '--state', 'open', '--limit', '50',
      '--json', 'number,title,url,headRefName,headRefOid,statusCheckRollup']));
  } catch {
    return;
  }
  const failing = failingPullRequests(pullRequests, branch);
  if (failing.length) process.stdout.write(JSON.stringify({ decision: 'block', reason: blockReason(failing) }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
