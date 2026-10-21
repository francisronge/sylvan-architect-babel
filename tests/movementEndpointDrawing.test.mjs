import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hierarchy } from 'd3';
import { createRelationAnchors } from '../components/renderer/relationAnchors.ts';
import { createTrajectoryDrawing } from '../components/renderer/trajectoryDrawing.ts';
import { createTrajectoryRefinements } from '../components/renderer/trajectoryRefinements.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { isPlanItemRevealed, resolveDisplayedTrajectoryAttachments } from '../replay/relations/renderPlan.ts';
import { createSvgDom, select } from './helpers/svgDom.mjs';

const records = JSON.parse(readFileSync(new URL('../fixtures/movement/source-occurrence-ownership.json', import.meta.url)));

// Exercise the production anchor resolver, geometry binder, SVG painter and
// post-fit refinement. A recognized relation alone is not proof of an arrow.
function draw(item, forest, { canvas, visibleIds, moment } = {}) {
  const dom = createSvgDom();
  try {
    const tree = hierarchy(canvas ?? { id: 'workspace', children: forest });
    const nodes = tree.descendants();
    nodes.forEach((n, i) => { n.__vizId = n.data.id; n.x = i * 120; n.y = n.depth * 100; });
    const g = select(new dom.Element('g'));
    const visible = visibleIds ? nodes.filter(n => visibleIds.has(n.data.id)) : nodes;
    const anchors = createRelationAnchors({ visibleNodes: visible, treeData: tree, g });
    const shell = id => { const n = anchors.resolveOverlayAnchor(id); return n ? { x: n.x - 20, y: n.y - 30, width: 40, height: 30 } : null; };
    const terminal = id => {
      const n = anchors.resolveMaterializedTerminal(anchors.resolveOverlayAnchor(id), id);
      return n ? { x: n.x - 20, y: n.y + 60, width: 40, height: 30 } : null;
    };
    const displayed = resolveDisplayedTrajectoryAttachments(item, id => anchors.overlayNodeById.get(id)?.data, moment);
    const requested = [];
    const bound = bindRelationPlanFrame({ frames: [{ items: [displayed] }] }, 0, (id, attachment) => {
      requested.push([id, attachment]);
      const box = attachment === 'terminal' ? terminal(id) : shell(id);
      return box ? { x: box.x + box.width / 2, y: box.y + box.height + 6 } : null;
    });
    const painter = createTrajectoryDrawing({ ensureTrajectoryRelationLayer: () => g,
      clearMovedCopyClassForAnchors: () => {}, trajectoryMarkerIds: { movement: 'arrow', open: 'open', carrier: 'carrier' } });
    for (const primitive of bound.primitives) painter.drawTrajectoryPath(primitive, displayed, g.append('g'), null);
    const path = g.select('.babel-trajectory-path').node();
    const beforeRefine = path?.getAttribute('d');
    if (path) {
      const refinements = createTrajectoryRefinements({ g,
        measuredTrajectoryShellRect: shell, measuredTrajectoryTerminalRect: terminal,
        productionTrajectoryPaths: () => [path] });
      if (item.trajectoryKind === 'atb') refinements.refineAcrossTheBoardPaths();
      else (item.trajectoryKind === 'head' ? refinements.refineTerminalTrajectory
        : item.trajectoryKind === 'parasitic-gap' ? refinements.refineParasiticGapPath
          : refinements.refinePhrasalPath).call(path);
    }
    return { bound, displayed, requested, beforeRefine, path: path ? { ...path.attrs } : null };
  } finally { dom.restore(); }
}

