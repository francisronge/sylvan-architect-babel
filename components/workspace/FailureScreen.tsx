import React, { useEffect, useRef } from 'react';
import type { GenerationError } from '../../services/generationState';
import { describeFailure, FAILURE_ACTION_LABELS, type FailureAction, type FailureKind } from './failureKinds';
import {
  BARK, NODE, TREE_BRANCHES, TREE_HEIGHT, TREE_NODES, TREE_WIDTH, isTreeLeaf, treeNodePosition
} from './syntaxTreeArt';

/**
 * Public Babel's failure screen: the sentence, the waiting screen's tree in a
 * state that says what happened, what likely went wrong, and what to do next
 * (Francis, 5 Nov 2026). Each tree plays one short moment when the screen
 * appears and then rests, so nothing looks as if it were still waiting: a
 * snapped arm falls, the moon rises and its stars twinkle in, or a cloud drifts
 * in and drizzles. The drizzle keeps falling, slowly; it is weather, not
 * progress. With reduced motion each starts in its resting state (styles.css).
 */

const W = TREE_WIDTH;
const H = TREE_HEIGHT;
const GROUND_Y = H + 22;

const Branches: React.FC<{ include: (index: number) => boolean; opacity?: number }> = ({ include, opacity = 1 }) => (
  <>
    {TREE_BRANCHES.map((branch, index) => include(index) && (
      <path key={`${branch.mother}-${branch.daughter}`} d={branch.d} fill="none" stroke={BARK} strokeWidth={2.2} strokeLinecap="round" opacity={opacity} />
    ))}
  </>
);

/** A node shows when it is a drawn branch's daughter, or a mother whose branches are all drawn. */
const Nodes: React.FC<{ include: (index: number) => boolean; opacity?: number }> = ({ include, opacity = 1 }) => (
  <>
    {TREE_NODES.map(node => {
      const shown = isTreeLeaf(node)
        ? TREE_BRANCHES.some((branch, index) => branch.daughter === node && include(index))
        : TREE_BRANCHES.every((branch, index) => branch.mother !== node || include(index));
      if (!shown) return null;
      const [x, y] = treeNodePosition(node);
      return <circle key={node} cx={x} cy={y} r={isTreeLeaf(node) ? 3.6 : 2.8} fill={NODE} opacity={opacity} />;
    })}
  </>
);

const Ground = () => (
  <path d={`M-6 ${GROUND_Y} Q ${W / 2} ${H + 15} ${W + 6} ${GROUND_Y}`} stroke="#1d4a3a" strokeWidth={1.6} fill="none" strokeLinecap="round" />
);

const isArm = (index: number) => TREE_BRANCHES[index].mother === 'a' || TREE_BRANCHES[index].daughter === 'a';

/** The whole tree with its specifier arm snapped off; the arm falls and lies on the ground. */
const BrokenTree = () => {
  const [ax, ay] = treeNodePosition('a');
  const [rx, ry] = treeNodePosition('r');
  const stubX = rx + (ax - rx) * 0.22;
  const stubY = ry + (ay - ry) * 0.22;
  const fallen = { '--arm-x': `${ax}px`, '--arm-y': `${ay}px`, '--arm-dx': `${14 - ax}px`, '--arm-dy': `${H + 6 - ay}px` } as React.CSSProperties;
  return (
    <>
      <Ground />
      <Branches include={index => !isArm(index)} />
      <path d={`M${rx} ${ry} L ${stubX} ${stubY}`} stroke={BARK} strokeWidth={2.2} strokeLinecap="round" />
      <path d={`M${stubX - 3} ${stubY + 1} l 3 -2.5 l 1.5 3.5`} stroke={BARK} strokeWidth={1.2} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
      <circle cx={rx} cy={ry} r={2.8} fill={NODE} />
      <g className="failure-arm" style={fallen}>
        {TREE_BRANCHES.filter(branch => branch.mother === 'a').map(branch => (
          <path key={branch.daughter} d={branch.d} fill="none" stroke={BARK} strokeWidth={2.2} strokeLinecap="round" opacity={0.7} />
        ))}
        {['a', 'a1', 'a2'].map(node => {
          const [x, y] = treeNodePosition(node);
          return <circle key={node} cx={x} cy={y} r={node === 'a' ? 2.8 : 3.6} fill={NODE} opacity={0.7} />;
        })}
      </g>
      <Nodes include={index => !isArm(index)} />
    </>
  );
};

