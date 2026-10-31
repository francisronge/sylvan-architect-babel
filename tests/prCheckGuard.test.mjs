import assert from 'node:assert/strict';
import test from 'node:test';
import { blockReason, failingPullRequests } from '../scripts/prCheckGuard.mjs';

// The state of 31 Oct 2026: #333 failed corpus motion overnight, unnoticed, and
// Vercel failed on every PR.
const pr333 = {
  number: 333, title: 'keep a landing\'s room', url: 'https://github.com/x/y/pull/333',
  headRefName: 'fix/waiting-piece-stage-crossing', headRefOid: 'd1d91c88e7cb250e',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'Offline tests (1/6)', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'Replay motion against the PR base', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'StatusContext', context: 'Vercel', state: 'FAILURE' },
  ],
};
const green = {
  number: 340, title: 'docs', url: 'https://github.com/x/y/pull/340', headRefName: 'docs/x', headRefOid: 'abcdef1234',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'Offline tests (1/6)', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'Renderer performance', status: 'IN_PROGRESS', conclusion: null },
    { __typename: 'StatusContext', context: 'Vercel', state: 'FAILURE' },
  ],
};

test('from main, every open PR with a failing check is listed, without the ignored Vercel status', () => {
  const failing = failingPullRequests([pr333, green], 'main');
  assert.deepEqual(failing.map(pr => [pr.number, pr.failing]), [[333, ['Replay motion against the PR base']]]);
  const reason = blockReason(failing);
  assert.match(reason, /#333 .*head d1d91c8.*Replay motion against the PR base/);
  assert.match(reason, /Ignored: Vercel/);
});

test('from a PR branch, only that branch\'s PR counts', () => {
  assert.deepEqual(failingPullRequests([pr333, green], 'docs/x'), []);
  assert.equal(failingPullRequests([pr333, green], 'fix/waiting-piece-stage-crossing').length, 1);
});

test('pending and passing checks never block', () => {
  assert.deepEqual(failingPullRequests([green], 'main'), []);
});
