import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { collectPronouncedTerminalSequence } from '../replay/pronouncedTerminals.ts';
import { finalForestForAnalysis } from '../replay/finalForest.ts';
import { openCaptureSession } from './browserSession.mjs';
import { waitForReplayPaint } from './captureReadiness.mjs';
import { assertReplayCapturePayload } from './replayCapturePayload.mjs';
import { escapeHtml } from './escapeHtml.mjs';

const { values } = parseArgs({ options: {
  bundle: { type: 'string' }, out: { type: 'string' }, browser: { type: 'string' },
  'app-url': { type: 'string', default: 'http://127.0.0.1:5177' },
  'analysis-index': { type: 'string', default: '0' }, width: { type: 'string', default: '1600' },
  height: { type: 'string', default: '1000' }, verbose: { type: 'boolean' }
} });
if (!values.bundle || !values.out) throw new Error('Provide --bundle and --out.');
const bundlePath = path.resolve(values.bundle), outDir = path.resolve(values.out);
if (!fs.existsSync(bundlePath)) throw new Error(`Missing bundle: ${bundlePath}`);
if (values.browser && !fs.existsSync(values.browser)) throw new Error(`Missing browser: ${values.browser}`);
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw new Error(`Capture output is not empty: ${outDir}`);
fs.mkdirSync(outDir, { recursive: true });
const analysisIndex = Number(values['analysis-index']);
const viewport = { width: Number(values.width), height: Number(values.height) };
if (!Number.isInteger(analysisIndex) || analysisIndex < 0) throw new Error('analysis-index must be a nonnegative integer.');
if (Object.values(viewport).some(n => !Number.isInteger(n) || n <= 0)) throw new Error('Viewport dimensions must be positive integers.');
const target = new URL(values['app-url']);
if (!['http:', 'https:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('Artifact capture requires a loopback app URL.');
}
const bundleBytes = fs.readFileSync(bundlePath);
const rawBundleWrapper = JSON.parse(bundleBytes.toString('utf8').replace(/^\uFEFF/, ''));
const sourceParseBundle = rawBundleWrapper.response || rawBundleWrapper.bundle || rawBundleWrapper;
const firstAnalysis = sourceParseBundle.analyses?.[analysisIndex];
if (!firstAnalysis) throw new Error(`Bundle does not contain analysis index ${analysisIndex}.`);
const parseBundle = { ...sourceParseBundle, analyses: [firstAnalysis], ambiguityDetected: false, ambiguityNote: undefined };
const request = rawBundleWrapper.request || {};
const suppliedSentence = String(request.sentence || rawBundleWrapper.sentence || sourceParseBundle.sentence || '').trim();
if (firstAnalysis.derivationStages?.some(stage => stage.realizations?.length) && !suppliedSentence) {
  throw new Error('Capturing realization analyses requires their original input sentence.');
}
const sentence = suppliedSentence || collectPronouncedTerminalSequence(finalForestForAnalysis(firstAnalysis)).join(' ');
const framework = (request.framework || firstAnalysis.provenance?.framework) === 'minimalism' ? 'minimalism' : 'xbar';
const modelRoute = request.modelRoute || rawBundleWrapper.requestedRoute || sourceParseBundle.requestedModelRoute
  || firstAnalysis.provenance?.modelRoute || '';
const reasoningEffort = request.reasoningEffort || sourceParseBundle.requestedReasoningEffort
  || firstAnalysis.provenance?.requestedReasoningEffort || firstAnalysis.provenance?.reasoningEffort || '';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(path.join(outDir, file), JSON.stringify(value, null, 2) + '\n');

const writeViewer = (frameCount) => {
  const lastFrame = Math.max(0, frameCount - 1);
  const assetVersion = `${Date.now()}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>Babel Replay Capture</title>
  <style>
    body { margin: 0; background: #07120f; color: #dffcf2; font-family: system-ui, sans-serif; }
    .toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; padding: 12px 16px; background: #081713; border-bottom: 1px solid #164438; }
    button { color: #dffcf2; background: #0a211b; border: 1px solid #1c6b58; border-radius: 8px; padding: 8px 14px; font-weight: 700; }
    input[type="range"] { flex: 1; accent-color: #22d39d; }
    main { padding: 16px; display: grid; place-items: center; }
    img { max-width: 100%; height: auto; border: 1px solid #164438; border-radius: 8px; background: #020705; }
    .label { min-width: 120px; text-align: right; font-weight: 800; color: #8ffff0; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="prev">Prev</button>
    <button id="next">Next</button>
    <input id="slider" type="range" min="0" max="${lastFrame}" value="0">
    <div class="label">Frame <span id="index">1</span> / ${frameCount}</div>
  </div>
  <main><img id="shot" alt="Replay frame" src="replay-00.png?v=${assetVersion}"></main>
  <script>
    const count = ${frameCount};
    const assetVersion = ${JSON.stringify(assetVersion)};
    const imageSrc = (name) => name + '?v=' + encodeURIComponent(assetVersion);
    const pad = (n) => String(n).padStart(2, '0');
    const slider = document.getElementById('slider');
    const shot = document.getElementById('shot');
    const label = document.getElementById('index');
    const show = (i) => {
      const next = Math.max(0, Math.min(Number(i) || 0, count - 1));
      slider.value = String(next);
      label.textContent = String(next + 1);
      shot.src = imageSrc('replay-' + pad(next) + '.png');
    };
    slider.addEventListener('input', () => show(slider.value));
    document.getElementById('prev').addEventListener('click', () => show(Number(slider.value) - 1));
    document.getElementById('next').addEventListener('click', () => show(Number(slider.value) + 1));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(Number(slider.value) - 1);
      if (event.key === 'ArrowRight') show(Number(slider.value) + 1);
    });
  </script>
  <!-- ${escapeHtml(sentence)} -->
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'replay-viewer.html'), html, 'utf8');
};

const payloads = [], frames = [];
let session;
const summary = { ok: false, bundle: bundlePath, bundleSha256: sha256(bundleBytes), analysisIndex,
  server: target.href, sentence, framework, modelRoute, reasoningEffort, viewport, frames };
try {
  session = await openCaptureSession({ executablePath: values.browser, viewport, origins: [target.origin] });
  summary.browser = { engine: session.engine, version: session.browserVersion };
  const page = session.page;
  target.searchParams.set('devCapture', '1');
  await page.goto(target.href);
  await page.waitForFunction(() => typeof window.__BABEL_DEV_SET_ANALYSIS__ === 'function');
  await page.evaluate(({ bundle, options }) => {
    window.__BABEL_DEV_SET_ANALYSIS__(bundle, options);
    window.__BABEL_DEV_SET_CAPTURE_MODE__(true);
    window.__BABEL_DEV_SET_INPUT_VISIBILITY__(false);
  }, { bundle: parseBundle, options: { sentence, framework, modelRoute, reasoningEffort } });
  await page.waitForFunction(() => window.__BABEL_DEV_GET_REPLAY_STEP_COUNT__?.() > 0);
  const replayCount = await page.evaluate(() => window.__BABEL_DEV_GET_REPLAY_STEP_COUNT__());
  summary.replayCount = replayCount;
  for (let index = 0; index < replayCount; index++) {
    summary.requestedFrame = index;
    await page.evaluate(index => window.__BABEL_DEV_SET_REPLAY_STEP__(index), index);
    const paint = await waitForReplayPaint(page, index);
    const payload = await page.evaluate(index => window.__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__(index), index);
    payloads.push({ index, payload });
    writeJson('replay-payloads.json', payloads);
    assertReplayCapturePayload(payload, index);
    session.assertHealthy();
    const file = `replay-${String(index).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(outDir, file), fullPage: true });
    session.assertHealthy();
    frames.push({ requestedFrame: index, ...paint, file,
      payloadSha256: sha256(JSON.stringify(payload)), screenshotSha256: sha256(fs.readFileSync(path.join(outDir, file))) });
  }
  writeViewer(replayCount);
  summary.ok = true;
} catch (error) {
  summary.error = String(error.stack || error);
  process.exitCode = 1;
  console.error(summary.error);
} finally {
  if (session) {
    summary.runtimeAssets = await session.assetReceipt();
    try { session.assertHealthy(); }
    catch (error) { summary.ok = false; summary.error ||= String(error); process.exitCode = 1; }
  }
  try { await session?.close(); summary.closed = true; }
  catch (error) { summary.ok = false; summary.closeError = String(error); process.exitCode = 1; }
  summary.diagnostics = session?.diagnostics || [];
  writeJson('render-summary.json', summary);
  if (values.verbose) console.error(JSON.stringify(summary.diagnostics, null, 2));
}
if (summary.ok) console.log(`Captured ${summary.replayCount} painted Replay frames to ${outDir}`);
