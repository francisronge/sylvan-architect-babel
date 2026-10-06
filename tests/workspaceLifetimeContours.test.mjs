import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceLifetimeContours, workspaceLifetimeContourCoordinates, prepareWorkspaceLifetimeContours } from '../replay/workspaceLifetimeContours.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';
const atom = (id, word = id) => ({ id, label: 'N', word });
const fork = (id, ...children) => ({ id, label: 'P', children });
const forest = (...children) => ({ id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' }, children });
const ids = node => [node.id, ...(node.children ?? []).flatMap(ids)];
const step = (canvas, visible = ids(canvas)) => ({ replayCanvasData: canvas, replayVisibleNodeIds: visible, replayKind: 'micro', replayFrameIndex: 0 });
test('an invisible owner cannot normalize a separate visible word workspace', () => {
  const canvas = spelling => ({ id: 'owner', label: 'D', word: 'the', children: [
    { id: 'word', label: spelling, word: spelling, replayOrigin: { kind: 'word', ownerId: 'owner' } }
  ] });
  const a = canvas('The'), b = canvas('the');
  const hidden = buildWorkspaceLifetimeContours([step(a, ['word']), step(b, ['word'])]);
  assert.notEqual(hidden[0].nodes.get('word').incarnation, hidden[1].nodes.get('word').incarnation);
  const connected = buildWorkspaceLifetimeContours([step(a), step(b)]);
  assert.equal(connected[0].nodes.get('word').incarnation, connected[1].nodes.get('word').incarnation);
});
const round = n => Math.round(n * 1e8) / 1e8;
const relative = (shape, id) => [round(shape.members.get(id).x), round(shape.members.get(id).y)];
function shifted(rect, p) { return { ...rect, x: rect.x + p.x, y: rect.y + p.y, ...(rect.curve ? { curve: Object.fromEntries(Object.entries(rect.curve).map(([k, v]) => [k, { x: v.x + p.x, y: v.y + p.y }])) } : {}) }; }
function overlap(a, b) { const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y); return w > 1e-6 && h > 1e-6 && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding)) && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding)); }
function geometry(frames) { for (const shape of new Set(frames.flatMap(f => [...f.nodes.values()]))) {
    const children = shape.children;
    let prior = -Infinity, y;
    for (const child of children) {
        const p = shape.members.get(child.id);
        assert.ok(p.y > 0);
        assert.ok(p.x > prior);
        prior = p.x;
        if (y !== undefined)
            assert.equal(p.y, y);
        y = p.y;
        for (const [id, q] of child.members) {
            const actual = shape.members.get(id);
            assert.ok(Math.abs(actual.x - p.x - q.x) < 1e-8);
            assert.ok(Math.abs(actual.y - p.y - q.y) < 1e-8);
        }
    }
    for (let i = 0; i < children.length; i++)
        for (let j = i + 1; j < children.length; j++) {
            const a = children[i].obstacles.map(r => shifted(r, shape.members.get(children[i].id))), b = children[j].obstacles.map(r => shifted(r, shape.members.get(children[j].id)));
            assert.equal(a.some(x => b.some(y => overlap(x, y))), false, `current sibling ink at ${shape.id}`);
        }
} }
test('complete unchanged child shape survives new outside material and rigid attachment', () => { const old = fork('np', atom('d', 'the'), fork('nbar', atom('n', 'painting'), fork('cp', atom('c', 'that'), atom('v', 'fell')))); const steps = [step(old), step(forest(old, atom('t', 'was'))), step(fork('tp', old, atom('t', 'was')))]; const before = JSON.stringify(steps); const frames = buildWorkspaceLifetimeContours(steps); assert.equal(frames[0].nodes.get('np'), frames[1].nodes.get('np')); assert.equal(frames[1].nodes.get('np'), frames[2].nodes.get('np')); geometry(frames); assert.equal(JSON.stringify(steps), before); });
test('a new parent does not lend its rank to the current fork', () => { const a = atom('a'), b = atom('b'); const frames = buildWorkspaceLifetimeContours([step(fork('p', a, b)), step(fork('p', fork('wrapper', a, b)))]); const early = frames[0].nodes.get('p'), late = frames[1].nodes.get('p'); assert.notEqual(early, late); assert.equal(early.members.has('wrapper'), false); assert.equal(early.members.get('a').y, 220); assert.equal(late.members.get('a').y, 440); assert.equal(frames[0].nodes.get('a'), frames[1].nodes.get('a')); geometry(frames); });
test('unavailable workspace material supplies no current spacing', () => { const current = fork('p', atom('a'), atom('b')); const future = fork('future', atom('large', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), atom('other')); const frames = buildWorkspaceLifetimeContours([step(current), step(forest(current, future), ids(current))]); assert.equal(frames[0].nodes.get('p'), frames[1].nodes.get('p')); assert.deepEqual([...workspaceLifetimeContourCoordinates(frames).get(frames[1].step.replayCanvasData).keys()].sort(), ids(current).sort()); geometry(frames); });
test('changed current child list begins a new incarnation without rescaling retained children', () => { const left = fork('left', atom('l1'), atom('l2')); const right = fork('right', atom('r1')); const frames = buildWorkspaceLifetimeContours([step(fork('p', left, right)), step(fork('p', left, fork('right', atom('r1'), atom('r2'))))]); assert.notEqual(frames[0].nodes.get('p'), frames[1].nodes.get('p')); assert.equal(frames[0].nodes.get('left'), frames[1].nodes.get('left')); assert.notEqual(frames[0].nodes.get('right'), frames[1].nodes.get('right')); geometry(frames); });
test('one lifetime reserves its maximum exact label footprint before first display', () => { const a = atom('a'), b = atom('b'), c0 = fork('p', a, b), c1 = structuredClone(c0), steps = [step(c0), step(c1)]; const labels = new Map([[c0, new Map([['a', [{ kind: 'terminal', width: 170 }]]])], [c1, new Map([['a', [{ kind: 'terminal', width: 570 }]]])]]); const frames = buildWorkspaceLifetimeContours(steps, undefined, undefined, labels, run => ({ x: -run.width / 2, y: 65, width: run.width, height: 110 })); assert.equal(frames[0].nodes.get('p'), frames[1].nodes.get('p')); const aShape = frames[0].nodes.get('a'); assert.ok(aShape.obstacles.some(r => r.width >= 570)); const p = frames[0].nodes.get('p'); assert.ok(p.members.get('b').x - p.members.get('a').x >= 376); geometry(frames); });
test('material change or disappearance does not reuse a stale lifetime', () => { const frames = buildWorkspaceLifetimeContours([step(atom('a', 'small')), step(atom('a', 'a much longer material')), step(atom('other')), step(atom('a', 'small'))]); assert.notEqual(frames[0].nodes.get('a'), frames[1].nodes.get('a')); assert.notEqual(frames[0].nodes.get('a'), frames[3].nodes.get('a')); assert.equal(frames[0].nodes.get('a').last, 0); assert.equal(frames[3].nodes.get('a').first, 3); });
test('movement occurrence changes reuse the exact current child contours', () => { const inside = fork('nbar', atom('noun', 'painting'), fork('relative', atom('subject', 'students'), atom('verb', 'restored'))); const before = fork('source', atom('d', 'the'), inside), after = forest(atom('source', 'trace'), fork('landing', atom('d', 'the'), inside)); const frames = buildWorkspaceLifetimeContours([step(before), step(after)]); assert.equal(frames[0].nodes.get('nbar'), frames[1].nodes.get('nbar')); const old = frames[0].nodes.get('source'), now = frames[1].nodes.get('landing'); for (const id of ['d', 'nbar', 'noun', 'relative', 'subject', 'verb'])
    assert.deepEqual(relative(old, id), relative(now, id)); geometry(frames); });
