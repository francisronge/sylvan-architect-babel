import type { Point } from '../replay/relations/overlayGeometry.ts';

export type IdentityLightFamily = {
  occurrencePools: readonly (readonly string[])[];
  emphasis: string;
};

/** Shared terminal ink retains every relation that owns it. */
export function mergeIdentityOwners<T extends { stageIndex: number; relationIndex: number }>(
  previous: readonly T[], incoming: readonly T[]
): T[] {
  return [...new Map([...previous, ...incoming]
    .map(owner => [`${owner.stageIndex}:${owner.relationIndex}`, owner])).values()];
}

/** Claims keep their own ownership; a terminal receives their strongest light once. */
export function identityLightTargets(families: readonly IdentityLightFamily[]) {
  const targets = new Map<string, { nodeId: string; index: number; intensity: number }>();
  for (const family of families) {
    const intensity = family.emphasis === 'quiet' ? 0.3 : 1;
    family.occurrencePools.forEach((ids, index) => {
      for (const nodeId of ids) {
        const previous = targets.get(nodeId);
        if (!previous) targets.set(nodeId, { nodeId, index, intensity });
        else previous.intensity = Math.max(previous.intensity, intensity);
      }
    });
  }
  return [...targets.values()];
}

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
