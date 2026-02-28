import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFromBody } from '../server/parseApi.js';

const cases = [
  { sentence: 'The farmer eats the pig', framework: 'xbar' },
  { sentence: 'The farmer did not eat the pig', framework: 'xbar' },
  { sentence: 'If the teacher arrives, the class starts', framework: 'xbar' },
  { sentence: 'El granjero come el cerdo', framework: 'xbar' },
  { sentence: 'Le fermier mange le cochon', framework: 'xbar' },
  { sentence: 'Der Bauer isst das Schwein', framework: 'xbar' },
  { sentence: 'Il contadino mangia il maiale', framework: 'xbar' },
  { sentence: 'The child that the teacher praised smiled', framework: 'xbar' },
  { sentence: 'The farmer eats the pig', framework: 'minimalism' },
  { sentence: 'The farmer did not eat the pig', framework: 'minimalism' },
  { sentence: 'The farmer eats the pig', framework: 'xbar' },
  { sentence: 'The farmer did not eat the pig', framework: 'xbar' },
  { sentence: 'If the teacher arrives, the class starts', framework: 'xbar' },
  { sentence: 'El granjero come el cerdo', framework: 'xbar' },
  { sentence: 'Le fermier mange le cochon', framework: 'xbar' },
  { sentence: 'Der Bauer isst das Schwein', framework: 'xbar' },
  { sentence: 'Il contadino mangia il maiale', framework: 'xbar' },
  { sentence: 'The child that the teacher praised smiled', framework: 'xbar' },
  { sentence: 'The farmer eats the pig', framework: 'minimalism' },
  { sentence: 'The farmer did not eat the pig', framework: 'minimalism' }
];

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const requestedRunsRaw = Number(process.argv[2] || process.env.BABEL_SOAK_RUNS || 10);
const requestedRuns = Number.isFinite(requestedRunsRaw) && requestedRunsRaw > 0 ? Math.floor(requestedRunsRaw) : 10;
const selectedCases = cases.slice(0, Math.min(cases.length, requestedRuns));

const run = async () => {
  const startedAt = new Date();
  const startedMs = Date.now();
  const results = [];

  for (let i = 0; i < selectedCases.length; i += 1) {
    const test = selectedCases[i];
    const runStart = Date.now();
    const runNo = i + 1;

    try {
      const bundle = await parseFromBody(test);
      const elapsedMs = Date.now() - runStart;
      const row = {
        run: runNo,
        sentence: test.sentence,
        framework: test.framework,
        ok: true,
        elapsedMs,
        modelUsed: bundle.modelUsed || null,
        modelsTried: bundle.modelsTried || [],
        fallbackUsed: Boolean(bundle.fallbackUsed),
        analyses: Array.isArray(bundle.analyses) ? bundle.analyses.length : 0,
        firstRoot: bundle?.analyses?.[0]?.tree?.label || null
      };
      results.push(row);
      console.log(`[${runNo}/${selectedCases.length}] OK ${elapsedMs}ms model=${row.modelUsed || 'unknown'} fallback=${row.fallbackUsed ? 'yes' : 'no'}`);
    } catch (error) {
      const elapsedMs = Date.now() - runStart;
      const row = {
        run: runNo,
        sentence: test.sentence,
        framework: test.framework,
        ok: false,
        elapsedMs,
        errorCode: error?.code || null,
        errorStatus: error?.status || null,
        errorMessage: error?.message || String(error)
      };
      results.push(row);
      console.log(`[${runNo}/${selectedCases.length}] FAIL ${elapsedMs}ms code=${row.errorCode || 'UNKNOWN'} status=${row.errorStatus || 'n/a'}`);
    }
  }

  const elapsedTotalMs = Date.now() - startedMs;
  const okRuns = results.filter((r) => r.ok);
  const failRuns = results.filter((r) => !r.ok);
  const latencies = okRuns.map((r) => r.elapsedMs);
  const fallbackRuns = okRuns.filter((r) => r.fallbackUsed).length;
  const errorBreakdown = failRuns.reduce((acc, row) => {
    const key = row.errorCode || 'UNKNOWN';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    totalRuns: results.length,
    okRuns: okRuns.length,
    failRuns: failRuns.length,
    fallbackRuns,
    successRate: Number(((okRuns.length / results.length) * 100).toFixed(2)),
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : null,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length ? Math.max(...latencies) : null,
      avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null
    },
    errorBreakdown,
    elapsedTotalMs
  };

  const out = {
    summary,
    results
  };

  const fileName = `soak20-report-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`;
  const outPath = path.resolve('.artifacts', fileName);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(`REPORT_PATH=${outPath}`);
  console.log(`SUMMARY=${JSON.stringify(summary)}`);
};

run().catch((error) => {
  console.error('SOAK_FATAL', error);
  process.exitCode = 1;
});
