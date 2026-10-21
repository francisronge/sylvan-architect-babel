/** Offline text metrics for the visual invariant audit, read from the bundled
 * @fontsource WOFF files the app loads (styles.css). Advances and glyph boxes
 * come from the fonts themselves; kerning, shaping, synthetic bold/oblique and
 * system fallback fonts are approximated, so these metrics stand in for the
 * browser and never replace a native capture. The returned measures have the
 * signatures of the renderer's own measures, and `createMeasuringDocument`
 * lets the production tree-label and tree-ink measures run against them. */
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { CATEGORY_FONT } from '../../replay/rendererMetrics.ts';

const FONT_ROOT = new URL('../../node_modules/@fontsource/', import.meta.url);

function parseWoff(url) {
  const buffer = readFileSync(url);
  if (buffer.toString('latin1', 0, 4) !== 'wOFF') throw Error(`${url} is not a WOFF font`);
  const tables = {};
  for (let index = 0; index < buffer.readUInt16BE(12); index++) {
    const at = 44 + index * 20, tag = buffer.toString('latin1', at, at + 4);
    const offset = buffer.readUInt32BE(at + 4), compressed = buffer.readUInt32BE(at + 8), original = buffer.readUInt32BE(at + 12);
    const raw = buffer.subarray(offset, offset + compressed);
    tables[tag] = compressed < original ? inflateSync(raw) : raw;
  }
  const { head, hhea, hmtx, cmap, loca, glyf } = tables;
  const unitsPerEm = head.readUInt16BE(18), longOffsets = head.readInt16BE(50) === 1;
  const metrics = hhea.readUInt16BE(34);
  const glyphs = new Map();
  for (let index = 0; index < cmap.readUInt16BE(2); index++) {
    const platform = cmap.readUInt16BE(4 + index * 8), offset = cmap.readUInt32BE(8 + index * 8);
    if (platform !== 3 && platform !== 0) continue;
    const format = cmap.readUInt16BE(offset);
    if (format === 4) {
      const segments = cmap.readUInt16BE(offset + 6), ends = offset + 14, starts = ends + segments + 2;
      const deltas = starts + segments, ranges = deltas + segments;
      for (let s = 0; s < segments / 2; s++) {
        const end = cmap.readUInt16BE(ends + 2 * s), start = cmap.readUInt16BE(starts + 2 * s);
        const delta = cmap.readInt16BE(deltas + 2 * s), range = cmap.readUInt16BE(ranges + 2 * s);
        for (let code = start; code <= end && code !== 0xffff; code++) {
          let glyph = range ? cmap.readUInt16BE(ranges + 2 * s + range + 2 * (code - start)) : code;
          if (range && glyph) glyph += delta; else if (!range) glyph += delta;
          glyph &= 0xffff;
          if (glyph && !glyphs.has(code)) glyphs.set(code, glyph);
        }
      }
    } else if (format === 12) {
      for (let group = 0; group < cmap.readUInt32BE(offset + 12); group++) {
        const at = offset + 16 + group * 12, start = cmap.readUInt32BE(at), end = cmap.readUInt32BE(at + 4), first = cmap.readUInt32BE(at + 8);
        for (let code = start; code <= end; code++) if (!glyphs.has(code)) glyphs.set(code, first + code - start);
      }
    }
  }
  const box = glyph => {
    if (!loca || !glyf) return null;
    const start = longOffsets ? loca.readUInt32BE(glyph * 4) : loca.readUInt16BE(glyph * 2) * 2;
    const end = longOffsets ? loca.readUInt32BE(glyph * 4 + 4) : loca.readUInt16BE(glyph * 2 + 2) * 2;
    if (end <= start) return null;
    return { xMin: glyf.readInt16BE(start + 2), yMin: glyf.readInt16BE(start + 4), xMax: glyf.readInt16BE(start + 6), yMax: glyf.readInt16BE(start + 8) };
  };
  return {
    ascent: hhea.readInt16BE(4) / unitsPerEm, descent: -hhea.readInt16BE(6) / unitsPerEm,
    glyph(code) {
      const glyph = glyphs.get(code);
      if (glyph === undefined) return undefined;
      const advance = hmtx.readUInt16BE(4 * Math.min(glyph, metrics - 1)) / unitsPerEm, ink = box(glyph);
      return { advance, ink: ink && { left: ink.xMin / unitsPerEm, right: ink.xMax / unitsPerEm,
        top: ink.yMax / unitsPerEm, bottom: ink.yMin / unitsPerEm } };
    }
  };
}

