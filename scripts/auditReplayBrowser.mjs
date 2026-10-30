// Real-browser visual audit of saved analyses on a review page
// (scripts/visualAudit/reviewPage.mjs). It measures; the rules are shared:
//   static      each audited frame and the Canopy, painted geometry converted to
//               the frame model of tests/helpers/visualRules.mjs (checkFrame), and
//               painted index letters counted as checkOneLetterPerLabel counts them
//   camera      settled, stepped and directly selected poses as a trace for
//               tests/helpers/cameraInvariants.mjs (one camera policy)
//   continuity  settled retained syntax inside one stage, with movement ownership
//   motion      every painted frame of each Next step
//   rapid       Next pressed faster than the 360 ms camera move
//   resize      grow, shrink back, shrink and grow back at the last frame
// Each case records the places it judged (coverage), so a baseline finding is
// resolved only where the same check judged the same place again.
// Output (an empty --out): report.json, index.html (flagged places only),
// cases/<case>@<viewport>.json receipts with source and configuration
// fingerprints (--resume reuses only matching ones), sheets/, shots/, film/ and
// evidence/ behind each flag. `--dry-run` plans and estimates without a browser.
// This is the discovery mode; scripts/verifyBrowserVisual.mjs is the bounded gate.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DEFAULT_COSTS, applyShard, estimateRuntime, extractPageRecords, formatDuration, parseFrameSpec, parseResizeSequence,
  parseShard, parseViewports, resolveFrames, sampleCases, selectCases, stageEntryFrames, traversalRange
} from './visualAudit/plan.mjs';
import { THRESHOLDS, checkFrame } from '../tests/helpers/visualRules.mjs';
import { CAMERA_THRESHOLDS, checkCameraTrace } from '../tests/helpers/cameraInvariants.mjs';
import {
  DEFAULT_MOTION, continuityPairs, firstPaintedPose, judgeRapidStepping, judgeResize, judgeStageSyntax, judgeStepMotion
} from './visualAudit/motionRules.mjs';
import { cameraFrame, cameraTraceEvidence, cameraView, letterFindings, toFrameModel, viewportName } from './visualAudit/frameModel.mjs';
import {
  REPORT_SCHEMA, compareWithBaseline, coverageKey, findingPlace, fingerprint, receiptMatches, renderIndexHtml, summarize
} from './visualAudit/report.mjs';
import { parseStageLabel, probeScript } from './visualAudit/pageProbe.mjs';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { canonicalizeMovementIdentity } from '../server/babelParser/movementIdentity.js';
import { stepTrajectoryParticipants } from '../tests/helpers/motionOwnership.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  page: { type: 'string' }, cases: { type: 'string' }, case: { type: 'string', multiple: true },
  frames: { type: 'string', default: 'all' }, viewports: { type: 'string', default: '1440x900,390x844' },
  views: { type: 'string', default: 'Replay,Canopy' },
  checks: { type: 'string', default: 'static,camera,continuity,motion,rapid,resize' },
  direct: { type: 'string', default: 'stage-entry' }, 'direct-method': { type: 'string', default: 'slider' },
  'no-confirm-reload': { type: 'boolean' },
  'rapid-runs': { type: 'string', default: '2' }, 'rapid-clicks': { type: 'string', default: '6' },
  'rapid-intervals': { type: 'string', default: '80,120,150,100,90,140' },
  resize: { type: 'string', default: '1.33,1,0.8,1' },
  shard: { type: 'string' }, sample: { type: 'string' }, seed: { type: 'string', default: '1' },
  out: { type: 'string' }, resume: { type: 'boolean' }, baseline: { type: 'string' },
  fast: { type: 'boolean' }, sheets: { type: 'string', default: 'flagged' }, filmstrips: { type: 'string', default: 'flagged' },
  engine: { type: 'string', default: 'chromium' }, browser: { type: 'string' },
  'timeout-ms': { type: 'string', default: '60000' }, threshold: { type: 'string', multiple: true },
  'dry-run': { type: 'boolean' }, 'skip-frame-count': { type: 'boolean' }, 'replay-root': { type: 'string' },
  cost: { type: 'string', multiple: true }, help: { type: 'boolean' }
} });

const CHECKS = ['static', 'camera', 'continuity', 'motion', 'rapid', 'resize'];
const USAGE = `Usage: node scripts/auditReplayBrowser.mjs --page PAGE.html (--cases all|ID,GLOB* | --case ID[@FRAMES]...) --out EMPTY_DIR [options]
  --frames all|final|first|stage-entry|every:N|N|A-B[,...]   static frames per case (default all)
  --viewports 1440x900,390x844      --views Replay,Canopy      --checks ${CHECKS.join(',')}
  --direct stage-entry|audited|all|none   --direct-method slider|reload   --no-confirm-reload
  --rapid-runs 2 --rapid-clicks 6 --rapid-intervals 80,120,150,100,90,140
  --resize 1.33,1,0.8,1|none        sizes as factors of the viewport or WxH, in order
  --shard I/N --sample N --seed S   --fast (reduced motion: static, camera, continuity)   --resume
  --baseline OLD/report.json        --threshold name=value ...
  --sheets flagged|none --filmstrips flagged|none --engine chromium|webkit --browser PATH
  --dry-run [--skip-frame-count] [--replay-root CHECKOUT] [--cost step=0.8 ...]`;