// A teardrop, pointed at the top and round below, `size` wide, standing at (x, y).
const teardrop = (x: number, y: number, size: number) =>
  `M${x} ${y} C ${x + size * 0.35} ${y + size * 0.7}, ${x + size * 0.55} ${y + size * 1.05}, ${x} ${y + size * 1.4}`
  + ` C ${x - size * 0.55} ${y + size * 1.05}, ${x - size * 0.35} ${y + size * 0.7}, ${x} ${y} Z`;
// Sparse drops under the cloud: [x offset, y offset, size].
const RAIN_DROPS: Array<[number, number, number]> = [[-14, 1, 6.4], [2, 8, 5.2], [16, 3, 5.8]];

// The stalled tree has the first eight branches: the spine up to its middle phrase.
const STALLED_BRANCHES = 8;

/** A tree that stopped growing halfway, under a small rain cloud. */
const RainedOnTree = () => {
  // Centred over the stalled tree, just above its top.
  const cx = 200;
  const cy = 36;
  return (
    <>
      <Ground />
      <Branches include={index => index < STALLED_BRANCHES} opacity={0.5} />
      <Nodes include={index => index < STALLED_BRANCHES} opacity={0.55} />
      <g className="failure-cloud">
        <path d={`M${cx - 30} ${cy + 8} a10 10 0 0 1 4 -19 a14 14 0 0 1 26 -5 a11 11 0 0 1 19 9 a8 8 0 0 1 -2 15 z`} fill="#18392e" stroke="#2f6a55" strokeWidth={1.2} />
      </g>
      {RAIN_DROPS.map(([dx, dy, size], drop) => (
        <path key={drop} className="failure-rain" style={{ animationDelay: `${0.9 + drop * 0.55}s` }}
          d={teardrop(cx + dx, cy + 14 + dy, size)} fill="#a7f3d0" />
      ))}
    </>
  );
};

// A four-pointed star of radius r, its points slender.
const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r} Q ${x + r * 0.16} ${y - r * 0.16} ${x + r} ${y} Q ${x + r * 0.16} ${y + r * 0.16} ${x} ${y + r}`
  + ` Q ${x - r * 0.16} ${y + r * 0.16} ${x - r} ${y} Q ${x - r * 0.16} ${y - r * 0.16} ${x} ${y - r} Z`;
const STARS: Array<[number, number, number]> = [[22, -30, 7], [74, -12, 4.5], [W * 0.46, -36, 5.4]];

const NightSky: React.FC<{ lower?: number }> = ({ lower = 0 }) => {
  const mx = W - 4;
  const my = -24 + lower;
  return (
    <>
      <g className="failure-moon"><path d={`M${mx} ${my - 14} a14 14 0 1 0 10 24 a11 11 0 1 1 -10 -24 z`} fill="#efe3bf" /></g>
      {STARS.map(([x, starY, r], star) => { const y = starY + lower; return (
        <path key={star} className="failure-star" style={{ animationDelay: `${1 + star * 0.4}s`, transformOrigin: `${x}px ${y}px` }}
          d={sparkle(x, y, r)} fill="#efe3bf" opacity={0.85} />
      ); })}
    </>
  );
};

/** The visitor's own tree, whole, resting under the moon: their trees for today are grown. */
const RestingTree = () => (
  <>
    <Ground />
    <NightSky />
    <Branches include={() => true} opacity={0.8} />
    <Nodes include={() => true} />
  </>
);

// A small whole tree for the grove: a root, two phrases and four words.
const MINI_NODES: Array<[number, number, boolean]> = [[0, 0, false], [-20, 26, false], [20, 26, false], [-31, 52, true], [-9, 52, true], [9, 52, true], [31, 52, true]];
const MINI_BRANCHES: Array<[number, number]> = [[1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 2]];
const miniBranch = ([from, to]: [number, number]) => {
  const [x1, y1] = MINI_NODES[from];
  const [x2, y2] = MINI_NODES[to];
  const middle = (y1 + y2) / 2;
  return `M${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
};
// The grove's trees, each standing on the ground: [x of its root, scale]. The middle one is tallest.
const GROVE: Array<[number, number]> = [[W * 0.18, 1], [W * 0.5, 1.3], [W * 0.82, 1]];