const faces = new Map();
function face(family, weight, style) {
  const key = `${family}/${weight}/${style}`;
  if (!faces.has(key)) {
    const subsets = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek'];
    faces.set(key, subsets.map(subset => new URL(`${family}/files/${family}-${subset}-${weight}-${style}.woff`, FONT_ROOT))
      .filter(url => existsSync(url)).map(parseWoff));
  }
  return faces.get(key);
}

// The weights styles.css loads; the browser chooses the nearest loaded face.
const LOADED = {
  quicksand: { normal: [400, 500, 600, 700] },
  'crimson-pro': { normal: [400, 600, 700], italic: [400] },
  'jetbrains-mono': { normal: [400, 500, 700, 800] }
};
const nearest = (weights, weight) => weights.reduce((best, value) => Math.abs(value - weight) < Math.abs(best - weight) ? value : best);
const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const runs = new Map();
/** Advance, glyph-ink box and font cell of one run of text, in pixels from its
 * origin. `font` is { family, size, weight, italic, letterSpacing }. A glyph the
 * family lacks falls back to a system face approximated by fixed proportions. */
export function measureRun(text, font) {
  text = String(text).normalize('NFC');
  const key = JSON.stringify([text, font.family, font.size, font.weight, Boolean(font.italic), font.letterSpacing ?? 0]);
  let run = runs.get(key);
  if (!run) {
    if (runs.size > 50000) runs.clear();
    runs.set(key, run = measureUncached(text, font));
  }
  return run;
}

function measureUncached(text, font) {
  const name = /quicksand/i.test(font.family) ? 'quicksand' : /crimson/i.test(font.family) ? 'crimson-pro'
    : /jetbrains/i.test(font.family) ? 'jetbrains-mono' : null;
  const styles = name && LOADED[name], style = font.italic && styles?.italic ? 'italic' : 'normal';
  const list = styles ? face(name, nearest(styles[style], font.weight ?? 400), style) : [];
  const size = font.size, spacing = font.letterSpacing ?? 0, monospace = !name && /mono/i.test(font.family);
  const cellAscent = list[0]?.ascent ?? (monospace ? 0.93 : 0.9), cellDescent = list[0]?.descent ?? 0.24;
  let pen = 0, left = Infinity, right = -Infinity, top = 0, bottom = 0;
  for (const { segment } of graphemes.segment(text)) {
    // A cluster advances by its base; marks NFC could not compose stack on it,
    // so its vertical ink spans every code point's glyph.
    const [base, ...marks] = [...segment].map(char => char.codePointAt(0));
    const found = list.map(font => font.glyph(base)).find(Boolean);
    const advance = found ? found.advance : monospace ? 0.6 : wide.test(segment) ? 1 : 0.55;
    const ink = found ? found.ink : /\s/u.test(segment) ? null : { left: 0.04, right: advance - 0.04, top: 0.72, bottom: wide.test(segment) ? -0.1 : 0 };
    if (ink) {
      left = Math.min(left, pen + ink.left * size); right = Math.max(right, pen + ink.right * size);
      top = Math.max(top, ink.top * size); bottom = Math.min(bottom, ink.bottom * size);
      for (const mark of marks) {
        const glyph = list.map(font => font.glyph(mark)).find(Boolean)?.ink;
        if (glyph) { top = Math.max(top, glyph.top * size); bottom = Math.min(bottom, glyph.bottom * size); }
      }
    }
    pen += advance * size + spacing;
  }
  // Synthetic oblique (Quicksand has no italic face) leans the ink right.
  if (font.italic && style === 'normal' && Number.isFinite(right)) right += 0.2 * top;
  return { width: pen, left: Number.isFinite(left) ? left : 0, right: Number.isFinite(right) ? right : 0,
    ascent: top, descent: -bottom, fontAscent: cellAscent * size, fontDescent: cellDescent * size };
}