if (values.help) { console.log(USAGE); process.exit(0); }
if (!values.page) throw new Error(`Provide --page.\n${USAGE}`);
const pagePath = path.resolve(values.page);
if (!fs.existsSync(pagePath)) throw new Error(`Missing review page: ${pagePath}`);
const pageBytes = fs.readFileSync(pagePath);
const pageData = extractPageRecords(pageBytes.toString('utf8'));
const recordsById = new Map(pageData.records.map(record => [record.id, record]));
if (!values.cases && !values.case?.length) throw new Error(`Provide --cases or --case.\n${USAGE}`);
const defaultFrames = parseFrameSpec(values.frames);
const viewports = parseViewports(values.viewports).map(viewport => ({ ...viewport, name: viewportName(viewport) }));
const views = values.views.split(',').map(view => view.trim()).filter(Boolean);
if (views.some(view => !['Replay', 'Canopy'].includes(view))) throw new Error('--views accepts Replay and Canopy.');
const fast = Boolean(values.fast);
const checks = new Set(values.checks.split(',').map(check => check.trim()).filter(Boolean));
for (const check of checks) if (!CHECKS.includes(check)) throw new Error(`Unknown check: ${check}`);
if (fast) ['motion', 'rapid', 'resize'].forEach(check => checks.delete(check));
if (!['stage-entry', 'audited', 'all', 'none'].includes(values.direct)) throw new Error('--direct accepts stage-entry, audited, all or none.');
if (!['slider', 'reload'].includes(values['direct-method'])) throw new Error('--direct-method accepts slider or reload.');
if (values.direct === 'none') checks.delete('camera');
const rapidRuns = Number(values['rapid-runs']), rapidClicks = Number(values['rapid-clicks']);
const rapidIntervals = values['rapid-intervals'].split(',').map(Number);
if (![rapidRuns, rapidClicks].every(Number.isInteger) || rapidClicks < 2 || rapidIntervals.some(ms => !(ms >= 0))) {
  throw new Error('--rapid-runs and --rapid-clicks need integers (clicks ≥ 2); --rapid-intervals needs milliseconds.');
}
const timeout = Number(values['timeout-ms']);
const thresholds = { ...THRESHOLDS }, motionThresholds = { ...DEFAULT_MOTION }, cameraThresholds = { ...CAMERA_THRESHOLDS };
for (const entry of values.threshold || []) {
  const [name, raw] = entry.split('=');
  if (!Number.isFinite(Number(raw))) throw new Error(`--threshold ${entry} needs a number.`);
  const owner = [thresholds, motionThresholds, cameraThresholds].find(table => name in table);
  if (!owner) throw new Error(`Unknown threshold ${name}. Known: ${[thresholds, motionThresholds, cameraThresholds].flatMap(Object.keys).join(', ')}`);
  owner[name] = Number(raw);
}

const selection = applyShard(sampleCases(selectCases(pageData.records, { cases: values.cases, caseSpecs: values.case || [] }),
  values.sample ? Number(values.sample) : 0, Number(values.seed)), parseShard(values.shard));
const framesFor = entry => entry.frames ? parseFrameSpec(entry.frames) : defaultFrames;
const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

if (values['dry-run']) {
  let prepareReplay = null;
  if (!values['skip-frame-count']) {
    ({ prepareReplay } = await import(pathToFileURL(path.join(path.resolve(values['replay-root'] || root), 'replay/prepareReplay.ts')).href));
  }
  const rows = selection.map(entry => {
    const record = recordsById.get(entry.id);
    let frameCount = record.derivationStages.length * 12, stages = [];
    if (prepareReplay) {
      const steps = prepareReplay({ derivationStages: record.derivationStages, sentence: record.sentence,
        inputTokens: record.inputTokens, includePlayback: true }).playbackSteps;
      frameCount = steps.length;
      stages = steps.map(step => parseStageLabel(step.replayProgressLabel || '')?.stage ?? null);
    }
    const terms = framesFor(entry), entries = stageEntryFrames(stages), audited = resolveFrames(terms, frameCount, entries);
    const traversal = traversalRange(terms, frameCount, terms.includes('stage-entry') ? range(1, frameCount) : audited);
    const inRange = frame => frame >= traversal.start && frame <= traversal.end;
    const direct = !checks.has('camera') ? 0 : values.direct === 'all' ? traversal.end - traversal.start
      : values.direct === 'audited' ? audited.length : entries.filter(inRange).length;
    return { id: entry.id, frameCount, traversed: Math.max(0, traversal.end - traversal.start), audited: audited.length, direct,
      rapid: checks.has('rapid') ? Math.min(rapidRuns, Math.max(1, entries.filter(inRange).length)) : 0,
      frames: audited.length > 12 ? `${audited.length} frames` : audited.join(',') };
  });
  const costs = Object.fromEntries((values.cost || []).map(entry => {
    const [name, raw] = entry.split('=');
    if (!(name in DEFAULT_COSTS) || !(Number(raw) >= 0)) throw new Error(`--cost ${entry}: known costs are ${Object.keys(DEFAULT_COSTS).join(', ')} (seconds).`);
    return [name, Number(raw)];
  }));
  const estimate = estimateRuntime({ cases: rows, viewports: viewports.length, fast, costs,
    resizeTransitions: checks.has('resize') ? parseResizeSequence(values.resize, viewports[0]).length : 0, canopy: views.includes('Canopy') });
  const plan = { schema: `${REPORT_SCHEMA}/plan`, page: pagePath, format: pageData.format, cases: rows.length, viewports: viewports.map(v => v.label),
    views, checks: [...checks], fast, shard: values.shard || null, frameCounts: prepareReplay ? 'prepareReplay' : 'estimated (12 per stage)',
    totals: { frames: rows.reduce((sum, row) => sum + row.frameCount, 0), audited: rows.reduce((sum, row) => sum + row.audited, 0),
      traversedSteps: rows.reduce((sum, row) => sum + row.traversed, 0), direct: rows.reduce((sum, row) => sum + row.direct, 0) },
    estimate: { ...estimate, readable: formatDuration(estimate.seconds) }, rows };
  if (values.out) {
    const out = path.resolve(values.out);
    if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`Output is not empty: ${out}`);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  }
  for (const row of rows.slice(0, 40)) console.log(`${row.id}  frames ${row.frameCount}  audit ${row.frames}  steps ${row.traversed}  direct ${row.direct}  rapid ${row.rapid}`);
  if (rows.length > 40) console.log(`… ${rows.length - 40} more`);
  console.log(`${rows.length} analyses × ${viewports.length} viewport(s): ${plan.totals.audited} audited frames, ${plan.totals.traversedSteps} Next steps per viewport.`);
  console.log(`Estimated ${plan.estimate.readable} for this process (${formatDuration(estimate.perViewportSeconds)} per viewport).`);
  process.exit(0);
}

