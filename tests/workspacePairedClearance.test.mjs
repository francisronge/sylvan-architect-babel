import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedWorkspaceClearance, workspaceClearanceObstructions, WORKSPACE_PAIRED_EVALUATION_LIMIT } from '../replay/workspacePairedClearance.ts';
import { currentForkBranchesClear, currentForkBranchCollision } from '../replay/workspaceForkClearance.ts';

for(const sign of [1,-1])test(`reported incoming-branch contact is the exact rejected rectangle (${sign})`,()=>{
  const ink={x:-190,y:-168,width:380,height:189,connectorAttachment:'actual-owner:category'};
  const children=[{point:{x:-150*sign,y:212},obstacles:[]},{point:{x:150*sign,y:212},obstacles:[ink]}];
  assert.equal(currentForkBranchesClear({x:0,y:0},children),false);
  const contact=currentForkBranchCollision({x:0,y:0},children);
  assert.equal(contact.childIndex,1);assert.equal(contact.obstacle,ink);
  children.forEach(child=>child.point.x*=2);
  assert.equal(currentForkBranchCollision({x:0,y:0},children),undefined);
});

const points = (left, right, prefix = '') => new Map([[prefix+'a', {x:left,y:210}], [prefix+'b', {x:right,y:210}], [prefix+'inside', {x:9,y:420}]]);
const gap = (maps, key, prefix = '') => maps.get(key).get(prefix+'b').x - maps.get(key).get(prefix+'a').x;
const serialized = maps => JSON.stringify([...maps].map(([key, value]) => [key, [...value]]));
function example(prefix = '') {
  const accepted = new Map([[1, points(-50,50,prefix)], [2, points(-40,40,prefix)]]);
  const rejected = new Map(accepted).set(1, points(-10,10,prefix));
  const reservation = {incarnation:1,split:1,side:'both',increase:70};
  const obstruction = {incarnation:2,split:1,side:'left',nodeId:prefix+'a'};
  const input = {
    attempted:{incarnation:1,split:1}, accepted, rejected,
    witness:{preference:reservation,obstructions:[obstruction]},
    forks:new Map([1,2].map(id=>[id,{children:[{id:prefix+'a'},{id:prefix+'b'}]}])),
    currentGap:()=>80, budget:{remaining:16,evaluations:0},
    evaluate:maps=>{
      const earlier = gap(maps,1,prefix), required = gap(maps,2,prefix)+10;
      return earlier+1e-6<required ? {clearance:{preference:{...reservation,increase:required-earlier},obstructions:[obstruction]}}
        : earlier<100 ? {value:{score:earlier}} : {};
    }
  };
  return input;
}
for (const prefix of ['', 'opaque/']) test(`paired clearance can improve only jointly, preserving the locked side (${prefix})`,()=>{
  const input=example(prefix),before=serialized(input.accepted),failed=serialized(input.rejected);
  const results=pairedWorkspaceClearance(input);
  assert.deepEqual(results.map(result=>result.candidate.score),[70,50]);
  assert.equal(input.budget.evaluations,4);
  for(const result of results){
    assert.equal(result.preferences.get(2).get(prefix+'b').x,40);
    assert.equal(result.preferences.get(2).get(prefix+'inside'),input.accepted.get(2).get(prefix+'inside'));
    for(const map of result.preferences.values())for(const [id,point]of map)assert.equal(point.y,id.endsWith('inside')?420:210);
  }
  assert.equal(serialized(input.accepted),before);assert.equal(serialized(input.rejected),failed);
});
for(const [name,change]of[
  ['different failed fork',input=>input.attempted.incarnation=9],
  ['different failed split',input=>input.attempted.split=2],
  ['earlier expansion',input=>input.rejected.set(1,points(-80,80))],
  ['no contact',input=>input.witness.obstructions=[]],
  ['self dependency',input=>input.witness.obstructions[0].incarnation=1],
  ['invalid current gap',input=>input.currentGap=()=>NaN],
])test(`does not add search for ${name}`,()=>{
  const input=example();change(input);input.evaluate=()=>{throw Error('unexpected evaluation');};
  assert.deepEqual(pairedWorkspaceClearance(input),[]);assert.equal(input.budget.evaluations,0);
});
test('a complete undo or unrelated repair cannot buy a paired improvement',()=>{
  for(const unrelated of [false,true]){
    const input=example();input.evaluate=()=>({clearance:{preference:{...input.witness.preference,incarnation:unrelated?9:1,increase:80},obstructions:[]}});
    assert.deepEqual(pairedWorkspaceClearance(input),[]);assert.equal(input.budget.evaluations,2);
  }
});
test('all paired candidates remain subject to caller rejection',()=>{
  const input=example();input.evaluate=()=>({});
  assert.deepEqual(pairedWorkspaceClearance(input),[]);assert.equal(input.budget.evaluations,2);
});
test('one shared explicit budget bounds all paired evaluations, including repairs',()=>{
  const budget={remaining:WORKSPACE_PAIRED_EVALUATION_LIMIT,evaluations:0};
  for(let i=0;i<20;i++)pairedWorkspaceClearance({...example(),budget});
  assert.equal(budget.evaluations,16);assert.equal(budget.remaining,0);
  const input={...example(),budget};input.evaluate=()=>{throw Error('exhausted');};
  assert.deepEqual(pairedWorkspaceClearance(input),[]);
});
test('an exhausted budget cannot perform a measured repair',()=>{
  const input=example();input.budget.remaining=1;
  assert.deepEqual(pairedWorkspaceClearance(input),[]);assert.equal(input.budget.evaluations,1);
});

