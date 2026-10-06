import test from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from '../node_modules/d3/src/index.js';
import { planCoherentWorkspace } from '../replay/workspaceCoherentPlan.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
const stringify = value => JSON.stringify(value, (_, item) => item instanceof Map ? [...item] : item);
function fixture({ prefix = '', unary = false, direction = 'ltr', stationary = false, wordChange = false, silentChange = false } = {}) {
    const id = value => prefix + value;
    const leaf = (name, word) => ({ id: id(name), label: word, word });
    const branch = () => ({ id: id('root'), label: 'XP', children: [unary ? { id: id('left'), label: 'X′', children: [leaf('leftWord', 'one')] } : leaf('left', 'one'), leaf('right', 'two')] });
    const first = { id: id('forest'), label: 'Workspace', replayOrigin: { kind: 'workspace' }, children: [branch()] };
    const second = structuredClone(first);
    second.children.push(leaf('fresh', 'new'));
    if (wordChange)
        second.children[0].children[1].word = 'changed';
    if (silentChange)
        second.children[0].children[1].silent = true;
    const original = [first, second];
    const render = (scene, reservations) => {
        const root = d3.hierarchy(scene.canvas);
        applyVizIds(root);
        const visible = new Set(scene.step.replayVisibleNodeIds);
        return layoutSyntaxTree(root, scene.size, direction, reservations, visible).descendants().filter(node => visible.has(getNodeId(node)));
    };
    const baseline = new Map();
    const scenes = original.map((canvas, index) => {
        const root = d3.hierarchy(canvas);
        applyVizIds(root);
        const nodes = root.descendants().filter(node => node.data.replayOrigin?.kind !== 'workspace');
        const step = { replayCanvasData: canvas, replayVisibleNodeIds: nodes.map(getNodeId), replayKind: 'micro', replayFrameIndex: index, replayStageStepIndex: index, operation: 'LexicalSelect', targetNodeId: id(index ? 'fresh' : 'root') };
        const x = index && !stationary ? 1000 : 0;
        const points = new Map([[id('root'), { x, y: 0 }], [id('left'), { x: x - 300, y: 300 }], [id('right'), { x: x + 300, y: 300 }], [id('fresh'), { x: 2500, y: 0 }]]);
        if (unary)
            points.set(id('leftWord'), { x: x - 300, y: 600 });
        const scene = { step, canvas, size: [4000, 1200], nodes: new Map(), coordinates: points };
        scene.nodes = new Map(render(scene, points).map(node => [getNodeId(node), node]));
        baseline.set(canvas, points);
        return scene;
    });
    return { id, scenes, baseline, render, original, direction };
}
function run(input, metrics) { return planCoherentWorkspace(input.scenes, input.baseline, input.direction, input.render, metrics); }
function current(input, result, index) { return new Map(input.render(input.scenes[index], result.coordinates.get(input.scenes[index].canvas)).map(node => [getNodeId(node), node])); }
test('a renderer rejection at native-rank stopping continues refinement and retained-plan fallback', () => {
    const ordinary = fixture();
    ordinary.scenes.forEach(scene => { scene.currentRowHeight = 210; });
    const accepted = run(ordinary);
    assert.equal(accepted.diagnostic.status, 'resolved');
    const input = fixture();
    input.scenes.forEach(scene => { scene.currentRowHeight = 210; });
    const render = input.render;
    let rejected = false, replacementCalls = 0;
    input.render = (scene, reservations) => {
        const nodes = render(scene, reservations);
        if (reservations !== input.baseline.get(scene.canvas)) {
            replacementCalls++;
            if (!rejected) { rejected = true; nodes.find(node => getNodeId(node) === 'root').x += 1; }
        }
        return nodes;
    };
    const result = run(input);
    assert.equal(result.diagnostic.status, 'resolved');
    assert.equal(rejected, true);
    assert.ok(replacementCalls > input.scenes.length, 'the rejected render must not end the search');
    assert.ok(result.diagnostic.evaluations > accepted.diagnostic.evaluations, 'remaining proposals still run');
    assert.deepEqual([...result.coordinates.values()].map(map => [...map]), [...accepted.coordinates.values()].map(map => [...map]));
});
for (const direction of ['ltr', 'rtl'])
    for (const unary of [false, true])
        test(`retains current syntax across unrelated selection (${direction}, unary=${unary})`, () => {
            const input = fixture({ direction, unary }), source = stringify(input.original), maps = stringify(input.baseline), result = run(input);
            assert.equal(result.diagnostic.status, 'resolved');
            assert.equal(result.diagnostic.reflows.length, 1);
            const a = current(input, result, 0), b = current(input, result, 1);
            for (const [id, node] of a) {
                assert.equal(b.get(id).x, node.x);
                assert.equal(b.get(id).y, node.y);
            }
            assert.equal(stringify(input.original), source);
            assert.equal(stringify(input.baseline), maps);
        });
for (const direction of ['ltr', 'rtl'])
    test(`opaque renaming preserves geometry (${direction})`, () => {
        const original = fixture({ direction, unary: true }), renamed = fixture({ direction, unary: true, prefix: 'arbitrary-name/' }), a = run(original), b = run(renamed);
        assert.equal(a.diagnostic.status, 'resolved');
        assert.equal(b.diagnostic.status, 'resolved');
        for (let i = 0; i < 2; i++)
            for (const [id, p] of current(original, a, i)) {
                const other = current(renamed, b, i).get('arbitrary-name/' + id);
                assert.deepEqual({ x: other.x, y: other.y }, { x: p.x, y: p.y });
            }
    });
