// WCAG 2.2 contrast for Tailwind-style colors composited over translucent layers.
// A color is a Tailwind name with an optional opacity ('emerald-500/80',
// 'white/5', '[#f3c777]', '[#b7791f]/24') or a CSS hex/rgba string.
import tailwind from 'tailwindcss/colors.js';

const hex = value => {
  const digits = value.replace('#', '');
  const full = digits.length === 3 ? [...digits].map(d => d + d).join('') : digits;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};

/** Parses a color token into [r, g, b, alpha]. */
export function parseColor(token) {
  const rgba = /^rgba?\(([^)]+)\)$/.exec(token);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  if (token.startsWith('#')) return [...hex(token), 1];
  const [name, opacity] = token.split('/');
  const alpha = opacity === undefined ? 1 : Number(opacity.replace(/^\[|\]$/g, '')) / (opacity.startsWith('[') ? 1 : 100);
  let base;
  if (name.startsWith('[')) base = name.slice(1, -1);
  else if (name === 'white') base = '#ffffff';
  else if (name === 'black') base = '#000000';
  else {
    const [family, shade] = name.split('-');
    base = tailwind[family]?.[shade];
  }
  if (!base) throw new Error(`Unknown color ${token}`);
  return [...hex(base), alpha];
}

/** Paints each layer over the previous one; the first layer must be opaque. */
export function composite(layers) {
  const [first, ...rest] = layers.map(layer => (typeof layer === 'string' ? parseColor(layer) : layer));
  if (first[3] !== 1) throw new Error('The bottom layer must be opaque');
  return rest.reduce((below, [r, g, b, a]) => [
    r * a + below[0] * (1 - a), g * a + below[1] * (1 - a), b * a + below[2] * (1 - a), 1
  ], first);
}

const luminance = ([r, g, b]) => {
  const channel = value => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Contrast of `foreground` (with any opacity, times `opacity`) painted over the background layers. */
export function contrast(foreground, background, opacity = 1) {
  const bg = composite(background);
  const fg = parseColor(foreground);
  const text = composite([bg, [fg[0], fg[1], fg[2], fg[3] * opacity]]);
  const [light, dark] = [luminance(text), luminance(bg)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
