import { CATEGORY_FONT } from '../replay/categoryTextLayout.ts';
import { FALLBACK_ROLE_STYLE } from '../replay/relations/fallbackGeometry.ts';
import { REPLAY_GENERATED_TERMINAL_GLYPHS } from '../replay/replaySurfaceNotation.ts';
import { CATEGORY_INDEX_FONT, TERMINAL_FONT, TERMINAL_INDEX_FONT } from './treeInkTextMeasure.ts';

/**
 * Records every run a layout measure is called with and the result layout used.
 * `changed()` re-measures each recorded run with new, uncached measures and
 * reports whether any result differs, so only a font change the layout could
 * see invalidates it. Its cost is one measurement per distinct recorded run.
 */
export function createMeasuredRuns() {
  const factories = new Map<string, () => (...args: never[]) => unknown>();
  const runs = new Map<string, { kind: string; args: unknown[]; result: string }>();
  return {
    track<A extends unknown[], R>(kind: string, create: () => (...args: A) => R): (...args: A) => R {
      factories.set(kind, create as () => (...args: never[]) => unknown);
      const measure = create();
      return (...args: A) => {
        const result = measure(...args);
        const key = args.every(arg => typeof arg === 'string') ? `${kind}\u0000${args.join('\u0000')}` : JSON.stringify([kind, args]);
        if (!runs.has(key)) runs.set(key, { kind, args, result: JSON.stringify(result) });
        return result;
      };
    },
    changed() {
      const fresh = new Map<string, (...args: unknown[]) => unknown>();
      for (const { kind, args, result } of runs.values()) {
        if (!fresh.has(kind)) fresh.set(kind, factories.get(kind)!() as (...args: unknown[]) => unknown);
        if (JSON.stringify(fresh.get(kind)!(...args)) !== result) return true;
      }
      return false;
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