test('coordinate translations cannot mutate reusable shape templates', () => { const frames = buildWorkspaceLifetimeContours([step(fork('p', atom('a'), atom('b')))]); const shape = frames[0].nodes.get('p'), before = relative(shape, 'a'), coords = workspaceLifetimeContourCoordinates(frames); coords.get(frames[0].step.replayCanvasData).get('a').x += 1000; assert.deepEqual(relative(shape, 'a'), before); assert.deepEqual(relative(shape, 'p'), [0, 0]); });
test('a complete existing pose can be selected without changing its rigid children', () => { const steps = [step(fork('p', fork('left', atom('a'), atom('b')), atom('right')))], initial = buildWorkspaceLifetimeContours(steps), root = initial[0].nodes.get('p'); const chosen = new Map([...root.members].map(([id, p]) => [id, { x: p.x + 100, y: p.y + 80 }])); const left = root.children[0], dx = -250; for (const id of left.members.keys())
    chosen.get(id).x += dx; chosen.set('p', { x: chosen.get('p').x + dx / 2, y: 80 }); const selected = buildWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, new Map([[root.incarnation, chosen]])); assert.equal(selected[0].nodes.get('p').members.get('p').x, 0); for (const [id, p] of left.members) {
    const own = selected[0].nodes.get('p').members.get(id), offset = selected[0].nodes.get('p').members.get('left');
    assert.ok(Math.abs(own.x - offset.x - p.x) < 1e-8);
} geometry(selected); });
test('selected parent cannot borrow a different grid for a retained child', () => { const steps = [step(fork('p', fork('left', atom('a'), atom('b')), atom('right')))], initial = buildWorkspaceLifetimeContours(steps), root = initial[0].nodes.get('p'); const selected = new Map([...root.members].map(([id, p]) => [id, { ...p }])); selected.get('a').x -= 40; assert.throws(() => buildWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, new Map([[root.incarnation, selected]])), /changes child/); });
test('selected reference cannot reveal future material or omit current members', () => { const steps = [step(fork('p', atom('a'), atom('b')))], root = buildWorkspaceLifetimeContours(steps)[0].nodes.get('p'); for (const mode of ['extra', 'missing']) {
    const selected = new Map(root.members);
    if (mode === 'extra')
        selected.set('future', { x: 0, y: 10 });
    else
        selected.delete('a');
    assert.throws(() => buildWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, new Map([[root.incarnation, selected]])), /Incomplete/);
} });
test('selected complete pose must retain order and painted sibling clearance', () => { const steps = [step(fork('p', atom('a', 'a long word'), atom('b', 'another long word')))], root = buildWorkspaceLifetimeContours(steps)[0].nodes.get('p'); const reverse = new Map(root.members); reverse.set('a', { x: 10, y: 220 }); reverse.set('b', { x: -10, y: 220 }); assert.throws(() => buildWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, new Map([[root.incarnation, reverse]])), /Invalid selected fork/); const overlap = new Map(root.members); overlap.set('a', { x: -10, y: 220 }); overlap.set('b', { x: 10, y: 220 }); assert.throws(() => buildWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, new Map([[root.incarnation, overlap]])), /overlaps children/); });
function preferredComposition(steps, alter) {
    const initial = buildWorkspaceLifetimeContours(steps), preferred = new Map();
    for (const shape of initial.flatMap(frame => [...frame.nodes.values()]))
        if (!preferred.has(shape.incarnation)) {
            const positions = new Map([...shape.members].map(([id, p]) => [id, { ...p }]));
            for (const child of shape.children)
                positions.get(child.id).x *= 4;
            preferred.set(shape.incarnation, positions);
        }
    alter?.(initial, preferred);
    return buildWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, undefined, { inheritCurrentSlots: true, preferred });
}
function receivingHostSteps(options = {}) {
    const host = fork('host', atom('hostWord', 'file'));
    const before = fork('p', host, atom('source', 'the source'), atom('bystander'));
    const wrapper = fork('wrapper', host, atom('landing', 'the source'));
    const after = fork('p', wrapper, atom('source', 'trace'), atom('bystander'));
    const next = step(after);
    next.replayKind = options.structural ? 'micro' : 'relation';
    next.replayRelationIdentity = { stageIndex: 1, relationIndex: 0 };
    next.replayRelationLinks = [{ authoredRelationKey: options.stale ? '0:0' : '1:0', renderFamily: options.nonmovement ? 'authored-anchor-link' : 'trajectory', priorSourceNodeId: options.missingSource ? 'absent' : 'source', witnessNodeId: options.missingWitness ? 'absent' : options.sameWitness ? 'landing' : 'source', targetNodeId: 'landing' }];
    return [step(before), next];
}
test('changing shell retains unchanged child slots despite different reference preferences', () => {
    const left = fork('left', atom('a'), atom('b')), right = fork('right', atom('c'));
    const steps = [step(fork('p', left, right)), step(fork('p', { ...left, label: 'Changed' }, right))];
    const frames = preferredComposition(steps, (initial, preferred) => { const later = initial[1].nodes.get('p'); preferred.get(later.incarnation).get('right').x += 900; });
    for (const id of ['left', 'a', 'b', 'right', 'c'])
        assert.deepEqual(relative(frames[0].nodes.get('p'), id), relative(frames[1].nodes.get('p'), id));
    geometry(frames);
});
test('owning movement may translate a rigid receiving host under its new wrapper', () => {
    const steps = receivingHostSteps(), input = JSON.stringify(steps), frames = preferredComposition(steps);
    assert.equal(frames[0].nodes.get('host'), frames[1].nodes.get('host'));
    assert.deepEqual(relative(frames[0].nodes.get('host'), 'hostWord'), relative(frames[1].nodes.get('host'), 'hostWord'));
    const before = frames[0].nodes.get('p'), after = frames[1].nodes.get('p');
    assert.equal(after.members.get('host').y, before.members.get('host').y + 220);
    assert.equal(after.members.get('source').y, before.members.get('source').y);
    assert.equal(after.members.get('wrapper').y, before.members.get('host').y);
    assert.equal(JSON.stringify(steps), input);
    geometry(frames);
});
for (const [name, options] of [
    ['stale relation', { stale: true }], ['nontrajectory relation', { nonmovement: true }], ['structural step', { structural: true }],
    ['missing prior source', { missingSource: true }], ['missing current witness', { missingWitness: true }], ['landing reused as witness', { sameWitness: true }]
])
    test(`receiving host cannot acquire free slots from ${name}`, () => assert.throws(() => preferredComposition(receivingHostSteps(options)), /Incompatible current ranks/));
