import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { collectPronouncedTerminalSequence } from '../replay/pronouncedTerminals.ts';

const DEFAULT_VIEWPORT = { width: 1600, height: 1000 };

const args = process.argv.slice(2);
const verboseEvents = [];

const recordVerboseEvent = (label, value) => {
  if (!hasArg('verbose')) return;
  verboseEvents.push({ label, value });
  if (verboseEvents.length > 20) verboseEvents.shift();
};

const readArg = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return args[index + 1] || fallback;
};

const hasArg = (name) => args.includes(`--${name}`);

const repoRoot = process.cwd();
const bundlePath = path.resolve(readArg('bundle'));
const outDir = path.resolve(readArg('out'));
const appUrl = readArg('app-url', 'http://127.0.0.1:5177');
const browserPath = readArg('browser', '');
const analysisIndex = Math.max(0, Number.parseInt(readArg('analysis-index', '0'), 10) || 0);
const viewport = {
  width: Number(readArg('width', String(DEFAULT_VIEWPORT.width))) || DEFAULT_VIEWPORT.width,
  height: Number(readArg('height', String(DEFAULT_VIEWPORT.height))) || DEFAULT_VIEWPORT.height
};

if (!bundlePath || !fs.existsSync(bundlePath)) {
  console.error('Missing --bundle file.');
  process.exit(1);
}
if (!outDir) {
  console.error('Missing --out directory.');
  process.exit(1);
}
if (!browserPath || !fs.existsSync(browserPath)) {
  console.error('Missing --browser executable.');
  process.exit(1);
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const rawBundleWrapper = readJson(bundlePath);
const sourceParseBundle = rawBundleWrapper.response || rawBundleWrapper.bundle || rawBundleWrapper;
if (!Array.isArray(sourceParseBundle?.analyses) || !sourceParseBundle.analyses[analysisIndex]) {
  console.error(`Bundle does not contain analysis index ${analysisIndex}.`);
  process.exit(1);
}
const parseBundle = {
  ...sourceParseBundle,
  analyses: [sourceParseBundle.analyses[analysisIndex]],
  ambiguityDetected: false,
  ambiguityNote: undefined
};
const request = rawBundleWrapper.request || {};
const firstAnalysis = Array.isArray(parseBundle.analyses) ? parseBundle.analyses[0] : null;
const sentence = String(
  request.sentence
  || rawBundleWrapper.sentence
  || parseBundle.sentence
  || collectPronouncedTerminalSequence(firstAnalysis?.tree).join(' ')
  || ''
).trim();
const framework = request.framework === 'minimalism' || firstAnalysis?.provenance?.framework === 'minimalism'
  ? 'minimalism'
  : 'xbar';
const modelRoute = String(
  request.modelRoute
  || rawBundleWrapper.requestedRoute
  || parseBundle.requestedModelRoute
  || firstAnalysis?.provenance?.modelRoute
  || 'gemini'
).trim();
const reasoningEffort = String(
  request.reasoningEffort
  || rawBundleWrapper.requestedReasoningEffort
  || parseBundle.requestedReasoningEffort
  || firstAnalysis?.provenance?.requestedReasoningEffort
  || firstAnalysis?.provenance?.reasoningEffort
  || ''
).trim();

const fetchJson = (url) => new Promise((resolve, reject) => {
  const req = http.get(url, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`${url} returned HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
  req.on('error', reject);
  req.setTimeout(5000, () => {
    req.destroy(new Error(`Timed out fetching ${url}`));
  });
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stopOwnedProcess = async (child, timeoutMs = 5000) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exited.then(() => true),
    wait(timeoutMs).then(() => false)
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGKILL');
  await Promise.race([exited, wait(2000)]);
};

const waitFor = async (fn, timeoutMs, label) => {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await wait(120);
  }
  const labelText = typeof label === 'function' ? label() : label;
  throw new Error(`${labelText} timed out${lastError ? `: ${lastError.message}` : ''}`);
};

const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(() => resolve(port));
  });
  server.on('error', reject);
});

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.eventHandlers = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method && this.eventWaiters.has(message.method)) {
        const waiters = this.eventWaiters.get(message.method);
        this.eventWaiters.delete(message.method);
        waiters.forEach((resolve) => resolve(message.params || {}));
      }
      if (message.method && this.eventHandlers.has(message.method)) {
        this.eventHandlers.get(message.method).forEach((handler) => handler(message.params || {}));
      }
    });
  }

  command(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP command ${method}`));
      }, timeoutMs);
      timeout.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  waitForEvent(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push(resolve);
      this.eventWaiters.set(method, waiters);
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs).unref?.();
    });
  }

  onEvent(method, handler) {
    const handlers = this.eventHandlers.get(method) || [];
    handlers.push(handler);
    this.eventHandlers.set(method, handlers);
  }

  close() {
    this.ws.close();
  }
}

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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
    <button id="canopy">Canopy</button>
    <button id="notes">Notes</button>
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
    document.getElementById('canopy').addEventListener('click', () => { shot.src = imageSrc('canopy.png'); label.textContent = 'Canopy'; });
    document.getElementById('notes').addEventListener('click', () => { shot.src = imageSrc('notes.png'); label.textContent = 'Notes'; });
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

