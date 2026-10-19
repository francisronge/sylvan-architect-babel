// Evidence accounting for the browser audit: what each pass judged (coverage),
// how a run compares with a baseline, whether a saved case receipt may be
// reused, and the review index of flagged places. Findings follow
// tests/helpers/findings.mjs: { rule, subtype, record, subject, frame, viewport, measure, detail }.
import { createHash } from 'node:crypto';
import { RULES } from '../../tests/helpers/visualRules.mjs';
import { CAMERA_RULES } from '../../tests/helpers/cameraInvariants.mjs';
import { matchFindings } from '../../tests/helpers/findings.mjs';

export const REPORT_SCHEMA = 'babel-browser-visual-audit/2';

const STATIC = new Set([...RULES, 'one-letter-per-label']);
const CAMERA = new Set(CAMERA_RULES);
/** The check that judges a rule's places; a place is covered only by that check. */
export function checkOf(rule) {
  if (STATIC.has(rule)) return 'static';
  if (CAMERA.has(rule)) return 'camera';
  return { 'step-motion': 'motion', 'rapid-motion': 'rapid', 'resize-motion': 'resize', 'syntax-continuity': 'continuity' }[rule] ?? 'run';
}

/** One judged place: a record at a viewport, for one check, at one frame or transition. */
export const coverageKey = (record, viewport, check, frame) => JSON.stringify([record, viewport, check, String(frame)]);
export const findingPlace = finding => coverageKey(finding.record, finding.viewport, checkOf(finding.rule), finding.frame);
export const findingKey = finding => JSON.stringify([finding.rule, finding.subtype ?? null, finding.record, finding.subject,
  finding.viewport ?? null, String(finding.frame)]);

/**
 * Current findings marked new or known against a baseline run. A baseline
 * finding is resolved only where the current run judged that same place with
 * the same check and did not find it again; a place the current run did not
 * judge leaves it uncovered, never resolved.
 */
export function compareWithBaseline(current, baseline) {
  const covered = new Set(current.coverage), currentKeys = new Set(current.findings.map(findingKey));
  const baselineKeys = new Set(baseline.findings.map(findingKey));
  return {
    rows: current.findings.map(finding => ({ ...finding, status: baselineKeys.has(findingKey(finding)) ? 'known' : 'new' })),
    resolved: baseline.findings.filter(finding => covered.has(findingPlace(finding)) && !currentKeys.has(findingKey(finding))),
    uncovered: baseline.findings.filter(finding => !covered.has(findingPlace(finding)))
  };
}

export const MOTION_RULES = new Set(['step-motion', 'rapid-motion', 'resize-motion']);
/** A painted motion fault counts only when an immediate re-run of the same motion
 * shows it again (`reproduced`); frame timing can produce one-off observations. */
export const counts = finding => !MOTION_RULES.has(finding.rule) || finding.reproduced !== false;

/**
 * The bounded gate's verdict: matching as tests/helpers/findings.mjs, except
 * that motion findings which did not reproduce are warnings, never failures.
 * They still keep their exceptions from being stale.
 */
export function gateVerdict(findings, exceptions) {
  const { unexpected, exceeded, stale } = matchFindings(findings, exceptions);
  return { unexpected: unexpected.filter(counts), exceeded: exceeded.filter(entry => counts(entry.finding)), stale,
    warnings: [...unexpected, ...exceeded.map(entry => entry.finding)].filter(finding => !counts(finding)) };
}

export const fingerprint = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value)
  ? value : JSON.stringify(value)).digest('hex');

/** A saved case receipt is reused only when it was made from the same sources and configuration. */
export const receiptMatches = (receipt, expected) => Boolean(receipt?.fingerprint)
  && receipt.fingerprint.source === expected.source && receipt.fingerprint.config === expected.config && !receipt.error;

