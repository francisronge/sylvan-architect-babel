import type * as d3 from 'd3';
import type { PlaqueViewport } from '../replay/relations/plaqueTextLayout.ts';

type Group = d3.Selection<SVGGElement, unknown, null, undefined>;

/** A nested SVG clips paint without dropping rows or introducing fragment IDs. */
export const appendPlaqueContent = (
  parent: Group,
  layout: PlaqueViewport & { width: number },
  origin = { x: 0, y: 0 }
): Group => {
  if (!layout.overflow) return parent;
  const inset = 4;
  const maximum = layout.overflow.contentHeight - layout.height;
  let offset = 0;
  const viewport = parent.append('svg')
    .attr('data-babel-plaque-viewport', 'true')
    .attr('x', origin.x + inset).attr('y', origin.y + inset)
    .attr('width', layout.width - inset * 2).attr('height', layout.height - inset * 2)
    .attr('viewBox', `${inset} ${inset} ${layout.width - inset * 2} ${layout.height - inset * 2}`)
    .style('overflow', 'hidden').style('outline', 'none').style('pointer-events', 'all').attr('tabindex', 0).attr('role', 'region')
    .attr('aria-label', 'Plaque text. Scroll or use arrow keys, Page Up, Page Down, Home and End to read all rows.');
  const content = viewport.append('g');
  // Native SVG focus outlines include clipped descendants; draw one around the actual viewport.
  const focusRing = parent.append('rect').attr('x', origin.x).attr('y', origin.y)
    .attr('width', layout.width).attr('height', layout.height).attr('rx', 5)
    .attr('fill', 'none').attr('stroke', '#d1fae5').attr('stroke-width', 1)
    .attr('vector-effect', 'non-scaling-stroke').attr('pointer-events', 'none').attr('visibility', 'hidden');
  viewport.on('focus', () => focusRing.attr('visibility', 'visible'))
    .on('blur', () => focusRing.attr('visibility', 'hidden'));
  const trackHeight = layout.height - 16;
  const thumbHeight = Math.max(18, trackHeight * layout.height / layout.overflow.contentHeight);
  const thumb = parent.append('rect').attr('data-babel-plaque-scrollbar', 'true')
    .attr('x', origin.x + layout.width - 7).attr('width', 3).attr('height', thumbHeight)
    .attr('rx', 1.5).attr('fill', '#34d399').attr('opacity', 0.65).attr('pointer-events', 'none');
  const scroll = (next: number) => {
    offset = Math.max(0, Math.min(maximum, next));
    content.attr('transform', `translate(${-origin.x},${-origin.y - offset})`);
    viewport.attr('data-scroll-offset', offset).attr('data-scroll-max', maximum);
    thumb.attr('y', origin.y + 8 + (trackHeight - thumbHeight) * offset / maximum);
  };
  // Shell hover hit targets sit above the text, so handle wheel input at their shared parent.
  parent.on('wheel', (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const scale = Math.abs(viewport.node()?.getScreenCTM()?.d || 1);
    const delta = event.deltaMode === 1 ? event.deltaY * 16
      : event.deltaMode === 2 ? event.deltaY * layout.height : event.deltaY / scale;
    scroll(offset + delta);
  }, { passive: false });
  parent.on('keydown', (event: KeyboardEvent) => {
    const next = ({ ArrowDown: offset + 40, ArrowUp: offset - 40,
      PageDown: offset + layout.height * 0.8, PageUp: offset - layout.height * 0.8,
      Home: 0, End: maximum } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    scroll(next);
  });
  scroll(0);
  return content as Group;
};
