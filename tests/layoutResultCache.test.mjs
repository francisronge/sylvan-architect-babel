import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutResultCache } from '../replay/layoutResultCache.ts';
import { measuredKey, measurePlaqueLayoutJob, runPlaqueLayoutJob, bindPlaqueLayoutResult } from '../replay/plaqueLayoutJob.ts';
const job = (key = 'original') => ({inputKey:key,requestKey:'1',measured:{categories:true,plaques:true},categories:new Map([['X',42]]),plaques:new Map(),treeLabels:new Map([['label',{x:-10,y:-50,width:20,height:50}]])});
const result = job => ({requestKey:job.requestKey,measurementKey:measuredKey(job),schedule:{stages:[],steps:new Map([[0,{value:'original'}]])},coordinates:new Map([[0,new Map([[0,new Map([['node',{x:100,y:200}]])]])]])});

test('an exact layout can be rebound to a fresh request without sharing mutable results',()=>{
 const cache=createLayoutResultCache(), a=job(), output=result(a); cache.put(a,output);
 output.coordinates.get(0).get(0).get('node').x=-1;
 const b=structuredClone(a);b.requestKey='2';const hit=cache.get(b);
 assert.equal(hit.requestKey,'2');assert.equal(hit.coordinates.get(0).get(0).get('node').x,100);
 hit.schedule.steps.get(0).value='mutated';hit.coordinates.clear();
 assert.equal(cache.get(b).schedule.steps.get(0).value,'original');assert.equal(cache.get(b).coordinates.size,1);
});
test('changed analysis, viewport or font values cannot reuse a previous layout',()=>{
 const cache=createLayoutResultCache(), a=job();cache.put(a,result(a));
 for(const changed of ['analysis changed','viewport changed','direction changed'])assert.equal(cache.get(job(changed)),undefined);
 const b=structuredClone(a);b.categories.set('X',43);assert.equal(cache.get(b),undefined);
 const c=structuredClone(a);c.treeLabels.get('label').width=30;assert.equal(cache.get(c),undefined);
 const d=structuredClone(a);d.categories.set('X',-0);cache.put(d,result(d));d.categories.set('X',0);assert.equal(cache.get(d),undefined);
});
test('retention is bounded to two recently used layouts and rejects oversized or mismatched receipts',()=>{
 const cache=createLayoutResultCache();for(const name of ['a','b']){const j=job(name);cache.put(j,result(j));}
 assert.ok(cache.get(job('a')));const c=job('c');cache.put(c,result(c));
 assert.equal(cache.get(job('b')),undefined);assert.ok(cache.get(job('a')));assert.ok(cache.get(c));
 const bad=job('bad'), wrong=result(bad);wrong.measurementKey='wrong';cache.put(bad,wrong);assert.equal(cache.get(bad),undefined);
 const large=job('x'.repeat(2_000_001));cache.put(large,result(large));assert.equal(cache.get(large),undefined);
});


test('a reused complete result binds only to the freshly measured canvas graph', () => {
  const canvas = { id: 'p', label: 'NP', children: [{ id: 'n', label: 'N', word: 'tree' }] };
  const makeInput = () => {
    const current = structuredClone(canvas);
    return { steps: [{ replayFrameIndex: 0, replayKind: 'macro', replayCanvasData: current,
      replayVisibleNodeIds: ['p', 'n'], replayRelationLinks: [] }], completedCanvas: current,
      width: 1280, height: 800, stageIndex: 0, plan: { frames: [{ items: [] }] } };
  };
  const measure = input => { const it = measurePlaqueLayoutJob(input); let next;
    do { next = it.next(); } while (!next.done); return next.value; };
  const first = makeInput(), firstJob = measure(first), result = runPlaqueLayoutJob(firstJob);
  const cache = createLayoutResultCache(); cache.put(firstJob, result);
  const second = makeInput(), secondJob = measure(second);
  const bound = bindPlaqueLayoutResult(second, secondJob, cache.get(secondJob));
  assert.ok(bound.coordinates.get(0).has(second.completedCanvas));
  assert.equal(bound.coordinates.get(0).has(first.completedCanvas), false);
  assert.deepEqual(bound.schedule, result.schedule);
  second.width = 900;
  assert.throws(() => bindPlaqueLayoutResult(second, secondJob, cache.get(secondJob)), /no longer matches/);
  assert.equal(cache.get(measure(second)), undefined);
});
