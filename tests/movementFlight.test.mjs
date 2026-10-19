import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';

import {
  MOVEMENT_FLIGHT_MS,
  beginMovementFlightFrame,
  createMovementFlightState,
  flightKeyframes,
  marksHeldForFlight,
  movementFlightRequested,
  movementFlightTiming,
  planMovementFlights,
  runMovementFlight
} from '../components/renderer/movementFlight.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const record = { nodes: new Map(), marks: [] };

test('movement flight is opt-in through the startup query flag', () => {
  assert.equal(movementFlightRequested('?movementFlight=1'), true);
  assert.equal(movementFlightRequested('?devTab=derivation&movementFlight=1'), true);
  for (const search of ['', '?movementFlight=0', '?movementFlight=true', '?flight=1']) {
    assert.equal(movementFlightRequested(search), false, search);
  }
});

test('a flight starts only on one forward step and continues across redraws of that step', () => {
  const steps = [], state = createMovementFlightState();
  // A settled frame starts its flight's clock, as runMovementFlight does after drawing.
  const draw = (stepIndex, now, eligible = true, replay = steps) => {
    const session = beginMovementFlightFrame(state, { steps: replay, stepIndex, eligible });
    if (session) session.startedAt ??= now;
    return session;
  };
  const settle = () => { state.painted.record = record; };

  assert.equal(draw(5, 0), null, 'opening at a step never flies');
  settle();
  const flight = draw(6, 100);
  assert.deepEqual(flight, { steps, stepIndex: 6, startedAt: 100, baseline: record });
  assert.equal(draw(6, 250), flight, 'Fit, resize and font redraws continue the same flight');
  assert.equal(flight.startedAt, 100);
  settle();
  assert.equal(draw(5, 300), null, 'Prev draws the settled frame');
  assert.equal(state.session, null);
  settle();
  const replayed = draw(6, 400);
  assert.equal(replayed.startedAt, 400, 'stepping forward again replays the movement from its start');
  settle();
  const next = draw(7, 450);
  assert.notEqual(next, replayed, 'rapid Next replaces the unfinished flight');
  assert.equal(next.stepIndex, 7);
  settle();
  assert.equal(draw(9, 500), null, 'a jump lands settled');
  settle();
  assert.equal(draw(10, 600, false), null, 'scrubbing and reduced motion land settled');
  settle();
  const other = [];
  assert.equal(draw(11, 700, true, other), null, 'another Replay never continues this one');
  assert.equal(draw(12, 800, true, other), null, 'a step whose predecessor never settled lands settled');
});

test('flight timing continues from elapsed time and ends at the settled frame', () => {
  assert.deepEqual(movementFlightTiming(0), { delay: 0, duration: MOVEMENT_FLIGHT_MS, easing: 'ease-in-out', fill: 'both' });
  assert.equal(movementFlightTiming(120).delay, -120);
  assert.equal(movementFlightTiming(MOVEMENT_FLIGHT_MS), null);
  assert(MOVEMENT_FLIGHT_MS < 1000, 'the flight lands before automatic Replay advances');
});

const node = (id, x, y, parentId = null) => ({ id, x, y, parentId });
const forest = () => new Map([
  node('cp', 0, 0), node('dp_high', -300, 200, 'cp'), node('d_high', -300, 400, 'dp_high'),
  node('tp', 200, 200, 'cp'), node('vp', 300, 400, 'tp'), node('dp_low', 400, 600, 'vp'),
  node('d_low', 400, 800, 'dp_low'), node('d_low_before', 400, 800, 'dp_low')
].map(entry => [entry.id, entry]));
const paintedBefore = new Map([['tp', 'TP'], ['vp', 'VP'], ['dp_low', 'DP'], ['d_low', 'what']]);
const paintedNow = new Map([['cp', 'CP'], ['dp_high', 'DP'], ['d_high', 'What'], ['tp', 'TP'], ['vp', 'VP'],
  ['dp_low', 'DP'], ['d_low', 'what₁']]);

test('a flight departs from the source occurrence and lands on the new landing subtree', () => {
  const nodes = forest();
  nodes.delete('d_low_before');
  const [plan] = planMovementFlights([{ sourceNodeId: 'dp_low', landingNodeId: 'dp_high', trajectoryKind: 'phrasal' }],
    nodes, paintedBefore, paintedNow);
  assert.deepEqual(plan.offset, { x: 700, y: 400 }, 'source position minus landing position');
  assert.deepEqual(plan.landingNodeIds.sort(), ['d_high', 'dp_high']);
  assert.equal(plan.attachingParentId, 'cp');
  assert.deepEqual(plan.lowerFormNodeIds, ['d_low'], 'only the relabelled lower form fades; the persisting DP stays');
});

