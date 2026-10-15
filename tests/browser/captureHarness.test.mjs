import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openCaptureSession } from '../../scripts/browserSession.mjs';
import { waitForReplayPaint, waitForDecodedImages } from '../../scripts/captureReadiness.mjs';
import { startBrowserTestServer } from '../helpers/browserTestServer.mjs';
import { normalizeParseBundle } from '../../server/babelParser/parseNormalization.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.BABEL_CAPTURE_EVIDENCE || await fs.mkdtemp(path.join(os.tmpdir(), 'babel-capture-harness-'));
await fs.mkdir(output, { recursive: true });
const fixture = { sentence: 'Mia', analyses: [{ derivationStages: [{
  statement: 'Build the nominal.', stageRecord: 'The proper name is the nominal expression in this workspace.',
  relations: [], workspaceForest: [{ id: 'np', label: 'NP', children: [{ id: 'n', label: 'N', word: 'Mia', children: [] }] }]
}] }] };
const runCli = (script, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', bytes => { text += bytes; }); child.stderr.on('data', bytes => { text += bytes; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 80_000);
  child.once('error', reject);
  child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, text }); });
});
const paintedSvg = `<svg data-babel-tree="true" data-babel-rendered-step="8" data-babel-camera-settled-step="8" width="500" height="300">
  <g transform="translate(10,10)"><g class="node-group"><text x="20" y="50">Mia</text></g></g></svg>`;

test('a cached payload does not satisfy painted-frame readiness, and failures remain visible', { timeout: 30_000 }, async () => {
  const session = await openCaptureSession({ viewport: { width: 800, height: 600 } });
  try {
    await session.page.setContent(paintedSvg);
    await session.page.evaluate(() => { window.cachedPayload = { frame: 0 }; });
    assert.deepEqual(await session.page.evaluate(() => window.cachedPayload), { frame: 0 });
    await assert.rejects(waitForReplayPaint(session.page, 0, { timeout: 150 }), /Timeout/);
    await session.page.evaluate(() => setTimeout(() => {
      const svg = document.querySelector('svg'); svg.dataset.babelRenderedStep = '0'; svg.dataset.babelCameraSettledStep = '0';
    }, 100));
    const receipt = await waitForReplayPaint(session.page, 0, { timeout: 2000 });
    assert.equal(receipt.renderedFrame, '0'); assert.equal(receipt.cameraFrame, '0');
    await session.page.evaluate(() => {
      const request = window.requestAnimationFrame;
      let settlingFrames = 0;
      window.requestAnimationFrame = callback => request.call(window, time => {
        callback(time);
        if (++settlingFrames !== 2) return;
        const svg = document.querySelector('svg');
        delete svg.dataset.babelCameraSettledStep;
        setTimeout(() => { svg.dataset.babelCameraSettledStep = '0'; window.requestAnimationFrame = request; }, 80);
      });
    });
    assert.equal((await waitForReplayPaint(session.page, 0, { timeout: 2000 })).cameraFrame, '0',
      'preparation beginning during settle requires a new completed camera receipt');
    await session.page.locator('.node-group').evaluate(group => group.style.opacity = '0');
    await assert.rejects(waitForReplayPaint(session.page, 0), /no visible syntax labels/);
    await session.page.locator('.node-group').evaluate(group => { group.style.opacity = '1'; group.setAttribute('transform', 'translate(2000,2000)'); });
    await assert.rejects(waitForReplayPaint(session.page, 0), /no visible syntax labels/);
    await session.page.locator('.node-group').evaluate(group => group.removeAttribute('transform'));
    assert((await waitForReplayPaint(session.page, 0)).visibleLabelCount > 0);
    await session.page.screenshot({ path: path.join(output, 'painted-frame.png') });
    session.assertHealthy();
    await session.page.evaluate(() => setTimeout(() => { throw new Error('capture-negative-control'); }, 0));
    await session.page.waitForEvent('pageerror');
    assert.throws(() => session.assertHealthy(), /capture-negative-control/);
  } finally { await session.close(); await session.close(); }
  await fs.writeFile(path.join(output, 'readiness-diagnostics.json'), JSON.stringify(session.diagnostics, null, 2));
});

