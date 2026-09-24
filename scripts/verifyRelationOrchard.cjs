#!/usr/bin/env node
/**
 * Visual check for the production Relation Orchard.
 *
 * The lab's unit tests prove the adapter derives the right lens objects. They
 * cannot tell you whether a card actually drew anything, which is how three
 * regressions reached the maintainer's screen. This harness opens the real page
 * in Chromium and reports, per card, what is on the canvas.
 *
 * Browser-only by design: it is a research harness, never part of `verify:all`.
 *
 *   node scripts/verifyRelationOrchard.cjs
 *   node scripts/verifyRelationOrchard.cjs --json
 */

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadChromium, resolveChromiumLaunchOptions } = require('../.artifacts/helpers/loadPlaywright.cjs');

const ORCHARD_PAGE = path.resolve(__dirname, '../docs/research/relation-orchard/orchard.html');
const SETTLE_TIMEOUT_MS = 45000;

/**
 * Cards allowed to draw nothing. Empty on purpose: every Orchard grammar has a
 * drawing. Any card going dark is a real failure.
 */
const KNOWN_UNDRAWN = new Set([]);

/**
 * What each grammar actually puts on the canvas. Some renderers append a layer
 * group; others only add classes to existing labels (ellipsis, LF ghosting), so
 * checking for layer groups alone reports false negatives.
 */
const OVERLAY_SELECTORS = {
  movementArrow: '.movement-arrow',
  trajectory: '.babel-trajectory-path',
  control: '.babel-control-relation-layer, .babel-control-dependency',
  predication: '.babel-predication-relation-layer, .babel-predication-path',
  pairMerge: '.babel-pair-merge-relation-layer, .babel-pair-merge-arc',
  blockedExtraction: '.babel-blocked-extraction-relation-layer, .babel-blocked-extraction-path',
  verdict: '.babel-analysis-verdict',
  operatorVariable: '.babel-operator-variable-relation-layer, .babel-operator-variable-path',
  deletion: '.babel-deletion-terminal-strike-layer, .babel-partial-copy-deletion-layer',
  splitAntecedence: '.babel-split-antecedence-path, .babel-split-antecedence-origin',
  fallback: [
    '.vr-fallback-frame',
    '.vr-anchor-set-badge',
    '.vr-anchor-set-rail'
  ].join(', '),
  idiomChunk: '.babel-idiom-chunk-relation-layer, .babel-idiom-domain-bracket',
  binding: '.babel-binding-relation-layer, .babel-binding-domain',
  coindex: '.babel-coindex-relation-layer',
  island: '.babel-island-relation-layer',
  phase: '.babel-phase-relation-layer, .babel-phase-arc',
  domainLocality: '.babel-domain-locality-relation-layer',
  feature: '.babel-feature-relation-layer, .babel-feature-plaque',
  agreementCase: '.babel-agreement-case-relation-layer',
  theta: '.babel-theta-relation-layer, .babel-theta-grid-plate',
  intervention: '.babel-intervention-relation-layer',
  ellipsis: '.babel-ellipsis-ghost-label, .babel-ellipsis-site-label, .babel-ellipsis-antecedent-label',
  multidominance: '.babel-multidominance-relation-layer, .babel-multidominance-branch',
  argumentSharing: '.babel-argument-sharing-relation-layer, .babel-argument-sharing-domain, .babel-argument-sharing-object-box',
  pf: '.babel-pf-relation-layer, .babel-pf-plate-shell',
  pfMorphology: '.babel-pf-morphology-relation-layer',
  lf: '.babel-lf-relation-layer, .babel-lf-operator-mark, .babel-lf-strike, .babel-lf-ghost-label',
  focus: '.babel-focus-relation-layer, .babel-focus-branch-mask',
  scopeInformation: '.babel-scope-information-relation-layer',
  forestLight: '.babel-forest-light-canvas',
  lensNode: '.babel-lens-node'
};

