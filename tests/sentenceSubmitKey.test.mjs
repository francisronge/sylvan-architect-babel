import assert from 'node:assert/strict';
import test from 'node:test';
import { submitsSentence } from '../components/sentenceSubmitKey.ts';

const key = (overrides = {}) => ({ key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, ...overrides });

test('Enter submits the sentence and Shift+Enter or other keys keep editing', () => {
  assert.equal(submitsSentence(key()), true);
  assert.equal(submitsSentence(key({ shiftKey: true })), false);
  assert.equal(submitsSentence(key({ key: 'a', keyCode: 65 })), false);
});

test('Enter confirming an input-method candidate does not submit', () => {
  assert.equal(submitsSentence(key({ nativeEvent: { isComposing: true } })), false, 'composing Enter');
  assert.equal(submitsSentence(key({ keyCode: 229 })), false, 'Safari confirms after compositionend with keyCode 229');
});
