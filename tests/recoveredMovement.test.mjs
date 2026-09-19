import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { buildRenderableCommittedCanvasData, isWordlessCategoryLeaf, isDisplayTerminalSurface } from '../replay/replayCompiler.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { buildTier2FacetEvidence, dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, resolveUniqueDisplayTerminal } from '../replay/relations/geometryBinding.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const cases = [
  ['astra-minimalism', 3, 0, 'objectDP', 'edgeObjectDP', 'phrasal'],
  ['astra-minimalism', 4, 1, 'johnDP', 'raisedJohnDP', 'phrasal'],
  ['astra-minimalism', 5, 0, 'finiteT', 'raisedT', 'head', 'tier1'],
  ['astra-minimalism', 6, 1, 'edgeObjectDP', 'frontedObjectDP', 'phrasal'],
  ['astra-xbar', 3, 0, 'tenseI', 'raisedI', 'head'],
  ['astra-xbar', 4, 1, 'objectNP', 'frontedNP', 'phrasal', 'order'],
  ['fable-minimalism', 2, 1, 'd_john', 'd_john_hi', 'phrasal'],
  ['fable-minimalism', 3, 0, 't_did', 't_did_hi', 'head'],
  ['fable-minimalism', 4, 1, 'dp_wh', 'dp_wh_hi', 'phrasal'],
  ['fable-xbar', 3, 0, 'i1', 'i2', 'head'],
  ['fable-xbar', 4, 0, 'dp1', 'dp3', 'phrasal']
];
const nodes = root => root ? [root, ...(root.children || []).flatMap(nodes)] : [];
const find = (forest, id) => forest.flatMap(nodes).find(n => n.id === id);
const tree = n => n && ({ ...n, children: (n.children || []).map(tree) });
const playback = new Map(saved.map(c => [c.name, buildReplayPlayback({ sentence: c.sentence, analyses: [c] }).steps]));
const plans = new Map(saved.map(c => [c.name, compileRelationRenderPlan(c.derivationStages)]));

test('future layout keeps the source attached until a retained-ID movement occurs', () => {
  const source = { id: 'person', label: 'DP', word: 'Lee', lineageId: 'person-chain' };
  const verb = { id: 'verb', label: 'V', word: 'left' };
  const lower = { id: 'trace', label: 'DP[trace]', silent: true, lineageId: 'person-chain' };
  const base = { id: 'vp', label: 'VP', children: [verb, source] };
  const moved = { id: 'tp', label: 'TP', children: [source, { id: 't-core', label: "T′", children: [
    { id: 't', label: 'T', silent: true }, { ...base, children: [verb, lower] }
  ] }] };
  const clause = { id: 'cp', label: 'CP', children: [{ id: 'c', label: 'C', silent: true }, moved] };
  const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations });
  const stages = [stage([base]), stage([clause], [
    { relation: 'Subject chain', anchors: { landing: 'person', origin: 'trace', attractor: 't' } }
  ]), stage([{ id: 'outer', label: 'XP', children: [{ id: 'x', label: 'X' }, clause] }])];
  const steps = buildReplayPlayback({ sentence: 'Lee left', analyses: [{ derivationStages: stages }] }).steps;
  const transition = steps.filter(s => s.sourceFrameIndex === 1);
  const moment = transition.findIndex(s => s.replayKind === 'relation');
  assert.ok(moment > 0);
  for (const step of transition.slice(0, moment)) {
    assert.equal(nodes(step.replayCanvasData).find(n => n.children?.some(c => c.id === 'person'))?.id, 'vp');
    assert.ok(step.replayVisibleNodeIds.includes('person'));
    assert.ok(!step.replayVisibleNodeIds.includes('trace'));
  }
  assert.equal(nodes(transition[moment].replayCanvasData).find(n => n.children?.some(c => c.id === 'person'))?.id, 'tp');
  assert.ok(transition[moment].replayVisibleNodeIds.includes('trace'));
});

test('movement replaces an authored prior landing witness at its own moment', () => {
  const source = { id: 'source', label: 'NP', word: 'Lee', lineageId: 'person' };
  const slot = { id: 'waiting', label: 'NP', word: 'e', silent: true };
  const base = { id: 'vp', label: 'VP', children: [{ id: 'verb', label: 'V', word: 'left' }, source] };
  const before = { id: 'ip', label: 'IP', children: [slot, base] };
  const after = { ...before, children: [
    { ...source, id: 'landing' }, { ...base, children: [base.children[0], { ...source, silent: true }] }
  ] };
  const stage = (tree, relations) => ({ statement: 'Authored state', stageRecord: 'Authored account', workspaceForest: [tree], relations });
  for (const referencesSlot of [true, false]) {
    const stages = [stage(before, []), stage(after, [
      { relation: 'Context', anchors: { participant: 'verb' } },
      { relation: 'A-movement', anchors: { lowerOccurrence: 'source', raisedOccurrence: 'landing' },
        priorAnchors: { source: 'source', ...(referencesSlot ? { target: 'waiting' } : {}) } }
    ])];
    const original = structuredClone(stages);
    const steps = buildReplayPlayback({ sentence: 'Lee left', analyses: [{ derivationStages: stages }] }).steps;
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 1);
    const preceding = steps.slice(0, moment).filter(s => s.sourceFrameIndex === 1);
    assert.ok(preceding.length);
    for (const step of preceding) {
      assert.equal(step.replayVisibleNodeIds.includes('waiting'), referencesSlot,
        'only a referenced previous witness belongs to the movement replacement');
      assert.ok(!step.replayVisibleNodeIds.includes('landing'));
    }
    assert.ok(steps[moment].replayVisibleNodeIds.includes('landing'));
    assert.ok(!steps[moment].replayVisibleNodeIds.includes('waiting'));
    assert.deepEqual(stages, original);
  }
});