test('existing syntax never travels and unsupported trajectories stay instant', () => {
  const nodes = forest();
  const flights = trajectory => planMovementFlights([trajectory], nodes, paintedBefore, paintedNow);
  const wh = { sourceNodeId: 'dp_low', landingNodeId: 'dp_high', trajectoryKind: 'phrasal' };
  assert.equal(flights({ ...wh, landingNodeId: 'tp' }).length, 0, 'a landing painted before keeps its place');
  assert.equal(flights({ ...wh, blocked: true }).length, 0);
  for (const trajectoryKind of ['atb', 'remnant', 'roll-up', 'sideward', 'smuggling', 'parasitic-gap']) {
    assert.equal(flights({ ...wh, trajectoryKind }).length, 0, trajectoryKind);
  }
  assert.equal(flights({ ...wh, sourceNodeId: 'missing' }).length, 0);
  assert.equal(flights({ ...wh, sourceNodeId: 'd_high' }).length, 0, 'a source inside the landing does not fly');
  assert.equal(flights({ ...wh, trajectoryKind: 'head' }).length, 1);
  assert.equal(planMovementFlights([wh, { ...wh, sourceNodeId: 'vp' }], nodes, paintedBefore, paintedNow).length, 1,
    'one landing flies once');
});

test('keyframes follow the drawn curve from the exact source position to the exact landing', () => {
  const offset = { x: 720, y: 380 };
  const samples = [{ x: 410, y: 640 }, { x: 100, y: 760 }, { x: -290, y: 240 }];
  const frames = flightKeyframes(offset, samples);
  assert.deepEqual(frames[0], { offset: 0, ...offset });
  assert.deepEqual(frames.at(-1), { offset: 1, x: 0, y: 0 });
  const correction = { x: offset.x - (410 + 290), y: offset.y - (640 - 240) };
  assert.deepEqual(frames[1], { offset: 0.5, x: 100 + 290 + correction.x / 2, y: 760 - 240 + correction.y / 2 },
    'midway the subtree dips with the trajectory');
  assert.deepEqual(flightKeyframes(offset, []), [{ offset: 0, ...offset }, { offset: 1, x: 0, y: 0 }]);
});

test('new and re-anchored marks wait for the arrival while persisted marks stay', () => {
  const persisted = { kind: 'g vr-item', owners: ['1:0'], x: 10, y: 10 };
  const held = marksHeldForFlight([
    persisted,
    { ...persisted, owners: ['1:0', '3:0'], x: 14 },
    { kind: 'g vr-item', owners: ['3:0'], x: 10, y: 10 },
    { ...persisted, x: 400 }
  ], [persisted]);
  assert.deepEqual(held, [false, false, true, true]);
});

test('real wh and head movement moments plan flights from Replay data', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/normalized/what-did-mia-see.xbar.json', import.meta.url), 'utf8'));
  const prepared = prepareReplay({ derivationStages: fixture.analyses[0].derivationStages, sentence: 'What did Mia see?',
    inputTokens: fixture.inputTokens, includePlayback: true });
  const planAt = (stepIndex) => {
    const step = prepared.playbackSteps[stepIndex];
    const { stageIndex, relationIndex } = step.replayRelationIdentity;
    const hierarchy = d3.tree().size([2000, 2000])(d3.hierarchy(structuredClone(step.replayCanvasData)));
    applyVizIds(hierarchy);
    const visible = new Set(step.replayVisibleNodeIds);
    const nodes = new Map(hierarchy.descendants().filter(entry => visible.has(getNodeId(entry))).map(entry => {
      const parentId = entry.parent && visible.has(getNodeId(entry.parent)) ? getNodeId(entry.parent) : null;
      return [getNodeId(entry), { id: getNodeId(entry), x: entry.x, y: entry.y, parentId }];
    }));
    const text = ids => new Map(ids.map(id => [id, id]));
    const trajectories = prepared.relationRenderPlan.frames[stageIndex].items
      .filter(item => item.kind === 'trajectory' && item.relationRef.relationIndex === relationIndex)
      .map(item => ({ sourceNodeId: item.sourceNodeId, landingNodeId: item.targetNodeId, trajectoryKind: item.trajectoryKind }));
    const plans = planMovementFlights(trajectories, nodes,
      text(prepared.playbackSteps[stepIndex - 1].replayVisibleNodeIds), text(step.replayVisibleNodeIds));
    return { plans, nodes };
  };
  const wh = planAt(14);
  assert.equal(wh.plans.length, 1);
  assert.equal(wh.plans[0].trajectoryKind, 'phrasal');
  assert.deepEqual(wh.plans[0].landingNodeIds.sort(), ['dp_what_high', 'dp_what_high::__lex_tok_0_what']);
  assert.equal(wh.plans[0].attachingParentId, 'cp_question');
  assert.deepEqual(wh.plans[0].lowerFormNodeIds, ['what_low']);
  const source = wh.nodes.get('dp_what_low'), landing = wh.nodes.get('dp_what_high');
  assert.deepEqual(wh.plans[0].offset, { x: source.x - landing.x, y: source.y - landing.y });

  const head = planAt(15);
  assert.equal(head.plans.length, 1);
  assert.equal(head.plans[0].trajectoryKind, 'head');
  assert.deepEqual(head.plans[0].landingNodeIds.sort(), ['c_question', 'c_question::__lex_tok_1_did']);
  assert.equal(head.plans[0].attachingParentId, 'cbar_question');
  assert.deepEqual(head.plans[0].lowerFormNodeIds, ['did_terminal']);
});