const collectCards = (selectors) => Array.from(
  document.querySelectorAll('#babel-current-renderer-lab > .babel-render-grid:not(.babel-fbproto-lane) > .babel-render-card')
).map((card) => {
  const text = card.textContent || '';
  const replayMatch = text.match(/Replay\s+(\d+)\s*\/\s*(\d+)/);
  const overlays = {};
  Object.entries(selectors).forEach(([name, selector]) => {
    const count = card.querySelectorAll(selector).length;
    if (count > 0) overlays[name] = count;
  });
  return {
    archetype: card.getAttribute('data-lab-case') || '',
    inactive: card.getAttribute('data-card-state') === 'inactive',
    title: card.querySelector('h3')?.textContent?.trim() || '',
    lensLabel: card.querySelector('.babel-lens-toggle')?.textContent?.trim() || null,
    replayAt: replayMatch ? Number(replayMatch[1]) : null,
    replayOf: replayMatch ? Number(replayMatch[2]) : null,
    contractNotes: Array.from(card.querySelectorAll('.babel-contract-report li'))
      .map((item) => item.textContent?.trim())
      .filter(Boolean),
    substitutePaint: card.querySelectorAll('.babel-fbproto-layer').length,
    svgCount: card.querySelectorAll('.babel-render-mount svg').length,
    nodeLabelCount: card.querySelectorAll('.babel-render-mount text').length,
    overlays
  };
});