test('restating an established movement does not hide its landing during new construction', () => {
  const source = { id: 'person', label: 'DP', word: 'Lee', lineageId: 'person-chain' };
  const verb = { id: 'verb', label: 'V', word: 'left' };
  const lower = { id: 'trace', label: 'DP', silent: true, lineageId: 'person-chain' };
  const base = { id: 'vp', label: 'VP', children: [verb, source] };
  const moved = { id: 'tp', label: 'TP', children: [source, { ...base, children: [verb, lower] }] };
  const relation = { relation: 'Subject chain', anchors: { landing: 'person', origin: 'trace' } };
  const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations });
  const stages = [stage([base]), stage([moved], [relation]), stage([
    { id: 'cp', label: 'CP', children: [{ id: 'c', label: 'C', silent: true }, moved] }
  ], [relation])];
  const original = structuredClone(stages);
  const steps = buildReplayPlayback({ sentence: 'Lee left', analyses: [{ derivationStages: stages }] }).steps;
  const later = steps.filter(s => s.sourceFrameIndex === 2);
  assert.ok(later.some(s => s.replayKind === 'micro'), 'new structure still gets its construction steps');
  assert.ok(later.some(s => s.replayKind === 'relation'), 'the restated claim keeps its own moment');
  for (const step of later) {
    assert.ok(step.replayVisibleNodeIds.includes('person'), `${step.operation} hid the established landing`);
    assert.ok(step.replayVisibleNodeIds.includes('person::__leaf'), `${step.operation} hid the established word`);
  }
  assert.deepEqual(stages, original);
});

test('a new sibling built around existing syntax is ready before the movement attachment', () => {
  const c = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
  c.derivationStages = c.derivationStages.slice(0, 4);
  const cp = c.derivationStages[3].workspaceForest[0];
  const tpIndex = cp.children.findIndex(n => n.id === 'tp_full');
  cp.children[tpIndex] = { id: 'new_tp_shell', label: 'TP', children: [cp.children[tpIndex]] };
  c.derivationStages[3].relations[0].anchors.complexHead = 'c_complex';
  const { steps } = buildReplayPlayback({ sentence: c.sentence, analyses: [c] });
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 3 && s.replayRelationIdentity.relationIndex === 0);
  assert.ok(steps[moment - 1].replayVisibleNodeIds.includes('new_tp_shell'), 'the independent sibling must be built before attachment');
  for (const host of ['c_complex', 'cp1']) {
    assert.ok(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes(host)), `early host ${host}`);
    assert.ok(steps[moment].replayVisibleNodeIds.includes(host), `missing attachment ${host}`);
    assert.ok(!steps.slice(moment + 1).some(s => s.replayKind === 'micro' && s.targetNodeId === host), `rebuilt host ${host}`);
  }
});

for (const [name, attachment, higherProjection] of [
  ['fable-minimalism', 'cp1'],
  ['astra-xbar', 'questionCbar', 'questionCP']
]) {
  test(`${name}: head movement attaches its new host to existing syntax in the same frame`, () => {
    const steps = playback.get(name);
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 3
      && s.replayRelationIdentity.relationIndex === 0);
    assert.ok(moment > 0);
    assert.ok(steps[moment].replayVisibleNodeIds.includes(attachment), 'the landing cannot float separately from its authored attachment');
    assert.ok(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes(attachment)), 'the attachment must not precede the landing');
    assert.ok(!steps.slice(moment + 1).some(s => s.replayKind === 'micro' && s.targetNodeId === attachment), 'the attachment must not be built a second time');
    if (higherProjection) assert.ok(!steps[moment].replayVisibleNodeIds.includes(higherProjection), 'head movement does not expose the projection reserved for later phrasal movement');
  });
}

