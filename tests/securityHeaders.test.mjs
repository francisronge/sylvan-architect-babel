import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import helmet from 'helmet';

import { PERMISSIONS_POLICY, helmetOptions } from '../server/securityHeaders.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));

// The headers the production Express server sends on every response.
const expressHeaders = () => {
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; }, removeHeader: () => {} };
  let finished = false;
  helmet(helmetOptions({ hsts: true }))({}, res, () => { finished = true; });
  assert.equal(finished, true);
  headers['Permissions-Policy'] = PERMISSIONS_POLICY;
  return headers;
};

const ruleHeaders = rule => Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));

test('Vercel sends the production Express security headers on every route', () => {
  const allRoutes = vercel.headers.find(rule => rule.source === '/(.*)');
  assert.ok(allRoutes, 'vercel.json needs a header rule for /(.*)');
  const expected = expressHeaders();
  assert.ok(expected['Content-Security-Policy'] && expected['Strict-Transport-Security']);
  assert.deepEqual(ruleHeaders(allRoutes), expected);
});

test('narrower Vercel header rules do not override a security header', () => {
  const expected = expressHeaders();
  for (const rule of vercel.headers.filter(candidate => candidate.source !== '/(.*)')) {
    for (const { key, value } of rule.headers) {
      if (key in expected) assert.equal(value, expected[key], `${rule.source} overrides ${key}`);
    }
  }
});

test('local plain-HTTP Express omits only HSTS', () => {
  const headers = {};
  helmet(helmetOptions({ hsts: false }))({}, { setHeader: (name, value) => { headers[name] = value; }, removeHeader: () => {} }, () => {});
  const { 'Strict-Transport-Security': hsts, 'Permissions-Policy': _, ...rest } = expressHeaders();
  assert.ok(hsts);
  assert.deepEqual(headers, rest);
});
