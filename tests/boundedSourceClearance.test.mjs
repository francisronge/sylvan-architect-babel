import assert from 'node:assert/strict';import test from 'node:test';
import * as d3 from 'd3';
import {applyVizIds,getNodeId}from '../replay/displayIdentity.ts';
import {reserveCompleteComponentLifetime}from '../replay/workspaceComponentLifetime.ts';
function example(direction,{material=false,unownedWrapper=false,ownMerge=true}={}){
 const branch=(id,children)=>({id,label:id,children});const part=(id,changed=false)=>branch(id,[{id:id+'Word',label:changed?'changed':id,word:changed?'changed':id}]);
 const a=()=>part('a'), b=(change=false)=>part('b',change),forest=()=>branch('workspace',[a(),b()]);
 const joined=(changed=false)=>branch('phrase',[a(),b(changed)]);
 const semantic=unownedWrapper?branch('extra',[joined()]):joined(material);
 const landed=branch('landing',[a(),b(material)]);
 const canvases=[a(),forest(),forest(),joined(),semantic,landed];
 const base=new Map();const scenes=canvases.map((canvas,index)=>{
  const root=d3.hierarchy(canvas);applyVizIds(root);const coordinates=new Map(root.descendants().map(n=>{
   const id=getNodeId(n);let x=id.startsWith('a')?(index<2?0:500):id.startsWith('b')?(index<2?500:1000):750;let y=id.endsWith('Word')?300:id==='a'||id==='b'?100:-100;return[id,{x,y}];
  }));base.set(canvas,coordinates);const nodes=new Map(root.descendants().filter(n=>getNodeId(n)!=='workspace').map(n=>[getNodeId(n),Object.assign(n,{...coordinates.get(getNodeId(n)),x:direction==='rtl'?2000-coordinates.get(getNodeId(n)).x:coordinates.get(getNodeId(n)).x})]));
  const step=index===3?{replayKind:ownMerge?'micro':'relation',operation:ownMerge?'ExternalMerge':'semantic attachment',targetNodeId:'phrase'}:index===4?{replayKind:'relation',operation:'PFRealization',replayRelationIdentity:{stageIndex:2,relationIndex:1},replayRelationLinks:[{authoredRelationKey:'2:0',renderFamily:'trajectory',priorSourceNodeId:'phrase'}]}:index===5?{replayKind:'relation',operation:'InternalMerge',replayRelationIdentity:{stageIndex:3,relationIndex:0},replayRelationLinks:[{authoredRelationKey:'3:0',renderFamily:'trajectory',priorSourceNodeId:'phrase',targetNodeId:'landing'}]}:{replayKind:'micro',operation:index?'LexicalSelect':'Project',targetNodeId:index?'b':'a'};
  return{canvas,nodes,coordinates,size:[2000,1000],step};
 });
 const render=(scene,coordinates)=>{const root=d3.hierarchy(scene.canvas);applyVizIds(root);return root.descendants().filter(n=>scene.nodes.has(getNodeId(n))).map(n=>Object.assign(n,{...coordinates.get(getNodeId(n)),x:direction==='rtl'?2000-coordinates.get(getNodeId(n)).x:coordinates.get(getNodeId(n)).x}));};
 const saved=JSON.stringify([...base].map(([c,p])=>[c,[...p]]));const output=reserveCompleteComponentLifetime(scenes,base,direction,2,'a',render, { throughRelations: true, carryUntilMovement: true });
 const delta=i=>output.get(canvases[i]).get('b').x-base.get(canvases[i]).get('b').x;
 assert.equal(JSON.stringify([...base].map(([c,p])=>[c,[...p]])),saved);
 return{delta,output,base,canvases};
}
for(const direction of ['ltr','rtl']){
 test(direction+': exact merge carries clearance to the containing source movement',()=>{const {delta}=example(direction);assert(Math.abs(delta(1))>1);assert.equal(delta(3),delta(1));assert.equal(delta(4),delta(3),'a stale earlier trajectory on PF does not release clearance');assert.equal(delta(5),0,'only exact current movement releases it');});
 test(direction+': changed material ends the selected-source contour',()=>{const {delta}=example(direction,{material:true});assert(Math.abs(delta(3))>1);assert.equal(delta(4),0);});
 test(direction+': an unowned wrapper still ends selected-source ownership',()=>{const {delta}=example(direction,{unownedWrapper:true});assert(Math.abs(delta(3))>1);assert.equal(delta(4),0);});
 test(direction+': semantic attachment cannot use the structural-merge allowance',()=>{const {delta}=example(direction,{ownMerge:false});assert(Math.abs(delta(1))>1);assert.equal(delta(3),0);});
}