for (const [name, stageIndex, relationIndex, source, target, kind, exception] of cases) {
  test(`${name} stage ${stageIndex + 1}: ${source} -> ${target}`, () => {
    const record = saved.find(c => c.name === name);
    const current = record.derivationStages[stageIndex];
    const previous = record.derivationStages[stageIndex - 1];
    const input = { relation: current.relations[relationIndex], currentForest: current.workspaceForest,
      priorForest: previous.workspaceForest, stageIndex, relationIndex };
    const original = structuredClone(input);
    const movement = buildTier2FacetEvidence(input).movement;
    assert.equal(movement.sourceNodeId, source);
    assert.equal(movement.targetNodeId, target);
    assert.equal(movement.trajectoryKind, kind);
    assert.equal(movement.transition, true);
    const dispatch = dispatchRelationClaims(input);
    const steps = playback.get(name);
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === stageIndex
      && s.replayRelationIdentity.relationIndex === relationIndex);
    assert.ok(moment > 0);
    const step = steps[moment];
    {
      if (exception === 'tier1') {
        assert.equal(dispatch.primaryClaim.tier, 1);
        assert.equal(dispatch.primaryClaim.registryEntryId, 'trajectory.head');
        assert.deepEqual(dispatch.tier1Dispatch.signatureIssues, []);
        assert.equal(dispatch.facets.some(f => f.recipe.id === 'movement.path'), false);
      } else assert.ok(dispatch.facets.some(f => f.recipe.id === 'movement.path' && f.evaluation.earnedTransitions.includes('movement')));
      const link = step.replayRelationLinks.find(l => l.authoredRelationKey === `${stageIndex}:${relationIndex}`);
      assert.equal(link.renderFamily, 'trajectory');
      assert.equal(link.trajectoryKind, kind);
      assert.equal(link.sourceNodeId, source);
      assert.equal(link.targetNodeId, target);
      const drawing = plans.get(name).frames.flatMap(frame => frame.items).find(item =>
        item.kind === 'trajectory' && item.sourceNodeId === source && item.targetNodeId === target);
      assert.ok(drawing, 'the production drawing must agree with Replay');
      assert.equal(drawing.trajectoryKind, kind);
      assert.equal(drawing.targetAttachment, kind === 'head' && !isWordlessCategoryLeaf(find(current.workspaceForest, target)) ? 'terminal' : 'shell-bottom');
      if (isWordlessCategoryLeaf(find(current.workspaceForest, source))) {
        assert.equal(drawing.sourceAttachment, 'shell-bottom', 'an authored wordless category anchors to itself, not a nonexistent lexical child');
      }
      if (exception === 'order') {
        assert.match(step.movementDiagnostics.join('\n'), /before relation 2/);
        assert.equal(steps[moment - 1].operation, 'wh licensing');
        assert.match(steps[moment - 1].movementDiagnostics.join('\n'), /requires frontedNP before relation 2/);
        assert.ok(!steps[moment - 1].replayVisibleNodeIds.includes(target), 'the earlier licensing must not expose a future landing');
      } else {
        const hasLaterRealization = (name === 'astra-minimalism' && stageIndex === 5)
          || (name === 'fable-xbar' && stageIndex === 3);
        const targetIds = nodes(buildRenderableCommittedCanvasData(find(current.workspaceForest, target))).map(n => n.id)
          .filter(id => !hasLaterRealization || id !== `${target}::__leaf`);
        for (const earlier of steps.slice(0, moment)) {
          assert.ok(!earlier.replayVisibleNodeIds.some(id => targetIds.includes(id)), `landing revealed by ${earlier.operation}`);
        }
        for (const id of targetIds) assert.ok(step.replayVisibleNodeIds.includes(id), `missing landing member ${id}`);
        const parent = current.workspaceForest.flatMap(nodes).find(n => n.children?.some(child => child.id === target));
        if (!find(previous.workspaceForest, parent.id)) {
          assert.ok(step.replayVisibleNodeIds.includes(parent.id), 'new landing parent must appear with the landing');
          assert.ok(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes(parent.id)), 'new landing parent appeared early');
        }
        const beforeSource = find([steps[moment - 1].replayCanvasData], source);
        assert.deepEqual(tree(beforeSource), tree(buildRenderableCommittedCanvasData(find(previous.workspaceForest, source))));
      }
      assert.deepEqual(tree(find([step.replayCanvasData], source)), tree(buildRenderableCommittedCanvasData(find(current.workspaceForest, source))));
    }
    assert.deepEqual(input, original, 'recognition must not edit the authored record');
  });
}

const sample = () => {
  const c = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
  return { relation: c.derivationStages[2].relations[1], forest: c.derivationStages[2].workspaceForest,
    previous: c.derivationStages[1].workspaceForest };
};

const retainedOccurrence = (kind, retainLanding) => {
  const source = retainLanding ? 'lower' : 'original';
  const target = retainLanding ? 'original' : 'higher';
  const phrase = (id, silent = false) => ({ id, label: kind === 'head' ? 'T' : 'DP', lineageId: 'identity',
    ...(silent ? { silent: true } : kind === 'head' ? { word: 'did' }
      : { children: [{ id: 'word', label: 'N', word: 'book' }] }) });
  const host = { id: 'host', label: 'C', silent: true };
  const lower = phrase(source, true);
  const landing = phrase(target);
  const prior = [{ id: 'root', label: 'CP', children: [host, { id: 'site', label: 'VP', children: [phrase('original')] }] }];
  const current = [{ id: 'root', label: 'CP', children: kind === 'head'
    ? [{ id: 'complex', label: 'C', children: [landing, host] }, { id: 'site', label: 'VP', children: [lower] }]
    : [landing, host, { id: 'site', label: 'VP', children: [lower] }] }];
  const relation = { relation: 'An open movement claim', anchors: { source, landing: target }, priorAnchors: { source: 'original' } };
  const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: '', workspaceForest, relations });
  return { source, target, prior, current, relation, record: { derivationStages: [stage(prior), stage(current, [relation])] } };
};

test('movement distinguishes the preceding occurrence from either current ID-retention convention', () => {
  for (const kind of ['phrasal', 'head']) for (const retainLanding of [false, true]) {
    const c = retainedOccurrence(kind, retainLanding);
    const original = structuredClone(c.record);
    const movement = recoverMovementEvidence(c.relation, c.current, c.prior).movement;
    assert.equal(movement?.priorSourceNodeId, 'original');
    assert.equal(movement.sourceNodeId, c.source);
    assert.equal(movement.targetNodeId, c.target);
    assert.equal(movement.trajectoryKind, kind);
    assert.equal(movement.transition, true);
    const { steps } = buildReplayPlayback({ sentence: kind === 'head' ? 'did' : 'book', analyses: [c.record] });
    const index = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
    const before = steps[index - 1];
    const moment = steps[index];
    const material = step => nodes(step.replayCanvasData).filter(n => !n.replayLayoutOnly);
    assert.equal(material(before).find(n => n.children?.some(c => c.id === 'original'))?.id, 'site', `${kind}: retain landing ${retainLanding}`);
    assert.equal(material(before).filter(n => n.id === 'original').length, 1);
    assert.ok(before.replayVisibleNodeIds.includes('original'), 'the original remains visible at its source');
    assert.equal(find([moment.replayCanvasData], c.source).silent, true);
    assert.ok(moment.replayVisibleNodeIds.includes(c.target));
    assert.ok(moment.replayRelationLinks.some(l => l.renderFamily === 'trajectory' && l.sourceNodeId === c.source && l.targetNodeId === c.target));
    assert.deepEqual(c.record, original);
  }
});

