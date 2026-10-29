import { readdir } from 'node:fs/promises';

// Every native-browser file has one owner. The fast renderer gate is a subset;
// the full gate includes application, atlas, and cross-engine evidence.
export const BROWSER_SPECS = [
  { file: 'movementEndpointAttachment.test.mjs', owner: 'renderer', focused: true, ciSeconds: 19 },
  { file: 'trajectoryLabelClearance.test.mjs', owner: 'renderer', focused: true, ciSeconds: 14 },
  { file: 'connectorTextMask.test.mjs', owner: 'renderer', focused: true, ciSeconds: 7 },
  { file: 'featureComposition.test.mjs', owner: 'renderer', focused: true, ciSeconds: 64 },
  { file: 'plaqueClearance.test.mjs', owner: 'renderer', focused: true, ciSeconds: 46 },
  { file: 'operatorBindingComposition.test.mjs', owner: 'renderer', focused: true, ciSeconds: 5 },
  { file: 'relationInkObstacles.test.mjs', owner: 'renderer', ciSeconds: 1 },
  { file: 'relationEmphasis.test.mjs', owner: 'renderer', ciSeconds: 9 },
  { file: 'relationOutcomePaint.test.mjs', owner: 'renderer', ciSeconds: 35 },
  { file: 'thetaGridHistory.test.mjs', owner: 'renderer', ciSeconds: 5 },
  { file: 'tier2ProductionRecipes.test.mjs', owner: 'atlas', ciSeconds: 62 },
  { file: 'appWorkflow.test.mjs', owner: 'application', ciSeconds: 141 },
  { file: 'rendererCloseout.test.mjs', owner: 'application', ciSeconds: 16 },
  { file: 'viewErrorBoundary.test.mjs', owner: 'application', ciSeconds: 1 },
  { file: 'reviewCompatibility.test.mjs', owner: 'compatibility', ciSeconds: 18 },
  { file: 'captureHarness.test.mjs', owner: 'capture', ciSeconds: 15 }
];

// CI runs the full gate as parallel jobs, one per shard (`--suite ci:<shard>`).
// A deterministic greedy split over `ciSeconds` (each spec's approximate
// seconds on the CI runner, measured from its test durations) assigns every
// spec to exactly one shard, so the shards together run the full gate once;
// checkShardReceipts confirms that from the receipts the jobs wrote. The
// weights only balance the shards: a stale or missing weight never drops a spec.
export const BROWSER_CI_SHARD_COUNT = 3;

export function assignBrowserShards(specs = BROWSER_SPECS, count = BROWSER_CI_SHARD_COUNT) {
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  const ordered = [...specs].sort((a, b) => (b.ciSeconds ?? 1) - (a.ciSeconds ?? 1) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const spec of ordered) {
    const lightest = shards.reduce((best, shard) => shard.seconds < best.seconds ? shard : best);
    lightest.files.push(spec.file);
    lightest.seconds += spec.ciSeconds ?? 1;
  }
  return Object.fromEntries(shards.map((shard, index) => [String(index + 1), shard.files]));
}

export const BROWSER_CI_SHARDS = assignBrowserShards();

/** Throws unless every spec belongs to exactly one shard and every shard has a spec. */
export function checkBrowserShards(specs = BROWSER_SPECS, shards = BROWSER_CI_SHARDS) {
  const files = specs.map(spec => spec.file);
  const assigned = Object.values(shards).flat();
  const repeated = assigned.filter((file, index) => assigned.indexOf(file) !== index);
  const unsharded = files.filter(file => !assigned.includes(file));
  const unknown = assigned.filter(file => !files.includes(file));
  const empty = Object.keys(shards).filter(shard => !shards[shard].length);
  if (repeated.length || unsharded.length || unknown.length || empty.length) {
    throw new Error(`Browser CI shards do not partition the specs. Repeated: ${repeated.join(', ') || 'none'}; unsharded: ${unsharded.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}; empty shards: ${empty.join(', ') || 'none'}`);
  }
}

