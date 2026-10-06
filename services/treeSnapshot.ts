const encodeUtf8ToBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

export const captureVisibleTreeSnapshot = (
  ownerDocument: Document | undefined = typeof document === 'undefined' ? undefined : document
): string | undefined => {
  const document = ownerDocument;
  if (!document) return undefined;

  const svg = document.querySelector('svg[data-babel-tree="true"]') as SVGSVGElement | null;
  if (!svg) return undefined;

  const SNAPSHOT_WIDTH = 1600;
  const SNAPSHOT_HEIGHT = 980;
  const SNAPSHOT_PADDING = 72;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  // An SVG used as an image cannot inherit the application's stylesheet.
  // Keep geometry attributes intact so the snapshot can still be fitted below.
  const paintProperties = [
    'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity',
    'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'visibility', 'display',
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
    'word-spacing', 'text-anchor', 'dominant-baseline', 'text-transform',
    'text-decoration', 'paint-order', 'vector-effect', 'filter', 'rx', 'ry'
  ];
  const liveElements = [svg, ...svg.querySelectorAll<SVGElement>('*')];
  const clonedElements = [clone, ...clone.querySelectorAll<SVGElement>('*')];
  liveElements.forEach((element, index) => {
    const computed = getComputedStyle(element);
    paintProperties.forEach((property) => {
      clonedElements[index].style.setProperty(property, computed.getPropertyValue(property));
    });
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(SNAPSHOT_WIDTH));
  clone.setAttribute('height', String(SNAPSHOT_HEIGHT));
  clone.setAttribute('viewBox', `0 0 ${SNAPSHOT_WIDTH} ${SNAPSHOT_HEIGHT}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bgRect.setAttribute('x', '0');
  bgRect.setAttribute('y', '0');
  bgRect.setAttribute('width', '100%');
  bgRect.setAttribute('height', '100%');
  bgRect.setAttribute('fill', '#020806');
  clone.insertBefore(bgRect, clone.firstChild);

  const liveGroup = svg.querySelector('g');
  const clonedGroup = clone.querySelector('g');
  if (liveGroup && clonedGroup) {
    try {
      let bbox = liveGroup.getBBox();
      if (liveGroup.querySelector('[data-babel-plaque-viewport]')) {
        // SVG getBBox includes clipped text. Measure the visible viewport boxes
        // on a disposable copy, leaving every authored row in the saved image.
        const measurement = clone.cloneNode(true) as SVGSVGElement;
        measurement.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
        measurement.querySelectorAll<SVGSVGElement>('[data-babel-plaque-viewport]').forEach(viewport => {
          const box = viewport.viewBox.baseVal;
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for (const key of ['x', 'y', 'width', 'height'] as const) rect.setAttribute(key, String(box[key]));
          viewport.replaceChildren(rect);
        });
        document.body.appendChild(measurement);
        try { bbox = measurement.querySelector<SVGGElement>('g')!.getBBox(); }
        finally { measurement.remove(); }
      }
      if (Number.isFinite(bbox.width) && Number.isFinite(bbox.height) && bbox.width > 0 && bbox.height > 0) {
        const availableWidth = Math.max(1, SNAPSHOT_WIDTH - SNAPSHOT_PADDING * 2);
        const availableHeight = Math.max(1, SNAPSHOT_HEIGHT - SNAPSHOT_PADDING * 2);
        const scale = Math.min(availableWidth / bbox.width, availableHeight / bbox.height);
        const translateX = (SNAPSHOT_WIDTH - bbox.width * scale) / 2 - bbox.x * scale;
        const translateY = (SNAPSHOT_HEIGHT - bbox.height * scale) / 2 - bbox.y * scale;
        clonedGroup.setAttribute('transform', `translate(${translateX},${translateY}) scale(${scale})`);
      }
    } catch {
      // Use the current rendered transform when SVG bounds are unavailable.
    }
  }

  const serialized = new XMLSerializer().serializeToString(clone);
  return `data:image/svg+xml;base64,${encodeUtf8ToBase64(serialized)}`;
};