/** Parse a CSS font shorthand such as `italic 900 56px Quicksand, sans-serif`. */
export function parseFont(shorthand) {
  const match = /^\s*(italic\s+)?(?:(\d{3})\s+)?([\d.]+)px\s+(.+)$/.exec(shorthand);
  if (!match) throw Error(`Unsupported font shorthand: ${shorthand}`);
  return { italic: Boolean(match[1]), weight: Number(match[2] ?? 400), size: Number(match[3]), family: match[4] };
}

export const measureCategoryText = text => measureRun(text, parseFont(CATEGORY_FONT)).width;

/** The renderer's plaque measure reads an SVG text box: advance with letter
 * spacing, and the font cell above and below the baseline. */
export const measurePlaqueText = (text, style) => {
  const run = measureRun(text, { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, letterSpacing: style.letterSpacing });
  return { width: run.width, ascent: run.fontAscent, descent: run.fontDescent };
};

/** Just enough of a browser document for components/treeInkTextMeasure.ts and
 * components/treeLabelMeasure.ts: a 2D context whose measureText reads these
 * fonts, and SVG text whose getBBox lays out its tspans as the browser does
 * (middle anchoring per line, dx, dy and a subscript baseline shift). */
export function createMeasuringDocument() {
  class Node {
    constructor(tag) { this.tag = tag; this.style = {}; this.attributes = {}; this.children = []; this.textContent = ''; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    remove() {}
    getBBox() { return textBox(this); }
  }
  const context = { font: CATEGORY_FONT, textAlign: 'left', textBaseline: 'alphabetic',
    measureText(text) {
      const run = measureRun(text, parseFont(this.font));
      return { width: run.width, actualBoundingBoxLeft: -run.left, actualBoundingBoxRight: run.right,
        actualBoundingBoxAscent: run.ascent, actualBoundingBoxDescent: run.descent,
        fontBoundingBoxAscent: run.fontAscent, fontBoundingBoxDescent: run.fontDescent };
    } };
  return { body: { appendChild() {} }, createElement: () => ({ getContext: () => context }),
    createElementNS: (_namespace, tag) => new Node(tag) };
}

function textBox(label) {
  const base = label.style.font ? parseFont(label.style.font) : parseFont(CATEGORY_FONT);
  const anchor = label.attributes['text-anchor'] ?? 'start';
  const chunks = [];
  let chunk = null, x = 0, y = Number(label.attributes.y ?? 0);
  const start = position => { chunk = { x: position, runs: [] }; chunks.push(chunk); };
  const place = (text, font, shift) => {
    if (!chunk) start(x);
    const run = measureRun(text, font);
    chunk.runs.push({ offset: chunk.width ?? 0, width: run.width, top: y + shift - run.fontAscent, bottom: y + shift + run.fontDescent });
    chunk.width = (chunk.width ?? 0) + run.width;
  };
  // Direct text precedes appended tspans, as a text node assigned before them does.
  if (label.textContent) place(label.textContent, base, 0);
  for (const span of label.children) {
    const a = span.attributes;
    const font = { ...base, ...(a['font-size'] ? { size: parseFloat(a['font-size']) } : {}),
      ...(a['font-family'] ? { family: a['font-family'] } : {}), ...(a['font-style'] ? { italic: a['font-style'] === 'italic' } : {}) };
    if (a.x !== undefined) { x = Number(a.x); start(x); }
    if (a.y !== undefined) y = Number(a.y);
    if (a.dy !== undefined) y += Number(a.dy);
    if (a.dx !== undefined && chunk) chunk.width = (chunk.width ?? 0) + Number(a.dx);
    place(span.textContent, font, a['baseline-shift'] === 'sub' ? 0.2 * font.size : 0);
  }
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const { x: origin, width = 0, runs } of chunks) {
    const shift = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
    for (const run of runs) {
      left = Math.min(left, origin + shift + run.offset); right = Math.max(right, origin + shift + run.offset + run.width);
      top = Math.min(top, run.top); bottom = Math.max(bottom, run.bottom);
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
