import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  compileRelationRenderPlan,
  visiblePlanFrameItems
} from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, boundOverlayBounds } from '../replay/relations/geometryBinding.ts';
import {
  adaptDerivationStagesForReplay,
  buildPlaybackStepsFromDerivationFrames,
  formatAuthoredWitnessSurface
} from '../replay/replayCompiler.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';

const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (relations, forest) => ({
  statement: 'A derivational state holds.',
  stageRecord: 'A record of the derivational state, long enough to be substantive prose.',
  relations: relations,
  workspaceForest: forest
});

const gridProvider = (positions) => (nodeId) => positions.get(nodeId) || null;

/* ------------------------------------------------------------------ *
 * Blocker 2: authored witness kind is authoritative.
 * ------------------------------------------------------------------ */

test('display indexing is additive only: t gains its index; ∅, silent lexical, and overt stay authored', () => {
  assert.equal(formatAuthoredWitnessSurface('t', '2'), 't₂');
  assert.match(formatAuthoredWitnessSurface('t₁'), /^t₁$/);
  assert.equal(formatAuthoredWitnessSurface('∅', '1'), '∅', 'authored ∅ stays ∅ even inside a movement chain');
  assert.equal(formatAuthoredWitnessSurface('someone', '3'), 'someone', 'silent lexical material stays lexical');
  assert.equal(formatAuthoredWitnessSurface('laughed', '1'), 'laughed', 'overt material stays overt');
});

test('EllipsisDeletion targets the authored domain without making Recoverability own silence', () => {
  const tree = node('cp_gh', 'CP', [
    node('vp_site_gh', 'VP', [
      leaf('v_gh', 'V', 'read', { silent: true }),
      node('dp_gh', 'DP', [leaf('d_gh', 'D', 'it')])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'EllipsisDeletion', anchors: { site: 'vp_site_gh' } }], [tree])
  ]);
  const [item] = plan.frames[0].items;
  assert.equal(item.kind, 'strike-ghost');
  assert.deepEqual(item.strikeNodeIds, ['vp_site_gh']);
  assert.deepEqual(item.ghostNodeIds, []);
});

test('ellipsis licensing content composes from the ordinary feature plaque and ellipsis site', () => {
  const tree = node('cp_el', 'CP', [
    leaf('c_el', 'C', '∅'),
    node('tp_el', 'TP', [
      leaf('t_el', 'T', '∅'),
      node('vp_el', 'vP', [leaf('v_el', 'V', 'read', { silent: true })], { silent: true })
    ], { silent: true })
  ]);
  const plan = compileRelationRenderPlan([stage([
    {
      relation: 'FeatureBundle',
      anchors: { licensor: 'c_el' },
      values: { feature: '[E]' }
    },
    { relation: 'Ellipsis', anchors: { domain: 'tp_el' } }
  ], [tree])]);
  const plaque = plan.frames[0].items.find((item) => item.kind === 'node-plaque');
  const site = plan.frames[0].items.find((item) => item.kind === 'ellipsis-site');
  assert.equal(plaque?.plaqueStyle, 'feature');
  assert.deepEqual(plaque?.rows, [{ label: 'feature', value: '[E]' }]);
  assert.equal(site?.siteNodeId, 'tp_el');
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'directed-path'), false);
});

