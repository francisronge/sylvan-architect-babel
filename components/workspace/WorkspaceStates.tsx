import React from 'react';
import RootLogo from '../RootLogo';
import LoadingMark from '../LoadingMark';

/** Covers the workspace while a parse runs. */
export const GenerationLoading: React.FC<{ structures: string }> = ({ structures }) => (
  <div className="loading-overlay absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-xl flex flex-col items-center justify-center gap-10 animate-in fade-in duration-700">
    <LoadingMark />
    <div role="status" className="text-center z-10 min-h-[88px] flex flex-col justify-start">
      <p className="text-white font-black serif italic text-2xl mb-1">Synthesizing Neural Roots...</p>
      <p className="text-emerald-500/75 font-black uppercase text-[9px] tracking-[0.7em]">Deep Parsing {structures} Structures</p>
    </div>
  </div>
);

/** The workspace before any analysis is shown. */
export const EmptyWorkspace: React.FC = () => (
  <div className="w-full h-full flex flex-col items-center justify-center text-emerald-900/10 gap-10">
    <div className="relative">
      <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full scale-150"></div>
      <div className="relative z-10 w-24 h-24 md:w-32 md:h-32 rounded-full border border-white/5 flex items-center justify-center bg-black/20 backdrop-blur-sm shadow-inner">
        <RootLogo size={104} shape="circle" blend={true} zoom={0.92} className="w-[78px] h-[78px] md:w-[104px] md:h-[104px]" />
      </div>
    </div>
    <div className="text-center z-10 min-h-[88px] flex flex-col justify-start">
      <p className="font-extrabold text-white text-2xl md:text-3xl mono mb-3 tracking-tighter">Awaiting Structural Genesis</p>
      <p className="text-emerald-500/85 font-black uppercase text-[9px] md:text-[10px] tracking-[0.5em] md:tracking-[0.8em] text-balance max-w-lg mx-auto px-4">Cast a thought into the generative soil to begin its derivation.</p>
    </div>
  </div>
);

/** One button per analysis when the model returned more than one. */
export const ParseChoices: React.FC<{ count: number; active: number; onChoose: (index: number) => void }> = ({ count, active, onChoose }) => (
  <div data-babel-tree-controls="top" className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2">
    <div className="flex max-w-[min(92vw,64rem)] flex-wrap items-center justify-center gap-2 p-1 rounded-2xl border border-white/10 bg-black/50 backdrop-blur-lg shadow-2xl">
      {Array.from({ length: count }, (_, parseIndex) => (
        <button
          key={`parse-choice-${parseIndex}`}
          aria-pressed={active === parseIndex}
          onClick={() => onChoose(parseIndex)}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            active === parseIndex
              ? 'moss-gradient text-white border border-emerald-400/50'
              : 'text-white/60 hover:text-emerald-300'
          }`}
        >
          Parse {parseIndex + 1}
        </button>
      ))}
    </div>
  </div>
);
