import test from 'node:test';
import assert from 'node:assert/strict';
import { verticalObstacleIndex } from '../replay/verticalObstacleIndex.ts';

test('vertical broad phase retains exact collision order across interleaved short and spanning obstacles', () => {
  let seed = 731;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2**32);
  const boxes = Array.from({length: 320}, (_, id) => ({id, y: Math.floor(random()*4000)-2000, height: random()*500}));
  boxes.splice(3,0,{id:'spanning', y:-4000,height:8000});
  const query=verticalObstacleIndex(boxes);
  for(let i=0;i<60;i++) {
    const box={y:random()*6000-3000,height:random()*80};
    const expected=boxes.filter(other => Math.min(box.y+box.height,other.y+other.height)-Math.max(box.y,other.y)>1e-6);
    const actual=[];
    query(box,other=>{if(Math.min(box.y+box.height,other.y+other.height)-Math.max(box.y,other.y)>1e-6)actual.push(other);return false;});
    assert.deepEqual(actual,expected);
    let first;
    const found=query(box,other=>{if(Math.min(box.y+box.height,other.y+other.height)-Math.max(box.y,other.y)>1e-6){first=other;return true;}return false;});
    assert.equal(found,expected.length>0);assert.equal(first,expected[0]);
  }
});
test('touching boundaries, huge coordinates and nonfinite entries retain the original predicate result', () => {
  const boxes=[{y:0,height:1},{y:1,height:2},{y:1e20,height:30000},{y:NaN,height:1},{y:-Infinity,height:Infinity},{y:Infinity,height:1},{y:-0,height:0}];
  const query=verticalObstacleIndex(boxes);
  for(const box of boxes) {
    const exact=other=>Math.min(box.y+box.height,other.y+other.height)-Math.max(box.y,other.y)>0;
    const found=[];query(box,other=>{if(exact(other))found.push(other);return false;});
    assert.deepEqual(found,boxes.filter(exact));
  }
  assert.equal(verticalObstacleIndex([])({y:0,height:1},()=>true),false);
});
