import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';

const engines = { chromium, webkit };

// Artifact captures own this browser. They never attach to a user's browser or
// storage, and every failure remains available even when verbose output is off.
export async function openCaptureSession({ engine = 'chromium', executablePath, viewport,
  origins = [], localFiles = false, timeout = 20_000 } = {}) {
  if (!engines[engine]) throw new Error(`Unsupported capture browser: ${engine}`);
  const diagnostics = [], assets = [], pendingAssets = [];
  const displayUrl = input => { const url = new URL(input); url.username = ''; url.password = ''; url.search = ''; return url.href; };
  const add = (kind, message, fatal = true) => {
    diagnostics.push({ kind, message: String(message).slice(0, 2000), fatal });
    if (diagnostics.length > 100) diagnostics.shift();
  };
  let browser, context, closing = false, cleanup;
  const close = () => cleanup ??= (async () => {
    closing = true;
    try { await context?.close(); }
    finally { await browser?.close(); }
  })();
  try {
    browser = await engines[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    browser.on('disconnected', () => { if (!closing) add('disconnected', 'Capture browser disconnected.'); });
    context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.on('pageerror', error => add('pageerror', error.stack || error));
    page.on('console', message => {
      if (message.type() === 'error') add('console', message.text());
    });
    page.on('requestfailed', request => { if (!closing) add('requestfailed', `${displayUrl(request.url())}: ${request.failure()?.errorText}`); });
    page.on('response', response => {
      if (response.status() >= 400) add('response', `${response.status()} ${displayUrl(response.url())}`);
      if (response.ok() && ['document', 'script', 'stylesheet', 'font', 'image'].includes(response.request().resourceType())) {
        pendingAssets.push(response.body().then(bytes => assets.push({ url: displayUrl(response.url()),
          type: response.request().resourceType(), sha256: createHash('sha256').update(bytes).digest('hex') }))
          .catch(error => { if (!closing) add('asset-evidence', `${displayUrl(response.url())}: ${error}`); }));
      }
    });
    page.on('crash', () => add('crash', 'Capture page crashed.'));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const allowed = ['data:', 'blob:'].includes(url.protocol)
        || (localFiles && url.protocol === 'file:')
        || (origins.includes(url.origin) && !url.pathname.startsWith('/api/'));
      if (allowed) return route.continue();
      add('unexpected-request', `${route.request().method()} ${displayUrl(url.href)}`);
      return route.abort();
    });
    return { page, diagnostics, browserVersion: browser.version(), engine, close,
      async assetReceipt() {
        let timer;
        try {
          await Promise.race([Promise.all(pendingAssets), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Runtime asset evidence timed out.')), timeout);
          })]);
        } catch (error) { add('asset-evidence', error); }
        finally { clearTimeout(timer); }
        return [...assets].sort((a, b) => a.url.localeCompare(b.url));
      },
      assertHealthy() {
        const failures = diagnostics.filter(entry => entry.fatal);
        if (failures.length) throw new Error(`Capture failed: ${failures.map(entry => `${entry.kind}: ${entry.message}`).join('\n')}`);
      }
    };
  } catch (error) {
    await close();
    throw error;
  }
}
