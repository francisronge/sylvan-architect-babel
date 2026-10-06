import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
import {reserveCompleteComponentLifetime} from '../replay/workspaceComponentLifetime.ts';
const leaf=id=>({id,label:id});
const branch=(id,children)=>({id,label:id,children});
const mover=()=>branch('mover',[leaf('word')]);
function example({ambiguous=false,differentParent=false,existingWrapper=false,unrelatedWrapper=false}={}){
 const host=()=>branch('host',[leaf('hostWord')]);
 const oldHost=existingWrapper?branch('wrapper',[host()]):host();
 const before=branch('root',[branch('core',[...(differentParent?[]:[oldHost]),...(ambiguous?[leaf('secondHost')]:[]),mover()])]);
 if(differentParent)before.children.push(branch('oldHostParent',[host()]));
 if(unrelatedWrapper)before.children.push(branch('peer',[leaf('peerWord')]));
 const after=()=>branch('root',[branch('core',[branch('wrapper',[host(),...(ambiguous?[leaf('secondHost')]:[]),mover()]),{...leaf('lower'),silent:true}]),...(unrelatedWrapper?[branch('unrelated',[branch('peer',[leaf('peerWord')])])]:[])]);
 const first=after(),final=after(),canvases=[before,first,branch('workspace',[final,leaf('next')])];
 const base=new Map();
 const scenes=canvases.map((canvas,index)=>{
  const root=d3.hierarchy(canvas);applyVizIds(root);
  const offset=index===2?1:0;
  const reservation=new Map(root.descendants().map(node=>{const id=getNodeId(node);const x=id==='lower'?2200:id==='mover'||id==='word'?(index?1200:2000):id==='wrapper'?1000:id.startsWith('host')?(index?800:500):id==='secondHost'?650:id.startsWith('peer')?4500:id==='next'?7000:1800;return[id,{x:x+(index===2?40:0),y:(node.depth-offset)*150}];}));
  base.set(canvas,reservation);
  const nodes=new Map(root.descendants().filter(n=>getNodeId(n)!=='workspace').map(n=>[getNodeId(n),Object.assign(n,reservation.get(getNodeId(n)))]));
  const step=index===1?{replayKind:'relation',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:'1:0',renderFamily:'trajectory',priorSourceNodeId:'mover',witnessNodeId:'lower',targetNodeId:'mover'}]}:{replayKind:'micro',operation:index===2?'LexicalSelect':'ExternalMerge',targetNodeId:index===2?'next':'root'};
  return{canvas,nodes,coordinates:reservation,size:[8000,4000],step};
 });
 const render=(scene,positions)=>{const root=d3.hierarchy(scene.canvas);applyVizIds(root);return root.descendants().filter(n=>scene.nodes.has(getNodeId(n))).map(n=>Object.assign(n,positions.get(getNodeId(n))));};
 const saved=JSON.stringify([...base].map(([canvas,p])=>[canvas,[...p]]));
 const result=reserveCompleteComponentLifetime(scenes,base,'ltr',2,'root',render, { throughRelations: true });
 assert.equal(JSON.stringify([...base].map(([canvas,p])=>[canvas,[...p]])),saved,'authored shape and base coordinates are immutable');
 return {before:result.get(before),after:result.get(first),old:base.get(before)};
}

test('the full prior mover follows its lower occurrence, not the reused landing IDs',()=>{
 const {before,after}=example();
 assert.equal(before.get('mover').x,after.get('lower').x);
 assert.equal(before.get('word').x,after.get('lower').x);
 assert.notEqual(before.get('word').x,after.get('word').x,'the word does not arrive before its movement');
});
test('the exact preceding host occupies its new compound wrapper slot until the owning movement',()=>{
 const {before,after}=example();
 assert.deepEqual(before.get('host'),after.get('wrapper'));
 assert.equal(before.get('hostWord').x,before.get('host').x);
 assert.equal(before.get('hostWord').y-before.get('host').y,150);
 assert.notDeepEqual(before.get('host'),after.get('host'),'the inner future host coordinate is not borrowed early');
});
test('two prior hosts cannot both claim one new wrapper slot',()=>{
 const {before,old}=example({ambiguous:true});
 assert.equal(before.get('host').x,old.get('host').x);
 assert.equal(before.get('secondHost').x,old.get('secondHost').x);
});
test('a host from a different prior parent cannot claim the wrapper slot',()=>{
 const {before,after}=example({differentParent:true});
 assert.notDeepEqual(before.get('host'),after.get('wrapper'));
});
test('an unrelated new wrapper cannot relocate its prior branch through this movement',()=>{
 const {before,old}=example({unrelatedWrapper:true});
 assert.deepEqual(before.get('peer'),old.get('peer'));
});
test('an already present wrapper does not collapse its host to the wrapper root',()=>{
 const {before,after}=example({existingWrapper:true});
 assert.notDeepEqual(before.get('host'),after.get('wrapper'));
 assert.equal(before.get('hostWord').y-before.get('host').y,150);
});

for (const staleIdentity of [false, true]) test(`a structural merge ignores ${staleIdentity ? 'a stale relation identity' : 'an unowned trajectory without identity'}`, () => {
 const a=()=>branch('staticA',[leaf('wordA')]),b=()=>branch('staticB',[leaf('wordB')]);
 const before=branch('workspace',[a(),b()]);
 const merged=()=>branch('merged',[a(),b()]);
 const canvases=[before,merged(),branch('workspace',[merged(),leaf('next')])];
 const base=new Map();
 const scenes=canvases.map((canvas,index)=>{
  const root=d3.hierarchy(canvas);applyVizIds(root);
  const positions=new Map(root.descendants().map(node=>{
   const id=getNodeId(node);
   const isA=id==='staticA'||id==='wordA';
   const x=id==='next'?7000:id==='merged'?2000:isA?(index?1000:300):3000;
   const y=id.startsWith('word')?450:id==='merged'?150:300;
   return[id,{x,y}];
  }));
  base.set(canvas,positions);
  const nodes=new Map(root.descendants().filter(node=>getNodeId(node)!=='workspace').map(node=>[getNodeId(node),Object.assign(node,positions.get(getNodeId(node)))]));
  const step={replayKind:'micro',operation:index===1?'ExternalMerge':'LexicalSelect',targetNodeId:index===1?'merged':'next',
   ...(index===1?{replayRelationIdentity:staleIdentity?{stageIndex:1,relationIndex:0}:undefined,replayRelationLinks:[{
    authoredRelationKey:staleIdentity?'1:0':undefined,renderFamily:'trajectory',priorSourceNodeId:'staticA',witnessNodeId:'staticA',targetNodeId:'staticB'
   }]}:{})};
  return{canvas,nodes,coordinates:positions,size:[8000,4000],step};
 });
 const render=(scene,positions)=>{
  const root=d3.hierarchy(scene.canvas);applyVizIds(root);
  return root.descendants().filter(node=>scene.nodes.has(getNodeId(node))).map(node=>Object.assign(node,positions.get(getNodeId(node))));
 };
 const result=reserveCompleteComponentLifetime(scenes,base,'ltr',2,'merged',render, { throughRelations: true });
 for(const id of ['staticA','wordA','staticB','wordB']) assert.deepEqual(result.get(before).get(id),result.get(canvases[1]).get(id),`${id} is ordinary merge material, not an owned mover`);
});
