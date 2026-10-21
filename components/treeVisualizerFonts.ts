import { FALLBACK_ROLE_STYLE } from '../replay/relations/fallbackGeometry.ts';
import { REPLAY_GENERATED_TERMINAL_GLYPHS } from '../replay/replaySurfaceNotation.ts';
import { CATEGORY_FONT, CATEGORY_INDEX_FONT, TERMINAL_FONT, TERMINAL_INDEX_FONT } from '../replay/rendererMetrics.ts';
import type { MeasuredRunSource } from './treeInkTextMeasure.ts';

/**
 * Keeps one font pass's layout measures. Each measure's own cache already holds
 * every run layout measured and its result, so measuring costs nothing extra.
 * After a font load, `changed()` re-measures those runs with new, uncached
 * measures and reports whether any result differs, so only a font change the
 * layout could see invalidates it. Its cost is one measurement per cached run.
 */
export function createMeasuredRuns() {
  const measures: Array<{ create: () => MeasuredRunSource<unknown[]> & ((...args: never[]) => unknown); measure: MeasuredRunSource<unknown[]> }> = [];
  return {
    track<M extends MeasuredRunSource<unknown[]> & ((...args: never[]) => unknown)>(create: () => M): M {
      const measure = create();
      measures.push({ create, measure });
      return measure;
    },
    changed() {
      return measures.some(({ create, measure }) => {
        const fresh = create() as unknown as (...args: unknown[]) => unknown;
        for (const { args, result } of measure.runs()) {
          if (JSON.stringify(fresh(...args)) !== JSON.stringify(result)) return true;
        }
        return false;
      });
    }
  };
}

/** Measure once the fonts used by categories, terminals, plaques and fallback roles have settled.
 * With `measuredTextChanged`, a later face load invalidates layout only when a measured run
 * now measures differently. App text loads other faces of the same families lazily. */
export function watchTreeVisualizerFonts(fonts: FontFaceSet | undefined, changed: () => void, text = '',
  measuredTextChanged?: () => boolean): () => void {
  let disposed = false, initializing = true;
  const settle = () => { if (!disposed) changed(); };
  const loadingDone = (event: Event) => {
    const faces = (event as FontFaceSetLoadEvent).fontfaces;
    if (initializing || !faces.some(face => /^(Quicksand|Crimson Pro|JetBrains Mono|IBM Plex Mono)$/i.test(face.family.replace(/["']/g, '')))) return;
    if (!measuredTextChanged || measuredTextChanged()) settle();
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
  Promise.allSettled([CATEGORY_FONT, TERMINAL_FONT, TERMINAL_INDEX_FONT, CATEGORY_INDEX_FONT, fallbackRoleFont,
    "800 30px 'JetBrains Mono'", "400 11px 'IBM Plex Mono'"]
    .map(font => fonts.load(font, sample)))
    .then(() => fonts.ready)
    .then(() => { initializing = false; settle(); });
  return () => {
    disposed = true;
    fonts.removeEventListener('loadingdone', loadingDone);
  };
}
