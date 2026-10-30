import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { constructionReceivingAttachments } from '../replay/workspaceReceivingHost.ts';
import { normalizePlaybackSequence } from '../replay/playbackVisibility.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { resolveFallbackTreeTransitionOwnership } from '../replay/treeTransitions.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { replayStages } from './helpers/canonicalIds.mjs';

const atom = (id, label, extra = {}) => ({ id, label, ...extra });
const tree = (id, label, ...children) => ({ id, label, children });
const nodes = node => [node, ...(node.children ?? []).flatMap(nodes)];
const find = (forest, id) => forest.flatMap(nodes).find(node => node.id === id);
const topology = rows => {
  const all = new Map(rows), parents = new Map(rows.flatMap(([id, children]) => children.map(child => [child, id])));
  return { has: id => all.has(id), parent: id => parents.get(id), children: id => all.get(id) ?? [],
    contains: (root, id) => { for (let node = id; node; node = parents.get(node)) if (node === root) return true; return false; } };
};

test('an unpainted wrapper grants no attachment, even when future metadata describes its final children', () => {
  const before = topology([['root', ['host', 'peer']], ['host', []], ['peer', []], ['input', []]]);
  const full = topology([['root', ['wrapper', 'peer']], ['wrapper', ['input', 'host']], ['host', []], ['peer', []], ['input', []]]);
  const step = { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'wrapper', sourceNodeIds: ['input', 'host'] };
  assert.deepEqual(constructionReceivingAttachments(step, before, full, () => true), [{ host: 'host', wrapper: 'wrapper' }]);
  const pending = { ...full, has: id => id !== 'wrapper' && full.has(id) };
  assert.deepEqual(constructionReceivingAttachments(step, before, pending, () => true), []);
  const strict = { ...pending, parent: id => { assert.notEqual(id, 'wrapper'); return full.parent(id); },
    children: id => { assert.notEqual(id, 'wrapper'); return full.children(id); } };
  assert.deepEqual(constructionReceivingAttachments(step, before, strict, () => true), [], 'reject before querying an absent current node');
});

for (const operation of ['LexicalSelect', 'Project', 'ExternalMerge']) {
  test(`${operation} cannot narrate an invisible future target and its progress is recounted`, () => {
    const pending = tree('root', 'XP', atom('current', 'N', { word: 'ready' }), atom('future', 'X', { replayLayoutOnly: true }));
    const complete = tree('root', 'XP', atom('current', 'N', { word: 'ready' }), atom('future', 'X'));
    const steps = [{ replayKind: 'micro', operation, targetNodeId: 'future', targetLabel: 'X', sourceLabels: [], replayFrameIndex: 0,
      replayCanvasData: pending, replayVisibleNodeIds: ['current'], preserveReplayStep: true, replayProgressLabel: 'Stage 1/1 · Step 1/2' },
    { replayKind: 'macro', operation: 'StageRecord', targetNodeId: 'root', targetLabel: 'XP', sourceLabels: [], replayFrameIndex: 0,
      replayCanvasData: complete, replayVisibleNodeIds: ['root', 'current', 'future'], replayProgressLabel: 'Stage 1/1 · Step 2/2' }];
    const original = structuredClone(steps);
    const result = normalizePlaybackSequence(steps, [], { stages: [{ stageIndex: 0, stageNumber: 1 }] });
    assert.equal(result.length, 1);
    assert.equal(result[0].operation, 'StageRecord');
    assert.equal(result[0].replayProgressLabel, 'Stage 1/1 · Step 1/1');
    assert.deepEqual(result[0].replayCanvasData, complete);
    assert.deepEqual(steps, original);
    const visible = normalizePlaybackSequence([{ ...original[0], replayCanvasData: complete,
      replayVisibleNodeIds: ['root', 'current', 'future'] }, original[1]], [], { stages: [{ stageIndex: 0, stageNumber: 1 }] });
    assert.ok(visible.some(step => step.operation === operation), 'a painted ordinary target keeps its construction step');
  });
}

