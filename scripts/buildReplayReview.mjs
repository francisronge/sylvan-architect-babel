// One-pane review page over saved batches: every analysis of every run, one at a
// time in the production renderer, starting at step 1. The tool, not the person
// building the page, writes each tree's notes from the Replay invariant audit
// (and, with --visual, the offline visual and camera audits), so a known fault
// is always printed on its tree.
//
//   node scripts/buildReplayReview.mjs --batch DIR[=Label]... --out DIR [--root CHECKOUT] [--visual]
//
// DIR holds runs/<run>/attempts/parse/bundle.json, as qualification batches do.
// Keys: ← → step through Replay, j / k change tree. Opened trees are remembered.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { batchSourceName } from './buildCorpusArchiveManifest.mjs';
import { paneHtml, resolveCase } from './buildReplayComparison.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');

/** Plain-words notes for one tree: movement diagnostics and Replay rule violations,
 * then every distinct visual and camera finding, grouped by rule
 * (their measures have different units) and largest first within a rule. */
export function reviewNotes({ violations = [], visual = [], movementDiagnostics = [] }) {
  const notes = [...new Set(movementDiagnostics.map(({ step, detail }) => `Babel could not draw a movement at step ${step}: ${detail}`))];
  notes.push(...violations.map(v => `Replay check ${v.rule}${v.frame === null || v.frame === undefined ? '' : ` at step ${v.frame}`}: ${v.detail}`));
  const worst = new Map();
  for (const f of visual) {
    const key = `${f.rule}|${f.subtype}|${f.subject ?? ''}`, seen = worst.get(key);
    if (!seen || f.measure > seen.measure) worst.set(key, f);
  }
  const kind = f => `${f.rule}${f.subtype ? ` (${f.subtype})` : ''}`;
  notes.push(...[...worst.values()].sort((a, b) => kind(a).localeCompare(kind(b)) || b.measure - a.measure)
    .map(f => `${kind(f)} ${Math.round(f.measure * 10) / 10} at ${f.viewport}, step ${String(f.frame).split('>')[0]}`));
  return notes;
}

/** Each batch's audit results keyed by `<run> a<n>`. Every batch is audited on its
 * own, and an audit record that does not name that batch is refused, so one
 * batch's results never land on another's trees. `auditInvariants(batch, index)`
 * returns an auditReplayInvariants report; `auditVisual(batch, index)` returns
 * auditReplayVisuals findings. */
export function auditBatches(batches, { auditInvariants, auditVisual = null }) {
  return batches.map((batch, index) => {
    const name = batchSourceName(batch.dir), own = (...prefixes) => id => {
      const prefix = prefixes.find(start => id.startsWith(start));
      if (prefix === undefined) throw Error(`The audit of ${batch.dir} returned ${id}, which names another batch`);
      return id.slice(prefix.length);
    };
    // The visual audits run in --root, whose ids may still name the batch folder alone.
    const invariantKey = own(`${name}/`), visualKey = own(`run:${name}/`, `run:${path.basename(batch.dir)}/`);
    const violations = new Map(auditInvariants(batch, index).records.map(r => [invariantKey(r.id), r.violations]));
    const visual = new Map();
    for (const f of auditVisual?.(batch, index) ?? []) {
      const [, run, ai] = /^([^/]+)\/parse#(\d+)$/.exec(visualKey(f.record)) ?? [];
      if (run) { const key = `${run} a${Number(ai) + 1}`; visual.set(key, [...(visual.get(key) ?? []), f]); }
    }
    return { violations, visual };
  });
}

/** `--batch DIR[=Label]` values. A label defaults to the batch's archive and folder
 * names; two batches may not share a folder or a label, whose trees would merge
 * into one group. */
export function reviewBatches(specs) {
  const batches = specs.map(spec => {
    const [dir, label] = spec.split('=');
    return { dir: path.resolve(dir), label: label ?? batchSourceName(dir) };
  });
  for (const key of ['dir', 'label']) {
    const repeated = batches.map(batch => batch[key]).filter((value, index, all) => all.indexOf(value) !== index);
    if (repeated.length) throw Error(`Two --batch values share the ${key === 'dir' ? 'folder' : 'label'} ${repeated[0]}`);
  }
  return batches;
}

