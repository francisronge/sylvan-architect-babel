import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CODE_NOTICES_FILE, FONT_NOTICES_FILE, thirdPartyNoticesPlugins } from '../scripts/thirdPartyNoticesPlugin.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const moduleIn = (...parts) => path.join(repoRoot, 'node_modules', ...parts);

const runBuild = ({ root = repoRoot, worker = {}, app = {}, inlined = [] } = {}) => {
  const { plugin, workerPlugin } = thirdPartyNoticesPlugins({ root });
  const { assetsInlineLimit } = plugin.config({}).build;
  for (const file of inlined) assert.equal(assetsInlineLimit(path.join(root, file), Buffer.alloc(10)), undefined);
  const emitted = {};
  workerPlugin.generateBundle({}, worker);
  plugin.generateBundle.call({
    emitFile: ({ fileName, source }) => { emitted[fileName] = source; },
    error: message => { throw new Error(message); }
  }, {}, app);
  return emitted;
};

const chunk = modules => ({ type: 'chunk', modules: Object.fromEntries(
  Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }])) });

test('app and worker packages that ship code get their license text', () => {
  const emitted = runBuild({
    worker: { 'assets/replay.worker.js': chunk({ [moduleIn('robust-predicates', 'esm', 'orient2d.js')]: 120 }) },
    app: {
      'assets/index.js': chunk({
        [moduleIn('react', 'index.js')]: 10,
        [moduleIn('d3-ease', 'src', 'cubic.js')]: 40,
        [moduleIn('d3-geo', 'src', 'index.js')]: 0,
        '\0vite/preload-helper.js': 300,
        '\0commonjsHelpers.js': 50,
        [path.join(repoRoot, 'App.tsx')]: 900
      })
    }
  });
  const notices = emitted[CODE_NOTICES_FILE];
  const version = name => JSON.parse(fs.readFileSync(moduleIn(name, 'package.json'), 'utf8')).version;
  for (const name of ['react', 'd3-ease', 'robust-predicates', 'vite']) {
    assert.match(notices, new RegExp(`^${name}@${version(name).replaceAll('.', '\\.')} `, 'm'), name);
  }
  assert.ok(notices.includes(fs.readFileSync(moduleIn('d3-ease', 'LICENSE'), 'utf8').trim()));
  assert.match(notices, /^@rollup\/plugin-commonjs helpers, as distributed in vite@\S+ \(MIT\)\n-+\nThe MIT License \(MIT\)\n\nCopyright \(c\) 2019 RollupJS Plugin Contributors/m);
  assert.doesNotMatch(notices, /d3-geo@/, 'a tree-shaken package ships no code');
  assert.doesNotMatch(notices, /Licenses of bundled dependencies/, 'only Vite core helpers reach the bundle');
  assert.equal(emitted[FONT_NOTICES_FILE], undefined);
});

test('font assets get their family OFL text and are listed by file', () => {
  const emitted = runBuild({ app: {
    'assets/quicksand-latin-400-normal-abc.woff2': { type: 'asset', fileName: 'assets/quicksand-latin-400-normal-abc.woff2',
      originalFileNames: ['node_modules/@fontsource/quicksand/files/quicksand-latin-400-normal.woff2'] },
    'assets/crimson-pro-latin-700-normal-def.woff': { type: 'asset', fileName: 'assets/crimson-pro-latin-700-normal-def.woff',
      originalFileNames: ['node_modules/@fontsource/crimson-pro/files/crimson-pro-latin-700-normal.woff'] }
  } });
  const fonts = emitted[FONT_NOTICES_FILE];
  assert.match(fonts, /@fontsource\/quicksand@\S+ \(OFL-1\.1\)/);
  assert.match(fonts, /^ {2}assets\/quicksand-latin-400-normal-abc\.woff2$/m);
  assert.match(fonts, /^ {2}assets\/crimson-pro-latin-700-normal-def\.woff$/m);
  assert.match(fonts, /Reserved Font Name "Quicksand"/);
  assert.match(fonts, /SIL OPEN FONT LICENSE Version 1\.1/);
});

const inliningCss = { 'assets/index.css': { type: 'asset', fileName: 'assets/index.css',
  source: '@font-face{src:url(data:font/woff2;base64,AAAA)}' } };

test('fonts Vite inlines into the stylesheet are listed with their family license', () => {
  const emitted = runBuild({ app: inliningCss,
    inlined: ['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-vietnamese-400-normal.woff2'] });
  assert.match(emitted[FONT_NOTICES_FILE], /@fontsource\/jetbrains-mono@\S+ \(OFL-1\.1\)/);
  assert.match(emitted[FONT_NOTICES_FILE], /^ {2}jetbrains-mono-vietnamese-400-normal\.woff2 \(inlined in assets\/index\.css\)$/m);
});

test('an unseen inlined font or a package without a license file stops the build', t => {
  assert.throws(() => runBuild({ app: inliningCss }), /inlines a font this plugin did not see/);
  assert.throws(() => runBuild({ app: { 'assets/index.js': chunk({ '\0unknown-helper.js': 5 }) } }),
    /virtual module unknown-helper\.js has no known license source/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-notices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'node_modules', 'unlicensed'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'unlicensed', 'package.json'), '{"name":"unlicensed","version":"1.0.0"}');
  assert.throws(() => runBuild({ root, app: { 'assets/index.js': chunk({
    [path.join(root, 'node_modules', 'unlicensed', 'index.js')]: 5 }) } }), /unlicensed@1\.0\.0 has no license file/);
});
