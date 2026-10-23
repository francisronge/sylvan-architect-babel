import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileDownloads, DOWNLOAD_URL_LIFETIME_MS, rawOutputBlob } from '../components/fileDownload.ts';

const browser = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  let serial = 0;
  const body = { appendChild: anchor => { anchor.attached = true; } };
  const createElement = tag => ({ tag, click() { events.push(['click', this.href, this.download, this.attached]); },
    remove() { this.attached = false; } });
  const saved = { URL: globalThis.URL, document: globalThis.document };
  globalThis.URL = { createObjectURL: () => `blob:download-${++serial}`, revokeObjectURL: url => events.push(['revoke', url]) };
  globalThis.document = { body, createElement };
  t.after(() => Object.assign(globalThis, saved));
  return events;
};

test('a download keeps its URL readable for the lifetime, then releases it once', t => {
  const events = browser(t);
  const downloads = createFileDownloads();
  downloads.download(new Blob(['{}']), 'babel-failed-generation.json');
  assert.deepEqual(events, [['click', 'blob:download-1', 'babel-failed-generation.json', true]]);
  t.mock.timers.tick(DOWNLOAD_URL_LIFETIME_MS - 1);
  assert.equal(events.length, 1, 'Safari may still be reading the Blob');
  t.mock.timers.tick(1);
  assert.deepEqual(events.at(-1), ['revoke', 'blob:download-1']);
  downloads.release();
  assert.equal(events.filter(([kind]) => kind === 'revoke').length, 1);
});

test('unmounting releases each live download URL once, and later downloads still work', t => {
  const events = browser(t);
  const downloads = createFileDownloads();
  downloads.download(new Blob(['a']), 'a.txt');
  t.mock.timers.tick(DOWNLOAD_URL_LIFETIME_MS / 2);
  downloads.download(new Blob(['b']), 'b.txt');
  downloads.release();
  assert.deepEqual(events.filter(([kind]) => kind === 'revoke'),
    [['revoke', 'blob:download-1'], ['revoke', 'blob:download-2']]);
  t.mock.timers.tick(DOWNLOAD_URL_LIFETIME_MS);
  downloads.release();
  assert.equal(events.filter(([kind]) => kind === 'revoke').length, 2, 'no URL is released twice');
  downloads.download(new Blob(['c']), 'c.txt');
  t.mock.timers.tick(DOWNLOAD_URL_LIFETIME_MS);
  assert.deepEqual(events.at(-1), ['revoke', 'blob:download-3']);
});

test('raw model output downloads as plain text whatever media type the response names', async () => {
  const text = 'not <b>html</b> — ü';
  const data = Buffer.from(text, 'utf8').toString('base64');
  for (const mediaType of ['text/html', 'image/svg+xml', 'text/plain']) {
    const blob = rawOutputBlob({ mediaType, encoding: 'base64', data });
    assert.equal(blob.type, 'text/plain;charset=utf-8');
    assert.equal(await blob.text(), text);
  }
});