test('clear preferred sibling slots do not require extra cosmetic padding', () => {
    const tree = fork('p', atom('a'), atom('b')), steps = [step(tree)], frames = preferredComposition(steps, (initial, preferred) => {
        const root = initial[0].nodes.get('p'), a = root.children[0], b = root.children[1];
        const right = Math.max(...a.obstacles.filter(r => !r.curve).map(r => r.x + r.width)), left = Math.min(...b.obstacles.filter(r => !r.curve).map(r => r.x));
        const distance = right - left + 8, p = preferred.get(root.incarnation);
        p.get('a').x = -distance / 2;
        p.get('b').x = distance / 2;
    });
    const root = frames[0].nodes.get('p'), a = root.children[0], b = root.children[1];
    const right = Math.max(...a.obstacles.filter(r => !r.curve).map(r => r.x + r.width)) + root.members.get('a').x, left = Math.min(...b.obstacles.filter(r => !r.curve).map(r => r.x)) + root.members.get('b').x;
    assert.equal(round(left - right), 8);
    geometry(frames);
});
function changedLowerSlots(options = {}) {
    const source = fork('source', atom('sourceA'), atom('sourceB')), peer = fork('peer', atom('peerWord'));
    const before = fork('p', source, peer), after = fork('p', options.unchanged ? source : { ...source, label: 'Lower copy' }, peer);
    const next = step(forest(after, fork('landing', atom('landingA'), atom('landingB'))));
    next.replayKind = options.structural ? 'micro' : 'relation';
    next.replayRelationIdentity = { stageIndex: 1, relationIndex: 0 };
    next.replayRelationLinks = [{ authoredRelationKey: options.stale ? '0:0' : '1:0', renderFamily: options.nonmovement ? 'authored-anchor-link' : 'trajectory', priorSourceNodeId: options.missingSource ? 'absent' : 'source', witnessNodeId: options.missingWitness ? 'absent' : options.sameWitness ? 'landing' : 'source', targetNodeId: 'landing' }];
    const steps = [step(before), next], frames = preferredComposition(steps, (initial, preferred) => {
        const old = initial[0].nodes.get('p'), now = initial[1].nodes.get('p');
        preferred.get(old.incarnation).get('source').x = -2000;
        preferred.get(old.incarnation).get('peer').x = 2000;
        if (old !== now) {
            preferred.get(now.incarnation).get('source').x = -1000;
            preferred.get(now.incarnation).get('peer').x = 2000;
            if (options.align) {
                const next = preferred.get(now.incarnation);
                next.get('p').x = 10000;
                next.get('source').x = 9000;
                next.get('peer').x = 11000;
            }
        }
    });
    geometry(frames);
    return frames;
}
test('exact owning movement may recompose only the changed lower occurrence slot', () => {
    const frames = changedLowerSlots(), old = frames[0].nodes.get('p'), now = frames[1].nodes.get('p');
    assert.equal(old.members.get('peer').x - old.members.get('source').x, 4000);
    assert.equal(now.members.get('peer').x - now.members.get('source').x, 3000);
    for (const id of ['sourceA', 'sourceB']) {
        assert.equal(frames[0].nodes.get(id), frames[1].nodes.get(id));
        assert.equal(old.members.get(id).x - old.members.get('source').x, now.members.get(id).x - now.members.get('source').x);
    }
    assert.equal(frames[0].nodes.get('peer'), frames[1].nodes.get('peer'));
});
for (const [name, options] of [
    ['unchanged lower material', { unchanged: true }], ['stale relation', { stale: true }], ['nontrajectory relation', { nonmovement: true }],
    ['structural step', { structural: true }], ['missing prior source', { missingSource: true }], ['missing current witness', { missingWitness: true }], ['landing reused as witness', { sameWitness: true }]
])
    test(`changed lower slot is not freed by ${name}`, () => {
        const frames = changedLowerSlots(options), now = frames[1].nodes.get('p');
        assert.equal(now.members.get('peer').x - now.members.get('source').x, 4000);
    });
