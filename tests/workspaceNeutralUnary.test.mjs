import assert from 'node:assert/strict';
import test from 'node:test';
import { neutralWorkspaceAttachments } from '../replay/workspaceNeutralAttachments.ts';
const leaf=id=>({id,children:[]});
const fork=(id,...children)=>({id,children});
function view(...roots){
 const nodes=new Map(),parents=new Map();
 const visit=(node,owner)=>{nodes.set(node.id,node);if(owner)parents.set(node.id,owner);node.children.forEach(child=>visit(child,node.id));};
 roots.forEach(node=>visit(node));
 return {nodes,has:id=>nodes.has(id),parent:id=>parents.get(id),children:id=>nodes.get(id)?.children.map(child=>child.id)??[],
 contains:(root,id)=>{for(let node=id;node;node=parents.get(node))if(node===root)return true;return false;}};
}
function example({unaryDepth=1,oldUnary=false,extraUnaryChild=false,wrongSlot=false,wrongParent=false,changedHost=false,prefix=''}={}){
 const n=id=>prefix+id,retained=fork(n('retained'),leaf(n('word'))),object=fork(n('object'),leaf(n('noun'))),verb=leaf(n('verb'));
 const before=view(fork(n('clause'),fork(n('prior'),retained),fork(n('vp'),object,verb)),...(oldUnary?[fork(n('unary-0'),leaf(n('unrelated')) )]:[]));
 let branch=fork(n('landing'),retained);
 for(let i=0;i<unaryDepth;i++)branch=fork(n('unary-'+i),branch,...(extraUnaryChild&&i===0?[leaf(n('new-peer'))]:[]));
 const wrapper=fork(n('wrapper'),object,branch),vp=fork(n('vp'),...(wrongSlot?[verb,wrapper]:[wrapper,verb]));
 const current=view(fork(n('clause'),leaf(n('lower')),vp));
 if(wrongParent){const original=before.parent;before.parent=id=>id===n('object')?n('elsewhere'):original(id);}
 const same=id=>!(changedHost&&id===n('object'))&&JSON.stringify(before.nodes.get(id))===JSON.stringify(current.nodes.get(id));
 const step={replayKind:'relation',replayRelationIdentity:{stageIndex:2,relationIndex:0},replayTreeTransition:{relationKey:'2:0',
 priorNodeIds:['prior','retained','word'].map(n),currentNodeIds:['landing','retained','word','lower','verb'].map(n)}};
 return {step,before,current,same,n};
}
const result=input=>[...neutralWorkspaceAttachments(input.step,input.before,input.current,input.same)].sort();
for(const unaryDepth of [0,1,3])for(const prefix of ['', 'opaque/'])test(`exact receiver through ${unaryDepth} new unary shells (${prefix})`,()=>{
 const input=example({unaryDepth,prefix}),before=JSON.stringify(input.step);
 assert.deepEqual(result(input),['object','retained'].map(input.n).sort());
 assert.equal(JSON.stringify(input.step),before);
});
for(const option of ['oldUnary','extraUnaryChild','wrongSlot','wrongParent','changedHost'])test(`${option} does not own the receiving host`,()=>{
 const input=example({[option]:true});assert(!result(input).includes(input.n('object')));
});
test('a new unary path under an old unrelated ancestor does not reach an outer receiving host',()=>{
 const input=example();input.before.nodes.set('wrapper',fork('wrapper',leaf('unrelated')));
 assert(!result(input).includes('object'));
});
test('an unrelated branch cannot act as the unary continuation',()=>{
 const input=example();input.current.nodes.get('unary-0').children=[leaf('elsewhere')];
 assert(!result(input).includes('object'));
});
test('wrong authored relation identity still grants no ownership',()=>{
 const input=example();input.step.replayTreeTransition.relationKey='3:0';assert.deepEqual(result(input),[]);
});