test('control, binding, coreference, and predication remain post-fit accepted annotations', () => {
  const tree = node('tp_cbcp', 'TP', [
    node('dp_cbcp_controller', 'DP', [leaf('d_cbcp_controller', 'D', 'John')]),
    node('vp_cbcp', 'VP', [
      node('v_cbcp', 'V', [leaf('v_cbcp_word', 'V', 'saw')]),
      node('dp_cbcp_bound', 'DP', [leaf('d_cbcp_bound', 'D', 'himself')]),
      node('tp_cbcp_domain', 'TP', [
        node('dp_cbcp_controllee', 'DP', [leaf('d_cbcp_controllee', 'D', 'PRO', { silent: true })])
      ])
    ])
  ]);
  const plan = compileRelationRenderPlan([stage([
    {
      relation: 'Control',
      anchors: {
        controller: 'dp_cbcp_controller',
        controllee: 'dp_cbcp_controllee',
        domain: 'tp_cbcp_domain'
      }
    },
    {
      relation: 'Binding',
      anchors: {
        binder: 'dp_cbcp_controller',
        bound: 'dp_cbcp_bound',
        domain: 'vp_cbcp'
      },
      values: { outcome: 'licensed' }
    },
    {
      relation: 'Coreference',
      anchors: { antecedent: 'dp_cbcp_controller', pronoun: 'dp_cbcp_bound' }
    },
    {
      relation: 'Predication',
      anchors: { predicand: 'dp_cbcp_controller', predicate: 'v_cbcp' }
    }
  ], [tree])]);
  const positions = new Map([
    ['tp_cbcp', { x: 300, y: 50 }],
    ['dp_cbcp_controller', { x: 100, y: 150 }],
    ['d_cbcp_controller', { x: 100, y: 450 }],
    ['vp_cbcp', { x: 400, y: 150 }],
    ['v_cbcp', { x: 300, y: 300 }],
    ['v_cbcp_word', { x: 300, y: 500 }],
    ['dp_cbcp_bound', { x: 500, y: 300 }],
    ['d_cbcp_bound', { x: 500, y: 500 }],
    ['tp_cbcp_domain', { x: 700, y: 300 }],
    ['dp_cbcp_controllee', { x: 700, y: 450 }],
    ['d_cbcp_controllee', { x: 700, y: 600 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, gridProvider(positions));
  const relevant = bound.primitives.filter((primitive) => (
    primitive.type === 'index-badge'
    || primitive.type === 'domain-ellipse'
    || (primitive.type === 'shape-path' && ['control', 'predication'].includes(primitive.shapeStyle))
    || (primitive.type === 'domain-region' && primitive.domainStyle === 'control-domain')
  ));
  assert.ok(relevant.length >= 8);
  assert.ok(relevant.every((primitive) => primitive.fitPolicy === 'tree-first'));
  assert.equal(boundOverlayBounds(bound), null,
    'accepted label-measured relation marks must never refit the ordinary tree');
});

test('QuantifierRaising compiles one accepted scope-path-index composite', () => {
  const tree = node('tp_qr', 'TP', [
    node('qp_qr_high', 'QP', [leaf('q_qr_high', 'Q', 'every', { silent: true })], { silent: true }),
    node('tp_qr_scope', 'TP', [
      node('vp_qr_scope', 'VP', [
        node('qp_qr_low', 'QP', [leaf('q_qr_low', 'Q', 'every')])
      ])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'QuantifierRaising',
      anchors: {
        pronouncedQP: 'qp_qr_low',
        lfQP: 'qp_qr_high',
        scopeDomain: 'tp_qr_scope'
      }
    }], [tree])
  ]);
  assert.deepEqual(plan.frames[0].items.map((item) => item.kind), ['quantifier-raising']);
  const [item] = plan.frames[0].items;
  assert.deepEqual({
    pronouncedNodeId: item.pronouncedNodeId,
    lfNodeId: item.lfNodeId,
    scopeDomainNodeId: item.scopeDomainNodeId,
    index: item.index
  }, {
    pronouncedNodeId: 'qp_qr_low',
    lfNodeId: 'qp_qr_high',
    scopeDomainNodeId: 'tp_qr_scope',
    index: 'i'
  });

  const positions = new Map([
    ['qp_qr_low', { x: 600, y: 500 }],
    ['qp_qr_high', { x: 100, y: 100 }],
    ['tp_qr_scope', { x: 400, y: 200 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, gridProvider(positions));
  assert.deepEqual(bound.primitives.map((primitive) => primitive.type), ['quantifier-raising']);
  assert.equal(boundOverlayBounds(bound), null, 'the accepted QR composition is measured after the ordinary tree fit');
});

test('FeatureBundle hands one accepted plaque from the old state to the new state at the exact relation moment', () => {
  const tree = node('kp_case', 'KP', [
    node('dp_case', 'DP', [leaf('n_case', 'N', 'Mina')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'FeatureBundle',
      anchors: { bearer: 'dp_case' },
      values: { 'CASE 1': 'DAT', 'CASE 2': '--' }
    }], [tree]),
    stage([{
      relation: 'FeatureBundle',
      anchors: { bearer: 'dp_case' },
      values: { 'CASE 1': 'DAT', 'CASE 2': 'NOM' }
    }], [tree])
  ]);
  const rows = (items) => items
    .filter((item) => item.kind === 'node-plaque')
    .map((item) => item.rows.map((row) => `${row.label}:${row.value}`).join('|'));
  assert.deepEqual(rows(visiblePlanFrameItems(plan, 0, new Set())), []);
  assert.deepEqual(rows(visiblePlanFrameItems(plan, 0, new Set([0]))), ['CASE 1:DAT|CASE 2:--']);
  assert.deepEqual(rows(visiblePlanFrameItems(plan, 1, new Set())), ['CASE 1:DAT|CASE 2:--']);
  assert.deepEqual(rows(visiblePlanFrameItems(plan, 1, new Set([0]))), ['CASE 1:DAT|CASE 2:NOM']);
  assert.deepEqual(rows(visiblePlanFrameItems(plan, 1, null)), ['CASE 1:DAT|CASE 2:NOM']);

  const bound = bindRelationPlanFrame(
    plan,
    1,
    gridProvider(new Map([
      ['dp_case', { x: 200, y: 100 }],
      ['n_case', { x: 240, y: 400 }]
    ])),
    { labelHeight: 70 }
  );
  const [plaque] = bound.primitives
    .filter((primitive) => primitive.type === 'plaque' && primitive.plaqueStyle === 'feature');
  assert.ok(plaque);
  assert.equal(plaque.width, 360);
  assert.equal(plaque.height, 150);
  assert.equal(boundOverlayBounds(bound), null,
    'the accepted feature plaque is measured after the ordinary tree fit');
});

test('Agree with authored values begins with the probe plaque instead of a goal-only flash', () => {
  const tree = node('tp_agree_plaque', 'TP', [
    node('t_agree_plaque', 'T', [leaf('t_agree_terminal', 'T', '[uφ]')]),
    node('dp_agree_goal', 'DP', [leaf('d_agree_goal', 'D', 'The girls')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'Agree',
      anchors: { probe: 't_agree_plaque', goal: 'dp_agree_goal' },
      values: { 'uφ': '__ → 3PL', Case: 'NOM' }
    }], [tree])
  ]);
  const items = visiblePlanFrameItems(plan, 0, new Set([0]));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'node-plaque');
  assert.deepEqual(items[0].anchorNodeIds, ['t_agree_plaque']);
  assert.deepEqual(items[0].rows, [
    { label: 'uφ', value: '__ → 3PL' },
    { label: 'Case', value: 'NOM' }
  ]);
  assert.ok(!items.some((item) => item.kind === 'node-badges'),
    'the relation moment must not substitute a goal highlight for its authored plaque');
});

test('Case collection compiles one plaque and preserves each authored relation moment', () => {
  const tree = node('kp_case_collection', 'KP', [
    leaf('p_case_collection', 'P', 'af'),
    node('k_case_collection', 'K', [
      leaf('num_case_collection', 'Num', 'PL'),
      leaf('n_case_collection', 'N', 'MASC')
    ])
  ]);
  const plan = compileRelationRenderPlan([stage([
    {
      relation: 'CaseAssignment',
      anchors: { assigner: 'p_case_collection', bearer: 'k_case_collection' },
      values: { feature: 'Case', value: 'DAT' }
    },
    {
      relation: 'Agree',
      anchors: { probe: 'k_case_collection', goal: 'num_case_collection' },
      values: { feature: 'Number', value: 'PL' }
    },
    {
      relation: 'Agree',
      anchors: { probe: 'k_case_collection', goal: 'n_case_collection' },
      values: { feature: 'Gender', value: 'MASC' }
    },
    {
      relation: 'FeatureBundle',
      anchors: { bearer: 'k_case_collection' },
      values: { Case: 'DAT', Number: 'PL', Gender: 'MASC' }
    }
  ], [tree])]);
  const items = plan.frames[0].items;

  assert.deepEqual(items.map((item) => ({
    kind: item.kind,
    pathStyle: item.pathStyle,
    relationIndex: item.relationRef.relationIndex
  })), [
    { kind: 'directed-path', pathStyle: 'case-assignment', relationIndex: 0 },
    { kind: 'directed-path', pathStyle: 'case-agree', relationIndex: 1 },
    { kind: 'directed-path', pathStyle: 'case-agree', relationIndex: 2 },
    { kind: 'node-plaque', pathStyle: undefined, relationIndex: 3 }
  ]);
  assert.equal(items.filter((item) => item.kind === 'node-plaque').length, 1);
  assert.deepEqual(items.at(-1).rows, [
    { label: 'Case', value: 'DAT' },
    { label: 'Number', value: 'PL' },
    { label: 'Gender', value: 'MASC' }
  ]);
  assert.deepEqual(
    visiblePlanFrameItems(plan, 0, new Set([0, 1])).map((item) => item.relationRef.relationIndex),
    [0, 1],
    'the second Agree path cannot appear before its own relation moment'
  );
});

test('SplitAntecedence binds one dependent square and separate arrows to each antecedent', () => {
  const tree = node('tp_split', 'TP', [
    node('dp_split_one', 'DP', [leaf('d_split_one', 'D', 'Kyle')]),
    node('dp_split_two', 'DP', [leaf('d_split_two', 'D', 'Sten')]),
    node('dp_split_dependent', 'DP', [leaf('d_split_dependent', 'D', 'themselves')])
  ]);
  const plan = compileRelationRenderPlan([stage([{
    relation: 'SplitAntecedence',
    anchors: {
      antecedents: ['dp_split_one', 'dp_split_two'],
      dependent: 'dp_split_dependent'
    }
  }], [tree])]);
  const [item] = plan.frames[0].items;
  assert.deepEqual({
    kind: item.kind,
    antecedents: item.antecedentNodeIds,
    dependent: item.dependentNodeId
  }, {
    kind: 'split-antecedence',
    antecedents: ['dp_split_one', 'dp_split_two'],
    dependent: 'dp_split_dependent'
  });
  const bound = bindRelationPlanFrame(plan, 0, gridProvider(new Map([
    ['dp_split_one', { x: 100, y: 100 }],
    ['dp_split_two', { x: 300, y: 200 }],
    ['dp_split_dependent', { x: 500, y: 300 }]
  ])));
  const [mark] = bound.primitives.filter((primitive) => primitive.type === 'split-antecedence');
  assert.ok(mark);
  assert.equal(mark.fitPolicy, 'tree-first');
  assert.deepEqual(mark.origin, { x: 500, y: 300 });
  assert.deepEqual(mark.links.map((link) => link.antecedentNodeId), [
    'dp_split_one',
    'dp_split_two'
  ]);
  assert.match(mark.links[0].d, /^M 496\.0 302\.0 C /);
  assert.match(mark.links[0].d, /100\.0 100\.0$/);
  assert.match(mark.links[1].d, /^M 504\.0 302\.0 C /);
  assert.match(mark.links[1].d, /300\.0 200\.0$/);
  assert.equal(bound.primitives.some((primitive) => primitive.type === 'text-badge'), false);
  assert.equal(boundOverlayBounds(bound), null,
    'the accepted coreference overlay cannot refit the ordinary tree');
});

test('GappingAlignment renders only source-authored correlate-remnant indices while EllipsisDeletion owns the gap', () => {
  const tree = node('coord_gap', 'CoordP', [
    node('v_gap_ant', 'V', [leaf('v_gap_ant_word', 'V', 'cooked')]),
    node('v_gap_site', 'V', [leaf('v_gap_site_word', 'V', 'cooked', { silent: true })], { silent: true }),
    node('dp_gap_cor', 'DP', [leaf('n_gap_cor', 'N', 'soup')]),
    node('advp_gap_cor', 'AdvP', [leaf('adv_gap_cor', 'Adv', 'today')]),
    node('dp_gap_rem', 'DP', [leaf('n_gap_rem', 'N', 'curry')]),
    node('advp_gap_rem', 'AdvP', [leaf('adv_gap_rem', 'Adv', 'yesterday')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'EllipsisDeletion', anchors: { site: 'v_gap_site' } },
      {
        relation: 'GappingAlignment',
        anchors: {
          correlates: ['dp_gap_cor', 'advp_gap_cor'],
          remnants: ['dp_gap_rem', 'advp_gap_rem']
        },
        values: { labels: ['1', '2'] }
      }
    ], [tree])
  ]);
  assert.deepEqual(plan.frames[0].items.map((item) => item.kind), ['strike-ghost', 'node-badges']);
  const alignment = plan.frames[0].items.find((item) => item.kind === 'node-badges');
  assert.ok(alignment);
  assert.equal(alignment.relationRef.relation, 'GappingAlignment');
  assert.equal(alignment.familyId, 'gapping.alignment');
  assert.equal(alignment.persistence, 'from-stage-onward');
  assert.deepEqual(alignment.badges, [
    { nodeId: 'dp_gap_cor', text: '-1', shape: 'plain' },
    { nodeId: 'dp_gap_rem', text: '=1', shape: 'plain' },
    { nodeId: 'advp_gap_cor', text: '-2', shape: 'plain' },
    { nodeId: 'advp_gap_rem', text: '=2', shape: 'plain' }
  ]);
  assert.equal(alignment.badgeStyle, 'gapping-ordinal');
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'undirected-link'), false);
  assert.deepEqual(plan.frames[0].items[0].relationRef.relation, 'EllipsisDeletion');
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'ellipsis-site'), false);
});

