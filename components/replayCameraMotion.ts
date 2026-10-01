type Camera = { x: number; y: number; k: number };
type Clock = {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

/** Interpolate the camera only. Syntax and relation coordinates remain untouched.
 * Cancellation leaves the last painted pose available for a new fit or user gesture. */
export function animateReplayCamera(from: Camera, to: Camera, duration: number,
  paint: (camera: Camera) => void, finish: () => void, clock: Clock) {
  let frame: number | undefined;
  let cancelled = false;
  const started = clock.now();
  if (duration <= 0 || Math.hypot(from.x - to.x, from.y - to.y, from.k - to.k) < 1e-7) {
    paint(to);
    finish();
    return () => {};
  }
  paint(from);
  const tick = (time: number) => {
    if (cancelled) return;
    const progress = Math.min(1, Math.max(0, (time - started) / duration));
    const t = progress * progress * (3 - 2 * progress);
    paint(progress === 1 ? to : {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      k: from.k + (to.k - from.k) * t
    });
    if (progress === 1) finish();
    else frame = clock.request(tick);
  };
  frame = clock.request(tick);
  return () => { cancelled = true; if (frame !== undefined) clock.cancel(frame); };
}
