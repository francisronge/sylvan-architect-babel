import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { changeScope, replaySurface, replayCommandInputs, REPLAY_ENTRY_POINTS } from '../scripts/ciChangeScope.mjs';

describe('CI change scope', () => {
  const surface = replaySurface();

  it('follows the Replay checks into the engine, renderer and their workers', () => {
    for (const file of ['replay/replayCompiler.ts', 'replay/replay.worker.ts', 'replay/plaqueLayout.worker.ts',
      'components/TreeVisualizer.tsx', 'components/renderer/relation-visuals.css', 'styles.css',
      'server/babelParser/spellout.js', 'tests/helpers/motionExceptions.mjs', 'replay/stageCamera.ts']) {
      assert.ok(surface.has(file), `${file} is read by a Replay check`);
    }
  });

  it('counts only the test helpers the Replay checks import or name on their command lines', () => {
    // Imported by the audits, named by verify:replay-offline, or the comparison's exception list.
    for (const file of ['tests/helpers/visualRules.mjs', 'tests/helpers/cameraInvariants.mjs', 'tests/helpers/layoutSnapshot.mjs',
      'tests/helpers/findings.mjs', 'tests/helpers/visualFrames.mjs', 'tests/helpers/cameraTrace.mjs', 'tests/helpers/replayInvariantCorpus.mjs',
      'tests/helpers/visualExceptions.mjs', 'tests/helpers/cameraExceptions.mjs', 'tests/helpers/motionExceptions.mjs',
      'tests/helpers/browserVisualExceptions.mjs', 'scripts/visualAudit/geometry.mjs']) {
      assert.equal(changeScope([file]).replay, true, `${file} is read by a Replay check`);
    }
    assert.ok(replayCommandInputs().has('tests/helpers/visualExceptions.mjs'), 'verify:replay-offline names its exception list');
    assert.ok(replayCommandInputs().has('fixtures/replay-snapshots/fixture-layout.json'), 'verify:replay-offline names the layout fingerprint');
    // Read by offline tests only (tests/uiContrast.test.mjs), never by a Replay check.
    assert.deepEqual(changeScope(['tests/helpers/uiContrastPairs.mjs']), { markdownOnly: false, replay: false, replayFiles: [] });
    assert.equal(changeScope(['tests/helpers/spelloutPayload.mjs', 'tests/helpers/browserTreeBank.mjs']).replay, false);
  });

  it('keeps every helper a Replay check spells out, however the check loads it', () => {
    // A check that names a helper in a string (an import, a dynamic import, a
    // root-relative module name or a command argument) reads it; the import
    // graph must have followed each such name, whatever form it took.
    const named = new Set();
    for (const file of surface) {
      if (!/\.(?:mjs|cjs|js|ts|tsx)$/.test(file)) continue;
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/['"`][\w./-]*?helpers\/([\w-]+\.mjs)['"`]/g)) named.add(`tests/helpers/${match[1]}`);
    }
    for (const input of replayCommandInputs()) if (input.startsWith('tests/helpers/')) named.add(input);
    assert.ok(named.size >= 10, `the Replay checks name helpers: ${[...named].join(', ')}`);
    for (const file of named) assert.ok(surface.has(file), `${file} is named by a Replay check but left out of its scope`);
  });

  it('leaves out the app screens the Replay checks never load', () => {
    for (const file of ['App.tsx', 'index.tsx', 'components/ModelControls.tsx', 'components/TreeBankView.tsx',
      'components/FailurePanel.tsx', 'hooks/useTreeBank.ts', 'services/parseService.ts']) {
      assert.ok(!surface.has(file), `${file} is outside the Replay checks`);
    }
  });

  it('names entry points that exist', () => {
    for (const file of REPLAY_ENTRY_POINTS) assert.ok(fs.existsSync(file), file);
  });

  it('skips everything for Markdown and only the Replay checks for app screens', () => {
    assert.deepEqual(changeScope(['ROADMAP.md', 'docs/verification.md']), { markdownOnly: true, replay: false, replayFiles: [] });
    assert.deepEqual(changeScope(['App.tsx', 'components/ModelControls.tsx']), { markdownOnly: false, replay: false, replayFiles: [] });
    assert.equal(changeScope(['App.tsx', 'replay/stageCamera.ts']).replay, true);
    assert.equal(changeScope(['fixtures/normalized/mia-laughed.json']).replay, true);
    assert.equal(changeScope(['package-lock.json']).replay, true);
    assert.equal(changeScope(['.github/workflows/ci.yml']).replay, true);
  });

  it('leaves the research screenshots out of every CI checkout', () => {
    for (const workflow of fs.readdirSync('.github/workflows').filter(name => name.endsWith('.yml'))) {
      const steps = fs.readFileSync(`.github/workflows/${workflow}`, 'utf8').split(/\n(?=\s+- (?:name|uses):)/);
      for (const step of steps.filter(step => step.includes('uses: actions/checkout@'))) {
        assert.match(step, /sparse-checkout: \|\n\s+\/\*\n\s+!\/docs\/research\/assets\/\n\s+sparse-checkout-cone-mode: false/, `${workflow}: ${step.trim().split('\n')[0]}`);
      }
    }
  });

  it('runs the checks for Markdown a check reads, deletes or renames', () => {
    for (const file of ['README.md', 'docs/design/visual-relations-tier2-shape-dispatch-spec.md',
      'THIRD_PARTY_NOTICES.md', 'docs/research/relation-orchard/index.md']) {
      assert.equal(changeScope([file]).markdownOnly, false, file);
    }
    assert.equal(changeScope(['removed\tdocs/verification.md']).markdownOnly, false);
    assert.equal(changeScope(['renamed\tdocs/new.md', 'renamed\tdocs/old.md']).markdownOnly, false);
    assert.equal(changeScope(['modified\tROADMAP.md', 'added\tdocs/notes.md']).markdownOnly, true);
  });

  it('runs everything when the file list cannot be trusted', () => {
    assert.deepEqual(changeScope([]).replay, true);
    assert.equal(changeScope(Array.from({ length: 3000 }, (_, index) => `docs/${index}.md`)).markdownOnly, false);
  });
});
