import test from 'node:test';
import assert from 'node:assert/strict';
import { correctWorkspaceClearancePreference, evaluateWorkspaceClearance,
  WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS, WORKSPACE_SEED_CLEARANCE_CORRECTIONS } from '../replay/workspaceClearancePreference.ts';

const encode = preferences => JSON.stringify([...preferences].map(([id,points])=>[id,[...points]]));
function fixture(prefix=''){
  const points=new Map([['parent',{x:0,y:0}],['a',{x:-100,y:210}],['b',{x:100,y:210}],['deep',{x:150,y:420}]]
    .map(([id,p])=>[prefix+id,p]));
  const untouched=new Map([['other',{x:500,y:700}]]);
  return {preferences:new Map([[7,points],[8,untouched]]),forks:new Map([[7,{incarnation:7,children:[{id:prefix+'a'},{id:prefix+'b'}]}]]),
    request:{incarnation:7,split:1,side:'both',increase:40},prefix};
}
for(const prefix of ['', 'opaque/'])for(const [side,expected]of[
  ['both',[-120,120]],['left',[-140,100]],['right',[-100,140]]
])test(`exact measured ${side} correction changes only the named fork (${prefix})`,()=>{
  const f=fixture(prefix),before=encode(f.preferences),next=correctWorkspaceClearancePreference(f.preferences,f.forks,{...f.request,side});
  assert.deepEqual([next.get(7).get(prefix+'a').x,next.get(7).get(prefix+'b').x],expected);
  assert.equal(next.get(8),f.preferences.get(8));
  for(const [id,p]of next.get(7))assert.equal(p.y,f.preferences.get(7).get(id).y);
  assert.deepEqual(next.get(7).get(prefix+'parent'),f.preferences.get(7).get(prefix+'parent'));
  assert.deepEqual(next.get(7).get(prefix+'deep'),f.preferences.get(7).get(prefix+'deep'));
  next.get(7).get(prefix+'a').x=999;assert.equal(encode(f.preferences),before);
});
for(const [name,change]of[
  ['unknown incarnation',f=>f.request.incarnation=99],
  ['foreign incarnation under the map key',f=>f.forks.get(7).incarnation=99],
  ['missing fork preference',f=>f.preferences.delete(7)],
  ['missing current child',f=>f.preferences.get(7).delete('a')],
  ['invalid side',f=>f.request.side='any'],
  ['zero split',f=>f.request.split=0],
  ['out-of-range split',f=>f.request.split=2],
  ['fractional split',f=>f.request.split=.5],
  ['nonfinite room',f=>f.request.increase=Infinity],
  ['negative room',f=>f.request.increase=-1],
  ['zero room',f=>f.request.increase=0],
  ['nonfinite point',f=>f.preferences.get(7).get('a').y=NaN],
])test(`refuses malformed measured correction: ${name}`,()=>{
  const f=fixture();change(f);const before=encode(f.preferences);
  assert.equal(correctWorkspaceClearancePreference(f.preferences,f.forks,f.request),undefined);
  assert.equal(encode(f.preferences),before);
});
test('sequential measured requests re-evaluate the complete candidate after each correction',()=>{
  const f=fixture(),before=encode(f.preferences),seen=[];
  const result=evaluateWorkspaceClearance(f.preferences,f.forks,WORKSPACE_SEED_CLEARANCE_CORRECTIONS,preferences=>{
    const a=preferences.get(7).get('a').x,b=preferences.get(7).get('b').x;seen.push([a,b]);
    if(a===-100)return {clearance:{...f.request,side:'left',increase:30}};
    if(b===100)return {clearance:{...f.request,side:'right',increase:15}};
    return {value:'fully checked'};
  });
  assert.deepEqual(seen,[[-100,100],[-130,100],[-130,115]]);
  assert.equal(result.value,'fully checked');assert.equal(result.evaluations,3);assert.equal(result.corrections,2);
  assert.equal(encode(f.preferences),before);
});
test('score, temporal or other rejection cannot cause an invented clearance retry',()=>{
  const f=fixture();let calls=0;
  const result=evaluateWorkspaceClearance(f.preferences,f.forks,WORKSPACE_SEED_CLEARANCE_CORRECTIONS,()=>{calls++;return {};});
  assert.equal(calls,1);assert.equal(result.preferences,f.preferences);assert.equal(result.corrections,0);assert.equal(result.value,undefined);
});
test('a successful candidate stops even if a callback also returns stale clearance',()=>{
  const f=fixture();let calls=0;
  const result=evaluateWorkspaceClearance(f.preferences,f.forks,WORKSPACE_SEED_CLEARANCE_CORRECTIONS,()=>{calls++;return {value:'valid',clearance:f.request};});
  assert.equal(calls,1);assert.equal(result.value,'valid');assert.equal(result.preferences,f.preferences);
});
test('the two alternate seeds permit at most eight corrections and ten total evaluations',()=>{
  const f=fixture();let calls=0,totalCorrections=0;
  for(let seed=0;seed<2;seed++){
    const result=evaluateWorkspaceClearance(f.preferences,f.forks,WORKSPACE_SEED_CLEARANCE_CORRECTIONS,()=>{calls++;return {clearance:f.request};});
    assert.equal(result.value,undefined);assert.equal(result.evaluations,5);assert.equal(result.corrections,4);totalCorrections+=result.corrections;
  }
  assert.equal(calls,10);assert.equal(totalCorrections,8);
});
test('the existing native correction budget remains eight',()=>{
  const f=fixture();let calls=0;
  const result=evaluateWorkspaceClearance(f.preferences,f.forks,WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS,()=>{calls++;return {clearance:f.request};});
  assert.equal(result.corrections,8);assert.equal(calls,9);
});
test('an untyped invalid budget cannot create an unbounded retry loop',()=>{
  const f=fixture();let calls=0;
  const result=evaluateWorkspaceClearance(f.preferences,f.forks,Infinity,()=>{calls++;return {clearance:f.request};});
  assert.equal(result.corrections,0);assert.equal(calls,1);
});
test('a correction below floating-point resolution stops instead of consuming retries',()=>{
  const f=fixture();let calls=0;
  const result=evaluateWorkspaceClearance(f.preferences,f.forks,WORKSPACE_SEED_CLEARANCE_CORRECTIONS,()=>{calls++;return {clearance:{...f.request,increase:Number.MIN_VALUE}};});
  assert.equal(calls,1);assert.equal(result.preferences,f.preferences);assert.equal(result.corrections,0);
});

