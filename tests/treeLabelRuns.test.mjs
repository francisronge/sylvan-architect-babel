import test from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';
import {
  stagedTerminalText,
  identityLabelState,
  thetaLabelState,
  treeLabelRunKey,
  treeLabelIndexAttributes,
  identityLabelTarget,
  thetaLabelTarget,
  treeLabelRunsForStep
} from '../replay/treeLabelRuns.ts';
import { readFileSync } from 'node:fs';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
const context=(trace={},aliases={})=>({traceIndices:new Map(Object.entries(trace)),rawTraceAliases:new Map(Object.entries(aliases))});
const leaf=(word,extras={})=>{const root=d3.hierarchy({id:'w',label:'N',word,...extras});applyVizIds(root);return root;};

test('formatted terminal measures all generated digits and preserves authored literals',()=>{
 assert.equal(stagedTerminalText(leaf('Book'),context({w:'10'})),'Book₁₀');
 assert.equal(stagedTerminalText(leaf('猫'),context({w:'10'})),'猫₁₀');
 assert.equal(stagedTerminalText(leaf('Book_12'),context({w:'10'})),'Book_12');
 assert.equal(stagedTerminalText(leaf('Book₁₂'),context({w:'10'})),'Book₁₂');
 assert.equal(stagedTerminalText(leaf('t'),context({w:'12'})),'t');
 assert.equal(stagedTerminalText(leaf('t_V'),context({w:'12'})),'t_V');
 assert.equal(stagedTerminalText(leaf('t_i'),context({w:'12'})),'t_i');
 assert.equal(stagedTerminalText(leaf('∅'),context({w:'12'})),'∅');
});
test('silent/ghost lexical copies retain their lexical display and exact casing',()=>{
 assert.equal(stagedTerminalText(leaf('book',{silent:true}),context({w:'11'})),'book₁₁');
 assert.equal(stagedTerminalText(leaf('Book',{ghost:true}),context({})),'Book');
 assert.equal(stagedTerminalText(leaf('Book',{ghost:true}),context({w:'11'})),'Book₁₁');
});
test('identity deduplicates existing notation, but retains distinct and Unicode indices',()=>{
 const label={kind:'terminal',text:'Book₁₀',indices:[],defaultText:'Book'};
 assert.deepEqual(identityLabelState(label,'10').indices,[]);
 const one=identityLabelState(label,'χ₁');
 const two=identityLabelState(one,'猫٢');
 assert.deepEqual(identityLabelState(two,'χ₁').indices,[{text:'χ₁',mode:'identity'},{text:'猫٢',mode:'identity'}]);
 assert.equal(one.identityBaseText,'Book₁₀');
});
test('theta retains identity runs, uses the existing saved base and avoids duplicate same-index ink',()=>{
 const base={kind:'terminal',text:'Book₁₀',defaultText:'Book',indices:[]};
 assert.deepEqual(thetaLabelState(base,'j'),{...base,text:'Book',lines:undefined,indices:[{text:'j',mode:'theta'}]});
 const identity=identityLabelState(base,'i');
 assert.deepEqual(thetaLabelState(identity,'i').indices,[{text:'i',mode:'identity'}]);
 assert.equal(thetaLabelState(identity,'j').text,'Book₁₀');
 assert.deepEqual(thetaLabelState(thetaLabelState(identity,'j'),'k').indices,[{text:'i',mode:'identity'},{text:'j',mode:'theta'},{text:'k',mode:'theta'}]);
});
test('theta keeps the chain index the step staged on its terminal',()=>{
 const staged={kind:'terminal',text:'PRO₂',stagedText:'PRO₂',defaultText:'PRO',indices:[]};
 assert.deepEqual(thetaLabelState(staged,'k'),{...staged,lines:undefined,indices:[{text:'k',mode:'theta'}]});
});
test('theta reuses a staged subscript equal to its index instead of repeating it',()=>{
 // n4-02-en-multiple-wh-embedded (sol-120-20261026): book₁ with θ index 1 read book₁¹.
 const staged={kind:'terminal',text:'book₁',stagedText:'book₁',defaultText:'book',indices:[]};
 assert.deepEqual(thetaLabelState(staged,'1'),{...staged,lines:undefined,indices:[]});
 assert.deepEqual(thetaLabelState(staged,'2').indices,[{text:'2',mode:'theta'}]);
});
test('a theta grid on a moved head keeps its chain index beside the theta letter',()=>{
 // workspace-source-continuity: the moved head wird is a chain occurrence (wird₁) that a theta grid also indexes.
 const {cases}=JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/workspace-source-continuity.json',import.meta.url),'utf8'));
 const replay=prepareReplay({...cases[0],includePlayback:true});
 const runs=replay.playbackSteps.flatMap((_step,index)=>treeLabelRunsForStep(replay,index).get('wirdV::__leaf')??[])
   .filter(run=>run.indices.some(index=>index.mode==='theta'));
 assert(runs.some(run=>run.text==='wird₁'),'a theta letter follows wird₁ once wird is a chain occurrence');
});
test('a theta grid on a moved one-word phrase keeps the chain index on its label and the letter on its word',()=>{
 // french-relative: the DP Jean is a chain occurrence (D₂) that a theta grid also indexes.
 const {derivationStages,sentence,inputTokens}=JSON.parse(readFileSync(new URL('../fixtures/performance/french-relative.json',import.meta.url),'utf8'));
 const replay=prepareReplay({derivationStages,sentence,inputTokens,includePlayback:true});
 const steps=replay.playbackSteps.map((_step,index)=>treeLabelRunsForStep(replay,index))
   .filter(runs=>runs.get('jean::__leaf')?.some(run=>run.indices.some(index=>index.mode==='theta')));
 assert(steps.some(runs=>runs.get('jean').some(run=>run.kind==='category'&&run.text==='D₂')
   && runs.get('jean::__leaf').some(run=>run.text==='Jean'&&run.indices.some(index=>index.mode==='theta'))),
   'D₂ stands over Jean once Jean is a chain occurrence, and its theta letter stays on the word');
});
test('a word that is an argument of two theta grids keeps both letters in grid order, each once',()=>{
 const staged={kind:'terminal',text:'leave₁',stagedText:'leave₁',defaultText:'leave',indices:[]};
 const both=thetaLabelState(thetaLabelState(identityLabelState(staged,'i'),'l'),'m');
 assert.equal(both.text,'leave₁');
 assert.deepEqual(both.indices,[{text:'i',mode:'identity'},{text:'l',mode:'theta'},{text:'m',mode:'theta'}]);
 assert.deepEqual(thetaLabelState(both,'l').indices,both.indices,'a letter two grids share is shown once');
 const category=thetaLabelState(thetaLabelState({kind:'category',text:'DP [silent]',lines:['DP ','[silent]'],indices:[]},'i'),'j');
 assert.equal(category.text,'DP [silent]','the second grid keeps the base the first grid reset, not its letter');
 assert.deepEqual(category.indices.map(index=>index.text),['i','j']);
});
test('a second theta letter sits on the lowered line the first one opened',()=>{
 assert.equal(treeLabelIndexAttributes('terminal','theta').dy,'14');
 assert.equal(treeLabelIndexAttributes('terminal','theta','identity').dy,'14');
 assert.equal(treeLabelIndexAttributes('terminal','theta','theta').dy,undefined,'SVG dy accumulates');
});
test('the last word of a nominal and a clausal argument shows both grids\' letters',()=>{
 // workspace-component-lifetime: chapter is Theme i of revise and ends the Content clause k of said.
 const {cases}=JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/workspace-component-lifetime.json',import.meta.url),'utf8'));
 const replay=prepareReplay({...cases[0],includePlayback:true});
 const letters=replay.playbackSteps.map((_step,index)=>treeLabelRunsForStep(replay,index).get('chapterN::__leaf')?.[0]?.indices.map(index=>index.text).join('')??'');
 assert(letters.includes('ik'),JSON.stringify([...new Set(letters)]));
 assert(!letters.includes('k'),'the second grid does not replace the first grid\'s letter');
});
test('theta category reset preserves current text content and loses wrapping exactly once',()=>{
 const base={kind:'category',text:'DP [silent]',lines:['DP ','[silent]'],indices:[]};
 const first=thetaLabelState(base,'i');
 assert.equal(first.lines,undefined);assert.equal(first.text,'DP [silent]');
 assert.equal(thetaLabelState(first,'j').text,'DP [silent]');
 assert.deepEqual(thetaLabelState(first,'j').indices.map(index=>index.text),['i','j']);
});
test('index targets use exact anchor material, ambiguity and all-trace category rule',()=>{
 const root=d3.hierarchy({id:'p',label:'DP',children:[{id:'a',label:'D',word:'the'},{id:'b',label:'N',word:'book'}]});applyVizIds(root);
 assert.equal(identityLabelTarget(root).kind,'category');assert.equal(identityLabelTarget(root).ambiguityCount,2);
 assert.equal(thetaLabelTarget(root).labelId,'b');
 const trace=d3.hierarchy({id:'p',label:'DP',children:[{id:'t',label:'N',word:'t'}]});applyVizIds(trace);
 assert.equal(thetaLabelTarget(trace).kind,'category');assert.equal(identityLabelTarget(trace).kind,'terminal');
});
test('styled request identity preserves ordering, wrapping, Unicode and mode',()=>{
 const label={kind:'category',text:'AB',lines:['A','B'],indices:[{text:'猫',mode:'identity'}]};
 assert.notEqual(treeLabelRunKey(label),treeLabelRunKey({...label,lines:undefined}));
 assert.notEqual(treeLabelRunKey(label),treeLabelRunKey({...label,indices:[{text:'猫',mode:'theta'}]}));
});
