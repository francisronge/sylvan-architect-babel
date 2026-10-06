import test from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';
import {treeInkObstacles} from '../replay/treeInkGeometry.ts';
import {plaqueTreeObstacles} from '../replay/relations/plaquePlacement.ts';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
const width=t=>t.length*25;
function scene(){const root=d3.hierarchy({id:'root',label:'N',children:[{id:'book:1',label:'Book',word:'Book'}]});applyVizIds(root);root.each(n=>{n.x=0;n.y=n.depth*200;});return root.descendants();}
const runs=new Map([['root',[{kind:'category',text:'N',lines:['N'],indices:[]}]],['book:1',[{kind:'terminal',text:'Book₁₀',indices:[{text:'猫',mode:'identity'}]}]]]);
const metric=r=>r.kind==='category'?{x:-22,y:-60,width:44,height:60}:{x:-106,y:56,width:216,height:83};
test('full styled measurement extends the old horizontal reserve for inline and arbitrary styled indices',()=>{
 const nodes=scene(),before=plaqueTreeObstacles(nodes,width,true),after=treeInkObstacles(nodes,width,undefined,true,runs,metric);
 const old=before.find(r=>r.connectorAttachment==='book:1:terminal'),actual=after.find(r=>r.connectorAttachment==='book:1:terminal');
 assert(actual.x<old.x);assert(actual.x+actual.width>old.x+old.width);
 assert.deepEqual(actual,{x:-106,y:256,width:216,height:83,connectorAttachment:'book:1:terminal'});
 assert.deepEqual(plaqueTreeObstacles(nodes,width,true),before);
});
test('missing map, descriptor variant or metric retains the complete prior footprint for that node',()=>{
 const nodes=scene(),old=plaqueTreeObstacles(nodes,width,true);
 for(const [map,measure]of [[undefined,metric],[new Map(),metric],[runs,()=>undefined],[runs,()=>({x:0,y:0,width:NaN,height:1})]])assert.deepEqual(treeInkObstacles(nodes,width,undefined,true,map,measure),old);
 const multiple=new Map(runs);multiple.set('book:1',[...runs.get('book:1'),{kind:'terminal',text:'other',indices:[]}]);
 const actual=treeInkObstacles(nodes,width,undefined,true,multiple,r=>r.text==='other'?undefined:metric(r));
 for(const oldRect of old.filter(r=>r.connectorAttachment==='book:1:terminal'||r.terminalStemNodeId==='book:1'))assert(actual.some(r=>JSON.stringify(r)===JSON.stringify(oldRect)));
});
test('variant union keeps both visible labels and only changes the exact owned stem',()=>{
 const nodes=scene(),foreign={...nodes[1],data:{...nodes[1].data,id:'foreign'},__vizId:'foreign'};nodes.push(foreign);
 const map=new Map(runs);map.set('book:1',[...runs.get('book:1'),{kind:'terminal',text:'earlier',indices:[]}]);
 const actual=treeInkObstacles(nodes,width,undefined,true,map,r=>r.text==='earlier'?{x:-120,y:45,width:260,height:100}:metric(r));
 const terminal=actual.filter(r=>r.connectorAttachment==='book:1:terminal');assert.equal(terminal.length,2);assert(terminal.every(r=>r.x===-120&&r.width===260));
 const before=plaqueTreeObstacles(nodes,width,true);assert.deepEqual(actual.find(r=>r.terminalStemNodeId===getNodeId(foreign)),before.find(r=>r.terminalStemNodeId===getNodeId(foreign)));
});
