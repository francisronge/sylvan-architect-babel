import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
import {reserveCompleteComponentLifetime} from '../replay/workspaceComponentLifetime.ts';

function example({sourceIndependent=false,direction='ltr'}={}) {
 const source = () => ({id:'oldSource',label:'full source',children:[{id:'oldWord',label:sourceIndependent?'word':'a deliberately wide full source word',word:sourceIndependent?'word':'a deliberately wide full source word'}]});
 const witness = () => ({id:'lower',label:'t',silent:true});
 const peer = () => ({id:'peer',label:'P',children:[{id:'peerWord',label:'peer',word:'peer'}]});
 const current = () => ({id:'current',label:'X',children:[source(),peer()]});
 const later = () => ({id:'current',label:'X',children:[witness(),peer()]});
 const forest = children => ({id:'workspace',label:'',children});
 const canvases=sourceIndependent ? [forest([source(),peer()]),forest([witness(),peer()]),forest([witness(),peer(),{id:'next',label:'N'}])] : [forest([current(),{id:'separate',label:'other'}]),forest([later(),{id:'separate',label:'other'}]),forest([later(),{id:'separate',label:'other'},{id:'next',label:'N'}])];
 if(sourceIndependent) {
  for(const canvas of canvases) canvas.children.push({id:'separate',label:'other'});
  canvases.push(forest([{id:'attached',label:'P',children:[witness(),{id:'laterChild',label:'X'}]},peer(),{id:'separate',label:'other'},{id:'next',label:'N'}]));
 }
 const base=new Map();
 const scenes=canvases.map((canvas,index)=>{
  const root=d3.hierarchy(canvas);applyVizIds(root);
  const coordinates=new Map(root.descendants().map(node=>{
   const id=getNodeId(node);
   const x=id==='current'?600:id==='oldSource'||id==='oldWord'||id==='lower'?400:id==='peer'||id==='peerWord'?800:id==='separate'?(sourceIndependent?1200:3000):id==='attached'?1200:id==='laterChild'?2000:5000;
   const y=id==='oldWord'||id==='peerWord'||index===3&&['lower','laterChild'].includes(id)?500:id==='current'?100:300;
   return [id,{x:direction==='rtl'?8000-x:x,y}];
  }));
  base.set(canvas,coordinates);
  const nodes=new Map(root.descendants().filter(node=>getNodeId(node)!=='workspace').map(node=>[getNodeId(node),Object.assign(node,{x:direction==='rtl'?8000-coordinates.get(getNodeId(node)).x:coordinates.get(getNodeId(node)).x,y:coordinates.get(getNodeId(node)).y})]));
  const step=index===1?{replayKind:'relation',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:'1:0',renderFamily:'trajectory',priorSourceNodeId:'oldSource',witnessNodeId:'lower',targetNodeId:'landing'}]}:{replayKind:'micro',operation:'LexicalSelect',targetNodeId:'next'};
  return{canvas,nodes,coordinates,size:[8000,2000],step};
 });
 const render=(scene,coordinates)=>{
  const root=d3.hierarchy(scene.canvas);applyVizIds(root);
  return root.descendants().filter(node=>scene.nodes.has(getNodeId(node))).map(node=>{
   const p=coordinates.get(getNodeId(node));return Object.assign(node,{x:direction==='rtl'?8000-p.x:p.x,y:p.y});
  });
 };
 const result=reserveCompleteComponentLifetime(scenes,base,direction,2,sourceIndependent?'lower':'current',render, { throughRelations: true });
 return{result,base,canvases};
}
for(const direction of ['ltr','rtl']) test(`${direction}: clearance does not split a preceding full source from its current component`,()=>{
 const {result,base,canvases}=example({direction});
 const actual=result.get(canvases[0]),initial=base.get(canvases[0]);
 const shift=actual.get('current').x-initial.get('current').x;
 for(const id of ['oldSource','oldWord','peer','peerWord']) assert.equal(actual.get(id).x-initial.get(id).x,shift,`${id} remains in the same rigid current component`);
 assert.deepEqual(actual.get('separate'),initial.get('separate'),'an invisible workspace parent does not join separate syntax');
});

for(const direction of ['ltr','rtl']) test(`${direction}: source-only IDs remain owned before they join the final component`,()=>{
 const {result,base,canvases}=example({sourceIndependent:true,direction});
 const sourceShift=result.get(canvases[0]).get('oldSource').x-base.get(canvases[0]).get('oldSource').x;
 const lowerShift=result.get(canvases[2]).get('lower').x-base.get(canvases[2]).get('lower').x;
 assert.notEqual(lowerShift,0,'later attachment needs clearance');
 assert.equal(sourceShift,lowerShift,'prior source with no surviving IDs belongs to the same reserved lifetime');
 assert.equal(result.get(canvases[0]).get('oldWord').x-base.get(canvases[0]).get('oldWord').x,sourceShift,'full prior source remains rigid');
 assert.deepEqual(result.get(canvases[0]).get('peer'),base.get(canvases[0]).get('peer'),'invisible forest parent does not absorb an independent component');
});
