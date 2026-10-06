import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
import {reserveCompleteComponentLifetime} from '../replay/workspaceComponentLifetime.ts';
const atom=(id,label=id)=>({id,label});
const branch=(id,children)=>({id,label:id,children});
const verb=(id,silent=false)=>({id,label:'V',word:silent?'t':'give',silent,children:[{id:id+'Word',label:silent?'t':'give',word:silent?'t':'give',silent}]});
function example({direction='ltr',reverse=false,stale=false,oldBranch=false,wrongParent=false}={}) {
 const h1old=oldBranch?branch('h1',[atom('prior')]):atom('h1');
 const canvases=[
  branch('root',[wrongParent?branch('different',[h1old]):h1old,verb('v'),atom('h2')]),
  branch('root',[branch('h1',[atom('member1'),verb('v1')]),verb('v',true),atom('h2')]),
  branch('root',[branch('h1',[atom('member1'),verb('v1',true)]),verb('v',true),branch('h2',[atom('member2'),verb('v2')])]),
  branch('workspace',[branch('root',[branch('h1',[atom('member1'),verb('v1',true)]),verb('v',true),branch('h2',[atom('member2'),verb('v2')])]),atom('new')])
 ];
 const bases=[{h1:300,v:3000,vWord:3000,h2:4200},{member1:1000,v1:1800,v1Word:1800,v:3000,vWord:3000,h2:4200},{member1:1000,v1:1700,v1Word:1700,v:3000,vWord:3000,member2:3900,v2:4500,v2Word:4500},{member1:1200,v1:1900,v1Word:1900,v:3200,vWord:3200,member2:4100,v2:4700,v2Word:4700,new:6000}];
 const base=new Map();
 const render=(scene,positions)=>{
  const root=d3.hierarchy(scene.canvas);applyVizIds(root);
  root.each(n=>{const p=positions.get(getNodeId(n));n.x=direction==='rtl'?7000-p.x:p.x;n.y=p.y;});
  root.eachAfter(n=>{if(n.children?.length)n.x=(n.children[0].x+n.children.at(-1).x)/2;});
  const visible=root.descendants().filter(n=>getNodeId(n)!=='workspace');return reverse?visible.reverse():visible;
 };
 const scenes=canvases.map((canvas,i)=>{
  const tree=d3.hierarchy(canvas);applyVizIds(tree);const coordinates=new Map(tree.descendants().map(n=>{const id=getNodeId(n),x=bases[i][id]??200;return[id,{x:direction==='rtl'?7000-x:x,y:(n.depth-(i===3?1:0))*200}];}));base.set(canvas,coordinates);
  const step=i===1||i===2?{replayKind:'relation',replayRelationIdentity:{stageIndex:i,relationIndex:0},replayRelationLinks:[{authoredRelationKey:stale&&i===1?'0:0':`${i}:0`,renderFamily:'trajectory',priorSourceNodeId:i===1?'v':'v1',witnessNodeId:i===1?'v':'v1',targetNodeId:i===1?'v1':'v2'}]}:{replayKind:'micro',operation:'LexicalSelect',targetNodeId:'new'};
  const scene={canvas,size:[7000,3000],step,coordinates};scene.nodes=new Map(render(scene,coordinates).map(n=>[getNodeId(n),n]));return scene;
 });
 const before=JSON.stringify([...base].map(([c,p])=>[c,[...p]]));
 const result=reserveCompleteComponentLifetime(scenes,base,direction,3,'root',render,{throughRelations:true});
 assert.equal(JSON.stringify([...base].map(([c,p])=>[c,[...p]])),before);
 const points=scenes.map(s=>new Map(render(s,result.get(s.canvas)).map(n=>[getNodeId(n),{x:n.x,y:n.y}])));
 return{points,initial:scenes.map(s=>new Map(render(s,base.get(s.canvas)).map(n=>[getNodeId(n),{x:n.x,y:n.y}])))};
}
for(const direction of ['ltr','rtl']) test(`${direction}: an earlier atomic receiver follows its recursively restored landing's complete entry pose`,()=>{
 const {points,initial}=example({direction});
 assert.deepEqual(points[0].get('h1'),points[1].get('h1'));
 assert.notDeepEqual(points[0].get('h1'),initial[0].get('h1'));
 assert.deepEqual(points[3],initial[3],'completed geometry stays exact');
 assert.deepEqual(example({direction,reverse:true}).points,points,'iteration order does not choose the host slot');
});
for(const option of ['stale','oldBranch','wrongParent']) for(const direction of ['ltr','rtl']) test(`${direction}: ${option} cannot acquire a recursive atomic host pose`,()=>{
 const {points,initial}=example({direction,[option]:true});assert.deepEqual(points[0].get('h1'),initial[0].get('h1'));
});
