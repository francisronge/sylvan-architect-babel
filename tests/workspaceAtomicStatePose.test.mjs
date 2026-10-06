import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
import {reserveCompleteComponentLifetime} from '../replay/workspaceComponentLifetime.ts';
const atom=(id,extra={})=>({id,label:id,...extra});
const branch=(id,children)=>({id,label:id,children});
function example({direction='ltr',changedLabel=false,word=false,branched=false,mover=false}={}){
 const oldAtom=atom('head',{silent:true,...(word?{word:'pronounced'}:{})});
 const currentAtom=()=>atom('head',{...(changedLabel?{label:'different'}:{}),...(word?{word:'pronounced'}:{}),...(branched?{children:[atom('newChild')]}:{})});
 const prior=branch('root',[oldAtom,atom('peer')]);
 const current=()=>branch('root',[currentAtom(),atom('peer')]);
 const canvases=[prior,current(),branch('workspace',[current(),atom('selected')])],base=new Map();
 const scenes=canvases.map((canvas,index)=>{
  const root=d3.hierarchy(canvas);applyVizIds(root);
  const positions=new Map(root.descendants().map(n=>{
   const id=getNodeId(n),x=id==='head'?(index?1040:500):id==='peer'?4000:id==='selected'?8000:id==='newChild'?1040:2000;
   return[id,{x:direction==='rtl'?10000-x:x,y:id==='newChild'?400:id==='head'||id==='peer'?200:0}];
  }));base.set(canvas,positions);
  const nodes=new Map(root.descendants().filter(n=>getNodeId(n)!=='workspace').map(n=>{const p=positions.get(getNodeId(n));return[getNodeId(n),Object.assign(n,{x:direction==='rtl'?10000-p.x:p.x,y:p.y})];}));
  return{canvas,nodes,coordinates:positions,size:[10000,3000],step:index===1?{replayKind:'relation',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:mover?[{authoredRelationKey:'1:0',renderFamily:'trajectory',priorSourceNodeId:'head',witnessNodeId:'peer',targetNodeId:'head'}]:[]}:{replayKind:'micro',operation:'LexicalSelect',targetNodeId:'selected'}};
 });
 const render=(scene,positions)=>{const root=d3.hierarchy(scene.canvas);applyVizIds(root);return root.descendants().filter(n=>scene.nodes.has(getNodeId(n))).map(n=>{const p=positions.get(getNodeId(n));return Object.assign(n,{x:direction==='rtl'?10000-p.x:p.x,y:p.y});});};
 const authored=JSON.stringify(canvases);
 const result=reserveCompleteComponentLifetime(scenes,base,direction,2,'root',render,{throughRelations:true});
 assert.equal(JSON.stringify(canvases),authored);
 return{before:result.get(prior).get('head'),after:result.get(canvases[1]).get('head'),old:base.get(prior).get('head'),prior,current:canvases[1]};
}
for(const direction of ['ltr','rtl']){
 test(`${direction}: wordless atom keeps its pose across an unrelated silence-state change`,()=>{
  const result=example({direction});assert.deepEqual(result.before,result.after);
  assert.equal(result.prior.children[0].silent,true);assert.equal(result.current.children[0].silent,undefined);
 });
 for(const [name,extra]of [['changed label',{changedLabel:true}],['pronounced silence change',{word:true}],['new internal child',{branched:true}]])test(`${direction}: ${name} retains its distinct contour boundary`,()=>{
  const result=example({direction,...extra});assert.deepEqual(result.before,result.old);assert.notDeepEqual(result.before,result.after);
 });
 test(`${direction}: actual moving atom is not treated as stationary state change`,()=>{
  const result=example({direction,mover:true});assert.notDeepEqual(result.before,result.after);
 });
}
