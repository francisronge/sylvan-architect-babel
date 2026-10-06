import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
import {reserveCompleteComponentLifetime} from '../replay/workspaceComponentLifetime.ts';
const leaf=id=>({id,label:id});
const branch=(id,children)=>({id,label:id,children});
function example({direction='ltr',oldBranch=false,wrongParent=false,sourceHost=false,unowned=false}={}) {
 const mover=()=>branch('mover',[leaf('word')]);
 const priorHost=oldBranch?branch('host',[leaf('oldHostChild')]):leaf('host');
 const first=branch('root',[wrongParent?branch('oldParent',[priorHost]):priorHost,mover()]);
 const after=()=>branch('root',[branch('host',[leaf('hostMember'),mover()]),leaf('lower')]);
 const canvases=[first,after(),branch('workspace',[after(),leaf('next')])],base=new Map();
 const scenes=canvases.map((canvas,index)=>{
  const root=d3.hierarchy(canvas);applyVizIds(root);
  const positions=new Map(root.descendants().map(node=>{
   const id=getNodeId(node);let x=id==='host'?(index?1000:500):id==='hostMember'?800:id==='mover'||id==='word'?(index?1200:2000):id==='lower'?2200:id==='next'?5000:1600;
   if(index===2)x+=40;
   return[id,{x:direction==='rtl'?6000-x:x,y:(node.depth-(index===2?1:0))*150}];
  }));base.set(canvas,positions);
  const nodes=new Map(root.descendants().filter(node=>getNodeId(node)!=='workspace').map(node=>{const p=positions.get(getNodeId(node));return[getNodeId(node),Object.assign(node,{x:direction==='rtl'?6000-p.x:p.x,y:p.y})];}));
  return{canvas,nodes,coordinates:positions,size:[6000,3000],step:index===1?{replayKind:'relation',replayRelationIdentity:unowned?undefined:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:unowned?undefined:'1:0',renderFamily:'trajectory',priorSourceNodeId:sourceHost?'host':'mover',witnessNodeId:'lower',targetNodeId:'mover'}]}:{replayKind:'micro',operation:'LexicalSelect',targetNodeId:'next'}};
 });
 const render=(scene,positions)=>{const root=d3.hierarchy(scene.canvas);applyVizIds(root);return root.descendants().filter(node=>scene.nodes.has(getNodeId(node))).map(node=>{const p=positions.get(getNodeId(node));return Object.assign(node,{x:direction==='rtl'?6000-p.x:p.x,y:p.y});});};
 const result=reserveCompleteComponentLifetime(scenes,base,direction,2,'root',render, { throughRelations: true });
 return{old:base.get(first),before:result.get(first),after:result.get(canvases[1])};
}
for(const direction of ['ltr','rtl']) test(`${direction}: an atomic host keeps its own slot before the owning compound formation`,()=>{
 const {before,after}=example({direction});
 assert.deepEqual(before.get('host'),after.get('host'));
 assert.notDeepEqual(before.get('host'),after.get('hostMember'),'the new inner member does not supply the prior host slot');
});
for(const [name,options] of [['already branched host',{oldBranch:true}],['different parent',{wrongParent:true}],['unowned relation',{unowned:true}]]) test(`${name} cannot claim the atomic-host reservation`,()=>{
 const {old,before}=example(options);assert.deepEqual(before.get('host'),old.get('host'));
});
test('the actual moving source cannot also be the unchanged atomic host',()=>{
 const {before,after}=example({sourceHost:true});
 assert.notDeepEqual(before.get('host'),after.get('host'));
 assert.deepEqual(before.get('host'),after.get('lower'));
});
