// Confirms that the CI browser shard jobs together ran the full browser gate.
//   node scripts/checkBrowserShardReceipts.mjs DIR
// DIR holds one directory per downloaded receipt artifact, named
// browser-receipt-<shard>-<run attempt>, each containing that job's
// receipt.json. A re-run of failed jobs leaves the passing shard's receipt
// under its earlier attempt, so the latest attempt of each shard is used.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkShardReceipts } from './browserSuites.mjs';

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('Usage: node scripts/checkBrowserShardReceipts.mjs DIR');
  process.exit(1);
}
const latest = new Map();
for (const entry of await readdir(dir, { withFileTypes: true })) {
  const match = entry.isDirectory() && /^browser-receipt-(.+)-(\d+)$/.exec(entry.name);
  if (!match) continue;
  const [, shard, attempt] = match;
  if ((latest.get(shard)?.attempt ?? -1) < Number(attempt)) latest.set(shard, { attempt: Number(attempt), file: path.join(dir, entry.name, 'receipt.json') });
}
const receipts = await Promise.all([...latest.values()].map(async ({ file }) => JSON.parse(await readFile(file, 'utf8'))));
try {
  const actual = await readdir(new URL('../tests/browser/', import.meta.url));
  const { shards, specs } = checkShardReceipts(actual, receipts);
  for (const receipt of receipts) console.log(`${receipt.suite}: ${receipt.required.length} specs, ${receipt.testSummary.pass}/${receipt.testSummary.tests} tests passed`);
  console.log(`${shards} shards ran all ${specs} required browser specs, each exactly once.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
