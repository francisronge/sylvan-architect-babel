import React from 'react';
import RootLogo from '../RootLogo';

/** The logo and name at the left of the header. */
const BabelTitle: React.FC = () => (
  <div className="flex items-center gap-3 md:gap-4 shrink-0">
    <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(6,78,59,0.5)]">
      <RootLogo size={40} shape="square" blend={true} zoom={1.12} className="w-full h-full" />
    </div>
    <div>
      <h1 className="text-lg md:text-xl font-bold tracking-tighter text-white serif leading-tight">Sylvan Architect Babel</h1>
      <p className="text-[6px] md:text-[7px] font-black uppercase tracking-[0.35em] md:tracking-[0.5em] text-emerald-500/80 leading-none">Generative Grammar Arboretum</p>
    </div>
  </div>
);

export default BabelTitle;
