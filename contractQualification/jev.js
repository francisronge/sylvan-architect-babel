import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Qualification-only pieces of Jev: the local key loader and the cost estimate.
 * The questions, answer checks and transport are the app's own
 * (`server/babelParser/jev.js`); the server reads its key from `TYPESAFE_API_KEY`.
 */
export const DEFAULT_TYPESAFE_KEYCHAIN_SERVICE = 'Babel TypeSafe API';

/** Published per-token price (https://docs.typesafe.ai/models.md, read 2026-10-29): input only; output is free. */
export const JEV_PRICE = { asOf: '2026-10-29', source: 'https://docs.typesafe.ai/models.md', currency: 'USD',
  models: { 'jev-1.14.0': { inputPerMillion: 0.042, outputPerMillion: 0 }, 'jev-1.13.0': { inputPerMillion: 0.042, outputPerMillion: 0 } } };

/** TypeSafe bills input tokens only. Without usage (a dry run), `estimatedInputTokens` prices an estimate. */
export const estimateJevCost = (model, { inputTokens }) => {
  const rate = JEV_PRICE.models[model];
  if (!rate || !Number.isFinite(inputTokens)) return { status: 'unavailable', model, estimatedUsd: null };
  return { status: 'estimated', model, inputTokens, estimatedUsd: inputTokens * rate.inputPerMillion / 1e6,
    pricingAsOf: JEV_PRICE.asOf, source: JEV_PRICE.source };
};

const keyHelp = service => `Pass --key-file PATH (a file holding only the key), or add it to the macOS Keychain with: security add-generic-password -a "$USER" -s "${service}" -w`;

/** Reads the TypeSafe API key into memory, from `keyFile` when given, otherwise from the
 * macOS Keychain item `service`. The key is never written or logged. */
export const readTypeSafeApiKey = ({ keyFile, service = DEFAULT_TYPESAFE_KEYCHAIN_SERVICE,
  account = os.userInfo().username, run = execFileSync, readFile = fs.readFileSync } = {}) => {
  let key;
  if (keyFile) {
    try { key = String(readFile(keyFile, 'utf8')).trim(); }
    catch { throw new Error(`Cannot read the TypeSafe key file ${keyFile}. ${keyHelp(service)}`); }
    if (!key) throw new Error(`The TypeSafe key file ${keyFile} is empty. ${keyHelp(service)}`);
  } else {
    try {
      key = String(run('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    } catch { key = ''; }
    if (!key) throw new Error(`No TypeSafe API key in the Keychain under "${service}". ${keyHelp(service)}`);
  }
  if (/\s/u.test(key)) throw new Error('The TypeSafe API key holds whitespace; the key source must hold only the key.');
  return key;
};

