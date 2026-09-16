import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spaceAuthoredName } from '../replay/displayText.ts';
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
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

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

test('construction notation shows only affected objects and selection has no duplicate result', () => {
  for (const [operation, sourceLabels, targetLabel, expected] of [
    ['LexicalSelect', [], 'which', []],
    ['Project', ['N′'], 'NP', [{ label: '', value: 'N′ → NP' }]],
    ['ExternalMerge', ['V', 'DP'], 'V′', [{ label: '', value: 'V + DP → V′' }]],
    ['ExternalMerge', ['X', 'X'], 'Z', [{ label: '', value: 'X + X → Z' }]]
  ]) {
    const current = freeze(step({ operation, sourceLabels, targetLabel, workspaceAfter: ['Unrelated', 'Which'] }));
    assert.deepEqual(unkey(buildReplayPanelContent(current).supportLines), expected);
  }
});

test('paired current participants retain every literal, repeated occurrence and separate prior entry', () => {
  const record = { relation: 'Open relation', anchors: { items: ['context', 'context', 'context'], other: 'high' },
    priorAnchors: { items: 'earlier' }, values: { items: ['one', '', 'one'], other: 'nominal', note: 'Keep this.' } };
  const current = freeze(step({ replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 } }));
  const stages = freeze([{ ...stage([]), workspaceForest: [leaf('earlier', 'before')] }, stage([record])]);
  const content = buildReplayPanelContent(current, stages);
  assert.deepEqual(content.supportLines.filter(row => row.literal !== undefined).map(({ label, value, literal }) =>
    ({ label, value, literal })), [
    { label: 'items', value: 'x_i', literal: 'one' },
    { label: 'items', value: 'x_i', literal: '' },
    { label: 'items', value: 'x_i', literal: 'one' },
    { label: 'other', value: 'Which', literal: 'nominal' }
  ]);
  assert.equal(content.supportLines.filter(row => row.label === 'items').length, 3);
  assert(content.supportLines.some(row => row.label === 'items (previous stage)' && row.value === 'before'));
  assert(content.supportLines.some(row => row.label === 'note' && row.value === 'Keep this.'));
  assert.strictEqual(content.authoredRelation, record);
});

test('panel pairing cannot guess unequal lists, similarly named fields or previous-stage associations', () => {
  for (const record of [
    { anchors: { items: ['context', 'high'] }, values: { items: ['only one'] } },
    { anchors: { item: 'context' }, values: { Item: 'Different authored key' } },
    { anchors: { item: 'context' }, priorAnchors: { earlier: 'context' }, values: { earlier: 'Earlier value' } }
  ]) {
    const relation = freeze({ relation: 'Open relation', ...record });
    const content = buildReplayPanelContent(step({ replayKind: 'relation', replayRelationIdentity: { stageIndex: 0, relationIndex: 0 } }), [stage([relation])]);
    assert(content.supportLines.every(row => row.literal === undefined));
    const literals = Object.values(record.values).flat();
    assert(literals.every(value => content.supportLines.some(row => row.value === value)));
  }
});

test('compiled movement Source uses its proven earlier occurrence even when the lower copy has another id', () => {
  const before = node('clause', 'TP', [leaf('origin', 'did', { label: 'T', lineageId: 'tense' }), leaf('other', 'same')]);
  const after = node('question', 'CP', [
    node('complex', 'C', [leaf('landing', 'did', { label: 'T', lineageId: 'tense' }), { id: 'host', label: 'C', children: [] }]),
    node('clause', 'TP', [leaf('lower', 'did', { label: 'T-trace', silent: true, lineageId: 'tense' }), leaf('other', 'same')])
  ]);
  const relation = { relation: 'Open dependency', anchors: { lowerCopy: 'lower', higherCopy: 'landing' }, priorAnchors: { source: 'origin' } };
  const stages = freeze([{ ...stage([]), workspaceForest: [before] }, { ...stage([relation]), workspaceForest: [after] }]);
  const steps = buildReplayPlayback({ sentence: 'did same', analyses: [{ derivationStages: stages }] }).steps;
  const current = steps.find(step => step.replayKind === 'relation');
  assert(current.replayRelationLinks.some(link => link.priorSourceNodeId === 'origin'));
  const source = buildReplayPanelContent(current, stages).supportLines.find(row => row.label === 'Source');
  assert(source.value.startsWith('did'), source.value);
  assert(!source.value.includes('trace'), source.value);
});

