import fs from 'node:fs';
import path from 'node:path';

import { buildStampTags } from '../scripts/buildVersionPlugin.mjs';

// The local server serves dist/ as it is and never rebuilds it, so a build from
// an earlier checkout would silently run old frontend code against the current
// server. Each build stamps index.html (scripts/buildVersionPlugin.mjs); this
// compares those stamps with the checkout before dist/ is served.

const metaContent = (html, name) => {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (new RegExp(`\\bname=["']${name}["']`, 'i').test(tag)) {
      return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? null;
    }
  }
  return null;
};

/** Null when `distPath` holds a build of the checkout at `root`, otherwise the
 * reason it is stale and how to rebuild it. */
export const describeStaleDist = ({ root, distPath, env = process.env }) => {
  const indexPath = path.join(distPath, 'index.html');
  const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const expected = buildStampTags({ root, env }).map(({ attrs }) => attrs);
  const fix = 'Run `npm run build` to rebuild it, or remove dist/ to serve only the API.';
  if (expected.some(({ name }) => metaContent(html, name) === null)) {
    return `${indexPath} has no build stamp, so it may come from older sources. ${fix}`;
  }
  const differing = expected.filter(({ name, content }) => metaContent(html, name) !== content);
  if (differing.length === 0) return null;
  const describe = stamps => stamps.map(({ name, content }) => `${name} ${content}`).join(', ');
  return `${distPath} was built from ${describe(differing.map(({ name }) => ({ name, content: metaContent(html, name) })))}; `
    + `this checkout is ${describe(differing)}. ${fix}`;
};
