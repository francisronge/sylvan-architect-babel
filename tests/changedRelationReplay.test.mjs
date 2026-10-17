import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { visiblePlanFrameItems } from '../replay/relations/relationFrame.ts';
import { planItemRelationRefs } from '../replay/relations/renderPlan.ts';
const forest = [{ id: 'tp', label: 'TP', children: [
  { id: 'subject', label: 'DP', word: 'they', tokenIndex: 0 },
  { id: 'head', label: 'T', word: 'read', tokenIndex: 1 }
] }];
const anchors = { collector: 'head', goal: 'subject' };
const stage = (features, prior = false) => ({ statement: 'An authored state.', stageRecord: 'The feature collection is updated.',
  workspaceForest: structuredClone(forest), relations: [{ relation: 'Feature collection', anchors,
    ...(prior ? { priorAnchors: anchors } : {}), values: { features } }] });
const replay = stages => prepareReplay({ sentence: 'they read', inputTokens: ['they', 'read'], derivationStages: stages, includePlayback: true });
const plaques = (plan, frame, played = new Set([0])) => visiblePlanFrameItems(plan, frame, played).filter(item => item.kind === 'node-plaque');

test('a changed collection gets its own moment and does not rewrite earlier plaque content', () => {
  const stages = [stage(['plural']), stage(['plural', 'third person'])], original = structuredClone(stages);
  const prepared = replay(stages), plan = prepared.relationRenderPlan;
  assert.deepEqual(prepared.playbackSteps.filter(step => step.replayKind === 'relation').map(step => step.replayRelationIdentity), [
    { stageIndex: 0, relationIndex: 0 }, { stageIndex: 1, relationIndex: 0 }
  ]);
  assert.deepEqual(plaques(plan, 0).flatMap(item => item.rows.map(row => row.value)), ['plural']);
  assert(!plaques(plan, 1, new Set()).some(item => item.rows.some(row => row.value === 'third person')));
  assert(plaques(plan, 1).some(item => item.rows.some(row => row.value === 'third person')));
  assert.deepEqual(stages, original);
});

test('an explicit update replaces the earlier collection at its owning relation and seeking preserves both states', () => {
  const prepared = replay([stage(['plural']), stage(['plural', 'third person'], true)]), plan = prepared.relationRenderPlan;
  for (const frame of [0, 1, 0, 1]) {
    const active = plaques(plan, frame);
    assert.equal(active.length, 1);
    assert.deepEqual(active[0].rows.map(row => row.value), frame ? ['plural', 'third person'] : ['plural']);
  }
  assert.deepEqual(plaques(plan, 1, new Set()).flatMap(item => item.rows.map(row => row.value)), ['plural']);
});

test('an exact restatement reuses ink while preserving both authored relation moments', () => {
  const prepared = replay([stage(['plural']), stage(['plural'])]), plan = prepared.relationRenderPlan;
  assert.equal(plaques(plan, 1).length, 1);
  assert.deepEqual(planItemRelationRefs(plaques(plan, 1)[0]).map(ref => ref.stageIndex), [0, 1]);
  assert.equal(prepared.playbackSteps.filter(step => step.replayKind === 'relation').length, 2, 'the renderer must not erase authored records');
});

test('a changed same-anchor collection replaces its earlier value without requiring repeated prior anchors', () => {
  const plan = replay([stage(['singular']), stage(['plural'])]).relationRenderPlan;
  assert.equal(plaques(plan, 1).length, 1, 'the current collection retires the obsolete plaque');
  assert.deepEqual(plaques(plan, 1)[0].rows.map(row => row.value), ['plural']);
});