if (!values.out) throw new Error('Provide --out (an empty directory, or an existing audit with --resume).');
const out = path.resolve(values.out);
if (fs.existsSync(out) && fs.readdirSync(out).length && !values.resume) throw new Error(`Output is not empty: ${out} (use --resume to continue it).`);
for (const dir of ['cases', 'shots', 'sheets', 'film', 'evidence']) fs.mkdirSync(path.join(out, dir), { recursive: true });
const { openCaptureSession } = await import('./browserSession.mjs');
const { waitForCanopyPaint, waitForDecodedImages, waitForReplayPaint } = await import('./captureReadiness.mjs');

const safeName = value => value.replace(/[^\w.-]+/g, '_').slice(-180);
const relative = file => file && path.relative(out, file).split(path.sep).join('/');
const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };
/** Everything that decides a receipt: the page and every module that measures or judges. */
const SOURCE_FILES = ['scripts/auditReplayBrowser.mjs', 'scripts/browserSession.mjs', 'scripts/captureReadiness.mjs',
  ...fs.readdirSync(path.join(root, 'scripts/visualAudit')).sort().map(name => `scripts/visualAudit/${name}`),
  'tests/helpers/visualRules.mjs', 'tests/helpers/findings.mjs', 'tests/helpers/replayInvariants.mjs', 'tests/helpers/cameraInvariants.mjs',
  'tests/helpers/motionOwnership.mjs',
  'components/treeViewport.ts', 'replay/replaySurfaceNotation.ts'];
const sourceFingerprint = fingerprint(JSON.stringify([fingerprint(pageBytes),
  ...SOURCE_FILES.map(file => [file, fingerprint(fs.readFileSync(path.join(root, file)))])]));
const configFingerprint = (entry, viewport) => fingerprint({ viewport: viewport.label, views, checks: [...checks].sort(),
  frames: framesFor(entry), direct: values.direct, directMethod: values['direct-method'], confirmReload: !values['no-confirm-reload'],
  rapid: [rapidRuns, rapidClicks, rapidIntervals], resize: values.resize, fast, engine: values.engine, browser: values.browser ?? null,
  thresholds, motionThresholds, cameraThresholds });
