import fs from 'node:fs';
import path from 'node:path';

import { checkLocalRuntimeHost, readLocalHostPolicy } from '../server/localHostPolicy.js';

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

/**
 * Request handler serving a review page's files from the repository, its
 * `public/` folder and `node_modules/` on a loopback port. It answers only a
 * local Host on that port (server/localHostPolicy.js), so a rebound page cannot
 * read the checkout, and never serves a dot-named file or directory such as
 * `.env` or `.git/`.
 */
export const createReviewFileHandler = ({ root }) => (request, response) => {
  const rejected = checkLocalRuntimeHost(readLocalHostPolicy({}, { port: request.socket.localPort }),
    request.headers.host);
  if (rejected) {
    response.writeHead(rejected.status, { 'content-type': 'application/json; charset=utf-8' })
      .end(JSON.stringify(rejected.body));
    return;
  }
  let requestPath;
  try {
    requestPath = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  if (requestPath.split(/[\\/]/).some((segment) => segment.startsWith('.'))) {
    response.writeHead(404).end('Not found');
    return;
  }
  const candidates = [
    path.resolve(root, `.${requestPath}`),
    path.resolve(root, `./public${requestPath}`),
    path.resolve(root, `./node_modules${requestPath}`)
  ];
  const filePath = candidates.find((candidate) => (
    candidate.startsWith(`${root}${path.sep}`)
      && fs.existsSync(candidate)
      && fs.statSync(candidate).isFile()
  ));
  if (!filePath) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
};