test('valid plans return by identity before metric or contour work', () => {
    const input = fixture({ stationary: true });
    const fail = () => { throw Error('must not measure'); };
    const result = run(input, { measureCategoryText: fail, measureTreeInk: fail, measureTreeLabel: fail });
    assert.equal(result.coordinates, input.baseline);
    assert.equal(result.diagnostic.status, 'unchanged');
    assert.equal(result.diagnostic.evaluations, 0);
});
for (const field of ['wordChange', 'silentChange'])
    test(`authored ${field} starts a distinct material lifetime`, () => {
        const input = fixture({ [field]: true, stationary: true }), result = run(input);
        assert.equal(result.coordinates, input.baseline);
        assert.equal(result.diagnostic.status, 'unchanged');
    });
test('a shared canvas with incompatible reflected stage sizes is explicitly infeasible', () => {
    const input = fixture({ direction: 'rtl' }), shared = input.scenes[1].canvas, points = input.scenes[1].coordinates;
    input.scenes[0].canvas = shared;
    input.scenes[0].step.replayCanvasData = shared;
    input.scenes[0].coordinates = points;
    input.scenes[1].size = [5000, 1200];
    input.baseline = new Map([[shared, points]]);
    input.scenes.forEach(scene => scene.nodes = new Map(input.render(scene, points).map(node => [getNodeId(node), node])));
    const source = stringify(input.original), maps = stringify(input.baseline), result = run(input);
    assert.equal(result.diagnostic.status, 'infeasible');
    assert.equal(result.coordinates, input.baseline);
    assert.equal(stringify(input.original), source);
    assert.equal(stringify(input.baseline), maps);
});
for (const field of ['word', 'silent'])
    test(`unowned PF ${field} keeps its loose component fixed during another repair`, () => {
        const input = fixture();
        input.original.forEach((canvas, index) => {
            canvas.children.push({ id: 'spoken', label: 'spoken', word: index && field === 'word' ? 'spoken differently' : 'spoken', ...(field === 'silent' ? { silent: Boolean(index) } : {}) });
            const scene = input.scenes[index];
            scene.step.replayVisibleNodeIds.push('spoken');
            scene.coordinates.set('spoken', { x: 2500 + index * 300, y: 900 });
            if (index) {
                scene.step.replayKind = 'relation';
                scene.step.operation = 'PF';
            }
            scene.nodes = new Map(input.render(scene, scene.coordinates).map(node => [getNodeId(node), node]));
        });
        const source = stringify(input.original), result = run(input);
        assert.equal(result.diagnostic.status, 'resolved');
        const a = current(input, result, 0).get('spoken'), b = current(input, result, 1).get('spoken');
        assert.equal(a.x, b.x);
        assert.equal(a.y, b.y);
        assert.equal(stringify(input.original), source);
    });
test('repair keeps actual owned movement separate from unowned stationary syntax', () => {
    const input = fixture();
    input.original[0].children.push({ id: 'source', label: 'N', word: 'spoken source' });
    input.original[1].children.push({ id: 'source', label: 'N', word: 'lower copy' }, { id: 'landing', label: 'N', word: 'spoken source' });
    for (const [index, scene] of input.scenes.entries()) {
        scene.step.replayVisibleNodeIds.push('source');
        scene.coordinates.set('source', { x: 500, y: 900 });
        if (index) {
            scene.step.replayVisibleNodeIds.push('landing');
            scene.coordinates.set('landing', { x: 2500, y: 900 });
            scene.step.replayKind = 'relation';
            scene.step.replayRelationIdentity = { stageIndex: 1, relationIndex: 0 };
            scene.step.replayRelationLinks = [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }];
        }
        scene.nodes = new Map(input.render(scene, scene.coordinates).map(node => [getNodeId(node), node]));
    }
    const source = stringify(input.original), result = run(input);
    assert.equal(result.diagnostic.status, 'resolved');
    const before = current(input, result, 0), after = current(input, result, 1);
    for (const id of ['root', 'left', 'right'])
        assert.deepEqual({ x: before.get(id).x, y: before.get(id).y }, { x: after.get(id).x, y: after.get(id).y });
    assert.ok(Math.hypot(after.get('landing').x - before.get('source').x, after.get('landing').y - before.get('source').y) > 1);
    assert.equal(before.get('source').data.word, 'spoken source');
    assert.equal(after.get('source').data.word, 'lower copy');
    assert.equal(stringify(input.original), source);
});

for (const [name, kind, key] of [
    ['current trajectory', 'trajectory', '1:0'],
    ['stale trajectory', 'trajectory', '0:0'],
    ['nonmovement relation', 'authored-anchor-link', '1:0'],
]) test(`only exact current movement may exempt the observed root (${name})`, () => {
    const input = fixture();
    const step = input.scenes[1].step;
    step.replayKind = 'relation';
    step.replayRelationIdentity = { stageIndex: 1, relationIndex: 0 };
    step.replayRelationLinks = [{ authoredRelationKey: key, renderFamily: kind,
        priorSourceNodeId: 'root', witnessNodeId: 'root', targetNodeId: 'fresh' }];
    const result = run(input);
    if (name === 'current trajectory') {
        assert.equal(result.diagnostic.status, 'unchanged');
        assert.equal(result.coordinates, input.baseline);
    } else {
        assert.equal(result.diagnostic.status, 'resolved');
        const before = current(input, result, 0).get('root');
        const after = current(input, result, 1).get('root');
        assert.deepEqual({ x: before.x, y: before.y }, { x: after.x, y: after.y });
    }
});