test('image decoding waits for actual bytes and rejects missing image data', { timeout: 30_000 }, async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64');
  let supplied = false;
  const server = createServer((req, res) => {
    if (req.url === '/slow.png') return setTimeout(() => { supplied = true; res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); }, 120);
    if (req.url === '/missing.png') { res.writeHead(404); return res.end('missing'); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<img src="slow.png" width="100" height="100">');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const session = await openCaptureSession({ origins: [origin] });
  try {
    await session.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await waitForDecodedImages(session.page, 1); assert.equal(supplied, true); session.assertHealthy();
    await session.page.evaluate(() => { document.querySelector('img').src = '/missing.png'; });
    await assert.rejects(waitForDecodedImages(session.page, 1));
    assert.throws(() => session.assertHealthy(), /404/);
  } finally { await session.close(); await new Promise(resolve => server.close(resolve)); }
});

test('unexpected browser disconnection fails the capture instead of hanging', { timeout: 30_000 }, async () => {
  const session = await openCaptureSession();
  await session.page.context().browser().close();
  assert.throws(() => session.assertHealthy(), /disconnected/);
  await session.close();
});

test('CLI failure receipts preserve thrown setters, runtime errors and invalid raw payloads', { timeout: 120_000 }, async () => {
  const server = createServer((req, res) => {
    const mode = new URL(req.url, 'http://localhost').searchParams.get('mode');
    const payload = { operation: 'Project', replayCanvasData: { id: 'n', label: 'N', word: 'Mia' },
      replayVisibleNodeIds: mode === 'duplicate' ? ['n', 'n'] : ['n'] };
    const html = `<!doctype html><link rel="icon" href="data:,">${paintedSvg.replaceAll('="8"', '="0"')}<script>
      window.__BABEL_DEV_SET_ANALYSIS__ = () => { ${mode === 'setter' ? 'throw new Error("setter-negative-control");' : mode === 'runtime' ? 'setTimeout(() => { throw new Error("runtime-negative-control"); }, 0);' : ''} };
      window.__BABEL_DEV_SET_CAPTURE_MODE__ = () => {};
      window.__BABEL_DEV_SET_INPUT_VISIBILITY__ = () => {};
      window.__BABEL_DEV_SET_TAB__ = () => {};
      window.__BABEL_DEV_GET_REPLAY_STEP_COUNT__ = () => 1;
      window.__BABEL_DEV_SET_REPLAY_STEP__ = () => {};
      window.__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__ = () => (${JSON.stringify(payload)});
      </script>`;
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const bundle = path.join(output, 'failure-input.json'); await fs.writeFile(bundle, JSON.stringify(fixture));
  try {
    for (const [mode, expected] of [['setter', /setter-negative-control/], ['runtime', /runtime-negative-control/], ['duplicate', /duplicate visible occurrence/]]) {
      const destination = path.join(output, mode);
      const result = await runCli('captureReplayArtifact.mjs', ['--bundle', bundle, '--out', destination, '--app-url', `${origin}/?mode=${mode}`]);
      assert.equal(result.code, 1, result.text); assert.equal(result.signal, null);
      const receipt = JSON.parse(await fs.readFile(path.join(destination, 'render-summary.json')));
      assert.equal(receipt.ok, false); assert.equal(receipt.closed, true); assert.match(receipt.error, expected);
      if (mode === 'duplicate') {
        const raw = JSON.parse(await fs.readFile(path.join(destination, 'replay-payloads.json')));
        assert.deepEqual(raw[0].payload.replayVisibleNodeIds, ['n', 'n'], 'the failing evidence is not normalized away');
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the supported CLI captures the real app and builds decoded sheets with raw receipts', { timeout: 120_000 }, async () => {
  const server = await startBrowserTestServer({ root });
  const bundle = path.join(output, 'input.json'), capture = path.join(output, 'actual-app'), sheets = path.join(output, 'sheets');
  await fs.writeFile(bundle, JSON.stringify({ sentence: 'Mia', response: normalizeParseBundle(fixture, 'xbar', 'Mia', 'gpt') }));
  try {
    const result = await runCli('captureReplayArtifact.mjs', ['--bundle', bundle, '--out', capture, '--app-url', server.url]);
    assert.equal(result.code, 0, result.text); assert.equal(result.signal, null);
    const summary = JSON.parse(await fs.readFile(path.join(capture, 'render-summary.json')));
    const payloads = JSON.parse(await fs.readFile(path.join(capture, 'replay-payloads.json')));
    assert.equal(summary.ok, true); assert.equal(summary.closed, true); assert(summary.replayCount > 1);
    assert.equal(payloads.length, summary.replayCount);
    assert.equal(summary.frames.length, summary.replayCount);
    assert(summary.runtimeAssets.some(asset => asset.type === 'script' && asset.sha256.length === 64));
    for (const [index, frame] of summary.frames.entries()) {
      assert.equal(frame.requestedFrame, index); assert.equal(frame.renderedFrame, String(index));
      assert.equal(frame.cameraFrame, String(index)); assert(frame.visibleLabelCount > 0);
      assert.equal(frame.payloadSha256.length, 64); assert.equal(frame.screenshotSha256.length, 64);
    }
    const built = await runCli('buildReplayContactSheets.mjs', ['--render-dir', capture, '--out', sheets]);
    assert.equal(built.code, 0, built.text);
    const sheet = JSON.parse(await fs.readFile(path.join(sheets, 'contact-sheets.json')));
    assert.equal(sheet.ok, true); assert.equal(sheet.closed, true); assert.equal(sheet.inputs.length, summary.replayCount);
    assert.equal(sheet.sheets.length, 1); assert(sheet.assets.some(asset => asset.type === 'image'));
  } finally { await server.close(); }
});
