import type * as d3 from 'd3';
import type { PlaqueTextBlock, PlaqueTextMeasure } from '../../replay/relations/plaqueTextLayout.ts';
import type { DrawingLayer } from './drawingContext.ts';

export const withPlaqueTextMeasure = <T,>(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  useMeasure: (measure: PlaqueTextMeasure) => T
): T => {
  const text = svg.append('text').attr('visibility', 'hidden')
    .attr('aria-hidden', 'true').attr('x', 0).attr('y', 0).style('white-space', 'pre');
  try {
    return useMeasure((value, style) => {
      text.style('font-family', style.fontFamily).style('font-size', `${style.fontSize}px`)
        .style('font-weight', style.fontWeight).style('letter-spacing', `${style.letterSpacing}px`).text(value);
      const element = text.node()!;
      const box = element.getBBox();
      return {
        width: Math.max(element.getComputedTextLength(), box.x + box.width),
        ascent: Math.max(0, -box.y),
        descent: Math.max(0, box.y + box.height)
      };
    });
  } finally {
    text.remove();
  }
};

export const drawPlaqueText = (
  parent: DrawingLayer,
  block: PlaqueTextBlock,
  className: string,
  origin = { x: 0, y: 0 }
) => {
  const text = parent.append('text').attr('class', className)
    .style('font-family', block.style.fontFamily).style('font-size', `${block.style.fontSize}px`)
    .style('font-weight', block.style.fontWeight).style('letter-spacing', `${block.style.letterSpacing}px`)
    .style('white-space', 'pre').attr('xml:space', 'preserve');
  block.lines.forEach(line => text.append('tspan')
    .attr('x', origin.x + line.x).attr('y', origin.y + line.y).text(line.text));
  return text;
};

