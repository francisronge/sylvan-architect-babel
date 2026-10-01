import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { __test__ } from '../../server/babelParser.js';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../../replay/relations/renderPlanCompiler.ts';
import { TIER2_FACET_RECIPES } from '../../replay/relations/tier2FacetRecipes.ts';
import { buildPublicFacetFixture } from '../helpers/tier2PublicFixtures.mjs';
import { productionDomChecks } from '../helpers/tier2ProductionExpectations.mjs';

// Set BABEL_TIER2_ATLAS_URL to reuse an already served production atlas.
// BABEL_TIER2_PRODUCTION_EVIDENCE chooses an external capture/report directory.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const zoomRecipes = new Set(['operator-binding', 'pf.rewrite', 'feature-sharing', 'feature.dependency', 'judgment.verdict']);

async function sourceManifest() {
  const files = ['types.ts', 'styles.css', 'tailwind.config.cjs', 'package-lock.json'];
  const visit = async directory => {
    for (const entry of await fs.readdir(path.join(repo, directory), { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (/\.(?:[cm]?[jt]sx?|css)$/.test(name)) files.push(name);
    }
  };
  for (const directory of ['components', 'replay', 'contractQualification', 'server/babelParser']) await visit(directory);
  files.push('tests/helpers/tier2PublicFixtures.mjs', 'tests/helpers/tier2ProductionExpectations.mjs',
    'tests/helpers/tier2ProductionEntry.tsx', 'tests/browser/tier2ProductionRecipes.test.mjs');
  const sources = await Promise.all(files.sort().map(async file => ({ file, sha256: sha(await fs.readFile(path.join(repo, file))) })));
  return { sha256: sha(JSON.stringify(sources)), sources };
}

function buildSpecimens() {
  const movement = TIER2_FACET_RECIPES.find(recipe => recipe.id === 'movement.path');
  const examples = [...TIER2_FACET_RECIPES.map(recipe => ({ recipe, options: {}, variant: 'default' })),
    { recipe: movement, options: { movementRoute: 'orthogonal' }, variant: 'orthogonal' },
    { recipe: movement, options: { crossWorkspace: true }, variant: 'cross-workspace' }];
  return ['xbar', 'minimalism'].flatMap(framework => examples.map(({ recipe, options, variant }) => {
    const { sentence, derivationStages, relationStageIndex } = buildPublicFacetFixture(recipe, options);
    const bundle = __test__.normalizeParseBundle({ derivationStages }, framework, sentence, 'grok', true);
    const analysis = bundle.analyses[0], activeLens = recipe.id === 'presentation.lens';
    const replay = prepareReplay({ sentence, inputTokens: bundle.inputTokens, derivationStages: analysis.derivationStages, includePlayback: true });
    const plan = activeLens ? compileRelationRenderPlan(analysis.derivationStages, { activeLens: true }) : replay.relationRenderPlan;
    const ownedItems = plan.frames[relationStageIndex].items.flatMap((item, index) => item.tier2FacetId === recipe.id ? [{ index, item }] : []);
    const frameIndex = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === relationStageIndex && step.replayRelationIdentity.relationIndex === 0);
    assert(frameIndex >= 0, `${recipe.id}: missing owning moment`);
    return { id: `recipe-${framework}-${recipe.id.replaceAll('.', '-')}${variant === 'default' ? '' : `-${variant}`}`,
      recipe: recipe.id, framework, variant, sentence, bundle, relationStageIndex, relationIndex: 0, frameIndex,
      activeLens, expectedPrimitives: [...new Set(ownedItems.flatMap(({ item }) => item.tier2OutputPieces || []))],
      productionDomChecks: productionDomChecks(recipe.id, variant, ownedItems) };
  }));
}

// Existence is insufficient: check paintable geometry, ancestor visibility, text,
// and attributes. A canvas must contain nontransparent pixels, not just exist.
async function paintedChecks(page, checks) {
  return page.evaluate(checks => {
    const visible = element => {
      if (element.closest('defs,marker,clipPath,mask')) return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      const rect = element.getBoundingClientRect();
      if (!Number.isFinite(rect.x + rect.y + rect.width + rect.height) || (!rect.width && !rect.height)) return false;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return false;
      if (element instanceof SVGGeometryElement && !element.getTotalLength()) return false;
      if (element instanceof SVGElement) {
        const style = getComputedStyle(element);
        if ((style.fill === 'none' || Number(style.fillOpacity) === 0)
          && (style.stroke === 'none' || Number(style.strokeOpacity) === 0 || parseFloat(style.strokeWidth) === 0)) return false;
      }
      if (element instanceof SVGTextContentElement && !element.textContent.trim()) return false;
      return true;
    };
    return checks.filter(check => check.selector).map(check => {
      const matches = [...document.querySelectorAll(check.selector)].filter(visible);
      let qualified = matches;
      if (check.textIncludes) qualified = qualified.filter(element => element.textContent.includes(check.textIncludes));
      if (check.textEquals !== undefined) qualified = qualified.filter(element => element.textContent === check.textEquals);
      if (check.attribute) qualified = qualified.filter(element => (element.getAttribute(check.attribute.name) || '').includes(check.attribute.includes));
      if (check.kind === 'canvas') qualified = qualified.filter(element => {
        if (!(element instanceof HTMLCanvasElement) || !element.width || !element.height) return false;
        const pixels = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data;
        for (let i = 3; pixels && i < pixels.length; i += 4) if (pixels[i] > 0) return true;
        return false;
      });
      return { piece: check.piece, selector: check.selector, visibleCount: matches.length, qualifyingCount: qualified.length,
        minCount: check.minCount || 1, exactCount: check.exactCount, pass: qualified.length >= (check.minCount || 1)
          && (check.exactCount === undefined || (matches.length === check.exactCount && qualified.length === check.exactCount))
          && (!check.distinctText || new Set(qualified.map(element => element.textContent.trim())).size >= (check.minCount || 1)),
        geometry: qualified.map(element => { const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, text: element.textContent?.slice(0, 160) }; }) };
    });
  }, checks);
}

