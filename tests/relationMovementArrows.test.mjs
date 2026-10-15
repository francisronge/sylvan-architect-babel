import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptDerivationStagesForReplay } from '../replay/authoredFrames.ts';
import { buildAuthoredRelationLinksForFrames } from '../replay/frameRelations.ts';
import { buildMovementArrowsFromLinks } from '../replay/movementPresentation.ts';
import { getNodeId } from '../replay/displayIdentity.ts';
import {
  MOVEMENT_OPERATION_IDENTITIES,
  isMovementIdentity,
  isRegisteredTrajectoryRelation
} from '../replay/relations/movementIdentities.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';

/*
 * Minimal laid-out node fixtures. buildMovementArrowsFromLinks consumes
 * d3-hierarchy-shaped nodes; the only surface it needs is __vizId, data,
 * children, x/y, and descendants().
 */
const makeLeaf = (id, data = {}) => {
  const node = { __vizId: id, data: { id, ...data }, children: [], x: 0, y: 0 };
  node.descendants = () => [node];
  return node;
};

const makeNode = (id, data, children) => {
  const node = { __vizId: id, data: { id, ...data }, children, x: 0, y: 0 };
  node.descendants = () => [node, ...children.flatMap((child) => child.descendants())];
  return node;
};

const flatten = (nodes) => nodes.flatMap((node) => node.descendants());

const stepIndexFor = (nodes) => new Map(flatten(nodes).map((node) => [getNodeId(node), 0]));

test('head movement renders terminal-to-terminal, never onto a preterminal shell', () => {
  // t_head_trace is the authored trace preterminal whose display leaf carries
  // t₁; c_head_did is the authored landing preterminal whose display leaf
  // carries the pronounced word.
  const traceLeaf = makeLeaf('t_head_trace::__leaf', { label: 't₁', word: 't₁', silent: true });
  const tracePreterminal = makeNode('t_head_trace', { label: 'T' }, [traceLeaf]);
  const didLeaf = makeLeaf('c_head_did::__leaf', { label: 'did', word: 'did' });
  const didPreterminal = makeNode('c_head_did', { label: 'C' }, [didLeaf]);
  const visibleNodes = flatten([tracePreterminal, didPreterminal]);

  const arrows = buildMovementArrowsFromLinks(
    visibleNodes,
    [{
      relation: 'HeadMove',
      sourceNodeId: 't_head_trace',
      targetNodeId: 'c_head_did',
      renderFamily: 'trajectory',
      trajectoryKind: 'head',
      stepIndex: 0
    }],
    stepIndexFor([tracePreterminal, didPreterminal]),
    [{ operation: 'StageRecord' }]
  );

  assert.equal(arrows.length, 1);
  assert.equal(getNodeId(arrows[0].source), 't_head_trace::__leaf');
  assert.equal(getNodeId(arrows[0].target), 'c_head_did::__leaf');
});

test('phrasal movement with a witness departs from the trace terminal and lands on the phrase shell', () => {
  const witnessLeaf = makeLeaf('d_what_low', { label: 'D', word: 't₁', silent: true });
  const lowerCopy = makeNode('dp_what_low', { label: 'DP', silent: true }, [witnessLeaf]);
  const highLeaf = makeLeaf('d_what_high', { label: 'D', word: 'What' });
  const landing = makeNode('dp_what_high', { label: 'DP' }, [highLeaf]);
  const visibleNodes = flatten([lowerCopy, landing]);

  const arrows = buildMovementArrowsFromLinks(
    visibleNodes,
    [{
      relation: 'AbarMove',
      sourceNodeId: 'dp_what_low',
      targetNodeId: 'dp_what_high',
      witnessNodeId: 'd_what_low',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    }],
    stepIndexFor([lowerCopy, landing]),
    [{ operation: 'StageRecord' }]
  );

  assert.equal(arrows.length, 1);
  assert.equal(getNodeId(arrows[0].source), 'd_what_low', 'departure is the authored trace terminal');
  assert.equal(getNodeId(arrows[0].target), 'dp_what_high', 'landing is the authored phrase shell');
});

