import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWorkspaceLifetimeContours, WorkspaceContourClearanceError } from '../replay/workspaceLifetimeContours.ts';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
function fixture(prefix='', changedChildren=false) {
 const id=x=>prefix+x, atom=(x,label=x)=>({id:id(x),label}), fork=(x,...children)=>({id:id(x),label:'P',children});
 const a=fork('p',fork('left',atom('w')),atom('right'));
 const b=structuredClone(a);b.children[0].label='expanded';
 if(changedChildren)b.children.splice(1,0,atom('new'));
 const ids=n=>[n.id,...(n.children??[]).flatMap(ids)];
 const steps=[a,b].map(canvas=>({replayCanvasData:canvas,replayVisibleNodeIds:ids(canvas),replayKind:'relation',operation:'material',replayFrameIndex:0}));
 const labels=new Map(steps.map((s,index)=>[s.replayCanvasData,new Map([[id('left'),[{kind:'category',width:index?1000:80}]]]) ]));
 const compose=prepareWorkspaceLifetimeContours(steps,undefined,undefined,labels,run=>({x:-run.width/2,y:-40,width:run.width,height:55}));
 const frames=compose(),preferred=new Map();
 for(const frame of frames)for(const part of frame.nodes.values())preferred.set(part.incarnation,new Map([...part.members].map(([id,p])=>[id,{...p}])));
 for(const frame of frames){const points=preferred.get(frame.nodes.get(id('p')).incarnation);points.set(id('left'),{x:-180,y:400});points.set(id('right'),{x:180,y:400});if(changedChildren&&points.has(id('new')))points.set(id('new'),{x:0,y:400});}
 return {id,steps,compose,frames,preferred};
}
for(const prefix of ['', 'renamed/'])test(`later clearance is requested from the earlier free fork (${prefix})`,()=>{
 const f=fixture(prefix),before=JSON.stringify(f.steps);let failure;
 try{f.compose(undefined,{inheritCurrentSlots:true,preferred:f.preferred});}catch(error){failure=error;}
 assert.ok(failure instanceof WorkspaceContourClearanceError,String(failure));
 const request=failure.preference,first=f.frames[0].nodes.get(f.id('p'));
 assert.equal(request.incarnation,first.incarnation);assert.equal(request.split,1);assert.equal(request.side,'both');assert.ok(request.increase>0);
 const next=new Map(f.preferred),points=new Map([...next.get(request.incarnation)].map(([id,p])=>[id,{...p}]));
 first.children.forEach((child,index)=>points.get(child.id).x+=index<request.split?-request.increase/2:request.increase/2);next.set(request.incarnation,points);
 const result=f.compose(undefined,{inheritCurrentSlots:true,preferred:next});
 const graph=rigidPoseGraph(result);assert.equal(graph.conflicts.length,0);
 assert.equal(result[0].nodes.get(f.id('right')),result[1].nodes.get(f.id('right')));
 assert.equal(result[0].nodes.get(f.id('w')),result[1].nodes.get(f.id('w')));
 assert.ok(result[0].nodes.get(f.id('p')).members.get(f.id('right')).x-result[0].nodes.get(f.id('p')).members.get(f.id('left')).x>360);
 assert.equal(JSON.stringify(f.steps),before);
});
test('changed fork membership cannot borrow an unrelated earlier gap control',()=>{
 const f=fixture('',true);assert.throws(()=>f.compose(undefined,{inheritCurrentSlots:true,preferred:f.preferred}),error=>!(error instanceof WorkspaceContourClearanceError));
});
test('backward room uses the free side of a fork with one locked child',()=>{
 const f=fixture(),p={id:'p',label:'P',children:[{id:'right',label:'right'}]};
 const early={replayCanvasData:p,replayVisibleNodeIds:['p','right'],replayKind:'micro',operation:'Project',targetNodeId:'p',replayFrameIndex:0};
 const steps=[early,...f.steps];
 const labels=new Map(steps.map((s,index)=>[s.replayCanvasData,new Map(index?[['left',[{kind:'category',width:index===2?1000:80}]]]:[]) ]));
 const compose=prepareWorkspaceLifetimeContours(steps,undefined,undefined,labels,run=>({x:-run.width/2,y:-40,width:run.width,height:55}));
 const native=compose(),preferred=new Map();
 for(const frame of native)for(const part of frame.nodes.values())preferred.set(part.incarnation,new Map([...part.members].map(([id,p])=>[id,{...p}])));
 for(const frame of native){const points=preferred.get(frame.nodes.get('p').incarnation);if(points.has('left'))points.set('left',{x:-360,y:400});points.set('right',{x:0,y:400});}
 let error;try{compose(undefined,{inheritCurrentSlots:true,preferred});}catch(e){error=e;}
 assert.ok(error instanceof WorkspaceContourClearanceError,String(error));assert.equal(error.preference.incarnation,native[1].nodes.get('p').incarnation);assert.equal(error.preference.side,'left');
 let repeated;try{compose(undefined,{inheritCurrentSlots:true,preferred});}catch(e){repeated=e;}assert.deepEqual(repeated.preference,error.preference);
 const next=new Map(preferred),points=new Map([...next.get(error.preference.incarnation)].map(([id,p])=>[id,{...p}]));
 points.get('left').x-=error.preference.increase;next.set(error.preference.incarnation,points);
 const frames=compose(undefined,{inheritCurrentSlots:true,preferred:next}),graph=rigidPoseGraph(frames);assert.equal(graph.conflicts.length,0);
 for(let i=1;i<frames.length;i++){
  const a=graph.union.find(graph.variables[i-1].get('p')),b=graph.union.find(graph.variables[i].get('p'));
  assert.equal(a.group,b.group);assert.ok(Math.abs(a.offset.x+frames[i-1].nodes.get('p').members.get('right').x-b.offset.x-frames[i].nodes.get('p').members.get('right').x)<1e-6);
 }
});
