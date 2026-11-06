#!/usr/bin/env node
// Downloads the Generation Archive (ROADMAP, Program 6A) into a folder that
// scripts/buildReplayReview.mjs reads as it reads a saved batch:
//
//   node scripts/pullGenerationArchive.mjs --out DIR
//   node scripts/buildReplayReview.mjs --batch DIR=Archive --out /tmp/archive-review
//
// Each parsed record becomes DIR/runs/<day>_<id>/attempts/parse/bundle.json
// (the record itself: `request` and `response`); each failed one becomes
// DIR/failed/<day>_<id>.json. Records already downloaded are skipped, so
// running it again fetches only new ones. It reports how much of the archive's
// 9 GB cap is used. It reads the BABEL_ARCHIVE_R2_* settings from the
// environment, or else from the macOS Keychain item "Babel Generation Archive"
// (a JSON object of those four settings), with a key that can read the bucket.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { encodeRfc3986, readArchiveSettings, signRequest } from '../server/archiveStore.js';
import { ARCHIVE_CAP_BYTES } from '../server/generationArchive.js';

const KEYCHAIN_SERVICE = 'Babel Generation Archive';

const xmlText = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => { const match = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return match ? xmlText(match[1]) : undefined; };

/** Every archived object as { key, size }, following the listing's pages. */
const listObjects = async ({ endpoint, bucket, accessKeyId, secretAccessKey }, fetchImpl) => {
  const objects = [];
  let token;
  do {
    const query = `list-type=2&prefix=${encodeRfc3986('parses/')}${token ? `&continuation-token=${encodeRfc3986(token)}` : ''}`;
    const url = `${endpoint}/${encodeRfc3986(bucket)}?${query}`;
    const response = await fetchImpl(url, { method: 'GET', headers: signRequest({ method: 'GET', url, headers: {}, accessKeyId, secretAccessKey }) });
    if (!response.ok) throw new Error(`Listing the archive failed (HTTP ${response.status}).`);
    const xml = await response.text();
    for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      objects.push({ key: tag(entry, 'Key'), size: Number(tag(entry, 'Size')) });
    }
    token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined;
  } while (token);
  return objects;
};

export const pullGenerationArchive = async ({ env, out, fetchImpl = fetch }) => {
  const settings = readArchiveSettings(env);
  if (!settings) throw new Error('Set BABEL_ARCHIVE_R2_ENDPOINT, _BUCKET, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY first.');
  const objects = await listObjects(settings, fetchImpl);
  let downloaded = 0;
  let parsed = 0;
  let failed = 0;
  for (const { key } of objects) {
    const match = key.match(/^parses\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]+)\.json\.gz$/);
    if (!match) continue;
    const name = `${match[1]}_${match[2]}`;
    const parsedFile = path.join(out, 'runs', name, 'attempts', 'parse', 'bundle.json');
    const failedFile = path.join(out, 'failed', `${name}.json`);
    if (fs.existsSync(parsedFile) || fs.existsSync(failedFile)) continue;
    const url = `${settings.endpoint}/${encodeRfc3986(settings.bucket)}/${key.split('/').map(encodeRfc3986).join('/')}`;
    const response = await fetchImpl(url, { method: 'GET', headers: signRequest({ method: 'GET', url, headers: {}, ...settings }) });
    if (!response.ok) throw new Error(`Downloading ${key} failed (HTTP ${response.status}).`);
    const record = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
    const file = record.outcome === 'parsed' ? parsedFile : failedFile;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    downloaded += 1;
    if (record.outcome === 'parsed') parsed += 1; else failed += 1;
  }
  const storedBytes = objects.reduce((sum, { size }) => sum + (Number.isFinite(size) ? size : 0), 0);
  return { records: objects.length, downloaded, parsed, failed, storedBytes, capBytes: ARCHIVE_CAP_BYTES };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) {
    console.error('Usage: node scripts/pullGenerationArchive.mjs --out DIR');
    process.exit(2);
  }
  let env = process.env;
  if (!readArchiveSettings(env)) {
    try {
      env = JSON.parse(execFileSync('/usr/bin/security', ['find-generic-password', '-a', os.userInfo().username, '-s', KEYCHAIN_SERVICE, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      console.error(`No archive settings in the environment or in the Keychain item "${KEYCHAIN_SERVICE}".`);
      process.exit(1);
    }
  }
  const summary = await pullGenerationArchive({ env, out: values.out });
  const gb = bytes => (bytes / 1e9).toFixed(2);
  console.log(`${summary.records} records in the archive; downloaded ${summary.downloaded} new (${summary.parsed} parsed, ${summary.failed} failed).`);
  console.log(`Storage used: ${gb(summary.storedBytes)} GB of the ${gb(summary.capBytes)} GB cap.`);
}