const deferredCopy = () => {
  const lower = atom('lower', 'V descriptive', { word: 'was', tokenIndex: 0, lineageId: 'verbal-chain' });
  const predicate = tree('predicate', 'PredP', atom('adjective', 'A', { word: 'ready', tokenIndex: 1 }));
  const before = [tree('base', 'V', lower, predicate)];
  const after = [tree('root', 'C', atom('force', 'C declarative', { silent: true }),
    tree('clause', 'T', atom('subject', 'D expletive', { silent: true }), tree('bar', 'T',
      tree('complex', 'T', atom('higher', 'V descriptive', { ...lower, id: 'higher' }), atom('host', 'T', { silent: true })),
      tree('base', 'V', atom('lower', lower.label, { word: lower.word, lineageId: lower.lineageId, silent: true }), predicate))))];
  return { sentence: 'was ready', derivationStages: [
    { statement: 'Prior state', stageRecord: 'Retain the preceding lexical predicate.', relations: [], workspaceForest: before },
    { statement: 'Completed state', stageRecord: 'Commit the authored higher occurrence.', workspaceForest: after, relations: [
      { relation: 'An open authored association', anchors: { higherCopula: 'higher', lowerCopula: 'lower', landingHead: 'host' },
        priorAnchors: { sourceCopula: 'lower' }, values: { pronunciation: 'higher copy pronounced as was' } },
      { relation: 'Independent subject account', anchors: { subject: 'subject', clause: 'clause', finiteHead: 'host' } },
      { relation: 'Clause typing', anchors: { force: 'force', clause: 'clause' } }
    ] }
  ] };
};

test('late wrapper refinement keeps current construction honest and preserves the completed authored copy graph', () => {
  const input = deferredCopy(), original = structuredClone(input);
  const prepared = prepareReplay({ ...input, includePlayback: true }), steps = prepared.playbackSteps;
  for (const step of steps.filter(step => step.replayKind === 'micro')) {
    assert.ok(step.replayVisibleNodeIds.includes(step.targetNodeId), `${step.operation} shows its exact target`);
    assert.notEqual(find([step.replayCanvasData], step.targetNodeId).replayLayoutOnly, true);
  }
  const relationMoment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
  assert.ok(relationMoment > 0);
  // As for a recovered movement's landing, the moment's new parents attach the
  // copy above the preceding base; the merges above them remain construction.
  assert.ok(!steps.slice(0, relationMoment).some(step => step.replayVisibleNodeIds.includes('bar')));
  assert.ok(['complex', 'bar'].every(id => steps[relationMoment].replayVisibleNodeIds.includes(id)));
  assert.ok(steps.some(step => step.replayKind === 'micro' && step.operation === 'ExternalMerge' && step.targetNodeId === 'clause'));
  const drawings = prepared.relationRenderPlan.frames[1].items.filter(item => item.relationRef.relationIndex === 0);
  assert.ok(drawings.some(item => item.kind === 'fallback'));
  assert.ok(!drawings.some(item => item.kind === 'trajectory'));
  assert.ok(!steps.slice(0, relationMoment).some(step => step.replayKind === 'micro' && step.targetNodeId === 'complex'));
  for (const step of steps.slice(0, relationMoment).filter(step => step.replayFrameIndex === 1)) {
    assert.equal(find([step.replayCanvasData], 'lower').word, 'was');
    assert.notEqual(find([step.replayCanvasData], 'lower').silent, true);
    assert.ok(!step.replayVisibleNodeIds.includes('higher'));
  }
  for (const step of steps.slice(relationMoment)) {
    assert.ok(step.replayVisibleNodeIds.includes('higher'), 'the higher copy appears when the lower copy changes');
    assert.equal(find([step.replayCanvasData], 'higher').word, 'was');
    assert.notEqual(find([step.replayCanvasData], 'higher').silent, true);
    assert.equal(find([step.replayCanvasData], 'lower').silent, true);
  }
  const complete = steps.at(-1);
  assert.equal(complete.operation, 'StageRecord');
  for (const authored of input.derivationStages.at(-1).workspaceForest.flatMap(nodes)) {
    const painted = find([complete.replayCanvasData], authored.id);
    assert.ok(complete.replayVisibleNodeIds.includes(authored.id), authored.id);
    for (const key of ['label', 'word', 'silent', 'lineageId']) assert.equal(painted[key], authored[key], `${authored.id}.${key}`);
  }
  assert.deepEqual(input, original);
});

