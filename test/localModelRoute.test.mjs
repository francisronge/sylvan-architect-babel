import test from 'node:test';
import assert from 'node:assert/strict';

import { __test__ } from '../server/geminiParser.js';
import { parseFromBodyWithProviders, validateParseBody } from '../server/parseApi.js';

const { extractLocalModelResponseText } = __test__;

test('validateParseBody accepts the local route and defaults to it', () => {
  assert.equal(
    validateParseBody({ sentence: 'Que pintura comprou Teresa?', framework: 'xbar' }).modelRoute,
    'local'
  );
  assert.equal(
    validateParseBody({
      sentence: 'Que pintura comprou Teresa?',
      framework: 'xbar',
      modelRoute: 'local'
    }).modelRoute,
    'local'
  );
});

test('parseFromBodyWithProviders dispatches local requests to the local provider', async () => {
  const calls = [];
  const result = await parseFromBodyWithProviders(
    {
      sentence: 'Que pintura comprou Teresa?',
      framework: 'xbar',
      modelRoute: 'local'
    },
    {
      local: async (sentence, framework, modelRoute) => {
        calls.push({ sentence, framework, modelRoute });
        return { analyses: [{}], ambiguityDetected: false, requestedModelRoute: 'local' };
      },
      gemini: async () => {
        throw new Error('gemini provider should not be called for local route');
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    sentence: 'Que pintura comprou Teresa?',
    framework: 'xbar',
    modelRoute: 'local'
  });
  assert.equal(result.requestedModelRoute, 'local');
});

test('extractLocalModelResponseText reads Ollama and OpenAI-compatible envelopes', () => {
  assert.equal(
    extractLocalModelResponseText({ response: '{"analyses":[{"growthFrames":[],"noteBindings":[]}]}'}),
    '{"analyses":[{"growthFrames":[],"noteBindings":[]}]}'
  );
  assert.equal(
    extractLocalModelResponseText({
      choices: [
        {
          message: {
            content: '{"analyses":[{"growthFrames":[],"noteBindings":[]}]}'
          }
        }
      ]
    }),
    '{"analyses":[{"growthFrames":[],"noteBindings":[]}]}'
  );
});
