import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';

test('self-contained workspaces restart inspection after a break without resurrecting stale references or Replay', () => {
  const node = (id, word) => ({ id, label: 'N', word, children: [] });
  const stage = (workspaceForest, relations = []) => ({
    statement: 'Authored state', stageRecord: 'Preserved explanation', relations, workspaceForest
  });
  const stages = [
    stage([node('n', 'Old'), node('only-before-break', 'Before')]),
    stage([node('n', 'Partial update'), { refId: 'missing' }]),
    stage([{ refId: 'n' }]),
    stage([node('n', 'New')], [{ relation: 'Open', anchors: { current: 'n' }, priorAnchors: { prior: 'n' } }]),
    stage([{ refId: 'n' }]),
    stage([{ refId: 'only-before-break' }]),
    stage([node('last', 'Last')])
  ];
  const original = structuredClone(stages);
  const inspected = __test__.inspectDerivationWorkspaces(stages, { analysisIndex: 2, fieldPath: '$.analyses[2]' });
  assert.deepEqual(inspected.map(({ workspaceForest }) => workspaceForest?.[0]?.word ?? null), [
    'Old', null, null, 'New', 'New', null, 'Last'
  ]);
  assert.equal(inspected[2].blockedByStageIndex, 1);
  assert.match(inspected[2].diagnostic.message, /history.*failed at stage 2/);
  assert.equal(inspected[2].diagnostic.fieldPath, '$.analyses[2].derivationStages[2].workspaceForest[0].refId');
  assert.equal(inspected[2].diagnostic.analysisIndex, 2);
  assert.deepEqual(inspected[3].anchorChecks.map(({ status }) => status), ['resolved', 'unavailable']);
  assert.equal(inspected[4].transitionUnavailableSinceStageIndex, 1);
  assert.ok(inspected.every(({ replayStatus }) => replayStatus === 'not-compiled'));
  assert.deepEqual(inspected.map(({ authoredStage }) => authoredStage), original);
  assert.deepEqual(stages, original);
});

test('workspace inspection builds a self-contained page without altering authored content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-inspection-test-'));
  try {
    const input = path.join(directory, 'saved.json');
    const output = path.join(directory, 'index.html');
    const record = {
      kind: 'authored-workspace-inspection', rawOutput: { sha256: 'test' }, repairDiagnostics: [],
      payload: { text: '</script><script>untrusted()</script>' },
      analyses: [{ analysisIndex: 0, stages: [{ stageIndex: 0,
        authoredStage: { statement: 'Authored stage', relations: [{ values: ['unwrapped'] }] },
        workspaceForest: [{ id: 'n', label: 'N', word: 'Mia', children: [] }]
      }] }]
    };
    const original = JSON.stringify(record);
    fs.writeFileSync(input, original);
    const result = spawnSync(process.execPath, ['scripts/buildWorkspaceInspection.mjs', output, input], {
      encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..')
    });
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(output, 'utf8');
    const embedded = html.match(/<script id="inspection-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.deepEqual(JSON.parse(embedded[1])[0].record, record);
    assert.equal(fs.readFileSync(input, 'utf8'), original);
    assert.ok(!html.includes('<script>untrusted()'));
    assert.ok(!/<script[^>]+src=/.test(html));
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /data:font\//);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
