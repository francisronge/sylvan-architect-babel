import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { openCaptureSession } from './browserSession.mjs';
import { waitForDecodedImages } from './captureReadiness.mjs';

const { values } = parseArgs({ options: {
  'render-dir': { type: 'string' }, out: { type: 'string' }, browser: { type: 'string' },
  cols: { type: 'string', default: '2' }, 'frames-per-sheet': { type: 'string', default: '12' },
  width: { type: 'string', default: '1800' }, height: { type: 'string', default: '1200' }
} });
if (!values['render-dir'] || !values.out) throw new Error('Provide --render-dir and --out.');
const renderDir = path.resolve(values['render-dir']), outDir = path.resolve(values.out);
const browserPath = values.browser || process.env.BABEL_CHROME_BIN;
if (browserPath && !fs.existsSync(browserPath)) throw new Error(`Missing browser: ${browserPath}`);
const cols = Number(values.cols), framesPerSheet = Number(values['frames-per-sheet']);
const viewportWidth = Number(values.width), viewportHeight = Number(values.height);
if ([cols, framesPerSheet, viewportWidth, viewportHeight].some(n => !Number.isInteger(n) || n <= 0)) {
  throw new Error('Sheet counts and viewport dimensions must be positive integers.');
}
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw new Error(`Sheet output is not empty: ${outDir}`);
fs.mkdirSync(outDir, { recursive: true });
const summaryPath = path.join(renderDir, 'render-summary.json');
const captureSummary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : null;
if (captureSummary && captureSummary.ok !== true) throw new Error('Refusing sheets from an unsuccessful capture.');
const replayCount = captureSummary?.replayCount || fs.readdirSync(renderDir).filter(name => /^replay-\d+\.png$/i.test(name)).length;
if (!Number.isInteger(replayCount) || replayCount < 1) throw new Error(`No complete Replay capture in ${renderDir}.`);
const inputs = Array.from({ length: replayCount }, (_, index) => {
  const file = path.join(renderDir, `replay-${String(index).padStart(2, '0')}.png`);
  return { file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
});

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pad = (value) => String(value).padStart(2, '0');
const fileUrl = (filePath) => pathToFileURL(filePath).href;

const buildHtml = (frames) => {
  const title = `${path.basename(renderDir)} frames ${frames[0] + 1}-${frames.at(-1) + 1}`;
  const cellWidth = Math.floor((viewportWidth - 80 - (cols - 1) * 18) / cols);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #06110e;
      color: #dffcf2;
      font-family: system-ui, sans-serif;
    }
    h1 {
      margin: 0 0 18px;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${cols}, ${cellWidth}px);
      gap: 18px;
      align-items: start;
    }
    figure {
      margin: 0;
      border: 1px solid #1c6b58;
      background: #071713;
    }
    figcaption {
      padding: 8px 10px;
      color: #8ffff0;
      font-weight: 800;
      font-size: 14px;
      border-bottom: 1px solid #164438;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="grid">
    ${frames.map((frameIndex) => {
      const imagePath = path.join(renderDir, `replay-${pad(frameIndex)}.png`);
      return `<figure>
        <figcaption>Frame ${frameIndex + 1} / ${replayCount}</figcaption>
        <img src="${fileUrl(imagePath)}" alt="Frame ${frameIndex + 1}">
      </figure>`;
    }).join('\n')}
  </div>
</body>
</html>`;
};

let session;
const summary = { ok: false, renderDir, outDir, replayCount, framesPerSheet, cols, inputs, sheets: [] };
try {
  session = await openCaptureSession({ executablePath: browserPath, localFiles: true,
    viewport: { width: viewportWidth, height: viewportHeight } });
  summary.browser = { engine: session.engine, version: session.browserVersion };
  for (let start = 0, sheetIndex = 1; start < replayCount; start += framesPerSheet, sheetIndex++) {
    const frames = Array.from({ length: Math.min(framesPerSheet, replayCount - start) }, (_, index) => start + index);
    const stem = `contact-sheet-${pad(sheetIndex)}`, htmlPath = path.join(outDir, `${stem}.html`), pngPath = path.join(outDir, `${stem}.png`);
    fs.writeFileSync(htmlPath, buildHtml(frames));
    await session.page.goto(pathToFileURL(htmlPath).href);
    await waitForDecodedImages(session.page, frames.length);
    session.assertHealthy();
    await session.page.screenshot({ path: pngPath, fullPage: true });
    session.assertHealthy();
    summary.sheets.push(pngPath);
  }
  summary.ok = true;
} catch (error) {
  summary.error = String(error.stack || error); process.exitCode = 1; console.error(summary.error);
} finally {
  if (session) {
    summary.assets = await session.assetReceipt();
    try { session.assertHealthy(); }
    catch (error) { summary.ok = false; summary.error ||= String(error); process.exitCode = 1; }
  }
  try { await session?.close(); summary.closed = true; }
  catch (error) { summary.ok = false; summary.closeError = String(error); process.exitCode = 1; }
  summary.diagnostics = session?.diagnostics || [];
  fs.writeFileSync(path.join(outDir, 'contact-sheets.json'), JSON.stringify(summary, null, 2) + '\n');
}
if (summary.ok) console.log(`Wrote ${summary.sheets.length} decoded contact sheets to ${outDir}`);
