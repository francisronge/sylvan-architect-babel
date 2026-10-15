import { readdir } from 'node:fs/promises';

// Every native-browser file has one owner. The fast renderer gate is a subset;
// the full gate includes application, atlas, and cross-engine evidence.
export const BROWSER_SPECS = [
  { file: 'movementEndpointAttachment.test.mjs', owner: 'renderer', focused: true },
  { file: 'trajectoryLabelClearance.test.mjs', owner: 'renderer', focused: true },
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

export function selectBrowserSpecs(actualFiles, suite = 'full', specs = BROWSER_SPECS) {
  const declared = specs.map(spec => spec.file);
  const actual = actualFiles.filter(file => file.endsWith('.test.mjs')).sort();
  if (new Set(declared).size !== declared.length) throw new Error('Browser manifest repeats a spec.');
  const missing = declared.filter(file => !actual.includes(file));
  const unowned = actual.filter(file => !declared.includes(file));
  if (missing.length || unowned.length) throw new Error(`Browser suite ownership is incomplete. Missing: ${missing.join(', ') || 'none'}; unowned: ${unowned.join(', ') || 'none'}`);
  if (!['full', 'renderer', 'compatibility'].includes(suite)) throw new Error(`Unknown browser suite: ${suite}`);
  return specs.filter(spec => suite === 'full' || (suite === 'renderer' ? spec.focused : spec.owner === 'compatibility'));
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
