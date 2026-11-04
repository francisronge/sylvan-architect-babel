import React from 'react';

interface TreeBankBranchProps {
  open: boolean;
  count: number;
  onToggle: () => void;
}

// Older trees are a lighter bark than the renderer's branches
// (components/renderer/syntaxDrawing.ts); the newest is Babel's green.
const BARK_LIGHT = '#7a5320';
const GREEN = '#34d399';
const EMPTY = 'rgba(255,255,255,0.18)';
const MOST_TREES = 5;
const TREE_GAP = 11;
const HEIGHT = 30;

/**
 * A small grove of syntax trees, one per saved analysis up to five, the
 * newest on the right in green. An empty Tree Bank shows one faint tree.
 */
const Grove: React.FC<{ count: number; open: boolean }> = ({ count, open }) => {
  const shown = Math.max(1, Math.min(count, MOST_TREES));
  const width = shown * TREE_GAP + 2;
  return (
    <svg viewBox={`0 0 ${width} ${HEIGHT}`} style={{ aspectRatio: `${width} / ${HEIGHT}` }}
      className="h-[30px] md:h-[34px] w-auto shrink-0" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => {
        const x = 6.5 + i * TREE_GAP;
        const newest = i === shown - 1;
        const stroke = count === 0 ? EMPTY : newest ? GREEN : BARK_LIGHT;
        return (
          <g key={i} stroke={stroke} strokeWidth={newest && open ? 2 : 1.6}
            strokeLinecap="round" fill="none"
            className={`transition-opacity duration-200 ${newest || open ? 'opacity-100' : 'opacity-85 group-hover:opacity-100'}`}>
            <path d={`M${x} 7 C ${x} 11, ${x - 4.5} 11, ${x - 4.5} 15 M${x} 7 C ${x} 11, ${x + 4.5} 11, ${x + 4.5} 15`} />
            <path d={`M${x + 4.5} 15 C ${x + 4.5} 19, ${x + 1.5} 19, ${x + 1.5} 23 M${x + 4.5} 15 C ${x + 4.5} 19, ${x + 7} 19, ${x + 7} 23`}
              opacity={0.8} />
            <circle cx={x} cy={5.5} r={1.4} fill={stroke} stroke="none" />
          </g>
        );
      })}
    </svg>
  );
};

/**
 * Public Babel's way into the Tree Bank, beside the title: the grove and a
 * label set like the title. The count is in the spoken label; the Tree Bank
 * screen shows the rest.
 */
const TreeBankBranch: React.FC<TreeBankBranchProps> = ({ open, count, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-current={open ? 'page' : undefined}
    aria-label={open ? 'Tree Bank, open' : `Tree Bank, ${count} saved`}
    className="tree-bank-branch group flex items-center gap-1.5 md:gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
  >
    <Grove count={count} open={open} />
    <span className="flex flex-col items-start text-left">
      <span className={`text-lg md:text-xl font-bold tracking-tighter serif leading-tight transition-colors ${open ? 'text-white' : 'text-emerald-50/85 group-hover:text-white'}`}>
        Tree Bank
      </span>
      {/* The subtitle's line box, so "Tree Bank" sits on the title's line. */}
      <span aria-hidden="true" className="h-[6px] md:h-[7px]" />
    </span>
  </button>
);

export default TreeBankBranch;
