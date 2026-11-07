#!/usr/bin/env node
/**
 * Visual check for the production Relation Orchard.
 *
 * The lab's unit tests prove the adapter derives the right lens objects. They
 * cannot tell you whether a card actually drew anything, which is how three
 * regressions reached the maintainer's screen. This harness opens the real page
 * in Chromium and reports, per card, what is on the canvas, and whether the
 * drawing fits its card: at a laptop and a phone viewport, a card fails when a
 * drawn mark leaves its canvas or lies under its Replay panel, or when the
 * camera shrank the tree below its natural size yet it fills less than half of
 * the free canvas in both directions.
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
const CARD_SELECTOR = '#babel-current-renderer-lab > .babel-render-grid:not(.babel-fbproto-lane) > .babel-render-card';
/** The first viewport also runs every drawing check; the fit runs at both. */
const VIEWPORTS = [
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
];
/** A mark may touch an edge by this much (antialiasing, stroke rounding). */
const FIT_TOLERANCE_PX = 1;
/** A tree the camera shrank must fill at least this share of the free canvas in one direction. */
const MINIMUM_FILL = 0.5;

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

// The Replay header reads "Replay Frame 12/12 · Stage 2/2 · Step 2/2".
const REPLAY_COUNTER = 'Replay(?:\\s+Frame)?\\s+(\\d+)\\s*\\/\\s*(\\d+)';