const leaf=(id,serial)=>({id,serial,first:0,last:5,children:[],fixedSlots:new Map()});
function contactTree(prefix=''){
  const ink=leaf(prefix+'ink',1),other=leaf(prefix+'other',2);
  const fork={id:prefix+'changed',serial:3,first:2,last:3,children:[ink,other],fixedSlots:new Map([[1,{x:100,y:210}]])};
  return {fork,ink,other,contacts:[{childIndex:0,nodeId:ink.id}]};
}
for(const prefix of ['', 'renamed/'])test(`only the actual ink owner's free transient path supplies a dependency (${prefix})`,()=>{
  const f=contactTree(prefix),before=JSON.stringify(f);
  assert.deepEqual(workspaceClearanceObstructions([f.fork],0,5,f.contacts),[{incarnation:3,split:1,side:'left',nodeId:f.ink.id}]);
  assert.equal(JSON.stringify(f),before);
});
for(const [name,change]of[
  ['unrelated ink owner',f=>f.contacts[0].nodeId='elsewhere'],
  ['wrong current child',f=>f.contacts[0].childIndex=1],
  ['locked contacting side',f=>f.fork.fixedSlots.set(0,{x:-100,y:210})],
  ['already-existing incarnation',f=>f.fork.first=0],
  ['final persistent fork',f=>f.fork.last=5],
])test(`does not infer a dependency from ${name}`,()=>{
  const f=contactTree();change(f);assert.deepEqual(workspaceClearanceObstructions([f.fork],0,5,f.contacts),[]);
});
test('a nearby free fork not containing the contact cannot replace its locked ancestor',()=>{
  const f=contactTree(),nearby={...f.fork,id:'nearby',serial:8,children:[leaf('nearA',9),leaf('nearB',10)],fixedSlots:new Map()};
  const root={...f.fork,id:'root',serial:11,children:[f.ink,nearby],fixedSlots:new Map([[0,{x:0,y:210}],[1,{x:100,y:210}]])};
  assert.deepEqual(workspaceClearanceObstructions([root],0,5,f.contacts),[]);
});
test('a fork category has a recentering dependency only around a locked child side',()=>{
  const f=contactTree(),contact=[{childIndex:0,nodeId:f.fork.id}];
  assert.deepEqual(workspaceClearanceObstructions([f.fork],0,5,contact),[{incarnation:3,split:1,side:'left',nodeId:f.fork.id}]);
  f.fork.fixedSlots.clear();
  assert.deepEqual(workspaceClearanceObstructions([f.fork],0,5,contact),[]);
});