test('GappingAlignment fails closed without suppressing a separately authored deletion', () => {
  const tree = node('coord_gap_missing', 'CoordP', [
    node('v_gap_missing_site', 'V', [leaf('v_gap_missing_site_word', 'V', 'cooked', { silent: true })], { silent: true }),
    node('dp_gap_missing_cor', 'DP', [leaf('n_gap_missing_cor', 'N', 'soup')]),
    node('dp_gap_missing_rem', 'DP', [leaf('n_gap_missing_rem', 'N', 'curry')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'EllipsisDeletion', anchors: { site: 'v_gap_missing_site' } },
      {
        relation: 'GappingAlignment',
        anchors: {
          correlates: ['dp_gap_missing_cor'],
          remnants: ['missing_remnant']
        },
        values: { labels: ['1'] }
      }
    ], [tree])
  ]);
  assert.deepEqual(plan.frames[0].items.map((item) => item.kind), ['strike-ghost', 'fallback']);
  assert.equal(plan.frames[0].items[0].relationRef.relation, 'EllipsisDeletion');
  assert.equal(plan.frames[0].items[1].relationRef.relation, 'GappingAlignment');
  assert.ok(plan.diagnostics.some((failure) => (
    failure.kind === 'anchor-unresolved'
    && failure.detail.includes('missing_remnant')
  )));
});

/* ------------------------------------------------------------------ *
 * Blocker 1: one movement authority, per instance.
 * ------------------------------------------------------------------ */

const twoChainTree = node('cp_2c', 'CP', [
  node('dp_wh_high', 'DP', [leaf('d_wh_high', 'D', 'what')]),
  node('dp_adv_high', 'DP', [leaf('d_adv_high', 'D', 'where')]),
  node('tp_2c', 'TP', [
    node('dp_wh_low', 'DP', [leaf('d_wh_low', 'D', 't', { silent: true, lineageId: 'chain-wh' })], { silent: true, lineageId: 'chain-wh' }),
    node('dp_adv_low', 'DP', [leaf('d_adv_low', 'D', 't', { silent: true, lineageId: 'chain-adv' })], { silent: true, lineageId: 'chain-adv' })
  ])
]);

test('two independent A-bar chains in one derivation both compile and both bind', () => {
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'AbarMove', anchors: { lowerCopy: 'dp_wh_low', traceWitness: 'd_wh_low', pronouncedCopy: 'dp_wh_high' } },
      { relation: 'AbarMove', anchors: { lowerCopy: 'dp_adv_low', traceWitness: 'd_adv_low', pronouncedCopy: 'dp_adv_high' } }
    ], [twoChainTree])
  ]);
  const trajectories = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  assert.equal(trajectories.length, 2, 'two same-stage instances of one relation both compile');
  const positions = new Map([
    ['dp_wh_high', { x: 100, y: 50 }], ['d_wh_high', { x: 100, y: 150 }],
    ['dp_adv_high', { x: 300, y: 50 }], ['d_adv_high', { x: 300, y: 150 }],
    ['dp_wh_low', { x: 500, y: 300 }], ['d_wh_low', { x: 500, y: 400 }],
    ['dp_adv_low', { x: 700, y: 300 }], ['d_adv_low', { x: 700, y: 400 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId, attachment = 'position') => positions.get(nodeId) || null);
  assert.equal(bound.primitives.filter((p) => p.type === 'trajectory-path').length, 2);
});

test('ATB with three paired gaps compiles one trajectory per pair, all preserved', () => {
  const sources = ['atb_s1', 'atb_s2', 'atb_s3'];
  const witnesses = ['atb_w1', 'atb_w2', 'atb_w3'];
  const tree = node('tp_atb3', 'TP', [
    ...sources.map((id, index) =>
      node(id, 'XP', [leaf(witnesses[index], 'X', 't', { silent: true })], { silent: true })),
    node('yp_atb3', 'YP', [leaf('t_atb3', 'Y', 'what')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AcrossTheBoardMovement',
      anchors: { sources, traceWitnesses: witnesses, pronouncedCopy: 'yp_atb3' }
    }], [tree])
  ]);
  const trajectories = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  assert.equal(trajectories.length, 3);
  assert.deepEqual(trajectories.map((item) => item.witnessNodeId), witnesses);
  assert.ok(trajectories.every((item) => item.sourceAttachment === 'terminal'));
  assert.ok(trajectories.every((item) => item.targetAttachment === 'shell'));
  const traceBadges = plan.frames[0].items
    .filter((item) => item.kind === 'node-badges' && item.badgeStyle === 'gap-notation')
    .flatMap((item) => item.badges);
  assert.deepEqual(
    traceBadges,
    sources.map((nodeId) => ({ nodeId, text: 'tᵢ', shape: 'plain' })),
    'every lower occurrence receives the accepted trace notation in authored order'
  );
  assert.equal(
    plan.frames[0].items.filter((item) => item.kind === 'coindex').length,
    0,
    'ATB carries no extra landing index beyond its indexed lower traces'
  );
});

test('sideward movement compiles the accepted cross-workspace arch and source-copy notation', () => {
  const tree = node('coord_sideward', 'CoordP', [
    node('dp_sideward_target', 'DP', [
      leaf('d_sideward_target', 'D', 'a'),
      leaf('n_sideward_target', 'N', 'tamer')
    ]),
    node('dp_sideward_source', 'DP', [
      leaf('d_sideward_source', 'D', 'a', { silent: true }),
      leaf('n_sideward_source', 'N', 'tamer', { silent: true })
    ], { silent: true })
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'SidewardMovement',
      anchors: {
        lowerCopy: 'dp_sideward_source',
        traceWitness: 'd_sideward_source',
        pronouncedCopy: 'dp_sideward_target'
      }
    }], [tree])
  ]);
  const trajectory = plan.frames[0].items.find((item) => item.kind === 'trajectory');
  assert.ok(trajectory);
  assert.equal(trajectory.trajectoryKind, 'sideward');
  assert.equal(trajectory.sourceAttachment, 'shell-top');
  assert.equal(trajectory.targetAttachment, 'shell-top');
  const copyBadge = plan.frames[0].items.find((item) =>
    item.kind === 'node-badges' && item.badgeStyle === 'gap-notation');
  assert.deepEqual(copyBadge?.badges, [{
    nodeId: 'dp_sideward_source',
    text: 't₁',
    shape: 'plain'
  }]);

  const bound = bindRelationPlanFrame(
    plan,
    0,
    (nodeId, attachment = 'position') => {
      if (nodeId === 'dp_sideward_source' && attachment === 'shell-top') return { x: 600, y: 200 };
      if (nodeId === 'dp_sideward_target' && attachment === 'shell-top') return { x: 200, y: 200 };
      return { x: 0, y: 0 };
    },
    { trajectoryCeilingY: 40 }
  );
  const path = bound.primitives.find((primitive) => primitive.type === 'trajectory-path');
  assert.equal(path?.d, 'M 600.0 200.0 C 600.0 40.0, 200.0 40.0, 200.0 200.0');
});

test('remnant movement derives its orthogonal departure from its own vacated material', () => {
  const tree = node('root_remnant_route', 'CP', [
    node('xp_remnant_high', 'XP', [leaf('x_remnant_high', 'X', 'fronted')]),
    node('dp_nested_high', 'DP', [leaf('d_nested_high', 'D', 'object')]),
    node('xp_remnant_low', 'XP', [
      node('dp_nested_low', 'DP', [
        leaf('d_nested_low', 'D', 'object', { silent: true })
      ], { silent: true }),
      leaf('x_remnant_low', 'X', 'x', { silent: true }),
      leaf('y_remnant_low', 'Y', 'y', { silent: true }),
      leaf('null_remnant_low', '∅', '∅', { silent: true })
    ], { silent: true })
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'Scrambling',
      anchors: {
        lowerCopy: 'dp_nested_low',
        traceWitness: 'd_nested_low',
        pronouncedCopy: 'dp_nested_high'
      }
    }], [tree]),
    stage([{
      relation: 'RemnantMovement',
      anchors: {
        lowerCopy: 'xp_remnant_low',
        traceWitness: 'x_remnant_low',
        pronouncedCopy: 'xp_remnant_high'
      }
    }], [tree])
  ]);
  const remnant = plan.frames[1].items.find(
    (item) => item.kind === 'trajectory' && item.trajectoryKind === 'remnant'
  );
  assert.ok(remnant);
  assert.deepEqual(
    remnant.orthogonalDepartureNodeIds,
    ['x_remnant_low', 'y_remnant_low'],
    'the prior nested evacuation and authored null are not remnant departure witnesses'
  );

  const bound = bindRelationPlanFrame(
    plan,
    1,
    (nodeId, attachment = 'position') => {
      if (nodeId === 'xp_remnant_low' && attachment === 'shell-bottom') return { x: 400, y: 500 };
      if (nodeId === 'xp_remnant_high' && attachment === 'shell-bottom') return { x: 100, y: 200 };
      if (nodeId === 'd_nested_low' && attachment === 'terminal') return { x: 450, y: 520 };
      if (nodeId === 'dp_nested_high' && attachment === 'shell-bottom') return { x: 300, y: 240 };
      return { x: 250, y: 300 };
    },
    { trajectoryFloorY: 700 }
  );
  const path = bound.primitives.find(
    (primitive) => primitive.type === 'trajectory-path' && primitive.trajectoryKind === 'remnant'
  );
  assert.equal(path?.route, 'orthogonal');
  assert.equal(path?.d, 'M 400.0 500.0 L 400.0 700.0 L 100.0 700.0 L 100.0 200.0');
});