export function selectBrowserSpecs(actualFiles, suite = 'full', specs = BROWSER_SPECS, shards = BROWSER_CI_SHARDS) {
  const declared = specs.map(spec => spec.file);
  const actual = actualFiles.filter(file => file.endsWith('.test.mjs')).sort();
  if (new Set(declared).size !== declared.length) throw new Error('Browser manifest repeats a spec.');
  const missing = declared.filter(file => !actual.includes(file));
  const unowned = actual.filter(file => !declared.includes(file));
  if (missing.length || unowned.length) throw new Error(`Browser suite ownership is incomplete. Missing: ${missing.join(', ') || 'none'}; unowned: ${unowned.join(', ') || 'none'}`);
  if (suite.startsWith('ci:')) {
    const shard = suite.slice(3);
    if (!Object.hasOwn(shards, shard)) throw new Error(`Unknown browser suite: ${suite}`);
    checkBrowserShards(specs, shards);
    return specs.filter(spec => shards[shard].includes(spec.file));
  }
  if (!['full', 'renderer', 'compatibility'].includes(suite)) throw new Error(`Unknown browser suite: ${suite}`);
  return specs.filter(spec => suite === 'full' || (suite === 'renderer' ? spec.focused : spec.owner === 'compatibility'));
}

/** Throws unless the CI shard jobs' receipts together ran the full gate: one
 * passing receipt per shard, each running exactly its shard's specs, and every
 * required spec run by exactly one shard. */
export function checkShardReceipts(actualFiles, receipts, specs = BROWSER_SPECS, shards = BROWSER_CI_SHARDS) {
  const full = selectBrowserSpecs(actualFiles, 'full', specs, shards).map(spec => spec.file);
  const expectedSuites = Object.keys(shards).map(shard => `ci:${shard}`);
  const problems = [];
  const bySuite = new Map();
  for (const receipt of receipts) {
    if (!expectedSuites.includes(receipt.suite)) problems.push(`unexpected receipt for ${receipt.suite}`);
    else if (bySuite.has(receipt.suite)) problems.push(`two receipts for ${receipt.suite}`);
    else bySuite.set(receipt.suite, receipt);
  }
  for (const suite of expectedSuites) {
    const receipt = bySuite.get(suite);
    if (!receipt) { problems.push(`no receipt for ${suite}`); continue; }
    const expected = selectBrowserSpecs(actualFiles, suite, specs, shards).map(spec => spec.file);
    const ran = (receipt.required ?? []).map(spec => spec.file);
    if (JSON.stringify(ran) !== JSON.stringify(expected)) problems.push(`${suite} ran [${ran.join(', ')}], expected [${expected.join(', ')}]`);
    const summary = receipt.testSummary;
    if (receipt.exitCode !== 0 || receipt.signal || receipt.error || !summary || !(summary.tests > 0)
      || summary.fail || summary.cancelled || summary.skipped || summary.todo || summary.pass !== summary.tests) {
      problems.push(`${suite} did not pass: ${receipt.error || JSON.stringify(summary)}`);
    }
  }
  const ran = [...bySuite.values()].flatMap(receipt => (receipt.required ?? []).map(spec => spec.file));
  const twice = [...new Set(ran.filter((file, index) => ran.indexOf(file) !== index))];
  const notRun = full.filter(file => !ran.includes(file));
  if (twice.length) problems.push(`run by more than one shard: ${twice.join(', ')}`);
  if (notRun.length) problems.push(`not run by any shard: ${notRun.join(', ')}`);
  if (problems.length) throw new Error(`Browser CI shards did not run the full gate:\n  ${problems.join('\n  ')}`);
  return { shards: expectedSuites.length, specs: full.length };
}

export async function browserSuite(root, suite) {
  return selectBrowserSpecs(await readdir(new URL('tests/browser/', root)), suite);
}

export function requiredTestSummary(tap) {
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => {
    const match = tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'));
    return [name, match ? Number(match[1]) : null];
  }));
  if (!(counts.tests > 0) || Object.values(counts).some(value => value === null)
    || counts.pass + counts.fail + counts.cancelled + counts.skipped + counts.todo !== counts.tests) {
    throw new Error('Browser runner did not report a completed test denominator.');
  }
  if (counts.skipped > 0 || counts.todo > 0 || counts.cancelled > 0) {
    throw new Error(`Required browser coverage did not execute: ${counts.skipped} skipped, ${counts.todo} todo, ${counts.cancelled} cancelled.`);
  }
  return counts;
}
