import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { CATEGORY_LABEL, categoryLineBaselineY, TERMINAL_LABEL } from './rendererMetrics.ts';
import type { TreeLabelMeasure, TreeLabelRuns } from './treeLabelRuns.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
/** Painted text relative to its node's layout point, without its dark outline
 * of half-width `halo`. */
export type TreeTextBox = { x: number; y: number; width: number; height: number; halo: number };

/** Room kept between the outlines of two nodes' text. */
export const TREE_TEXT_GAP = 8;
/** Text boxes of adjacent rows graze: a word's box, a font cell where indices
 * are styled, reaches a few units into a two-line label below it. Text that runs
 * into text overlaps it vertically by more than an outline's width. */
export const TREE_TEXT_DEPTH = CATEGORY_LABEL.strokeWidth;

const finite = (box: Omit<TreeTextBox, 'halo'>) => [box.x, box.y, box.width, box.height].every(Number.isFinite)
  && box.width > 0 && box.height > 0;

/** The text a node paints: one box per line of a wrapped category label, and
 * one for a word, from every styled variant of the node's label on a canvas.
 * A styled measurement's `cell` is the native text box, and its envelope adds a
 * stroke allowance on every side. A box keeps the cell's advance width and the
 * envelope's glyph extent, or the cell's font extent when indices are styled.
 * `lineWidth` gives a wrapped line's advance where one is measured; a line
 * without one keeps the cell's width. A label without a measurement
 * contributes nothing. */
export function paintedTreeText(runs: readonly TreeLabelRuns[] | undefined, measureTreeLabel: TreeLabelMeasure,
  lineWidth?: (line: string) => number | undefined): TreeTextBox[] {
  const boxes: TreeTextBox[] = [];
  for (const run of runs ?? []) {
    const bounds = measureTreeLabel(run), cell = bounds?.cell;
    if (!bounds || !cell || !finite(bounds) || !finite(cell)) continue;
    const reach = cell.x - bounds.x, halo = (run.kind === 'terminal' ? TERMINAL_LABEL : CATEGORY_LABEL).strokeWidth / 2;
    const top = bounds.y + reach, bottom = bounds.y + bounds.height - reach;
    const lines = run.kind === 'category' && !run.indices.length && run.lines && run.lines.length > 1 ? run.lines : undefined;
    if (!lines) { boxes.push({ x: cell.x, y: top, width: cell.width, height: bottom - top, halo }); continue; }
    // Wrapped lines are centred on the node, one line height apart, so a short
    // line leaves the corners beside it empty.
    const ascent = categoryLineBaselineY(0, lines.length) - top, descent = bottom - categoryLineBaselineY(lines.length - 1, lines.length);
    lines.forEach((line, index) => {
      const advance = lineWidth?.(line);
      const width = advance !== undefined && Number.isFinite(advance) && advance > 0 ? Math.min(advance, cell.width) : cell.width;
      boxes.push({ x: -width / 2, y: categoryLineBaselineY(index, lines.length) - ascent, width, height: ascent + descent, halo });
    });
  }
  return boxes.filter(finite);
}

/** D3's tidy tree separates only nodes of one depth, and a row's spacing is its
 * own. Tree text also spans rows: a word hangs below its leaf, and a wrapped
 * category label grows up toward the row above. Where one painted node's text
 * runs into the text of a node on another row, widen the fork where their paths
 * divide: every node after that split moves right by the missing room, and the
 * fork and its ancestors re-centre on their first and last children, as D3
 * centres them. No gap between two nodes of one row shrinks, so rows, sister
 * order and centring are kept, and text that was clear stays clear.
 *
 * `text(node)` gives the node's own text boxes; only `painted` nodes take part.
 * A node's text and its own descendants' text have no split between them and
 * are not separated. Mutates x in place and returns the number of widenings. */
export function clearTreeText(root: Node, painted: (node: Node) => boolean,
  text: (node: Node) => readonly TreeTextBox[], gap = TREE_TEXT_GAP, depth = TREE_TEXT_DEPTH) {
  const nodes: Node[] = [];
  root.eachBefore(node => { nodes.push(node); });
  const order = new Map(nodes.map((node, index) => [node, index]));
  // Text moves rigidly with its node, so each node is measured once.
  const relative = nodes.filter(painted).flatMap(node => text(node).filter(finite).map(box => ({ node, box })));
  if (relative.length < 2) return 0;
  const reach = gap + 2 * Math.max(...relative.map(({ box }) => box.halo));
  // Pre-order index and subtree end make containment a constant-time test.
  const end = new Map<Node, number>();
  for (const node of [...nodes].reverse()) end.set(node, Math.max(order.get(node)!,
    ...(node.children ?? []).map(child => end.get(child as Node)!)));
  const contains = (a: Node, b: Node) => order.get(a)! <= order.get(b)! && order.get(b)! <= end.get(a)!;
  let widened = 0;
  // Each widening only grows gaps, so a bound of two per node covers every tree.
  for (let attempt = 0; attempt < nodes.length * 2; attempt++) {
    const boxes = relative.map(({ node, box }) => ({ ...box, node, x: node.x + box.x, y: node.y + box.y }))
      .sort((a, b) => a.x - b.x);
    let best: { fork: Node; split: number; missing: number } | undefined;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (b.x >= a.x + a.width + reach) break;
      if (a.node.y === b.node.y || contains(a.node, b.node) || contains(b.node, a.node)) continue;
      if (Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <= depth) continue;
      const [left, right] = order.get(a.node)! < order.get(b.node)! ? [a, b] : [b, a];
      const missing = left.x + left.width + left.halo + gap + right.halo - right.x;
      if (missing <= 1e-6) continue;
      let fork = left.node.parent!;
      while (!contains(fork, right.node)) fork = fork.parent!;
      // Repair the deepest fork first; an outer fork then sees its final daughters.
      if (!best || fork.depth > best.fork.depth || (fork === best.fork && missing > best.missing))
        best = { fork, split: fork.children!.findIndex(child => contains(child as Node, right.node)), missing };
    }
    if (!best) break;
    const { fork, split, missing } = best;
    // Everything after the split in pre-order moves: the daughters from the
    // split on, and every later subtree. The fork's ancestors precede it.
    const first = order.get(fork.children![split] as Node)!;
    for (const node of nodes) if (order.get(node)! >= first) node.x += missing;
    for (let node: Node | null = fork; node; node = node.parent) {
      const children = node.children as Node[];
      node.x = (children[0].x + children[children.length - 1].x) / 2;
    }
    widened++;
  }
  return widened;
}
