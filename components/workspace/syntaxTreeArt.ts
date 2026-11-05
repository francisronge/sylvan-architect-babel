/**
 * The small syntax tree public Babel draws while it waits and when a parse
 * fails: a specifier on the left and a right-branching spine, as a clause is
 * usually drawn. Leaves sit evenly in sentence order and each mother stands
 * centred over her daughters, as in Babel's trees.
 */

export type Point = readonly [number, number];

export const TREE_MOTHERS: Record<string, readonly [string, string]> = {
  r: ['a', 'b'], a: ['a1', 'a2'], b: ['b1', 'c'], c: ['d', 'e'], d: ['d1', 'd2'], e: ['e1', 'f'], f: ['f1', 'f2']
};
export const TREE_LEAVES = ['a1', 'a2', 'b1', 'd1', 'd2', 'e1', 'f1', 'f2'];
// Merge builds bottom-up, the deepest phrase first.
const MERGE_ORDER = ['f', 'e', 'd', 'c', 'b', 'a', 'r'];
const LEVEL = 40;
const LEAF_GAP = 38;

const depth = (node: string): number => {
  const mother = Object.keys(TREE_MOTHERS).find(key => TREE_MOTHERS[key].includes(node));
  return mother ? depth(mother) + 1 : 0;
};
export const treeNodePosition = (node: string): Point => {
  const y = 10 + depth(node) * LEVEL;
  if (TREE_LEAVES.includes(node)) return [10 + TREE_LEAVES.indexOf(node) * LEAF_GAP, y];
  const [left, right] = TREE_MOTHERS[node].map(treeNodePosition);
  return [(left[0] + right[0]) / 2, y];
};
export const TREE_WIDTH = 20 + (TREE_LEAVES.length - 1) * LEAF_GAP;
export const TREE_HEIGHT = 20 + Math.max(...TREE_LEAVES.map(depth)) * LEVEL;

export interface TreeBranch { mother: string; daughter: string; d: string }

/** Each branch runs from a daughter up to her mother, in the order Merge builds them. */
export const TREE_BRANCHES: readonly TreeBranch[] = MERGE_ORDER.flatMap(mother => TREE_MOTHERS[mother].map(daughter => {
  const [x1, y1] = treeNodePosition(daughter);
  const [x2, y2] = treeNodePosition(mother);
  const middle = (y1 + y2) / 2;
  return { mother, daughter, d: `M${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}` };
}));

export const TREE_NODES = [...Object.keys(TREE_MOTHERS), ...TREE_LEAVES];
export const isTreeLeaf = (node: string) => TREE_LEAVES.includes(node);

export const BARK = '#c9a46a';
export const MINT = '#a7f3d0';
export const NODE = '#ecfdf5';
