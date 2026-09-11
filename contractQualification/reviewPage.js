const embeddedJson = (value) => JSON.stringify(value)
  .replace(/&/gu, '\\u0026')
  .replace(/</gu, '\\u003c')
  .replace(/>/gu, '\\u003e')
  .replace(/\u2028/gu, '\\u2028')
  .replace(/\u2029/gu, '\\u2029');

export const buildQualificationReviewHtml = (reviewData, runtime) => {
  if (!runtime?.js || !runtime?.css) throw new Error('The review requires its offline renderer bundle.');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Babel qualification review</title>
  <style>${runtime.css.replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body>
  <div id="root"></div>
  <noscript>JavaScript is required for Replay. The original archive files remain unchanged.</noscript>
  <script id="review-data" type="application/json">${embeddedJson(reviewData)}</script>
  <script>${runtime.js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>
</body>
</html>`;
};