/** A grove resting under the moon: Babel's trees for today are all grown. */
const RestingGrove = () => (
  <>
    <Ground />
    <NightSky lower={70} />
    {GROVE.map(([x, scale], tree) => (
      <g key={tree} transform={`translate(${x} ${GROUND_Y - 8 - 52 * scale}) scale(${scale})`}>
        {MINI_BRANCHES.map(branch => (
          <path key={branch.join('-')} d={miniBranch(branch)} fill="none" stroke={BARK} strokeWidth={2.2 / scale} strokeLinecap="round" opacity={0.8} />
        ))}
        {MINI_NODES.map(([nx, ny, leaf], node) => (
          <circle key={node} cx={nx} cy={ny} r={(leaf ? 3.6 : 2.8) / scale} fill={NODE} />
        ))}
      </g>
    ))}
  </>
);

const ART: Record<FailureKind, React.FC> = {
  broken: BrokenTree,
  sentence: BrokenTree,
  noAnswer: RainedOnTree,
  visitorLimit: RestingTree,
  siteLimit: RestingGrove
};

export interface FailureScreenProps {
  error: GenerationError;
  /** The sentence that failed; the screen shows it as the waiting screen did. */
  sentence: string;
  onRetry: () => void;
  onEdit: () => void;
  onOpenTreeBank: () => void;
}

const FailureScreen: React.FC<FailureScreenProps> = ({ error, sentence, onRetry, onEdit, onOpenTreeBank }) => {
  const copy = describeFailure(error);
  const Art = ART[copy.kind];
  const firstAction = useRef<HTMLButtonElement>(null);
  // The screen replaces the waiting screen, so focus moves to its first action.
  useEffect(() => { firstAction.current?.focus(); }, [copy.kind]);
  const run: Record<FailureAction, () => void> = { retry: onRetry, edit: onEdit, treeBank: onOpenTreeBank };

  return (
    <div
      data-babel-failure-screen={copy.kind}
      className="loading-overlay absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-xl flex flex-col items-center justify-center px-6 text-center"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onEdit();
      }}
    >
      {sentence && (
        <p className="serif italic text-[20px] md:text-[22px] leading-snug text-emerald-50 max-w-xl mb-6 md:mb-8 break-words">
          “{sentence}”
        </p>
      )}
      <svg viewBox={`-20 -42 ${W + 40} ${H + 74}`} className="w-[min(280px,74vw)] h-auto overflow-visible" aria-hidden="true">
        <Art />
      </svg>
      <div role="alert" className="mt-6 md:mt-8">
        <h2 className="serif text-[22px] md:text-[24px] leading-tight text-emerald-50">{copy.headline}</h2>
        <p className="serif italic text-[16px] md:text-[17px] leading-relaxed text-emerald-300/90 max-w-[24rem] mx-auto mt-2">{copy.explanation}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3 mt-7">
        {copy.actions.map((action, index) => (
          <button
            key={action}
            ref={index === 0 ? firstAction : undefined}
            type="button"
            onClick={run[action]}
            className={index === 0
              ? 'rounded-full px-5 py-2.5 text-[14px] font-semibold bg-[#a7f3d0] text-[#04261b] border border-[#a7f3d0] hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#efe3bf] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020806]'
              : 'rounded-full px-5 py-2.5 text-[14px] font-semibold text-[#a7f3d0] border border-[#a7f3d0]/35 hover:border-[#a7f3d0]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#efe3bf] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020806]'}
          >
            {FAILURE_ACTION_LABELS[action]}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FailureScreen;
