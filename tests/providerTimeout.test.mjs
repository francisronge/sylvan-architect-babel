import assert from 'node:assert/strict';
import test from 'node:test';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { ParseApiError } from '../server/babelParser/error.js';
import { GENERATION_MODEL_IDS } from '../server/babelParser/researchModelCatalog.js';

test('every external provider reports timeout precisely without retrying or normalizing', async t => {
  const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MOONSHOT_API_KEY', 'XAI_API_KEY', 'BABEL_SAVE_PROVIDER_RAW'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => keys.forEach(key => {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }));
  keys.forEach(key => { process.env[key] = key === 'BABEL_SAVE_PROVIDER_RAW' ? '0' : 'offline-test-key'; });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No network is permitted'));
  let calls = 0;
  const generate = async () => { calls++; throw Object.assign(new Error('Generation timed out'), { code: 'PROVIDER_TIMEOUT' }); };
  const unexpected = () => assert.fail('Timeouts must not parse or normalize an analysis');
  const routes = createParseRoutes({ ParseApiError, normalizeParseBundle: unexpected, parseModelJson: unexpected,
    generateOpenAI: generate, generateClaude: generate, generateKimi: generate, generateGrok: generate });
  for (const modelId of GENERATION_MODEL_IDS) {
    const before = calls;
    await assert.rejects(routes.parseSentenceWithResearchModel('Mia laughed.', 'xbar', modelId), error => {
      assert.equal(error.code, 'PROVIDER_TIMEOUT', modelId);
      assert.equal(error.status, 504, modelId);
      assert.match(error.message, /timed out before a result was received/);
      assert.equal(error.details.providerAttempts.length, 1);
      assert.equal(error.details.providerAttempts[0].retryReason, 'uncertain_timeout');
      assert.ok(error.details.generationRecord);
      return true;
    });
    assert.equal(calls, before + 1, modelId);
  }
});