/** The page: tree list, one Replay pane opening at step 1, keyboard on the pane. */
export function reviewIndexHtml(cases) {
  const data = cases.map(({ group, title, sentence, notes, steps, total }) => ({ group, title, sentence, notes, steps, total }));
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Babel review</title><style>
*{box-sizing:border-box}body{margin:0;font:13px/1.4 system-ui,sans-serif;background:#07100c;color:#cfe;display:grid;grid-template-columns:300px 1fr;height:100vh}
#list{overflow:auto;border-right:1px solid #1d3329}#list h3{margin:12px 12px 4px;font-size:12px;color:#7a9;text-transform:uppercase;letter-spacing:.08em}
.item{padding:6px 12px;cursor:pointer;border-left:3px solid transparent}.item:hover{background:#0d1d16}.item.on{background:#12281e;border-left-color:#5c9}
.item .t{color:#e6fff2}.item .s{color:#8ab;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item.flag .t::after{content:" •";color:#e9b04a}
.item.done .t{color:#6a8}main{display:grid;grid-template-rows:auto 1fr;min-width:0}#bar{padding:8px 12px;border-bottom:1px solid #1d3329}
#bar .sent{font-size:15px;color:#fff}#bar .note{color:#e9c27a;margin:2px 0}#bar button{background:#12281e;color:#cfe;border:1px solid #2a4a3a;border-radius:6px;padding:4px 10px;margin:4px 4px 0 0;cursor:pointer}
iframe{width:100%;height:100%;border:0}#nav{float:right}</style>
<div id="list"></div><main><div id="bar"></div><iframe id="f" title="Replay"></iframe></main><script>
const cases=${safeJson(data)},key='babel-review-opened:'+location.pathname,done=new Set(JSON.parse(localStorage.getItem(key)||'[]'));let cur=0;
const $=id=>document.getElementById(id),list=$('list'),frame=$('f');let group=null;
cases.forEach((c,i)=>{if(c.group!==group){group=c.group;const h=document.createElement('h3');h.textContent=group;list.append(h)}
const d=document.createElement('div');d.className='item'+(c.notes.length?' flag':'');d.id='c'+i;d.innerHTML='<div class="t"></div><div class="s"></div>';
d.querySelector('.t').textContent=c.title;d.querySelector('.s').textContent=c.sentence;d.onclick=()=>show(i,1);list.append(d)});
function show(i,step){cur=i;done.add(i);localStorage.setItem(key,JSON.stringify([...done]));const c=cases[i];
$('bar').innerHTML='<span id="nav"><button id="p">◀ Prev tree (k)</button><button id="n">Next tree (j) ▶</button></span><div class="sent"></div><div id="notes"></div><div id="steps"></div>';
$('bar').querySelector('.sent').textContent=(i+1)+'/'+cases.length+' · '+c.title+' — '+c.sentence+' · '+c.total+' steps';
for(const n of c.notes){const p=document.createElement('div');p.className='note';p.textContent=n;$('notes').append(p)}
for(const s of c.steps){const b=document.createElement('button');b.textContent='step '+s;b.onclick=()=>show(i,s);$('steps').append(b)}
$('p').onclick=()=>cur>0&&show(cur-1,1);$('n').onclick=()=>cur<cases.length-1&&show(cur+1,1);
frame.src='pane.html?case='+i+'&step='+step;for(const x of cases.keys()){const e=$('c'+x);e.classList.toggle('on',x===i);e.classList.toggle('done',done.has(x))}
$('c'+i).scrollIntoView({block:'nearest'})}
const press=name=>[...(frame.contentDocument?.querySelectorAll('button')||[])].find(b=>b.textContent.trim().toLowerCase()===name&&!b.disabled)?.click();
const keys=e=>{if(e.key==='j'){e.preventDefault();cur<cases.length-1&&show(cur+1,1)}else if(e.key==='k'){e.preventDefault();cur>0&&show(cur-1,1)}
else if(e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();press('next')}else if(e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();press('prev')}};
frame.addEventListener('load',()=>{frame.focus();frame.contentWindow.focus();frame.contentWindow.addEventListener('keydown',keys,true)});
addEventListener('keydown',keys);show(Number(location.hash.slice(1))||0,1);</script></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { batch: { type: 'string', multiple: true, default: [] }, out: { type: 'string' },
    root: { type: 'string' }, visual: { type: 'boolean', default: false } } });
  if (!values.batch.length || !values.out) throw new Error('Usage: --batch DIR[=Label]... --out DIR [--root CHECKOUT] [--visual]');
  const root = path.resolve(values.root ?? repoRoot);
  const { prepareReplay } = await import(pathToFileURL(path.join(root, 'replay/prepareReplay.ts')).href);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-review-'));
  const batches = reviewBatches(values.batch);
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const audits = auditBatches(batches, {
    auditInvariants: (b, index) => {
      const file = path.join(scratch, `invariants-${index}.json`);
      execFileSync(process.execPath, [path.join(repoRoot, 'scripts/auditReplayInvariants.mjs'), '--checkout', root, '--examples', '0',
        '--batch', b.dir, '--out', file], { stdio: 'inherit' });
      return readJson(file);
    },
    auditVisual: values.visual ? (b, index) => {
      const files = ['visual', 'camera'].map(kind => path.join(scratch, `${kind}-${index}.json`));
      execFileSync(process.execPath, [path.join(root, 'scripts/auditReplayVisuals.mjs'), '--runs', path.join(b.dir, 'runs'),
        '--audit', 'visual', '--audit', 'camera', '--out', files[0], '--out', files[1]], { stdio: 'inherit' });
      return files.flatMap(file => readJson(file).findings);
    } : null
  });
  const cases = [];
  for (const [index, b] of batches.entries()) for (const run of fs.readdirSync(path.join(b.dir, 'runs')).sort()) {
    const source = path.join(b.dir, 'runs', run, 'attempts', 'parse', 'bundle.json');
    if (!fs.existsSync(source)) continue;
    const { analyses } = JSON.parse(fs.readFileSync(source, 'utf8')).response;
    analyses.forEach((_, analysis) => {
      const record = resolveCase({ source, analysis, title: run, watch: '-', steps: [1] }, { root });
      const prepared = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = prepared.playbackSteps;
      let shown = 0; const moments = [];
      // A refused curated drawing matters only when no path is drawn for the claim.
      const drawsPath = ({ replayRelationIdentity: claim }) => claim && (prepared.relationRenderPlan?.frames[claim.stageIndex]?.items ?? [])
        .some(item => item.kind === 'trajectory' && item.relationRef?.stageIndex === claim.stageIndex && item.relationRef?.relationIndex === claim.relationIndex);
      const movementDiagnostics = steps.flatMap((step, i) => (step.movementDiagnostics ?? [])
        .filter(detail => /^(?:MOVEMENT_|RELATION_TIMING_CONFLICT)/.test(detail) || /drawing was not licensed/.test(detail) && !drawsPath(step))
        .map(detail => ({ step: i + 1, detail })));
      steps.forEach((step, i) => { const n = (step.replayVisibleNodeIds ?? []).length; if (step.replayKind === 'relation' && n > shown) moments.push(i + 1); shown = n; });
      const id = `${run} a${analysis + 1}`, { violations, visual } = audits[index];
      cases.push({ ...record, group: b.label, title: `${run}${analyses.length > 1 ? ` · reading ${analysis + 1}` : ''}`, total: steps.length,
        notes: reviewNotes({ violations: violations.get(id), visual: visual.get(id), movementDiagnostics }),
        steps: [...new Set([...moments.filter((_, i) => i % Math.max(1, Math.ceil(moments.length / 6)) === 0), steps.length])] });
    });
  }
  fs.mkdirSync(values.out, { recursive: true });
  fs.writeFileSync(path.join(values.out, 'pane.html'), await paneHtml(root, cases));
  fs.writeFileSync(path.join(values.out, 'index.html'), reviewIndexHtml(cases));
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ out: values.out, trees: cases.length, withNotes: cases.filter(c => c.notes.length).length }));
}
