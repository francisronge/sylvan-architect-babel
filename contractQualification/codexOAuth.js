import fs from 'node:fs';

import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { resolveResearchModelSelection } from '../server/babelParser/researchModelCatalog.js';

// Subscription transport only; this module is not part of Babel's public provider routes.
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

export const buildCodexQualificationRequest = ({ sentence, framework, model, effort }) => {
  if (typeof sentence !== 'string' || !sentence.trim()) throw new Error('A sentence is required.');
  if (!['xbar', 'minimalism'].includes(framework)) throw new Error('Use xbar or minimalism.');
  const selection = resolveResearchModelSelection(model, effort ? { 'reasoning.effort': effort } : {});
  if (selection.provider !== 'openai') throw new Error('Codex OAuth requires an OpenAI model.');
  return {
    selection,
    body: {
      model: selection.providerModel,
      instructions: buildSystemInstruction(framework, 'gpt'),
      input: [{ role: 'user', content: [{
        type: 'input_text', text: buildParseContentsPrompt(sentence, framework, 'gpt')
      }] }],
      reasoning: { effort: selection.nativeSettings['reasoning.effort'] },
      store: false,
      stream: true
    }
  };
};

// Read credentials into memory; never copy or refresh the user's credential store.
export const readCodexCredentials = (authPath, now = Date.now()) => {
  let auth;
  try { auth = JSON.parse(fs.readFileSync(authPath, 'utf8')); }
  catch { throw new Error('Cannot read Codex login. Sign in with ChatGPT using codex login.'); }
  const token = auth?.tokens?.access_token;
  if (auth.auth_mode !== 'chatgpt' || typeof token !== 'string' || !token) {
    throw new Error('A ChatGPT Codex login is required. API keys are never used by this runner.');
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('Cannot read Codex token expiry. Refresh the login with codex login.'); }
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) {
    throw new Error('Codex access token expired. Refresh it with codex login, then start a new run.');
  }
  const accountId = auth.tokens.account_id || claims['https://api.openai.com/auth']?.chatgpt_account_id;
  if (typeof accountId !== 'string' || !accountId) throw new Error('Codex login has no account ID.');
  return { token, accountId };
};

const responseText = response => (response?.output || [])
  .filter(item => item.type === 'message' && item.role === 'assistant')
  .flatMap(item => item.content || [])
  .filter(part => part.type === 'output_text')
  .map(part => part.text).join('');

/** One request, no retries. Archive each received byte chunk before interpreting it.
 * A terminal response with status completed is required; EOF and [DONE] are not proof.
 * fetchImpl/onBytes allow offline transport tests without replacing Babel processing.
 */
export const requestCodexQualification = async ({
  body, credentials, fetchImpl = fetch, dispatcher, signal,
  onBytes = () => {}, onHeaders = () => {}
}) => {
  let response = null;
  let httpStatus = null;
  let terminalEvent = null;
  const parts = new Map();
  const completedItems = new Map();
  // Codex may leave response.output empty and deliver the complete messages in item events.
  const completedText = () => responseText(response) || responseText({ output:
    [...completedItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)
  });
  const partialText = () => [...parts.entries()]
    .sort(([a], [b]) => {
      const [ai, ac] = a.split(':').map(Number);
      const [bi, bc] = b.split(':').map(Number);
      return ai - bi || ac - bc;
    }).map(([, text]) => text).join('');
  const result = (status, error) => ({
    status, httpStatus, terminalEvent, response,
    text: status === 'completed' ? completedText() : partialText(),
    ...(error ? { error } : {})
  });
  let reader;
  let phase = 'request';
  try {
    const http = await fetchImpl(CODEX_RESPONSES_URL, {
      method: 'POST', redirect: 'error', signal, dispatcher,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'chatgpt-account-id': credentials.accountId,
        'OpenAI-Beta': 'responses=experimental',
        originator: 'babel-qualification',
        Accept: 'text/event-stream', 'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    httpStatus = http.status;
    phase = 'archive-headers';
    // Deliberately exclude cookies and account-identifying headers from artifacts.
    onHeaders({ status: http.status, contentType: http.headers.get('content-type'),
      requestId: http.headers.get('x-request-id') });
    if (!http.body) return result('failed', 'Response has no body.');
    reader = http.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let protocolError = null;
    const acceptEvent = block => {
      const data = block.split(/\r?\n/u).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /u, '')).join('\n');
      if (!data || data === '[DONE]') return;
      let event;
      try { event = JSON.parse(data); }
      catch { protocolError = 'Invalid JSON in provider event.'; return; }
      if (event.type === 'response.output_text.delta') {
        const key = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
        parts.set(key, (parts.get(key) || '') + (event.delta || ''));
      }
      if (event.type === 'response.output_item.done' && event.item?.status === 'completed') {
        completedItems.set(event.output_index ?? 0, event.item);
      }
      if (['response.completed', 'response.done', 'response.incomplete', 'response.failed', 'error'].includes(event.type)) {
        terminalEvent = event.type;
        response = event.response || null;
      }
    };
    while (true) {
      phase = 'read-stream';
      const { done, value } = await reader.read();
      if (done) break;
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
    if (!http.ok) return result('failed', `Provider HTTP ${http.status}; see raw response bytes.`);
    if (protocolError) return result('failed', protocolError);
    if (!terminalEvent) return result('interrupted', 'Stream ended without a terminal response.');
    if (!['response.completed', 'response.done'].includes(terminalEvent) || response?.status !== 'completed') {
      return result('failed', 'Provider did not complete the response; see terminal response.');
    }
    if (!completedText()) return result('failed', 'Completed response contains no assistant text.');
    if (partialText() && partialText() !== completedText()) {
      return result('failed', 'Streamed text differs from completed response text.');
    }
    return result('completed');
  } catch (error) {
    // Preserve the failing operation and standard error codes, never messages,
    // stacks, request objects or headers that may contain credentials.
    const codes = [error?.code, error?.cause?.code].filter(code =>
      typeof code === 'string' && /^(?:ERR_|UND_ERR_|E)[A-Z0-9_]{1,64}$/u.test(code));
    return { ...result('interrupted', signal?.aborted ? 'Request cancelled.' : 'Connection, stream decoding or artifact write failed.'),
      failure: { phase, cancelled: Boolean(signal?.aborted), ...(codes.length ? { codes } : {}) } };
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
};
