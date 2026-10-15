import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';

const run = promisify(execFile);
const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];
const verifyDeclarations = (actual, expected, name, fields = dependencyFields) => {
  if (fields.some(field => !isDeepStrictEqual(actual[field] ?? {}, expected?.[field] ?? {}))) {
    throw Error(`Installed dependency declarations differ from the lock: ${name}`);
  }
};

export async function verifyDependencyInstallation(root) {
  const bytes = await fs.readFile(path.join(root, 'package-lock.json'));
  const expected = JSON.parse(bytes);
  const project = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  verifyDeclarations(project, expected.packages[''], 'package.json', [...dependencyFields, 'devDependencies']);
  const installed = JSON.parse(await fs.readFile(path.join(root, 'node_modules/.package-lock.json'), 'utf8'));
  // The hidden lock can outlive files changed or removed inside a package. Read
  // each actual manifest, including transitives, before trusting its version.
  await Promise.all(Object.entries(installed.packages).map(async ([name, entry]) => {
    if (!name.startsWith('node_modules/') || name.split('/').includes('..')) throw Error(`Invalid installed package path: ${name}`);
    const actual = JSON.parse(await fs.readFile(path.join(root, name, 'package.json'), 'utf8'));
    if (expected.packages[name]?.version !== entry.version || actual.version !== entry.version) {
      throw Error(`Installed dependency differs from the lock: ${name}`);
    }
    verifyDeclarations(actual, expected.packages[name], name);
  }));
  // npm owns dependency closure, peer requirements and platform-optional rules.
  // This also catches a required package missing from both disk and the hidden lock.
  try {
    await run('npm', ['ls', '--all', '--json'], { cwd: root, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    let problems;
    try { problems = JSON.parse(error.stdout).problems; } catch { /* Preserve process errors without assuming JSON. */ }
    throw Error(`Installed dependency graph is incomplete: ${problems?.join('; ') || error.message}`);
  }
  return { packageLockSha256: createHash('sha256').update(bytes).digest('hex'),
    installedPackages: Object.keys(installed.packages).length };
}