test('a complex phrasal mover binds shell-to-shell while a one-leaf mover may use its witness', () => {
  const tree = node('cp_shell_law', 'CP', [
    node('dp_complex_high', 'DP', [leaf('d_complex_high', 'D', 'which'), leaf('n_complex_high', 'N', 'book')]),
    node('dp_complex_low', 'DP', [leaf('d_complex_low', 'D', 't', { silent: true }), leaf('n_complex_low', 'N', 't', { silent: true })], { silent: true }),
    node('dp_atomic_high', 'DP', [leaf('d_atomic_high', 'D', 'who')]),
    node('dp_atomic_low', 'DP', [leaf('d_atomic_low', 'D', 't', { silent: true })], { silent: true })
  ]);
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'AbarMove', anchors: { lowerCopy: 'dp_complex_low', traceWitness: 'd_complex_low', pronouncedCopy: 'dp_complex_high' } },
      { relation: 'AbarMove', anchors: { lowerCopy: 'dp_atomic_low', traceWitness: 'd_atomic_low', pronouncedCopy: 'dp_atomic_high' } }
    ], [tree])
  ]);
  const [complex, atomic] = plan.frames[0].items.filter((item) => item.kind === 'trajectory');
  assert.equal(complex.sourceAttachment, 'shell-bottom');
  assert.equal(complex.targetAttachment, 'shell-bottom');
  assert.equal(atomic.sourceAttachment, 'terminal');
  assert.equal(atomic.targetAttachment, 'shell-bottom');
});

test('all production trajectories are tree-first overlays', () => {
  const tree = node('cp_tree_first', 'CP', [
    node('dp_high_tree_first', 'DP', [leaf('d_high_tree_first', 'D', 'Which')]),
    node('vp_tree_first', 'VP', [
      node('dp_low_tree_first', 'DP', [leaf('d_low_tree_first', 'D', 't', { silent: true })])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AbarMove',
      anchors: {
        lowerCopy: 'dp_low_tree_first',
        traceWitness: 'd_low_tree_first',
        pronouncedCopy: 'dp_high_tree_first'
      }
    }], [tree])
  ]);
  const positions = new Map([
    ['d_low_tree_first', { x: 500, y: 700 }],
    ['dp_high_tree_first', { x: 100, y: 100 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, gridProvider(positions));
  const path = bound.primitives.find((primitive) => primitive.type === 'trajectory-path');
  assert.equal(path?.fitPolicy, 'tree-first');
  assert.equal(boundOverlayBounds(bound), null, 'movement overlays must not refit the accepted tree');
});

test('Phillips parasitic-gap topology binds its terminal departure to the authored trace witness', () => {
  const tree = node('cp_pg_phillips', 'CP', [
    node('dp_pg_filler', 'DP', [leaf('d_pg_filler', 'D', 'which')]),
    node('dp_pg_real', 'DP', [leaf('d_pg_witness', 'D', 't', { silent: true })], { silent: true }),
    node('dp_pg_secondary', 'DP', [leaf('d_pg_secondary', 'D', 'gap', { silent: true })], { silent: true })
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'dp_pg_filler',
        realGap: 'dp_pg_real',
        traceWitness: 'd_pg_witness',
        parasiticGap: 'dp_pg_secondary',
        primaryPath: ['cp_pg_phillips', 'dp_pg_real'],
        secondaryPath: ['dp_pg_filler', 'dp_pg_secondary']
      }
    }], [tree])
  ]);
  const requested = [];
  const bound = bindRelationPlanFrame(plan, 0, (nodeId, attachment = 'position') => {
    requested.push({ nodeId, attachment });
    if (nodeId === 'd_pg_witness' && attachment === 'terminal') return { x: 500, y: 600 };
    if (nodeId === 'dp_pg_filler' && attachment === 'shell-bottom') return { x: 100, y: 120 };
    return { x: 0, y: 0 };
  });
  const trajectory = bound.primitives.find((primitive) => primitive.type === 'trajectory-path');
  assert.deepEqual(trajectory?.from, { x: 500, y: 600 });
  assert.ok(requested.some(({ nodeId, attachment }) =>
    nodeId === 'd_pg_witness' && attachment === 'terminal'));
  assert.equal(
    requested.some(({ nodeId, attachment }) =>
      nodeId === 'dp_pg_secondary' && attachment === 'terminal'),
    false,
    'the parasitic gap is never requested as the movement departure'
  );
  const gapBadges = plan.frames[0].items
    .filter((item) => item.kind === 'node-badges' && item.badgeStyle === 'gap-notation')
    .flatMap((item) => item.badges);
  assert.deepEqual(gapBadges, [
    { nodeId: 'dp_pg_secondary', text: 'pgᵢ', shape: 'plain' }
  ], 'only the parasitic site receives a relation-owned pg side label');
  assert.match(
    readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8'),
    /babel-pg-gap-label/,
    'the pg notation is painted as a separate overlay label, not by rewriting terminal text'
  );
});

test('Phillips path rings and blocked-edge slashes are post-fit marks', () => {
  const tree = node('cp_pg_postfit', 'CP', [
    node('dp_pg_primary', 'DP', [leaf('d_pg_primary', 'D', 'which')]),
    node('dp_pg_secondary', 'DP', [leaf('d_pg_secondary', 'D', 'gap', { silent: true })], { silent: true })
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ParasiticGap',
      anchors: {
        filler: 'dp_pg_primary',
        realGap: 'dp_pg_secondary',
        traceWitness: 'd_pg_secondary',
        parasiticGap: 'dp_pg_secondary',
        primaryPath: ['cp_pg_postfit'],
        secondaryPath: ['dp_pg_secondary'],
        blockedEdge: 'dp_pg_secondary'
      },
      values: { outcome: 'blocked' }
    }], [tree])
  ]);
  const positions = new Map([
    ['cp_pg_postfit', { x: 100, y: 100 }],
    ['dp_pg_primary', { x: 40, y: 220 }],
    ['d_pg_primary', { x: 40, y: 340 }],
    ['dp_pg_secondary', { x: 160, y: 220 }],
    ['d_pg_secondary', { x: 160, y: 340 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId, attachment) => {
    const point = positions.get(nodeId);
    if (!point) return null;
    if (attachment === 'parent' && nodeId === 'dp_pg_secondary') return positions.get('cp_pg_postfit');
    return point;
  });
  assert.equal(bound.primitives.filter((primitive) => primitive.type === 'path-node-ring').length, 2);
  assert.equal(
    bound.primitives.find((primitive) => primitive.type === 'trajectory-path')?.fitPolicy,
    'tree-first'
  );
  assert.equal(bound.primitives.filter((primitive) =>
    primitive.type === 'shape-path' && primitive.shapeStyle === 'blocked-edge-slash').length, 2);
  assert.equal(
    boundOverlayBounds({
      ...bound,
      primitives: bound.primitives.filter((primitive) =>
        primitive.type === 'trajectory-path'
        || primitive.type === 'path-node-ring'
        || (primitive.type === 'shape-path' && primitive.shapeStyle === 'blocked-edge-slash'))
    }),
    null,
    'Phillips marks use the real rendered labels and branch after the ordinary tree fit'
  );
});

test('Pair Merge compiles one two-arm native branch overlay without altering the tree fit', () => {
  const tree = node('vp_pair_prod', 'VP', [
    node('advp_pair_prod', 'AdvP', [leaf('adv_pair_prod', 'Adv', 'quietly')]),
    node('v_pair_prod', 'V', [leaf('read_pair_prod', 'V', 'read')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'PairMerge',
      anchors: { pairMember: 'advp_pair_prod', host: 'v_pair_prod' }
    }], [tree])
  ]);
  const item = plan.frames[0].items.find((candidate) => candidate.kind === 'undirected-link');
  assert.equal(item?.linkStyle, 'pair-merge');
  assert.deepEqual(item?.pairs, [{ fromNodeId: 'advp_pair_prod', toNodeId: 'v_pair_prod' }]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => {
    if (nodeId === 'advp_pair_prod') return { x: 140, y: 314 };
    if (nodeId === 'v_pair_prod') return { x: 430, y: 314 };
    return null;
  });
  const branchOverlay = bound.primitives.find((primitive) =>
    primitive.type === 'native-branch-overlay');
  assert.deepEqual(branchOverlay, {
    type: 'native-branch-overlay',
    targetNodeIds: ['advp_pair_prod', 'v_pair_prod'],
    requireSharedParent: true,
    variant: 'pair-merge',
    itemIndex: 0
  });
  assert.equal(boundOverlayBounds(bound), null,
    'the accepted post-fit Pair-Merge fork cannot refit or recenter the tree');
});

