import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  adaptDerivationStagesForReplay,
  buildPlaybackStepsFromDerivationFrames,
  buildReplayPanelContent,
  buildReplaySupportLines,
  formatOperationLabel,
  formatPlaybackOperationTitle,
  formatReplayBlockLine,
  formatReplayBlockTitle
} from '../replay/replayCompiler.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';

const leaf = (id, word = id, extra = {}) => ({ id, label: 'D', word, ...extra });
const node = (id, label, children) => ({ id, label, children });
const canvas = node('root', 'CP', [
  node('high', 'DP', [leaf('high-word', 'Which')]),
  node('tp', 'TP', [node('low', 'DP', [leaf('low-word', 'Which', { silent: true })]), leaf('context', 'x_i')])
]);
const stage = relations => ({ statement: 'Authored statement', stageRecord: 'Authored record', relations, workspaceForest: [canvas] });
const step = (extra = {}) => ({ operation: 'ExternalMerge', replayKind: 'micro', sourceLabels: ['D', 'N'],
  targetNodeId: 'high', targetLabel: 'DP', recipe: 'External Merge into DP', replayCanvasData: canvas, ...extra });
const movementLink = (extra = {}) => ({ relation: 'AbarMove', operation: 'Relation', renderFamily: 'trajectory',
  trajectoryKind: 'phrasal', authoredRelationKey: '0:0', sourceNodeId: 'low', targetNodeId: 'high',
  anchors: [{ role: 'source', nodeId: 'low' }, { role: 'landing', nodeId: 'high' }, { role: 'traceWitness', nodeId: 'low' }], ...extra });
const movementStep = (extra = {}) => step({ operation: 'AbarMove', replayKind: 'relation', sourceNodeIds: ['low'],
  sourceLabels: ['Which'], targetNodeId: 'high', targetLabel: 'Which', replayRelationIdentity: { stageIndex: 0, relationIndex: 0 },
  replayRelationLinks: [movementLink()], ...extra });
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const unkey = rows => rows.map(({ label, value }) => ({ label, value }));

test('Replay panels exclude compiler diagnostics and preserve authored content and stored evidence', () => {
  const record = { relation: 'Wh licensing', anchors: { operator: 'high' }, values: { Audit: 'An authored qualification' } };
  const diagnostic = 'RELATION_TIMING_CONFLICT: Stage 1, relation 1 requires high before relation 2 introduces it.';
  for (const operation of ['Wh licensing', 'AbarMove']) {
    const current = freeze(movementStep({ operation, replayRelationLinks: [], movementDiagnostics: [diagnostic] }));
    const stages = freeze([stage([record])]);
    const content = buildReplayPanelContent(current, stages);
    assert.deepEqual(content, buildReplayPanelContent({ ...current, movementDiagnostics: [] }, stages));
    assert.deepEqual(unkey(content.supportLines.filter(row => row.label === 'Audit')),
      [{ label: 'Audit', value: 'An authored qualification' }]);
    assert.deepEqual(current.movementDiagnostics, [diagnostic]);
  }
});

test('prior participants use the preceding authored occurrence, not the current label or lineage', () => {
  const record = { relation: 'Dependency', anchors: { participant: 'same_id' },
    priorAnchors: { source: ['same_id', 'same_id'], missing: 'unknown_x_i', ambiguous: 'duplicate' } };
  const stages = freeze([
    { ...stage([]), workspaceForest: [leaf('same_id', 'before'), leaf('duplicate', 'one'), leaf('duplicate', 'two')] },
    { ...stage([record]), workspaceForest: [leaf('same_id', 'after')] }
  ]);
  const current = step({ replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
    replayCanvasData: stages[1].workspaceForest[0] });
  const content = buildReplayPanelContent(current, stages);
  assert.deepEqual(unkey(content.supportLines), [
    { label: 'participant', value: 'after' },
    { label: 'priorAnchors.source', value: 'before' },
    { label: 'priorAnchors.source', value: 'before' },
    { label: 'priorAnchors.missing', value: 'unknown_x_i' },
    { label: 'priorAnchors.ambiguous', value: 'duplicate' }
  ]);
  assert.strictEqual(content.authoredRelation, record);
});