// A minimal SVG stand-in: enough tree, selector and animation surface for the flight.
const element = (tagName, attrs = {}, children = []) => {
  const el = {
    tagName, attrs: { ...attrs }, children: [], parentElement: null, style: {}, animations: [], textContent: attrs.text ?? '',
    classList: {
      contains: name => (el.attrs.class || '').split(/\s+/u).includes(name),
      [Symbol.iterator]: function* () { yield* (el.attrs.class || '').split(/\s+/u).filter(Boolean); }
    },
    getAttribute: name => el.attrs[name] ?? null,
    setAttribute: (name, value) => { el.attrs[name] = String(value); },
    hasAttribute: name => Object.hasOwn(el.attrs, name),
    removeAttribute: name => { delete el.attrs[name]; },
    appendChild: child => { child.parentElement = el; el.children.push(child); return child; },
    remove: () => { el.removed = true; },
    matches: selector => selector.startsWith('.') ? el.classList.contains(selector.slice(1)) : el.tagName === selector,
    closest: selector => { let at = el; while (at && !at.matches(selector)) at = at.parentElement; return at; },
    querySelectorAll: selector => el.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]),
    querySelector: selector => el.querySelectorAll(selector)[0] ?? null,
    getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    getCTM: () => null,
    getScreenCTM: () => ({ a: 0.5, b: 0 }),
    animate: (keyframes, timing) => {
      const animation = { keyframes, timing, cancelled: false, cancel() { this.cancelled = true; } };
      el.animations.push(animation);
      return animation;
    }
  };
  children.forEach(child => el.appendChild(child));
  return el;
};