test('implicit collection updates retire plaque and connectors together at their exact moment, including after unchanged stages', () => {
  const unchanged = stage(['singular']);
  unchanged.relations = [];
  const changed = stage(['plural', 'third person']);
  changed.relations.unshift({ relation: 'Unfamiliar note', anchors: { subject: 'subject' }, values: { note: 'Keep this separate.' } });
  const authored = [stage(['singular']), unchanged, changed], original = structuredClone(authored);
  const plan = replay(authored).relationRenderPlan;
  const rows = (frame, played) => visiblePlanFrameItems(plan, frame, played)
    .filter(item => item.kind === 'node-plaque' || item.kind === 'directed-path' && item.pathStyle === 'case-agree')
    .flatMap(item => item.kind === 'node-plaque' ? item.rows.map(row => row.value) : [item.featureRow.value]);
  for (const frame of [0, 1, 2, 0, 2]) {
    assert.deepEqual(rows(frame, new Set([0])), ['singular', 'singular']);
    if (frame === 2) assert.deepEqual(rows(frame, new Set([0, 1])).sort(), ['plural', 'plural', 'third person', 'third person'].sort());
  }
  assert.deepEqual(authored, original);
});

test('independent feature fields on the same participants persist separately', () => {
  const number = stage(['plural']), person = stage(['third person']);
  number.relations[0].values = { number: 'plural' };
  person.relations[0].values = { person: 'third person' };
  const plan = replay([number, person]).relationRenderPlan;
  assert.deepEqual(plaques(plan, 1).flatMap(item => item.rows).sort((a, b) => a.label.localeCompare(b.label)), [
    { label: 'number', value: 'plural' }, { label: 'person', value: 'third person' }
  ]);
});

test('competing prior or current collections do not acquire an inferred winner', () => {
  const competing = stage(['singular']);
  competing.relations.push(stage(['plural']).relations[0]);
  for (const stages of [[competing, stage(['dual'])], [stage(['dual']), competing]]) {
    const plan = replay(stages).relationRenderPlan;
    assert.deepEqual(plaques(plan, 1, null).flatMap(item => item.rows.map(row => row.value)).sort(), ['dual', 'plural', 'singular']);
  }
});

test('the same spelling of an occurrence ID cannot bridge changed lineage, duplicate IDs or a missing stage', () => {
  for (const mutation of ['lineage', 'duplicate', 'missing']) {
    const first = stage(['singular']), middle = stage(['singular']), last = stage(['plural']);
    middle.relations = [];
    if (mutation === 'lineage') last.workspaceForest[0].children[0].lineageId = 'different-occurrence';
    else if (mutation === 'duplicate') middle.workspaceForest.push(structuredClone(middle.workspaceForest[0].children[0]));
    else middle.workspaceForest[0].children.shift();
    // Render-plan compilation is the boundary under test; a duplicate stage is
    // deliberately not admitted to ordinary Replay by prepareReplay.
    const plan = compileRelationRenderPlan([first, middle, last]);
    assert.deepEqual(plaques(plan, 2, null).flatMap(item => item.rows.map(row => row.value)).sort(), ['plural', 'singular'], mutation);
  }
});

test('an invalid explicit predecessor cannot be silently replaced by same-participant inference', () => {
  const changed = stage(['plural']);
  changed.relations[0].priorAnchors = { collector: 'head', goal: 'missing' };
  const plan = replay([stage(['singular']), changed]).relationRenderPlan;
  assert.equal(plaques(plan, 1).length, 2);
  assert(plan.diagnostics.some(item => item.kind === 'prior-anchor-unresolved'));
});

test('different accepted outcomes preserve their independent collection claims', () => {
  const first = stage(['singular']), next = stage(['plural']);
  first.relations[0].values.outcome = 'licensed';
  next.relations[0].values.outcome = 'blocked';
  const plan = replay([first, next]).relationRenderPlan;
  assert.equal(plaques(plan, 1).length, 2);
});

test('unchanged restatements and successive updates retain their separate histories', () => {
  const authored = [stage(['singular']), stage(['singular']), stage(['plural']), stage(['dual'])];
  const plan = replay(authored).relationRenderPlan;
  for (const frame of [0, 1, 2, 3, 1, 3]) {
    const active = plaques(plan, frame);
    assert.equal(active.length, 1);
    assert.deepEqual(active[0].rows.map(row => row.value), [['singular'], ['singular'], ['plural'], ['dual']][frame]);
  }
  assert.deepEqual(planItemRelationRefs(plaques(plan, 1)[0]).map(ref => ref.stageIndex), [0, 1]);
  assert.deepEqual(plaques(plan, 2, new Set()).flatMap(item => item.rows.map(row => row.value)), ['singular']);
  assert.deepEqual(plaques(plan, 3, new Set()).flatMap(item => item.rows.map(row => row.value)), ['plural']);
});