function drawReplayRelation(prepared, index, identity) {
  const step = prepared.playbackSteps[index], stageIndex = step.replayFrameIndex;
  const playedRelationIndices = new Set(prepared.playbackSteps.slice(0, index + 1)
    .flatMap(s => s.replayRelationIdentity?.stageIndex === stageIndex ? [s.replayRelationIdentity.relationIndex] : []));
  const item = prepared.relationRenderPlan.frames[stageIndex].items.find(item => item.kind === 'trajectory'
    && item.relationRef.stageIndex === identity.stageIndex && item.relationRef.relationIndex === identity.relationIndex);
  if (!item || !isPlanItemRevealed(item, stageIndex, playedRelationIndices, step.replayRelationIdentity?.relationIndex ?? null)) return null;
  return draw(item, [], { canvas: step.replayCanvasData, visibleIds: new Set(step.replayVisibleNodeIds),
    moment: { stageIndex, playedRelationIndices } });
}

const momentIndex = (prepared, identity) => prepared.playbackSteps.findIndex(step =>
  step.replayRelationIdentity?.stageIndex === identity.stageIndex
  && step.replayRelationIdentity.relationIndex === identity.relationIndex);

for (const id of ['sol-danish-active/0', 'astra-danish-impersonal/0', 'astra-danish-impersonal/2']) {
  test(`${id}: the recovered movement produces an actual SVG arrow at its relation moment`, () => {
    const record = records.find(r => r.id === id), original = structuredClone(record);
    const stageIndex = id.startsWith('sol-') ? 3 : 2;
    const prepared = prepareReplay({ ...record, includePlayback: true });
    const item = prepared.relationRenderPlan.frames[stageIndex].items.find(i => i.kind === 'trajectory'
      && i.relationRef.stageIndex === stageIndex && i.relationRef.relationIndex === 0);
    assert(item);
    const index = momentIndex(prepared, item.relationRef);
    assert.equal(drawReplayRelation(prepared, index - 1, item.relationRef), null);
    const result = drawReplayRelation(prepared, index, item.relationRef);
    assert.deepEqual(result.bound.failed, []);
    assert.equal(result.bound.primitives.length, 1);
    assert(result.path);
    assert.equal(result.path['marker-end'], 'url(#arrow)');
    assert.match(result.path.d, /^M .* Q /);
    assert.doesNotMatch(result.path.d, /NaN|Infinity/);
    if (id.startsWith('astra-')) {
      assert.equal(result.displayed.sourceAttachmentNodeId, item.witnessNodeId);
      assert.deepEqual(result.requested[0], [item.witnessNodeId, 'shell-bottom']);
      assert.equal(result.path['data-trajectory-source-anchor'], item.witnessNodeId);
      assert.equal(result.path.d, result.beforeRefine, 'post-fit refinement preserves the exact witness endpoint');
    }
    assert.deepEqual(record, original);
  });
}

const movement = kind => ({ kind: 'trajectory', trajectoryKind: kind, sourceNodeId: 'lower', witnessNodeId: 'witness',
  targetNodeId: 'landing', sourceAttachment: 'terminal', targetAttachment: 'shell-bottom',
  relationRef: { stageIndex: 0, relationIndex: 0, relation: 'Authored movement', anchors: {} } });
const forest = witness => [{ id: 'lower', label: 'NP', children: [witness] },
  { id: 'landing', label: 'NP', children: [{ id: 'word', label: 'N', word: 'word' }] }];

test('all terminal-departure families use the exact wordless witness, regardless of label spelling', () => {
  for (const kind of ['phrasal', 'head', 'atb', 'parasitic-gap']) for (const label of ['t [NP]', 'D [lower copy]', 'unfamiliar notation']) {
    const result = draw(movement(kind), forest({ id: 'witness', label, children: [] }));
    assert.deepEqual(result.bound.failed, [], `${kind}: ${label}`);
    assert.deepEqual(result.requested[0], ['witness', 'shell-bottom']);
    assert.equal(result.path['data-trajectory-source-anchor'], 'witness');
    assert.equal(result.path.d, result.beforeRefine);
  }
});

