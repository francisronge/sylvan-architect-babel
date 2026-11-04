import React from 'react';
import { Archive, Maximize2, Minimize2 } from 'lucide-react';

const HEADER_BUTTON = 'flex items-center gap-2 px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest whitespace-nowrap';
const IDLE = 'border-white/10 bg-white/5 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30';

export const TreeBankToggle: React.FC<{ open: boolean; count: number; onToggle: () => void }> = ({ open, count, onToggle }) => (
  <button
    onClick={onToggle}
    className={`${HEADER_BUTTON} ${open ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : IDLE}`}
    title={open ? 'Return to Arboretum' : 'Open Tree Bank'}
  >
    <Archive size={12} />
    {open ? 'Back to Arboretum' : `Tree Bank (${count})`}
  </button>
);

export const FullscreenButton: React.FC<{ fullscreen: boolean; onToggle: () => void }> = ({ fullscreen, onToggle }) => (
  <button onClick={onToggle} className={`${HEADER_BUTTON} ${IDLE}`} title="Toggle Fullscreen">
    {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
    {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
  </button>
);