const capture = async (client, filePath) => {
  const result = await client.command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true
  }, 120000);
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
};

const stripReplayLeafSuffix = (value = '') =>
  String(value || '').trim().replace(/::__[^:]+$/, '');

const STRUCTURAL_CATEGORY_RE = /^(?:CP|C|TP|T|T'|Tbar|vP|v|VP|V|DP|D|NP|N|PP|P|AP|A|AdvP|Adv|XP|X)$/i;

const collectNodeIdMetadata = (node, ids = new Map(), hiddenAncestor = false) => {
  if (!node || typeof node !== 'object') return ids;
  const nodeId = String(node.id || '').trim();
  const children = Array.isArray(node.children) ? node.children : [];
  const layoutOnly = node.replayLayoutOnly === true;
  const surface = String(node.word || node.label || '').trim();
  if (nodeId) {
    const nextMetadata = {
      hiddenAncestor,
      layoutOnly,
      bareStructuralLeaf: children.length === 0 && !String(node.word || '').trim() && STRUCTURAL_CATEGORY_RE.test(surface)
    };
    const previousMetadata = ids.get(nodeId);
    ids.set(nodeId, previousMetadata
      ? {
        hiddenAncestor: previousMetadata.hiddenAncestor && nextMetadata.hiddenAncestor,
        layoutOnly: previousMetadata.layoutOnly && nextMetadata.layoutOnly,
        bareStructuralLeaf: previousMetadata.bareStructuralLeaf && nextMetadata.bareStructuralLeaf
      }
      : nextMetadata);
  }
  children.forEach((child) => collectNodeIdMetadata(child, ids, hiddenAncestor || layoutOnly));
  return ids;
};

const pruneDuplicateBareStructuralLeavesOnce = (node, nonEmptyIds = null) => {
  if (!node || typeof node !== 'object') return node;
  const idsWithChildren = nonEmptyIds || new Set();
  if (!nonEmptyIds) {
    const collect = (current) => {
      if (!current || typeof current !== 'object') return;
      const currentId = String(current.id || '').trim();
      const children = Array.isArray(current.children) ? current.children : [];
      if (currentId && children.length > 0) idsWithChildren.add(currentId);
      children.forEach(collect);
    };
    collect(node);
  }

  const prune = (current) => {
    if (!current || typeof current !== 'object') return null;
    const currentId = String(current.id || '').trim();
    const children = Array.isArray(current.children) ? current.children : [];
    const surface = String(current.word || current.label || '').trim();
    if (
      currentId
      && children.length === 0
      && !String(current.word || '').trim()
      && idsWithChildren.has(currentId)
      && STRUCTURAL_CATEGORY_RE.test(surface)
    ) {
      return null;
    }
    const nextChildren = children.map(prune).filter(Boolean);
    const next = { ...current };
    if (nextChildren.length > 0) next.children = nextChildren;
    else delete next.children;
    return next;
  };

  return prune(node) || node;
};

const pruneDuplicateBareStructuralLeaves = (node) => {
  let current = node;
  for (let pass = 0; pass < 8; pass += 1) {
    const before = JSON.stringify(current);
    const next = pruneDuplicateBareStructuralLeavesOnce(current);
    const after = JSON.stringify(next);
    current = next;
    if (after === before) break;
  }
  return current;
};

const canonicalizePayloadVisibleIds = (payload) => {
  if (!payload || !payload.replayCanvasData || !Array.isArray(payload.replayVisibleNodeIds)) return payload;
  const replayCanvasData = pruneDuplicateBareStructuralLeaves(payload.replayCanvasData);
  const operation = String(payload.operation || '').trim();
  const strictHiddenAncestorFilter = operation === 'LexicalSelect' || operation === 'Project';
  const nodeMetadataById = collectNodeIdMetadata(replayCanvasData);
  const visibleIds = [];
  payload.replayVisibleNodeIds.forEach((nodeId) => {
    const normalized = String(nodeId || '').trim();
    if (!normalized) return;
    const candidates = [
      normalized,
      stripReplayLeafSuffix(normalized)
    ].filter(Boolean);
    const resolved = candidates.find((candidate) => {
      const metadata = nodeMetadataById.get(candidate);
      return Boolean(
        metadata
        && (!strictHiddenAncestorFilter || metadata.hiddenAncestor !== true)
        && metadata.layoutOnly !== true
        && metadata.bareStructuralLeaf !== true
      );
    });
    const syntheticLeaf = strictHiddenAncestorFilter
      ? candidates.find((candidate) => {
        const metadata = nodeMetadataById.get(candidate);
        return Boolean(
          metadata
          && /::__[^:]+$/.test(candidate)
          && metadata.layoutOnly !== true
          && metadata.bareStructuralLeaf !== true
        );
      })
      : '';
    const retained = resolved || syntheticLeaf;
    if (retained && !visibleIds.includes(retained)) visibleIds.push(retained);
  });
  return {
    ...payload,
    replayCanvasData,
    replayVisibleNodeIds: visibleIds
  };
};

const describeInvalidReplayPayload = (payload, index) => {
  if (!payload || typeof payload !== 'object') return `frame ${index + 1}: missing payload`;
  if (!payload.replayCanvasData || typeof payload.replayCanvasData !== 'object') {
    return `frame ${index + 1}: missing replayCanvasData`;
  }
  if (!Array.isArray(payload.replayVisibleNodeIds)) {
    return `frame ${index + 1}: replayVisibleNodeIds is not an array`;
  }
  if (payload.replayVisibleNodeIds.length === 0) {
    return `frame ${index + 1}: no visible replay nodes`;
  }
  const operation = String(payload.operation || '').trim();
  if (!operation) return `frame ${index + 1}: missing replay operation`;
  return '';
};

const assertReplayPayloadsAreRenderable = (payloads) => {
  const problems = payloads
    .map(({ index, payload }) => describeInvalidReplayPayload(payload, index))
    .filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`Invalid replay capture:\n${problems.join('\n')}`);
  }
};

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.readdirSync(outDir)
    .filter((name) => /^replay-\d+\.png$/i.test(name))
    .forEach((name) => fs.unlinkSync(path.join(outDir, name)));
  const browserDebugPort = await findFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-capture-'));
  let browserExited = false;
  let browserExitCode = null;
  let browserExitSignal = null;
  const browser = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-accelerated-2d-canvas',
    '--disable-accelerated-video-decode',
    '--disable-features=VizDisplayCompositor',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-gl=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${browserDebugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${viewport.width},${viewport.height}`,
    `${appUrl}/?devCapture=1`
  ], {
    stdio: hasArg('verbose') ? 'inherit' : 'ignore'
  });
  browser.once('exit', (code, signal) => {
    browserExited = true;
    browserExitCode = code;
    browserExitSignal = signal;
  });

  try {
    await waitFor(async () => {
      if (browserExited) {
        throw new Error(`browser exited before capture with code ${browserExitCode ?? 'null'} signal ${browserExitSignal ?? 'null'}`);
      }
      const targets = await fetchJson(`http://127.0.0.1:${browserDebugPort}/json/list`);
      return Array.isArray(targets) && targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    }, 10000, 'browser target');

    const targets = await fetchJson(`http://127.0.0.1:${browserDebugPort}/json/list`);
    const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.command('Page.enable');
    await client.command('Runtime.enable');
    client.onEvent('Runtime.exceptionThrown', (params) => {
      recordVerboseEvent('Runtime.exceptionThrown', {
        text: params?.exceptionDetails?.text,
        description: params?.exceptionDetails?.exception?.description,
        url: params?.exceptionDetails?.url,
        lineNumber: params?.exceptionDetails?.lineNumber,
        columnNumber: params?.exceptionDetails?.columnNumber
      });
    });
    client.onEvent('Runtime.consoleAPICalled', (params) => {
      recordVerboseEvent('Runtime.consoleAPICalled', {
        type: params?.type,
        args: (Array.isArray(params?.args) ? params.args : [])
          .map((arg) => String(arg?.value ?? arg?.description ?? '').slice(0, 500))
      });
    });
    await client.command('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await waitFor(async () => {
      const result = await client.command('Runtime.evaluate', {
        expression: 'typeof window.__BABEL_DEV_SET_ANALYSIS__ === "function"',
        returnByValue: true
      });
      return result?.result?.value === true;
    }, 15000, 'Babel dev hooks');

    await client.command('Runtime.evaluate', {
      expression: `window.__BABEL_DEV_SET_ANALYSIS__(${JSON.stringify(parseBundle)}, ${JSON.stringify({ sentence, framework, modelRoute, reasoningEffort })}); undefined;`,
      awaitPromise: true,
      returnByValue: true
    });
    await client.command('Runtime.evaluate', {
      expression: 'window.__BABEL_DEV_SET_CAPTURE_MODE__(true); window.__BABEL_DEV_SET_INPUT_VISIBILITY__(false); window.__BABEL_DEV_SET_TAB__("derivation"); undefined;',
      returnByValue: true
    });

    const replayCount = await waitFor(async () => {
      const result = await client.command('Runtime.evaluate', {
        expression: 'typeof window.__BABEL_DEV_GET_REPLAY_STEP_COUNT__ === "function" ? window.__BABEL_DEV_GET_REPLAY_STEP_COUNT__() : 0',
        returnByValue: true
      });
      return Number(result?.result?.value) > 0 ? Number(result.result.value) : 0;
    }, 30000, 'replay steps');

    const payloads = [];
    for (let index = 0; index < replayCount; index += 1) {
      await client.command('Runtime.evaluate', {
        expression: `window.__BABEL_DEV_SET_REPLAY_STEP__(${index}); undefined;`,
        returnByValue: true
      });
      let lastPayloadProblem = '';
      const payload = await waitFor(async () => {
        const result = await client.command('Runtime.evaluate', {
          expression: `window.__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__(${index})`,
          returnByValue: true
        });
        const canonicalPayload = canonicalizePayloadVisibleIds(result?.result?.value || null);
        lastPayloadProblem = describeInvalidReplayPayload(canonicalPayload, index);
        return lastPayloadProblem ? null : canonicalPayload;
      }, 30000, () => `replay payload ${index + 1}${lastPayloadProblem ? ` (${lastPayloadProblem})` : ''}`);
      payloads.push({ index, payload });
      await capture(client, path.join(outDir, `replay-${String(index).padStart(2, '0')}.png`));
    }
    assertReplayPayloadsAreRenderable(payloads);

    const replayPayloadsPath = path.join(outDir, 'replay-payloads.json');
    writeJson(replayPayloadsPath, payloads.map(({ index, payload }) => ({
      index,
      payload: canonicalizePayloadVisibleIds(payload)
    })));
    writeJson(replayPayloadsPath, readJson(replayPayloadsPath).map(({ index, payload }) => ({
      index,
      payload: canonicalizePayloadVisibleIds(payload)
    })));

    await client.command('Runtime.evaluate', {
      expression: 'window.__BABEL_DEV_SET_TAB__("tree"); undefined;',
      returnByValue: true
    });
    await wait(350);
    await capture(client, path.join(outDir, 'canopy.png'));

    await client.command('Runtime.evaluate', {
      expression: 'window.__BABEL_DEV_SET_TAB__("notes"); undefined;',
      returnByValue: true
    });
    await wait(350);
    await capture(client, path.join(outDir, 'notes.png'));

    writeJson(path.join(outDir, 'render-summary.json'), {
      ok: true,
      bundle: bundlePath,
      analysisIndex,
      server: appUrl,
      replayCount,
      canopy: path.join(outDir, 'canopy.png'),
      notes: path.join(outDir, 'notes.png'),
      sentence,
      framework,
      modelRoute,
      reasoningEffort
    });
    writeViewer(replayCount);
    client.close();
    console.log(`Captured ${replayCount} replay frame(s) to ${path.relative(repoRoot, outDir)}`);
  } finally {
    await stopOwnedProcess(browser);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Chrome can hold a profile lock briefly after process shutdown on Windows.
      // The capture result is more important than cleanup, and temp profiles are disposable.
    }
  }
};

main().catch((err) => {
  console.error(err.stack || err.message || err);
  if (verboseEvents.length > 0) {
    console.error('Recent browser runtime events:');
    console.error(JSON.stringify(verboseEvents, null, 2));
  }
  process.exit(1);
});