const collectCards = ({ selectors, cardSelector, counter }) => Array.from(
  document.querySelectorAll(cardSelector)
).map((card) => {
  const text = card.textContent || '';
  const replayMatch = text.match(new RegExp(counter, 'i'));
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

/**
 * Where each card's drawing lies relative to what the reader can see: the card
 * canvas less its Replay panel. Every painted SVG shape of the tree canvas
 * counts, clipped to a plaque's own scrolling viewport where it has one.
 */
const measureCardFit = ({ cardSelector, tolerance, minimumFill }) => {
  const SHAPES = 'text, path, line, rect, circle, ellipse, polygon, polyline, image, foreignObject';
  const unpainted = value => !value || value === 'none' || value === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(value);
  const painted = (element, canvas) => {
    if (element.closest('defs, clipPath, mask, marker, pattern, .vr-relation-hit-target')) return false;
    for (let node = element; node && node !== canvas.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    const style = getComputedStyle(element);
    return ['text', 'image', 'foreignObject'].includes(element.tagName) || !unpainted(style.fill) || !unpainted(style.stroke);
  };
  // How far a shape reaches into a rectangle; a straight line's box has no
  // height or width but still reaches in.
  const intrusion = (shape, rect) => Math.min(shape.right - rect.left, rect.right - shape.left, shape.bottom - rect.top, rect.bottom - shape.top);
  return Array.from(document.querySelectorAll(cardSelector)).map((card) => {
    const title = card.querySelector('h3')?.textContent?.trim() || '';
    const mount = card.querySelector('.babel-render-mount');
    const canvas = mount?.querySelector('svg[data-babel-tree="true"]');
    if (!canvas) return { title, faults: ['no tree canvas'] };
    const view = mount.getBoundingClientRect();
    const panel = mount.querySelector('[data-babel-replay-panel="true"]')?.getBoundingClientRect() ?? null;
    const header = mount.querySelector('[data-babel-replay-header="true"]')?.getBoundingClientRect() ?? null;
    const faults = [];
    let ink = null;
    canvas.querySelectorAll(SHAPES).forEach((element) => {
      if (!painted(element, canvas)) return;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      let box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      const viewport = element.parentElement.closest('svg');
      if (viewport && viewport !== canvas) {
        const clip = viewport.getBoundingClientRect();
        box = { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) };
        if (box.right <= box.left || box.bottom <= box.top) return;
      }
      ink = ink ? { left: Math.min(ink.left, box.left), top: Math.min(ink.top, box.top), right: Math.max(ink.right, box.right), bottom: Math.max(ink.bottom, box.bottom) } : { ...box };
      const outside = Math.max(view.left - box.left, view.top - box.top, box.right - view.right, box.bottom - view.bottom);
      const underPanel = panel ? intrusion(box, panel) : 0;
      if (outside <= tolerance && underPanel <= tolerance) return;
      const name = (element.getAttribute('class') || element.parentElement.getAttribute('class') || element.tagName).split(' ')[0];
      const text = element.tagName === 'text' ? ` "${(element.textContent || '').trim().slice(0, 24)}"` : '';
      faults.push(outside > tolerance
        ? `${name}${text} leaves the canvas by ${Math.round(outside)}px`
        : `${name}${text} lies ${Math.round(underPanel)}px under the Replay panel`);
    });
    const unique = [...new Set(faults)];
    const free = { width: view.width, height: (panel ? panel.top : view.bottom) - (header ? header.bottom : view.top) };
    const scale = canvas.querySelector(':scope > g')?.transform.baseVal.consolidate()?.matrix.a ?? 1;
    const fill = ink ? Math.max((ink.right - ink.left) / free.width, (ink.bottom - ink.top) / free.height) : 0;
    if (scale < 1 && fill < minimumFill) unique.push(`fitted too small: scale ${scale.toFixed(3)}, fills ${Math.round(fill * 100)}% of the free canvas`);
    return { title, scale: Number(scale.toFixed(3)), fill: Number(fill.toFixed(2)), faults: unique };
  });
};

const openOrchard = async (browser, { name, width, height, ...device }, consoleErrors) => {
  const context = await browser.newContext({ viewport: { width, height }, ...device });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${name}: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${name}: pageerror: ${error.message}`));
  await page.goto(pathToFileURL(ORCHARD_PAGE).href, { waitUntil: 'load' });
  await page.waitForSelector(CARD_SELECTOR, { timeout: SETTLE_TIMEOUT_MS });
  await page.waitForSelector('#babel-selected-sources .babel-source-figure-entry', { timeout: SETTLE_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready);
  // A canvas still settling a resize carries this marker until its next draw.
  await page.waitForFunction((cardSelector) => {
    const canvases = Array.from(document.querySelectorAll(`${cardSelector} svg[data-babel-tree="true"]`));
    return canvases.length > 0 && canvases.every(canvas => !canvas.hasAttribute('data-babel-viewport-pending'));
  }, CARD_SELECTOR, { timeout: SETTLE_TIMEOUT_MS });
  return { context, page };
};

/** Sample until three readings in a row agree: the camera and the late relation
 * marks settle on later ticks than the final frame's first paint. */
const settle = async (page, read) => {
  let previous = null;
  let reading = null;
  for (let sample = 0, stable = 0; sample < 40 && stable < 2; sample += 1) {
    /* eslint-disable no-await-in-loop */
    reading = await read();
    const key = JSON.stringify(reading);
    stable = key === previous ? stable + 1 : 0;
    previous = key;
    if (stable < 2) await page.waitForTimeout(500);
    /* eslint-enable no-await-in-loop */
  }
  return reading;
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  const chromium = loadChromium();
  const browser = await chromium.launch(resolveChromiumLaunchOptions({ headless: true }));
  const consoleErrors = [];
  let cards = [];
  let sourceImages = { entries: 0, illustratedEntries: 0, images: 0, broken: [] };
  const fit = {};

  try {
    for (const [index, viewport] of VIEWPORTS.entries()) {
      /* eslint-disable no-await-in-loop */
      const { context, page } = await openOrchard(browser, viewport, consoleErrors);

      // Each card opens on its final Replay frame; wait until every counter says so.
      await page.waitForFunction(({ cardSelector, counter }) => {
        const counters = Array.from(document.querySelectorAll(cardSelector))
          .map((card) => (card.textContent || '').match(new RegExp(counter, 'i')))
          .filter(Boolean);
        if (counters.length === 0) return false;
        return counters.every((match) => Number(match[1]) === Number(match[2]));
      }, { cardSelector: CARD_SELECTOR, counter: REPLAY_COUNTER }, { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

      /**
       * Reaching the final frame is not the same as having drawn the overlays:
       * the lab redraws them on a later sync tick, and the camera settles after
       * that. Sample until the overlays and the fit stop changing, otherwise this
       * harness reports false "nothing drawn" or a pose still moving.
       */
      const countOverlayElements = ({ selectors, cardSelector }) => Array.from(document.querySelectorAll(cardSelector))
        .reduce((total, card) => total + Object.values(selectors)
          .reduce((cardTotal, selector) => cardTotal + card.querySelectorAll(selector).length, 0), 0);
      await settle(page, () => page.evaluate(countOverlayElements, { selectors: OVERLAY_SELECTORS, cardSelector: CARD_SELECTOR }));
      fit[viewport.name] = await settle(page, () => page.evaluate(measureCardFit,
        { cardSelector: CARD_SELECTOR, tolerance: FIT_TOLERANCE_PX, minimumFill: MINIMUM_FILL }));

      if (index === 0) {
        cards = await page.evaluate(collectCards, { selectors: OVERLAY_SELECTORS, cardSelector: CARD_SELECTOR, counter: REPLAY_COUNTER });
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
      }
      await context.close();
      /* eslint-enable no-await-in-loop */
    }
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

  const misfit = Object.entries(fit).flatMap(([viewport, list]) => list
    .filter((card) => card.faults.length > 0)
    .map((card) => ({ viewport, ...card })));

  if (asJson) {
    console.log(JSON.stringify({ cards, fit, sourceImages, consoleErrors }, null, 2));
  } else {
    console.log(`Orchard page: ${ORCHARD_PAGE}`);
    console.log(`Viewports: ${VIEWPORTS.map(({ name, width, height }) => `${name} ${width}×${height}`).join(', ')} (drawing checks at the first)`);
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
    if (misfit.length > 0) {
      console.log(`\nDRAWING DOES NOT FIT ITS CARD (${misfit.length}):`);
      misfit.forEach((card) => {
        console.log(`  - ${card.viewport} · ${card.title} (scale ${card.scale})`);
        card.faults.slice(0, 6).forEach((fault) => console.log(`      ${fault}`));
        if (card.faults.length > 6) console.log(`      … ${card.faults.length - 6} more`);
      });
    } else {
      console.log(`\nEvery card fits at ${VIEWPORTS.map(({ name, width, height }) => `${name} ${width}×${height}`).join(' and ')}.`);
    }
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
    || misfit.length > 0
    || consoleErrors.length > 0;
  process.exitCode = failed ? 1 : 0;
};

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