test('a fresh lower occurrence needs exact prior identity and position, and never replays a completed chain', () => {
  const c = retainedOccurrence('phrasal', true);
  const relation = { ...c.relation, priorAnchors: undefined };
  assert.equal(recoverMovementEvidence(relation, c.current, c.prior).movement?.priorSourceNodeId, 'original');
  assert.equal(recoverMovementEvidence(relation, c.current, c.current).movement?.transition, false);
  const fresh = structuredClone(c);
  find(fresh.current, 'original').id = 'fresh-upper';
  fresh.relation.anchors.landing = 'fresh-upper';
  assert.equal(recoverMovementEvidence(fresh.relation, fresh.current, fresh.prior).movement?.priorSourceNodeId, 'original');
  delete fresh.relation.priorAnchors;
  assert.equal(recoverMovementEvidence(fresh.relation, fresh.current, fresh.prior).movement, undefined, 'lineage alone cannot choose an unanchored prior ID');
  for (const damage of [
    copy => { copy.relation.priorAnchors.source = 'absent'; },
    copy => { copy.prior[0].children.push(structuredClone(find(copy.prior, 'original'))); },
    copy => { find(copy.current, 'site').children.unshift({ id: 'unrelated', label: 'X' }); },
    copy => { find(copy.current, 'lower').lineageId = 'different'; }
  ]) {
    const copy = structuredClone(c);
    damage(copy);
    assert.equal(recoverMovementEvidence(copy.relation, copy.current, copy.prior).movement, undefined);
  }
});

test('unchanged ordered sisters identify a movement source slot across rebuilt projections', () => {
  const c = retainedOccurrence('phrasal', true);
  const sister = { id: 'verb', label: 'V', word: 'read' };
  find(c.prior, 'site').children.unshift(sister);
  const lowerParent = find(c.current, 'site');
  lowerParent.id = 'rebuilt-site';
  lowerParent.children.unshift(structuredClone(sister));
  const original = structuredClone(c.record);
  for (const relation of [c.relation, { relation: 'A-movement', anchors: { chainHead: 'original', trace: 'lower' },
    priorAnchors: { source: 'original' } }]) {
    const movement = recoverMovementEvidence(relation, c.current, c.prior).movement;
    assert.equal(movement?.priorSourceNodeId, 'original');
    assert.equal(movement?.sourceNodeId, 'lower');
    assert.equal(movement?.targetNodeId, 'original');
  }
  const { steps } = buildReplayPlayback({ sentence: 'read book', analyses: [c.record] });
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
  assert.ok(moment > 0);
  assert.equal(find([steps[moment - 1].replayCanvasData], 'original')?.silent, undefined);
  assert.equal(find([steps[moment].replayCanvasData], 'lower')?.silent, true);
  assert.ok(steps[moment].replayRelationLinks.some(l => l.renderFamily === 'trajectory'
    && l.sourceNodeId === 'lower' && l.targetNodeId === 'original'));
  assert.ok(steps[moment].replayVisibleNodeIds.includes('verb'));
  assert.deepEqual(c.record, original);
  for (const damage of [
    copy => { find(copy.current, 'rebuilt-site').children.reverse(); },
    copy => { find(copy.current, 'verb').id = 'another-verb'; },
    copy => { find(copy.current, 'verb').word = 'write'; },
    copy => { find(copy.current, 'rebuilt-site').label = 'Other'; },
    copy => { find(copy.current, 'rebuilt-site').children.shift(); find(copy.prior, 'site').children.shift(); },
    copy => { copy.current.push({ id: 'site', label: 'VP' }); },
    copy => { copy.prior.push({ id: 'rebuilt-site', label: 'VP' }); },
    copy => { copy.current.push(structuredClone(find(copy.current, 'verb'))); }
  ]) {
    const copy = structuredClone(c);
    damage(copy);
    assert.equal(recoverMovementEvidence(copy.relation, copy.current, copy.prior).movement, undefined);
  }
});

test('movement replaces rebuilt source containers atomically and preserves unrelated syntax', () => {
  for (const retainLanding of [false, true]) {
    const c = retainedOccurrence('phrasal', retainLanding);
    const sister = { id: 'verb', label: 'V', word: 'read' };
    find(c.prior, 'site').children.unshift(sister);
    find(c.current, 'site').children.unshift(structuredClone(sister));
    find(c.current, 'site').id = 'new-site';
    c.current[0].id = 'new-root';
    const separate = { id: 'separate', label: 'PP', children: [{ id: 'p', label: 'P', word: 'there' }] };
    c.prior.push(separate);
    c.current.push(structuredClone(separate));
    c.record.derivationStages[1].relations.unshift({ relation: 'Earlier claim', anchors: { participant: 'verb' } });
    const original = structuredClone(c.record);
    const { steps } = buildReplayPlayback({ sentence: 'read book there', analyses: [c.record] });
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1
      && s.replayRelationIdentity.relationIndex === 1);
    const before = steps[moment - 1];
    const after = steps[moment];
    for (const id of ['root', 'site', 'original', 'verb', 'separate', 'p']) {
      assert.ok(before.replayVisibleNodeIds.includes(id), `preceding structure lost: ${id}`);
    }
    for (const id of ['new-root', 'new-site']) {
      assert.ok(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes(id)), `early replacement: ${id}`);
      assert.ok(after.replayVisibleNodeIds.includes(id), `missing replacement: ${id}`);
      assert.ok(!steps.slice(moment + 1).some(s => s.replayKind === 'micro' && s.targetNodeId === id));
    }
    assert.equal(nodes(before.replayCanvasData).find(n => n.children?.some(c => c.id === 'original'))?.id, 'site');
    assert.equal(nodes(after.replayCanvasData).find(n => n.children?.some(child => child.id === c.target))?.id, 'new-root');
    assert.equal(find([after.replayCanvasData], c.source)?.silent, true);
    assert.ok(after.replayRelationLinks.some(l => l.renderFamily === 'trajectory'
      && l.sourceNodeId === c.source && l.targetNodeId === c.target));
    assert.deepEqual(tree(find([before.replayCanvasData], 'separate')), tree(find([after.replayCanvasData], 'separate')));
    assert.deepEqual(c.record, original);
  }
});

