/** Playwright context options that record a video into `dir`, only when
 * BABEL_BROWSER_VIDEO=1 (`npm run verify:browser -- --video`). No assertion reads
 * a video; turn it on to review motion. Failure screenshots do not depend on it. */
export const BROWSER_VIDEO = process.env.BABEL_BROWSER_VIDEO === '1';

export const recordVideo = (dir, size) => (BROWSER_VIDEO && dir ? { recordVideo: { dir, ...(size ? { size } : {}) } } : {});
