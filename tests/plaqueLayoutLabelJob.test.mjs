import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createTreeLabelMeasure } from '../components/treeLabelMeasure.ts';
import { buildReplayPlaqueSchedule } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { measurePlaqueLayoutJob, runPlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { treeLabelRunKey } from '../replay/treeLabelRuns.ts';
import { fallbackPlaqueTextMeasure } from '../replay/relations/plaqueTextLayout.ts';
const measure=run=>run.kind==='category'?{x:-45,y:-48,width:90,height:48}:{x:-105,y:67,width:215,height:90};
function inputFor(measureTreeLabel=measure) {
 const canvas={id:'root',label:'TP',children:[{id:'n',label:'N',word:'Book₁₀'},{id:'v',label:'V',word:'arrive'}]};
 const labels=new Map([[canvas,new Map([
  ['root',[{kind:'category',text:'TP',lines:['TP'],indices:[]}]],
  ['n',[{kind:'category',text:'N',lines:['N'],indices:[]},{kind:'terminal',text:'Book₁₀',indices:[{text:'作者𝒾',mode:'identity'},{text:'θ₂',mode:'theta'}]}]],
  ['v',[{kind:'category',text:'V',lines:['V'],indices:[]},{kind:'terminal',text:'arrive',indices:[]}]]
 ])]]);
 return {steps:[{replayCanvasData:canvas,replayFrameIndex:0,replayKind:'macro',replayStageStepIndex:0,replayVisibleNodeIds:['root','n','v']}],
  stageIndex:0,completedCanvas:canvas,plan:{frames:[{items:[{kind:'node-plaque',plaqueStyle:'theta-grid',anchorNodeIds:['v'],rows:[],
   thetaRoles:[{label:'Agent',index:'θ₂',nodeId:'n'}],relationRef:{stageIndex:0,relationIndex:0}}]}]},width:900,height:600,
  measureCategoryText:text=>[...text].length*21,measurePlaqueText:fallbackPlaqueTextMeasure,treeLabelRuns:labels,measureTreeLabel};
}
function capture(input) {const iterator=measurePlaqueLayoutJob(input);let next=iterator.next();while(!next.done)next=iterator.next();return structuredClone(next.value);}

test('styled measurement excludes unused legacy probes even for unavailable bounds or absent descriptors',()=>{
 for(const styled of [measure,()=>undefined,()=>({x:NaN,y:0,width:10,height:20})])for(const descriptors of [true,false]){
  const input=inputFor(styled);
  if(!descriptors)delete input.treeLabelRuns;
  input.measureTreeInk=()=>assert.fail('styled geometry never consumes legacy envelopes');
  const job=capture(input);
  assert.equal(job.treeInk,undefined);
  assert(job.treeLabels instanceof Map);
  const expected=buildReplayPlaqueSchedule({...input,measureTreeInk:undefined});
  assert.deepEqual(runPlaqueLayoutJob(job).schedule,expected);
 }
});

test('legacy probes remain available without styled measurement and unused callback changes still invalidate collection',()=>{
 const legacy=inputFor();delete legacy.measureTreeLabel;
 let probes=0;legacy.measureTreeInk=()=>{probes++;return undefined;};
 const job=capture(legacy);assert(probes>0);assert(job.treeInk.size>0);
 const styled=inputFor();styled.measureTreeInk=()=>assert.fail('unused probe');
 const iterator=measurePlaqueLayoutJob(styled);assert.equal(iterator.next().done,false);
 styled.measureTreeInk=()=>undefined;
 assert.throws(()=>iterator.next(),/input changed during measurement/);
});

test('styled label collection fills warm cache hits and preserves shared canvas keys across actual workers',async()=>{
 const input=inputFor(),expected=buildReplayPlaqueSchedule(input),job=capture(input);
 assert(job.input.treeLabelRuns.has(job.input.steps[0].replayCanvasData),'structured clone preserves descriptor-to-canvas identity');
 assert.equal('measureTreeLabel' in job.input,false);assert(job.treeLabels.size>0);
 for(const nodes of job.input.treeLabelRuns.values())for(const runs of nodes.values())for(const run of runs)assert(job.treeLabels.has(treeLabelRunKey(run)));
 assert.deepEqual(runPlaqueLayoutJob(job).schedule,expected);
 const worker=new Worker(new URL('./support/plaqueLayoutWorkerBridge.mjs',import.meta.url));
 try {const response=once(worker,'message');worker.postMessage(job);assert.deepEqual((await response)[0].result.schedule,expected);}
 finally{await worker.terminate();}
 job.treeLabels.delete(job.treeLabels.keys().next().value);
 assert.throws(()=>runPlaqueLayoutJob(job).schedule,/Missing measured text/);
});
test('a reported unavailable mixed run survives serialization, while an uncaptured request is an error',()=>{
 const input=inputFor(()=>undefined),expected=buildReplayPlaqueSchedule(input),job=capture(input);
 assert(job.treeLabels.size>0);assert([...job.treeLabels.values()].every(value=>value===undefined));
 assert.deepEqual(runPlaqueLayoutJob(job).schedule,expected);job.treeLabels=new Map();
 assert.throws(()=>runPlaqueLayoutJob(job).schedule,/Missing measured text/);
});
test('older jobs without styled measurement retain their existing contract',()=>{
 const input=inputFor();delete input.measureTreeLabel;delete input.treeLabelRuns;const job=capture(input);
 assert.equal('treeLabels' in job,false);assert.deepEqual(runPlaqueLayoutJob(job).schedule,buildReplayPlaqueSchedule(input));
});
test('exact mixed-run values and descriptor assignments participate in the coordinate cache',()=>{
 const input=inputFor(),size=[600,500],canvas=input.steps[0].replayCanvasData;
 const plan=(labels,fn)=>buildStageCoordinateReservations(input.steps,0,size,()=>size,'ltr',input.measureCategoryText,undefined,labels,fn).get(canvas);
 const first=plan(input.treeLabelRuns,measure),captured=new Map();
 assert.equal(plan(input.treeLabelRuns,run=>{captured.set(treeLabelRunKey(run),measure(run));return measure(run);}),first);
 assert(captured.size>0);
 assert.notEqual(plan(input.treeLabelRuns,run=>({...measure(run),width:measure(run).width+1})),first);
 const changed=new Map([[canvas,new Map(input.treeLabelRuns.get(canvas))]]);
 changed.get(canvas).set('n',[{kind:'terminal',text:'Book₁',indices:[]}]);
 assert.notEqual(plan(changed,measure),first);
});


test('plain glyph bounds for exact displayed text are captured before worker execution',async()=>{
 const glyphRequests=[];
 class Element {
  constructor(tag){this.tag=tag;this.style={};this.children=[];this.textContent='';this.attributes={};}
  setAttribute(key,value){this.attributes[key]=value;}
  appendChild(child){this.children.push(child);return child;}
  remove(){}
  getBBox(){return this.attributes.y==='115'?{x:-110,y:59,width:220,height:70}:{x:-50,y:-52,width:100,height:53};}
 }
 const context={measureText(text){glyphRequests.push([text,this.font]);return {width:110,actualBoundingBoxLeft:0,actualBoundingBoxRight:110,
  actualBoundingBoxAscent:text==='Book₁₀'?44:30,actualBoundingBoxDescent:text==='Book₁₀'?19:0,
  fontBoundingBoxAscent:56,fontBoundingBoxDescent:14};}};
 const doc={createElement:()=>({getContext:()=>context}),createElementNS:(_,tag)=>new Element(tag),body:{appendChild(){}}};
 const input=inputFor(createTreeLabelMeasure(doc)),canvas=input.steps[0].replayCanvasData;
 canvas.children[0].word='Book';
 const run={kind:'terminal',text:'Book₁₀',indices:[]};
 input.treeLabelRuns.get(canvas).set('n',[{kind:'category',text:'N',lines:['N'],indices:[]},run]);
 const expected=buildReplayPlaqueSchedule(input),job=capture(input);
 assert(glyphRequests.some(([text,font])=>text==='Book₁₀'&&font==='italic 900 56px Quicksand, sans-serif'));
 assert(!glyphRequests.some(([text])=>text==='Book'),'the raw node word cannot replace the displayed string');
 assert.deepEqual(job.treeLabels.get(treeLabelRunKey(run)),{x:-126,y:55,width:252,height:95});
 assert.equal(job.treeInk,undefined,'worker consumes the complete measured label bounds, not an uncollected DOM request');
 assert.deepEqual(runPlaqueLayoutJob(job).schedule,expected);
 const worker=new Worker(new URL('./support/plaqueLayoutWorkerBridge.mjs',import.meta.url));
 try {const response=once(worker,'message');worker.postMessage(job);assert.deepEqual((await response)[0].result.schedule,expected);}
 finally {await worker.terminate();}
});
