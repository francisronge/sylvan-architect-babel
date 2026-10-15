import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const replay = path.join(root, 'replay');
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? files(file) : /\.(?:ts|js)$/u.test(file) ? [file] : [];
});

test('Replay runtime dependencies stay acyclic and independent of React and components', () => {
  const visited = new Set();
  const active = [];
  const visit = file => {
    assert(!active.includes(file), `Runtime import cycle: ${[...active, file].map(f => path.relative(root, f)).join(' → ')}`);
    if (visited.has(file)) return;
    active.push(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly || clause && !clause.name && clause.namedBindings
          && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(entry => entry.isTypeOnly)) continue;
      } else if (statement.isTypeOnly || statement.exportClause && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.every(entry => entry.isTypeOnly)) continue;
      const specifier = statement.moduleSpecifier.text;
      assert(!/^react(?:-dom)?(?:\/|$)/u.test(specifier), `Replay depends on ${specifier} through ${file}`);
      if (!specifier.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), specifier);
      assert(!base.startsWith(path.join(root, 'components') + path.sep), `Replay depends on a component through ${file}`);
      const target = [base, base + '.ts', base + '.js'].find(existsSync);
      assert(target, `Unresolved local dependency ${specifier} in ${file}`);
      visit(target);
    }
    active.pop();
    visited.add(file);
  };
  files(replay).forEach(visit);
});