test('explicit participant transfers remain valid and mixed Case/feature claims do not imply a collection-only update', () => {
  const transferred = stage(['plural']);
  transferred.workspaceForest[0].children.push({ id: 'other', label: 'DP', word: 'others' });
  transferred.relations[0].anchors = { collector: 'head', goal: 'other' };
  transferred.relations[0].priorAnchors = anchors;
  const explicit = compileRelationRenderPlan([stage(['singular']), transferred]);
  assert.equal(plaques(explicit, 1, null).length, 1);
  assert.deepEqual(visiblePlanFrameItems(explicit, 1, null).filter(item => item.pathStyle === 'case-agree')
    .map(item => item.toNodeId), ['other']);
  const first = stage(['singular']), next = stage(['plural']);
  first.relations[0].values.case = 'nominative';
  next.relations[0].values.case = 'nominative';
  const mixed = compileRelationRenderPlan([first, next]);
  assert.equal(plaques(mixed, 1, null).length, 2);
});

test('a relation that owns an adjunction completes it at its own moment, and later relations leave syntax unchanged', () => {
  const word = (id, label, surface, tokenIndex) => ({ id, label, word: surface, tokenIndex });
  const branch = (id, label, children) => ({ id, label, children });
  const clause = () => branch('cp', 'CP', [word('c', 'C', 'that', 2), word('v', 'V', 'stand', 3)]);
  const stages = [
    { statement: 'Select the pieces.', stageRecord: 'Three separate workspaces.', relations: [],
      workspaceForest: [word('q', 'Q', 'two', 0), branch('np', 'NP', [branch('nbar', "N'", [word('n', 'N', 'houses', 1)])]), clause()] },
    { statement: 'Adjoin the relative inside NP, then quantify it.', stageRecord: 'The relative adjoins to the noun, then the numeral quantifies it.',
      relations: [
        { relation: 'relative attachment', anchors: { relativeClause: 'cp', attachmentSite: 'nbar2' } },
        { relation: 'material modification', anchors: { modifier: 'cp', modifiedNominal: 'nbar2' }, priorAnchors: { nominal: 'np' } },
        { relation: 'numeral quantification', anchors: { numeral: 'q', quantityPhrase: 'qp' } }
      ],
      workspaceForest: [branch('qp', 'QP', [word('q', 'Q', 'two', 0),
        branch('np', 'NP', [branch('nbar2', "N'", [branch('nbar', "N'", [word('n', 'N', 'houses', 1)]), clause()])])])] }
  ];
  const steps = prepareReplay({ sentence: 'two houses that stand', inputTokens: ['two', 'houses', 'that', 'stand'],
    derivationStages: stages, includePlayback: true }).playbackSteps;
  const parents = canvas => {
    const map = new Map();
    const visit = (node, parent) => { map.set(node.id, parent); node.children?.forEach(child => visit(child, node.id)); };
    (canvas.replayOrigin?.kind === 'workspace' ? canvas.children : [canvas]).forEach(root => visit(root, null));
    return map;
  };
  const at = operation => steps.findIndex(step => step.replayKind === 'relation' && step.operation === operation);
  const owner = parents(steps[at('material modification')].replayCanvasData);
  assert.equal(owner.get('nbar2'), 'np', 'the new N′ attaches inside NP at its owning relation');
  assert.equal(owner.get('nbar'), 'nbar2', 'the earlier N′ moves under the new N′ at the same moment');
  const later = at('numeral quantification');
  assert.deepEqual(parents(steps[later].replayCanvasData), parents(steps[later - 1].replayCanvasData),
    'a relation that owns no structure leaves every branch unchanged');
});
