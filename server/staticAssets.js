import path from 'node:path';

// Vite names each file it emits into dist/assets after a hash of its content, so a
// changed file gets a new URL and a browser may keep the old one for good. Unhashed
// files there, such as the font licence, keep express.static's revalidating default.
// vercel.json's /assets/ rule sends the same value for the same names.
export const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const HASHED_ASSET_NAME = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export const isHashedAsset = (distPath, filePath) => {
  const relative = path.relative(path.join(distPath, 'assets'), filePath);
  return !relative.startsWith('..') && !path.isAbsolute(relative) && HASHED_ASSET_NAME.test(path.basename(relative));
};

/** express.static options for the built app. */
export const staticOptions = distPath => ({
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (isHashedAsset(distPath, filePath)) res.setHeader('Cache-Control', HASHED_ASSET_CACHE_CONTROL);
  }
});
