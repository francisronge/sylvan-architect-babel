import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { checkExistingNotRemerged } from './helpers/replayInvariants.mjs';

// Claude Opus 5.5, n3-06 (Hebrew construct state), stages 6-7: the subject DP
// raises from Spec-AP to Spec-IP. It keeps its ID at the landing but carries no
// lineageId, while the fresh trace in its exact preceding slot declares one.
// The kept ID and the slot identify the moved occurrence, so Replay must play
// the movement at its own moment rather than select the trace as a new word
// and merge the DP in from scratch.
const RECORD = JSON.parse(String.raw`{"sentence": "בית המורה גדול.", "inputTokens": ["בית", "ה", "מורה", "גדול"], "derivationStages": [{"statement": "A null present-tense INFL head takes the AP as its complement.", "stageRecord": "Hebrew present-tense copular clauses have no overt copula, so INFL is a silent present-tense head. It merges with the AP and projects I'. This stage is recorded separately because subject raising in the next stage requires I' to exist first. No relation beyond combination is introduced.", "relations": [], "workspaceForest": [{"id": "ibar", "label": "I'", "children": [{"id": "i_pres", "label": "I[+present]", "silent": true, "children": []}, {"id": "ap", "label": "AP", "lineageId": "pred_AP", "children": [{"id": "dp_subj", "label": "DP", "children": [{"id": "dbar_subj", "label": "D'", "children": [{"id": "d_complex", "label": "D[+construct]", "children": [{"id": "n_beit", "label": "N", "word": "בית", "lineageId": "beit_N", "children": []}, {"id": "d_cs", "label": "D[+construct]", "silent": true, "children": []}]}, {"id": "np_beit", "label": "NP", "children": [{"id": "dp_more", "label": "DP", "children": [{"id": "dbar_ha", "label": "D'", "children": [{"id": "d_ha", "label": "D", "word": "ה", "children": []}, {"id": "np_more", "label": "NP", "children": [{"id": "nbar_more", "label": "N'", "children": [{"id": "n_more", "label": "N", "word": "מורה", "children": []}]}]}]}]}, {"id": "nbar_beit", "label": "N'", "children": [{"id": "n_beit_t", "label": "t", "silent": true, "lineageId": "beit_N", "children": []}]}]}]}]}, {"id": "abar", "label": "A'", "children": [{"id": "a_gadol", "label": "A", "word": "גדול", "children": []}]}]}]}]}, {"statement": "The subject DP raises to the specifier of IP, receiving nominative Case and agreeing with INFL.", "stageRecord": "The DP בית המורה moves from the specifier of AP to the specifier of IP, leaving an antecedent-governed trace in the specifier of AP. Because it gets no Case inside AP, it moves to a Case position. In the specifier of IP, the silent present-tense INFL assigns it nominative Case under spec-head government. INFL then agrees with the subject in its masculine singular features. The result is the clause 'The teacher's house is big'.", "relations": [{"relation": "NP-movement", "anchors": {"mover": "dp_subj", "trace": "dp_subj_t"}}, {"relation": "case-assignment", "anchors": {"assigner": "i_pres", "assignee": "dp_subj"}, "values": {"case": "nominative"}}, {"relation": "agreement", "anchors": {"probe": "i_pres", "goal": "dp_subj"}, "values": {"gender": "masculine", "number": "singular", "tense": "present"}}], "workspaceForest": [{"id": "ip", "label": "IP", "children": [{"id": "dp_subj", "label": "DP", "children": [{"id": "dbar_subj", "label": "D'", "children": [{"id": "d_complex", "label": "D[+construct]", "children": [{"id": "n_beit", "label": "N", "word": "בית", "lineageId": "beit_N", "children": []}, {"id": "d_cs", "label": "D[+construct]", "silent": true, "children": []}]}, {"id": "np_beit", "label": "NP", "children": [{"id": "dp_more", "label": "DP", "children": [{"id": "dbar_ha", "label": "D'", "children": [{"id": "d_ha", "label": "D", "word": "ה", "children": []}, {"id": "np_more", "label": "NP", "children": [{"id": "nbar_more", "label": "N'", "children": [{"id": "n_more", "label": "N", "word": "מורה", "children": []}]}]}]}]}, {"id": "nbar_beit", "label": "N'", "children": [{"id": "n_beit_t", "label": "t", "silent": true, "lineageId": "beit_N", "children": []}]}]}]}]}, {"id": "ibar", "label": "I'", "children": [{"id": "i_pres", "label": "I[+present]", "silent": true, "children": []}, {"id": "ap", "label": "AP", "lineageId": "pred_AP", "children": [{"id": "dp_subj_t", "label": "t", "silent": true, "lineageId": "subj_DP", "children": []}, {"id": "abar", "label": "A'", "children": [{"id": "a_gadol", "label": "A", "word": "גדול", "children": []}]}]}]}]}]}]}`);

