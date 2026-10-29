import type * as d3 from 'd3';
import type { SyntaxNode } from '../../types.ts';
import { isDisplayTerminalNode, isNotationSurface, isWordlessCategoryLeaf, resolveLeafSurface, shouldExpandPreterminalLeaf } from '../replaySurfaceNotation.ts';
import type { Rect } from './overlayGeometry.ts';

type Node = d3.HierarchyNode<SyntaxNode> & { x?: number; y?: number };

/**
 * The words a neutral connector anchor stands for: the painted words it
 * dominates in the current frame, as maximal runs of the frame's painted words
 * in left-to-right order, each run spanning its words' painted extents. A run
 * breaks where a word the anchor does not dominate lies between. An anchor
 * dominating no painted word (a silent head, a trace) has no runs and a
 * `tick`: its place in word order, the anchor's own x kept between the
 * painted words before and after it in tree order, which `direction` puts
 * on its left and right.
 *
 * `category` is the anchor's painted category label without the features the
 * tree label already shows (`T[past]` is `T`) but with its chain index
 * (`CP₁`, `T[past]₁` is `T₁`), or null for a bare word.
 */
export type FallbackWordSpan = {
  category: string | null;
  runs: Array<{ x1: number; x2: number }>;
  tick: number | null;
  /** The anchor's first and last leaf in tree order; one anchor dominates
   * another exactly when its range contains the other's. */
  leaves: [number, number];
};

/** Space a tick keeps from its neighbouring words, in tree units: one word-font size. */
const TICK_GAP = 56;

const isWord = (node: Node): boolean => !node.children?.length && isDisplayTerminalNode(node.data)
  && !isNotationSurface(resolveLeafSurface(node));

/** `wordRect` returns a word's painted text box, or null when the word is not painted in this frame. */
export function coveredWordSpan(anchor: Node, wordRect: (node: Node) => Rect | null, direction: 'ltr' | 'rtl' = 'ltr',
  paintedLabel = String(anchor.data.label || '')): FallbackWordSpan {
  const root = anchor.ancestors().at(-1)!;
  const leaves = root.leaves() as Node[];
  const words = leaves.flatMap(leaf => {
    const rect = isWord(leaf) ? wordRect(leaf) : null;
    return rect ? [{ leaf, rect }] : [];
  });
  const own = new Set(anchor.leaves());
  const first = leaves.findIndex(leaf => own.has(leaf));
  const range: [number, number] = [first, first + own.size - 1];
  // The painted label may end in the phrase's chain index (CP₁); the bracket keeps it.
  const label = paintedLabel.trim(), index = /[₀-₉]+$/.exec(label)?.[0] ?? '';
  const head = label.split(/\s*[[(]/)[0].trim();
  const category = anchor.children?.length || shouldExpandPreterminalLeaf(anchor.data) || isWordlessCategoryLeaf(anchor.data)
    ? (head ? head.endsWith(index) ? head : head + index : label) || null : null;
  const ordered = [...words].sort((a, b) => (a.rect.x + a.rect.width / 2) - (b.rect.x + b.rect.width / 2));
  const runs: FallbackWordSpan['runs'] = [];
  let open = false;
  for (const { leaf, rect } of ordered) {
    if (!own.has(leaf)) { open = false; continue; }
    if (open) {
      const run = runs[runs.length - 1];
      run.x1 = Math.min(run.x1, rect.x);
      run.x2 = Math.max(run.x2, rect.x + rect.width);
    } else runs.push({ x1: rect.x, x2: rect.x + rect.width });
    open = true;
  }
  if (runs.length) return { category, runs, tick: null, leaves: range };
  // The neighbours in tree order, on the sides the writing direction puts them.
  const x = anchor.x ?? 0;
  const before = words.filter(word => leaves.indexOf(word.leaf) < first).at(-1)?.rect;
  const after = words.find(word => leaves.indexOf(word.leaf) > range[1])?.rect;
  const [left, right] = direction === 'rtl' ? [after, before] : [before, after];
  const low = left ? left.x + left.width + TICK_GAP : -Infinity;
  const high = right ? right.x - TICK_GAP : Infinity;
  const tick = low <= high ? Math.min(Math.max(x, low), high) : (left!.x + left!.width + right!.x) / 2;
  return { category, runs: [], tick, leaves: range };
}

/** The box a painted parent→child branch spans, between the two node points. */
export const fallbackBranchBox = (parent: { x: number; y: number }, child: { x: number; y: number }): Rect => ({
  x: Math.min(parent.x, child.x), y: parent.y, width: Math.abs(child.x - parent.x), height: child.y - parent.y
});
