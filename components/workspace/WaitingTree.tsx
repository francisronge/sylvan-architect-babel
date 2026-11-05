import React, { useEffect, useState } from 'react';
import {
  BARK, MINT, TREE_BRANCHES, TREE_HEIGHT, TREE_LEAVES, TREE_MOTHERS, TREE_WIDTH, treeNodePosition
} from './syntaxTreeArt';

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

/** Each branch runs from a daughter up to her mother, so it grows upward as Merge builds. */
export const WAITING_TREE_BRANCHES = TREE_BRANCHES;

/** How much of branch `index` is drawn at `progress`: the branches take equal turns. */
export const branchDrawn = (progress: number, index: number): number => {
  const share = MOST_GROWTH / WAITING_TREE_BRANCHES.length;
  return Math.min(1, Math.max(0, (progress - index * share) / share));
};

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
  const nodeShown = (node: string) => TREE_LEAVES.includes(node)
    ? WAITING_TREE_BRANCHES.some((branch, index) => branch.daughter === node && drawn[index] > 0)
    : WAITING_TREE_BRANCHES.every((branch, index) => branch.mother !== node || drawn[index] === 1);

  return (
    <div data-babel-waiting-tree="true" className="loading-overlay absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-xl flex flex-col items-center justify-center px-6">
      <p className="serif italic text-[20px] md:text-[22px] leading-snug text-emerald-50 text-center max-w-xl mb-8 md:mb-10 break-words">
        “{sentence}”
      </p>
      <svg viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`} className="w-[min(300px,78vw)] h-auto overflow-visible" aria-hidden="true">
        {WAITING_TREE_BRANCHES.map((branch, index) => (
          <path key={`${branch.mother}-${branch.daughter}`} d={branch.d} pathLength={1} fill="none" strokeLinecap="round" strokeWidth={2.2}
            stroke={index === growing ? MINT : BARK} strokeDasharray={1} strokeDashoffset={1 - drawn[index]}
            // A round cap paints a dot even with nothing drawn, so a branch not yet begun is hidden.
            visibility={drawn[index] > 0 ? undefined : 'hidden'}
            className={index === growing ? 'waiting-tree-growing' : undefined} />
        ))}
        {[...Object.keys(TREE_MOTHERS), ...TREE_LEAVES].map(node => {
          const [x, y] = treeNodePosition(node);
          return <circle key={node} cx={x} cy={y} r={TREE_LEAVES.includes(node) ? 3.6 : 2.8} fill="#ecfdf5" opacity={nodeShown(node) ? 1 : 0} />;
        })}
      </svg>
      <p role="status" className="serif italic text-[16px] md:text-[17px] leading-relaxed text-emerald-300/90 text-center max-w-[22rem] mt-8 md:mt-10">
        Usually about two minutes. Switch tabs or get a coffee; your tree will be in your Tree Bank.
      </p>
    </div>
  );
};

export default WaitingTree;
