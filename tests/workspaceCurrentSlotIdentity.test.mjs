import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWorkspaceLifetimeContours } from '../replay/workspaceLifetimeContours.ts';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
const atom=(id,label=id)=>({id,label}),fork=(id,...children)=>({id,label:'P',children});
const ids=n=>[n.id,...(n.children??[]).flatMap(ids)];
const step=canvas=>({replayCanvasData:canvas,replayVisibleNodeIds:ids(canvas),replayFrameIndex:0,replayKind:'relation',operation:'feature valuation'});
function prepare(steps,alter){const compose=prepareWorkspaceLifetimeContours(steps),initial=compose(),preferred=new Map();for(const frame of initial)for(const part of frame.nodes.values())preferred.set(part.incarnation,new Map([...part.members].map(([id,p])=>[id,{...p}])));alter(initial,preferred);return {compose,initial,preferred};}
for(const field of ['label','word','silent'])test(`topology-stable ${field} update keeps its existing world position`,()=>{
 const old=fork('p',{id:'head',label:'H',word:'head',silent:false},fork('body',atom('word'))),next=structuredClone(old);next.children[0][field]=field==='silent'?true:'new';const steps=[step(old),step(next)],input=JSON.stringify(steps);
 const {compose,preferred}=prepare(steps,(frames,preferred)=>frames.forEach((frame,index)=>{const root=frame.nodes.get('p'),points=preferred.get(root.incarnation);points.set('head',{x:index?-250:-600,y:300});points.set('body',{x:600,y:300});}));
 const frames=compose(undefined,{inheritCurrentSlots:true,preferred}),graph=rigidPoseGraph(frames);assert.equal(graph.conflicts.length,0);
 const a=graph.union.find(graph.variables[0].get('p')),b=graph.union.find(graph.variables[1].get('p'));
 for(const id of ['head','body','word']){const x=frames[0].nodes.get('p').members.get(id),y=frames[1].nodes.get('p').members.get(id);assert.ok(Math.hypot(a.offset.x+x.x-b.offset.x-y.x,a.offset.y+x.y-b.offset.y-y.y)<1e-6);}
 assert.equal(JSON.stringify(steps),input);assert.notEqual(frames[0].nodes.get('head').incarnation,frames[1].nodes.get('head').incarnation);
});
function wrapperFixture(options={}){
 const head=atom('head'),body=fork('body',{id:'lower',label:'D',silent:true},atom('verb'));
 const before=fork('p',head,body),wrapper=fork('wrapper',head,body),after=fork('p',atom('high'),wrapper);
 if(options.label)wrapper.label='Different';
 if(options.reorder)wrapper.children.reverse();
 if(options.extra)wrapper.children.push(atom('extra'));
 if(options.changedChild){wrapper.children[1]=structuredClone(body);wrapper.children[1].label='Changed';}
 if(options.wrongParent)after.children[1]=fork('newParent',wrapper);
 const forest=children=>({id:'forest',label:'Workspace',replayOrigin:{kind:'workspace'},children});
 let a=before,b=after;
 if(options.existing)a=forest([before,atom('wrapper')]);
 if(options.sourceOutside){a=forest([before,atom('outside')]);b=forest([after,atom('outside')]);}
 if(options.witnessOutside)b=forest([after,atom('otherLower')]);
 const next=step(b);next.operation='movement';next.replayKind=options.structural?'micro':'relation';next.replayRelationIdentity={stageIndex:1,relationIndex:0};next.replayRelationLinks=[{renderFamily:options.nonmovement?'authored-anchor-link':'trajectory',authoredRelationKey:options.stale?'0:0':'1:0',priorSourceNodeId:options.sourceOutside?'outside':'lower',witnessNodeId:options.witnessOutside?'otherLower':'lower',targetNodeId:'high'}];
 const steps=[step(a),next];const setup=prepare(steps,(frames,preferred)=>{const p=preferred.get(frames[0].nodes.get('p').incarnation);p.set('head',{x:-600,y:300});p.set('body',{x:600,y:300});const w=preferred.get(frames[1].nodes.get('wrapper').incarnation);w.set('head',{x:-300,y:300});w.set('body',{x:300,y:300});});return {steps,...setup};
}
test('current owned wrapper inherits the complete unchanged old fork',()=>{
 const f=wrapperFixture(),input=JSON.stringify(f.steps),frames=f.compose(undefined,{inheritCurrentSlots:true,preferred:f.preferred});const before=frames[0].nodes.get('p'),wrapper=frames[1].nodes.get('wrapper');
 for(const child of before.children){assert.equal(child,frames[1].nodes.get(child.id));assert.deepEqual(before.members.get(child.id),wrapper.members.get(child.id));}
 assert.notEqual(before.incarnation,wrapper.incarnation);assert.equal(rigidPoseGraph(frames).conflicts.length,0);assert.equal(JSON.stringify(f.steps),input);
});
for(const option of ['stale','structural','nonmovement','label','reorder','extra','changedChild','wrongParent','existing','sourceOutside','witnessOutside'])test(`wrapper cannot inherit an old fork through ${option}`,()=>{const f=wrapperFixture({[option]:true});assert.throws(()=>f.compose(undefined,{inheritCurrentSlots:true,preferred:f.preferred}));});

test('topology-stable shell may recenter around its owned changing descendant while bystanders stay fixed',()=>{
 const forest=children=>({id:'forest',label:'Workspace',replayOrigin:{kind:'workspace'},children});
 const prior=fork('outer',fork('p',{id:'head',label:'H',word:'verb'},fork('body',atom('word'))),atom('other'));
 const current=structuredClone(prior);current.children[0].children[0].silent=true;
 const before=step(forest([prior])),after=step(forest([current,atom('high')]));
 after.replayRelationIdentity={stageIndex:1,relationIndex:0};after.replayRelationLinks=[{renderFamily:'trajectory',authoredRelationKey:'1:0',priorSourceNodeId:'head',witnessNodeId:'head',targetNodeId:'high'}];
 const steps=[before,after],input=JSON.stringify(steps);
 const {compose,preferred}=prepare(steps,(frames,prefs)=>frames.forEach((frame,index)=>{
  const points=prefs.get(frame.nodes.get('p').incarnation);points.set('head',{x:index?-200:-600,y:300});points.set('body',{x:600,y:300});
  const outer=prefs.get(frame.nodes.get('outer').incarnation);outer.set('p',{x:-1500,y:300});outer.set('other',{x:1500,y:300});
 }));
 const frames=compose(undefined,{inheritCurrentSlots:true,preferred}),graph=rigidPoseGraph(frames);assert.equal(graph.conflicts.length,0);
 const a=graph.union.find(graph.variables[0].get('outer')),b=graph.union.find(graph.variables[1].get('outer'));
 for(const id of ['body','word','other']){const x=frames[0].nodes.get('outer').members.get(id),y=frames[1].nodes.get('outer').members.get(id);assert.ok(Math.hypot(a.offset.x+x.x-b.offset.x-y.x,a.offset.y+x.y-b.offset.y-y.y)<1e-6);}
 assert.equal(JSON.stringify(steps),input);
});