test('structural operation headings do not disappear behind a differing recipe', () => {
  for (const [operation, recipe, targetLabel, heading] of [
    ['LexicalSelect', 'Select x_i', 'x_i', 'Select x_i'],
    ['Project', 'Project V above x_i', 'V', 'Project V'],
    ['ExternalMerge', 'External Merge into DP', 'DP', 'External Merge'],
    ['StageRecord', 'A long authored explanation.', 'DP', 'Stage Record']
  ]) {
    const current = step({ operation, recipe, targetLabel, replayKind: operation === 'StageRecord' ? 'macro' : 'micro' });
    assert.equal(buildReplayPanelContent(current).heading, heading);
    assert.equal(formatPlaybackOperationTitle(current), heading);
  }
  assert.equal(buildReplayPanelContent(null).heading, 'Derivation');
});

test('authored relation names preserve punctuation, casing, scripts, and whitespace', () => {
  for (const name of ['WH_percolation', "A'-chain / I-to-C", 'HeadMove', 'Pol:\u2212 / x_i', '\u03b8_\u1d62 \u4e3b\u8a9e', '  Wh: x_i  ', 'long relation '.repeat(30)]) {
    const record = { relation: name, anchors: { target: 'context' }, values: {} };
    const current = step({ replayKind: 'relation', operation: 'IncompleteDisplayName', replayRelationIdentity: { stageIndex: 0, relationIndex: 0 } });
    const content = buildReplayPanelContent(current, [stage([record])]);
    assert.equal(content.heading, name);
    assert.strictEqual(content.authoredRelation, record);
    assert.equal(formatPlaybackOperationTitle({ ...current, operation: name }), name);
  }
  assert.equal(formatOperationLabel('unknown_x_i'), 'unknown_x_i');
});

test('macro panels preserve the exact original statement without promoting generated recipes', () => {
  const statement = '  Merge x_i: [uPol:\u2212]\n\u03b8 / \u4e3b\u8a9e; A\'-chain  ';
  const stages = freeze([stage([]), { ...stage([]), statement }]);
  const current = freeze(step({ operation: 'StageRecord', replayKind: 'macro', replayFrameIndex: 1,
    visualFrameIndex: 0, recipe: 'Generated or normalized recipe', note: statement }));
  const content = buildReplayPanelContent(current, stages);
  assert.equal(content.heading, 'Stage Record');
  assert.deepEqual(unkey(content.supportLines), [{ label: 'Statement', value: statement }]);
  assert.equal(content.authoredRelation, null);
  for (const operation of ['LexicalSelect', 'Project', 'ExternalMerge']) {
    const micro = { ...current, replayKind: 'micro', operation, recipe: 'Generated micro recipe' };
    const panel = buildReplayPanelContent(micro, stages);
    assert(!panel.supportLines.some(line => line.label === 'Statement' || line.value === micro.recipe));
    assert.equal(panel.heading, operation === 'ExternalMerge' ? 'External Merge' : `${formatOperationLabel(operation)} DP`);
  }
});

test('macro statements require a real stage identity and never fall back to recipe text', () => {
  const current = step({ operation: 'StageRecord', replayKind: 'macro', recipe: 'Not proof of an authored statement' });
  const stages = [stage([])];
  for (const replayFrameIndex of [undefined, -1, 1, 0.5, NaN]) {
    assert.deepEqual(buildReplayPanelContent({ ...current, replayFrameIndex }, stages).supportLines, []);
  }
  for (const statement of [undefined, '']) {
    assert.deepEqual(buildReplayPanelContent({ ...current, replayFrameIndex: 0 }, [{ ...stage([]), statement }]).supportLines, []);
  }
});

test('detail formatting preserves literal text instead of changing names or inflection vocabulary', () => {
  const text = '  x_i != x i; T / Infl; [uPol:\u2212]\n\u03b8_\u1d62, \u4e3b\u8a9e; I-to-C; WH_percolation  ';
  for (const title of ['Stage Record', 'Relations', 'SELECTION', 'LOCALITY', 'x_i / \u03b8']) {
    assert.equal(formatReplayBlockTitle(title), title);
    assert.equal(formatReplayBlockLine(title, text, [step({ targetLabel: 'T', sourceLabels: ['TP'] })]), text);
  }
});

