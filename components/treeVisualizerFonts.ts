import { CATEGORY_FONT } from '../replay/categoryTextLayout.ts';
import { FALLBACK_ROLE_STYLE } from '../replay/relations/fallbackGeometry.ts';
import { REPLAY_GENERATED_TERMINAL_GLYPHS } from '../replay/replaySurfaceNotation.ts';
import { CATEGORY_INDEX_FONT, TERMINAL_FONT, TERMINAL_INDEX_FONT } from './treeInkTextMeasure.ts';

/** Metrics of `text` in a CSS font, compared to detect a change of the face the browser matches. */
export type FontTextMetrics = (font: string, text: string) => string;

export function canvasFontTextMetrics(document: Document | undefined): FontTextMetrics | undefined {
  const context = document?.createElement('canvas').getContext('2d');
  return context ? (font, text) => {
    context.font = font;
    const metrics = context.measureText(text);
    return `${metrics.width},${metrics.actualBoundingBoxAscent},${metrics.actualBoundingBoxDescent}`;
  } : undefined;
}

/** Measure once the fonts used by categories, terminals, plaques and fallback roles have settled.
 * With `metrics`, a later face load invalidates layout only when it changes how those fonts
 * render the record's text. App text loads other faces of the same families lazily. */
export function watchTreeVisualizerFonts(fonts: FontFaceSet | undefined, changed: () => void, text = '',
  metrics?: FontTextMetrics): () => void {
  let disposed = false, initializing = true, measured = '';
  const settle = () => { if (!disposed) changed(); };
  const loadingDone = (event: Event) => {
    const faces = (event as FontFaceSetLoadEvent).fontfaces;
    if (initializing || !faces.some(face => /^(Quicksand|Crimson Pro|JetBrains Mono|IBM Plex Mono)$/i.test(face.family.replace(/["']/g, '')))) return;
    if (metrics) {
      const next = fingerprint();
      if (next === measured) return;
      measured = next;
    }
    settle();
  };
  if (!fonts) {
    settle();
    return () => { disposed = true; };
  }
  fonts.addEventListener('loadingdone', loadingDone);
  // Request these faces before waiting. Otherwise initial text measurement starts
  // their download and invalidates the expensive layout it has just calculated.
  // Font files can be split by script. Include the record's characters and the
  // generated headings and chain indices so later frames do not load an
  // unmeasured script subset during Replay.
  const sample = [...new Set(`θ GRID ${REPLAY_GENERATED_TERMINAL_GLYPHS} ${text}`)].join('');
  const fallbackRoleFont = `${FALLBACK_ROLE_STYLE.fontWeight} ${FALLBACK_ROLE_STYLE.fontSize}px ${FALLBACK_ROLE_STYLE.fontFamily}`;
  const measuredFonts = [CATEGORY_FONT, TERMINAL_FONT, TERMINAL_INDEX_FONT, CATEGORY_INDEX_FONT, fallbackRoleFont,
    "800 30px 'JetBrains Mono'", "400 11px 'IBM Plex Mono'"];
  const fingerprint = () => measuredFonts.map(font => metrics!(font, sample)).join('|');
  Promise.allSettled(measuredFonts.map(font => fonts.load(font, sample)))
    .then(() => fonts.ready)
    .then(() => { initializing = false; if (metrics) measured = fingerprint(); settle(); });
  return () => {
    disposed = true;
    fonts.removeEventListener('loadingdone', loadingDone);
  };
}