const find = (forest, id) => {
  for (const node of forest) {
    if (node.id === id) return node;
    const found = find(node.children ?? [], id);
    if (found) return found;
  }
};
const variant = (edit) => {
  const record = structuredClone(RECORD);
  edit(record.derivationStages[0], record.derivationStages[1]);
  return record;
};
const recover = (record, relation = record.derivationStages[1].relations[0]) => recoverMovementEvidence(
  relation, record.derivationStages[1].workspaceForest, record.derivationStages[0].workspaceForest);

test('a kept-ID landing without lineage moves when its fresh trace holds its exact preceding slot', () => {
  const original = structuredClone(RECORD);
  const evidence = recover(RECORD);
  assert.equal(evidence.movement?.sourceNodeId, 'dp_subj_t');
  assert.equal(evidence.movement?.targetNodeId, 'dp_subj');
  assert.equal(evidence.movement?.priorSourceNodeId, 'dp_subj');
  assert(evidence.diagnostics.some(text => text.startsWith('MOVEMENT_LANDING_LINEAGE_OMITTED')), 'the omitted lineage stays recorded');

  const replay = prepareReplay({ ...RECORD, includePlayback: true });
  assert(replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory'
    && item.relationRef.relationIndex === 0), 'the movement draws its path');
  const stage = replay.playbackSteps.filter(step => step.replayFrameIndex === 1);
  assert.deepEqual(stage.filter(step => ['LexicalSelect', 'ExternalMerge'].includes(step.operation)).map(step => step.operation), [],
    'neither the trace nor the landing is built as new construction');
  const moment = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity?.relationIndex === 0);
  assert(moment > 0, 'the movement has its moment');
  for (const step of replay.playbackSteps.slice(0, moment).filter(step => step.replayFrameIndex === 1))
    assert(!step.replayVisibleNodeIds.includes('dp_subj_t'), 'the trace waits for the movement moment');
  assert(['dp_subj_t', 'dp_subj', 'ip'].every(id => replay.playbackSteps[moment].replayVisibleNodeIds.includes(id)));
  assert.deepEqual(checkExistingNotRemerged(replay, RECORD).map(item => item.detail), [], 'construction does not merge the moved DP again');
  assert.deepEqual(RECORD, original, 'authored data stays unchanged');
});

test('a kept ID without lineage is not a movement on weaker evidence', () => {
  const refusals = {
    'the fresh trace stands in another slot': [variant((_, after) => {
      find(after.workspaceForest, 'ap').children.reverse();
    })],
    'the anchored occurrence kept its position': [RECORD, { relation: 'NP-movement', anchors: { mover: 'abar', trace: 'dp_subj_t' } }],
    'the claim does not anchor the occurrence holding the slot': [RECORD, { relation: 'NP-movement', anchors: { mover: 'dp_subj', trace: 'abar' } }],
    'the claim anchors the landing alone': [RECORD, { relation: 'NP-movement', anchors: { mover: 'dp_subj' } }],
    'the trace continues a lineage of the preceding stage': [variant(before => {
      find(before.workspaceForest, 'abar').lineageId = 'subj_DP';
    })]
  };
  for (const [name, [record, relation]] of Object.entries(refusals)) {
    const evidence = recover(record, relation);
    assert.equal(evidence.movement, undefined, name);
    assert(!evidence.diagnostics.some(text => text.startsWith('MOVEMENT_LANDING_LINEAGE_OMITTED')), name);
  }
});