const paintFrame = ({ withMark = true } = {}) => {
  const tree = { id: 'cp', label: 'CP', children: [
    { id: 'dp_high', label: 'DP', children: [{ id: 'd_high', label: 'D', word: 'What' }] },
    { id: 'tp', label: 'TP', children: [{ id: 'dp_low', label: 'DP', children: [{ id: 'd_low', label: 'D', word: 'what' }] }] }
  ] };
  const hierarchy = d3.hierarchy(tree);
  applyVizIds(hierarchy);
  const positions = { cp: [0, 0], dp_high: [-300, 200], d_high: [-300, 400], tp: [200, 200], dp_low: [400, 400], d_low: [400, 600] };
  hierarchy.each(entry => { [entry.x, entry.y] = positions[getNodeId(entry)]; });
  const group = (id, label, fill = label === label.toLowerCase() ? '#10b981' : '#ffffff') => element('g', {
    class: 'node-group', 'data-node-group-id': id, opacity: '1', transform: `translate(${positions[id]})`
  }, [element('text', { class: fill === '#ffffff' ? 'category-label' : 'terminal-label', fill, text: label })]);
  const branch = (from, to) => element('path', { class: 'branch', 'data-source-node-id': from, 'data-target-node-id': to, opacity: '0.6' });
  const trajectory = element('path', { class: 'babel-trajectory-path', 'data-trajectory-from': 'dp_low', 'data-trajectory-to': 'dp_high',
    'data-trajectory-kind': 'phrasal', d: 'M 400 430 Q 50 700, -300 230' });
  trajectory.getTotalLength = () => 1000;
  trajectory.getPointAtLength = length => ({ x: 400 - length * 0.7, y: 430 - length * 0.2 });
  const host = element('g', { class: 'vr-item', 'data-vr-owner-refs': '3:0' }, [trajectory]);
  const newMark = element('g', { class: 'vr-item', 'data-vr-owner-refs': '3:0' });
  const persistedMark = element('g', { class: 'vr-item', 'data-vr-owner-refs': '1:0' });
  const g = element('g', {}, [
    branch('cp', 'dp_high'), branch('dp_high', 'd_high'), branch('cp', 'tp'), branch('tp', 'dp_low'), branch('dp_low', 'd_low'),
    group('cp', 'CP'), group('dp_high', 'DP'), group('d_high', 'what'), group('tp', 'TP'), group('dp_low', 'DP'), group('d_low', 'what₁', '#9caf99'),
    element('g', { class: 'vr-overlay-layer' }, [host, ...(withMark ? [newMark] : []), persistedMark])
  ]);
  return { g, svg: element('svg'), hierarchy, host, newMark, persistedMark, groups: Object.fromEntries(g.children
    .filter(child => child.classList.contains('node-group')).map(child => [child.attrs['data-node-group-id'], child])),
  branches: g.children.filter(child => child.classList.contains('branch')) };
};

const withDocument = (run) => {
  const previous = globalThis.document;
  const created = [];
  globalThis.document = { createElementNS: (_ns, tag) => { const el = element(tag); created.push(el); return el; } };
  try { return run(created); } finally { globalThis.document = previous; }
};

const flightState = () => {
  const state = createMovementFlightState();
  const steps = [];
  state.painted = { steps, stepIndex: 4, record: {
    nodes: new Map([['tp', '#ffffff TP'], ['dp_low', '#ffffff DP'], ['d_low', '#10b981 what']]),
    marks: [{ kind: 'g vr-item', owners: ['1:0'], x: 5, y: 5 }]
  } };
  const session = beginMovementFlightFrame(state, { steps, stepIndex: 5, eligible: true });
  return { state, steps, session };
};

test('the painted landing travels while its arrow draws, then every flight effect is removed', () => withDocument((created) => {
  const { state, steps, session } = flightState();
  const frame = paintFrame();
  let settled = 0;
  const flight = runMovementFlight({ state, steps, stepIndex: 5, session, g: frame.g, svg: frame.svg,
    visibleNodes: frame.hierarchy.descendants(), moment: { stageIndex: 3, relationIndex: 0 }, now: 1000,
    idPrefix: 'flight', onSettled: () => { settled += 1; } });
  assert(flight, 'the movement moment flies');
  assert.equal(session.startedAt, 1000, 'the clock starts when the first frame settles, not when drawing began');
  assert.equal(frame.groups.dp_high.animations[0].timing.delay, 0);
  assert.equal(state.painted.record.nodes.get('d_low'), '#9caf99 what₁', 'the settled frame is recorded for the next step');

  const [departure] = frame.groups.dp_high.animations[0].keyframes;
  assert.equal(departure.transform, 'translate(400px, 400px)', 'the landing starts on the source occurrence');
  assert.equal(frame.groups.dp_high.animations[0].keyframes.at(-1).transform, 'translate(-300px, 200px)');
  assert.equal(frame.groups.d_high.animations[0].keyframes[0].transform, 'translate(400px, 600px)');
  assert.equal(frame.groups.cp.animations.length, 0, 'the new parent appears instantly');
  assert.equal(frame.groups.tp.animations.length + frame.groups.dp_low.animations.length, 0, 'existing syntax stays put');
  assert.deepEqual(frame.groups.d_low.animations[0].keyframes, [{ opacity: 0 }, { opacity: 1 }], 'the lower form fades in');
  const [attach, internal, , , lower] = frame.branches;
  assert.equal(attach.animations[0].keyframes.at(-1).opacity, 0.6, 'the attaching branch waits for the arrival');
  assert.equal(attach.animations[0].keyframes[1].opacity, 0);
  assert.equal(internal.animations[0].keyframes[0].transform, 'translate(700px, 200px)');
  assert.equal(lower.animations.length, 0, 'the repainted lower node keeps its existing branch');
  assert.equal(frame.host.attrs.mask, 'url(#flight-0)', 'the moment\'s arrow draws through a sweep');
  const sweep = created.find(el => el.tagName === 'path');
  assert.equal(sweep.attrs.d, 'M 400 430 Q 50 700, -300 230');
  assert.deepEqual(sweep.animations[0].keyframes, [{ strokeDashoffset: '1000' }, { strokeDashoffset: '0' }]);
  assert.equal(frame.newMark.style.visibility, 'hidden', 'the moment\'s other marks appear on arrival');
  assert.equal(frame.persistedMark.style.visibility, undefined, 'a persisted mark stays visible');
  assert.equal(frame.svg.attrs['data-babel-movement-flight'], 'flying');
  assert(flight.carries(frame.groups.d_high.children[0]));
  assert(!flight.carries(frame.groups.d_low.children[0]));
  const timings = new Set([frame.groups.dp_high, frame.groups.d_low, attach, sweep]
    .map(el => JSON.stringify(el.animations[0].timing)));
  assert.equal(timings.size, 1, 'flight, fade and arrow share one timing');

  const all = [...Object.values(frame.groups), ...frame.branches, sweep].flatMap(el => el.animations);
  all.find(animation => animation.onfinish).onfinish();
  all.find(animation => animation.onfinish).onfinish();
  assert.equal(settled, 1, 'arrival refreshes measurements that exclude travelling labels');
  assert(all.every(animation => animation.cancelled), 'no flight effect outlives the arrival');
  assert.equal(frame.host.attrs.mask, undefined);
  assert(created.find(el => el.tagName === 'defs').removed);
  assert.equal(frame.newMark.style.visibility, undefined);
  assert.equal(frame.groups.dp_high.attrs['data-babel-movement-flight'], undefined);
  assert.equal(frame.svg.attrs['data-babel-movement-flight'], undefined);
  assert(!flight.carries(frame.groups.d_high.children[0]));
}));