test('authored names matching structural operations retain their original relation rows', () => {
  for (const relation of ['StageRecord', 'LexicalSelect', 'Project', 'ExternalMerge']) {
    const record = { relation, anchors: { authorRole: 'context' }, values: { notation: ['x_i', 'x_i'] } };
    const current = step({ operation: relation, replayKind: 'relation', replayRelationIdentity: { stageIndex: 0, relationIndex: 0 } });
    const content = buildReplayPanelContent(current, [stage([record])]);
    assert.equal(content.heading, relation);
    assert.deepEqual(unkey(content.supportLines), [
      { label: 'authorRole', value: 'x_i' },
      { label: 'notation', value: 'x_i' },
      { label: 'notation', value: 'x_i' }
    ]);
  }
});

test('movement keeps Source/Landing, uncovered anchors, prior anchors, and every literal value', () => {
  const record = { relation: 'AbarMove', anchors: { source: 'low', landing: 'high', traceWitness: 'low',
    extra: ['context', 'context', 'unknown_x_i'], coLocatedContext: 'low' },
    priorAnchors: { origin: ['previous_x_i', 'previous_x_i'] },
    values: { notation: ['x_i', 'x_i', '', '  '], qualification: 'not licensed?\n[Pol:\u2212]', Source: 'literal source', empty: [] } };
  const stages = freeze([stage([record])]);
  const current = freeze(movementStep());
  const content = buildReplayPanelContent(current, stages);
  assert.deepEqual(content.supportLines.slice(0, 2).map(row => row.label), ['Source', 'Landing']);
  assert(!content.supportLines.some(row => row.label === 'source' || row.label === 'landing'));
  assert.deepEqual(content.supportLines.filter(row => row.label === 'extra').map(row => row.value), ['x_i', 'x_i', 'unknown_x_i']);
  assert(content.supportLines.some(row => row.label === 'traceWitness'));
  assert(content.supportLines.some(row => row.label === 'coLocatedContext'));
  assert.deepEqual(content.supportLines.filter(row => row.label === 'priorAnchors.origin').map(row => row.value), ['previous_x_i', 'previous_x_i']);
  assert.deepEqual(unkey(content.supportLines.slice(-7)), [
    ...record.values.notation.map(value => ({ label: 'notation', value })),
    { label: 'qualification', value: record.values.qualification },
    { label: 'Source', value: 'literal source' },
    { label: 'empty', value: '[]' }
  ]);
  assert.equal(new Set(content.supportLines.map(row => row.key)).size, content.supportLines.length);
  assert.deepEqual(content, buildReplayPanelContent(current, stages));
});

test('plural or repeated endpoint roles are never hidden by one movement summary', () => {
  const record = { relation: 'AbarMove', anchors: { source: ['low', 'low'], landing: ['high'] } };
  const content = buildReplayPanelContent(movementStep(), [stage([record])]);
  assert.equal(content.supportLines.filter(row => row.label === 'source').length, 2);
  assert.equal(content.supportLines.filter(row => row.label === 'landing').length, 1);
});

test('the original record remains complete even when no rendering link exists', () => {
  const record = { relation: 'Unknown relation x_i', anchors: { missingRole: ['missing_x_i', 'missing_x_i'] },
    priorAnchors: { earlier: 'prior_x_i' }, values: { 'literal_key': 'dp_obj / x_i\nline 2', slots: ['a', '', 'a'] } };
  const current = step({ operation: 'Unknown relation x_i', replayKind: 'relation', replayRelationIdentity: { stageIndex: 0, relationIndex: 0 }, replayRelationLinks: [] });
  const content = buildReplayPanelContent(current, [stage([record])]);
  assert.strictEqual(content.authoredRelation, record);
  assert.deepEqual(unkey(content.supportLines), [
    { label: 'missingRole', value: 'missing_x_i' }, { label: 'missingRole', value: 'missing_x_i' },
    { label: 'priorAnchors.earlier', value: 'prior_x_i' }, { label: 'literal_key', value: record.values.literal_key },
    ...record.values.slots.map(value => ({ label: 'slots', value }))
  ]);
});