const startedAt = new Date();
const timings = { stepMs: [], collectMs: [], caseMs: [] };
const sheetJobs = [];
const resizeSequences = new Map(viewports.map(viewport => [viewport.label, parseResizeSequence(values.resize, viewport)]));
const keepEvidence = (name, value) => {
  const file = path.join(out, 'evidence', `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(value) + '\n');
  return relative(file);
};

/** Authored anchors of the owning relations ("stage:relation"), with alias ids
 * resolved, named as the rendered Replay names them (canonical movement identity). */
function anchorIndex(authored) {
  const record = { ...authored, derivationStages: canonicalizeMovementIdentity(authored.derivationStages ?? []).stages };
  const alias = new Map();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string') (node.aliasIds || []).forEach(id => alias.set(id, node.id));
    (node.children || []).forEach(walk);
  };
  for (const stage of record.derivationStages || []) (stage.workspaceForest || []).forEach(walk);
  const cache = new Map();
  return owners => {
    const key = owners.join(' ');
    if (!cache.has(key)) {
      const ids = new Set();
      for (const owner of owners) {
        const [stageIndex, relationIndex] = owner.split(':').map(Number);
        const relation = record.derivationStages?.[stageIndex]?.relations?.[relationIndex];
        for (const group of [relation?.anchors, relation?.priorAnchors]) {
          for (const value of Object.values(group || {})) for (const id of [value].flat()) if (typeof id === 'string') ids.add(alias.get(id) || id);
        }
      }
      cache.set(key, [...ids]);
    }
    return cache.get(key);
  };
}

const pageUrl = (id, view, frame) => {
  const url = pathToFileURL(pagePath);
  url.searchParams.set('case', id);
  url.searchParams.set('view', view);
  if (frame) url.searchParams.set('frame', String(frame));
  return url.href;
};
const probe = (page, fn, arg) => page.evaluate(fn, arg);
const markStale = page => page.evaluate(() => { const svg = document.querySelector('svg[data-babel-tree]'); if (svg) svg.__babelAuditStale = true; });
const waitFresh = page => page.waitForFunction(() => {
  const svg = document.querySelector('svg[data-babel-tree]');
  return svg && !svg.__babelAuditStale;
}, null, { timeout });
const replayPaint = (page, index) => waitForReplayPaint(page, index, { timeout });
const collect = (page, light = false) => probe(page, light => window.__babelAudit.collect({ light }), light);
/** Samples every painted frame while `action` runs; the sampler always stops. */
const sampleWhile = async (page, action) => {
  await probe(page, () => window.__babelAudit.startSampler());
  let failure = null;
  try { await action(); } catch (error) { failure = error; }
  const { frames } = await probe(page, () => window.__babelAudit.stopSampler());
  if (failure) throw failure;
  return frames;
};
const jumpAndSettle = async (page, index) => { await probe(page, index => window.__babelAudit.jumpTo(index), index); await replayPaint(page, index); };

async function openContext(viewport) {
  const session = await openCaptureSession({ engine: values.engine, executablePath: values.browser, viewport, localFiles: true, timeout });
  const page = session.page;
  page.setDefaultTimeout(timeout);
  await page.addInitScript(probeScript());
  if (fast) await page.emulateMedia({ reducedMotion: 'reduce' });
  const context = { session, page, viewport, loaded: null, pageErrors: [] };
  page.on('pageerror', error => context.pageErrors.push(String(error?.message || error).slice(0, 500)));
  page.on('console', message => { if (message.type() === 'error') context.pageErrors.push(message.text().slice(0, 500)); });
  return context;
}

async function showCase(context, id, view) {
  const { page } = context;
  if (context.loaded?.id === id && context.loaded.view === view) return;
  if (!context.loaded) await page.goto(pageUrl(id, view));
  else {
    await markStale(page);
    if (context.loaded.id !== id) await page.selectOption('select[aria-label="Saved analysis"]', id);
    if (context.loaded.view !== view) await page.selectOption('select[aria-label="Tree view"]', view);
  }
  context.loaded = { id, view };
  await waitFresh(page);
  if (view === 'Replay') await replayPaint(page, 0);
  else await waitForCanopyPaint(page, { timeout });
}

/** Screenshots the current frame with the flagged boxes outlined, then a crop around them. */
async function captureStill(context, name, findings) {
  if (values.sheets === 'none' || !findings.length) return null;
  const boxes = findings.flatMap((item, number) => (item.boxes || []).map(box => ({ box, color: '#f87171', label: `${number + 1} ${item.rule}` })));
  const { page, viewport } = context;
  await probe(page, items => window.__babelAudit.showOverlay(items), boxes.slice(0, 60));
  const full = path.join(out, 'shots', `${name}-full.png`), crop = path.join(out, 'shots', `${name}-crop.png`);
  try {
    await page.screenshot({ path: full });
    const visible = boxes.map(entry => entry.box).filter(box => box.x < viewport.width && box.y < viewport.height && box.x + box.width > 0 && box.y + box.height > 0);
    if (visible.length) {
      let x = Math.min(...visible.map(box => box.x)) - 80, y = Math.min(...visible.map(box => box.y)) - 80;
      let width = Math.max(...visible.map(box => box.x + box.width)) + 80 - x, height = Math.max(...visible.map(box => box.y + box.height)) + 80 - y;
      if (width < 360) { x -= (360 - width) / 2; width = 360; }
      if (height < 240) { y -= (240 - height) / 2; height = 240; }
      x = Math.max(0, x); y = Math.max(0, y);
      await page.screenshot({ path: crop, clip: { x, y, width: Math.min(viewport.width - x, width), height: Math.min(viewport.height - y, height) } });
    }
  } finally { await probe(page, () => window.__babelAudit.clearOverlay()); }
  const sheet = path.join(out, 'sheets', `${name}.png`);
  sheetJobs.push({ kind: 'still', sheet, full, crop: fs.existsSync(crop) ? crop : null, title: name, findings });
  return relative(sheet);
}

/** Re-runs one flagged motion under a CDP screencast (Chromium) for a filmstrip. */
async function recordFilmstrip(context, name, run, judge) {
  if (values.filmstrips === 'none' || values.engine !== 'chromium') return {};
  const { page } = context, frames = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  let rerun = null;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 960, maxHeight: 960, everyNthFrame: 1 });
  try { rerun = judge(await run()); }
  finally { await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {}); }
  const dir = path.join(out, 'film', name);
  fs.mkdirSync(dir, { recursive: true });
  const step = Math.max(1, Math.ceil(frames.length / 48));
  const kept = frames.filter((_, index) => index % step === 0).map((frame, index) => {
    const file = path.join(dir, `${String(index).padStart(3, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(frame.data, 'base64'));
    return { file, ms: Math.round((frame.t - frames[0].t) * 1000) };
  });
  const sheet = path.join(out, 'sheets', `${name}.png`);
  const reproduced = rerun && rerun.length > 0;
  if (kept.length) sheetJobs.push({ kind: 'film', sheet, frames: kept, title: name, reproduced });
  return { sheet: kept.length ? relative(sheet) : null, rerun };
}
/** Each finding's re-run verdict: shown again with the same subtype, not shown, or not re-run (null). */
const withVerdict = (findings, rerun) => findings.map(item => ({ ...item,
  reproduced: rerun ? rerun.some(again => again.rule === item.rule && again.subtype === item.subtype) : null }));