test('free preferred slots align to the locked witness coordinate origin', () => {
    const frames = changedLowerSlots({ align: true }), now = frames[1].nodes.get('p');
    assert.equal(now.members.get('peer').x - now.members.get('source').x, 2000);
});
test('a changed parent may sit above a retained complete fork without borrowing its rank', () => {
    const a = atom('a'), b = atom('b'), steps = [step(fork('p', a, b)), step(fork('p', fork('wrapper', a, b)))];
    const frames = preferredComposition(steps), old = frames[0].nodes.get('p'), next = frames[1].nodes.get('p');
    assert.equal(old.members.get('a').y, 220);
    assert.equal(next.members.get('wrapper').y, 220);
    for (const id of ['a', 'b']) {
        assert.equal(next.members.get(id).y - 220, old.members.get(id).y);
        assert.equal(next.members.get(id).x, old.members.get(id).x);
    }
    geometry(frames);
});
function ordinaryWrapperFrames(options = {}) {
    const host = fork('host', atom('word')), peer = atom('bystander'), partner = atom('partner');
    const before = forest(fork('p', host, peer), ...(options.missingSource ? [] : [partner]));
    const after = fork('p', fork('wrapper', options.changedHost ? { ...host, label: 'Changed host' } : host, partner), peer);
    const next = step(after);
    next.operation = options.wrongOperation ? 'LexicalSelect' : 'ExternalMerge';
    next.replayKind = options.nonmicro ? 'relation' : 'micro';
    next.targetNodeId = options.wrongTarget ? 'bystander' : 'wrapper';
    next.sourceNodeIds = options.wrongSources ? ['host'] : ['host', 'partner'];
    return preferredComposition([step(before), next]);
}
test('actual ordinary merge may attach each complete source rigidly beneath its new parent', () => {
    const frames = ordinaryWrapperFrames(), before = frames[0].nodes.get('p'), after = frames[1].nodes.get('p');
    assert.equal(frames[0].nodes.get('host'), frames[1].nodes.get('host'));
    assert.equal(after.members.get('host').y, before.members.get('host').y + 220);
    assert.equal(after.members.get('bystander').y, before.members.get('bystander').y);
    geometry(frames);
});
for (const [name, options] of [
    ['wrong operation', { wrongOperation: true }], ['relation without structural ownership', { nonmicro: true }], ['wrong target', { wrongTarget: true }],
    ['incomplete source list', { wrongSources: true }], ['unavailable source', { missingSource: true }], ['changed source material', { changedHost: true }]
])
    test(`ordinary attachment does not release old host from ${name}`, () => assert.throws(() => ordinaryWrapperFrames(options), /Incompatible current ranks/));
