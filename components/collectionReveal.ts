type Moment = { stageIndex: number; relationIndex: number };

const PLAQUE_LEAD_MS = 180;
const COLLECTION_DRAW_MS = 360;

/** A compound claim has one moment. Its plaque precedes the collector within it. */
export function collectionRevealTiming(
  owners: readonly Moment[], moment: Moment | null, elapsed: number, reducedMotion: boolean
) {
  if (reducedMotion || !moment || elapsed >= PLAQUE_LEAD_MS + COLLECTION_DRAW_MS) return null;
  const first = [...owners].sort((a, b) => a.stageIndex - b.stageIndex || a.relationIndex - b.relationIndex)[0];
  if (!first || first.stageIndex !== moment.stageIndex || first.relationIndex !== moment.relationIndex) return null;
  return { delay: PLAQUE_LEAD_MS - Math.max(0, elapsed), duration: COLLECTION_DRAW_MS };
}

/** Reveal through a mask so the accepted dash length, path and width never change. */
export function revealPlaqueCollections(svg: SVGSVGElement, moment: Moment | null,
  options: { elapsed: number; reducedMotion: boolean; idPrefix: string }) {
  const cleanups: Array<() => void> = [];
  const ns = 'http://www.w3.org/2000/svg';
  svg.querySelectorAll<SVGPathElement>('path[data-collection-plaque]:not(.vr-relation-hit-target)')
    .forEach((path, index) => {
      const owners = (path.getAttribute('data-vr-owner-refs') || '').split(' ').flatMap(value => {
        const match = /^(\d+):(\d+)$/.exec(value);
        return match ? [{ stageIndex: Number(match[1]), relationIndex: Number(match[2]) }] : [];
      });
      const timing = collectionRevealTiming(owners, moment, options.elapsed, options.reducedMotion);
      if (!timing || path.hasAttribute('mask')) return;
      const length = path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) return;
      const box = path.getBBox();
      const matrix = path.getScreenCTM();
      const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
      const sweepWidth = Math.max(40, 8 / Math.max(0.001, scale));
      const padding = sweepWidth / 2 + 4;
      const defs = document.createElementNS(ns, 'defs');
      const mask = document.createElementNS(ns, 'mask');
      const sweep = document.createElementNS(ns, 'path');
      const id = `${options.idPrefix}-${index}`;
      mask.setAttribute('id', id);
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('x', String(box.x - padding));
      mask.setAttribute('y', String(box.y - padding));
      mask.setAttribute('width', String(box.width + padding * 2));
      mask.setAttribute('height', String(box.height + padding * 2));
      mask.style.maskType = 'alpha';
      sweep.setAttribute('d', path.getAttribute('d') || '');
      sweep.style.fill = 'none';
      sweep.style.stroke = 'white';
      sweep.style.strokeWidth = String(sweepWidth);
      sweep.style.strokeDasharray = `${length} ${length}`;
      mask.appendChild(sweep);
      defs.appendChild(mask);
      svg.appendChild(defs);
      path.setAttribute('mask', `url(#${id})`);
      const animation = sweep.animate([
        { strokeDashoffset: String(length) }, { strokeDashoffset: '0' }
      ], { ...timing, fill: 'both', easing: 'ease-out' });
      const restore = () => {
        path.removeAttribute('mask');
        defs.remove();
      };
      animation.onfinish = restore;
      cleanups.push(() => { animation.cancel(); restore(); });
    });
  return () => cleanups.forEach(cleanup => cleanup());
}
