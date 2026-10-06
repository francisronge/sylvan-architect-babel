import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime as reserve } from '../replay/workspaceComponentLifetime.ts';

const n = (id, children, label=id) => ({id,label,...(children?{children}:{})});
function scenario(direction, mode, {owned=true, changed=false}={}) {
 const source = () => n('source',[n('inside',[n('end')])], 'DP');
 const host = () => n('host',[n('h1',[n('h2')])]);
 const before = n('root',[source(),host()]);
 const later = () => n('root',[n('lower'),n('wrapper',[n('landing',mode==='source'?[n('inside',[n('end')])]:[n('landingWord')],changed?'XP':'DP'),host()])]);
 const canvases=[before,later(),later()];
 const points=[{root:[1500,0],source:[0,200],inside:[0,400],end:[0,600],host:[3000,200],h1:[2900,400],h2:[2900,600]},
 {root:[1500,0],lower:[600,200],wrapper:[3000,200],landing:[2500,500],landingWord:[2500,800],inside:[2300,800],end:[2300,1100],host:[3500,500],h1:[3700,800],h2:[3700,1100]}];
 const base=new Map(), scenes=canvases.map((canvas,i)=>{
  const root=d3.hierarchy(canvas); applyVizIds(root);
  const coords=new Map(root.descendants().map(node=>[getNodeId(node),{x:points[Math.min(i,1)][getNodeId(node)][0],y:points[Math.min(i,1)][getNodeId(node)][1]}]));
  base.set(canvas,coords);
  const nodes=new Map(root.descendants().map(node=>{const p=coords.get(getNodeId(node));Object.assign(node,{x:direction==='rtl'?5000-p.x:p.x,y:p.y});return[getNodeId(node),node];}));
  const step=i===1?{replayKind:'relation',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:owned?'1:0':'0:0',renderFamily:'trajectory',priorSourceNodeId:'source',witnessNodeId:'lower',targetNodeId:'landing'}]}:{replayKind:'relation'};
  return{canvas,nodes,coordinates:coords,size:[5000,2000],step};
 });
 const render=(scene,coords)=>{const root=d3.hierarchy(scene.canvas);applyVizIds(root);return root.descendants().map(node=>{const p=coords.get(getNodeId(node));return Object.assign(node,{x:direction==='rtl'?5000-p.x:p.x,y:p.y});});};
 const initial=JSON.stringify([...base].map(([c,m])=>[c,[...m]]));
 const result=reserve(scenes,base,direction,2,'root',render,{throughRelations:true});
 assert.equal(JSON.stringify([...base].map(([c,m])=>[c,[...m]])),initial);
 const at=i=>new Map(render(scenes[i],result.get(canvases[i])).map(node=>[getNodeId(node),node]));
 return{at,base,canvases,result};
}
for(const direction of ['ltr','rtl']) {
 test(`${direction}: an unchanged movement host uses one complete contour before and after wrapping`,()=>{
  const {at}=scenario(direction,'host'),a=at(0),b=at(1);
  for(const id of ['h1','h2'])for(const axis of ['x','y'])assert(Math.abs(a.get(id)[axis]-a.get('host')[axis]-(b.get(id)[axis]-b.get('host')[axis]))<1e-6);
  assert.equal(a.get('host').y,b.get('wrapper').y);
 });
 test(`${direction}: a complete retained source uses the same contour at its landing`,()=>{
  const {at}=scenario(direction,'source'),a=at(0),b=at(1);
  for(const id of ['inside','end'])for(const axis of ['x','y'])assert(Math.abs(a.get(id)[axis]-a.get('source')[axis]-(b.get(id)[axis]-b.get('landing')[axis]))<1e-6);
  assert.equal(a.get('source').y,b.get('lower').y);
 });
 test(`${direction}: an unrelated relation cannot supply a landing contour`,()=>{
  const {at}=scenario(direction,'source',{owned:false}),a=at(0);
  assert.equal(a.get('source').x,direction==='rtl'?5000:0);
 });
 test(`${direction}: changed landing material cannot replace the preceding source contour`,()=>{
  const {at}=scenario(direction,'source',{changed:true}),a=at(0),b=at(1);
  assert.notEqual(a.get('inside').x-a.get('source').x,b.get('inside').x-b.get('landing').x);
 });
}
