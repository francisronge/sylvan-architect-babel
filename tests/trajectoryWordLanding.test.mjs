import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hierarchy } from 'd3';
import { createRelationAnchors } from '../components/renderer/relationAnchors.ts';
import { createTrajectoryDrawing } from '../components/renderer/trajectoryDrawing.ts';
import { createTrajectoryRefinements } from '../components/renderer/trajectoryRefinements.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { resolveDisplayedTrajectoryAttachments } from '../replay/relations/renderPlan.ts';
import { createSvgDom, select } from './helpers/svgDom.mjs';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

/* An arrow ends just below the visible text of its landing. A wordless landing
 * painted only as a word, such as the trace t, used to keep its shell
 * attachment, which has no category label to measure and fell back to the bare
 * node point 53 units above the painted t. Francis, 29 October 2026, on Opus
 * n3-24-qu-evidential step 35 (now step 29): the arrowhead went through the t it points at and
 * ended above it. */

const record = JSON.parse(readFileSync(new URL('./helpers/wordLandingRecord.json', import.meta.url), 'utf8'));

const quadratic = d => {
  const [sx, sy, cx, cy, ex, ey] = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return { start: { x: sx, y: sy }, control: { x: cx, y: cy }, end: { x: ex, y: ey } };
};
const samples = ({ start, control, end }) => Array.from({ length: 129 }, (_, i) => {
  const t = i / 128, a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t;
  return { x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y };
});
const crosses = (d, cell) => samples(quadratic(d)).some(({ x, y }) =>
  x > cell.x && x < cell.x + cell.width && y > cell.y && y < cell.y + cell.height);
const endsBelow = (point, cell) => point.y >= cell.y + cell.height && point.y <= cell.y + cell.height + 12
  && point.x >= cell.x - 12 && point.x <= cell.x + cell.width + 12;

test('Opus n3-24 step 29: the head arrow ends just below the painted t of its retained landing', () => {
  const [frame] = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: [29] });
  const arrow = frame.marks.find(mark => mark.id === 'trajectory-path(3:0)#1');
  assert(arrow, 'the head arrow from tV is shown');
  const landing = frame.texts.find(text => text.id === 'tI:word').cell;
  const departure = frame.texts.find(text => text.id === 'tV:word').cell;
  assert(endsBelow(arrow.end, landing), `the arrow ends just below t: ${JSON.stringify(arrow.end)} under ${JSON.stringify(landing)}`);
  assert(!crosses(arrow.d, landing), `the arrow does not cross the t it points at: ${arrow.d}`);
  assert(endsBelow(arrow.start, departure), 'it still leaves from just below the lower t');
});

// The renderer resolves the same attachment and paints the same endpoint.
function paint(item, forest) {
  const dom = createSvgDom();
  try {
    const tree = hierarchy({ id: 'workspace', children: forest });
    const nodes = tree.descendants();
    nodes.forEach((node, index) => { node.__vizId = node.data.id; node.x = index * 120; node.y = node.depth * 220; });
    const g = select(new dom.Element('g'));
    const anchors = createRelationAnchors({ visibleNodes: nodes, treeData: tree, g });
    // A category label sits on its node point; a word hangs 60 below it.
    const paintsCategory = node => Boolean(node.children?.length) || /^[A-Z]/.test(node.data.label) && !node.data.word;
    const shell = id => { const node = anchors.resolveOverlayAnchor(id);
      return node && paintsCategory(node) ? { x: node.x - 20, y: node.y - 30, width: 40, height: 30 } : null; };
    const word = id => { const node = anchors.resolveMaterializedTerminal(anchors.resolveOverlayAnchor(id), id);
      return node ? { x: node.x - 10, y: node.y + 60, width: 20, height: 30 } : null; };
    const displayed = resolveDisplayedTrajectoryAttachments(item, id => anchors.overlayNodeById.get(id)?.data);
    // relationScene.framePositionFor: a missing category label falls back to the node point.
    const bound = bindRelationPlanFrame({ frames: [{ items: [displayed] }] }, 0, (id, attachment) => {
      if (attachment === 'parent') return null;
      const node = anchors.resolveOverlayAnchor(id), box = attachment === 'terminal' ? word(id) : shell(id);
      return box ? { x: box.x + box.width / 2, y: box.y + box.height + 6 } : node && attachment !== 'terminal' ? { x: node.x, y: node.y + 6 } : null;
    });
    const painter = createTrajectoryDrawing({ ensureTrajectoryRelationLayer: () => g,
      clearMovedCopyClassForAnchors: () => {}, trajectoryMarkerIds: { movement: 'arrow', open: 'open', carrier: 'carrier' } });
    for (const primitive of bound.primitives) painter.drawTrajectoryPath(primitive, displayed, g.append('g'), null);
    const path = g.select('.babel-trajectory-path').node();
    const refinements = createTrajectoryRefinements({ g, measuredTrajectoryShellRect: shell,
      measuredTrajectoryTerminalRect: word, productionTrajectoryPaths: () => [path] });
    (item.trajectoryKind === 'head' ? refinements.refineTerminalTrajectory : refinements.refinePhrasalPath).call(path);
    return { displayed, bound: bound.primitives[0].d, painted: path.getAttribute('d'), word, shell };
  } finally { dom.restore(); }
}

const movement = (kind, targetAttachment = 'shell-bottom') => ({ kind: 'trajectory', trajectoryKind: kind,
  sourceNodeId: 'lower', sourceAttachment: 'terminal', targetNodeId: 'landing', targetAttachment,
  relationRef: { stageIndex: 0, relationIndex: 0, relation: 'Authored movement', anchors: {} } });
const forestWith = landing => [{ id: 'top', label: 'XP', children: [landing,
  { id: 'mid', label: "X'", children: [{ id: 'filler', label: 'Y', word: 'y' }, { id: 'lower', label: 't', silent: true }] }] }];

for (const kind of ['phrasal', 'head']) {
  test(`${kind}: an arrow to a landing painted only as a word ends below that word in the binder and the painter`, () => {
    for (const landing of [{ id: 'landing', label: 't', silent: true }, { id: 'landing', label: 'she', word: 'she' }]) {
      const result = paint(movement(kind), forestWith(landing));
      const cell = result.word('landing');
      for (const [where, d] of [['binder', result.bound], ['painter', result.painted]]) {
        assert(endsBelow(quadratic(d).end, cell), `${where}: ends below ${landing.label}: ${d}`);
        assert(!crosses(d, cell), `${where}: does not cross ${landing.label}: ${d}`);
      }
      assert.equal(result.displayed.targetAttachment, 'terminal', landing.label);
    }
  });
}

test('landings with a category label keep their shell attachment', () => {
  for (const landing of [
    { id: 'landing', label: 'NP', children: [{ id: 'n', label: 'N', word: 'dog' }] },
    { id: 'landing', label: 'C', children: [] },
    { id: 'landing', label: 'V', word: 'chaya' }
  ]) {
    const item = movement('phrasal');
    assert.equal(resolveDisplayedTrajectoryAttachments(item, id => id === 'landing' ? landing : undefined), item, landing.label);
  }
});
