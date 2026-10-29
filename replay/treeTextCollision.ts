import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import { getNodeId } from './displayIdentity.ts';
import type { TreeLabelMeasure, TreeLabelRuns } from './treeLabelRuns.ts';
import { paintedTreeText, TREE_TEXT_DEPTH } from './treeTextClearance.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;

/** The pairs of painted nodes whose labels or words overlap in one laid-out
 * frame, as `"a b"` with the two IDs sorted. Text is measured as it is painted,
 * index and theta runs included (paintedTreeText), and one box is grown by the
 * larger of the two dark outlines, so an outline over another node's glyphs
 * counts and two outlines that merely touch do not. As in clearTreeText, boxes
 * of adjacent rows that graze by less than an outline's width do not overlap. */
export function paintedTextCollisions(nodes: Iterable<Node>, labels: ReadonlyMap<string, readonly TreeLabelRuns[]>,
  measureTreeLabel: TreeLabelMeasure, measureCategoryText?: CategoryTextMeasure): Set<string> {
  const boxes = [...nodes].flatMap(node => {
    const measured = new Set(measureCategoryText ? categoryTextLayout(node.data.label || '', measureCategoryText).lines : []);
    return paintedTreeText(labels.get(getNodeId(node)), measureTreeLabel,
      line => measured.has(line) ? measureCategoryText!(line) : undefined)
      .map(box => ({ ...box, id: getNodeId(node), x: node.x + box.x, y: node.y + box.y }));
  }).sort((a, b) => a.x - b.x);
  const widest = Math.max(0, ...boxes.map(box => box.halo)), result = new Set<string>();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (b.x - widest >= a.x + a.width) break;
    if (a.id === b.id) continue;
    const pad = Math.max(a.halo, b.halo);
    const across = Math.min(a.x + a.width + pad, b.x + b.width) - Math.max(a.x - pad, b.x);
    const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (across > 1e-6 && down > TREE_TEXT_DEPTH) result.add([a.id, b.id].sort().join(' '));
  }
  return result;
}