test('Blocked Extraction compiles only its adjunct and path claims without manufacturing a verdict', () => {
  const tree = node('cp_blocked_prod', 'CP', [
    node('tp_blocked_prod', 'TP', [
      node('dp_source_blocked_prod', 'DP', [leaf('n_source_blocked_prod', 'N', 'Lee')]),
      node('pp_domain_blocked_prod', 'PP', [
        leaf('p_domain_blocked_prod', 'P', 'after')
      ])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'BlockedExtraction',
      anchors: {
        source: 'dp_source_blocked_prod',
        target: 'cp_blocked_prod',
        adjunctDomain: 'pp_domain_blocked_prod'
      },
      values: { label: '* extraction' }
    }], [tree])
  ]);
  const domain = plan.frames[0].items.find((candidate) => candidate.kind === 'domain-mark');
  const path = plan.frames[0].items.find((candidate) => candidate.kind === 'directed-path');
  assert.equal(domain?.domainStyle, 'adjunct-domain');
  assert.equal(domain?.rootNodeId, 'pp_domain_blocked_prod');
  assert.equal(path?.pathStyle, 'blocked-extraction');
  assert.equal(path?.fromNodeId, 'dp_source_blocked_prod');
  assert.equal(path?.toNodeId, 'cp_blocked_prod');
  assert.equal(path?.label, undefined);
  assert.equal(plan.frames[0].items.some((item) => item.kind === 'analysis-verdict'), false);

  const positions = new Map([
    ['cp_blocked_prod', { x: 120, y: 40 }],
    ['tp_blocked_prod', { x: 220, y: 180 }],
    ['dp_source_blocked_prod', { x: 520, y: 420 }],
    ['n_source_blocked_prod', { x: 520, y: 520 }],
    ['pp_domain_blocked_prod', { x: 660, y: 300 }],
    ['p_domain_blocked_prod', { x: 660, y: 420 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => positions.get(nodeId) || null);
  const diagnostic = bound.primitives.find((primitive) =>
    primitive.type === 'shape-path' && primitive.shapeStyle === 'blocked-extraction');
  const branchOverlay = bound.primitives.find((primitive) =>
    primitive.type === 'native-branch-overlay');
  assert.deepEqual(branchOverlay, {
    type: 'native-branch-overlay',
    targetNodeIds: ['pp_domain_blocked_prod'],
    requireSharedParent: false,
    variant: 'adjunct-domain',
    itemIndex: 0
  });
  assert.equal(diagnostic?.arrowhead, true);
  assert.equal(diagnostic?.arrowheadBoth, true);
  assert.equal(diagnostic?.label, undefined);
  assert.equal(
    boundOverlayBounds(bound),
    null,
    'the accepted dashed adjunct branch and diagnostic are measured after the ordinary tree fit'
  );
});

test('Blocked Extraction annotates an explicit movement chain without drawing a second path', () => {
  const tree = node('cp_blocked_composed', 'CP', [
    node('dp_target_blocked_composed', 'DP', [
      leaf('d_target_blocked_composed', 'D', 'Who')
    ]),
    node('tp_blocked_composed', 'TP', [
      node('pp_domain_blocked_composed', 'PP', [
        node('dp_source_blocked_composed', 'DP', [
          leaf('d_source_blocked_composed', 'D', 't', { silent: true })
        ])
      ])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'AbarMove',
      anchors: {
        lowerCopy: 'dp_source_blocked_composed',
        traceWitness: 'd_source_blocked_composed',
        pronouncedCopy: 'dp_target_blocked_composed'
      }
    }], [tree]),
    stage([{
      relation: 'BlockedExtraction',
      anchors: {
        source: 'dp_source_blocked_composed',
        target: 'dp_target_blocked_composed',
        adjunctDomain: 'pp_domain_blocked_composed'
      },
      values: { label: 'extraction', outcome: 'blocked' }
    }], [tree])
  ]);
  const finalItems = plan.frames[1].items;
  assert.equal(
    finalItems.filter((candidate) => candidate.kind === 'trajectory').length,
    1,
    'the explicit movement relation remains the only trajectory'
  );
  assert.equal(
    finalItems.filter((candidate) =>
      candidate.kind === 'directed-path' && candidate.pathStyle === 'blocked-extraction').length,
    0,
    'the locality judgment must not duplicate that trajectory'
  );
  assert.equal(
    finalItems.some((candidate) => candidate.kind === 'analysis-verdict'),
    false,
    'a bare label inside BlockedExtraction cannot manufacture an analysis verdict'
  );
  assert.equal(
    finalItems.filter((candidate) =>
      candidate.kind === 'domain-mark' && candidate.domainStyle === 'adjunct-domain').length,
    1,
    'the blocked adjunct domain remains visible'
  );
});

test('Idiom chunk cointerpretation compiles terminal underlines plus one post-fit domain bracket', () => {
  const tree = node('tp_idiom_prod', 'TP', [
    node('vp_idiom_prod', 'VP', [
      leaf('v_idiom_prod', 'V', 'cooked'),
      node('dp_idiom_prod', 'DP', [
        leaf('d_idiom_prod', 'D', 'the'),
        leaf('n_idiom_prod', 'N', 'books')
      ])
    ])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'IdiomChunkCointerpretation',
      anchors: {
        chunks: ['v_idiom_prod', 'dp_idiom_prod'],
        interpretationDomain: 'vp_idiom_prod'
      }
    }], [tree])
  ]);
  const domain = plan.frames[0].items.find((candidate) => candidate.kind === 'domain-mark');
  const chunks = plan.frames[0].items.find((candidate) => candidate.kind === 'node-badges');
  assert.equal(domain?.domainStyle, 'idiom');
  assert.equal(domain?.rootNodeId, 'vp_idiom_prod');
  assert.equal(chunks?.badgeStyle, 'idiom-chunk');
  assert.deepEqual(chunks?.badges.map((badge) => badge.nodeId), ['v_idiom_prod', 'dp_idiom_prod']);

  const positions = new Map([
    ['tp_idiom_prod', { x: 300, y: 40 }],
    ['vp_idiom_prod', { x: 300, y: 180 }],
    ['v_idiom_prod', { x: 180, y: 320 }],
    ['dp_idiom_prod', { x: 420, y: 320 }],
    ['d_idiom_prod', { x: 360, y: 460 }],
    ['n_idiom_prod', { x: 480, y: 460 }]
  ]);
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => positions.get(nodeId) || null);
  assert.equal(
    bound.primitives.filter((primitive) =>
      primitive.type === 'shape-path' && primitive.shapeStyle === 'idiom-bracket').length,
    1
  );
  assert.equal(
    bound.primitives.filter((primitive) =>
      primitive.type === 'text-badge' && primitive.badgeStyle === 'idiom-chunk').length,
    2
  );
  assert.equal(
    boundOverlayBounds(bound),
    null,
    'accepted idiom underlines and the side bracket are measured after the ordinary tree fit'
  );
});

/* ------------------------------------------------------------------ *
 * Blocker 3: Replay-step timing through real playback steps.
 * ------------------------------------------------------------------ */

test('a relation appears only at its Replay relation moment, never during earlier structural microsteps', () => {
  const tree = node('tp_time', 'TP', [
    node('dp_time_a', 'DP', [leaf('d_time_a', 'D', 'she')]),
    node('dp_time_b', 'DP', [leaf('d_time_b', 'D', 'her')])
  ]);
  const stages = [
    stage([
      { relation: 'Coreference', anchors: { antecedent: 'dp_time_a', pronoun: 'dp_time_b' } },
      { relation: 'Coreference', anchors: { first: 'dp_time_b', second: 'dp_time_a' } }
    ], [tree])
  ];
  const plan = compileRelationRenderPlan(stages);
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'coindex').length, 2);

  // Real playback: relation steps arrive after the stage's structural
  // microsteps, and each authored relation gets its own moment.
  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(frames, undefined, replayPlan);
  const relationStepIndices = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.replayKind === 'relation');
  assert.equal(relationStepIndices.length, 2, 'each authored relation gets its own Replay moment');
  const firstRelationStepIndex = relationStepIndices[0].index;
  assert.ok(firstRelationStepIndex > 0, 'structural microsteps precede the first relation moment');

  // Each relation step carries its exact authored identity.
  const playedIdentities = relationStepIndices.map(({ step }) => step.replayRelationIdentity);
  assert.ok(playedIdentities.every((identity) =>
    identity && identity.stageIndex === 0 && Number.isInteger(identity.relationIndex)));

  // Before any relation moment: no same-stage marks.
  assert.equal(visiblePlanFrameItems(plan, 0, new Set()).length, 0);
  // After the first relation moment only its own exact mark shows.
  const afterFirst = visiblePlanFrameItems(plan, 0, new Set([playedIdentities[0].relationIndex]));
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0].relationRef.relationIndex, playedIdentities[0].relationIndex);
  // After both moments, both marks show; the committed view shows everything.
  assert.equal(
    visiblePlanFrameItems(plan, 0, new Set(playedIdentities.map((identity) => identity.relationIndex))).length,
    2
  );
  assert.equal(visiblePlanFrameItems(plan, 0, null).length, 2);
});

