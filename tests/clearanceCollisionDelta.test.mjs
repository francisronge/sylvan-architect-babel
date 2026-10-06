import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { collisionAreas } from '../replay/workspaceComponentLifetime.ts';
import { treeInkObstacles } from '../replay/treeInkGeometry.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';
function word(id, x, y = 0) { const n = d3.hierarchy({ id, label: id, word: id }); applyVizIds(n); Object.assign(n, { x, y }); return n; }
const changed = (before, after) => [...after].some(([pair, area]) => area > (before.get(pair) ?? 0) + 1e-6);
for (const direction of [1, -1]) {
    test(`${direction}: unchanged native ink overlap alone cannot request clearance`, () => { const own = [word('source', 0)], other = [word('oldPeer', 20 * direction)]; const a = collisionAreas(own, other), b = collisionAreas(own, other); assert([...a.values()].some(n => n > 0)); assert(!changed(a, b)); });
    test(`${direction}: reducing an old collision cannot hide a new collision with another object`, () => { const own = [word('source', 0)], old = [word('oldPeer', 0), word('newPeer', 500 * direction)], next = [word('oldPeer', 500 * direction), word('newPeer', 180 * direction)]; const a = collisionAreas(own, old), b = collisionAreas(own, next); assert([...b.values()].reduce((x, y) => x + y, 0) < [...a.values()].reduce((x, y) => x + y, 0)); assert(changed(a, b)); assert(b.get(JSON.stringify(['source', 'newPeer'])) > 0); });
    test(`${direction}: native branch collisions belong to the exact current child`, () => { const h = d3.hierarchy({ id: 'parent', label: 'P', children: [{ id: 'child', label: 'child', word: 'child' }] }); applyVizIds(h); Object.assign(h, { x: 500 * direction, y: -250 }); Object.assign(h.children[0], { x: 500 * direction, y: 350 }); const own = [word('source', 0)], a = collisionAreas(own, h.descendants()); h.x = 0; h.children[0].x = 0; const before = h.descendants().map(n => [getNodeId(n), n.x, n.y]); const b = collisionAreas(own, h.descendants()); assert(changed(a, b)); assert(b.get(JSON.stringify(['source', 'child'])) > 0); assert.deepEqual(h.descendants().map(n => [getNodeId(n), n.x, n.y]), before); });
}

// Exhaustive rectangle comparison is the reference for the owner-level pruning.
function exhaustiveAreas(own, other) {
    const ink = nodes => {
        const included = new Set(nodes);
        return nodes.map(node => [getNodeId(node), [
            ...treeInkObstacles([node], undefined, undefined, false),
            ...(included.has(node.parent) ? plaqueTreeObstacles([node.parent, node], undefined, true).filter(rect => rect.curve) : [])
        ]]);
    };
    const result = new Map();
    for (const [aId, left] of ink(own)) for (const [bId, right] of ink(other)) {
        let area = 0;
        for (const a of left) for (const b of right) {
            const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            if (width > 0 && height > 0 && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding))
                && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding))) area += width * height;
        }
        if (area) result.set(JSON.stringify([aId, bId]), area);
    }
    return result;
}

for (const direction of [1, -1]) {
    test(`${direction}: owner pruning preserves every exact branch and label collision`, () => {
        const tree = d3.hierarchy({ id: 'root', label: 'CP', children: [
            { id: 'left', label: 'NP', children: [{ id: 'word', label: 'N', word: 'a long source word' }] },
            { id: 'right', label: 'VP', word: 'other' }
        ] });
        applyVizIds(tree);
        tree.descendants().forEach((node, i) => Object.assign(node, { x: direction * [0, -300, 400, -300][i], y: node.depth * 220 }));
        for (const shift of [-1000, -350, -1, 0, 150, 400, 1000]) {
            const own = [word('source', shift * direction, 190), word('high', 400 * direction, -1000), word('low', 0, 1500)];
            assert.deepEqual(collisionAreas(own, tree.descendants()), exhaustiveAreas(own, tree.descendants()));
        }
    });
}