test('a neutral copy change does not consume a later independent contextual rewrite', () => {
  const input = deferredCopy();
  input.derivationStages[0].workspaceForest.push(atom('independent', 'X', { word: 'before-context' }));
  input.derivationStages[1].workspaceForest.push(atom('independent', 'X', { word: 'after-context' }));
  input.derivationStages[1].relations[0].anchors.context = 'independent';
  input.derivationStages[1].relations[1] = { relation: 'Independent contextual rewrite',
    anchors: { output: 'independent' }, priorAnchors: { input: 'independent' } };
  const original = structuredClone(input);
  const steps = prepareReplay({ ...input, includePlayback: true }).playbackSteps;
  const moments = steps.filter(step => step.replayRelationIdentity?.stageIndex === 1);
  assert.equal(find([moments[0].replayCanvasData], 'higher').word, 'was');
  assert.equal(find([moments[0].replayCanvasData], 'independent').word, 'before-context');
  assert.equal(find([moments[1].replayCanvasData], 'independent').word, 'after-context');
  assert.deepEqual(input, original);
});

test('neutral copy ownership requires a unique authored pair and retains independent context', () => {
  const ownership = input => {
    const plan = buildDerivationReplayPlan(input);
    return resolveFallbackTreeTransitionOwnership(plan.stages[1].relationSteps[0],
      input.derivationStages[0].workspaceForest, input.derivationStages[1].workspaceForest);
  };
  const input = deferredCopy();
  const result = ownership(input);
  assert.ok(result.currentNodeIds.has('higher'));
  assert.ok(result.currentNodeIds.has('lower'));
  assert.ok(!result.currentNodeIds.has('host'));
  assert.deepEqual([...result.priorNodeIds], ['lower']);
  for (const variant of ['different-lineage', 'missing-lineage', 'duplicate-id', 'second-landing', 'wrong-slot']) {
    const changed = deferredCopy(), stages = changed.derivationStages;
    const current = stages[1].workspaceForest;
    if (variant === 'different-lineage') find(current, 'higher').lineageId = 'other';
    if (variant === 'missing-lineage') delete find(current, 'higher').lineageId;
    if (variant === 'duplicate-id') current.push(structuredClone(find(current, 'higher')));
    if (variant === 'second-landing') {
      current.push({ ...find(current, 'higher'), id: 'another' });
      stages[1].relations[0].anchors.anotherCopy = 'another';
    }
    if (variant === 'wrong-slot') find(current, 'base').children.reverse();
    assert.ok(!ownership(changed)?.currentNodeIds.has('higher'), variant);
  }
});

for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: an unrecognized copy graph has finite geometry through completion`, () => {
    const input = deferredCopy(), original = structuredClone(input);
    const steps = prepareReplay({ ...input, includePlayback: true }).playbackSteps;
    const groups = buildStageLayoutGroups(steps, replayStages(input));
    const sizes = new Map(input.derivationStages.map((_, i) => [i, stageTreeLayoutSize(steps, i, width, height, groups)]));
    const positions = new Map([...sizes].flatMap(([i, size]) => [...buildStageCoordinateReservations(steps, i, size, i => sizes.get(i), direction)]));
    for (const step of steps) {
      const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
      const visible = new Set(step.replayVisibleNodeIds);
      for (const node of layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), direction,
        positions.get(step.replayCanvasData), visible).descendants().filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly)) {
        assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
      }
    }
    assert.deepEqual(input, original);
  });
}