test('relation identity selects one original instance and never borrows a same-name sibling', () => {
  const first = { relation: 'RepeatedName', anchors: { target: 'context' }, values: { note: 'first' } };
  const second = { ...first, values: { note: 'second' } };
  const stages = [stage([first, second])];
  const current = step({ operation: first.relation, replayKind: 'relation', replayRelationIdentity: { stageIndex: 0, relationIndex: 1 },
    replayRelationLinks: [{ relation: first.relation, authoredRelationKey: '0:0', values: first.values }] });
  assert.strictEqual(buildReplayPanelContent(current, stages).authoredRelation, second);
  assert.equal(buildReplayPanelContent(current, stages).supportLines.at(-1).value, 'second');
  for (const replayRelationIdentity of [undefined, { stageIndex: 0, relationIndex: 5 }, { stageIndex: -1, relationIndex: 0 }]) {
    const missing = buildReplayPanelContent({ ...current, replayRelationIdentity }, stages);
    assert.equal(missing.authoredRelation, null);
    assert(!missing.supportLines.some(row => ['first', 'second'].includes(row.value)));
  }
  assert.deepEqual(buildReplaySupportLines(current), []);
  assert.equal(buildReplayPanelContent({ ...current, replayKind: 'micro' }, stages).authoredRelation, null);
});

test('link-only compatibility callers also retain movement values literally', () => {
  const values = { notation: ['x_i', 'dp_obj', 'x_i'], qualification: 'not licensed\nT = Infl' };
  const current = movementStep({ replayRelationLinks: [movementLink({ values })] });
  assert.deepEqual(buildReplaySupportLines(current).slice(-4), [
    ...values.notation.map(value => ({ label: 'notation', value })), { label: 'qualification', value: values.qualification }
  ]);
});

const saved = JSON.parse(readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url), 'utf8'));
test('the saved Astra licensing conflict remains stored without appearing in the Replay panel', () => {
  const record = saved.find(record => record.name === 'astra-xbar');
  const stages = record.derivationStages;
  const plan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(adaptDerivationStagesForReplay(stages), undefined, plan);
  const licensing = steps.find(step => step.replayRelationIdentity?.stageIndex === 4 && step.replayRelationIdentity?.relationIndex === 0);
  assert.match(licensing.movementDiagnostics.join('\n'), /Stage 5, relation 1 \(wh licensing\) requires frontedNP before relation 2/);
  assert.equal(buildReplayPanelContent(licensing, stages).supportLines.some(line => line.label === 'Audit'), false);
});
for (const record of saved) {
  test(`${record.name}: every compiled relation panel resolves the full original without changing Replay`, () => {
    const stages = freeze(structuredClone(record.derivationStages));
    const plan = buildDerivationReplayPlan({ derivationStages: stages });
    const steps = buildPlaybackStepsFromDerivationFrames(adaptDerivationStagesForReplay(stages), undefined, plan);
    const before = JSON.stringify(steps);
    const relationSteps = steps.filter(item => item.replayKind === 'relation');
    assert(relationSteps.length > 0);
    for (const current of relationSteps) {
      const identity = current.replayRelationIdentity;
      const original = stages[identity.stageIndex].relations[identity.relationIndex];
      const content = buildReplayPanelContent(current, stages);
      assert.strictEqual(content.authoredRelation, original);
      assert.equal(content.heading, original.relation);
      const expected = Object.entries(original.values ?? {}).flatMap(([label, value]) => Array.isArray(value)
        ? value.length ? value.map(item => ({ label, value: item })) : [{ label, value: '[]' }] : [{ label, value }]);
      if (expected.length) assert.deepEqual(unkey(content.supportLines.slice(-expected.length)), expected);
      assert.equal(new Set(content.supportLines.map(row => row.key)).size, content.supportLines.length);
    }
    const macroSteps = steps.filter(item => item.replayKind === 'macro');
    assert.equal(macroSteps.length, stages.length);
    for (const current of macroSteps) {
      const content = buildReplayPanelContent(current, stages);
      assert.equal(content.heading, 'Stage Record');
      assert.deepEqual(unkey(content.supportLines), [
        { label: 'Statement', value: stages[current.replayFrameIndex].statement }
      ]);
      assert(current.detailBlocks.some(block => block.title === 'Stage Record'));
    }
    const microSteps = steps.filter(item => item.replayKind === 'micro');
    assert(microSteps.some(current => current.recipe !== stages[current.replayFrameIndex].statement));
    for (const current of microSteps) {
      const content = buildReplayPanelContent(current, stages);
      const expected = ['LexicalSelect', 'Project'].includes(current.operation) && current.targetLabel.trim()
        ? `${formatOperationLabel(current.operation)} ${current.targetLabel.trim()}`
        : formatOperationLabel(current.operation);
      assert.equal(content.heading, expected);
      assert(!content.supportLines.some(line => line.label === 'Statement' || line.value === current.recipe));
    }
    assert.equal(JSON.stringify(steps), before);
  });
}