/** Settles `index` as direct selection does: a nonadjacent jump, or a fresh load. */
async function directSelection(context, record, index, frameCount, method = values['direct-method']) {
  const { page } = context;
  if (method === 'reload' || frameCount < 3) {
    await page.goto(pageUrl(record.id, 'Replay', index + 1));
    context.loaded = { id: record.id, view: 'Replay' };
    await waitFresh(page);
    await replayPaint(page, index);
    return { light: await collect(page, true), method: 'reload' };
  }
  await jumpAndSettle(page, index >= 2 ? index - 2 : index + 2);
  await jumpAndSettle(page, index);
  return { light: await collect(page, true), method: 'slider' };
}

const spread = (items, count) => items.length <= count ? items
  : Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / Math.max(1, count - 1))]);

async function auditReplay(context, record, entry, result, anchorsFor) {
  const { page, viewport } = context, place = { record: record.id, viewport: viewport.name };
  const frameCount = (await probe(page, () => window.__babelAudit.frameInfo())).frameCount || 1;
  result.frameCount = frameCount;
  const terms = framesFor(entry), selected = resolveFrames(terms, frameCount, []);
  const traversal = traversalRange(terms, frameCount, terms.includes('stage-entry') ? range(1, frameCount) : selected);
  const settled = new Map(), stepSamples = new Map(), stages = [];
  const name = suffix => safeName(`${record.id}@${viewport.label}-${suffix}`);
  const auditFrame = async frame => {
    const started = Date.now(), snapshot = await collect(page);
    timings.collectMs.push(Date.now() - started);
    if (snapshot.error) throw new Error(snapshot.error);
    const { model, screen } = toFrameModel(snapshot, { frame, viewport: viewport.name, anchorsFor });
    const boxesOf = subject => [...screen].filter(([id]) => subject.includes(id)).flatMap(([, boxes]) => boxes);
    const findings = [...checkFrame(model, thresholds).map(item => ({ ...item, record: record.id, boxes: boxesOf(item.subject) })),
      ...letterFindings(snapshot, { record: record.id, frame, viewport: viewport.name })];
    result.coverage.push(coverageKey(record.id, viewport.name, 'static', frame));
    if (findings.length) {
      result.evidence[coverageKey(record.id, viewport.name, 'static', frame)] = keepEvidence(name(`f${frame}`), { snapshot, model });
      const sheet = await captureStill(context, name(`f${String(frame).padStart(3, '0')}`), findings);
      if (sheet) result.sheets[coverageKey(record.id, viewport.name, 'static', frame)] = sheet;
    }
    result.findings.push(...findings);
  };
  const remember = async frame => {
    const light = await collect(page, true);
    settled.set(frame, light);
    stages[frame - 1] = light.frame?.stage ?? null;
  };
  if (traversal.start > 1) await jumpAndSettle(page, traversal.start - 1);
  await remember(traversal.start);
  const audits = frame => checks.has('static') && (selected.includes(frame)
    || (terms.includes('stage-entry') && frame > 1 && stages[frame - 1] !== stages[frame - 2]));
  if (audits(traversal.start)) await auditFrame(traversal.start);
  for (let frame = traversal.start + 1; frame <= traversal.end; frame++) {
    const started = Date.now();
    const step = async () => {
      if (!await probe(page, () => window.__babelAudit.clickNext())) throw new Error(`Next is unavailable at frame ${frame - 1}`);
      await replayPaint(page, frame - 1);
    };
    const samples = checks.has('motion') || checks.has('camera') ? await sampleWhile(page, step) : (await step(), null);
    timings.stepMs.push(Date.now() - started);
    await remember(frame);
    if (samples) stepSamples.set(frame, samples);
    if (samples && checks.has('motion')) {
      const transition = `${frame - 1}>${frame}`;
      const findings = judgeStepMotion(samples, { label: `Next ${frame - 1}→${frame}`, place: { ...place, frame: transition }, thresholds: motionThresholds });
      result.coverage.push(coverageKey(record.id, viewport.name, 'motion', transition));
      if (findings.length) {
        result.evidence[coverageKey(record.id, viewport.name, 'motion', transition)] = keepEvidence(name(`next-${frame}`), samples);
        result.findings.push(...findings);
      }
    }
    if (audits(frame)) await auditFrame(frame);
  }
  result.stageLabels = stages;
  const entries = stageEntryFrames(stages).filter(frame => frame > traversal.start && frame <= traversal.end);
  result.stageEntries = entries;
  // Step ownership comes from this checkout's Replay of the same record; a page
  // built from other sources with a different frame count is not judged.
  const steps = checks.has('continuity') ? prepareReplay({ derivationStages: record.derivationStages, sentence: record.sentence,
    inputTokens: record.inputTokens, includePlayback: true }).playbackSteps : [];
  if (checks.has('continuity') && steps.length !== frameCount) result.continuityUnavailable = `page has ${frameCount} frames, this checkout ${steps.length}`;
  const stepOf = number => steps.length === frameCount && steps[number - 1]
    ? { target: steps[number - 1].targetNodeId ?? null, links: stepTrajectoryParticipants(steps[number - 1]) } : null;
  const frameOf = number => ({ ...cameraFrame(settled.get(number), { final: number === frameCount, step: stepOf(number) }), number });

  if (checks.has('continuity') && !result.continuityUnavailable) {
    const frames = [...settled.keys()].sort((a, b) => a - b).map(frameOf);
    result.findings.push(...judgeStageSyntax(frames, { place, thresholds: motionThresholds }));
    for (const [before, after] of continuityPairs(frames)) {
      result.coverage.push(coverageKey(record.id, viewport.name, 'continuity', `${before.number}>${after.number}`));
    }
  }
  if (checks.has('camera')) {
    const directFrames = values.direct === 'all' ? range(traversal.start + 1, traversal.end)
      : values.direct === 'audited' ? selected.filter(frame => frame > traversal.start) : entries;
    const view = cameraView(settled.get(traversal.end)), trace = { ...view, frames: [], direct: [], passes: [{ name: 'next', steps: [] }] };
    for (const number of settled.keys()) trace.frames[number - 1] = frameOf(number);
    for (const frame of directFrames.filter(frame => settled.has(frame) && settled.has(frame - 1) && stepSamples.has(frame))) {
      let direct = await directSelection(context, record, frame - 1, frameCount);
      trace.direct[frame - 1] = direct.light.camera;
      trace.passes[0].steps.push({ from: frame - 2, to: frame - 1, before: settled.get(frame - 1).camera,
        first: firstPaintedPose(stepSamples.get(frame)) ?? settled.get(frame).camera, settled: settled.get(frame).camera });
      // A nonadjacent jump stands in for direct selection; a fresh load decides any difference.
      if (direct.method === 'slider' && !values['no-confirm-reload'] && JSON.stringify(direct.light.camera) !== JSON.stringify(settled.get(frame).camera)) {
        direct = await directSelection(context, record, frame - 1, frameCount, 'reload');
        trace.direct[frame - 1] = direct.light.camera;
      }
      result.coverage.push(coverageKey(record.id, viewport.name, 'camera', `${frame - 1}>${frame}`),
        coverageKey(record.id, viewport.name, 'camera', frame));
    }
    const { findings: cameraFindings, allowed } = checkCameraTrace(trace, cameraThresholds);
    result.cameraAllowed = allowed;
    result.findings.push(...cameraFindings.map(item => ({ ...item, record: record.id, viewport: viewport.name })));
    if (cameraFindings.length) result.evidence[coverageKey(record.id, viewport.name, 'camera', 'trace')] = keepEvidence(name('camera'),
      cameraTraceEvidence(trace));
  }
  if (checks.has('rapid')) {
    const starts = (entries.length ? spread(entries, rapidRuns).map(frame => Math.max(1, frame - 2)) : [traversal.start])
      .filter((frame, index, all) => all.indexOf(frame) === index && frameCount - frame >= 2);
    for (const start of starts) {
      const clicks = Math.min(rapidClicks, frameCount - start);
      const intervals = Array.from({ length: clicks - 1 }, (_, index) => rapidIntervals[index % rapidIntervals.length]);
      const run = async () => {
        await jumpAndSettle(page, start - 1);
        let done = 0;
        const samples = await sampleWhile(page, async () => {
          done = await probe(page, intervals => window.__babelAudit.rapidNext(intervals), intervals);
          await replayPaint(page, start - 1 + done);
        });
        return { samples, done };
      };
      let { samples, done } = await run();
      const transition = `rapid:${start}>${start + done}`;
      const judge = list => judgeRapidStepping(list, { label: `Next ×${done} from frame ${start} every ${intervals.join('/')} ms`,
        place: { ...place, frame: transition }, thresholds: motionThresholds });
      let findings = judge(samples);
      // Rapid stepping is timed by the browser, so one clean run does not prove
      // a motion fault gone: a clean run is repeated once, and a fault either
      // run shows counts. This only adds findings; a flagged run is re-run for
      // its filmstrip below as before.
      if (!findings.length) {
        const again = await run();
        if (again.done === done) { const repeated = judge(again.samples); if (repeated.length) ({ samples } = again), findings = repeated; }
      }
      result.coverage.push(coverageKey(record.id, viewport.name, 'rapid', transition));
      if (findings.length) {
        const key = coverageKey(record.id, viewport.name, 'rapid', transition);
        result.evidence[key] = keepEvidence(name(`rapid-${start}`), samples);
        const film = await recordFilmstrip(context, name(`rapid-${start}`), async () => (await run()).samples, judge);
        if (film.sheet) result.sheets[key] = film.sheet;
        result.findings.push(...withVerdict(findings, film.rerun));
      }
    }
  }
  if (checks.has('resize')) {
    const index = traversal.end - 1, base = { width: viewport.width, height: viewport.height, label: viewport.label };
    // Observed for at least 30 painted frames, then until real paint readiness, then 12 more.
    const transition = target => sampleWhile(page, async () => {
      const before = await probe(page, () => window.__babelAudit.sampleCount());
      await page.setViewportSize({ width: target.width, height: target.height });
      await page.waitForFunction(count => window.__babelAudit.sampleCount() >= count, before + 30, { timeout });
      await replayPaint(page, index);
      const after = await probe(page, () => window.__babelAudit.sampleCount());
      await page.waitForFunction(count => window.__babelAudit.sampleCount() >= count, after + 12, { timeout });
    });
    let current = base;
    try {
      await jumpAndSettle(page, index);
      for (const target of resizeSequences.get(viewport.label)) {
        if (target.width === current.width && target.height === current.height) continue;
        const from = current, token = `resize:${from.label}>${target.label}@${index + 1}`;
        const samples = await transition(target);
        current = target;
        const judge = list => judgeResize(list, { label: `resize ${from.label}→${target.label}`, place: { ...place, frame: token }, thresholds: motionThresholds });
        const findings = judge(samples), key = coverageKey(record.id, viewport.name, 'resize', token);
        result.coverage.push(key);
        if (findings.length) {
          result.evidence[key] = keepEvidence(name(`resize-${from.label}-${target.label}`), samples);
          const film = await recordFilmstrip(context, name(`resize-${from.label}-${target.label}`), async () => { await transition(from); return transition(target); }, judge);
          if (film.sheet) result.sheets[key] = film.sheet;
          result.findings.push(...withVerdict(findings, film.rerun));
        }
      }
    } finally { if (current.width !== base.width || current.height !== base.height) await transition(base); }
  }
  for (const [frame] of [...stepSamples].filter(([frame]) => result.findings.some(item => item.rule === 'step-motion' && item.frame === `${frame - 1}>${frame}`))) {
    const film = await recordFilmstrip(context, name(`next-${frame}`), async () => {
      await jumpAndSettle(page, frame - 2 >= 2 ? frame - 4 : Math.min(frameCount - 1, frame));
      await jumpAndSettle(page, frame - 2);
      return sampleWhile(page, async () => { await probe(page, () => window.__babelAudit.clickNext()); await replayPaint(page, frame - 1); });
    }, samples => judgeStepMotion(samples, { thresholds: motionThresholds }));
    if (film.sheet) result.sheets[coverageKey(record.id, viewport.name, 'motion', `${frame - 1}>${frame}`)] = film.sheet;
    const transition = `${frame - 1}>${frame}`, flagged = result.findings.filter(item => item.rule === 'step-motion' && item.frame === transition);
    const verdicts = withVerdict(flagged, film.rerun ?? null);
    result.findings = result.findings.filter(item => !flagged.includes(item)).concat(verdicts);
  }
}