test('proven source descriptions fail closed for absent or duplicate prior ids', () => {
  const current = movementStep({ replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
    replayRelationLinks: [movementLink({ authoredRelationKey: '1:0', priorSourceNodeId: 'origin' })] });
  const record = { relation: 'Movement', anchors: { source: 'low', landing: 'high' } };
  for (const workspaceForest of [[], [leaf('origin', 'first'), leaf('origin', 'second')]]) {
    const content = buildReplayPanelContent(current, [{ ...stage([]), workspaceForest }, stage([record])]);
    assert(!content.supportLines.some(row => row.label === 'Source'));
    assert(content.supportLines.some(row => row.label === 'source'), 'the current authored participant stays available');
  }
});

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
    { label: 'source (previous stage)', value: 'before' },
    { label: 'source (previous stage)', value: 'before' },
    { label: 'missing (previous stage)', value: 'participant unavailable' },
    { label: 'ambiguous (previous stage)', value: 'participant ambiguous' }
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
    assert.equal(content.heading, name === 'HeadMove' ? 'Head Move' : name);
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
    assert.equal(content.heading, spaceAuthoredName(relation));
    assert.deepEqual(unkey(content.supportLines), [
      { label: 'author Role', value: 'x_i' },
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
  assert.deepEqual(content.supportLines.filter(row => row.label === 'extra').map(row => row.value), ['x_i', 'x_i', 'participant unavailable']);
  assert(content.supportLines.some(row => row.label === 'trace Witness'));
  assert(content.supportLines.some(row => row.label === 'co Located Context'));
  assert.deepEqual(content.supportLines.filter(row => row.label === 'origin (previous stage)').map(row => row.value), ['participant unavailable', 'participant unavailable']);
  assert.deepEqual(unkey(content.supportLines.slice(-7)), [
    ...record.values.notation.map(value => ({ label: 'notation', value: value === '' ? '""' : value })),
    { label: 'qualification', value: record.values.qualification },
    { label: 'Source', value: 'literal source' },
    { label: 'empty', value: 'empty list' }
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
    { label: 'missing Role', value: 'participant unavailable' }, { label: 'missing Role', value: 'participant unavailable' },
    { label: 'earlier (previous stage)', value: 'participant unavailable' }, { label: 'literal_key', value: record.values.literal_key },
    ...record.values.slots.map(value => ({ label: 'slots', value: value === '' ? '""' : value }))
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
      assert.equal(content.heading, spaceAuthoredName(original.relation));
      const expected = Object.entries(original.values ?? {}).flatMap(([key, value]) => { const label = spaceAuthoredName(key); return Array.isArray(value)
        ? value.length ? value.map(item => ({ label, value: item })) : [{ label, value: 'empty list' }] : [{ label, value }]; });
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

test('name spacing preserves notation, original letters and ambiguous short parts', () => {
  for (const [input, expected] of [
    ['InternalMerge', 'Internal Merge'], ['PFRealization', 'PF Realization'],
    ['higherOccurrence', 'higher Occurrence'], ['CaseAssigner', 'Case Assigner'],
    ...['DP', 'vP', 'A′', 'x_i', 'θRole', '  InternalMerge ', 'AbarMove / WH', 'case-marked'].map(x => [x, x])
  ]) assert.equal(spaceAuthoredName(input), expected);
});

test('previous-stage scope is explicit metadata, not guessed from an authored field name', () => {
  const relation = { relation: 'OpenRelation', anchors: { 'priorAnchors.source': 'context' },
    priorAnchors: { source: 'context', empty: [] }, values: { empty: [], notation: '[]', blank: '' } };
  const stages = freeze([stage([]), stage([relation])]);
  const current = step({ replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 } });
  assert.deepEqual(unkey(buildReplayPanelContent(current, stages).supportLines), [
    { label: 'priorAnchors.source', value: 'x_i' },
    { label: 'source (previous stage)', value: 'x_i' },
    { label: 'empty (previous stage)', value: 'empty list' },
    { label: 'empty', value: 'empty list' }, { label: 'notation', value: '[]' }, { label: 'blank', value: '""' }
  ]);
  assert.strictEqual(buildReplayPanelContent(current, stages).authoredRelation, relation);
});
