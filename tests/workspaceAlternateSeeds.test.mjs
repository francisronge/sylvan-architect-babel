import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceAlternateSeeds, WORKSPACE_ALTERNATE_SEED_LIMIT } from '../replay/workspaceAlternateSeeds.ts';

const map = entries => new Map(entries.map(([id,x,y])=>[id,{x,y}]));
const serialize = preferences => JSON.stringify([...preferences].map(([id,points])=>[id,[...points]]));
function fixture(prefix='') {
  const id=s=>prefix+s;
  const native=map([[id('parent'),500,12],[id('left'),100,222],[id('right'),900,222],[id('deep'),700,432]]);
  const intrinsic=map([[id('parent'),100,0],[id('left'),80,900],[id('right'),120,900],[id('deep'),130,1800]]);
  const contour={id:id('parent'),incarnation:7,first:0,last:2,members:intrinsic,children:[{id:id('left')},{id:id('right')}]};
  return {id,native,intrinsic,contour,preferences:new Map([[7,native]])};
}
for(const prefix of ['', 'opaque/'])test(`two seeds change only complete fork X preferences (${prefix})`,()=>{
  const f=fixture(prefix),before=serialize(f.preferences),shapeBefore=JSON.stringify([...f.intrinsic]);
  const seeds=workspaceAlternateSeeds(f.preferences,[f.contour]);
  assert.equal(seeds.length,2);
  for(const [index,seed]of seeds.entries()){
    const points=seed.get(7), expected=index?[480,520]:[290,710];
    assert.deepEqual([points.get(f.id('left')).x,points.get(f.id('right')).x],expected);
    for(const [id,point]of points)assert.equal(point.y,f.native.get(id).y);
    assert.equal(points.get(f.id('parent')),f.native.get(f.id('parent')));
    assert.equal(points.get(f.id('deep')),f.native.get(f.id('deep')));
    assert.notEqual(points.get(f.id('left')),f.native.get(f.id('left')));
  }
  assert.equal(serialize(f.preferences),before);assert.equal(JSON.stringify([...f.intrinsic]),shapeBefore);
});
test('native whole-tree translation does not affect the proposed relative gaps',()=>{
  const f=fixture(),original=workspaceAlternateSeeds(f.preferences,[f.contour]);
  const shifted=new Map([[7,new Map([...f.native].map(([id,p])=>[id,{x:p.x+1234,y:p.y+77}]))]]);
  const seeds=workspaceAlternateSeeds(shifted,[f.contour]);
  for(let i=0;i<2;i++)for(const [id,point]of seeds[i].get(7)){
    assert.equal(point.x-original[i].get(7).get(id).x,1234);
    assert.equal(point.y-original[i].get(7).get(id).y,77);
  }
});
test('all material incarnations use the same seed fraction without borrowing their Y grids',()=>{
  const f=fixture(),other=fixture('other/');other.contour.incarnation=8;
  const preferences=new Map([...f.preferences,[8,other.native]]);
  const seeds=workspaceAlternateSeeds(preferences,[f.contour,other.contour]);
  for(let i=0;i<2;i++){
    assert.equal(seeds[i].get(7).get('left').x,seeds[i].get(8).get('other/left').x);
    assert.equal(seeds[i].get(7).get('left').y,222);
    assert.equal(seeds[i].get(8).get('other/left').y,222);
  }
});
test('unary material keeps its native preferred pose',()=>{
  const f=fixture(),unary={...f.contour,id:'unary',incarnation:8,children:[{id:'word'}],members:map([['unary',0,0],['word',100,900]])};
  const native=map([['unary',400,12],['word',400,222]]),preferences=new Map([...f.preferences,[8,native]]);
  for(const seed of workspaceAlternateSeeds(preferences,[f.contour,unary]))assert.equal(seed.get(8),native);
});
test('already equal gap preferences produce no alternate attempts',()=>{
  const f=fixture();f.native.set('left',{x:480,y:222});f.native.set('right',{x:520,y:222});
  assert.deepEqual(workspaceAlternateSeeds(f.preferences,[f.contour]),[]);
});
for(const [name,change]of[
  ['missing native fork',f=>f.preferences.clear()],
  ['missing native child',f=>f.native.delete('left')],
  ['missing intrinsic child',f=>f.intrinsic.delete('left')],
  ['nonfinite native Y',f=>f.native.get('left').y=NaN],
  ['nonfinite intrinsic X',f=>f.intrinsic.get('left').x=NaN],
  ['reversed native order',f=>f.native.get('left').x=1000],
  ['reversed intrinsic order',f=>f.intrinsic.get('left').x=1000],
])test(`invalid complete preference refuses both seeds: ${name}`,()=>{
  const f=fixture();change(f);assert.deepEqual(workspaceAlternateSeeds(f.preferences,[f.contour]),[]);
});
test('a missing fork cannot silently produce a partial whole-plan seed',()=>{
  const f=fixture(),other=fixture('other/');other.contour.incarnation=8;
  assert.deepEqual(workspaceAlternateSeeds(f.preferences,[f.contour,other.contour]),[]);
});
test('repeated occurrences do not multiply seed count or apply the blend twice',()=>{
  const f=fixture(),once=workspaceAlternateSeeds(f.preferences,[f.contour]);
  const repeated=workspaceAlternateSeeds(f.preferences,Array(100).fill(f.contour));
  assert.equal(WORKSPACE_ALTERNATE_SEED_LIMIT,2);assert.equal(repeated.length,2);
  assert.deepEqual(repeated.map(serialize),once.map(serialize));
});
