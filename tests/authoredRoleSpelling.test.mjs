import assert from 'node:assert/strict';
import test from 'node:test';

import { authoredRoleMatcher, findResolvedReplayAnchorsByRoles } from '../replay/relationAnchors.ts';
import { registeredTrajectoryDisplayKind } from '../replay/relations/movementIdentities.ts';
import { TRAJECTORY_SOURCE_ROLES, TRAJECTORY_TARGET_ROLES } from '../replay/relations/renderFamilies.ts';

const spellings = (words) => [words.join(' '), words.join('-'), words.join('_'),
  words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1) : word).join(''),
  words.map(word => word[0].toUpperCase() + word.slice(1)).join(' ')];

test('renderer role lists match an authored role however its words are cased or separated', () => {
  const source = authoredRoleMatcher(TRAJECTORY_SOURCE_ROLES), target = authoredRoleMatcher(TRAJECTORY_TARGET_ROLES);
  for (const role of spellings(['lower', 'copy'])) assert.ok(source(role), role);
  for (const role of spellings(['lower', 'occurrence'])) assert.ok(source(role), role);
  for (const role of spellings(['landing', 'site'])) assert.ok(target(role), role);
  for (const role of ['lowercopy', 'copy lower', 'lower copy site', '']) assert.equal(source(role), false, role);
  const anchors = [{ role: 'Lower Copy', nodeId: 'low' }, { role: 'higher-copy', nodeId: 'high' }, { role: 'host', nodeId: 'h' }];
  assert.deepEqual(findResolvedReplayAnchorsByRoles(anchors, TRAJECTORY_SOURCE_ROLES).map(anchor => anchor.nodeId), ['low']);
  assert.deepEqual(findResolvedReplayAnchorsByRoles(anchors, TRAJECTORY_TARGET_ROLES).map(anchor => anchor.nodeId), ['high']);
});

test('a registered trajectory recognizes its endpoint roles in any of their spellings', () => {
  for (const [lower, higher] of [['lowerCopy', 'higherCopy'], ['lower copy', 'higher copy'], ['Lower-Copy', 'Higher_Copy']])
    assert.equal(registeredTrajectoryDisplayKind('HeadMove', { [lower]: 'low', [higher]: 'high' }), 'head', `${lower} / ${higher}`);
  assert.equal(registeredTrajectoryDisplayKind('HeadMove', { lowerOccurrence: 'low', higherCopy: 'high' }), 'head');
  assert.equal(registeredTrajectoryDisplayKind('HeadMove', { lower: 'low', higher: 'high' }), '', 'other words are not endpoint roles');
});
