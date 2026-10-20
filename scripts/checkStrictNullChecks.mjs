// strictNullChecks applies to a whole TypeScript program, and replay/ is not yet
// null-safe. This runs the project typecheck with the flag and fails on any error
// outside replay/; replay errors are counted, not failed.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const { status, stdout, stderr } = spawnSync(process.execPath,
  [tsc, '--noEmit', '--pretty', 'false', '--strictNullChecks'], { encoding: 'utf8' });
if (status === null || status > 2) {
  process.stderr.write(stdout + stderr);
  process.exit(status ?? 1);
}
const errors = stdout.split('\n').filter(line => /error TS\d+:/.test(line));
const replayErrors = errors.filter(line => line.startsWith('replay/'));
const enforced = errors.filter(line => !line.startsWith('replay/'));
for (const line of enforced) console.error(line);
console.log(`strictNullChecks: ${enforced.length} errors outside replay/, ${replayErrors.length} in replay/ (not enforced).`);
process.exit(enforced.length ? 1 : 0);
