// These observations describe the painted DOM, never a cached Replay payload.
export async function waitForReplayPaint(page, index, { timeout = 30_000 } = {}) {
  const ready = index => {
    const svg = document.querySelector('svg[data-babel-tree]');
    const transform = svg?.querySelector(':scope > g')?.getAttribute('transform');
    return svg?.dataset.babelRenderedStep === String(index)
      && svg.dataset.babelCameraSettledStep === String(index)
      && document.fonts.status === 'loaded' && transform && !/NaN|Infinity/.test(transform);
  };
  await page.waitForFunction(ready, index, { timeout });
  await waitForFiniteAnimations(page, { timeout });
  // Resize can start measured preparation during the settling frames. Wait
  // for its new paint instead of returning the stale pre-resize receipt.
  await page.waitForFunction(ready, index, { timeout });
  const receipt = await inspectPaintedTree(page);
  if (receipt.renderedFrame !== String(index) || receipt.cameraFrame !== String(index)) {
    throw new Error(`Requested frame ${index} changed before capture.`);
  }
  return receipt;
}

export async function waitForCanopyPaint(page, { timeout = 30_000 } = {}) {
  await page.waitForFunction(() => !document.querySelector('[data-babel-replay-panel]')
    && document.querySelector('svg[data-babel-tree] .node-group text')
    && document.querySelector('svg[data-babel-tree]')?.dataset.babelCameraSettledStep !== undefined
    && document.fonts.status === 'loaded', null, { timeout });
  await waitForFiniteAnimations(page, { timeout });
  return inspectPaintedTree(page);
}

export async function waitForNotesPaint(page, { timeout = 30_000 } = {}) {
  await page.getByRole('heading', { name: 'Derivational Notes', exact: true }).waitFor({ state: 'visible', timeout });
  await page.waitForFunction(() => document.fonts.status === 'loaded'
    && !document.querySelector('svg[data-babel-tree]'), null, { timeout });
  await waitForFiniteAnimations(page, { timeout });
}

async function waitForFiniteAnimations(page, { timeout }) {
  await page.waitForFunction(() => !document.getAnimations().some(animation => {
    const end = animation.effect?.getComputedTiming().endTime;
    return Number.isFinite(end) && (animation.pending || animation.playState === 'running');
  }), null, { timeout });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function inspectPaintedTree(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('svg[data-babel-tree]');
    if (!svg) throw new Error('No painted Babel tree.');
    const rect = svg.getBoundingClientRect();
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0
      || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) {
      throw new Error('Painted Babel tree is outside the usable viewport.');
    }
    const text = [...svg.querySelectorAll('.node-group text')].filter(element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (!element.textContent.trim() || style.visibility === 'hidden' || box.width <= 0 || box.height <= 0) return false;
      for (let owner = element; owner; owner = owner.parentElement) {
        const ink = getComputedStyle(owner);
        if (ink.display === 'none' || Number(ink.opacity) <= 0) return false;
      }
      return box.right > Math.max(rect.left, 0) && box.left < Math.min(rect.right, innerWidth)
        && box.bottom > Math.max(rect.top, 0) && box.top < Math.min(rect.bottom, innerHeight);
    });
    if (!text.length) throw new Error('Painted Babel tree has no visible syntax labels.');
    for (const element of svg.querySelectorAll('[transform]')) {
      if (/NaN|Infinity/.test(element.getAttribute('transform'))) throw new Error('Nonfinite painted transform.');
    }
    return { renderedFrame: svg.dataset.babelRenderedStep, cameraFrame: svg.dataset.babelCameraSettledStep,
      cameraTransform: svg.querySelector(':scope > g')?.getAttribute('transform'),
      visibleLabelCount: text.length, viewport: { width: innerWidth, height: innerHeight },
      treeRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  });
}

export async function waitForDecodedImages(page, expectedCount, { timeout = 20_000 } = {}) {
  await page.waitForFunction(expected => document.images.length === expected
    && [...document.images].every(image => image.complete), expectedCount, { timeout });
  await page.evaluate(async expected => {
    const images = [...document.images];
    if (images.length !== expected) throw new Error(`Expected ${expected} images, found ${images.length}.`);
    await Promise.all(images.map(async image => {
      await image.decode();
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error(`Undecoded image: ${image.src}`);
      const rect = image.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error(`Hidden image: ${image.src}`);
    }));
    await document.fonts.ready;
  }, expectedCount);
}
