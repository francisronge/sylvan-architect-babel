// A self-contained review page of saved analyses rendered by the production
// AsyncTreeVisualizer: the page format scripts/auditReplayBrowser.mjs drives.
// Records { id, sentence, inputTokens, derivationStages, label? } are embedded as
// <script id="replay-records">; ?case=ID&view=Replay|Canopy&frame=N selects one,
// and selects labelled "Saved analysis" and "Tree view" switch without reloading.
import fs from 'node:fs';
import { buildQualificationReviewRuntime } from '../buildContractQualificationReviewRuntime.mjs';

const ENTRY = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import TreeVisualizer from './components/AsyncTreeVisualizer';import{buildDerivationCanvasData}from'./replay/replayCanvas.ts';import'./styles.css';
const records=JSON.parse(document.getElementById('replay-records').textContent).records,q=new URLSearchParams(location.search);
function App(){const[chosen,setChosen]=useState(q.get('case')||records[0]?.id),[view,setView]=useState(q.get('view')||'Replay');const r=records.find(x=>x.id===chosen);if(!r)return <p style={{padding:16}}>Unknown saved analysis: {String(chosen)}</p>;
const keep=(key,value)=>{const u=new URL(location.href);u.searchParams.set(key,value);u.searchParams.delete('frame');history.replaceState(null,'',u);};
return <main><header><select aria-label="Saved analysis" value={chosen} onChange={e=>{setChosen(e.target.value);keep('case',e.target.value);}}>{records.map(x=><option value={x.id} key={x.id}>{x.label||x.id} · {x.sentence}</option>)}</select><select aria-label="Tree view" value={view} onChange={e=>{setView(e.target.value);keep('view',e.target.value);}}><option>Replay</option><option>Canopy</option></select></header><section><TreeVisualizer key={chosen+view} data={buildDerivationCanvasData(r.derivationStages.at(-1).workspaceForest)} sentence={r.sentence} inputTokens={r.inputTokens} derivationStages={r.derivationStages} animated={view==='Replay'} autoPlay={false} initialReplayStep={chosen===q.get('case')&&q.has('frame')?Number(q.get('frame'))-1:0}/></section></main>};createRoot(document.getElementById('root')).render(<App/>);`;

/** Writes the page and `<page>-runtime.json` (the runtime's input manifest); returns its path. */
export async function buildReviewPage(records, file) {
  const runtime = await buildQualificationReviewRuntime({ entrySource: ENTRY });
  const safe = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  fs.writeFileSync(file.replace(/\.html$/, '') + '-runtime.json', JSON.stringify(runtime.metadata, null, 2) + '\n');
  fs.writeFileSync(file, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Babel · review page</title><style>${runtime.css.replace(/<\/style/gi, '<\\/style')}html,body,#root,main{height:100%;margin:0}`
    + `body{background:#03100a;color:#ddede4;font:14px system-ui}main{display:flex;flex-direction:column}header{display:flex;gap:10px;padding:10px 16px;`
    + `align-items:center;border-bottom:1px solid #214a36;flex-wrap:wrap}select{min-width:0;max-width:100%;background:#0a1b12;color:inherit;`
    + `border:1px solid #285e44;border-radius:6px;padding:8px}select:first-of-type{flex:1}section{flex:1;min-height:0}</style><div id="root"></div>`
    + `<script id="replay-records" type="application/json">${safe({ records })}</script>`
    + `<script>${runtime.js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script></html>`);
  return file;
}

/** The human-catalogue analyses (fixtures/replay-regressions/visual-human-catalog.json),
 * with the record ids the offline visual audit uses. */
export function catalogRecords(fixture) {
  return fixture.cases.flatMap((entry, caseIndex) => entry.analyses.map((analysis, analysisIndex) => ({
    id: `replay-regressions/visual-human-catalog.json#/cases/${caseIndex}/analyses/${analysisIndex}`,
    label: `catalogue case ${caseIndex}${entry.analyses.length > 1 ? ` analysis ${analysisIndex + 1}` : ''}`,
    sentence: entry.sentence, inputTokens: entry.inputTokens, derivationStages: analysis.derivationStages })));
}
