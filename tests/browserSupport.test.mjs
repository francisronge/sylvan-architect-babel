import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('public/browser-support.js');

// Runs the script as a browser would, in a context holding only what it may read.
const run = (remove = []) => {
  const appended = [];
  const element = tag => ({
    tag, children: [], attributes: {}, ...(tag === 'script' ? { noModule: false } : {}),
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; }
  });
  const root = { appendChild: child => { appended.push(child); return child; } };
  const context = {
    Intl: { Segmenter: Intl.Segmenter },
    structuredClone,
    Array: { prototype: { at: Array.prototype.at } },
    Object: { hasOwn: Object.hasOwn },
    ResizeObserver: class {},
    document: {
      createElement: element,
      createTextNode: text => ({ text }),
      getElementById: id => (id === 'root' ? root : null)
    }
  };
  for (const feature of remove) {
    if (feature === 'JavaScript modules') context.document.createElement = tag => {
      const node = element(tag); delete node.noModule; return node;
    };
    else if (feature === 'Intl.Segmenter') delete context.Intl.Segmenter;
    else if (feature === 'Array.prototype.at') delete context.Array.prototype.at;
    else if (feature === 'Object.hasOwn') delete context.Object.hasOwn;
    else delete context[feature];
  }
  context.window = context;
  vm.runInNewContext(source, context);
  const text = node => node.text ?? node.children.map(text).join(' ');
  return { missing: [...context.__BABEL_UNSUPPORTED__], notice: appended[0], text: appended.map(text).join(' ') };
};

const FEATURES = ['JavaScript modules', 'Intl.Segmenter', 'structuredClone', 'Array.prototype.at', 'Object.hasOwn', 'ResizeObserver'];

test('a browser with every required feature loads the app and sees no message', () => {
  const result = run();
  assert.deepEqual(result.missing, []);
  assert.equal(result.notice, undefined);
});

for (const feature of FEATURES) {
  test(`a browser without ${feature} gets a plain message naming it instead of the app`, () => {
    const result = run([feature]);
    assert.deepEqual(result.missing, [feature]);
    assert.equal(result.notice.attributes.role, 'alert');
    assert.match(result.text, /Babel needs a newer browser\./);
    assert.match(result.text, /current version of Chrome, Edge, Firefox or Safari/);
    assert.match(result.text, new RegExp(`This browser is missing: ${feature.replace(/\./g, '\\.')}\\.`));
  });
}

test('several missing features are all named', () => {
  assert.match(run(['structuredClone', 'Intl.Segmenter']).text, /missing: Intl\.Segmenter, structuredClone\./);
});

test('detection reads features only, never the user agent', () => {
  assert.doesNotMatch(source, /userAgent|navigator|vendor|platform/);
});

test('the check parses in browsers too old to run the app: ES5 only', async () => {
  const { code } = await transform(source, { target: 'es5', minify: true });
  assert.doesNotMatch(code, /=>|`|\b(?:let|const|class)\b|\?\.|\?\?/);
});

test('the page runs the check as a classic script before the module bundle, which then stays unmounted', () => {
  const html = read('index.html');
  const check = html.indexOf('<script src="/browser-support.js"></script>');
  assert(check > html.indexOf('<div id="root"></div>'), 'the check runs after #root exists');
  assert(check < html.indexOf('<script type="module" src="/index.tsx">'), 'and before the app');
  assert.match(read('index.tsx'), /if \(!unsupported\?\.length\) \{\s*ReactDOM\.createRoot/);
});

test('README lists every detected feature', () => {
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('## Supported browsers'));
  assert(section.length < readme.length, 'README has a Supported browsers section');
  for (const feature of FEATURES) assert(section.includes(`\`${feature}\``) || section.includes(feature), feature);
  assert.deepEqual(run(FEATURES).missing, FEATURES, 'the test covers exactly the script\'s list');
});
