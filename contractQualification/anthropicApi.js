import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { tokenizeSentenceSurfaceOrder } from '../server/babelParser/surfaceTokens.js';
import { resolveResearchModelSelection } from '../server/babelParser/researchModelCatalog.js';
import { buildAnthropicRequestBody } from '../server/babelParser/modelRuntime.js';
import { qualificationResponseHeaders, qualificationTransportError } from './telemetry.js';

// Qualification transport only; Babel's public Anthropic route is unchanged.
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2023-06-01';
export const DEFAULT_ANTHROPIC_QUALIFICATION_MODEL = 'anthropic:claude-opus-5-5';
export const DEFAULT_ANTHROPIC_KEYCHAIN_SERVICE = 'Babel Anthropic API';

/** The body Babel's Anthropic route builds, plus `stream: true` for long generations. */
export const buildAnthropicQualificationRequest = ({
  sentence, framework, model = DEFAULT_ANTHROPIC_QUALIFICATION_MODEL, effort
}) => {
  if (typeof sentence !== 'string' || !sentence.trim()) throw new Error('A sentence is required.');
  if (!['xbar', 'minimalism'].includes(framework)) throw new Error('Use xbar or minimalism.');
  const selection = resolveResearchModelSelection(model, effort ? { 'output_config.effort': effort } : {});
  if (selection.provider !== 'anthropic') throw new Error('The Anthropic runner requires an Anthropic model.');
  const { maxOutputTokens, thinking } = selection.requestPolicy;
  const inputTokens = tokenizeSentenceSurfaceOrder(sentence);
  return {
    selection,
    inputTokens,
    body: {
      ...buildAnthropicRequestBody({
        model: selection.providerModel,
        contents: buildParseContentsPrompt(sentence, framework, 'claude', inputTokens),
        systemInstruction: buildSystemInstruction(framework, 'claude'),
        maxOutputTokens,
        effort: selection.nativeSettings['output_config.effort'],
        thinking: thinking?.requestMode === 'explicit-adaptive' ? thinking.value : null
      }),
      stream: true
    }
  };
};

