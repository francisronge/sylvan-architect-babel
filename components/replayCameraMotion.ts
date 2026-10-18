type Camera = { x: number; y: number; k: number };
type Clock = {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

/** Interpolate the camera. `paint` also receives the eased progress, so a step's
 * layout glide moves in step with it; `holdsMotion` runs the animation for that
 * glide even when the camera itself stays still. Cancellation leaves the last
 * painted pose available for a new fit or user gesture. */
export function animateReplayCamera(from: Camera, to: Camera, duration: number,
  paint: (camera: Camera, progress: number) => void, finish: () => void, clock: Clock, holdsMotion = false) {
  let frame: number | undefined;
  let cancelled = false;
  const started = clock.now();
  if (duration <= 0 || (!holdsMotion && Math.hypot(from.x - to.x, from.y - to.y, from.k - to.k) < 1e-7)) {
    paint(to, 1);
    finish();
    return () => {};
  }
  paint(from, 0);
  const tick = (time: number) => {
    if (cancelled) return;
    const progress = Math.min(1, Math.max(0, (time - started) / duration));
    const t = progress * progress * (3 - 2 * progress);
    paint(progress === 1 ? to : {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      k: from.k + (to.k - from.k) * t
    }, progress === 1 ? 1 : t);
    if (progress === 1) finish();
    else frame = clock.request(tick);
  };
  frame = clock.request(tick);
  return () => { cancelled = true; if (frame !== undefined) clock.cancel(frame); };
}
