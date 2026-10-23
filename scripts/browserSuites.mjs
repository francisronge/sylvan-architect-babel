import { readdir } from 'node:fs/promises';

// Every native-browser file has one owner. The fast renderer gate is a subset;
// the full gate includes application, atlas, and cross-engine evidence.
export const BROWSER_SPECS = [
  { file: 'movementEndpointAttachment.test.mjs', owner: 'renderer', focused: true },
  { file: 'trajectoryLabelClearance.test.mjs', owner: 'renderer', focused: true },
  { file: 'connectorTextMask.test.mjs', owner: 'renderer', focused: true },
  { file: 'featureComposition.test.mjs', owner: 'renderer', focused: true },
  { file: 'plaqueClearance.test.mjs', owner: 'renderer', focused: true },
  { file: 'operatorBindingComposition.test.mjs', owner: 'renderer', focused: true },
  { file: 'relationInkObstacles.test.mjs', owner: 'renderer' },
  { file: 'relationEmphasis.test.mjs', owner: 'renderer' },
  { file: 'relationOutcomePaint.test.mjs', owner: 'renderer' },
  { file: 'thetaGridHistory.test.mjs', owner: 'renderer' },
  { file: 'tier2ProductionRecipes.test.mjs', owner: 'atlas' },
  { file: 'appWorkflow.test.mjs', owner: 'application' },
  { file: 'rendererCloseout.test.mjs', owner: 'application' },
  { file: 'viewErrorBoundary.test.mjs', owner: 'application' },
  { file: 'reviewCompatibility.test.mjs', owner: 'compatibility' },
  { file: 'captureHarness.test.mjs', owner: 'capture' }
];

// CI runs the full gate as parallel jobs, one per shard (`--suite ci:<shard>`).
// Each owner belongs to exactly one shard, so the shards together run the full
// gate once; checkShardReceipts confirms that from the receipts the jobs wrote.
export const BROWSER_CI_SHARDS = {
  renderer: ['renderer', 'compatibility'],
  application: ['application', 'atlas', 'capture']
};

export function checkBrowserShards(specs = BROWSER_SPECS, shards = BROWSER_CI_SHARDS) {
  const owners = [...new Set(specs.map(spec => spec.owner))];
  const assigned = Object.values(shards).flat();
  const repeated = assigned.filter((owner, index) => assigned.indexOf(owner) !== index);
  const unsharded = owners.filter(owner => !assigned.includes(owner));
  const unknown = assigned.filter(owner => !owners.includes(owner));
  if (repeated.length || unsharded.length || unknown.length) {
    throw new Error(`Browser CI shards do not partition the owners. Repeated: ${repeated.join(', ') || 'none'}; unsharded: ${unsharded.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}`);
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
    return specs.filter(spec => shards[shard].includes(spec.owner));
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
