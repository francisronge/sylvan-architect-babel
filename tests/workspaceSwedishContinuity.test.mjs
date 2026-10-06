import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import {prepareReplay} from '../replay/prepareReplay.ts';
import {applyVizIds,getNodeId} from '../replay/displayIdentity.ts';
import {layoutSyntaxTree} from '../replay/treeLayout.ts';
import {buildStageLayoutGroups,stageTreeLayoutSize} from '../replay/stageCamera.ts';
import {buildStageCoordinateReservations as repaired} from '../replay/stageCoordinates.ts';
const {record,expectedFinalCoordinates}=JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-swedish-continuity.json',import.meta.url)));
for(const [width,height] of [[1600,1100],[390,844]]) for(const direction of ['ltr','rtl']) {
 const p=prepareReplay({...record,includePlayback:true}),steps=p.playbackSteps,groups=buildStageLayoutGroups(steps,p.replayDerivationFrames),sizeFor=i=>stageTreeLayoutSize(steps,i,width,height,groups);
 const frame=(number,build=repaired)=>{const step=steps[number-1],size=sizeFor(step.replayFrameIndex),root=d3.hierarchy(step.replayCanvasData);applyVizIds(root);const coordinates=build(steps,step.replayFrameIndex,size,sizeFor,direction).get(step.replayCanvasData),visible=new Set(step.replayVisibleNodeIds);return new Map(layoutSyntaxTree(root,size,direction,coordinates,visible).descendants().filter(n=>visible.has(getNodeId(n))&&!n.data.replayLayoutOnly&&n.data.replayOrigin?.kind!=='workspace').map(n=>[getNodeId(n),n]));};
 test(`${width}px ${direction}: complete clause stays fixed while the next head is selected`,()=>{const a=frame(36),b=frame(37);assert.equal(steps[36].operation,'LexicalSelect');for(const[id,n]of a){const next=b.get(id);assert(next);assert(Math.hypot(n.x-next.x,n.y-next.y)<1e-6,`${id} jumps`);}});
 test(`${width}px ${direction}: real movement retains the source until its own moment`,()=>{for(const [before,after,source,lower]of [[29,30,'book','bookObjectTrace'],[33,34,'aux','auxTrace'],[37,38,'finiteI','iTrace']]){const a=frame(before),b=frame(after);assert(!a.has(lower));assert(b.has(lower));assert(b.get(lower).data.silent);assert(Math.hypot(a.get(source).x-b.get(source).x,a.get(source).y-b.get(source).y)>1);for(const n of a.values()){const children=(n.children??[]).filter(c=>a.has(getNodeId(c)));if(children.length>1)assert(Math.max(...children.map(c=>c.y))-Math.min(...children.map(c=>c.y))<1e-6,`${getNodeId(n)} slants before ${after}`);}}});
 test(`${width}px ${direction}: final tree proportions stay identical within floating-point precision`,()=>{
  const a=frame(44),key=width===1600?(direction==='ltr'?'desktop':'rtl'):(direction==='ltr'?'phone':'phone-rtl');
  const expected=expectedFinalCoordinates[key];
  assert.deepEqual([...a.keys()],expected.map(([id])=>id));
  // A whole-tree translation changes its world origin, not its fitted shape.
  const[rootId,rootX,rootY]=expected[0],root=a.get(rootId);
  for(const[id,x,y]of expected){const n=a.get(id);assert(Math.hypot(n.x-root.x-(x-rootX),n.y-root.y-(y-rootY))<1e-8,`${id} changes final proportions`);}
 });
}
