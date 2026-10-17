import { useEffect, useRef, type RefObject } from 'react';

export type Spore = { left: number; delay: number; duration: number; drift: number };

const UPDATES_PER_SECOND = 60;
const RISE = 1.2; // Viewport heights travelled per cycle.
const PEAK_OPACITY = 0.35;

/** Position and opacity of a spore at cycle progress `p` (0–1): a linear rise and drift,
 * shrinking to 0.6 scale, fading in over the first and out over the last tenth. */
export const sporeFrame = (p: number, drift: number, viewportHeight: number) => ({
  transform: `translate3d(${drift * p}px, ${-RISE * viewportHeight * p}px, 0) scale(${1 - 0.4 * p})`,
  opacity: p < 0.1 ? PEAK_OPACITY * p / 0.1 : p > 0.9 ? PEAK_OPACITY * (1 - p) / 0.1 : PEAK_OPACITY
});

/**
 * Moves every spore in `layerRef` from one loop, so all of them change in the same frame.
 * Independently timed CSS animations made the browser composite, and re-blur every glass
 * surface, on nearly every display refresh. Updates are capped at 60 per second; paused
 * time is excluded, so a resumed spore continues where it stopped. Reduced motion leaves
 * the spores still at their stylesheet opacity.
 */
export const useSporeDrift = (layerRef: RefObject<HTMLElement | null>, spores: readonly Spore[], paused: boolean) => {
  const elapsedMs = useRef(0);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || paused) return;
    const elements = [...layer.children] as HTMLElement[];
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, previous: number | null = null, lastDrawn = -Infinity;
    const draw = (now: number) => {
      if (previous !== null) elapsedMs.current += now - previous;
      previous = now;
      // Tolerate refresh jitter so 60 Hz displays still draw every frame.
      if (now - lastDrawn >= 1000 / UPDATES_PER_SECOND - 2) {
        lastDrawn = now;
        spores.forEach((spore, index) => {
          const element = elements[index];
          if (!element) return;
          const cycleMs = spore.duration * 1000;
          const p = ((elapsedMs.current + spore.delay * 1000) % cycleMs) / cycleMs;
          const { transform, opacity } = sporeFrame(p, spore.drift, window.innerHeight);
          element.style.transform = transform;
          element.style.opacity = String(opacity);
        });
      }
      frame = requestAnimationFrame(draw);
    };
    const start = () => { previous = null; frame = requestAnimationFrame(draw); };
    const stop = () => cancelAnimationFrame(frame);
    const still = () => elements.forEach(element => { element.style.transform = ''; element.style.opacity = ''; });
    const onMotionChange = () => { stop(); if (motion.matches) still(); else start(); };
    motion.addEventListener('change', onMotionChange);
    if (!motion.matches) start();
    return () => { stop(); motion.removeEventListener('change', onMotionChange); };
  }, [layerRef, spores, paused]);
};