test('neutral annotations follow only the current Replay relation while known drawings persist', () => {
  const forest = [node('root', 'XP', [leaf('a', 'N', 'a'), leaf('b', 'N', 'b')])];
  const stages = [stage([
    { relation: 'Coreference', anchors: { antecedent: 'a', pronoun: 'b' } },
    { relation: 'First open claim', anchors: { witness: 'a' } },
    { relation: 'Second open claim', anchors: { witness: 'b' } }
  ], forest), stage([], forest)];
  const originals = structuredClone(stages);
  const plan = compileRelationRenderPlan(stages);
  const reserved = structuredClone(plan);
  const frames = adaptDerivationStagesForReplay(stages);
  const steps = buildPlaybackStepsFromDerivationFrames(frames, 'a b', buildDerivationReplayPlan({ derivationStages: stages }));

  // Forward, backward and direct scrubbing must derive visibility from the
  // current moment, never from the previous mounted frame.
  const indices = [...steps.keys()];
  for (const index of [...indices, ...indices.toReversed(), Math.floor(steps.length / 2)]) {
    const step = steps[index];
    const played = new Set(steps.slice(0, index + 1)
      .filter(prior => prior.replayKind === 'relation' && prior.replayFrameIndex === step.replayFrameIndex)
      .map(prior => prior.replayRelationIdentity.relationIndex));
    const active = step.replayKind === 'relation' ? step.replayRelationIdentity.relationIndex : null;
    const visible = visiblePlanFrameItems(plan, step.replayFrameIndex, played, active);
    assert.deepEqual(visible.filter(item => item.kind === 'fallback').map(item => item.relationRef.relationIndex),
      step.replayFrameIndex === 0 && active > 0 ? [active] : []);
    assert.equal(visible.filter(item => item.kind === 'coindex').length,
      step.replayFrameIndex > 0 || played.has(0) ? 1 : 0);
  }
  assert.equal(visiblePlanFrameItems(plan, 0, null).length, 3, 'non-Replay stage inspection retains all claims');
  assert.deepEqual(plan, reserved, 'visibility must not remove stage layout reservations');
  assert.deepEqual(stages, originals, 'the authored claims stay unchanged');
});

test('a mixed claim hides its neutral remainder after its moment without hiding the known drawing', () => {
  const forest = [node('root', 'XP', [leaf('a', 'N', 'a'), leaf('b', 'N', 'b'), leaf('c', 'N', 'c')])];
  const plan = compileRelationRenderPlan([stage([
    { relation: 'Agree', anchors: { probe: 'a', goal: 'b', context: 'c' }, values: { feature: 'plural' } },
    { relation: 'Other claim', anchors: { witness: 'c' } }
  ], forest)]);
  const current = visiblePlanFrameItems(plan, 0, new Set([0]), 0);
  assert.ok(current.some(item => item.kind === 'fallback'));
  const known = current.filter(item => item.kind !== 'fallback');
  assert.ok(known.length > 0);
  assert.deepEqual(visiblePlanFrameItems(plan, 0, new Set([0, 1])), known,
    'Stage Record keeps the specialized drawing without accumulating neutral annotations');
  assert.deepEqual(visiblePlanFrameItems(plan, 0, new Set([0, 1]), 1).filter(item => item.kind !== 'fallback'), known);
});

/* ------------------------------------------------------------------ *
 * Blocker 5: stable lineage identity for indices.
 * ------------------------------------------------------------------ */

test('a lineage-keyed chain keeps its index as it grows from two to four occurrences', () => {
  const occurrence = (id) => node(id, 'DP', [leaf(`${id}_d`, 'D', 'x', { lineageId: 'stable-lin' })], { lineageId: 'stable-lin' });
  const other = (id) => node(id, 'DP', [leaf(`${id}_d`, 'D', 'y', { lineageId: 'other-lin' })], { lineageId: 'other-lin' });
  const forestA = [node('r1', 'TP', [occurrence('occ_a'), occurrence('occ_b'), other('oth_a'), other('oth_b')])];
  const forestB = [node('r1', 'TP', [
    occurrence('occ_a'), occurrence('occ_b'), occurrence('occ_c'), occurrence('occ_d'),
    other('oth_a'), other('oth_b')
  ])];
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'Identity', anchors: { occurrences: ['occ_a', 'occ_b'] } },
      { relation: 'Identity', anchors: { occurrences: ['oth_a', 'oth_b'] } }
    ], forestA),
    stage([
      { relation: 'Identity', anchors: { occurrences: ['occ_a', 'occ_b', 'occ_c', 'occ_d'] } }
    ], forestB)
  ]);
  const stageZero = plan.frames[0].items.filter((item) => item.kind === 'coindex');
  const grown = plan.frames[1].items.find((item) =>
    item.kind === 'coindex' && item.nodeIds.length === 4);
  const original = stageZero.find((item) => item.nodeIds.includes('occ_a'));
  const independent = stageZero.find((item) => item.nodeIds.includes('oth_a'));
  assert.ok(original && independent && grown);
  assert.equal(grown.index, original.index, 'the grown chain keeps its lineage-stable index');
  assert.notEqual(independent.index, original.index, 'independent chains keep distinct indices');
});

test('Identity binds one occurrence lens and never invents numeric badges or camera bounds', () => {
  const occurrence = (id, silent = false) => node(
    id,
    'DP',
    [leaf(`${id}_d`, 'D', 'book', { silent, lineageId: 'identity-lin' })],
    { silent, lineageId: 'identity-lin' }
  );
  const tree = node('tp_identity_lens', 'TP', [
    occurrence('identity_high'),
    occurrence('identity_low', true)
  ]);
  const plan = compileRelationRenderPlan([
    stage([{ relation: 'Identity', anchors: {
      pronouncedCopy: 'identity_high',
      lowerCopy: 'identity_low'
    } }], [tree])
  ]);
  const bound = bindRelationPlanFrame(plan, 0, gridProvider(new Map([
    ['identity_high', { x: 100, y: 100 }],
    ['identity_low', { x: 300, y: 300 }]
  ])));

  assert.deepEqual(bound.primitives, [{
    type: 'identity-lens',
    nodeIds: ['identity_high', 'identity_low'],
    itemIndex: 0
  }]);
  assert.equal(boundOverlayBounds(bound), null);
});

test('Identity never owns a structural transition that must be authored by movement', () => {
  const lowOvert = node('identity_low_atomic', 'DP', [
    leaf('identity_low_atomic_d', 'D', 'The', { lineageId: 'identity-atomic' }),
    leaf('identity_low_atomic_n', 'N', 'book', { lineageId: 'identity-atomic' })
  ], { lineageId: 'identity-atomic' });
  const baseTree = node('vp_identity_atomic', 'VP', [
    leaf('v_identity_atomic', 'V', 'read'),
    lowOvert
  ]);
  const finalTree = node('tp_identity_atomic', 'TP', [
    node('identity_high_atomic', 'DP', [
      leaf('identity_high_atomic_d', 'D', 'The', { lineageId: 'identity-atomic' }),
      leaf('identity_high_atomic_n', 'N', 'book', { lineageId: 'identity-atomic' })
    ], { lineageId: 'identity-atomic' }),
    node('vp_identity_atomic', 'VP', [
      leaf('v_identity_atomic', 'V', 'read'),
      node('identity_low_atomic', 'DP', [
        leaf('identity_low_atomic_d', 'D', 'The', { silent: true, lineageId: 'identity-atomic' }),
        leaf('identity_low_atomic_n', 'N', 'book', { silent: true, lineageId: 'identity-atomic' })
      ], { silent: true, lineageId: 'identity-atomic' })
    ])
  ]);
  const stages = [
    stage([], [baseTree]),
    stage([{ relation: 'Identity', anchors: {
      pronouncedCopy: 'identity_high_atomic',
      lowerCopy: 'identity_low_atomic'
    } }], [finalTree])
  ];
  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const steps = buildPlaybackStepsFromDerivationFrames(frames, undefined, replayPlan);
  const secondMacroIndex = steps.findIndex((step) =>
    step.replayKind === 'macro' && step.replayFrameIndex === 1);
  const identityIndex = steps.findIndex((step) =>
    step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 1);
  const firstMacroIndex = steps.findIndex((step) =>
    step.replayKind === 'macro' && step.replayFrameIndex === 0);

  assert.ok(identityIndex > firstMacroIndex + 1,
    'ordinary structural microsteps build the new occurrence before Identity is inspected');
  assert.equal(secondMacroIndex, identityIndex + 1,
    'the completed macro frame follows the non-structural Identity inspection');
  assert.equal(
    steps.slice(firstMacroIndex + 1, identityIndex).some((step) => step.replayKind === 'micro'),
    true,
    'Identity no longer suppresses the structural microsteps that create its occurrences'
  );
  assert.equal(steps[identityIndex].replayKind, 'relation');
});

