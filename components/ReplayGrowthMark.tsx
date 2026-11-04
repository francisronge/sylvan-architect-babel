import React from 'react';

const EMERALD = '#10b981';
const MINT = '#a7f3d0';

/**
 * The mark beside the Replay header's step count: a binary tree that gains a
 * level each quarter of the derivation (`replayGrowthLevel`) and turns mint,
 * with its leaves, at the last step. A level that appears draws itself in.
 */
const ReplayGrowthMark: React.FC<{ level: number; complete: boolean }> = ({ level, complete }) => {
  const color = complete ? MINT : EMERALD;
  const branch = (shown: number, d: string) => level >= shown && (
    <path key={`${shown}:${d}`} d={d} pathLength={1} className="replay-growth-branch" />
  );
  return (
    <svg viewBox="0 0 16 18" aria-hidden="true" data-babel-replay-growth={level}
      className="w-[18px] h-5 shrink-0 overflow-visible [filter:drop-shadow(0_0_5px_rgba(16,185,129,0.7))]"
      fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="2.5" r="1.7" fill={color} stroke="none" />
      {branch(2, 'M8 4 C 8 6.5, 4.5 6.5, 4.5 9 M8 4 C 8 6.5, 11.5 6.5, 11.5 9')}
      {branch(3, 'M11.5 9 C 11.5 11.5, 9.5 11.5, 9.5 14 M11.5 9 C 11.5 11.5, 13.8 11.5, 13.8 14')}
      {branch(4, 'M4.5 9 C 4.5 11.5, 2.2 11.5, 2.2 14 M4.5 9 C 4.5 11.5, 6.5 11.5, 6.5 14')}
      {complete && [2.2, 6.5, 9.5, 13.8].map(x => <circle key={x} cx={x} cy="15.6" r="1.1" fill={MINT} stroke="none" />)}
    </svg>
  );
};

export default ReplayGrowthMark;
