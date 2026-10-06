import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';
const branch = (id, children) => ({ id, label: id, children }), part = id => branch(id, [{ id: id + 'Word', label: id, word: id }]);
function example(direction, variant = 'valid') {
    const a = () => part('a'), b = () => part('b'), forest = () => branch('workspace', [a(), b()]);
    const joined = () => branch('phrase', [a(), b()]);
    const host = joined();
    if (variant === 'hidden-ancestry')
        host.children[1] = branch('hidden', [b()]);
    const wrapper = branch('wrapper', [part('aHigh'), host]);
    const next = variant === 'unrelated' ? branch('workspace', [branch('wrapper', [joined()]), branch('otherWrapper', [part('aHigh')])]) : wrapper;
    const end = branch('outer', [part('bHigh'), branch('wrapper', [part('aHigh'), joined()])]);
    const canvases = [a(), forest(), forest(), joined(), next, end];
    const base = new Map();
    const link = { authoredRelationKey: variant === 'stale' ? '1:0' : '2:0', renderFamily: variant === 'nontrajectory' ? 'authored-anchor-link' : 'trajectory', priorSourceNodeId: variant === 'missing-source' ? 'missing' : 'a', witnessNodeId: variant === 'missing-witness' ? 'missing' : variant === 'same-landing' ? 'aHigh' : 'a', targetNodeId: variant === 'missing-landing' ? 'missing' : 'aHigh' };
    const scenes = canvases.map((canvas, index) => {
        const hierarchy = d3.hierarchy(canvas);
        applyVizIds(hierarchy);
        const visible = new Set(hierarchy.descendants().map(getNodeId).filter(id => id !== 'workspace' && id !== 'hidden'));
        const positions = new Map(hierarchy.descendants().map(n => { const id = getNodeId(n); const x = id === 'a' || id === 'aWord' ? (index < 2 ? 0 : 500) : id === 'b' || id === 'bWord' ? (index < 2 ? 500 : 1000) : id.startsWith('aHigh') ? 0 : id.startsWith('bHigh') ? -500 : 750; const y = id.endsWith('Word') ? 300 : ['a', 'b', 'aHigh', 'bHigh'].includes(id) ? 100 : -150; return [id, { x, y }]; }));
        base.set(canvas, positions);
        const nodes = new Map(hierarchy.descendants().filter(n => visible.has(getNodeId(n))).map(n => [getNodeId(n), Object.assign(n, { ...positions.get(getNodeId(n)), x: direction === 'rtl' ? 3000 - positions.get(getNodeId(n)).x : positions.get(getNodeId(n)).x })]));
        const step = index === 3 ? { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'phrase' } : index === 4 ? { replayKind: 'relation', operation: 'InternalMerge', replayRelationIdentity: { stageIndex: 2, relationIndex: 0 }, replayRelationLinks: [link] } : index === 5 ? { replayKind: 'relation', operation: 'InternalMerge', replayRelationIdentity: { stageIndex: 3, relationIndex: 0 }, replayRelationLinks: [{ authoredRelationKey: '3:0', renderFamily: 'trajectory', priorSourceNodeId: 'b', witnessNodeId: 'b', targetNodeId: 'bHigh' }] } : { replayKind: 'micro', operation: index ? 'LexicalSelect' : 'Project', targetNodeId: index ? 'b' : 'a' };
        return { canvas, nodes, coordinates: positions, size: [3000, 1000], step };
    });
    const cache = new Map(), created = [];
    const render = (scene, positions) => { let perScene = cache.get(scene); if (!perScene)
        cache.set(scene, perScene = new Map()); if (perScene.has(positions))
        return perScene.get(positions); const h = d3.hierarchy(scene.canvas); applyVizIds(h); const ns = h.descendants().filter(n => scene.nodes.has(getNodeId(n))).map(n => Object.assign(n, { ...positions.get(getNodeId(n)), x: direction === 'rtl' ? 3000 - positions.get(getNodeId(n)).x : positions.get(getNodeId(n)).x })); perScene.set(positions, ns); created.push([ns, ns.map(n => [getNodeId(n), n.x, n.y])]); return ns; };
    const output = reserveCompleteComponentLifetime(scenes, base, direction, 2, 'a', render, { throughRelations: true, carryUntilMovement: true });
    for (const [nodes, points] of created)
        assert.deepEqual(nodes.map(n => [getNodeId(n), n.x, n.y]), points, 'cache remains immutable');
    const delta = index => output.get(canvases[index]).get('b').x - base.get(canvases[index]).get('b').x;
    delta.relative = index => { let root = scenes[index].nodes.get('b'); while (root.parent && scenes[index].nodes.has(getNodeId(root.parent)))
        root = root.parent; const rootId = getNodeId(root), after = output.get(canvases[index]), before = base.get(canvases[index]); return (after.get('b').x - after.get(rootId).x) - (before.get('b').x - before.get(rootId).x); };
    return delta;
}
for (const direction of ['ltr', 'rtl']) {
    test(`${direction}: exact owned wrapper carries the selected source until its own movement`, () => { const delta = example(direction); assert(Math.abs(delta(1)) > 1); assert.equal(delta(3), delta(1), 'its ordinary merge keeps its slot'); assert.equal(delta(4), delta(3), 'an exact other movement adds only a containing wrapper'); assert.equal(delta(5), 0, 'its own movement ends clearance even if the unchanged lower copy remains pronounced'); });
    for (const variant of ['unrelated', 'stale', 'nontrajectory', 'missing-source', 'missing-witness', 'missing-landing', 'same-landing', 'hidden-ancestry'])
        test(`${direction}: ${variant} cannot extend source ownership`, () => { const delta = example(direction, variant); assert(Math.abs(delta(3)) > 1, 'the selected source was cleared through its valid join'); assert.equal(delta.relative(4), 0, 'the unproven owner change stops source clearance; rigid component placement is independent'); });
}
