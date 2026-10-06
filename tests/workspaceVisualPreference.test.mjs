import test from 'node:test';
import assert from 'node:assert/strict';
import { withinWorkspaceVisualPreference } from '../replay/workspaceVisualPreference.ts';

const tree = (id, ...children) => ({id,children});
function frame(roots, positions) {
  const nodes = new Map();
  const build = node => {
    const children = node.children.map(build),origin=positions.get(node.id);
    const members = new Map([[node.id,{x:0,y:0}]]);
    for(const child of children) for(const[id,p]of child.members) {
      const offset=positions.get(child.id);
      members.set(id,{x:p.x+offset.x-origin.x,y:p.y+offset.y-origin.y});
    }
    const result={id:node.id,incarnation:nodes.size,first:0,last:0,children,members,obstacles:[]};
    nodes.set(node.id,result);return result;
  };
  return {roots:roots.map(build),nodes,step:{}};
}
const coordinates = entries => new Map(entries.map(([id,x,y=0])=>[id,{x,y}]));
function simple(delta=0) {
  const roots=[tree('p',tree('a'),tree('b'))];
  const before=coordinates([['p',80,40],['a',-420,240],['b',580,240]]);
  const after=coordinates([['p',0,0],['a',-500-delta,200],['b',500+delta,200]]);
  return {roots,before,after};
}
for(const[delta,expected]of[[0,true],[5,true],[10,true],[10.01,false]])test(`global preference bound ${delta}`,()=>{
  const {roots,before,after}=simple(delta);
  assert.equal(withinWorkspaceVisualPreference(frame(roots,after),before),expected);
});
for(const[halfGap,expected]of[[11,true],[11.01,false],[30,false]])test(`a tiny fork in a large tree retains its own span bound (${halfGap})`,()=>{
  const roots=[tree('root',tree('left'),tree('small',tree('a'),tree('b')),tree('right'))];
  const before=coordinates([['root',0],['left',-10000,200],['small',0,200],['a',-10,400],['b',10,400],['right',10000,200]]);
  const after=new Map([...before].map(([id,p])=>[id,{...p}]));after.get('a').x=-halfGap;after.get('b').x=halfGap;
  assert.equal(withinWorkspaceVisualPreference(frame(roots,after),before),expected);
});
test('vertical geometry cannot be traded for a small horizontal score',()=>{
  const {roots,before,after}=simple();after.get('a').y+=0.01;
  assert.equal(withinWorkspaceVisualPreference(frame(roots,after),before),false);
});
for(const[start,end]of[[0,1],[1,0],[1,-1]])test(`zero or direction-changing local span ${start} to ${end}`,()=>{
  const roots=[tree('p',tree('a'),tree('middle'),tree('b'))];
  const before=coordinates([['p',0],['a',-1000,200],['middle',start,200],['b',1000,200]]);
  const after=new Map([...before].map(([id,p])=>[id,{...p}]));after.get('middle').x=end;
  assert.equal(withinWorkspaceVisualPreference(frame(roots,after),before),false);
});
test('each independent root gets its own displacement bound',()=>{
  const input=simple(11);input.roots.push(tree('distant',tree('x'),tree('y')));
  for(const map of [input.before,input.after]) for(const[id,p]of coordinates([['distant',0],['x',-100000,200],['y',100000,200]]))map.set(id,p);
  assert.equal(withinWorkspaceVisualPreference(frame(input.roots,input.after),input.before),false);
});
test('preference evaluation does not mutate coordinates or depend on opaque IDs',()=>{
  const input=simple(5),snapshot=JSON.stringify([...input.before]),value=frame(input.roots,input.after);
  const encode=part=>tree(`opaque/${part.id}`,...part.children.map(encode));
  const rename=map=>new Map([...map].map(([id,p])=>[`opaque/${id}`,{...p}]));
  assert.equal(withinWorkspaceVisualPreference(value,input.before),true);
  assert.equal(withinWorkspaceVisualPreference(frame(input.roots.map(encode),rename(input.after)),rename(input.before)),true);
  assert.equal(JSON.stringify([...input.before]),snapshot);
});
test('incomplete accepted reference cannot terminate refinement',()=>{
  const input=simple();input.before.delete('a');
  assert.equal(withinWorkspaceVisualPreference(frame(input.roots,input.after),input.before),false);
});