const main = async () => {
  const asJson = process.argv.includes('--json');
  const chromium = loadChromium();
  const browser = await chromium.launch(resolveChromiumLaunchOptions({ headless: true }));
  const consoleErrors = [];
  let cards = [];
  let sourceImages = { entries: 0, illustratedEntries: 0, images: 0, broken: [] };

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(pathToFileURL(ORCHARD_PAGE).href, { waitUntil: 'load' });
    await page.waitForSelector('#babel-current-renderer-lab > .babel-render-grid:not(.babel-fbproto-lane) > .babel-render-card', { timeout: SETTLE_TIMEOUT_MS });
    await page.waitForSelector('#babel-selected-sources .babel-source-figure-entry', { timeout: SETTLE_TIMEOUT_MS });

    // The lab walks each card to its final replay frame on a timer. Wait for
    // every card to stop advancing rather than guessing a fixed delay.
    await page.waitForFunction(() => {
      const counters = Array.from(
        document.querySelectorAll('#babel-current-renderer-lab > .babel-render-grid:not(.babel-fbproto-lane) > .babel-render-card')
      )
        .map((card) => (card.textContent || '').match(/Replay\s+(\d+)\s*\/\s*(\d+)/))
        .filter(Boolean);
      if (counters.length === 0) return false;
      return counters.every((match) => Number(match[1]) === Number(match[2]));
    }, null, { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

    /**
     * Reaching the final frame is not the same as having drawn the overlays:
     * the lab redraws them on a later sync tick. Sample until the overlay count
     * stops changing, otherwise this harness reports false "nothing drawn".
     */
    const countOverlayElements = (selectors) => Array.from(
      document.querySelectorAll('#babel-current-renderer-lab > .babel-render-grid:not(.babel-fbproto-lane) > .babel-render-card')
    ).reduce((total, card) => total + Object.values(selectors)
      .reduce((cardTotal, selector) => cardTotal + card.querySelectorAll(selector).length, 0), 0);

    let previous = -1;
    let stableSamples = 0;
    for (let sample = 0; sample < 40 && stableSamples < 3; sample += 1) {
      /* eslint-disable no-await-in-loop */
      const current = await page.evaluate(countOverlayElements, OVERLAY_SELECTORS);
      stableSamples = current === previous && current > 0 ? stableSamples + 1 : 0;
      previous = current;
      await page.waitForTimeout(500);
      /* eslint-enable no-await-in-loop */
    }

    cards = await page.evaluate(collectCards, OVERLAY_SELECTORS);
    sourceImages = await page.evaluate(async () => {
      const entries = Array.from(document.querySelectorAll('#babel-selected-sources .babel-source-figure-entry'));
      const urls = [...new Set(entries.flatMap((entry) =>
        Array.from(entry.querySelectorAll('img')).map((img) => img.src)))];
      const broken = (await Promise.all(urls.map((url) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(null);
        image.onerror = () => resolve(url);
        image.src = url;
      })))).filter(Boolean);
      return {
        entries: entries.length,
        illustratedEntries: entries.filter((entry) => entry.querySelector('img')).length,
        images: urls.length,
        broken
      };
    });
  } finally {
    await browser.close();
  }

  // Inactive history is preserved and still rendered, but never counted as an
  // active accepted design.
  const activeCards = cards.filter((card) => !card.inactive);
  const historyCards = cards.filter((card) => card.inactive);
  const stranded = cards.filter((card) => card.replayAt !== card.replayOf);
  const empty = cards.filter((card) => card.svgCount === 0 || card.nodeLabelCount === 0);
  const noOverlay = activeCards.filter((card) => Object.keys(card.overlays).length === 0);
  const withNotes = cards.filter((card) => card.contractNotes.length > 0);
  const unexpectedlyDark = noOverlay.filter((card) => !KNOWN_UNDRAWN.has(card.title));
  const nowDrawing = cards.filter(
    (card) => KNOWN_UNDRAWN.has(card.title) && Object.keys(card.overlays).length > 0
  );

  if (asJson) {
    console.log(JSON.stringify({ cards, sourceImages, consoleErrors }, null, 2));
  } else {
    console.log(`Orchard page: ${ORCHARD_PAGE}`);
    console.log(`Active cards: ${activeCards.length}   Inactive history: ${historyCards.length}\n`);
    console.log(`Source images: ${sourceImages.images} loaded for ${sourceImages.illustratedEntries}/${sourceImages.entries} entries\n`);
    const pad = (value, width) => String(value).padEnd(width);
    console.log(`${pad('card', 44)}${pad('replay', 9)}${pad('labels', 8)}overlays`);
    cards.forEach((card) => {
      const replay = card.replayAt === null ? '—' : `${card.replayAt}/${card.replayOf}`;
      const state = card.inactive ? ' [history]' : '';
      const overlays = Object.entries(card.overlays).map(([name, n]) => `${name}:${n}`).join(' ') || '(none)';
      console.log(`${pad(card.title.slice(0, 32) + state, 44)}${pad(replay, 9)}${pad(card.nodeLabelCount, 8)}${overlays}`);
    });

    const report = (label, list) => {
      if (list.length === 0) return;
      console.log(`\n${label} (${list.length}):`);
      list.forEach((card) => console.log(`  - ${card.title}`));
    };
    report('STRANDED mid-replay', stranded);
    report('EMPTY canvas', empty);
    report('SUBSTITUTE painter instead of production', cards.filter(card => card.substitutePaint > 0));
    report('NO overlay drawn — known app-side gap', noOverlay.filter((card) => KNOWN_UNDRAWN.has(card.title)));
    report('NO overlay drawn — UNEXPECTED', unexpectedlyDark);
    report('now drawing (was a known gap)', nowDrawing);
    if (withNotes.length > 0) {
      console.log(`\nContract notes (${withNotes.length}):`);
      withNotes.forEach((card) => card.contractNotes.forEach((note) => console.log(`  - ${card.title}: ${note}`)));
    }
    if (consoleErrors.length > 0) {
      console.log(`\nConsole errors (${consoleErrors.length}):`);
      Array.from(new Set(consoleErrors)).slice(0, 20).forEach((line) => console.log(`  - ${line}`));
    }
    if (sourceImages.broken.length > 0) {
      console.log(`\nBroken source images (${sourceImages.broken.length}):`);
      sourceImages.broken.forEach((url) => console.log(`  - ${url}`));
    }
  }

  const failed = stranded.length > 0
    || cards.some(card => card.substitutePaint > 0)
    || empty.length > 0
    || unexpectedlyDark.length > 0
    || sourceImages.entries !== activeCards.length
    || sourceImages.broken.length > 0
    || consoleErrors.length > 0;
  process.exitCode = failed ? 1 : 0;
};

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
