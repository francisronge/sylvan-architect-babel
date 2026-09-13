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

test('Tier 3 reveals a proved landing and its new parent together without earning an arrow', () => {
  const record = structuredClone(saved.find(c => c.name === 'fable-minimalism'));
  const stageIndex = 4;
  const current = record.derivationStages[stageIndex];
  const original = structuredClone(current);
  current.relations = [{ relation: 'AbarMove', anchors: { source: 'dp_wh', landing: 'dp_wh_hi' } }];
  const input = { relation: current.relations[0], currentForest: current.workspaceForest,
    priorForest: record.derivationStages[stageIndex - 1].workspaceForest, stageIndex, relationIndex: 0 };
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.primaryClaim.tier, 3, 'the curated recipe still requires its witness role');
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
  ['no silent lower occurrence', s => { delete find(s.forest, 'd_john').silent; }],
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