test('a retained landing ID can move again while earlier lower occurrences remain intact', () => {
  const c = retainedOccurrence('phrasal', true);
  const last = structuredClone(c.record.derivationStages.at(-1));
  const higher = last.workspaceForest[0].children.shift();
  last.workspaceForest[0].children.unshift({ id: 'intermediate', label: 'DP', lineageId: 'identity', silent: true });
  last.workspaceForest = [{ id: 'outer', label: 'XP', children: [higher, ...last.workspaceForest] }];
  last.relations = [{ relation: 'Another authored movement', anchors: { source: 'intermediate', landing: 'original' },
    priorAnchors: { source: 'original' } }];
  c.record.derivationStages.push(last);
  const { steps } = buildReplayPlayback({ sentence: 'book', analyses: [c.record] });
  const index = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 2);
  const before = steps[index - 1];
  const after = steps[index];
  assert.equal(nodes(before.replayCanvasData).find(n => n.children?.some(c => c.id === 'original'))?.id, 'root');
  assert.ok(before.replayVisibleNodeIds.includes('original'));
  assert.equal(nodes(after.replayCanvasData).find(n => n.children?.some(c => c.id === 'original'))?.id, 'outer');
  for (const id of ['lower', 'intermediate']) {
    assert.ok(after.replayVisibleNodeIds.includes(id));
    assert.equal(find([after.replayCanvasData], id).silent, true);
  }
});

test('later realization of a retained landing reads the actual preceding head', () => {
  const c = retainedOccurrence('head', true);
  find(c.current, 'original').word = 'does';
  c.record.derivationStages.at(-1).relations.push({ relation: 'PFRealization', anchors: { terminal: 'original' }, values: { realization: 'does' } });
  const { steps } = buildReplayPlayback({ sentence: 'does', analyses: [c.record] });
  const [movement, realization] = steps.filter(s => s.replayRelationIdentity?.stageIndex === 1);
  const surface = step => nodes(step.replayCanvasData).filter(n => n.word && !n.replayLayoutOnly && !n.silent).map(n => n.word);
  assert.ok(surface(movement).includes('did'));
  assert.ok(!surface(movement).includes('does'));
  assert.ok(surface(realization).includes('does'));
});

test('Tier 3 reveals a proved landing and its new parent together without earning an arrow', () => {
  const record = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
  const stageIndex = 4;
  const current = record.derivationStages[stageIndex];
  const original = structuredClone(current);
  current.relations = [{ relation: 'AbarMove', anchors: { source: 'dp_wh', landing: 'dp_wh_hi' },
    values: { outcome: ['blocked', 'licensed'] } }];
  const input = { relation: current.relations[0], currentForest: current.workspaceForest,
    priorForest: record.derivationStages[stageIndex - 1].workspaceForest, stageIndex, relationIndex: 0 };
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.primaryClaim.tier, 3, 'structural binding cannot resolve contradictory authored outcomes');
  assert.ok(!dispatch.facets.some(f => f.recipe.id === 'movement.path'), 'Tier 2 cannot salvage that incomplete recipe');
  const { steps } = buildReplayPlayback({ sentence: record.sentence, analyses: [record] });
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === stageIndex
    && s.replayRelationIdentity.relationIndex === 0);
  assert.ok(moment > 0);
  const parent = current.workspaceForest.flatMap(nodes).find(n => n.children?.some(child => child.id === 'dp_wh_hi'));
  const landingIds = nodes(buildRenderableCommittedCanvasData(find(current.workspaceForest, 'dp_wh_hi'))).map(n => n.id);
  for (const id of [...landingIds, parent.id]) {
    assert.ok(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes(id)), `early landing or parent ${id}`);
    assert.ok(steps[moment].replayVisibleNodeIds.includes(id), `missing landing or parent ${id}`);
    assert.ok(!steps.slice(moment + 1).some(s => s.replayKind === 'micro' && s.targetNodeId === id), `rebuilt ${id}`);
  }
  assert.deepEqual(tree(find([steps[moment - 1].replayCanvasData], 'dp_wh')),
    tree(buildRenderableCommittedCanvasData(find(input.priorForest, 'dp_wh'))));
  assert.deepEqual(tree(find([steps[moment].replayCanvasData], 'dp_wh')),
    tree(buildRenderableCommittedCanvasData(find(current.workspaceForest, 'dp_wh'))));
  assert.ok(!steps[moment].replayRelationLinks.some(l => l.authoredRelationKey === '4:0' && l.renderFamily === 'trajectory'));
  const frame = compileRelationRenderPlan(record.derivationStages).frames[stageIndex];
  assert.ok(!frame.items.some(i => i.kind === 'trajectory' && i.relationRef.stageIndex === stageIndex && i.relationRef.relationIndex === 0));
  assert.match(steps[moment].movementDiagnostics.join('\n'), /drawing was not licensed/);
  assert.deepEqual(current.workspaceForest, original.workspaceForest, 'timing must not change authored syntax');
});

test('a completed chain does not earn a second movement', () => {
  const { relation, forest } = sample();
  const result = recoverMovementEvidence(relation, forest, forest).movement;
  assert.ok(result);
  assert.equal(result.transition, false);
});

