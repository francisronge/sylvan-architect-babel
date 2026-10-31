import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { plaqueConnectorObstacles, plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { TREE_ROW_HEIGHT } from '../replay/treeSpacing.ts';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkLineClearance, checkMarkDistance } from './helpers/visualRules.mjs';

/* A neutral link between two shown participants brackets the words each covers:
 * its brackets hang below all syntax over the link, its lane beneath them and its
 * labels beneath the lane. Plaque allocation reserves a column under each
 * participant only where that drawing can stand: from the participant's lowest
 * label (or, for a participant covering no word, from the row of words where its
 * tick stands) down to one tree row below the syntax over the link. */

const tree = () => d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'CP', children: [
  { id: 'head', label: 'C' },
  { id: 'phrase', label: 'IP', children: [{ id: 'subject', label: 'N', word: 'Mary' }, { id: 'verb', label: 'V', word: 'left' }] }
]}));
const link = endpoints => ({ kind: 'fallback', drawing: { marks: [], link: { endpoints } } });

test('a bracketed link reserves a silent participant only down to one row below the syntax over it', () => {
  const nodes = tree().descendants(), byId = new Map(nodes.map(node => [node.data.id, node]));
  const columns = plaqueConnectorObstacles([link(['head', 'verb'])], nodes);
  assert.equal(columns.length, 2);
  const within = id => column => column.x < byId.get(id).x && column.x + column.width > byId.get(id).x;
  const head = columns.find(within('head')), verb = columns.find(within('verb'));
  // The bracket under "left" stays under it: that column reaches down past every plaque.
  assert.equal(verb.extendsDownward, true);
  assert.equal(verb.y, byId.get('verb').y - 42);
  // C covers no word: its tick stands in the row of words, and nothing is drawn between its label and that row.
  assert(!head.extendsDownward);
  const [x1, x2] = [byId.get('head').x - 42, byId.get('verb').x + 60];
  const floor = Math.max(...plaqueTreeObstacles(nodes).filter(box => box.x < x2 && box.x + box.width > x1).map(box => box.y + box.height));
  assert.equal(head.y, floor - 42);
  assert.equal(head.y + head.height, floor + TREE_ROW_HEIGHT + 42);
  assert(head.y > byId.get('head').y + 100, 'the silent participant reserves nothing beside its own label');
});

test('a link that cannot bracket keeps the straight stem column down past every plaque', () => {
  const nodes = tree().descendants();
  const [column] = plaqueConnectorObstacles([link(['verb', 'absent'])], nodes);
  assert.equal(column.extendsDownward, true);
  assert.deepEqual(plaqueConnectorObstacles([link(['verb', 'absent']), link(['verb', 'absent'])], nodes), [column],
    'one participant reserves one column');
});

/* shared-landing-source: two links appear only at their own moments, `embedded
 * finite-tense licensing` (buy–I) at frame 32 and `head-trace proper government`
 * (did–I) at frame 43. Their old stem columns ran from the participants' labels
 * to the bottom of the tree and took the near pockets of buy's theta grid and
 * tense plaque (beside buy, above the words) and of say's theta grid (below the
 * link's labels) for those plaques' whole lifetimes, so they stood far away:
 * 1.19, 1.22 and 1.77 of their nearby reach. The links draw neither there. */
const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/shared-landing-source.json', import.meta.url), 'utf8'));
const frames = layoutVisualFrames(prepareVisualRecord(fixture), [VIEWPORTS[0]], { steps: Array.from({ length: 21 }, (_, i) => 26 + i) });
const subjects = ['theta Agent/Theme)@buyV', 'tense: past)@buyV', 'theta Agent/propositional Content)@sayV'];

test('plaques stand near their words through the moments of the links beside them', () => {
  for (const frame of frames) {
    const far = checkMarkDistance(frame).filter(finding => finding.subtype === 'plaque' && subjects.some(subject => finding.subject.endsWith(subject)));
    assert.deepEqual(far.map(finding => `${finding.subject} ${finding.measure}`), [], `frame ${frame.frame}`);
  }
});

test('the plaques hold still while their anchors do, and the links clear them', () => {
  for (const subject of subjects) {
    const shown = frames.filter(frame => frame.plaques.some(plaque => plaque.id.endsWith(subject)));
    assert(shown.length >= 15, subject);
    for (const [index, frame] of shown.entries()) {
      const before = shown[index - 1];
      if (!before || before.stage !== frame.stage) continue;
      const a = before.plaques.find(plaque => plaque.id.endsWith(subject)), b = frame.plaques.find(plaque => plaque.id.endsWith(subject));
      if (Math.hypot(b.anchor.x - a.anchor.x, b.anchor.y - a.anchor.y) > 1) continue;
      assert(Math.hypot(b.rect.x - b.anchor.x - a.rect.x + a.anchor.x, b.rect.y - b.anchor.y - a.rect.y + a.anchor.y) <= 1,
        `${subject} keeps its offset ${before.frame}>${frame.frame}`);
    }
  }
  for (const frame of frames.filter(frame => [32, 43].includes(frame.frame))) {
    assert(frame.lines.some(line => line.kind === 'connector'), `frame ${frame.frame} paints its link`);
    assert.deepEqual(checkLineClearance(frame).filter(finding => finding.subject.startsWith('connector')), [], `frame ${frame.frame}`);
  }
});
