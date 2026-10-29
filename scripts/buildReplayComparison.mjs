// Build Francis's side-by-side Replay review: the same analyses played in two
// checkouts by each checkout's own renderer, stepped together.
//
//   node scripts/buildReplayComparison.mjs --baseline-root /path/main \
//     --candidate-root /path/branch --cases cases.json --out /tmp/review
//
// cases.json is a list of { source, selector?, analysis?, title, watch, steps }:
// `source` is a fixture or a saved run's bundle.json, `selector` a JSON pointer
// to an object holding `analyses` or `derivationStages`, `watch` says in plain
// words what to look at, and `steps` lists the 1-based Replay steps to open.
// The page is written outside the worktree; serve it over loopback HTTP so its
// step controls can drive both panes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

/** A candidate that lacks the baseline's commit replays old behaviour as if it
 * were the change (the realized-forms page of 24 Oct was built before #249 and
 * showed the old build order). Refuse it. */
export function checkoutState(root) {
  return { root, commit: git(root, 'rev-parse', 'HEAD'), dirty: git(root, 'status', '--porcelain', '--untracked-files=no') !== '' };
}

export function assertCandidateContainsBaseline(baselineRoot, candidateRoot) {
  const baseline = checkoutState(baselineRoot), candidate = checkoutState(candidateRoot);
  try {
    execFileSync('git', ['-C', candidateRoot, 'merge-base', '--is-ancestor', baseline.commit, candidate.commit], { stdio: 'ignore' });
  } catch {
    throw new Error(`Candidate ${candidate.commit.slice(0, 9)} does not contain baseline ${baseline.commit.slice(0, 9)}. `
      + 'Merge the baseline into the candidate first; otherwise the right pane shows old behaviour as if it were the change.');
  }
  return { baseline, candidate };
}

/** Francis reviews a change by looking at it, not by reading it (29 Oct: a
 * 17-case page with paragraph notes, when he needed one arrow). A page shows
 * only the cases that prove the change, each with one short line. */
export const REVIEW_LIMITS = Object.freeze({ cases: 4, watchChars: 120, steps: 3 });

export function checkCaseList(specs) {
  if (!Array.isArray(specs) || !specs.length) throw new Error('cases.json must list at least one case.');
  if (specs.length > REVIEW_LIMITS.cases) throw new Error(`${specs.length} cases: show at most ${REVIEW_LIMITS.cases}, only the ones that prove the change.`);
  for (const spec of specs) {
    const watch = String(spec?.watch ?? '').trim();
    if (watch.length > REVIEW_LIMITS.watchChars) throw new Error(`Case "${spec.title}": "watch" is ${watch.length} characters; say what changed in one line of at most ${REVIEW_LIMITS.watchChars}.`);
    if (Array.isArray(spec.steps) && spec.steps.length > REVIEW_LIMITS.steps) throw new Error(`Case "${spec.title}": ${spec.steps.length} steps; open at most ${REVIEW_LIMITS.steps}, the ones where the change shows.`);
  }
  return specs;
}

const pointerParts = pointer => (pointer ?? '').split('/').filter(Boolean).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));

/** Resolve one case into a record the review app plays. */
export function resolveCase(spec, { root }) {
  for (const field of ['source', 'title', 'watch']) {
    if (typeof spec[field] !== 'string' || !spec[field].trim()) throw new Error(`Every case needs a "${field}": ${JSON.stringify(spec)}`);
  }
  if (!Array.isArray(spec.steps) || !spec.steps.length || !spec.steps.every(step => Number.isInteger(step) && step > 0)) {
    throw new Error(`Case "${spec.title}" needs "steps": the 1-based Replay steps to open.`);
  }
  const file = path.isAbsolute(spec.source) ? spec.source : path.join(root, spec.source);
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chain = [document];
  for (const part of pointerParts(spec.selector)) chain.unshift(chain[0]?.[Array.isArray(chain[0]) ? Number(part) : part]);
  const node = chain[0];
  const analyses = node?.response?.analyses ?? node?.analyses ?? (node?.derivationStages ? [node] : null);
  const analysis = analyses?.[spec.analysis ?? 0];
  if (!analysis?.derivationStages?.length) throw new Error(`Case "${spec.title}" names no analysis with derivationStages.`);
  // A selector may point below the objects holding the sentence and saved
  // tokens (a bundle's /response/analyses/0): each comes from its nearest holder.
  const nearest = read => [node, analysis, ...chain.slice(1)].map(read).find(value => value !== undefined);
  const sentence = nearest(item => [item?.request?.sentence, item?.sentence].find(value => typeof value === 'string' && value.trim()));
  if (!sentence) throw new Error(`Case "${spec.title}" has no saved sentence.`);
  return { title: spec.title, watch: spec.watch, steps: spec.steps, sentence,
    inputTokens: nearest(item => [item?.response?.inputTokens, item?.inputTokens].find(Array.isArray)),
    derivationStages: analysis.derivationStages };
}

const ENTRY = `import React from 'react';import{createRoot}from'react-dom/client';import TreeVisualizer from './components/AsyncTreeVisualizer';import{buildDerivationCanvasData}from'./replay/replayCanvas.ts';import'./styles.css';
const records=JSON.parse(document.getElementById('replay-records').textContent),q=new URLSearchParams(location.search),r=records[Number(q.get('case')??0)];
createRoot(document.getElementById('root')).render(r?<TreeVisualizer data={buildDerivationCanvasData(r.derivationStages.at(-1).workspaceForest)} sentence={r.sentence} inputTokens={r.inputTokens} derivationStages={r.derivationStages} animated autoPlay={false} initialReplayStep={q.has('step')?Number(q.get('step'))-1:0}/>:<p>Unknown case</p>);`;