test('terminal, complex-shell, missing and ambiguous endpoints retain their existing rules', () => {
  const item = movement('phrasal');
  const pronounced = draw(item, forest({ id: 'witness', label: 'D', word: 't₁' }));
  assert.deepEqual(pronounced.requested[0], ['witness', 'terminal']);
  assert(pronounced.path);
  const complex = draw({ ...item, sourceAttachment: 'shell-bottom' }, forest({ id: 'witness', label: 't [NP]' }));
  assert.deepEqual(complex.requested[0], ['lower', 'shell-bottom']);
  for (const input of [forest({ id: 'different', label: 't [NP]' }), forest({ id: 'witness', label: 'NP', children: [
    { id: 'one', label: 'N', word: 'one' }, { id: 'two', label: 'N', word: 'two' }
  ] })]) {
    const result = draw(item, input);
    assert.equal(result.path, null);
    assert.equal(result.bound.failed.length, 1);
    assert.deepEqual(result.requested[0], ['witness', 'terminal']);
  }
});

const endpointRecords = JSON.parse(readFileSync(new URL('../fixtures/movement/displayed-endpoints.json', import.meta.url)));
for (const [id, identity, sourceId, targetId, sourceAttachment] of [
  ['sol-indonesian-applicative/0', { stageIndex: 3, relationIndex: 0 }, 'h_baca_lower', 'h_baca_middle', 'terminal'],
  ['astra-romanian-dative/0', { stageIndex: 4, relationIndex: 0 }, 'cliticLow', 'cliticHigh', 'terminal'],
  ['astra-swedish-passive/0', { stageIndex: 1, relationIndex: 1 }, 'bookObjectTrace', 'book', 'shell-bottom']
]) test(`${id}: exact endpoints draw from their moment through later movement and rewind`, () => {
  const record = endpointRecords.find(r => r.id === id), original = structuredClone(record);
  const prepared = prepareReplay({ ...record, includePlayback: true });
  const start = momentIndex(prepared, identity);
  assert(start > 0);
  assert.equal(drawReplayRelation(prepared, start - 1, identity), null, 'no early arrow');
  const first = drawReplayRelation(prepared, start, identity);
  assert.equal(first.displayed.targetNodeId, targetId);
  for (let index = start; index < prepared.playbackSteps.length; index++) {
    const result = drawReplayRelation(prepared, index, identity);
    assert(result, `Replay ${index + 1} retains the claim`);
    assert.deepEqual(result.bound.failed, [], `Replay ${index + 1}`);
    assert.equal(result.path?.['marker-end'], 'url(#arrow)', `Replay ${index + 1} paints an arrow`);
    assert.doesNotMatch(result.path.d, /NaN|Infinity/);
    assert.deepEqual(result.requested[0], [sourceId, sourceAttachment]);
    assert.deepEqual(result.displayed.relationRef, first.displayed.relationRef, 'authored ownership remains exact');
    if (id.startsWith('sol-') && index >= momentIndex(prepared, { stageIndex: 4, relationIndex: 0 })) {
      assert.equal(result.displayed.targetNodeId, 'h_appl_head_lower');
      assert.deepEqual(result.requested[1], ['h_appl_head_lower', 'shell-bottom']);
    }
    if (id.includes('swedish') && index >= momentIndex(prepared, { stageIndex: 3, relationIndex: 1 })) {
      assert.equal(result.displayed.targetNodeId, 'bookSubjectTrace');
    }
  }
  assert.deepEqual(drawReplayRelation(prepared, start, identity), first, 'rewind restores the original endpoint');
  assert.deepEqual(record, original, 'authored records are unchanged');
});

