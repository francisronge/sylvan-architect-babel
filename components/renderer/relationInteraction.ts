import type { DrawingLayer } from './drawingContext.ts';

export function installRelationHitTargets(g: DrawingLayer) {
  g.selectAll<SVGElement, unknown>('.vr-item').each(function installHitTargets() {
    const relationHost = this as SVGElement;
    const geometries = relationHost.matches('path, line, polyline, rect, circle, ellipse')
      ? [relationHost as SVGGeometryElement]
      : Array.from(relationHost.querySelectorAll<SVGGeometryElement>(
        'path, line, polyline, rect, circle, ellipse'
      ));
    geometries.forEach((geometry) => {
      if (geometry.classList.contains('vr-relation-hit-target')) return;
      if (geometry.hasAttribute('data-vr-hit-target-installed')) return;
      const hitTarget = geometry.cloneNode(false) as SVGGeometryElement;
      const isRelationHost = geometry === relationHost;
      const isAreaTarget = geometry.hasAttribute('data-vr-hit-area');
      const isFallbackSegment = geometry.classList.contains('vr-fallback-segment');
      geometry.setAttribute('data-vr-hit-target-installed', 'true');
      hitTarget.removeAttribute('id');
      hitTarget.removeAttribute('class');
      hitTarget.removeAttribute('style');
      hitTarget.removeAttribute('filter');
      hitTarget.removeAttribute('marker-start');
      hitTarget.removeAttribute('marker-mid');
      hitTarget.removeAttribute('marker-end');
      hitTarget.setAttribute(
        'class',
        [
          isRelationHost ? 'vr-item' : '',
          'vr-relation-hit-target',
          isAreaTarget ? 'vr-relation-area-hit-target' : '',
          isFallbackSegment ? 'vr-relation-fallback-hit-target' : ''
        ].filter(Boolean).join(' ')
      );
      if (isRelationHost) {
        ['data-vr-stage-index', 'data-vr-relation-index', 'data-vr-owner-refs', 'data-vr-emphasis']
          .forEach((attribute) => {
            const value = relationHost.getAttribute(attribute);
            if (value !== null) hitTarget.setAttribute(attribute, value);
          });
      }
      hitTarget.setAttribute('aria-hidden', 'true');
      hitTarget.setAttribute('focusable', 'false');
      hitTarget.style.setProperty('fill', isAreaTarget ? 'transparent' : 'none', 'important');
      hitTarget.style.setProperty('stroke', 'transparent', 'important');
      hitTarget.style.setProperty('stroke-width', isFallbackSegment ? '30px' : '16px', 'important');
      hitTarget.setAttribute('stroke-linecap', 'round');
      hitTarget.setAttribute('stroke-linejoin', 'round');
      hitTarget.setAttribute('vector-effect', 'non-scaling-stroke');
      hitTarget.style.setProperty('pointer-events', isAreaTarget ? 'all' : 'stroke', 'important');
      geometry.parentElement?.appendChild(hitTarget);
    });
  });
}

type RelationMoment = { stageIndex: number; relationIndex: number };

export function applyRelationEmphasis(svg: SVGSVGElement, activeRelationMoment: RelationMoment | null, hoveredRelationMoment: RelationMoment | null) {
  const focusKey = activeRelationMoment
    ? `${activeRelationMoment.stageIndex}:${activeRelationMoment.relationIndex}`
    : '';
  const ownerKey = (element: SVGElement) => (
    element.getAttribute('data-vr-owner-refs')?.trim()
    || `${element.getAttribute('data-vr-stage-index')}:${element.getAttribute('data-vr-relation-index')}`
  );
  const hoverKey = hoveredRelationMoment
    ? `${hoveredRelationMoment.stageIndex}:${hoveredRelationMoment.relationIndex}` : '';
  const ownsMoment = (element: SVGElement, momentKey: string) => {
    if (!momentKey) return false;
    const ownerRefs = element.getAttribute('data-vr-owner-refs')
      ?.split(/\s+/u)
      .filter(Boolean) || [];
    return ownerRefs.length > 0
      ? ownerRefs.includes(momentKey)
      : ownerKey(element) === momentKey;
  };

  const relationElements = Array.from(svg.querySelectorAll(
    '.vr-item[data-vr-stage-index][data-vr-relation-index]'
  )) as SVGElement[];
  relationElements.forEach((element) => {
    const ancestor = element.parentElement?.closest<SVGElement>(
      '.vr-item[data-vr-stage-index][data-vr-relation-index]'
    );
    const isVisualRoot = !ancestor || ownerKey(ancestor) !== ownerKey(element);
    const active = ownsMoment(element, focusKey);
    // A tree label is never dimmed around an index it hosts whose claim is in focus.
    const hostsActive = (element.classList.contains('category-label') || element.classList.contains('terminal-label'))
      && Array.from(element.querySelectorAll<SVGElement>('.vr-item[data-vr-owner-refs]')).some(index => ownsMoment(index, focusKey));
    const quiet = Boolean(focusKey) && !active && !hostsActive;
    element.setAttribute('data-vr-emphasis', active ? 'active' : quiet ? 'quiet' : 'none');
    element.classList.toggle('vr-relation-active', isVisualRoot && active);
    // Quiet dims exactly once: a mark inside an ancestor rendered quiet keeps
    // that dimming, and a quiet mark inside an undimmed host dims itself.
    const dimmed = Boolean(element.parentElement?.closest('.vr-relation-quiet'));
    element.classList.toggle('vr-relation-quiet', quiet && !dimmed);
    // Hover changes ink and halo only; the relation moment owns opacity.
    element.classList.toggle('vr-relation-hovered', isVisualRoot && ownsMoment(element, hoverKey));
  });

}