/* ------------------------------------------------------------------ *
 * Blocker 4: extra open roles never veto the specialized core.
 * ------------------------------------------------------------------ */

test('a known relation missing its goal stays one Tier-3 claim despite extra context', () => {
  const tree = node('tp_extra', 'TP', [
    node('a_ex', 'AP', [leaf('a_ex_l', 'A', 'a')]),
    node('b_ex', 'BP', [leaf('b_ex_l', 'B', 'b')]),
    node('c_ex', 'CPx', [leaf('c_ex_l', 'C', 'c')]),
    node('d_ex', 'DPx', [leaf('d_ex_l', 'D', 'd')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'Agree',
      anchors: {
        probe: 'a_ex',
        mysteryScalar: 'c_ex',
        mysteryArray: ['c_ex', 'd_ex']
      },
      values: { feature: 'φ', value: '3SG' }
    }], [tree])
  ]);
  const plaque = plan.frames[0].items.find((item) =>
    item.kind === 'node-plaque' && item.anchorNodeIds.includes('a_ex'));
  assert.equal(plaque, undefined, 'Tier 2 must not repair a malformed exact Tier-1 claim');
  const fallback = plan.frames[0].items.find((item) => item.kind === 'fallback');
  assert.ok(fallback, 'the complete malformed primary remains inspectable through Tier 3');
  const fallbackWitnesses = fallback.drawing.marks.map((mark) => mark.witness);
  assert.deepEqual(fallbackWitnesses, ['a_ex', 'c_ex', 'c_ex', 'd_ex']);
  assert.ok(plan.diagnostics.some((d) => d.kind === 'signature-incomplete'));
});

test('a known relation missing a required role keeps its witnesses inspectable through neutral presentation', () => {
  const tree = node('tp_missing', 'TP', [
    node('a_ms2', 'AP', [leaf('a_ms2_l', 'A', 'a')]),
    node('b_ms2', 'BP', [leaf('b_ms2_l', 'B', 'b')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'Binding',
      anchors: { binder: 'a_ms2', bound: 'b_ms2' } // required `domain` missing
    }], [tree])
  ]);
  assert.equal(plan.frames[0].items.filter((item) => item.kind === 'binding-domain').length, 0);
  const fallback = plan.frames[0].items.find((item) => item.kind === 'fallback');
  assert.ok(fallback, 'the authored instance does not disappear');
  assert.equal(fallback.drawing.row, 2, 'two resolved scalars keep their neutral undirected link');
});

/* ------------------------------------------------------------------ *
 * Blocker 8: PF composition provenance.
 * ------------------------------------------------------------------ */