export function summarize(results, rows) {
  const byRule = {};
  for (const row of rows) {
    const key = row.subtype ? `${row.rule}/${row.subtype}` : row.rule;
    byRule[key] ??= { count: 0, new: 0 };
    byRule[key].count++;
    if (row.status === 'new') byRule[key].new++;
  }
  return {
    cases: new Set(results.map(result => result.id)).size, caseViewports: results.length,
    placesJudged: results.reduce((sum, result) => sum + (result.coverage?.length || 0), 0),
    flaggedPlaces: new Set(rows.map(findingPlace)).size, findings: rows.length,
    failedCases: results.filter(result => result.error).length, byRule
  };
}

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Static review page listing only flagged places, with their contact sheets. */
export function renderIndexHtml({ report, rows, sheets = {} }) {
  const places = new Map();
  for (const row of rows) {
    const key = findingPlace(row);
    if (!places.has(key)) places.set(key, []);
    places.get(key).push(row);
  }
  const cards = [...places].map(([key, items]) => {
    const [record, viewport, check, frame] = JSON.parse(key), status = items.some(item => item.status === 'new') ? 'new' : items[0].status || 'current';
    const sheet = sheets[key];
    return `<article class="card" data-status="${status}" data-check="${escapeHtml(check)}">
  <h2>${escapeHtml(record)} <small>${escapeHtml(viewport)} · ${escapeHtml(check)} · ${escapeHtml(frame)}${status === 'new' ? ' · <b>new</b>' : ''}</small></h2>
  <ul>${items.map(item => `<li><b>${escapeHtml(item.rule)}${item.subtype ? `/${escapeHtml(item.subtype)}` : ''}</b> ${escapeHtml(item.detail)}`
    + `${item.measure !== null && item.measure !== undefined ? ` <i>(${escapeHtml(item.measure)})</i>` : ''}${item.status ? ` <i>${item.status}</i>` : ''}`
    + `${item.metrics ? `<details><summary>metrics</summary><pre>${escapeHtml(JSON.stringify(item.metrics, null, 1))}</pre></details>` : ''}</li>`).join('')}</ul>
  ${sheet ? `<a href="${escapeHtml(sheet)}"><img loading="lazy" src="${escapeHtml(sheet)}" alt="contact sheet"></a>` : ''}
</article>`;
  });
  const summary = report.summary || {};
  const ruleRows = Object.entries(summary.byRule || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, counts]) => `<tr><td>${escapeHtml(rule)}</td><td>${counts.count}</td><td>${report.baseline ? counts.new : ''}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Babel browser visual audit</title>
<style>body{margin:0;padding:20px;background:#06110e;color:#dffcf2;font:14px/1.45 system-ui,sans-serif}h1{margin:0 0 6px;font-size:22px}
table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #1c6b58;padding:3px 8px;text-align:left}
.card{border:1px solid #1c6b58;border-radius:8px;margin:14px 0;padding:10px 14px;background:#081713}.card h2{font-size:15px;margin:0 0 6px}
.card small{color:#8fd3bf;font-weight:400}.card img{max-width:100%;border:1px solid #164438;border-radius:6px;margin-top:8px}pre{white-space:pre-wrap;font-size:12px}</style>
<h1>Babel browser visual audit</h1>
<p>${escapeHtml(report.page?.path || '')} · ${escapeHtml(report.browser?.engine || '')} ${escapeHtml(report.browser?.version || '')} · ${escapeHtml(report.finishedAt || '')}</p>
<p>${summary.cases ?? 0} analyses · ${summary.placesJudged ?? 0} places judged · <b>${summary.flaggedPlaces ?? 0} flagged places</b>${report.baseline
    ? ` · baseline: ${report.baseline.new} new, ${report.baseline.known} known, ${report.baseline.resolved} resolved, ${report.baseline.uncovered} not judged` : ''}</p>
<label>Show <select id="status"><option value="all">all flagged</option><option value="new">new only</option></select></label>
<table><tr><th>rule</th><th>findings</th><th>new</th></tr>${ruleRows}</table>
<main>${cards.join('\n') || '<p>No flagged places.</p>'}</main>
<script>document.getElementById('status').addEventListener('change', event => { for (const card of document.querySelectorAll('.card'))
  card.style.display = event.target.value === 'all' || card.dataset.status === 'new' ? '' : 'none'; });</script></html>
`;
}