test('cached composition observes in-place edits to preferred and selected coordinates', () => {
    const steps = [step(fork('p', atom('a'), atom('b')))];
    const compose = prepareWorkspaceLifetimeContours(steps), initial = compose(), root = initial[0].nodes.get('p');
    const points = new Map([...root.members].map(([id, p]) => [id, { ...p }]));
    points.get('a').x = -500;
    points.get('b').x = 500;
    const preferred = new Map([[root.incarnation, points]]);
    const a = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
    points.get('a').x = -700;
    points.get('b').x = 700;
    const b = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
    assert.equal(a.members.get('a').x, -500);
    assert.equal(b.members.get('a').x, -700);
    const selected = new Map([[root.incarnation, points]]);
    assert.equal(compose(selected)[0].nodes.get('p').members.get('a').x, -700);
    points.get('a').x = -800;
    points.get('b').x = 800;
    assert.equal(compose(selected)[0].nodes.get('p').members.get('a').x, -800);
    assert.equal(a.members.get('a').x, -500);
});
test('independent alternatives restore their accepted composition instead of undoing each other', () => {
    const steps = [step(forest(fork('left', atom('a'), atom('b')), fork('right', atom('c'), atom('d'))))];
    const compose = prepareWorkspaceLifetimeContours(steps), initial = compose();
    const preferred = new Map([...initial[0].nodes.values()].map(shape => [shape.incarnation,
        new Map([...shape.members].map(([id, point]) => [id, { ...point }]))]));
    const baseline = compose(undefined, { inheritCurrentSlots: true, preferred });
    compose.retainBaseline(baseline);
    const alternative = (base, id, halfGap) => {
        const shape = initial[0].nodes.get(id), points = new Map(base.get(shape.incarnation));
        points.set(shape.children[0].id, { x: -halfGap, y: 220 });
        points.set(shape.children[1].id, { x: halfGap, y: 220 });
        return new Map(base).set(shape.incarnation, points);
    };
    const firstPreference = alternative(preferred, 'left', 500);
    const first = compose(undefined, { inheritCurrentSlots: true, preferred: firstPreference, baseline });
    compose.retainBaseline(first);
    const childMembers = baseline[0].nodes.get('a').members;
    let expansions = 0;
    Object.defineProperty(childMembers, Symbol.iterator, { configurable: true, value() {
        expansions++;
        return Map.prototype[Symbol.iterator].call(this);
    } });
    try {
        const secondPreference = alternative(preferred, 'right', 700);
        const second = compose(undefined, { inheritCurrentSlots: true, preferred: secondPreference, baseline });
        assert.equal(expansions, 0, 'the preceding alternative is discarded without recomposing its left fork');
        assert.equal(second[0].nodes.get('left'), baseline[0].nodes.get('left'));
        const expectedSecond = prepareWorkspaceLifetimeContours(steps)(undefined, { inheritCurrentSlots: true, preferred: secondPreference });
        assert.deepEqual(second, expectedSecond);
        const adoptedPreference = alternative(firstPreference, 'right', 900);
        const adopted = compose(undefined, { inheritCurrentSlots: true, preferred: adoptedPreference, baseline: first });
        assert.equal(expansions, 0, 'adopting a retained candidate restores its own left fork');
        assert.equal(adopted[0].nodes.get('left'), first[0].nodes.get('left'));
        const expectedAdopted = prepareWorkspaceLifetimeContours(steps)(undefined, { inheritCurrentSlots: true, preferred: adoptedPreference });
        assert.deepEqual(adopted, expectedAdopted);
    } finally {
        delete childMembers[Symbol.iterator];
    }
});
test('composition baselines require a completed retained result from the same preparation', () => {
    const steps = [step(fork('p', atom('a'), atom('b')))], compose = prepareWorkspaceLifetimeContours(steps);
    const result = compose();
    assert.throws(() => compose(undefined, { baseline: result }), /not retained/);
    assert.throws(() => compose.retainBaseline(result), /Only the completed/);
    const complete = compose(); compose.retainBaseline(complete);
    assert.throws(() => prepareWorkspaceLifetimeContours(steps)(undefined, { baseline: complete }), /not retained/);
});
test('equivalent resolved composition reuses a contour without copying child maps', () => {
    const steps = [step(fork('p', atom('a'), atom('b')))];
    const compose = prepareWorkspaceLifetimeContours(steps), initial = compose();
    const root = initial[0].nodes.get('p'), points = new Map(root.members);
    points.set('a', { x: -500, y: 220 }); points.set('b', { x: 500, y: 220 });
    const preferred = new Map([[root.incarnation, points]]);
    const first = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
    const childMembers = first.children[0].members;
    let expansions = 0;
    Object.defineProperty(childMembers, Symbol.iterator, { configurable: true, value() {
        expansions++;
        return Map.prototype[Symbol.iterator].call(this);
    } });
    try {
        for (const [id, point] of points) points.set(id, { ...point, x: point.x + 100 });
        const same = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
        assert.equal(same, first);
        assert.equal(expansions, 0, 'an exact resolved certificate precedes descendant expansion');
        points.set('b', { ...points.get('b'), x: points.get('b').x + 25 });
        const changed = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
        assert.notEqual(changed, first);
        assert.equal(expansions, 1);
        assert.equal(changed.members.get('b').x - changed.members.get('a').x, 1025);
    } finally {
        delete childMembers[Symbol.iterator];
    }
});
for (const unary of [false, true]) test(`composition certificates retain raw centering arithmetic (unary: ${unary})`, () => {
    const steps = [step(fork('p', fork('left', atom('a'), atom('b')), ...(unary ? [] : [atom('right')])) )];
    const compose = prepareWorkspaceLifetimeContours(steps), initial = compose();
    const preferred = new Map([...initial[0].nodes.values()].map(shape => [shape.incarnation,
        new Map([...shape.members].map(([id, point]) => [id, { ...point }]))]));
    const child = initial[0].nodes.get('left'), childPoints = preferred.get(child.incarnation);
    childPoints.set('a', { x: -700.3, y: 220 }); childPoints.set('b', { x: 800.7, y: 220 });
    const root = initial[0].nodes.get('p'), points = preferred.get(root.incarnation);
    points.set('left', { x: unary ? 0 : -2048, y: 220 });
    if (!unary) points.set('right', { x: 2048, y: 220 });
    const centered = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
    const raw = 1e16, center = unary ? raw : raw + 2048;
    points.set('left', { x: raw, y: 220 });
    if (!unary) points.set('right', { x: raw + 4096, y: 220 });
    const distant = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
    assert.deepEqual(distant.members.get('left'), centered.members.get('left'));
    assert.notEqual(distant.members.get('a').x, centered.members.get('a').x,
        'equal centered origins do not imply equal descendant rounding');
    const local = distant.children[0].members.get('a');
    assert.equal(distant.members.get('a').x, local.x + raw - center);
    assert.deepEqual([...distant.members.keys()], unary ? ['p', 'left', 'a', 'b'] : ['p', 'left', 'a', 'b', 'right']);
});
test('composition certificates preserve numeric fallback and selected-coordinate rejection', () => {
    const steps = [step(fork('p', atom('a')))], compose = prepareWorkspaceLifetimeContours(steps);
    const initial = compose(), root = initial[0].nodes.get('p'), points = new Map(root.members);
    const preferred = new Map([[root.incarnation, points]]);
    const first = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
    for (const x of [-0, 0, NaN, Infinity, -Infinity]) {
        points.set('a', { x, y: 220 });
        const current = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
        assert.deepEqual(current.members, first.members);
        assert.equal(Object.is(current.members.get('a').x, 0), true);
    }
    for (const x of [NaN, Infinity, -Infinity]) {
        const selected = new Map(root.members); selected.set('a', { x, y: 220 });
        assert.throws(() => compose(new Map([[root.incarnation, selected]])), /Nonfinite selected contour/);
    }
});
test('RTL normalization reflects asymmetric upright ink without changing native measurements', () => {
    const canvas = atom('word', 'x'), steps = [step(canvas)];
    const descriptor = { kind: 'terminal', id: 'test' };
    const labels = new Map([[canvas, new Map([['word', [descriptor]]])]]);
    const measured = { x: -20, y: 55, width: 420, height: 95 };
    const snapshot = JSON.stringify(measured);
    const ltr = prepareWorkspaceLifetimeContours(steps, undefined, undefined, labels, () => measured, 'ltr')()[0].nodes.get('word');
    const rtl = prepareWorkspaceLifetimeContours(steps, undefined, undefined, labels, () => measured, 'rtl')()[0].nodes.get('word');
    assert.equal(JSON.stringify(measured), snapshot);
    assert.deepEqual(rtl.obstacles, ltr.obstacles.map(rect => ({ ...rect, x: -rect.x - rect.width })));
    assert.ok(ltr.obstacles.some(rect => rect.x + rect.width === 400));
});