async function auditCanopy(context, record, result, anchorsFor) {
  if (!checks.has('static')) return;
  const snapshot = await collect(context.page);
  if (snapshot.error) throw new Error(snapshot.error);
  const { model, screen } = toFrameModel(snapshot, { frame: 'canopy', viewport: context.viewport.name, anchorsFor });
  const boxesOf = subject => [...screen].filter(([id]) => subject.includes(id)).flatMap(([, boxes]) => boxes);
  const findings = [...checkFrame(model, thresholds).map(item => ({ ...item, record: record.id, boxes: boxesOf(item.subject) })),
    ...letterFindings(snapshot, { record: record.id, frame: 'canopy', viewport: context.viewport.name })];
  const key = coverageKey(record.id, context.viewport.name, 'static', 'canopy');
  result.coverage.push(key);
  if (findings.length) {
    result.evidence[key] = keepEvidence(safeName(`${record.id}@${context.viewport.label}-canopy`), { snapshot, model });
    const sheet = await captureStill(context, safeName(`${record.id}@${context.viewport.label}-canopy`), findings);
    if (sheet) result.sheets[key] = sheet;
  }
  result.findings.push(...findings);
}

async function auditCase(context, entry) {
  const record = recordsById.get(entry.id), started = Date.now();
  const result = { id: entry.id, viewport: context.viewport.label, viewportName: context.viewport.name, sentence: record.sentence,
    fingerprint: { source: sourceFingerprint, config: configFingerprint(entry, context.viewport) },
    coverage: [], findings: [], sheets: {}, evidence: {}, phaseErrors: [] };
  const anchorsFor = anchorIndex(record);
  context.pageErrors = [];
  const knownDiagnostics = new Set(context.session.diagnostics);
  const order = context.loaded?.view === 'Canopy' ? ['Canopy', 'Replay'] : ['Replay', 'Canopy'];
  for (const view of order.filter(view => views.includes(view))) {
    try {
      await showCase(context, entry.id, view);
      if (view === 'Replay') await auditReplay(context, record, entry, result, anchorsFor);
      else await auditCanopy(context, record, result, anchorsFor);
    } catch (error) {
      result.phaseErrors.push(`${view}: ${String(error?.stack || error).slice(0, 2000)}`);
      context.loaded = null;
    }
  }
  // Page and console errors arrive through the listeners; the session adds requests and crashes.
  const sessionDiagnostics = context.session.diagnostics.filter(item => !knownDiagnostics.has(item) && item.fatal
    && !['pageerror', 'console'].includes(item.kind)).map(item => `${item.kind}: ${item.message}`);
  result.pageErrors = [...new Set([...context.pageErrors, ...sessionDiagnostics])];
  for (const message of [...result.phaseErrors, ...result.pageErrors]) result.findings.push({ rule: 'audit-error', subtype: null,
    record: entry.id, subject: message.split('\n')[0].slice(0, 160), frame: 'run', viewport: context.viewport.name, measure: null, detail: message });
  if (result.phaseErrors.length || result.pageErrors.length) result.error = [...result.phaseErrors, ...result.pageErrors].join('\n');
  result.elapsedMs = Date.now() - started;
  timings.caseMs.push(result.elapsedMs);
  return result;
}