for (const [name, stageIndex, source, landing] of [
  ['astra-minimalism', 5, 'finiteT', 'raisedT'],
  ['fable-xbar', 3, 'i1', 'i2']
]) {
  for (const registered of [false, true]) test(`${name}: movement precedes ${registered ? 'registered' : 'open'} realization of did`, () => {
    const record = structuredClone(saved.find(c => c.name === name));
    if (registered) record.derivationStages[stageIndex].relations[1] = {
      relation: 'PFRealization', anchors: { terminal: landing }, values: { realization: 'did' }
    };
    const original = structuredClone(record);
    const { steps } = buildReplayPlayback({ sentence: record.sentence, analyses: [record] });
    const movement = steps.find(s => s.replayRelationIdentity?.stageIndex === stageIndex && s.replayRelationIdentity.relationIndex === 0);
    const realization = steps.find(s => s.replayRelationIdentity?.stageIndex === stageIndex && s.replayRelationIdentity.relationIndex === 1);
    assert.ok(movement.replayVisibleNodeIds.includes(landing));
    assert.equal(find([movement.replayCanvasData], landing).word, undefined);
    assert.equal(find([movement.replayCanvasData], `${landing}::__leaf`), undefined);
    assert.equal(find([realization.replayCanvasData], `${landing}::__leaf`).word, 'did');
    assert.ok(realization.replayVisibleNodeIds.includes(`${landing}::__leaf`));
    assert.ok(movement.replayRelationLinks.some(l => l.sourceNodeId === source && l.targetNodeId === landing));
    assert.deepEqual(record, original);
  });
}

test('unrecognized comments do not delay pronunciation and authored order is not rewritten', () => {
  for (const variant of ['comment', 'reversed']) {
    const record = structuredClone(saved.find(c => c.name === 'astra-minimalism'));
    const stage = record.derivationStages[5];
    if (variant === 'comment') stage.relations[1] = { relation: 'A remark', anchors: { node: 'raisedT' }, values: { note: 'did' } };
    else stage.relations.reverse();
    const { steps } = buildReplayPlayback({ sentence: record.sentence, analyses: [record] });
    const moment = steps.find(s => s.replayRelationIdentity?.stageIndex === 5 && s.operation === 'Head movement');
    assert.equal(find([moment.replayCanvasData], 'raisedT::__leaf').word, 'did');
    assert.equal(moment.replayRelationIdentity.relationIndex, variant === 'comment' ? 0 : 1);
  }
});

test('movement recovery does not depend on a relation title or anchor order', () => {
  const { relation, forest, previous } = sample();
  const expected = recoverMovementEvidence(relation, forest, previous);
  relation.relation = 'An open relation name';
  relation.anchors = Object.fromEntries(Object.entries(relation.anchors).reverse());
  assert.deepEqual(recoverMovementEvidence(relation, forest, previous), expected);
});

for (const [name, damage] of [
  ['missing prior source', s => { s.previous = []; }],
  ['conflicting explicit prior source', s => { s.relation.priorAnchors = { source: 'v_buy' }; }],
  ['unrelated root lineages', s => { find(s.forest, 'd_john_hi').lineageId = 'different'; }],
  ['two candidate landings', s => { s.relation.anchors.higherCopy = ['d_john_hi', 't_did']; }],
  ['missing landing reference', s => { s.relation.anchors.higherCopy = 'absent'; }],
  ['duplicated endpoint ID', s => { s.forest.push(structuredClone(find(s.forest, 'd_john_hi'))); }],
  ['an enclosing host instead of an occurrence', s => { s.relation.anchors.higherCopy = 'tp_full'; }]
]) {
  test(`does not claim movement with ${name}`, () => {
    const s = sample();
    damage(s);
    const result = recoverMovementEvidence(s.relation, s.forest, s.previous);
    assert.equal(result.movement, undefined);
    assert.ok(result.diagnostics.length);
  });
}

test('movement timing and arrows are independent of the authored pronunciation of either copy', () => {
  const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Authored state.', workspaceForest, relations });
  for (const kind of ['head', 'phrasal']) for (const priorSilent of [false, true]) {
    for (const lowerSilent of [false, true]) for (const upperSilent of [false, true]) {
      const c = retainedOccurrence(kind, false);
      const before = find(c.prior, c.source);
      before.silent = priorSilent;
      const lower = find(c.current, c.source);
      Object.assign(lower, structuredClone(before), { silent: lowerSilent });
      const upper = find(c.current, c.target);
      upper.silent = upperSilent;
      if (kind === 'phrasal') upper.children[0].id = 'upper-word';
      const unchanged = structuredClone(c);
      const result = recoverMovementEvidence(c.relation, c.current, c.prior);
      assert.equal(result.movement?.transition, true, `${kind}: ${priorSilent}/${lowerSilent}/${upperSilent}`);
      const stages = [stage(c.prior), stage(c.current, [c.relation])];
      // A later pronunciation decision must not introduce another movement.
      const later = structuredClone(stages[1]);
      find(later.workspaceForest, c.source).silent = !lowerSilent;
      stages.push(later);
      assert.equal(recoverMovementEvidence(c.relation, later.workspaceForest, c.current).movement?.transition, false);
      const { steps } = buildReplayPlayback({ sentence: 'word', analyses: [{ derivationStages: stages }] });
      const momentIndex = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
      const moment = steps[momentIndex];
      assert.ok(moment.replayRelationLinks.some(link => link.renderFamily === 'trajectory'
        && link.sourceNodeId === c.source && link.targetNodeId === c.target));
      for (const [step, expected] of [[steps[momentIndex - 1], before], [moment, lower]]) {
        assert.deepEqual(tree(find([step.replayCanvasData], c.source)), tree(buildRenderableCommittedCanvasData(expected)));
      }
      assert.deepEqual(tree(find([moment.replayCanvasData], c.target)), tree(buildRenderableCommittedCanvasData(upper)));
      assert.deepEqual(c, unchanged, 'neither pronunciation nor structure is rewritten');
    }
  }
});

