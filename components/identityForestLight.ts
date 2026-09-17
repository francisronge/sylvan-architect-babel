import type { Point } from '../replay/relations/overlayGeometry.ts';

/** Light actual occurrence leaves, including wordless authored witnesses. */
export function identityLightSites(
  svg: SVGSVGElement,
  origin: Pick<DOMRect, 'left' | 'top'>,
  occurrencePools: readonly (readonly string[])[]
): Point[][] {
  const labels = new Map<string, SVGGraphicsElement>();
  // Terminal text takes precedence over its category when both are displayed.
  for (const selector of ['.category-label[data-category-node-id]', '.terminal-label[data-node-id]']) {
    svg.querySelectorAll<SVGGraphicsElement>(selector).forEach(label => {
      const id = label.getAttribute('data-node-id') ?? label.getAttribute('data-category-node-id');
      if (id) labels.set(id, label);
    });
  }
  return occurrencePools.map(ids => [...new Set(ids)].flatMap(id => {
    const rect = labels.get(id)?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return [];
    return [{ x: rect.left + rect.width / 2 - origin.left,
      y: rect.top + rect.height / 2 - origin.top }];
  }));
}
