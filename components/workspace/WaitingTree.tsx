import React, { useEffect, useState } from 'react';

/**
 * Public Babel's waiting screen: the sentence, a syntax tree that draws itself
 * while the analysis is written, and one line about the wait (Francis, 4 Nov
 * 2026, choosing option A: "I love how simple it is").
 *
 * The server reports no progress, so the tree grows on the measured wait: a
 * parse took 2.4 min at the median and 3.5 min at the 90th percentile (GPT-6.1
 * Sol at high effort, 29 Oct 2026 held-out batch). Growth is quick at first and
 * slows, and the last branch never closes before the analysis arrives; the
 * tree view then replaces this screen. It never loops, since starting over
 * would read as lost progress.
 */

// progress = 1 - e^(-t/τ): 87% at the median wait, 95% at the 90th percentile.
const GROWTH_TIME_CONSTANT_MS = 70_000;
// The tree stops short of complete; only the analysis completes it.
const MOST_GROWTH = 0.97;
const TICK_MS = 200;

/** How grown the tree is after waiting `elapsedMs`, from 0 to just under 1. */
export const waitingTreeProgress = (elapsedMs: number): number =>
  MOST_GROWTH * (1 - Math.exp(-Math.max(0, elapsedMs) / GROWTH_TIME_CONSTANT_MS));

type Point = readonly [number, number];

// One analysis-shaped tree: a specifier on the left and a right-branching
// spine, as a clause is usually drawn. Leaves sit evenly in sentence order and
// each mother stands centred over her daughters, as in Babel's trees.
const MOTHERS: Record<string, readonly [string, string]> = {
  r: ['a', 'b'], a: ['a1', 'a2'], b: ['b1', 'c'], c: ['d', 'e'], d: ['d1', 'd2'], e: ['e1', 'f'], f: ['f1', 'f2']
};
const LEAVES = ['a1', 'a2', 'b1', 'd1', 'd2', 'e1', 'f1', 'f2'];
// Merge builds bottom-up, the deepest phrase first.
const MERGE_ORDER = ['f', 'e', 'd', 'c', 'b', 'a', 'r'];
const LEVEL = 40;
const LEAF_GAP = 38;

const depth = (node: string): number => {
  const mother = Object.keys(MOTHERS).find(key => MOTHERS[key].includes(node));
  return mother ? depth(mother) + 1 : 0;
};
const position = (node: string): Point => {
  const y = 10 + depth(node) * LEVEL;
  if (LEAVES.includes(node)) return [10 + LEAVES.indexOf(node) * LEAF_GAP, y];
  const [left, right] = MOTHERS[node].map(position);
  return [(left[0] + right[0]) / 2, y];
};
const WIDTH = 20 + (LEAVES.length - 1) * LEAF_GAP;
const HEIGHT = 20 + Math.max(...LEAVES.map(depth)) * LEVEL;

/** Each branch runs from a daughter up to her mother, so it grows upward as Merge builds. */
export const WAITING_TREE_BRANCHES = MERGE_ORDER.flatMap(mother => MOTHERS[mother].map(daughter => {
  const [x1, y1] = position(daughter);
  const [x2, y2] = position(mother);
  const middle = (y1 + y2) / 2;
  return { mother, daughter, d: `M${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}` };
}));

/** How much of branch `index` is drawn at `progress`: the branches take equal turns. */
export const branchDrawn = (progress: number, index: number): number => {
  const share = MOST_GROWTH / WAITING_TREE_BRANCHES.length;
  return Math.min(1, Math.max(0, (progress - index * share) / share));
};

const BARK = '#c9a46a';
const MINT = '#a7f3d0';

const WaitingTree: React.FC<{ sentence: string; startedAt: number }> = ({ sentence, startedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const progress = waitingTreeProgress(now - startedAt);
  const drawn = WAITING_TREE_BRANCHES.map((_, index) => branchDrawn(progress, index));
  // The growing branch is mint and breathes, so the slow last branches still read as growing.
  const growing = drawn.findIndex(amount => amount < 1);
  // A word shows when its branch starts; a mother when both her branches reach her.
  const nodeShown = (node: string) => LEAVES.includes(node)
    ? WAITING_TREE_BRANCHES.some((branch, index) => branch.daughter === node && drawn[index] > 0)
    : WAITING_TREE_BRANCHES.every((branch, index) => branch.mother !== node || drawn[index] === 1);

  return (
    <div data-babel-waiting-tree="true" className="loading-overlay absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-xl flex flex-col items-center justify-center px-6">
      <p className="serif italic text-[20px] md:text-[22px] leading-snug text-emerald-50 text-center max-w-xl mb-8 md:mb-10 break-words">
        “{sentence}”
      </p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-[min(300px,78vw)] h-auto overflow-visible" aria-hidden="true">
        {WAITING_TREE_BRANCHES.map((branch, index) => (
          <path key={`${branch.mother}-${branch.daughter}`} d={branch.d} pathLength={1} fill="none" strokeLinecap="round" strokeWidth={2.2}
            stroke={index === growing ? MINT : BARK} strokeDasharray={1} strokeDashoffset={1 - drawn[index]}
            // A round cap paints a dot even with nothing drawn, so a branch not yet begun is hidden.
            visibility={drawn[index] > 0 ? undefined : 'hidden'}
            className={index === growing ? 'waiting-tree-growing' : undefined} />
        ))}
        {[...Object.keys(MOTHERS), ...LEAVES].map(node => {
          const [x, y] = position(node);
          return <circle key={node} cx={x} cy={y} r={LEAVES.includes(node) ? 3.6 : 2.8} fill="#ecfdf5" opacity={nodeShown(node) ? 1 : 0} />;
        })}
      </svg>
      <p role="status" className="serif italic text-[16px] md:text-[17px] leading-relaxed text-emerald-300/90 text-center max-w-[22rem] mt-8 md:mt-10">
        Usually about two minutes. Switch tabs or get a coffee; your tree will be in your Tree Bank.
      </p>
    </div>
  );
};

export default WaitingTree;