test('a prior-only source resolves only to the same exact current occurrence', () => {
  for (const kind of ['head', 'phrasal']) {
    const c = retainedOccurrence(kind, false);
    delete c.relation.anchors.source;
    const original = structuredClone(c);
    const dispatch = () => dispatchRelationClaims({ relation: c.relation,
      currentForest: c.current, priorForest: c.prior, stageIndex: 1, relationIndex: 0 });
    const result = dispatch();
    assert.equal(result.evidence.movement?.sourceNodeId, 'original');
    assert.ok(result.facets.some(f => f.recipe.id === 'movement.path' && f.evaluation.earnedTransitions.includes('movement')));
    assert.ok(result.claims.some(claim => claim.consumedEvidence.some(ref => ref.field === 'priorAnchors' && ref.key === 'source')));
    assert.deepEqual(c, original);
    for (const damage of [
      copy => { copy.relation.priorAnchors.source = 'absent'; },
      copy => { copy.relation.priorAnchors.source = ['original', 'host']; },
      copy => { copy.relation.priorAnchors.source = ['original', 'original']; },
      copy => { copy.relation.anchors.source = 'absent'; },
      copy => { copy.relation.anchors.source = []; },
      copy => { copy.relation.anchors.landing = [copy.target, copy.target]; },
      copy => { find(copy.current, 'original').id = 'same-lineage-different-id'; },
      copy => { copy.current.push(structuredClone(find(copy.current, 'original'))); },
      copy => { copy.prior.push(structuredClone(find(copy.prior, 'original'))); },
      copy => { find(copy.current, 'original').lineageId = 'different'; }
    ]) {
      const damaged = structuredClone(c); damage(damaged);
      assert.equal(recoverMovementEvidence(damaged.relation, damaged.current, damaged.prior).movement, undefined);
    }
  }
});

test('current movement endpoint lists retain their authored cardinality', () => {
  for (const [key, value] of [['source', 'original'], ['landing', 'higher'], ['traceWitness', 'original']]) {
    const c = retainedOccurrence('phrasal', false);
    c.relation.anchors[key] = [value, value];
    const dispatch = dispatchRelationClaims({ relation: c.relation, currentForest: c.current, priorForest: c.prior,
      stageIndex: 1, relationIndex: 0 });
    assert.equal(dispatch.evidence.movement, undefined);
    assert.ok(!dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
    assert.deepEqual(c.relation.anchors[key], [value, value]);
  }
});

test('a repeated chain keeps its already visible landing and silent lower copy', () => {
  const c = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
  c.derivationStages = c.derivationStages.slice(0, 3);
  const repeated = structuredClone(c.derivationStages[2]);
  repeated.relations = [{ relation: 'Observation', anchors: { node: 'tp_full' } }, repeated.relations[1]];
  c.derivationStages.push(repeated);
  const { steps } = buildReplayPlayback({ sentence: c.sentence, analyses: [c] });
  for (const step of steps.filter(s => s.replayRelationIdentity?.stageIndex === 3)) {
    assert.ok(step.replayVisibleNodeIds.includes('d_john_hi::__leaf'));
    assert.equal(find([step.replayCanvasData], 'd_john').silent, true);
  }
});

test('a compact trace with a changed label restores the actual prior source until movement', () => {
  const c = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
  c.derivationStages = c.derivationStages.slice(0, 3);
  find(c.derivationStages[2].workspaceForest, 'd_john').label = 't';
  const { steps } = buildReplayPlayback({ sentence: c.sentence, analyses: [c] });
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 2 && s.replayRelationIdentity.relationIndex === 1);
  assert.equal(find([steps[moment - 1].replayCanvasData], 'd_john').label, 'D');
  assert.equal(find([steps[moment - 1].replayCanvasData], 'd_john::__leaf').word, 'John');
  assert.equal(find([steps[moment].replayCanvasData], 'd_john').label, 't');
});

test('shared descendants alone cannot earn a movement curve', () => {
  const { forest, previous } = sample();
  find(forest, 'd_john').children = [{ id: 'a', label: 'N', lineageId: 'shared', silent: true }];
  find(forest, 'd_john_hi').children = [{ id: 'b', label: 'N', lineageId: 'shared' }];
  find(forest, 'd_john_hi').lineageId = 'unrelated-root';
  const dispatch = dispatchRelationClaims({ stageIndex: 1, relationIndex: 0,
    relation: { relation: 'Open claim', anchors: { source: 'd_john', traceWitness: 'd_john', landing: 'd_john_hi' } },
    currentForest: forest, priorForest: previous });
  assert.equal(dispatch.facets.some(f => f.recipe.id === 'movement.path'), false);
});

test('accepted Tier 1 movement does not report a rejected drawing', () => {
  const c = structuredClone(saved.find(c => c.name === 'astra-minimalism'));
  c.derivationStages[5].relations[0].anchors = { source: 'finiteT', target: 'raisedT' };
  const plan = compileRelationRenderPlan(c.derivationStages);
  assert.ok(plan.frames.flatMap(f => f.items).some(i => i.kind === 'trajectory'
    && i.sourceNodeId === 'finiteT' && i.targetNodeId === 'raisedT'));
  const { steps } = buildReplayPlayback({ sentence: c.sentence, analyses: [c] });
  const step = steps.find(s => s.replayRelationIdentity?.stageIndex === 5
    && s.replayRelationIdentity.relationIndex === 0);
  assert.equal(step.movementDiagnostics, undefined);
  assert.ok(step.replayRelationLinks.some(l => l.renderFamily === 'trajectory'));
});