test('cached slot witnesses use each trial’s current predecessor geometry and survive rejected trials', () => {
    const left = fork('left', atom('a'), atom('b')), right = fork('right', atom('c'));
    const steps = [step(fork('p', left, right)), step(fork('p', { ...left, label: 'Changed' }, right))];
    const compose = prepareWorkspaceLifetimeContours(steps), initial = compose(), preferred = new Map();
    for (const frame of initial) for (const shape of frame.nodes.values())
        if (!preferred.has(shape.incarnation)) preferred.set(shape.incarnation,
            new Map([...shape.members].map(([id, point]) => [id, { ...point, x: point.x * 6 }])));
    const original = compose(undefined, { inheritCurrentSlots: true, preferred });
    const before = initial[0].nodes.get('p'), points = preferred.get(before.incarnation);
    points.get('left').x -= 900; points.get('right').x += 900;
    const changed = compose(undefined, { inheritCurrentSlots: true, preferred });
    const fresh = prepareWorkspaceLifetimeContours(steps)(undefined, { inheritCurrentSlots: true, preferred });
    assert.deepEqual(changed, fresh);
    assert.notDeepEqual(changed[1].nodes.get('p').members, original[1].nodes.get('p').members);
    const invalid = new Map([[before.incarnation, new Map([['p', { x: 0, y: 0 }]])]]);
    assert.throws(() => compose(invalid, { inheritCurrentSlots: true, preferred }), /Incomplete selected/);
    assert.deepEqual(compose(undefined, { inheritCurrentSlots: true, preferred }), fresh);
    geometry(changed);
});