for(const [side,expected]of[
  ['both',[-420,420]],['left',[-740,100]],['right',[-100,740]]
])test(`measured realized gap replaces a packed preference dead zone (${side})`,()=>{
  const f=fixture(),before=encode(f.preferences);
  const next=correctWorkspaceClearancePreference(f.preferences,f.forks,{...f.request,side,realizedGap:800});
  assert.deepEqual([next.get(7).get('a').x,next.get(7).get('b').x],expected);
  assert.equal(next.get(7).get('b').x-next.get(7).get('a').x,840);
  assert.equal(next.get(8),f.preferences.get(8));
  for(const [id,point]of next.get(7))assert.equal(point.y,f.preferences.get(7).get(id).y);
  assert.deepEqual(next.get(7).get('parent'),f.preferences.get(7).get('parent'));
  assert.deepEqual(next.get(7).get('deep'),f.preferences.get(7).get('deep'));
  assert.equal(encode(f.preferences),before);
});

test('a packed fork reaches its measured required room in one bounded full evaluation',()=>{
  const f=fixture('renamed/'),before=encode(f.preferences),gaps=[];
  const result=evaluateWorkspaceClearance(f.preferences,f.forks,WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS,preferences=>{
    const points=preferences.get(7),preferred=points.get('renamed/b').x-points.get('renamed/a').x;
    // Earlier child ink already requires1000; the later locked fork needs50 more.
    const realized=Math.max(1000,preferred);gaps.push(realized);
    return realized>=1050 ? {value:'all constraints checked'}
      : {clearance:{...f.request,realizedGap:realized,increase:1050-realized}};
  });
  assert.deepEqual(gaps,[1000,1050]);assert.equal(result.corrections,1);assert.equal(result.evaluations,2);
  assert.equal(result.value,'all constraints checked');assert.equal(encode(f.preferences),before);
});

test('a measured request retains the previous correction when no packing changed the gap',()=>{
  const f=fixture(),legacy=correctWorkspaceClearancePreference(f.preferences,f.forks,f.request);
  const measured=correctWorkspaceClearancePreference(f.preferences,f.forks,{...f.request,realizedGap:200});
  assert.equal(encode(measured),encode(legacy));
});

for(const [name,value]of[['zero',0],['negative',-1],['infinite',Infinity],['not a number',NaN]])
  test(`refuses an invalid realized gap: ${name}`,()=>{
    const f=fixture(),before=encode(f.preferences);
    assert.equal(correctWorkspaceClearancePreference(f.preferences,f.forks,{...f.request,realizedGap:value}),undefined);
    assert.equal(encode(f.preferences),before);
  });

test('a request already exceeded by its preference cannot add arbitrary room',()=>{
  const f=fixture(),before=encode(f.preferences);
  assert.equal(correctWorkspaceClearancePreference(f.preferences,f.forks,{...f.request,realizedGap:100}),undefined);
  assert.equal(encode(f.preferences),before);
});

test('an overflowing realized target is rejected without changing preferences',()=>{
  const f=fixture(),before=encode(f.preferences);
  assert.equal(correctWorkspaceClearancePreference(f.preferences,f.forks,{...f.request,realizedGap:Number.MAX_VALUE,increase:Number.MAX_VALUE}),undefined);
  assert.equal(encode(f.preferences),before);
});