test('government and licensing do not report missing movement endpoints', () => {
  const steps = playback.get('astra-xbar');
  for (const name of ['head government', 'wh licensing', 'lexical government']) {
    const step = steps.find(s => s.operation === name);
    assert.ok(step);
    assert.ok(!(step.movementDiagnostics || []).some(d => d.includes('MOVEMENT_ENDPOINTS_UNRESOLVED')));
  }
  const { forest, previous } = sample();
  const result = recoverMovementEvidence({ relation: 'Assignment',
    anchors: { source: 'v_buy', target: 'd_john' } }, forest, previous);
  assert.deepEqual(result, { diagnostics: [] });
});

test('registered movement kind conflicting with anchored context is diagnosed', () => {
  const c = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
  c.derivationStages = c.derivationStages.slice(0, 3);
  c.derivationStages[2].relations[1] = { relation: 'HeadMove',
    anchors: { source: 'd_john', traceWitness: 'd_john', landing: 'd_john_hi' } };
  const { steps } = buildReplayPlayback({ sentence: c.sentence, analyses: [c] });
  const step = steps.find(s => s.replayRelationIdentity?.stageIndex === 2 && s.replayRelationIdentity.relationIndex === 1);
  assert.match(step.movementDiagnostics.join('\n'), /MOVEMENT_KIND_CONFLICT.*selects head.*recovered as phrasal/);
});

test('head adjunction remains head movement when its host has an explicit exponent', () => {
  for (const exponent of [
    { id: 'c_exponent', label: 'null', silent: true },
    { id: 'c_exponent', label: 'C-exponent', word: 'that' }
  ]) {
    const c = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
    const stage = c.derivationStages[3];
    find(stage.workspaceForest, 'c_q').children = [exponent];
    const input = { relation: stage.relations[0], currentForest: stage.workspaceForest,
      priorForest: c.derivationStages[2].workspaceForest, stageIndex: 3, relationIndex: 0 };
    assert.equal(buildTier2FacetEvidence(input).movement.trajectoryKind, 'head');
    const item = compileRelationRenderPlan(c.derivationStages).frames.flatMap(f => f.items)
      .find(i => i.kind === 'trajectory' && i.targetNodeId === 't_did_hi');
    assert.equal(item.trajectoryKind, 'head');
    assert.equal(item.targetAttachment, 'terminal');
  }
});

for (const [stageIndex, relationIndex, relation, source, target] of [
  [2, 1, 'AbarMove', 'd_john', 'd_john_hi'],
  [3, 0, 'HeadMove', 't_did', 't_did_hi']
]) {
  test(`accepted ${relation} uses the same atomic timing as its Tier 2 equivalent`, () => {
    const c = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
    c.derivationStages = c.derivationStages.slice(0, stageIndex + 1);
    const stage = c.derivationStages[stageIndex];
    stage.relations[relationIndex] = { relation, anchors: { source, traceWitness: source, landing: target } };
    const input = { relation: stage.relations[relationIndex], currentForest: stage.workspaceForest,
      priorForest: c.derivationStages[stageIndex - 1].workspaceForest, stageIndex, relationIndex };
    assert.equal(dispatchRelationClaims(input).primaryClaim.tier, 1);
    const { steps } = buildReplayPlayback({ sentence: c.sentence, analyses: [c] });
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === stageIndex
      && s.replayRelationIdentity.relationIndex === relationIndex);
    const ids = nodes(buildRenderableCommittedCanvasData(find(stage.workspaceForest, target))).map(n => n.id);
    for (const s of steps.slice(0, moment)) assert.ok(!s.replayVisibleNodeIds.some(id => ids.includes(id)));
    assert.ok(ids.every(id => steps[moment].replayVisibleNodeIds.includes(id)));
    assert.deepEqual(tree(find([steps[moment - 1].replayCanvasData], source)),
      tree(buildRenderableCommittedCanvasData(find(input.priorForest, source))));
    assert.deepEqual(tree(find([steps[moment].replayCanvasData], source)),
      tree(buildRenderableCommittedCanvasData(find(stage.workspaceForest, source))));
    assert.equal(steps[moment].movementDiagnostics, undefined);
  });
}

test('saved movement plans bind real category or terminal endpoints without missing-leaf failures', () => {
  for (const [name, stageIndex, relationIndex, , target, , exception] of cases) {
    if (exception === 'signature') continue;
    const record = saved.find(c => c.name === name);
    const current = record.derivationStages[stageIndex];
    const displayed = current.workspaceForest.map(buildRenderableCommittedCanvasData);
    const displayedNodes = displayed.flatMap(nodes);
    const plan = plans.get(name);
    const itemIndex = plan.frames[stageIndex].items.findIndex(i => i.kind === 'trajectory'
      && i.targetNodeId === target && i.relationRef.relationIndex === relationIndex);
    assert.ok(itemIndex >= 0);
    const bound = bindRelationPlanFrame(plan, stageIndex, (id, attachment) => {
      let node = displayedNodes.find(n => n.id === id);
      if (!node) return null;
      if (attachment === 'terminal') {
        node = resolveUniqueDisplayTerminal(node, n => n.children || [],
          n => !n.children?.length && isDisplayTerminalSurface(n.word || n.label)).terminal;
        if (!node) return null;
      }
      const index = displayedNodes.indexOf(node);
      return { x: index * 100, y: index * 30 };
    });
    assert.ok(bound.primitives.some(p => p.type === 'trajectory-path' && p.itemIndex === itemIndex), name);
    assert.ok(!bound.failed.some(f => f.itemIndex === itemIndex), name);
  }
});