const proseHeads = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/unrendered-head-movement.json', import.meta.url)));
test('prose-labelled head movement and the complexes it builds draw exact arrows from their moments onward', () => {
  const original = structuredClone(proseHeads);
  const prepared = prepareReplay({ ...structuredClone(proseHeads), includePlayback: true });
  for (const [stageIndex, kind, sourceId, targetId, targetAttachment] of [
    [2, 'head', 'verbTrace', 'verbAtHonorific', 'terminal'],
    [3, 'phrasal', 'honorificTrace', 'honorificAtInflection', 'shell-bottom'],
    [4, 'phrasal', 'inflectionTrace', 'inflectionAtComplementizer', 'shell-bottom']
  ]) {
    const identity = { stageIndex, relationIndex: 0 }, start = momentIndex(prepared, identity);
    assert(start > 0);
    assert.equal(drawReplayRelation(prepared, start - 1, identity), null, `${stageIndex}: no early arrow`);
    for (let index = start; index < prepared.playbackSteps.length; index++) {
      const result = drawReplayRelation(prepared, index, identity);
      assert.equal(result.displayed.trajectoryKind, kind);
      assert.deepEqual(result.bound.failed, [], `${stageIndex}: Replay ${index + 1}`);
      assert.equal(result.bound.primitives.length, 1, `${stageIndex}: Replay ${index + 1} binds its arrow`);
      assert.equal(result.path?.['marker-end'], 'url(#arrow)');
      assert.doesNotMatch(result.path.d, /NaN|Infinity/);
      assert.deepEqual(result.requested, [[sourceId, 'shell-bottom'], [targetId, targetAttachment]]);
    }
  }
  assert.deepEqual(proseHeads, original);
});

// Relabel only the next landing as notation, so the next hop is head movement
// on its own evidence; the notation control also relabels the first complex.
const findNode = (nodes, id) => nodes.map(n => n.id === id ? n : findNode(n.children ?? [], id)).find(Boolean);
const relabelled = notation => {
  const record = structuredClone(proseHeads);
  record.derivationStages.forEach((stage, stageIndex) => {
    const labels = { honorificAtInflection: 'H⁰', ...notation && stageIndex >= 2 ? { honorificComplex: 'H', verbAtHonorific: 'V', honorific: 'H' } : {} };
    for (const [id, label] of Object.entries(labels)) { const node = findNode(stage.workspaceForest, id); if (node) node.label = label; }
  });
  return record;
};
for (const notation of [false, true]) test(`the first ${notation ? 'notation' : 'prose'}-labelled head arrow stays at its landing site when the complex moves on`, () => {
  const record = relabelled(notation), original = structuredClone(record);
  const prepared = prepareReplay({ ...record, includePlayback: true });
  const identity = { stageIndex: 2, relationIndex: 0 }, start = momentIndex(prepared, identity);
  const next = momentIndex(prepared, { stageIndex: 3, relationIndex: 0 });
  assert(start > 0 && next > start);
  const nextArrow = drawReplayRelation(prepared, next, { stageIndex: 3, relationIndex: 0 });
  assert.equal(nextArrow.displayed.trajectoryKind, 'head', 'the next hop is head movement');
  const drawn = [];
  for (let index = start; index < prepared.playbackSteps.length; index++) {
    const result = drawReplayRelation(prepared, index, identity);
    const [targetId, attachment] = index < next ? ['verbAtHonorific', 'terminal'] : ['honorificTrace', 'shell-bottom'];
    assert.equal(result.displayed.targetNodeId, targetId, `Replay ${index + 1}`);
    assert.deepEqual(result.requested, [['verbTrace', 'shell-bottom'], [targetId, attachment]], `Replay ${index + 1}`);
    assert.deepEqual(result.bound.failed, [], `Replay ${index + 1}`);
    assert.equal(result.path?.['marker-end'], 'url(#arrow)', `Replay ${index + 1} paints an arrow`);
    assert.doesNotMatch(result.path.d, /NaN|Infinity/);
    drawn[index] = result;
  }
  for (const index of [next - 1, start]) assert.deepEqual(drawReplayRelation(prepared, index, identity), drawn[index],
    `rewinding to Replay ${index + 1} restores its endpoint`);
  assert.deepEqual(record, original, 'authored records are unchanged');
});

