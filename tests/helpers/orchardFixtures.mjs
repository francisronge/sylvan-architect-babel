import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const path = fileURLToPath(new URL('../../docs/design/visual-relations-current-lab.tsx', import.meta.url));
let loaded;

// Expose private fixture bindings only in the test bundle. Their values come
// from executing the real module, including its constructors and transformations.
export const loadOrchardFixtures = () => loaded ??= (async () => {
  const source = await readFile(path, 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations)
    .filter(declaration => ts.isIdentifier(declaration.name))
    .map(declaration => declaration.name.text);
  const { outputFiles } = await build({
    entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'executable-orchard-fixtures', setup(builder) {
      builder.onLoad({ filter: /visual-relations-current-lab\.tsx$/ }, () => ({
        contents: `${source}\nexport const __babelFixtureBindings = {${names.join(',')}};`, loader: 'tsx'
      }));
    } }]
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  assert.ok(Array.isArray(module.rawCases), 'the Orchard must export executable fixtures');
  const trees = new Map(Object.entries(module.__babelFixtureBindings)
    .filter(([, value]) => value && typeof value === 'object' && typeof value.id === 'string' && typeof value.label === 'string'));
  assert.ok(trees.size > 30, `expected executable Orchard trees, got ${trees.size}`);
  return { rawCases: module.rawCases, trees };
})();