async function ownedVisibleMarks(page, owner) {
  return page.evaluate(owner => {
    const visible = element => {
      if (element.closest('defs,marker,clipPath,mask')) return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      const box = element.getBoundingClientRect();
      return (box.width > 0 || box.height > 0) && Number.isFinite(box.x + box.y + box.width + box.height);
    };
    const nodes = new Set();
    document.querySelectorAll(`[data-vr-owner-refs~="${owner}"]`).forEach(host => {
      if (host.matches('path,line,rect,ellipse,circle,text') && visible(host)) nodes.add(host);
      host.querySelectorAll('path,line,rect,ellipse,circle,text').forEach(element => { if (visible(element)) nodes.add(element); });
    });
    return nodes.size;
  }, owner);
}

async function go(page, index) {
  const slider = page.getByRole('slider', { name: 'Replay frame' });
  await slider.waitFor();
  await slider.evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
  await page.waitForFunction(index => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(index), index);
  await page.evaluate(() => document.fonts.ready);
}

function loopbackUrl(value) {
  const url = new URL(value.endsWith('/') ? value : `${value}/`);
  assert(['http:', 'https:'].includes(url.protocol));
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'BABEL_TIER2_ATLAS_URL must be a loopback review URL.');
  return url;
}

test('public Tier 2 recipes paint their intended pieces in the production renderer', { timeout: 600_000 }, async () => {
  const started = new Date().toISOString();
  const output = process.env.BABEL_TIER2_PRODUCTION_EVIDENCE || await fs.mkdtemp(path.join(os.tmpdir(), 'babel-tier2-production-'));
  await fs.mkdir(output, { recursive: true });
  const source = await sourceManifest();
  let server, browser, base, specimens, runtimeProvenance, compiledSources = [], runtimeAsset = null;
  const results = [], failures = [], errors = [], blockedProviderRequests = [];
  try {
    const provided = process.env.BABEL_TIER2_ATLAS_URL;
    if (provided) {
      base = loopbackUrl(provided);
      const response = await fetch(new URL('catalog.json', base));
      assert(response.ok, `Atlas catalog returned ${response.status}`);
      specimens = await response.json();
      const provenanceResponse = await fetch(new URL('runtime-provenance.json', base));
      assert(provenanceResponse.ok, 'Prebuilt atlas must expose its compiled-source provenance.');
      runtimeProvenance = await provenanceResponse.json();
      const compiled = runtimeProvenance.replay;
      assert(compiled?.sources?.length && compiled.jsSha256, 'Atlas must identify the actual compiled production sources.');
      compiledSources = await Promise.all(compiled.sources.map(async item => {
        const currentSha256 = sha(await fs.readFile(path.resolve(repo, item.path)));
        return { path: item.path, builtSha256: item.sha256, currentSha256, match: currentSha256 === item.sha256 };
      }));
      assert(compiledSources.every(item => item.match), 'Prebuilt renderer is stale against the current source candidate. Rebuild the atlas.');
      assert(specimens.every(specimen => specimen.recipe && specimen.productionDomChecks?.length), 'Use the production recipe atlas, not a general parse review.');
    } else {
      specimens = buildSpecimens();
      const byId = new Map(specimens.map(specimen => [specimen.id, specimen]));
      server = await createServer({ root: repo, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'tier2-production-fixtures', configureServer(vite) {
        vite.middlewares.use('/__tier2_fixture__', async (request, response) => {
          const url = new URL(request.url || '/', 'http://127.0.0.1');
          const specimen = byId.get(url.searchParams.get('id'));
          if (!specimen) { response.writeHead(404).end(); return; }
          const payload = JSON.stringify(specimen).replaceAll('<', '\\u003c');
          const html = await vite.transformIndexHtml(request.originalUrl || request.url || '/', `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;min-height:100%;background:#020c08}</style></head><body><div id="root"></div><script id="tier2-specimen" type="application/json">${payload}</script><script type="module" src="/tests/helpers/tier2ProductionEntry.tsx"></script></body></html>`);
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(html);
        });
      } }] });
      await server.listen();
      base = new URL(`http://127.0.0.1:${server.httpServer.address().port}/`);
      for (const specimen of specimens) specimen.file = `__tier2_fixture__?id=${encodeURIComponent(specimen.id)}`;
      runtimeProvenance = { kind: 'production-tree-visualizer-vite', source };
    }
    const expectedCases = 2 * (TIER2_FACET_RECIPES.length + 2);
    assert.equal(specimens.length, expectedCases, 'Keep every recipe/framework/route control in the denominator.');
    assert.equal(new Set(specimens.map(specimen => specimen.id)).size, expectedCases, 'Repeated recipe specimen.');
    for (const framework of ['xbar', 'minimalism']) for (const recipe of TIER2_FACET_RECIPES) {
      assert(specimens.some(specimen => specimen.framework === framework && specimen.recipe === recipe.id && specimen.variant === 'default'), `Missing ${framework} ${recipe.id}`);
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push({ url: page.url(), message: String(error) }));
    await page.route('**/api/**', route => { blockedProviderRequests.push(route.request().url()); return route.abort(); });
    for (const specimen of specimens) {
      const result = { id: specimen.id, recipe: specimen.recipe, framework: specimen.framework, variant: specimen.variant,
        frameIndex: specimen.frameIndex, relationStageIndex: specimen.relationStageIndex, relationIndex: specimen.relationIndex,
        activeLens: specimen.activeLens, expectedPrimitives: specimen.expectedPrimitives,
        manual: specimen.productionDomChecks.filter(check => !check.selector) };
      results.push(result);
      try {
        await page.goto(new URL(specimen.file, base).href);
        if (provided && !runtimeAsset) {
          const runtimeUrl = await page.locator('script[src]').evaluateAll(elements => elements.find(element => /\/runtime-[^/]+\.js$/.test(element.src))?.src);
          assert(runtimeUrl, 'No production runtime asset was loaded.');
          const response = await fetch(runtimeUrl);
          assert(response.ok);
          const actualSha256 = sha(Buffer.from(await response.arrayBuffer()));
          runtimeAsset = { url: runtimeUrl, sha256: actualSha256, matchesDeclared: actualSha256 === runtimeProvenance.replay.jsSha256 };
          assert(runtimeAsset.matchesDeclared, 'Loaded runtime bytes differ from the compiled-source manifest.');
        }
        await page.locator('svg[data-babel-rendered-step]').waitFor();
        await go(page, specimen.frameIndex);
        assert.equal(await page.locator('[data-atlas-lens-active]').getAttribute('data-atlas-lens-active'), String(specimen.activeLens));
        const owner = `${specimen.relationStageIndex}:${specimen.relationIndex}`;
        // Poll only while a declared visual animation is still settling.
        const until = Date.now() + 3000;
        do {
          result.checks = await paintedChecks(page, specimen.productionDomChecks);
          if (result.checks.every(check => check.pass) || Date.now() >= until) break;
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        } while (true);
        assert(result.checks.every(check => check.pass), `Missing visible production piece(s): ${result.checks.filter(check => !check.pass).map(check => check.piece + ' ' + check.selector).join(', ')}`);
        result.owningMarks = await ownedVisibleMarks(page, owner);
        assert(result.owningMarks > 0, 'No visibly painted element retains this exact authored owner.');
        if (specimen.frameIndex > 0) {
          await go(page, specimen.frameIndex - 1);
          result.marksBeforeMoment = await ownedVisibleMarks(page, owner);
          assert.equal(result.marksBeforeMoment, 0, 'Claim-owned marks appeared before the owning relation moment.');
          await go(page, specimen.frameIndex);
        }
        if (specimen.framework === 'xbar' && zoomRecipes.has(specimen.recipe)) {
          const tree = page.locator('svg[data-babel-rendered-step]');
          const box = await tree.boundingBox();
          await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
          await page.mouse.wheel(0, -250);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          result.zoomChecks = await paintedChecks(page, specimen.productionDomChecks);
          assert(result.zoomChecks.every(check => check.pass), 'A production piece disappeared or lost valid visible geometry after zoom.');
          if (process.env.BABEL_TIER2_CAPTURE_SAMPLES === '1') await page.screenshot({ path: path.join(output, `${specimen.id}.png`) });
        }
        result.domPassed = true;
      } catch (error) {
        result.domPassed = false; result.error = String(error);
        failures.push({ id: specimen.id, error: result.error });
        await page.screenshot({ path: path.join(output, `${specimen.id}-failure.png`) }).catch(() => {});
      }
    }
  } finally {
    await browser?.close();
    await server?.close();
    const finalSource = await sourceManifest();
    const report = { started, finished: new Date().toISOString(), providerCallsMade: 0,
      expectedCases: specimens?.length ?? null, attemptedCases: results.length,
      domPassedCases: results.filter(result => result.domPassed).length,
      manualChecks: results.flatMap(result => result.manual.map(check => ({ id: result.id, ...check }))),
      source, sourceUnchangedDuringRun: finalSource.sha256 === source.sha256, runtimeProvenance, compiledSources, runtimeAsset,
      errors, blockedProviderRequests, failures, results,
      limits: 'Positive controls verify production dispatch and visible paint, not model generation quality, linguistic correctness, visual elegance, all alternate shapes, or screen-relative spacing under every interaction. Manual checks remain explicit.' };
    await fs.writeFile(path.join(output, 'production-recipes.json'), JSON.stringify(report, null, 2));
  }
  assert.equal((await sourceManifest()).sha256, source.sha256, 'Source changed during production verification.');
  assert.deepEqual(blockedProviderRequests, [], 'Unexpected API request; all fixtures must stay provider-free.');
  assert.deepEqual(errors, [], 'Production page errors.');
  assert.deepEqual(failures, [], `Production piece failures. Evidence: ${output}`);
});
