import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionReceivingHosts } from '../replay/workspaceReceivingHost.ts';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
function fixture(change={}) {
 const before=new Map([['p',['head','host']],['host',['still','source']],['source',['word']],['still',[]],['head',[]],['word',[]],['other',[]]]);
 const current=new Map([['p',['head','wrapper']],['wrapper',['host','source']],['host',['still','lower']],['source',['word']],['lower',[]],['still',[]],['head',[]],['word',[]],['other',[]]]);
 const step={replayKind:'relation',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{renderFamily:'trajectory',authoredRelationKey:'1:0',priorSourceNodeId:'source',witnessNodeId:'lower',targetNodeId:'source'}]};
 if(change.stale)step.replayRelationLinks[0].authoredRelationKey='0:0';
 if(change.structural)step.replayKind='micro';
 if(change.nonmovement)step.replayRelationLinks[0].renderFamily='authored-anchor-link';
 if(change.wrongSlot){before.set('p',['head','old']);before.set('old',['host']);}
 if(change.competing){before.get('p').push('other');current.get('wrapper').push('other');}
 if(change.unrelated){step.replayRelationLinks[0].priorSourceNodeId='other';}
 if(change.missingWitness)current.get('host').splice(1,1);
 if(change.preexistingWrapper)before.set('wrapper',[]);
 const topology=nodes=>{const parents=new Map([...nodes].flatMap(([id,children])=>children.map(child=>[child,id])));return{has:id=>nodes.has(id),parent:id=>parents.get(id),children:id=>nodes.get(id)??[],contains:(root,id)=>{for(let at=id;at;at=parents.get(at))if(at===root)return true;return false;}};};
 return {before,current,step,a:topology(before),b:topology(current)};
}
test('current extraction owns exactly the receiving host at its prior slot',()=>{const f=fixture();assert.deepEqual([...extractionReceivingHosts(f.step,f.a,f.b)],['host']);});
for(const option of ['stale','structural','nonmovement','wrongSlot','competing','unrelated','missingWitness','preexistingWrapper'])test(`extraction host excludes ${option}`,()=>{const f=fixture({[option]:true});assert.deepEqual([...extractionReceivingHosts(f.step,f.a,f.b)],[]);});
// A is genuinely moved; an independently reparented B is not part of that claim.
test('one real movement cannot release an unrelated reparented subtree',()=>{
 const contour=(id,incarnation,children=[])=>({id,incarnation,members:new Map([[id,{x:0,y:0}],...children.flatMap((c,i)=>[...c.members].map(([id,p])=>[id,{x:p.x+200*i,y:p.y+300}]))]),children,obstacles:[],first:0,last:1});
 const a=contour('a',0),b=contour('b',1),oldA=contour('oldA',2,[a]),oldB=contour('oldB',3,[b]);
 const lower=contour('lower',4),newA=contour('newA',5,[a]),newB=contour('newB',6,[b]);
 const frames=[{step:{replayCanvasData:{},replayKind:'micro',operation:'ExternalMerge'},roots:[oldA,oldB]},{step:{replayCanvasData:{},replayKind:'relation',operation:'move A',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:'1:0',renderFamily:'trajectory',priorSourceNodeId:'a',witnessNodeId:'lower',targetNodeId:'a'}]},roots:[lower,newA,newB]}];
 for(const frame of frames){frame.nodes=new Map();const visit=c=>{frame.nodes.set(c.id,c);c.children.forEach(visit);};frame.roots.forEach(visit);}
 const graph=rigidPoseGraph(frames);assert.equal(graph.conflicts.length,0);assert.ok(graph.constraints.some(c=>c.id==='b'));assert.ok(!graph.constraints.some(c=>c.id==='a'));
 const from=graph.union.find(graph.variables[0].get('oldB')),to=graph.union.find(graph.variables[1].get('newB'));
 assert.equal(from.group,to.group,'unrelated B remains point-locked');
});
function projectGraph(options={}){
 const shape=(id,incarnation,children=[])=>({id,incarnation,members:new Map([[id,{x:0,y:0}],...children.flatMap((c,i)=>[...c.members].map(([id,p])=>[id,{x:p.x+(i?500:-500),y:p.y+300}]))]),children,obstacles:[],first:0,last:1});
 const a=shape('a',1,[shape('word',2)]),b=shape('b',3),p=shape('p',4,[a,b]);
 const changed=options.material?shape('a',5,a.children):a,wrapper=shape('wrapper',6,[changed]),q=shape('p',7,[wrapper,b]);
 const first={step:{replayCanvasData:{},replayKind:'micro',operation:'LexicalSelect'},roots:[p]};
 const last={step:{replayCanvasData:{},replayKind:options.relation?'relation':'micro',operation:'Project',targetNodeId:options.wrongTarget?'other':'wrapper',sourceNodeIds:[options.wrongSource?'b':'a']},roots:[q]};
 for(const frame of [first,last]){frame.nodes=new Map();const visit=x=>{frame.nodes.set(x.id,x);x.children.forEach(visit);};frame.roots.forEach(visit);}
 if(options.existing){const priorWrapper=shape('wrapper',30);first.roots.push(priorWrapper);first.nodes.set('wrapper',priorWrapper);}
 if(options.wrongSlot){const old=shape('old',8,[a]);first.roots=[shape('p',9,[old,b])];first.nodes=new Map();const visit=x=>{first.nodes.set(x.id,x);x.children.forEach(visit);};first.roots.forEach(visit);}
 return rigidPoseGraph([first,last]);
}
test('exact unary Project permits rigid attachment while retaining unrelated child',()=>{const graph=projectGraph();assert.equal(graph.conflicts.length,0);assert.ok(graph.constraints.some(x=>x.id==='b'));assert.ok(!graph.constraints.some(x=>x.id==='a'));});
for(const option of ['wrongTarget','wrongSource','relation','existing','material','wrongSlot'])test(`unary Project cannot exempt ${option}`,()=>{const graph=projectGraph({[option]:true});assert.ok(graph.constraints.some(x=>x.id==='a'||x.id==='word'));});
