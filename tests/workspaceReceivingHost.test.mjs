import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
import {reserveCompleteComponentLifetime} from '../replay/workspaceComponentLifetime.ts';
const leaf=id=>({id,label:id});
const branch=(id,children)=>({id,label:id,children});
function example(direction, {silentChange=false, pronounced=false, wrongParent=false, stale=false, family='trajectory', changedChild=false, reordered=false, extra=false, missing=false, relabelled=false}={}) {
 const mover=()=>branch('mover',[leaf('word')]);
 const host=()=>branch('host',[leaf('featureA'),leaf('featureB')]);
 const old=host(); if(silentChange)old.silent=true;if(pronounced)old.word='aux';
 const first=branch('root',[wrongParent?branch('oldParent',[old]):old,mover()]);
 const after=()=>{
  const current=host();if(pronounced)current.word='aux';if(relabelled)current.label='different';
  if(changedChild)current.children[0].label='changed feature';
  if(reordered)current.children.reverse();if(missing)current.children.pop();
  current.children.unshift(mover());if(extra)current.children.push(leaf('unrelated'));
  return branch('root',[current,leaf('lower')]);
 };
 const canvases=[first,after(),after()],base=new Map();
 const scenes=canvases.map((canvas,index)=>{
  const root=d3.hierarchy(canvas);applyVizIds(root);
  const positions=new Map(root.descendants().map(node=>{
   const id=getNodeId(node),future=index>0;
   const x=id==='host'?3000:id==='featureA'?2800:id==='featureB'?3200:id==='mover'||id==='word'?(future?2500:500):id==='lower'?600:1800;
   const y=id==='host'?(future?800:150):id.startsWith('feature')?(future?1000:300):id==='mover'?(future?1000:150):id==='word'?(future?1400:300):id==='lower'?300:0;
   return[id,{x:direction==='rtl'?6000-x:x,y}];
  }));base.set(canvas,positions);
  const nodes=new Map(root.descendants().map(node=>{const p=positions.get(getNodeId(node));return[getNodeId(node),Object.assign(node,{x:direction==='rtl'?6000-p.x:p.x,y:p.y})];}));
  const step=index===1?{replayKind:'relation',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:stale?'0:0':'1:0',renderFamily:family,priorSourceNodeId:'mover',witnessNodeId:'lower',targetNodeId:'mover'}]}:{replayKind:'relation'};
  return{canvas,nodes,coordinates:positions,size:[6000,2000],step};
 });
 const cache=new Map(),saved=[];
 const render=(scene,positions)=>{let plans=cache.get(scene);if(!plans)cache.set(scene,plans=new Map());if(plans.has(positions))return plans.get(positions);const root=d3.hierarchy(scene.canvas);applyVizIds(root);const nodes=root.descendants().map(node=>{const p=positions.get(getNodeId(node));return Object.assign(node,{x:direction==='rtl'?6000-p.x:p.x,y:p.y});});plans.set(positions,nodes);saved.push([nodes,nodes.map(n=>[getNodeId(n),n.x,n.y])]);return nodes;};
 const authored=JSON.stringify(canvases),initial=JSON.stringify([...base].map(([c,p])=>[c,[...p]]));
 const result=reserveCompleteComponentLifetime(scenes,base,direction,2,'root',render,{throughRelations:true});
 assert.equal(JSON.stringify(canvases),authored);assert.equal(JSON.stringify([...base].map(([c,p])=>[c,[...p]])),initial);
 for(const [nodes,points]of saved)assert.deepEqual(nodes.map(n=>[getNodeId(n),n.x,n.y]),points);
 for(const canvas of canvases.slice(1))assert.deepEqual([...result.get(canvas)],[...base.get(canvas)]);
 return {before:result.get(first),after:result.get(canvases[1]),first};
}
for(const direction of ['ltr','rtl']) {
 for(const silentChange of [false,true])test(`${direction}: a receiver keeps its retained feature branches before the actual landing${silentChange?' changes wordless silence':''}`,()=>{
  const{before,after,first}=example(direction,{silentChange});
  for(const id of ['host','featureA','featureB'])assert.deepEqual(before.get(id),after.get(id));
  assert.deepEqual(first.children[0].children.map(n=>n.id),['featureA','featureB']);
  assert.equal(first.children[0].silent,silentChange?true:undefined);
 });
 for(const[name,options]of [['different ownership',{wrongParent:true}],['stale relation',{stale:true}],['nonmovement relation',{family:'association'}],['changed retained material',{changedChild:true}],['reordered retained children',{reordered:true}],['unrelated extra branch',{extra:true}],['removed retained child',{missing:true}],['relabelled receiver',{relabelled:true}],['changed pronunciation of a word-bearing receiver',{silentChange:true,pronounced:true}]])test(`${direction}: ${name} cannot reserve an additive receiving host`,()=>{
  const{before}=example(direction,options);assert.equal(before.get('host').y,150);
 });
}
