#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orchardResearchImages, orchardSourcePreviewPath } from '../docs/research/relation-orchard/source-research-images.ts';
import { CODE_NOTICES_FILE, FONT_NOTICES_FILE } from './thirdPartyNoticesPlugin.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredPaths = [
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'TRADEMARKS.md',
  'LICENSES/RELATION-ORCHARD-BUNDLE.txt',
  'docs/design/babel-visual-relations-research.production-only-audit.html',
  'docs/design/visual-relations-current-lab.tsx',
  'docs/design/visual-relations-lab-cards.ts',
  'docs/design/visual-relations-current-lab.production-only-audit.r96.bundle.js',
  'docs/design/visual-relations-source-gallery.tsx',
  'docs/research/relation-orchard/index.md',
  'docs/research/relation-orchard/orchard.html',
  'docs/research/relation-orchard/relation-orchard.bundle.js',
  'docs/research/relation-orchard/source-citations.css',
  'docs/research/relation-orchard/assets/source-figures/poole-dependent-case-low.png',
  'docs/research/relation-orchard/assets/source-figures/poole-keine-reconstruction-example-2.png',
  'docs/research/relation-orchard/assets/source-figures/parasitic-gap-tree.png',
  'docs/research/relation-orchard/assets/source-figures/assmann-et-al-focus-marking-example-49.png',
  'docs/research/relation-orchard/assets/relation-orchard-overview.png',
  'docs/research/relation-orchard/assets/babellogo.png',
  'docs/research/relation-orchard/assets/fonts/OFL-1.1.txt',
  'docs/research/relation-orchard/assets/fonts/crimson-pro-latin-400-normal.woff2',
  'docs/research/relation-orchard/assets/fonts/crimson-pro-latin-400-italic.woff2',
  'docs/research/relation-orchard/assets/fonts/crimson-pro-latin-700-normal.woff2',
  'docs/research/relation-orchard/assets/fonts/jetbrains-mono-latin-400-normal.woff2',
  'docs/research/relation-orchard/assets/fonts/quicksand-latin-400-normal.woff2',
  'docs/research/relation-orchard/assets/fonts/quicksand-latin-700-normal.woff2',
  'public/apple-touch-icon.png',
  'public/babellogo.png',
  'public/favicon.png',
  'public/robots.txt',
  'public/sitemap.xml',
];

const documentsToScan = [
  'README.md',
  'docs/README.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/design/babel-visual-relations-research.production-only-audit.html',
  'docs/research/relation-orchard/index.md',
  'docs/research/relation-orchard/orchard.html',
];

const isExternalOrRoute = (reference) => (
  reference === ''
  || reference.startsWith('#')
  || reference.startsWith('/')
  || /^[a-z][a-z0-9+.-]*:/i.test(reference)
);

const normalizeReference = (rawReference) => {
  const withoutTitle = rawReference.trim().replace(/^<|>$/g, '').split(/\s+["']/)[0];
  const withoutFragment = withoutTitle.split('#')[0].split('?')[0];
  return decodeURIComponent(withoutFragment);
};

const collectReferences = (contents, extension) => {
  const references = [];
  if (extension === '.md') {
    const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of contents.matchAll(markdownLink)) references.push(match[1]);
  } else {
    const htmlAttribute = /\b(?:href|src)=["']([^"']+)["']/gi;
    const cssUrl = /\burl\(["']?([^)'"\s]+)["']?\)/gi;
    for (const match of contents.matchAll(htmlAttribute)) references.push(match[1]);
    for (const match of contents.matchAll(cssUrl)) references.push(match[1]);
  }
  return references;
};

const missing = [];
const sourcePreviewPaths = new Set(Object.values(orchardResearchImages)
  .flat()
  .map((image) => `docs/research/relation-orchard/${orchardSourcePreviewPath(image.path)}`));
const orchardBundles = await Promise.all([
  'docs/design/visual-relations-current-lab.production-only-audit.r96.bundle.js',
  'docs/research/relation-orchard/relation-orchard.bundle.js'
].map(relativePath => readFile(path.join(repoRoot, relativePath))));
if (!orchardBundles[0].equals(orchardBundles[1])) {
  missing.push('Orchard bundles differ; rebuild both with npm run orchard:build');
}
for (const relativePath of [...requiredPaths, ...sourcePreviewPaths]) {
  try {
    await access(path.join(repoRoot, relativePath));
  } catch {
    missing.push(`${relativePath} (required release file)`);
  }
}

for (const documentPath of documentsToScan) {
  const absoluteDocumentPath = path.join(repoRoot, documentPath);
  const contents = await readFile(absoluteDocumentPath, 'utf8');
  for (const rawReference of collectReferences(contents, path.extname(documentPath))) {
    const reference = normalizeReference(rawReference);
    if (isExternalOrRoute(reference)) continue;
    const target = path.resolve(path.dirname(absoluteDocumentPath), reference);
    try {
      await access(target);
    } catch {
      missing.push(`${documentPath} -> ${rawReference}`);
    }
  }
}

// The app build (`npm run build`) must carry the notices for what it ships:
// every bundled font file is named in the OFL notice, and the code notice
// covers the packages every build bundles.
const distRoot = path.join(repoRoot, 'dist');
const readDist = async (relativePath) => {
  try {
    return await readFile(path.join(distRoot, relativePath), 'utf8');
  } catch {
    missing.push(`dist/${relativePath} (run npm run build first)`);
    return null;
  }
};
const codeNotices = await readDist(CODE_NOTICES_FILE);
for (const name of ['react', 'react-dom', 'scheduler', 'd3-selection', 'd3-ease', 'lucide-react']) {
  if (codeNotices !== null && !new RegExp(`^${name}@`, 'm').test(codeNotices)) {
    missing.push(`dist/${CODE_NOTICES_FILE} -> ${name} (bundled package without a notice)`);
  }
}
const fontNotices = await readDist(FONT_NOTICES_FILE);
let distFontCount = 0;
if (fontNotices !== null) {
  const listed = new Set(fontNotices.split('\n').map(line => line.trim()));
  const assetFiles = await readdir(path.join(distRoot, 'assets'));
  for (const file of assetFiles.filter(name => /\.(?:woff2?|ttf|otf|eot)$/i.test(name))) {
    distFontCount += 1;
    if (!listed.has(`assets/${file}`)) missing.push(`dist/assets/${file} (font not named in dist/${FONT_NOTICES_FILE})`);
  }
  if (distFontCount === 0) missing.push('dist/assets has no font files; the font notice check saw nothing');
}

if (missing.length > 0) {
  console.error('Release asset verification failed:');
  for (const failure of missing) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Release assets verified: ${requiredPaths.length} required files, ${sourcePreviewPaths.size} source previews, ${documentsToScan.length} linked documents, and app build notices for ${distFontCount} font files.`);
}
