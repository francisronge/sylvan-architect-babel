import { CATEGORY_FONT } from '../replay/categoryTextLayout.ts';

/** Measure once the fonts used by categories and plaques have settled. */
export function watchTreeVisualizerFonts(fonts: FontFaceSet | undefined, changed: () => void, text = ''): () => void {
  let disposed = false, initializing = true;
  const settle = () => { if (!disposed) changed(); };
  const loadingDone = (event: Event) => {
    const faces = (event as FontFaceSetLoadEvent).fontfaces;
    if (!initializing && faces.some(face => /^(Quicksand|JetBrains Mono|IBM Plex Mono)$/i.test(face.family.replace(/["']/g, '')))) settle();
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
  const sample = [...new Set(`θ GRID ᵢⱼ ${text}`)].join('');
  Promise.allSettled([CATEGORY_FONT, "800 30px 'JetBrains Mono'", "400 11px 'IBM Plex Mono'"]
    .map(font => fonts.load(font, sample)))
    .then(() => fonts.ready)
    .then(() => { initializing = false; settle(); });
  return () => {
    disposed = true;
    fonts.removeEventListener('loadingdone', loadingDone);
  };
}
