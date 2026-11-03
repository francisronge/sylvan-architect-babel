// The repository files a set of entry modules reaches, followed through
// static, dynamic, worker, `new URL` and CSS imports and through the
// root-relative module names scripts pass to import(). Packages are not
// followed. Used by scripts/ciChangeScope.mjs and the public app's bundle
// boundary test.

import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json', '.css'];
const SPECIFIER_PATTERNS = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bnew URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
  /@import\s+(?:url\()?['"]([^'"]+)['"]/g
];

// Scripts also load modules by root-relative name, for example the list of
// entry modules scripts/replayCorpusSnapshot.mjs imports from each checkout.
const ROOT_RELATIVE = /['"`]((?:replay|components|server|services|hooks|scripts|tests|fixtures)\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|json|css))['"`]/g;

const isFile = (file) => fs.existsSync(file) && fs.statSync(file).isFile();

function resolveFrom(dir, specifier) {
  const base = path.resolve(dir, specifier.replace(/[?#].*$/, ''));
  for (const candidate of [base, ...EXTENSIONS.map(ext => base + ext), ...EXTENSIONS.map(ext => path.join(base, 'index' + ext))]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

// A specifier naming a folder (`new URL('../', import.meta.url)` is the
// repository root) imports nothing. Scripts build virtual entries whose
// imports are relative to the repository root (esbuild `resolveDir: root`),
// so an import a file cannot resolve beside itself is tried from the root.
function resolveSpecifier(from, specifier, root) {
  if (!specifier.startsWith('.') || /(^|\/)\.{0,2}\/?$/.test(specifier)) return null;
  return resolveFrom(path.dirname(from), specifier) ?? resolveFrom(root, specifier);
}

/** Repository-relative paths, with "/" separators, of every file the entries reach. */
export function importClosure(entries, root) {
  const seen = new Set();
  const queue = entries.map(file => path.join(root, file));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const resolved = resolveSpecifier(file, match[1], root);
        if (resolved && !resolved.includes(`${path.sep}node_modules${path.sep}`)) queue.push(resolved);
      }
    }
    for (const match of source.matchAll(ROOT_RELATIVE)) {
      const resolved = path.join(root, match[1]);
      if (isFile(resolved)) queue.push(resolved);
    }
  }
  return new Set([...seen].map(file => path.relative(root, file).split(path.sep).join('/')));
}
