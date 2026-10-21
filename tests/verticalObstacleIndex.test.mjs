import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedObstacleIndex, verticalObstacleIndex } from '../replay/verticalObstacleIndex.ts';

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

const random = (seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2**32))(977);
// Rows and columns that touch, nest and coincide, with a few nonfinite values.
const grid = () => Array.from({ length: 400 }, (_, id) => ({ id, x: Math.floor(random() * 60) * 25 - 700 + (random() < 0.3 ? random() / 2 : 0),
  y: Math.floor(random() * 30) * 40 - 600,
  width: Math.floor(random() * 6) * 25, height: Math.floor(random() * 4) * 40 + (random() < 0.1 ? 1e-7 : 0) }))
  .concat([{ id: 'nan-x', x: NaN, y: 0, width: 10, height: 10 }, { id: 'wide', x: -Infinity, y: -50, width: Infinity, height: 100 },
    { id: 'huge', x: 2 ** 52, y: 0, width: 1, height: 1 }, { id: 'zero', x: -0, y: -0, width: 0, height: 40 }]);

test('an overlap-only query visits exactly the positively overlapping obstacles, in order', () => {
  const boxes = grid(), vertical = verticalObstacleIndex(boxes), both = verticalObstacleIndex(boxes, { overlapOnly: true });
  for (const box of [...boxes.slice(0, 120), { x: NaN, y: 0, width: 10, height: 10 }, { x: -Infinity, y: -40, width: Infinity, height: 80 }]) {
    for (const epsilon of [0, 1e-6]) {
      const accepts = other => Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x) > epsilon
        && Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y) > epsilon;
      const visits = query => { const found = []; query(box, other => { if (accepts(other)) found.push(other); return false; }); return found; };
      assert.deepEqual(visits(both), visits(vertical));
      let first;
      assert.equal(both(box, other => accepts(other) && (first = other, true)), visits(vertical).length > 0);
      assert.equal(first, visits(vertical)[0]);
    }
  }
});

test('a bounded query skips only the ranges its own bound excludes', () => {
  const boxes = grid(), index = boundedObstacleIndex(boxes);
  for (const box of boxes.slice(0, 150)) {
    // The forbidden-shift test: an interval that contains or touches zero.
    const touches = other => !(Math.min(box.y + box.height, other.y + other.height) <= Math.max(box.y, other.y))
      && other.x - box.x - box.width <= 0 && other.x + other.width - box.x >= 0;
    const found = [];
    index(box, other => { if (touches(other)) found.push(other); return false; },
      (left, right) => !(left - box.x - box.width > 0 || right - box.x < 0));
    assert.deepEqual(found, boxes.filter(other => !(box.y + box.height <= other.y || box.y >= other.y + other.height) && touches(other)));
  }
});