test('a phrasal link with a missing witness fails closed and substitutes nothing', () => {
  const witnessLeaf = makeLeaf('d_gap_low', { label: 'D', word: 't₁', silent: true });
  const lowerCopy = makeNode('dp_gap_low', { label: 'DP', silent: true }, [witnessLeaf]);
  const highLeaf = makeLeaf('d_gap_high', { label: 'D', word: 'What' });
  const landing = makeNode('dp_gap_high', { label: 'DP' }, [highLeaf]);
  const visibleNodes = flatten([lowerCopy, landing]);
  const steps = [{ operation: 'StageRecord' }];

  // No witness authored at all: the phrasal drawing is refused, not repaired
  // from some other leaf or shell.
  const withoutWitness = buildMovementArrowsFromLinks(
    visibleNodes,
    [{
      relation: 'AbarMove',
      sourceNodeId: 'dp_gap_low',
      targetNodeId: 'dp_gap_high',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    }],
    stepIndexFor([lowerCopy, landing]),
    steps
  );
  assert.deepEqual(withoutWitness, []);

  // A witness authored but unresolvable in the laid-out tree also fails
  // closed rather than being replaced.
  const unresolvableWitness = buildMovementArrowsFromLinks(
    visibleNodes,
    [{
      relation: 'AbarMove',
      sourceNodeId: 'dp_gap_low',
      targetNodeId: 'dp_gap_high',
      witnessNodeId: 'd_witness_that_never_existed',
      renderFamily: 'trajectory',
      trajectoryKind: 'phrasal',
      stepIndex: 0
    }],
    stepIndexFor([lowerCopy, landing]),
    steps
  );
  assert.deepEqual(unresolvableWitness, []);
});

test('movement classification is exact folded identity, never substring matching', () => {
  assert.ok(isMovementIdentity('AbarMove'));
  assert.ok(isMovementIdentity('abar move'));
  assert.ok(isMovementIdentity('wh-movement'));
  assert.ok(isMovementIdentity('RollUpMovement'));
  // Names that only *contain* movement-flavored substrings never classify.
  assert.equal(isMovementIdentity('CliticCluster'), false);
  assert.equal(isMovementIdentity('AffixRealization'), false);
  assert.equal(isMovementIdentity('FocusShift'), false);
  assert.equal(isMovementIdentity('Topicalization'), false);
  assert.equal(isMovementIdentity('RaisedEyebrow'), false);
  // The set itself contains folded keys only.
  MOVEMENT_OPERATION_IDENTITIES.forEach((key) => {
    assert.match(key, /^[a-z]+$/);
  });
});

test('authored relations use exact registry dispatch, not Replay operation names', () => {
  assert.equal(isRegisteredTrajectoryRelation('AbarMove'), true);
  assert.equal(isRegisteredTrajectoryRelation('wh-movement'), true);
  assert.equal(isRegisteredTrajectoryRelation('abar move'), false);
  assert.equal(isRegisteredTrajectoryRelation('Move'), false);
  assert.equal(isRegisteredTrajectoryRelation('made-up-movement'), false);
});

test('Replay relation links share production endpoint roles and keep unknown Move neutral', () => {
  const forest = [{
    id: 'cp_exact',
    label: 'CP',
    children: [
      { id: 'dp_high_exact', label: 'DP', children: [{ id: 'd_high_exact', label: 'D', word: 'what' }] },
      {
        id: 'vp_exact',
        label: 'VP',
        children: [{
          id: 'dp_low_exact',
          label: 'DP',
          silent: true,
          children: [{ id: 'trace_exact', label: 'D', word: 't', silent: true }]
        }]
      }
    ]
  }];
  const stage = {
    statement: 'The relation is represented.',
    stageRecord: 'The current tree contains the exact authored witnesses.',
    relations: [
      {
        relation: 'AbarMove',
        anchors: {
          'landing-site': 'dp_high_exact',
          'lower-occurrence': 'dp_low_exact',
          traceWitness: 'trace_exact'
        }
      },
      {
        relation: 'Move',
        anchors: {
          source: 'dp_low_exact',
          target: 'dp_high_exact',
          traceWitness: 'trace_exact'
        }
      }
    ],
    workspaceForest: forest
  };
  const frames = adaptDerivationStagesForReplay([stage]);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: [stage] });
  const links = buildAuthoredRelationLinksForFrames({
    frames,
    replayPlan,
    activeFrameIndex: 0,
    forest
  }
  );

  assert.equal(links[0].renderFamily, 'trajectory');
  assert.equal(links[0].trajectoryKind, 'phrasal');
  assert.equal(links[0].sourceNodeId, 'dp_low_exact');
  assert.equal(links[0].targetNodeId, 'dp_high_exact');
  assert.equal(links[0].witnessNodeId, 'trace_exact');
  assert.equal(links[1].renderFamily, 'authored-anchor-link');

  const trace = makeLeaf('trace_exact', { label: 't', word: 't', silent: true });
  const low = makeNode('dp_low_exact', { label: 'DP', silent: true }, [trace]);
  const highWord = makeLeaf('d_high_exact', { label: 'D', word: 'what' });
  const high = makeNode('dp_high_exact', { label: 'DP' }, [highWord]);
  const arrows = buildMovementArrowsFromLinks(
    flatten([low, high]),
    [links[1]],
    stepIndexFor([low, high]),
    [{ operation: 'Relation', targetNodeId: '', targetLabel: '', sourceLabels: [] }]
  );
  assert.deepEqual(arrows, [], 'an unregistered authored Move relation must stay neutral');
});
