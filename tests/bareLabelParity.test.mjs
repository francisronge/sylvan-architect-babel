/* Minimalism writes Bare Phrase Structure labels (T for TP, T′ and T), X-bar
 * writes the level. The same structure must read the same in both: every
 * committed X-bar fixture is rewritten into bare labels and compared with
 * itself for panel positions, movement kinds, tiers and casing. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryLabel, readCategoryLabel } from '../replay/categoryLabel.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { readBareProjections, writesProjectionLevels } from '../replay/projectionStructure.ts';
import { buildReplayPanelContent } from '../replay/replayPanel.ts';
import { buildReplayDisplayDetailBlocks } from '../replay/replayPanelFormatting.ts';
import { describeReplayNodePosition } from '../replay/replayNodeDescription.ts';
import { isStructureFaithfulXbar, toBarePanelValue, toBarePosition, toBareStages } from './helpers/bareLabels.mjs';
import { panelText, tierLines } from './helpers/layoutSnapshot.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const xbar = loadFixtureAnalyses().records
  .filter(({ record }) => record.derivationStages.every(stage => writesProjectionLevels(stage.workspaceForest)));
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true });
const pairs = xbar.map(({ id, record }) => {
  const bareRecord = { ...record, derivationStages: toBareStages(record.derivationStages) };
  return { id, record, bareRecord, xbar: prepare(record), bare: prepare(bareRecord) };
});
const faithful = pairs.filter(({ record }) => record.derivationStages.every(stage => isStructureFaithfulXbar(stage.workspaceForest)));
const level = label => readCategoryLabel(label)?.kind;
const nodes = root => {
  const out = [];
  const visit = (node, parent) => { out.push([node, parent]); node.children?.forEach(child => visit(child, node)); };
  if (root) visit(root);
  return out;
};
const stageEnds = steps => new Map(steps.map(step => [step.replayFrameIndex, step]));
const nonBranchingProjection = (bare, node) => {
  const parent = node && bare.parent(node);
  return Boolean(parent && parent.children.length === 1 && bare.projects(node, parent));
};

test('the rewrite keeps enough X-bar fixtures to compare', () => {
  assert(pairs.length >= 150, `${pairs.length} X-bar fixture analyses`);
  assert(faithful.length >= 15, `${faithful.length} structure-faithful X-bar analyses`);
});

test('every phrase and head position reads the same in bare labels', () => {
  let compared = 0;
  const specifiers = new Set(), complements = new Set(), differences = [];
  for (const { id, xbar: authored, bare } of pairs) {
    const bareEnds = stageEnds(bare.playbackSteps);
    for (const [stage, step] of stageEnds(authored.playbackSteps)) {
      const bareCanvas = bareEnds.get(stage)?.replayCanvasData, reader = bareCanvas && readBareProjections([bareCanvas]);
      if (!step.replayCanvasData || !reader) continue;
      const bareNodes = new Map(nodes(bareCanvas).map(([node]) => [node.id, node]));
      // Only a label whose level its bare structure also shows makes a claim
      // the rewrite keeps; see isStructureFaithfulXbar.
      const faithfulAt = (node, rewritten) => {
        const kind = level(node?.label), parent = rewritten && reader.parent(rewritten);
        if (!kind || !rewritten || readCategoryLabel(node.label).compound) return false;
        const minimal = reader.minimal(rewritten), maximal = reader.maximal(rewritten);
        const insideHead = Boolean(parent && reader.minimal(parent));
        return kind === 'phrase' ? maximal && !insideHead : kind === 'bar' ? !maximal && !minimal : minimal && (!maximal || insideHead);
      };
      for (const [node, parent] of nodes(step.replayCanvasData)) {
        const kind = level(node.label);
        if (!parent || !(kind === 'phrase' || kind === 'head' && node.children?.length)) continue;
        const rewritten = bareNodes.get(node.id), sister = parent.children.find(child => child !== node);
        // Bare labels write a non-branching projection (V′ over V⁰) like a
        // display wrapper, which a position description looks through.
        if (nonBranchingProjection(reader, rewritten) || !faithfulAt(node, rewritten)
          || !faithfulAt(parent, reader.parent(rewritten)) || sister && !faithfulAt(sister, bareNodes.get(sister.id))) continue;
        compared++;
        const expected = describeReplayNodePosition(step.replayCanvasData, node.id);
        const actual = describeReplayNodePosition(bareCanvas, node.id);
        if (/^Spec,/.test(actual)) specifiers.add(id);
        if (/^complement of /.test(actual)) complements.add(id);
        if (toBarePosition(expected) !== actual) differences.push({ id, stage, node: node.id, expected, actual, parent: parent.label });
      }
    }
  }
  assert(compared > 5000, `${compared} positions compared`);
  assert(specifiers.size > 50 && complements.size > 50, `${specifiers.size} analyses with specifiers, ${complements.size} with complements`);
  // X-bar reads its bare head label P as a phrase (it ends in P), so a PP
  // complement reads "NP in P′". The bare reading names the complement.
  const prepositionalComplement = ({ expected, actual, parent }) => categoryLabel(parent) === 'P'
    && /^.+ in P[′’']/u.test(expected) && actual === 'complement of P';
  assert.deepEqual(differences.filter(difference => !prepositionalComplement(difference)), []);
});

test('Source and Landing panel lines name the same positions in bare labels', () => {
  let lines = 0;
  const panels = (prepared, record) => panelText({ buildReplayPanelContent, buildReplayDisplayDetailBlocks },
    prepared.playbackSteps, record.derivationStages);
  for (const { id, record, bareRecord, xbar: authored, bare } of faithful) {
    const expected = panels(authored, record), actual = panels(bare, bareRecord);
    const relationSteps = prepared => new Map(prepared.playbackSteps.flatMap((step, index) => step.replayKind === 'relation'
      ? [[JSON.stringify(step.replayRelationIdentity ?? step.targetNodeId), index]] : []));
    const bareSteps = relationSteps(bare);
    for (const [key, index] of relationSteps(authored)) {
      const step = bare.playbackSteps[bareSteps.get(key)];
      assert(step, `${id} has relation step ${key} in bare labels`);
      const prior = bareRecord.derivationStages[step.replayFrameIndex - 1]?.workspaceForest ?? [];
      const described = [step.targetNodeId, ...(step.sourceNodeIds ?? []),
        ...(step.replayRelationLinks ?? []).map(link => link.priorSourceNodeId)].filter(Boolean);
      const readers = [readBareProjections([step.replayCanvasData]), readBareProjections(prior)].filter(Boolean);
      const forestNodes = [step.replayCanvasData, ...prior].flatMap(root => nodes(root).map(([node]) => node));
      if (described.some(nodeId => forestNodes.filter(node => node.id === nodeId)
        .some(node => readers.some(reader => nonBranchingProjection(reader, node))))) continue;
      const position = ([label]) => label === 'Source' || label === 'Landing';
      const want = expected[index].lines.filter(position).map(([label, value]) => [label, toBarePanelValue(value)]);
      const got = actual[bareSteps.get(key)].lines.filter(position).map(([label, value]) => [label, value]);
      assert.deepEqual(got, want, `${id} relation ${key}`);
      lines += want.length;
    }
  }
  assert(lines >= 60, `${lines} Source and Landing lines compared`);
});

test('movement kinds and relation tiers do not depend on the notation', () => {
  const kinds = prepared => [...new Set((prepared.relationRenderPlan?.frames ?? []).flatMap(frame => frame.items)
    .filter(item => item.trajectoryKind)
    .map(item => `${item.relationRef.stageIndex}:${item.relationRef.relationIndex} ${item.targetNodeId} ${item.trajectoryKind}`))].sort();
  const heads = faithful.filter(({ xbar: authored }) => kinds(authored).some(kind => kind.endsWith(' head')));
  assert(heads.length >= 5, `${heads.length} faithful analyses with head movement`);
  for (const { id, xbar: authored, bare } of faithful) {
    assert.deepEqual(kinds(bare), kinds(authored), `${id} movement kinds`);
    assert.deepEqual(tierLines(bare.relationRenderPlan), tierLines(authored.relationRenderPlan), `${id} tiers`);
  }
});

test('sentence-initial casing does not depend on the notation', () => {
  let words = 0;
  const leaves = step => {
    const out = new Map();
    for (const [node, parent] of nodes(step?.replayCanvasData)) {
      // X-bar keeps the authored form of a word written directly under a
      // phrase label (DP over "What"); bare labels read that node as the
      // word's own head, so only words under X-bar heads make a claim.
      if (!node.children?.length && node.word !== undefined && level(parent?.label) === 'head') out.set(node.id, node.word);
    }
    return out;
  };
  for (const { id, xbar: authored, bare } of faithful) {
    const bareEnds = stageEnds(bare.playbackSteps);
    for (const [stage, step] of stageEnds(authored.playbackSteps)) {
      const rewritten = new Map(nodes(bareEnds.get(stage)?.replayCanvasData).map(([node]) => [node.id, node.word]));
      for (const [leafId, word] of leaves(step)) {
        assert.equal(rewritten.get(leafId), word, `${id} stage ${stage} ${leafId}`);
        words++;
      }
    }
  }
  assert(words > 200, `${words} words compared`);
});