/** Read the key into memory from the macOS Keychain; it is never written or logged. */
export const readAnthropicApiKey = ({
  service = DEFAULT_ANTHROPIC_KEYCHAIN_SERVICE, account = os.userInfo().username, run = execFileSync
} = {}) => {
  const addCommand = `security add-generic-password -a "$USER" -s "${service}" -w`;
  let key;
  try {
    key = String(run('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch {
    throw new Error(`No Anthropic API key in the Keychain under "${service}". Add it with: ${addCommand}`);
  }
  if (!key.startsWith('sk-ant-')) throw new Error(`The Keychain item "${service}" is not an Anthropic API key.`);
  return key;
};

const COMPLETED_STOP_REASONS = new Set(['end_turn']);

/** One request, no retries and no model fallbacks. Archive each received byte chunk
 * before interpreting it. Completion requires message_stop after an end_turn stop reason;
 * EOF, max_tokens and refusals are not complete analyses.
 * fetchImpl/onBytes allow offline transport tests without replacing Babel processing.
 */
export const requestAnthropicQualification = async ({
  body, apiKey, fetchImpl = fetch, dispatcher, signal,
  onBytes = () => {}, onHeaders = () => {}, onEvent = () => {}, onLifecycle = () => {}
}) => {
  let httpStatus = null;
  let terminalEvent = null;
  let responseId = null;
  let message = null;
  let stopReason = null;
  let stopDetails = null;
  let usage = null;
  let providerError = null;
  const blocks = new Map();
  const text = () => [...blocks.entries()].sort(([a], [b]) => a - b)
    .filter(([, block]) => block.type === 'text').map(([, block]) => block.text).join('');
  const response = () => message && {
    id: message.id, model: message.model, stop_reason: stopReason,
    ...(stopDetails ? { stop_details: stopDetails } : {}), usage
  };
  let phase = 'request';
  const result = (status, error, failure) => {
    onLifecycle({ type: 'transport-result', status, phase, httpStatus, terminalEvent, responseId,
      ...(failure ? { failure } : {}) });
    return { status, httpStatus, terminalEvent, response: response(), responseId, text: text(),
      ...(error ? { error } : {}), ...(failure ? { failure } : {}) };
  };
  let reader;
  try {
    onLifecycle({ type: 'request-start' });
    const http = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST', redirect: 'error', signal, dispatcher,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        Accept: 'text/event-stream', 'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    httpStatus = http.status;
    phase = 'archive-headers';
    onHeaders(qualificationResponseHeaders(http));
    if (!http.body) return result('failed', 'Response has no body.', { phase, reason: 'missing_body' });
    reader = http.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let protocolError = null;
    const acceptEvent = block => {
      const data = block.split(/\r?\n/u).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /u, '')).join('\n');
      if (!data) return;
      let event;
      try { event = JSON.parse(data); }
      catch { protocolError = 'Invalid JSON in provider event.'; return; }
      onEvent(event);
      if (event.type === 'message_start' && event.message) {
        message = event.message;
        usage = { ...(event.message.usage || {}) };
        if (typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(message.id)) {
          responseId = message.id;
          onLifecycle({ type: 'provider-response', providerEventType: event.type, responseId });
        }
      } else if (event.type === 'content_block_start') {
        blocks.set(event.index, { type: event.content_block?.type, text: event.content_block?.text || '' });
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const target = blocks.get(event.index);
        if (target) target.text += event.delta.text || '';
        else protocolError = 'Text arrived for an unopened content block.';
      } else if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason ?? stopReason;
        stopDetails = event.delta?.stop_details ?? stopDetails;
        usage = { ...(usage || {}), ...(event.usage || {}) };
      } else if (event.type === 'message_stop' || event.type === 'error') {
        terminalEvent = event.type;
        if (event.type === 'error') providerError = String(event.error?.type || 'unknown');
      }
    };
    while (true) {
      phase = 'read-stream';
      const { done, value } = await reader.read();
      if (done) {
        onLifecycle({ type: 'stream-eof', bufferedBytes: Buffer.byteLength(buffer, 'utf8') });
        break;
      }
      phase = 'archive-bytes';
      onBytes(Buffer.from(value));
      if (!http.ok) continue;
      phase = 'decode-stream';
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = /\r?\n\r?\n/u.exec(buffer))) {
        acceptEvent(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
      }
      if (terminalEvent || protocolError) break;
    }
    if (!http.ok) return result('failed', `Provider HTTP ${http.status}; see raw response bytes.`,
      { phase: 'request', reason: 'http_error' });
    if (protocolError) return result('failed', protocolError, { phase: 'decode-stream', reason: 'invalid_event' });
    if (!terminalEvent) return result('interrupted', 'Stream ended without message_stop.',
      { phase: 'read-stream', reason: 'eof_without_terminal', cancelled: Boolean(signal?.aborted) });
    if (terminalEvent === 'error') return result('failed', `Provider stream error: ${providerError}.`,
      { phase: 'decode-stream', reason: 'provider_error', providerError });
    if (!COMPLETED_STOP_REASONS.has(stopReason)) {
      return result('failed', `Provider stopped with ${stopReason ?? 'no stop reason'}; the analysis is incomplete.`,
        { phase: 'decode-stream', reason: stopReason === 'refusal' ? 'refusal' : stopReason === 'max_tokens'
          ? 'max_tokens' : 'unexpected_stop_reason', stopReason });
    }
    if (!text()) return result('failed', 'Completed response contains no text.',
      { phase: 'decode-stream', reason: 'missing_assistant_text' });
    return result('completed');
  } catch (error) {
    const details = qualificationTransportError(error);
    const messages = {
      peer_closed: 'The remote peer closed the socket before the response completed.',
      connection_reset: 'The connection was reset before the response completed.',
      body_timeout: 'The client response-body timeout expired.',
      headers_timeout: 'The client response-header timeout expired.',
      connect_timeout: 'The client connection timeout expired.',
      invalid_http_response: 'The HTTP transport rejected an invalid response.',
      socket_closed: 'The socket closed before the response completed.',
      socket_destroyed: 'The socket was destroyed before the response completed.'
    };
    const operationErrors = {
      request: 'The HTTP request failed before response headers arrived.',
      'archive-headers': 'Saving response headers failed.',
      'archive-bytes': 'Saving received response bytes failed.',
      'decode-stream': 'Processing received stream bytes failed.',
      'read-stream': 'Reading the HTTP response stream failed.'
    };
    const reason = signal?.aborted ? 'Request cancelled.' : messages[details.reason] ?? operationErrors[phase];
    return result('interrupted', reason, { phase, cancelled: Boolean(signal?.aborted), ...details });
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
};
