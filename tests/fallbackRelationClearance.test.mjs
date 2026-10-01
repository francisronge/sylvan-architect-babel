import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, fitFallbackGeometry } from '../replay/relations/geometryBinding.ts';
import { strokeObstacleRects } from '../components/relationInkObstacles.ts';
const overlaps = (a, b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
const roleBox = (m, s) => ({ x:m.x-(m.textWidth/2+4)*s,y:m.y-12*s,width:(m.textWidth+8)*s,height:24*s });
const setup = () => {
 const labels={a:{x:0,y:0,width:80,height:40},b:{x:1400,y:0,width:80,height:40}};
 const measurements={labels:Object.values(labels),labelFor:id=>labels[id],subtreeFor:id=>labels[id],bottom:40};
 const stage={statement:'',stageRecord:'',workspaceForest:[{id:'a',label:'DP'},{id:'b',label:'T'}],relations:[{relation:'Unfamiliar relation',anchors:{participant:'a',context:'b'}}]};
 const bound=bindRelationPlanFrame(compileRelationRenderPlan([stage]),0,id=>({x:labels[id].x+40,y:20}),{fallbackMeasurements:measurements});
 return {bound,measurements};
};
for(const scale of [0.4,1,3]) test(`neutral roles clear unrelated path, outline and text ink at scale ${scale}`,()=>{
 const {bound,measurements}=setup(),snapshot=structuredClone(bound);
 const options={fallbackMeasurements:measurements,fittedMarkerScale:scale,separateFallbackMoments:true};
 const marks=bound.primitives.filter(p=>p.type==='fallback-mark');
 const first=fitFallbackGeometry(bound,options).get(marks[0]),box=roleBox(first,scale);
 const barrier=strokeObstacleRects([{x:box.x,y:box.y+box.height/2},{x:box.x+box.width,y:box.y+box.height/2}],5);
 for(const obstacles of [barrier,[box]]) {
  const placed=fitFallbackGeometry(bound,{...options,relationInkObstacles:obstacles});
  assert(!obstacles.some(o=>overlaps(roleBox(placed.get(marks[0]),scale),o)));
  const plain=fitFallbackGeometry(bound,options).get(marks[1]);
  assert.deepEqual(placed.get(marks[1]),plain,'unaffected witness keeps its position');
 }
 assert.deepEqual(bound,snapshot,'neither syntax nor bound relation primitives are mutated');
});

test('open outlines reserve their ink, leaving the inside of a domain available',()=>{
 const rects=strokeObstacleRects([{x:0,y:0},{x:400,y:0},{x:400,y:300},{x:0,y:300},{x:0,y:0}],5);
 assert(!rects.some(r=>overlaps(r,{x:100,y:100,width:100,height:30})));
 assert(rects.some(r=>overlaps(r,{x:395,y:100,width:10,height:30})));
});
