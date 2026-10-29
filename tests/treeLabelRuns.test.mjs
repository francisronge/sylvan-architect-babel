import test from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';
import {
  stagedTerminalText,
  identityLabelState,
  thetaLabelState,
  treeLabelRunKey,
  identityLabelTarget,
  thetaLabelTarget,
  treeLabelRunsForStep
} from '../replay/treeLabelRuns.ts';
import { readFileSync } from 'node:fs';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
const context=(trace={},operator={},aliases={})=>({traceIndices:new Map(Object.entries(trace)),operatorIndices:new Map(Object.entries(operator)),rawTraceAliases:new Map(Object.entries(aliases))});
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
 assert.equal(stagedTerminalText(leaf('Book',{ghost:true}),context({}, {w:'11'})),'Book');
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
 assert.deepEqual(thetaLabelState(thetaLabelState(identity,'j'),'k').indices,[{text:'i',mode:'identity'},{text:'k',mode:'theta'}]);
});
test('theta keeps the chain or operator index the step staged on its terminal',()=>{
 const staged={kind:'terminal',text:'PRO₂',stagedText:'PRO₂',defaultText:'PRO',indices:[]};
 assert.deepEqual(thetaLabelState(staged,'k'),{...staged,lines:undefined,indices:[{text:'k',mode:'theta'}]});
});
test('a theta grid on a moved occurrence keeps its chain index beside the theta letter',()=>{
 // french-relative: Jean is a chain occurrence (Jean₂) that a theta grid also indexes.
 const {derivationStages,sentence,inputTokens}=JSON.parse(readFileSync(new URL('../fixtures/performance/french-relative.json',import.meta.url),'utf8'));
 const replay=prepareReplay({derivationStages,sentence,inputTokens,includePlayback:true});
 const runs=replay.playbackSteps.flatMap((_step,index)=>treeLabelRunsForStep(replay,index).get('jean::__leaf')??[])
   .filter(run=>run.indices.some(index=>index.mode==='theta'));
 assert(runs.some(run=>run.text==='Jean₂'),'a theta letter follows Jean₂ once Jean is a chain occurrence');
});
test('theta category reset preserves current text content and loses wrapping exactly once',()=>{
 const base={kind:'category',text:'DP [silent]',lines:['DP ','[silent]'],indices:[]};
 const first=thetaLabelState(base,'i');
 assert.equal(first.lines,undefined);assert.equal(first.text,'DP [silent]');
 assert.equal(thetaLabelState(first,'j').text,'DP [silent]i');
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
