import assert from 'node:assert/strict';
import test from 'node:test';
import { treeLabelMetricKey } from '../replay/treeLabelMetricKey.ts';
import { treeLabelRunKey } from '../replay/treeLabelRuns.ts';
const terminal=(text='Book₁₀',indices=[])=>({kind:'terminal',text,indices});
const bounds=()=>({x:-85,y:70,width:190,height:77});
const fixture=()=>{const first={label:'N'},second={label:'N'};
 const steps=[{replayCanvasData:first},{replayCanvasData:second}];
 const run=terminal('Book₁₀',[{text:'作者₁',mode:'identity'},{text:'θ𝒾',mode:'theta'}]);
 return {first,second,steps,run,labels:new Map([[first,new Map([['n',[run]]])],[second,new Map([['n',[terminal('book')]]])]])};};
test('fresh collectors receive each exact styled request before matching keys reuse geometry',()=>{
 const {steps,labels}=fixture(),first=treeLabelMetricKey(steps,labels,bounds),seen=new Map();
 const collector=run=>{const value=bounds();seen.set(treeLabelRunKey(run),value);return value;};
 assert.equal(treeLabelMetricKey(steps,labels,collector),first);assert.equal(seen.size,2);
 for(const map of labels.values()) for(const runs of map.values()) for(const run of runs) assert(seen.has(treeLabelRunKey(run)));
 assert.notEqual(treeLabelMetricKey(steps,labels,()=>({...bounds(),x:-86})),first);
 assert.notEqual(treeLabelMetricKey(steps,labels,()=>({...bounds(),width:191})),first);
 let calls=0;const memo=()=>{calls++;return bounds();};treeLabelMetricKey(steps,labels,memo);treeLabelMetricKey(steps,labels,memo);assert.equal(calls,2);
});
test('exact descriptor assignments, generated suffixes, Unicode, and index order are part of the key',()=>{
 const {steps,first,second,labels,run}=fixture(),initial=treeLabelMetricKey(steps,labels,bounds);
 const swapped=new Map([[first,labels.get(second)],[second,labels.get(first)]]);
 assert.notEqual(treeLabelMetricKey(steps,swapped,bounds),initial);
 const changed=new Map(labels);changed.set(first,new Map([['n',[{...run,text:'Book₁'}]]]));
 assert.notEqual(treeLabelMetricKey(steps,changed,bounds),initial);
 const reversed=new Map(labels);reversed.set(first,new Map([['n',[{...run,indices:[...run.indices].reverse()}]]]));
 assert.notEqual(treeLabelMetricKey(steps,reversed,bounds),initial);
 assert.notEqual(treeLabelRunKey(terminal('é')),treeLabelRunKey(terminal('e\u0301')));
 assert.equal(treeLabelRunKey(run),treeLabelRunKey({indices:run.indices.map(i=>({mode:i.mode,text:i.text})),text:run.text,kind:run.kind}));
});
test('unprepared, unmeasured, unavailable, and measured runs stay distinct; signed zero is preserved',()=>{
 const {steps,labels}=fixture();
 assert.notEqual(treeLabelMetricKey(steps,undefined,bounds),treeLabelMetricKey(steps,labels));
 const unknown=treeLabelMetricKey(steps,labels,()=>undefined);
 assert.notEqual(unknown,treeLabelMetricKey(steps,labels));
 assert.equal(unknown,treeLabelMetricKey(steps,labels,()=>undefined));
 assert.notEqual(treeLabelMetricKey(steps,labels,()=>({...bounds(),x:0})),treeLabelMetricKey(steps,labels,()=>({...bounds(),x:-0})));
});

test('category line tspans and theta reset text have distinct measurement keys', () => {
 const wrapped={kind:'category',text:'AAABBB',lines:['AAA','BBB'],indices:[]};
 assert.notEqual(treeLabelRunKey(wrapped),treeLabelRunKey({...wrapped,lines:undefined}));
 assert.notEqual(treeLabelRunKey(wrapped),treeLabelRunKey({...wrapped,lines:['AA','ABBB']}));
});
