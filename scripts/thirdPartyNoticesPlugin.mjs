import fs from 'node:fs';
import path from 'node:path';

// Writes the license notices for third-party code and fonts that a Vite build
// ships. Register `plugin` on the app build and `workerPlugin` under
// `worker.plugins`: workers are separate Rollup builds that finish before the
// app bundle is written, so the app plugin sees every worker's packages too.
//
// The build emits THIRD_PARTY_NOTICES.txt for bundled code and
// assets/OFL-1.1.txt beside the font files, the same notices the Relation
// Orchard keeps in LICENSES/RELATION-ORCHARD-BUNDLE.txt and its fonts folder.
// A bundled package without a license file stops the build.

export const CODE_NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';
export const FONT_NOTICES_FILE = 'assets/OFL-1.1.txt';

const LICENSE_FILE = /^(?:licen[cs]e|copying|unlicense)(?:[.-].*)?$/i;
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;
const INLINED_FONT = /url\(\s*["']?data:(?:font\/|application\/(?:x-)?font)/;
const RULE = '='.repeat(80);
const DIVIDER = '-'.repeat(80);

const packageRootOf = (file) => {
  const marker = `${path.sep}node_modules${path.sep}`;
  const at = file.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = file.slice(at + marker.length).split(path.sep);
  const depth = rest[0].startsWith('@') ? 2 : 1;
  return file.slice(0, at + marker.length) + rest.slice(0, depth).join(path.sep);
};

const readPackage = (root) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(root).filter(name => LICENSE_FILE.test(name)).sort()[0];
  if (!licenseFile) {
    throw new Error(`Bundled package ${manifest.name}@${manifest.version} has no license file in ${root}`);
  }
  let text = fs.readFileSync(path.join(root, licenseFile), 'utf8').replace(/\r\n/g, '\n').trim();
  // Vite's license also lists the dependencies bundled into Vite's own build
  // tool. Only its core runtime helpers reach the app bundle.
  if (manifest.name === 'vite') text = text.split(/\n# Licenses of bundled dependencies/)[0].trim();
  return { label: `${manifest.name}@${manifest.version} (${manifest.license ?? 'see license text'})`, text };
};

// Rollup's CommonJS interop helpers reach the bundle from the copy of
// @rollup/plugin-commonjs that Vite ships; Vite's license file carries its text.
const COMMONJS_HELPERS = 'commonjs-helpers';
const readCommonjsHelpers = (viteRoot) => {
  const vite = JSON.parse(fs.readFileSync(path.join(viteRoot, 'package.json'), 'utf8'));
  const sections = fs.readFileSync(path.join(viteRoot, 'LICENSE.md'), 'utf8').replace(/\r\n/g, '\n').split(/\n## /);
  const section = sections.find(candidate => candidate.split('\n')[0].includes('@rollup/plugin-commonjs'));
  const text = section?.split('\n').filter(line => line.startsWith('>')).map(line => line.replace(/^> ?/, '')).join('\n').trim();
  if (!text) throw new Error(`vite@${vite.version} LICENSE.md has no @rollup/plugin-commonjs license text`);
  return { label: `@rollup/plugin-commonjs helpers, as distributed in vite@${vite.version} (MIT)`, text };
};

// Packages that share license text share one section, as in the Orchard file.
const renderSections = (entries) => {
  const byText = new Map();
  for (const { label, text, files = [] } of entries) {
    const group = byText.get(text) ?? { labels: [], files: [] };
    group.labels.push(label);
    group.files.push(...files);
    byText.set(text, group);
  }
  return [...byText.entries()]
    .map(([text, { labels, files }]) => ({ text, labels: labels.sort(), files: files.sort() }))
    .sort((a, b) => a.labels[0].localeCompare(b.labels[0]))
    .map(({ text, labels, files }) => [
      RULE,
      ...labels,
      ...(files.length ? ['', 'Font files:', ...files.map(file => `  ${file}`)] : []),
      DIVIDER,
      text
    ].join('\n'))
    .join('\n');
};

/** @returns {{ plugin: import('vite').Plugin, workerPlugin: import('vite').Plugin }} */
export const thirdPartyNoticesPlugins = ({ root = process.cwd() } = {}) => {
  const viteRoot = path.join(root, 'node_modules', 'vite');
  const codePackages = new Set();
  const fontFiles = new Map();
  const emittedFonts = new Set();
  // Vite asks `build.assetsInlineLimit` about every asset it may inline, so
  // the observer installed by `config` also sees the small fonts it writes
  // into the stylesheet as data URLs.
  const consideredFonts = new Set();

  const addFont = (source, label) => {
    const packageRoot = packageRootOf(source);
    if (!packageRoot) throw new Error(`Bundled font ${source} is not from an installed package`);
    const files = fontFiles.get(packageRoot) ?? new Set();
    files.add(label);
    fontFiles.set(packageRoot, files);
  };

  const collect = (bundle) => {
    for (const output of Object.values(bundle)) {
      if (output.type === 'chunk') {
        for (const [id, { renderedLength }] of Object.entries(output.modules)) {
          if (renderedLength === 0) continue;
          if (id.startsWith('\0vite/')) {
            codePackages.add(viteRoot);
            continue;
          }
          if (id === '\0commonjsHelpers.js') {
            codePackages.add(COMMONJS_HELPERS);
            continue;
          }
          const packageRoot = packageRootOf(id.replace(/^\0/, '').split('?')[0]);
          if (packageRoot) codePackages.add(packageRoot);
          else if (id.startsWith('\0')) throw new Error(`Bundled virtual module ${id.slice(1)} has no known license source`);
        }
        continue;
      }
      for (const original of output.originalFileNames ?? []) {
        const source = path.resolve(root, original);
        if (FONT_FILE.test(original)) {
          emittedFonts.add(source);
          addFont(source, output.fileName);
          continue;
        }
        const packageRoot = packageRootOf(source);
        if (packageRoot) codePackages.add(packageRoot);
      }
    }
  };

  const workerPlugin = {
    name: 'babel-third-party-notices-worker',
    apply: 'build',
    generateBundle(_, bundle) { collect(bundle); }
  };

  const plugin = {
    name: 'babel-third-party-notices',
    apply: 'build',
    config(userConfig) {
      const configured = userConfig.build?.assetsInlineLimit;
      return { build: { assetsInlineLimit: (file, content) => {
        if (FONT_FILE.test(file)) consideredFonts.add(path.resolve(root, file));
        if (typeof configured === 'function') return configured(file, content);
        return configured == null ? undefined : content.length < Number(configured);
      } } };
    },
    generateBundle(_, bundle) {
      collect(bundle);
      const inliningCss = Object.values(bundle)
        .filter(output => output.type === 'asset' && output.fileName.endsWith('.css')
          && INLINED_FONT.test(String(output.source)))
        .map(output => output.fileName)
        .sort();
      const inlined = [...consideredFonts].filter(source => !emittedFonts.has(source));
      if (inliningCss.length && !inlined.length) {
        this.error(`${inliningCss.join(', ')} inlines a font this plugin did not see; `
          + `its license would be missing from ${FONT_NOTICES_FILE}`);
      }
      for (const source of inlined) {
        addFont(source, `${path.basename(source)} (inlined in ${inliningCss.join(', ') || 'the JavaScript bundle'})`);
      }
      this.emitFile({ type: 'asset', fileName: CODE_NOTICES_FILE, source: [
        'Sylvan Architect Babel - bundled third-party software notices',
        '',
        'This file lists the packages whose code this build bundles into its',
        'JavaScript, including the Replay workers. The license text below is copied',
        'from each installed package; packages with identical text share one',
        `section. Font licenses are in ${FONT_NOTICES_FILE}.`,
        '',
        renderSections([...codePackages].map(entry => (entry === COMMONJS_HELPERS
          ? readCommonjsHelpers(viteRoot) : readPackage(entry)))),
        ''
      ].join('\n') });
      if (!fontFiles.size) return;
      this.emitFile({ type: 'asset', fileName: FONT_NOTICES_FILE, source: [
        'Sylvan Architect Babel - bundled font notices',
        '',
        'The font files in this folder, and the small ones inlined into the',
        'stylesheet, are licensed under the SIL Open Font License 1.1. Each',
        'family\'s copyright notice and license text is copied from its installed',
        'package, with the files it supplies.',
        '',
        renderSections([...fontFiles].map(([packageRoot, files]) => ({ ...readPackage(packageRoot), files: [...files] }))),
        ''
      ].join('\n') });
    }
  };

  return { plugin, workerPlugin };
};
