import test from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from '../node_modules/d3/src/index.js';
import { planCoherentWorkspace } from '../replay/workspaceCoherentPlan.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
function fixture({direction='ltr',deform=true,prefix='',material=false,kind='trajectory',key='1:0'}={}) {
  const id=x=>prefix+x;
  const source=()=>({id:id('source'),label:'XP',children:[{id:id('a'),label:'A'},{id:id('b'),label:'B'}]});
  const forest=children=>({id:id('forest'),label:'Workspace',replayOrigin:{kind:'workspace'},children});
  const source1=source(),source2=source(); if(material)source2.children[0].word='changed';
  const canvases=[forest([{id:id('old'),label:'OP',children:[source1]},{id:id('receiver'),label:'R'}]),forest([{id:id('old'),label:'OP',children:[{id:id('lower'),label:'t',silent:true}]},{id:id('receiver'),label:'R',children:[source2]}])];
  const points=[new Map([['old',[0,0]],['source',[0,400]],['a',[-400,800]],['b',[400,800]],['receiver',[3000,0]]]),new Map([['old',[0,0]],['lower',[0,400]],['receiver',[3000,0]],['source',[3000,400]],['a',[3000-(deform?650:400),deform?900:800]],['b',[3000+(deform?650:400),deform?900:800]]])].map(map=>new Map([...map].map(([key,[x,y]])=>[id(key),{x,y}])));
  const render=(scene,coords)=>{const h=d3.hierarchy(scene.canvas);applyVizIds(h);const visible=new Set(scene.step.replayVisibleNodeIds);return layoutSyntaxTree(h,scene.size,direction,coords,visible).descendants().filter(n=>visible.has(getNodeId(n)));};
  const scenes=canvases.map((canvas,index)=>{const h=d3.hierarchy(canvas);applyVizIds(h);const step={replayCanvasData:canvas,replayVisibleNodeIds:h.descendants().filter(n=>n.data.replayOrigin?.kind!=='workspace').map(getNodeId),replayKind:index?'relation':'micro',replayFrameIndex:index,replayStageStepIndex:0,operation:index?'owned displacement':'ExternalMerge',targetNodeId:id(index?'source':'old'),...(index?{replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:key,renderFamily:kind,priorSourceNodeId:id('source'),witnessNodeId:id('lower'),targetNodeId:id('source')}]}:{})};const scene={step,canvas,size:[6000,1600],coordinates:points[index],nodes:new Map()};scene.nodes=new Map(render(scene,points[index]).map(n=>[getNodeId(n),n]));return scene;});
  return {scenes,baseline:new Map(canvases.map((x,i)=>[x,points[i]])),render,direction,id};
}
for(const direction of ['ltr','rtl'])for(const prefix of ['','opaque/'])test(`owned complete subtree keeps internal contour (${direction}, ${prefix})`,()=>{
 const f=fixture({direction,prefix}),original=JSON.stringify(f.scenes.map(s=>s.canvas));const result=planCoherentWorkspace(f.scenes,f.baseline,direction,f.render);
 assert.equal(result.diagnostic.status,'resolved',JSON.stringify(result.diagnostic));assert.ok(result.diagnostic.reflows.some(x=>x.kind==='unchanged-subtree-shape'));
 const [a,b]=f.scenes.map(s=>new Map(f.render(s,result.coordinates.get(s.canvas)).map(n=>[getNodeId(n),n])));
 const ar=a.get(f.id('source')),br=b.get(f.id('source'));
 assert.ok(Math.hypot(ar.x-br.x,ar.y-br.y)>1,'actual displacement survives');
 for(const id of ['a','b']){const p=a.get(f.id(id)),q=b.get(f.id(id));assert.ok(Math.abs((p.x-ar.x)-(q.x-br.x))<1e-6);assert.ok(Math.abs((p.y-ar.y)-(q.y-br.y))<1e-6);}
 assert.equal(JSON.stringify(f.scenes.map(s=>s.canvas)),original);
});
for(const options of [{deform:false},{material:true}])test(`no owned complete-shape defect preserves accepted map ${JSON.stringify(options)}`,()=>{
 const f=fixture(options);const fail=()=>{throw Error('unnecessary metric work');};const result=planCoherentWorkspace(f.scenes,f.baseline,f.direction,f.render,{measureCategoryText:fail,measureTreeInk:fail,measureTreeLabel:fail});
 assert.equal(result.coordinates,f.baseline);assert.equal(result.diagnostic.status,'unchanged');assert.equal(result.diagnostic.evaluations,0);
});
test('exhausted backward clearance budget returns the accepted plan unchanged',()=>{
 const f=fixture(),labels=new Map();
 for(const [index,scene] of f.scenes.entries()){
  const runs=new Map();labels.set(scene.canvas,runs);
  for(let k=0;k<10;k++){
   const id=x=>`gap-${k}/${x}`,x=10000+k*3000;
   const branch={id:id('p'),label:'P',children:[{id:id('left'),label:index?'expanded':'L',children:[{id:id('word'),label:'W'}]},{id:id('right'),label:'R'}]};
   scene.canvas.children.push(branch);
   for(const [name,point] of [['p',{x,y:0}],['left',{x:x-180,y:400}],['right',{x:x+180,y:400}],['word',{x:x-180,y:800}]]){
    scene.step.replayVisibleNodeIds.push(id(name));scene.coordinates.set(id(name),point);
   }
   runs.set(id('left'),[{kind:'category',width:index?1000:80}]);
  }
  scene.nodes=new Map(f.render(scene,scene.coordinates).map(n=>[getNodeId(n),n]));
 }
 const prior=JSON.stringify([...f.baseline].map(([canvas,points])=>[canvas,[...points]]));
 const result=planCoherentWorkspace(f.scenes,f.baseline,f.direction,f.render,{treeLabelRuns:labels,measureTreeLabel:run=>({x:-run.width/2,y:-40,width:run.width,height:55})});
 assert.equal(result.diagnostic.status,'infeasible');assert.equal(result.diagnostic.corrections,8);assert.equal(result.coordinates,f.baseline);
 assert.equal(JSON.stringify([...f.baseline].map(([canvas,points])=>[canvas,[...points]])),prior);
});

for(const options of [{kind:'authored-anchor-link'},{key:'0:0'}])test(`unowned reparented shape is detected without granting motion ${JSON.stringify(options)}`,()=>{
 const f=fixture(options),result=planCoherentWorkspace(f.scenes,f.baseline,f.direction,f.render);
 assert.ok(result.diagnostic.reflows.some(x=>x.kind==='unchanged-subtree-shape'));
 if(result.diagnostic.status==='resolved'){
  const [a,b]=f.scenes.map(s=>new Map(f.render(s,result.coordinates.get(s.canvas)).map(n=>[getNodeId(n),n])));
  for(const id of ['source','a','b']){const p=a.get(f.id(id)),q=b.get(f.id(id));assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<1e-6);}
 }else assert.equal(result.coordinates,f.baseline);
});