for (const readBefore of [false, true]) test(`retained contour geometry survives later successful and rejected trials (read before: ${readBefore})`, () => {
  const steps = [step(fork('p', fork('left', atom('a'), atom('b')), atom('right')))];
  const compose = prepareWorkspaceLifetimeContours(steps);
  const initial = compose(), root = initial[0].nodes.get('p');
  const preferred = new Map([...initial[0].nodes.values()].map(shape => [shape.incarnation,
    new Map([...shape.members].map(([id, point]) => [id, { ...point }]))]));
  const first = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
  // A fresh preparation supplies the same geometry without sharing trial caches.
  const expected = buildWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined,
    undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
  const expectedInk = structuredClone(expected.obstacles), expectedMembers = structuredClone(first.members);
  const earlierInk = readBefore ? first.obstacles : undefined;
  for (let trial = 1; trial <= 12; trial++) {
    const points = preferred.get(root.incarnation);
    points.get('left').x -= 25;
    points.get('right').x += 25;
    const changed = compose(undefined, { inheritCurrentSlots: true, preferred })[0].nodes.get('p');
    assert.notDeepEqual(changed.members, expectedMembers);
    // Force later contours to materialize while the retained one may still be deferred.
    assert.ok(changed.obstacles.length > 0);
  }
  const invalid = new Map(preferred.get(root.incarnation)); invalid.delete('right');
  assert.throws(() => compose(new Map([[root.incarnation, invalid]])), /Incomplete selected contour/);
  assert.deepEqual(first.members, expectedMembers);
  assert.deepEqual(first.obstacles, expectedInk);
  assert.equal(first.obstacles, first.obstacles);
  if (earlierInk) assert.equal(first.obstacles, earlierInk);
});