test('multiple PF packages in one stage stay separate and collect only their own targeted insertions', () => {
  const tree = node('tp_pf2', 'TP', [
    node('root_a_pf', 'Root', [leaf('root_a_leaf', 'Root', '√A')]),
    node('t_a_pf', 'T', [leaf('t_a_leaf', 'T', '-ed')]),
    node('root_b_pf', 'Root', [leaf('root_b_leaf', 'Root', '√B')]),
    node('n_free_pf', 'n', [leaf('n_free_leaf', 'n', 'n')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([
      { relation: 'PFRealization', anchors: { root: 'root_a_pf', tense: 't_a_pf' } },
      { relation: 'PFRealization', anchors: { root: 'root_b_pf' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'root_a_pf' }, values: { input: '√A', output: 'a' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'root_b_pf' }, values: { input: '√B', output: 'b' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'n_free_pf' }, values: { input: 'n', output: '-er' } },
      { relation: 'VocabularyInsertion', anchors: { terminal: 'missing_target' }, values: { input: 'X', output: 'x' } }
    ], [tree])
  ]);
  const plates = plan.frames[0].items.filter((item) => item.kind === 'node-plaque');
  const plateA = plates.find((plate) => plate.anchorNodeIds.includes('root_a_pf'));
  const plateB = plates.find((plate) => plate.anchorNodeIds.includes('root_b_pf'));
  const plateFree = plates.find((plate) => plate.anchorNodeIds.includes('n_free_pf'));
  assert.ok(plateA && plateB && plateFree);
  assert.deepEqual(plateA.rows, [{ label: '√A', value: 'a' }]);
  assert.deepEqual(plateB.rows, [{ label: '√B', value: 'b' }]);
  assert.deepEqual(plateFree.rows, [{ label: 'n', value: '-er' }],
    'an unmatched insertion keeps its own plate and contaminates no package');
  assert.deepEqual(plateA.rowRefs.map((ref) => ref?.relationIndex ?? null), [2]);
  assert.deepEqual(plateB.rowRefs.map((ref) => ref?.relationIndex ?? null), [3]);
  // The unresolved insertion contributed nowhere and failed closed.
  assert.ok(plates.every((plate) => !plate.rows.some((row) => row.value === 'x')));
  assert.ok(plan.diagnostics.some((d) => d.kind === 'anchor-unresolved' && /missing_target/.test(d.detail)));
});

test('PFRealization can introduce its first authored mapping without an empty plaque frame', () => {
  const tree = node('tp_pf_direct', 'TP', [
    node('root_pf_direct', 'Root', [leaf('root_pf_direct_leaf', 'Root', 'laugh')]),
    node('past_pf_direct', 'T', [leaf('past_pf_direct_leaf', 'T', '-ed')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([
      {
        relation: 'PFRealization',
        anchors: { root: 'root_pf_direct', feature: 'past_pf_direct' },
        values: { input: '√LAUGH', output: 'laugh' }
      },
      {
        relation: 'VocabularyInsertion',
        anchors: { terminal: 'past_pf_direct' },
        values: { input: 'T[past]', output: '-ed' }
      }
    ], [tree])
  ]);
  const plate = plan.frames[0].items.find((item) =>
    item.kind === 'node-plaque' && item.familyId === 'pf.realization');
  assert.ok(plate);
  assert.deepEqual(plate.rows, [
    { label: '√LAUGH', value: 'laugh' },
    { label: 'T[past]', value: '-ed' }
  ]);
  assert.equal(plate.rowRefs[0], null, 'the first row belongs to PFRealization itself');
  assert.equal(plate.rowRefs[1]?.relationIndex, 1, 'the later row retains its own authored relation moment');
});

/* ------------------------------------------------------------------ *
 * Blocker 9: no invented linguistic claims.
 * ------------------------------------------------------------------ */

test('missing or unrecognized authored outcomes yield no judgment mark, never the opposite claim', () => {
  const tree = node('tp_out', 'TP', [
    node('src_out', 'XP', [leaf('w_out', 'X', 't', { silent: true })], { silent: true }),
    node('tgt_out', 'YP', [leaf('t_out', 'Y', 'word')]),
    node('int_out', 'ZP', [leaf('i_out', 'Z', 'closer')]),
    node('dom_out', 'AdjP', [leaf('d_out', 'A', 'inside')])
  ]);
  const missing = compileRelationRenderPlan([
    stage([{
      relation: 'AntiLocality',
      anchors: { source: 'src_out', traceWitness: 'w_out', landing: 'tgt_out' }
    }], [tree])
  ]);
  const path = missing.frames[0].items.find((item) => item.kind === 'directed-path');
  assert.ok(path);
  assert.equal(path.outcome, undefined, 'no authored outcome, no invented judgment');
  assert.equal(
    missing.diagnostics.some((d) => d.kind === 'value-unrecognized'),
    false,
    'a missing optional outcome is not an unrecognized authored value'
  );
  const positions = new Map([
    ['src_out', { x: 100, y: 100 }], ['w_out', { x: 100, y: 200 }],
    ['tgt_out', { x: 400, y: 50 }], ['t_out', { x: 400, y: 150 }]
  ]);
  const bound = bindRelationPlanFrame(missing, 0, (nodeId) => positions.get(nodeId) || null);
  const shape = bound.primitives.find((p) => p.type === 'shape-path' && p.shapeStyle === 'anti-locality');
  assert.ok(shape);
  assert.equal(shape.tip, undefined, 'neither the bar nor the check is invented');

  const garbled = compileRelationRenderPlan([
    stage([{
      relation: 'Binding',
      anchors: { binder: 'src_out', bound: 'tgt_out', domain: 'tp_out' },
      values: { outcome: 'sideways' }
    }], [tree])
  ]);
  const binding = garbled.frames[0].items.find((item) => item.kind === 'binding-domain');
  assert.equal(binding.outcome, undefined);
  assert.ok(garbled.diagnostics.some((d) => d.kind === 'value-unrecognized'));

  const recognizedBoundaryJudgment = compileRelationRenderPlan([
    stage([{
      relation: 'BoundingNodeCrossing',
      anchors: { domain: 'tp_out', boundary: ['dom_out'] },
      values: { outcome: 'blocked' }
    }], [tree])
  ]);
  assert.ok(recognizedBoundaryJudgment.frames[0].items.some((item) => (
    item.kind === 'node-badges' && item.badgeStyle === 'boundary-cut'
  )));
  assert.equal(
    recognizedBoundaryJudgment.diagnostics.some((d) => d.kind === 'value-unrecognized'),
    false,
    'BoundingNodeCrossing recognizes its exact authored blocked judgment'
  );

  const garbledBoundaryJudgment = compileRelationRenderPlan([
    stage([{
      relation: 'BoundingNodeCrossing',
      anchors: { domain: 'tp_out', boundary: ['dom_out'] },
      values: { outcome: 'sideways' }
    }], [tree])
  ]);
  assert.ok(garbledBoundaryJudgment.diagnostics.some((d) => d.kind === 'value-unrecognized'));

  for (const relation of [
    {
      relation: 'Intervention',
      anchors: { landing: 'tgt_out', intervener: 'int_out', target: 'src_out' }
    },
    {
      relation: 'BlockedExtraction',
      anchors: { source: 'src_out', target: 'tgt_out', adjunctDomain: 'dom_out' },
      values: { label: '* extraction' }
    }
  ]) {
    const plan = compileRelationRenderPlan([stage([relation], [tree])]);
    const diagnosticPath = plan.frames[0].items.find((item) => item.kind === 'directed-path');
    if (relation.relation === 'Intervention') {
      // The approved Intervention painter always includes a cross. Its path
      // is not neutral geometry when no blocking claim was authored.
      assert.equal(diagnosticPath, undefined);
      assert(plan.diagnostics.some(d => d.detail.includes('no-authored-negative-outcome-or-blocking-role')));
      continue;
    }
    assert.ok(diagnosticPath, `${relation.relation} still draws its authored neutral geometry`);
    assert.equal(diagnosticPath.outcome, undefined, `${relation.relation} must not invent a blocked judgment`);
    assert.equal(
      plan.diagnostics.some((d) => d.kind === 'value-unrecognized'),
      false,
      `${relation.relation} must not diagnose an outcome the model did not author`
    );
  }

  for (const relation of [
    {
      relation: 'AntiLocality',
      anchors: { source: 'src_out', traceWitness: 'w_out', landing: 'tgt_out' },
      values: { outcome: 'sideways' }
    },
    {
      relation: 'Intervention',
      anchors: { landing: 'tgt_out', intervener: 'int_out', target: 'src_out' },
      values: { outcome: 'sideways' }
    },
    {
      relation: 'BlockedExtraction',
      anchors: { source: 'src_out', target: 'tgt_out', adjunctDomain: 'dom_out' },
      values: { label: 'extraction', outcome: 'sideways' }
    }
  ]) {
    const plan = compileRelationRenderPlan([stage([relation], [tree])]);
    assert.ok(
      plan.diagnostics.some((diagnostic) => diagnostic.kind === 'value-unrecognized'
        || (relation.relation === 'Intervention' && diagnostic.detail.includes('outcome-does-not-establish-blocking'))),
      `${relation.relation} must diagnose an authored unknown outcome`
    );
  }
});

/* ------------------------------------------------------------------ *
 * Blocker 7: complete accepted family drawings.
 * ------------------------------------------------------------------ */

test('Improper Movement draws every authored candidate with its own outcome, the region, and the host marks', () => {
  const tree = node('tp_im2', 'TP', [
    node('src_im2', 'XP', [leaf('w_im2', 'X', 't', { silent: true })], { silent: true }),
    node('land_im2', 'YP', [leaf('l_im2', 'Y', 'landed')]),
    node('rej_a_im2', 'ZP', [leaf('ra_im2', 'Z', 'za')]),
    node('rej_b_im2', 'ZP', [leaf('rb_im2', 'Z', 'zb')]),
    node('lic_im2', 'WP', [leaf('li_im2', 'W', 'w')])
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'ImproperMovement',
      anchors: {
        source: 'src_im2', traceWitness: 'w_im2', licensedLanding: 'land_im2',
        licensedLandingHosts: ['lic_im2'],
        rejectedLandingHosts: ['rej_a_im2', 'rej_b_im2'],
        forbiddenRegion: ['rej_a_im2', 'rej_b_im2']
      }
    }], [tree])
  ]);
  const candidatePaths = plan.frames[0].items.filter((item) =>
    item.kind === 'directed-path' && item.pathStyle === 'improper-candidate');
  assert.deepEqual(candidatePaths.map((item) => [item.toNodeId, item.outcome]), [
    ['lic_im2', 'licensed'], ['rej_a_im2', 'blocked'], ['rej_b_im2', 'blocked']
  ]);
  assert.ok(plan.frames[0].items.some((item) =>
    item.kind === 'domain-mark' && item.domainStyle === 'forbidden-region'));
  assert.ok(plan.frames[0].items.some((item) => item.kind === 'node-badges'));
});

/* ------------------------------------------------------------------ *
 * Blocker 10: large arrays without false ownership.
 * ------------------------------------------------------------------ */

test('large Cooper storage arrays receive the organizational policy — the plaque does not own them', () => {
  const members = ['cs_q1', 'cs_q2', 'cs_q3', 'cs_q4', 'cs_q5', 'cs_q6'];
  const tree = node('s_cs2', 'S', [
    node('scope_cs2', 'VPx', [leaf('v_cs2', 'V', 'v')]),
    ...members.map((id) => node(id, 'QPx', [leaf(`${id}_l`, 'Q', 'q')]))
  ]);
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'CooperStorage',
      anchors: { scope: 'scope_cs2', quantifiers: members },
      values: { category: 'S' }
    }], [tree])
  ]);
  assert.ok(plan.frames[0].items.some((item) => item.kind === 'node-plaque'));
  const anchorSet = plan.frames[0].items.find((item) => item.kind === 'anchor-set');
  assert.ok(anchorSet, 'the accepted organizational policy applies to the large array');
  assert.deepEqual(
    anchorSet.set.roles.find((role) => role.role === 'quantifiers').anchors.map((anchor) => anchor.nodeId),
    members
  );
});

test('three unknown array groups keep every participant and separate organizational rails', () => {
  const groupA = ['ga_1', 'ga_2', 'ga_3', 'ga_4', 'ga_5'];
  const groupB = ['gb_1', 'gb_2', 'gb_3', 'gb_4', 'gb_5'];
  const groupC = ['gc_1', 'gc_2', 'gc_3', 'gc_4', 'gc_5'];
  const all = [...groupA, ...groupB, ...groupC];
  const tree = node('root_3g', 'TP', all.map((id) => node(id, 'XP', [leaf(`${id}_l`, 'X', 'x')])));
  const plan = compileRelationRenderPlan([
    stage([{
      relation: 'TripleOpenGrouping',
      anchors: { alpha: groupA, beta: groupB, gamma: groupC }
    }], [tree])
  ]);
  const fallback = plan.frames[0].items.find((item) => item.kind === 'fallback');
  assert.ok(fallback);
  assert.equal(fallback.drawing.marks.length, 15, 'every participant keeps a mark');
  const anchorSet = plan.frames[0].items.find((item) => item.kind === 'anchor-set');
  assert.ok(anchorSet);
  assert.equal(anchorSet.set.roles.filter((role) => role.large).length, 3);
  const positions = new Map(all.map((id, index) => [id, { x: (index % 5) * 150 + Math.floor(index / 5) * 20, y: 100 + Math.floor(index / 5) * 40 }]));
  positions.set('root_3g', { x: 400, y: 0 });
  const bound = bindRelationPlanFrame(plan, 0, (nodeId) => positions.get(nodeId) || null);
  const rails = bound.primitives.filter((p) => p.type === 'anchor-set-rail');
  assert.equal(rails.length, 3, 'each role group keeps its own rail');
  assert.equal(new Set(rails.map((rail) => rail.lane)).size, rails.length,
    'overlapping rails take distinct lanes — no frame or numeral collisions');
});
