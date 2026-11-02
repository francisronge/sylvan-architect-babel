/*
 * Runs before Babel's module bundle. A browser that lacks a feature Babel's code
 * needs without a fallback gets a plain message instead of a blank or broken
 * page. This is feature detection only; it never reads the user agent.
 *
 * Keep this file ES5 so the oldest browsers can parse it, and keep REQUIRED in
 * step with "Supported browsers" in README.md. index.tsx does not mount the app
 * when window.__BABEL_UNSUPPORTED__ lists a feature.
 */
(function () {
  var REQUIRED = [
    // The app is an ES module bundle with module workers.
    ['JavaScript modules', function () { return 'noModule' in document.createElement('script'); }],
    // Splits words and letters for spelling checks and label layout.
    ['Intl.Segmenter', function () { return typeof Intl === 'object' && typeof Intl.Segmenter === 'function'; }],
    // Copies syntax trees while Replay is built.
    ['structuredClone', function () { return typeof structuredClone === 'function'; }],
    ['Array.prototype.at', function () { return typeof Array.prototype.at === 'function'; }],
    ['Object.hasOwn', function () { return typeof Object.hasOwn === 'function'; }],
    // Keeps the tree fitted to its view.
    ['ResizeObserver', function () { return typeof ResizeObserver === 'function'; }]
  ];

  var missing = [];
  for (var i = 0; i < REQUIRED.length; i++) {
    var present = false;
    try { present = REQUIRED[i][1](); } catch (error) { present = false; }
    if (!present) missing.push(REQUIRED[i][0]);
  }
  window.__BABEL_UNSUPPORTED__ = missing;
  if (!missing.length) return;

  var root = document.getElementById('root');
  if (!root) return;
  var notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.setAttribute('style', 'max-width:36rem;margin:0 auto;padding:4rem 1.5rem;font-family:system-ui,sans-serif;line-height:1.5;color:#a7f3d0');
  var title = document.createElement('h1');
  title.setAttribute('style', 'font-size:1.25rem;color:#ecfdf5;margin:0 0 1rem');
  title.appendChild(document.createTextNode('Babel needs a newer browser.'));
  var body = document.createElement('p');
  body.setAttribute('style', 'margin:0 0 1rem');
  body.appendChild(document.createTextNode(
    'Please update to a current version of Chrome, Edge, Firefox or Safari, then reload this page.'));
  var detail = document.createElement('p');
  detail.setAttribute('style', 'margin:0;font-size:0.875rem;color:#6ee7b7');
  detail.appendChild(document.createTextNode('This browser is missing: ' + missing.join(', ') + '.'));
  notice.appendChild(title);
  notice.appendChild(body);
  notice.appendChild(detail);
  root.appendChild(notice);
})();