test('a proved head landing with several terminals attaches at its shell whatever its label spells', () => {
  const stage = (workspaceForest, relations = []) => ({ statement: '', stageRecord: '', workspaceForest, relations });
  const verb = id => ({ id, label: 'V⁰, compound', lineageId: 'verbChain', children: [
    { id: `${id}Root`, label: 'V', word: 'walk' }, { id: `${id}Particle`, label: 'Prt', word: 'out' }] });
  const tense = { id: 'tense', label: 'Tense head', word: 'ed' }, object = { id: 'object', label: 'Object', word: 'it' };
  const record = { sentence: 'walk out ed it', derivationStages: [
    stage([{ id: 'clause', label: 'Tense projection', children: [tense, { id: 'vp', label: 'Verb phrase', children: [verb('verb'), object] }] }]),
    stage([{ id: 'clause', label: 'Tense projection', children: [
      { id: 'tenseComplex', label: 'Tense head: complex', children: [verb('raised'), tense] },
      { id: 'vp', label: 'Verb phrase', children: [{ id: 'verbTrace', label: 'V⁰, trace', silent: true, lineageId: 'verbChain' }, object] }
    ] }], [{ relation: 'Verb raising to tense', anchors: { 'raised verb': 'raised', 'lower trace': 'verbTrace', 'host head': 'tense' },
      priorAnchors: { 'movement source': 'verb' } }])
  ] };
  const prepared = prepareReplay({ ...record, includePlayback: true });
  const identity = { stageIndex: 1, relationIndex: 0 };
  const result = drawReplayRelation(prepared, momentIndex(prepared, identity), identity);
  assert.equal(result.displayed.trajectoryKind, 'head');
  assert.deepEqual(result.bound.failed, []);
  assert.equal(result.bound.primitives.length, 1);
  assert.deepEqual(result.requested, [['verbTrace', 'shell-bottom'], ['raised', 'shell-bottom']]);
  assert.equal(result.path?.['marker-end'], 'url(#arrow)');
});

const compoundRoles = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/compound-movement-roles.json', import.meta.url))).cases;
for (const [caseIndex, identity, tier, kind, sourceId, targetId, site] of [
  [0, { stageIndex: 5, relationIndex: 0 }, 1, 'head', 'a_vtrace', 'a_v', 'a_thead'],
  [1, { stageIndex: 4, relationIndex: 1 }, 1, 'head', 'hv', 'hv1', 'ht'],
  [1, { stageIndex: 5, relationIndex: 0 }, 2, 'phrasal', 'dpO1', 'dpO2', undefined]
]) test(`compound movement roles beside a host, complex or carried head draw ${sourceId} → ${targetId} from their moment`, () => {
  const record = compoundRoles[caseIndex], original = structuredClone(record);
  const prepared = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const item = prepared.relationRenderPlan.frames[identity.stageIndex].items.find(i => i.kind === 'trajectory'
    && i.relationRef.stageIndex === identity.stageIndex && i.relationRef.relationIndex === identity.relationIndex);
  assert(item, 'the claim keeps its arrow');
  assert.equal(item.claimTier, tier);
  assert.deepEqual([item.trajectoryKind, item.sourceNodeId, item.targetNodeId, item.headLandingSite?.nodeId],
    [kind, sourceId, targetId, site]);
  const start = momentIndex(prepared, identity);
  assert(start > 0);
  assert.equal(prepared.playbackSteps[start].movementDiagnostics, undefined);
  assert.equal(drawReplayRelation(prepared, start - 1, identity), null, 'no early arrow');
  const result = drawReplayRelation(prepared, start, identity);
  assert.deepEqual(result.bound.failed, []);
  assert.equal(result.bound.primitives.length, 1);
  assert.equal(result.path?.['marker-end'], 'url(#arrow)');
  assert.doesNotMatch(result.path.d, /NaN|Infinity/);
  assert.deepEqual(result.requested.map(([id]) => id), [sourceId, targetId]);
  assert.deepEqual(record, original, 'authored records are unchanged');
});
