import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceReferenceRank } from '../replay/workspaceReferenceRank.ts';
import { stageVerticalGeometry } from '../replay/stageVerticalGeometry.ts';
import { prepareWorkspaceLifetimeContours, workspaceContourCandidates } from '../replay/workspaceLifetimeContours.ts';

const choose = (preferred, ranks = [210], latest = ranks.at(-1), complete = true) =>
  workspaceReferenceRank(preferred, new Set(ranks), latest, 220, complete);

for (const preferred of [[420, 210], [210, 420], [420], [420, 420]]) {
  test(`current stage row replaces a reserved descendant gap: ${preferred}`, () => {
    assert.equal(choose(preferred), 210);
  });
}
test('a genuine uniform 420-unit current row is retained', () => {
  assert.equal(choose([420, 420], [420]), 420);
});
test('an unchanged lifetime keeps a valid earlier stage row', () => {
  assert.equal(choose([210, 210], [210, 214], 214), 210);
});
test('heterogeneous references without current stage evidence fail explicitly', () => {
  assert.throws(() => choose([420, 210], [], undefined), /without stage row evidence/);
});
test('unmeasured uniform references retain the existing API behavior', () => {
  assert.equal(choose([300, 300], [], undefined), 300);
  assert.equal(choose([], [], undefined, false), 220);
});
test('nonfinite or negative reference rows use only explicit current evidence', () => {
  assert.equal(choose([NaN, 210]), 210);
  assert.equal(choose([-210, -210]), 210);
  assert.throws(() => choose([NaN, 210], [], undefined), /without stage row evidence/);
});

const atom = id => ({ id, label: 'N' });
const fork = (id, ...children) => ({ id, label: 'P', children });
const ids = node => [node.id, ...(node.children ?? []).flatMap(ids)];
const step = (canvas, extra = {}) => ({ replayCanvasData: canvas, replayVisibleNodeIds: ids(canvas), replayKind: 'micro', replayFrameIndex: 0, ...extra });
const points = entries => new Map(entries.map(([id, x, y]) => [id, { x, y }]));

test('native stage row excludes only the temporary construction workspace', () => {
  const completed = fork('p', fork('compound', atom('a'), atom('b')), fork('right', atom('c')));
  const workspace = { id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' }, children: [completed] };
  const geometry = stageVerticalGeometry([step(workspace), step(completed, { replayKind: 'macro' })], 420);
  assert.equal(geometry.rowHeight, 210);
  assert.equal(geometry.temporaryRootDepth(workspace), 1);
  assert.equal(geometry.temporaryRootDepth(completed), 0);
});
test('an authored completed forest keeps its actual container depth', () => {
  const forest = { id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' }, children: [fork('p', atom('a'))] };
  const geometry = stageVerticalGeometry([step(forest, { replayKind: 'macro' })], 420);
  assert.equal(geometry.rowHeight, 210);
  assert.equal(geometry.temporaryRootDepth(forest), 0);
});
test('head insertion cannot preserve a future nested leaf rank in the current fork', () => {
  const host = atom('host'), source = atom('source');
  const before = fork('p', host, source);
  const after = fork('p', fork('compound', host, atom('landing')), { ...source, label: 'trace' });
  const steps = [step(before), step(after, { replayKind: 'relation', replayRelationIdentity: { stageIndex: 0, relationIndex: 0 },
    replayRelationLinks: [{ authoredRelationKey: '0:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }] })];
  const reference = new Map([
    [before, points([['p', 0, 0], ['host', -1200, 420], ['source', 1200, 210]])],
    [after, points([['p', 0, 0], ['compound', -1200, 210], ['host', -1500, 420], ['landing', -900, 420], ['source', 1200, 210]])]
  ]);
  const input = JSON.stringify(steps), saved = JSON.stringify([...reference].map(([canvas, map]) => [canvas.id, [...map]]));
  const compose = prepareWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, 'ltr', reference, new Map(steps.map(s => [s, 210])));
  const intrinsic = compose(), candidates = workspaceContourCandidates(intrinsic, reference);
  const preferred = new Map([...candidates].map(([id, values]) => [id, values.at(-1).positions]));
  const frames = compose(undefined, { inheritCurrentSlots: true, preferred });
  assert.equal(frames[0].nodes.get('p').members.get('host').y, 210);
  assert.equal(frames[0].nodes.get('p').members.get('source').y, 210);
  assert.equal(frames[1].nodes.get('p').members.get('compound').y, 210);
  assert.equal(frames[1].nodes.get('p').members.get('source').y, 210);
  assert.equal(frames[1].nodes.get('compound').members.get('host').y, 210);
  assert.equal(JSON.stringify(steps), input);
  assert.equal(JSON.stringify([...reference].map(([canvas, map]) => [canvas.id, [...map]])), saved);
});


function carriedRowExample({ changedMaterial = false, hidden = false, foreign = false } = {}) {
  const before = fork('p', atom('source'), atom('right'));
  const currentParent = fork(foreign ? 'other' : 'p', atom('trace'), atom('right'));
  if (changedMaterial) currentParent.label = 'Different';
  if (hidden) currentParent.children[0] = { ...fork('hidden', atom('trace')), replayLayoutOnly: true };
  const after = fork('q', atom('source'), currentParent);
  const steps = [step(before), step(after, { replayFrameIndex: 1, replayKind: 'relation',
    replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
    replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory',
      priorSourceNodeId: 'source', witnessNodeId: 'trace', targetNodeId: 'source' }] })];
  if (hidden) steps[1].replayVisibleNodeIds = steps[1].replayVisibleNodeIds.filter(id => id !== 'hidden');
  const reference = new Map([
    [before, points([['p', 0, 0], ['source', -1000, 214], ['right', 1000, 214]])],
    [after, points([['q', 0, 0], ['source', -2000, 214], [currentParent.id, 2000, 214],
      ['trace', 1000, 428], ['right', 3000, 428], ...(hidden ? [['hidden', 1000, 300]] : [])])]
  ]);
  const compose = prepareWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, 'ltr', reference,
    new Map([[steps[0], 212], [steps[1], 214]]));
  const intrinsic = compose(), candidates = workspaceContourCandidates(intrinsic, reference);
  const preferred = new Map([...candidates].map(([id, values]) => [id, values.at(-1).positions]));
  return compose(undefined, { inheritCurrentSlots: true, preferred });
}
test('source-to-lower substitution preserves a row proved on the same current parent', () => {
  const frames = carriedRowExample();
  assert.equal(frames[0].nodes.get('p').members.get('source').y, 214);
  assert.equal(frames[0].nodes.get('p').members.get('right').y, 214);
  assert.equal(frames[1].nodes.get('p').members.get('trace').y, 214);
  assert.equal(frames[1].nodes.get('p').members.get('right').y, 214);
});
for (const [name, option] of [['changed own material', 'changedMaterial'], ['hidden intermediary', 'hidden'], ['different parent', 'foreign']]) {
  test(`${name} cannot certify another incarnation's current row`, () => {
    const frames = carriedRowExample({ [option]: true });
    assert.equal(frames[0].nodes.get('p').members.get('source').y, 212);
    assert.equal(frames[0].nodes.get('p').members.get('right').y, 212);
  });
}