const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function paneHtml(root, records) {
  const { buildQualificationReviewRuntime } = await import(pathToFileURL(path.join(root, 'scripts/buildContractQualificationReviewRuntime.mjs')).href);
  const runtime = await buildQualificationReviewRuntime({ root, entrySource: ENTRY });
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Replay</title><style>${runtime.css.replace(/<\/style/gi, '<\\/style')}html,body,#root{height:100%;margin:0}body{background:#03100a}</style><div id="root"></div><script id="replay-records" type="application/json">${safeJson(records.map(({ sentence, inputTokens, derivationStages }) => ({ sentence, inputTokens, derivationStages })))}</script><script>${runtime.js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script></html>`;
}

/** The review page. Its panes step together: shared navigation does nothing
 * until both panes show their Replay controls (a pane still preparing would
 * miss the step and stay one behind), and an arrow key pressed inside a pane
 * steps both instead of only that pane's own Replay. */
export function indexHtml({ title, baseline, candidate, records }) {
  const label = state => `${state.commit.slice(0, 9)}${state.dirty ? ' + uncommitted changes' : ''}`;
  const cases = records.map(({ title: caseTitle, watch, steps }) => ({ title: caseTitle, watch, steps }));
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#06100c;color:#cfe;font:14px/1.4 system-ui,sans-serif}header{padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;border-bottom:1px solid #1d3a2e}
select,button{background:#0d211a;color:#cfe;border:1px solid #2c5a47;border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer}button:hover{background:#163628}
.watch{padding:8px 16px;font-size:15px}.steps{padding:0 16px 8px;display:flex;flex-wrap:wrap;gap:6px}.panes{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 6px 6px}
h2{margin:4px 6px;font-size:14px}h2.a{color:#f9a}h2.b{color:#8f8}iframe{width:100%;height:calc(100vh - 190px);border:1px solid #1d3a2e;border-radius:6px;background:#000}</style>
<header><strong>${escapeHtml(title)}</strong><select id="case" aria-label="Example"></select><button id="prev">◀ Prev both</button><button id="next">Next both ▶</button><span>or ← →</span></header>
<div class="watch" id="watch"></div><div class="steps" id="steps"></div>
<div class="panes"><div><h2 class="a">BEFORE · ${escapeHtml(label(baseline))}</h2><iframe id="before" title="Before"></iframe></div><div><h2 class="b">AFTER · ${escapeHtml(label(candidate))}</h2><iframe id="after" title="After"></iframe></div></div>
<script>const C=${safeJson(cases)},$=id=>document.getElementById(id);let cur=0;
const go=step=>{for(const side of ['before','after'])$(side).src=side+'.html?case='+cur+'&step='+step};
const load=i=>{cur=i;$('watch').textContent='Watch: '+C[i].watch;$('steps').replaceChildren(...C[i].steps.map(step=>{const b=document.createElement('button');b.textContent='step '+step;b.onclick=()=>go(step);return b}));go(C[i].steps[0])};
C.forEach((c,i)=>$('case').append(new Option(c.title,i)));$('case').onchange=e=>load(+e.target.value);
const panes=['before','after'],control=(side,name)=>[...($(side).contentDocument?.querySelectorAll('button')??[])].find(b=>b.textContent.trim().toLowerCase()===name);
const press=name=>{if(panes.some(side=>!control(side,'next')&&!control(side,'prev')))return;panes.forEach(side=>{const b=control(side,name);if(b&&!b.disabled)b.click()})};
const key=e=>{const name={ArrowRight:'next',ArrowLeft:'prev'}[e.key];if(!name||e.altKey||e.ctrlKey||e.metaKey)return;e.preventDefault();e.stopImmediatePropagation();press(name)};
panes.forEach(side=>$(side).addEventListener('load',()=>$(side).contentWindow.addEventListener('keydown',key,true)));
$('next').onclick=()=>press('next');$('prev').onclick=()=>press('prev');document.addEventListener('keydown',key);load(0);</script></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { 'baseline-root': { type: 'string' }, 'candidate-root': { type: 'string' },
    cases: { type: 'string' }, out: { type: 'string' }, title: { type: 'string' } } });
  for (const option of ['baseline-root', 'candidate-root', 'cases', 'out']) if (!values[option]) throw new Error(`--${option} is required`);
  const baselineRoot = path.resolve(values['baseline-root']), candidateRoot = path.resolve(values['candidate-root']);
  const { baseline, candidate } = assertCandidateContainsBaseline(baselineRoot, candidateRoot);
  const records = checkCaseList(JSON.parse(fs.readFileSync(values.cases, 'utf8'))).map(spec => resolveCase(spec, { root: candidateRoot }));
  fs.mkdirSync(values.out, { recursive: true });
  fs.writeFileSync(path.join(values.out, 'before.html'), await paneHtml(baselineRoot, records));
  fs.writeFileSync(path.join(values.out, 'after.html'), await paneHtml(candidateRoot, records));
  fs.writeFileSync(path.join(values.out, 'index.html'), indexHtml({ title: values.title ?? 'Before and after', baseline, candidate, records }));
  console.log(JSON.stringify({ out: values.out, cases: records.length, baseline: baseline.commit, candidate: candidate.commit }));
}