test('cancelling mid-flight lands on the exact settled frame', () => withDocument(() => {
  const { state, steps, session } = flightState();
  session.startedAt = 1000;
  const frame = paintFrame();
  const before = JSON.stringify([frame.groups, frame.branches].map(value => Object.values(value).map(el => el.attrs)));
  let settled = 0;
  const flight = runMovementFlight({ state, steps, stepIndex: 5, session, g: frame.g, svg: frame.svg,
    visibleNodes: frame.hierarchy.descendants(), moment: { stageIndex: 3, relationIndex: 0 }, now: 1200,
    idPrefix: 'flight', onSettled: () => { settled += 1; } });
  assert.equal(frame.groups.dp_high.animations[0].timing.delay, -200, 'a redraw resumes the flight where it was');
  flight.cancel();
  flight.cancel();
  assert.equal(settled, 0);
  const animations = [...Object.values(frame.groups), ...frame.branches].flatMap(el => el.animations);
  assert(animations.every(animation => animation.cancelled));
  assert.equal(frame.host.attrs.mask, undefined);
  assert.equal(frame.newMark.style.visibility, undefined);
  assert.equal(JSON.stringify([frame.groups, frame.branches].map(value => Object.values(value).map(el => el.attrs))), before);
}));

test('a finished, unrelated or unmoving frame paints without a flight', () => withDocument(() => {
  const run = (overrides) => {
    const { state, steps, session } = flightState();
    session.startedAt = 1000;
    const frame = paintFrame();
    const flight = runMovementFlight({ state, steps, stepIndex: 5, session, g: frame.g, svg: frame.svg,
      visibleNodes: frame.hierarchy.descendants(), moment: { stageIndex: 3, relationIndex: 0 }, now: 1000,
      idPrefix: 'flight', onSettled: () => {}, ...overrides });
    return { flight, frame, state };
  };
  assert.equal(run({ now: 1000 + MOVEMENT_FLIGHT_MS }).flight, undefined, 'a redraw after the arrival is settled');
  assert.equal(run({ moment: null }).flight, undefined, 'structural steps never fly');
  assert.equal(run({ moment: { stageIndex: 3, relationIndex: 1 } }).flight, undefined, 'another moment\'s arrow does not fly');
  const { flight, frame, state } = run({ session: null });
  assert.equal(flight, undefined);
  assert.equal(frame.newMark.style.visibility, undefined);
  assert(Object.values(frame.groups).every(el => el.animations.length === 0));
  assert(state.painted.record, 'every settled frame is still recorded');
}));
