// `npm run verify:browser-visual`: the bounded browser check of painted Replay.
// It renders the committed human-catalogue analyses
// (fixtures/replay-regressions/visual-human-catalog.json) with the production
// renderer, audits every frame, step, stage entry, rapid Next run, resize and
// Canopy at 1440×900 and 390×844 with every check, then matches the findings
// against tests/helpers/browserVisualExceptions.mjs (tests/helpers/findings.mjs).
// It fails on an unexpected finding, a finding beyond its bound, a stale
// exception, an audit error, or a place left unjudged. Evidence goes outside
// the worktree: --evidence DIR, else a new temporary directory.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { matchFindings, proposeExceptions } from '../tests/helpers/findings.mjs';
import { EXCEPTIONS } from '../tests/helpers/browserVisualExceptions.mjs';
import { buildReviewPage, catalogRecords } from './visualAudit/reviewPage.mjs';
import { coverageKey } from './visualAudit/report.mjs';
import { parseResizeSequence, parseViewports } from './visualAudit/plan.mjs';
import { viewportName } from './visualAudit/frameModel.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { evidence: { type: 'string' }, browser: { type: 'string' } } });
const evidence = path.resolve(values.evidence || fs.mkdtempSync(path.join(os.tmpdir(), 'babel-browser-visual-')));
if (path.relative(root, evidence) && !path.relative(root, evidence).startsWith('..')) throw new Error('Keep browser evidence outside the worktree.');
fs.mkdirSync(evidence, { recursive: true });
if (fs.readdirSync(evidence).length) throw new Error(`Evidence directory is not empty: ${evidence}`);

const VIEWPORTS = '1440x900,390x844', RESIZE = '1.33,1,0.8,1';
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/replay-regressions/visual-human-catalog.json'), 'utf8'));
const records = catalogRecords(fixture);
const page = await buildReviewPage(records, path.join(evidence, 'catalog-page.html'));
const auditOut = path.join(evidence, 'audit');
const audit = spawnSync(process.execPath, [path.join(root, 'scripts/auditReplayBrowser.mjs'), '--page', page, '--cases', 'all',
  '--viewports', VIEWPORTS, '--views', 'Replay,Canopy', '--checks', 'static,camera,continuity,motion,rapid,resize', '--frames', 'all',
  '--direct', 'stage-entry', '--resize', RESIZE, '--out', auditOut, ...(values.browser ? ['--browser', values.browser] : [])],
  { cwd: root, stdio: 'inherit', env: { ...process.env, GOMAXPROCS: process.env.GOMAXPROCS || '2' } });
const reportFile = path.join(auditOut, 'report.json');
if (!fs.existsSync(reportFile)) throw new Error(`The audit wrote no report (exit ${audit.status}).`);
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));

// Mandatory coverage: every frame, step and Canopy statically and in motion,
// at least one rapid run and every resize transition per record and viewport.
const covered = new Set(report.coverage), missing = [];
for (const viewport of parseViewports(VIEWPORTS)) {
  const name = viewportName(viewport), transitions = parseResizeSequence(RESIZE, viewport).filter((size, index, all) =>
    !(size.width === (all[index - 1] ?? viewport).width && size.height === (all[index - 1] ?? viewport).height)).length;
  for (const record of records) {
    const result = report.cases.find(item => item.id === record.id && item.viewport === viewport.label);
    if (!result?.frameCount) { missing.push(`${record.id} @${name}: not audited`); continue; }
    const need = [...Array.from({ length: result.frameCount }, (_, index) => coverageKey(record.id, name, 'static', index + 1)),
      coverageKey(record.id, name, 'static', 'canopy'),
      ...Array.from({ length: result.frameCount - 1 }, (_, index) => coverageKey(record.id, name, 'motion', `${index + 1}>${index + 2}`)),
      ...(result.stageEntries ?? []).map(frame => coverageKey(record.id, name, 'camera', frame))];
    const absent = need.filter(key => !covered.has(key));
    if (absent.length) missing.push(`${record.id} @${name}: ${absent.length} unjudged places, first ${absent[0]}`);
    const mine = report.coverage.filter(key => JSON.parse(key)[0] === record.id && JSON.parse(key)[1] === name);
    if (!mine.some(key => JSON.parse(key)[2] === 'rapid')) missing.push(`${record.id} @${name}: no rapid Next run`);
    if (mine.filter(key => JSON.parse(key)[2] === 'resize').length < transitions) missing.push(`${record.id} @${name}: resize transitions missing`);
  }
}
const { unexpected, exceeded, stale } = matchFindings(report.findings, EXCEPTIONS);
const errors = report.findings.filter(finding => finding.rule === 'audit-error');
fs.writeFileSync(path.join(evidence, 'proposed-exceptions.json'), JSON.stringify(proposeExceptions(unexpected), null, 2) + '\n');
const receipt = { ok: !unexpected.length && !exceeded.length && !stale.length && !missing.length && !errors.length && audit.status === 0,
  evidence, page, audit: auditOut, auditExit: audit.status, findings: report.findings.length, exceptions: EXCEPTIONS.length,
  unexpected, exceeded, stale, missing };
fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
for (const finding of unexpected) console.error(`unexpected ${finding.rule}/${finding.subtype ?? '-'} ${finding.record} @${finding.viewport} ${finding.frame}: ${finding.detail}`);
for (const { finding, exception } of exceeded) console.error(`beyond bound ${finding.rule} ${finding.record} ${finding.frame}: ${finding.measure} > ${exception.max}`);
for (const entry of stale) console.error(`stale exception ${entry.exception.rule} ${entry.exception.record} @${entry.viewport} ${entry.frame}`);
for (const entry of missing) console.error(`incomplete: ${entry}`);
console.log(`Browser visual check ${receipt.ok ? 'passed' : 'FAILED'}: ${report.findings.length} findings, ${unexpected.length} unexpected, `
  + `${exceeded.length} beyond bound, ${stale.length} stale, ${missing.length} incomplete. Evidence: ${evidence}`
  + (unexpected.length ? `\nReview ${path.join(auditOut, 'index.html')}; candidate exceptions (each needs a reason): ${path.join(evidence, 'proposed-exceptions.json')}` : ''));
process.exitCode = receipt.ok ? 0 : 1;