async function composeSheets(session) {
  const page = session.page;
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (const job of sheetJobs.splice(0)) {
    const html = job.kind === 'still'
      ? `<h1>${escape(job.title)}</h1><ol>${job.findings.map(item => `<li><b>${escape(item.rule)}${item.subtype ? `/${escape(item.subtype)}` : ''}</b> ${escape(item.detail)}</li>`).join('')}</ol>
         <div class="row">${job.crop ? `<img src="${pathToFileURL(job.crop).href}" class="crop">` : ''}<img src="${pathToFileURL(job.full).href}" class="full"></div>`
      : `<h1>${escape(job.title)}${job.reproduced === false ? ' (not reproduced on re-run)' : ''}</h1><div class="grid">${job.frames.map(frame =>
          `<figure><img src="${pathToFileURL(frame.file).href}"><figcaption>+${frame.ms} ms</figcaption></figure>`).join('')}</div>`;
    const file = job.sheet.replace(/\.png$/, '.html');
    fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#06110e;color:#dffcf2;font:13px system-ui,sans-serif;width:1568px}
h1{font-size:16px;margin:0 0 8px}ol{margin:0 0 10px;padding-left:20px}.row{display:flex;gap:12px;align-items:flex-start}.crop{max-width:900px;max-height:900px;border:1px solid #1c6b58}
.full{width:${job.crop ? 640 : 1100}px;border:1px solid #1c6b58}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}figure{margin:0}figure img{width:100%;border:1px solid #164438}
figcaption{font-size:11px;color:#8fd3bf}</style>${html}`);
    await page.goto(pathToFileURL(file).href);
    await waitForDecodedImages(page, job.kind === 'still' ? (job.crop ? 2 : 1) : job.frames.length);
    await page.screenshot({ path: job.sheet, fullPage: true });
  }
}

const caseFile = (id, viewport) => path.join(out, 'cases', `${safeName(id)}@${viewport.label}.json`);
const results = [], resumeRejected = [];
let browserInfo = null;
for (const viewport of viewports) {
  let context = null;
  try {
    for (const [position, entry] of selection.entries()) {
      const file = caseFile(entry.id, viewport);
      if (values.resume && fs.existsSync(file)) {
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (receiptMatches(receipt, { source: sourceFingerprint, config: configFingerprint(entry, viewport) })) { results.push(receipt); continue; }
        resumeRejected.push({ id: entry.id, viewport: viewport.label, reason: receipt.error ? 'failed receipt' : 'source or configuration changed' });
      }
      if (!context || context.page.isClosed() || context.session.diagnostics.some(item => item.kind === 'disconnected' || item.kind === 'crash')) {
        await context?.session.close().catch(() => {});
        context = await openContext(viewport);
        browserInfo ??= { engine: context.session.engine, version: context.session.browserVersion };
      }
      const result = await auditCase(context, entry);
      fs.writeFileSync(file, JSON.stringify(result) + '\n');
      results.push(result);
      console.log(`[${viewport.label} ${position + 1}/${selection.length}] ${entry.id}: ${result.frameCount ?? '?'} frames, `
        + `${result.coverage.length} places, ${result.findings.length} finding(s)${result.error ? ', ERROR' : ''} (${(result.elapsedMs / 1000).toFixed(1)} s)`);
    }
    if (sheetJobs.length) {
      await context?.session.close().catch(() => {});
      context = await openContext({ width: 1600, height: 1000, label: 'sheets' });
      await composeSheets(context.session);
    }
  } finally { await context?.session.close().catch(() => {}); }
}

const percentile = (list, p) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null; };
const strip = ({ boxes, ...finding }) => finding;
const current = { findings: results.flatMap(result => result.findings.map(strip)), coverage: results.flatMap(result => result.coverage) };
let rows = current.findings, baseline = null;
if (values.baseline) {
  const previous = JSON.parse(fs.readFileSync(path.resolve(values.baseline), 'utf8'));
  const compared = compareWithBaseline(current, { findings: previous.findings || [], coverage: previous.coverage || [] });
  rows = compared.rows;
  baseline = { path: path.resolve(values.baseline), new: rows.filter(row => row.status === 'new').length,
    known: rows.filter(row => row.status === 'known').length, resolved: compared.resolved.length, uncovered: compared.uncovered.length,
    resolvedFindings: compared.resolved, uncoveredFindings: compared.uncovered };
}
const sheets = Object.assign({}, ...results.map(result => result.sheets || {}));
const report = { schema: REPORT_SCHEMA, ok: results.every(result => !result.error), startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(), node: process.version, browser: browserInfo,
  page: { path: pagePath, sha256: fingerprint(pageBytes), format: pageData.format, records: pageData.records.length },
  checkout: { root, head: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) }, sourceFingerprint,
  options: { cases: values.cases || null, case: values.case || [], frames: values.frames, viewports: viewports.map(v => `${v.name}=${v.label}`), views,
    checks: [...checks], direct: values.direct, directMethod: values['direct-method'], rapid: { runs: rapidRuns, clicks: rapidClicks, intervals: rapidIntervals },
    resize: values.resize, shard: values.shard || null, sample: values.sample || null, seed: values.seed, fast },
  thresholds, motionThresholds, cameraThresholds, resumeRejected,
  timings: { stepMedianMs: percentile(timings.stepMs, 0.5), stepP90Ms: percentile(timings.stepMs, 0.9),
    collectMedianMs: percentile(timings.collectMs, 0.5), caseMedianMs: percentile(timings.caseMs, 0.5) },
  baseline, summary: summarize(results, rows), coverage: current.coverage, findings: rows,
  cases: results.map(({ findings, coverage, ...result }) => ({ ...result, findingCount: findings.length, placeCount: coverage.length })) };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'index.html'), renderIndexHtml({ report, rows, sheets }));
console.log(`Audited ${report.summary.cases} analyses: ${report.summary.placesJudged} places judged, ${report.summary.flaggedPlaces} flagged, `
  + `${report.summary.findings} finding(s)${resumeRejected.length ? `; ${resumeRejected.length} stale receipt(s) re-audited` : ''}. Review ${path.join(out, 'index.html')}`);
if (!report.ok) process.exitCode = 1;
