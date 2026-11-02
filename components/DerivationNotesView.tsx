import { Check, Copy, ExternalLink, Info, Layers } from 'lucide-react';

export type CopyStatus = 'idle' | 'copied' | 'failed';
interface DerivationNotesViewProps {
  paragraphs: string[];
  /** Bracketing of the final forest only; no derivation stage or movement index. */
  notation: string;
  copyStatus: CopyStatus;
  onCopy: (text: string) => void;
}

export function DerivationNotesView({ paragraphs, notation, copyStatus, onCopy }: DerivationNotesViewProps) {
  const copied = copyStatus === 'copied';
  return (
  <div
    className="w-full h-full flex justify-center overflow-y-auto overflow-x-hidden bg-[#020806]/60 backdrop-blur-md items-start px-4 pt-8 pb-36 md:px-12 md:pt-20 md:pb-44"
  >
      <div className="max-w-4xl w-full space-y-8">
        <div className="glass-dark p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl">
            <div className="flex items-center gap-4 md:gap-5 mb-6 md:mb-8">
              <div className="w-10 h-10 md:w-12 md:h-12 moss-gradient rounded-2xl flex items-center justify-center text-white shadow-lg">
                <Info size={24} />
              </div>
              <h2 className="text-xl md:text-3xl font-bold text-white serif tracking-tight">Derivational Notes</h2>
            </div>
            <div className="space-y-5 md:space-y-6">
              {paragraphs.map((paragraph, index) => (
                <p
                  key={`derivational-note-${index}`}
                  className="text-emerald-50/90 leading-relaxed italic serif text-lg md:text-2xl border-l-2 border-emerald-500/20 pl-5 md:pl-8"
                >
                  &quot;{paragraph}&quot;
                </p>
              ))}
            </div>
        </div>

        {notation && (
          <div className="glass-dark p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl">
             <div className="flex items-center justify-between mb-6 md:mb-8 gap-4">
                <div className="flex items-center gap-4 md:gap-5">
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-2xl flex items-center justify-center text-emerald-500 border border-white/10">
                    <Layers size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl md:text-3xl font-bold text-white serif tracking-tight">Labeled Bracketing</h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/75">Final Tree · Miles Shang Notation</p>
                  </div>
                </div>
                <a 
                  href="https://mshang.ca/syntree/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-6 py-3 rounded-2xl border bg-white/5 border-white/10 text-white/45 hover:text-emerald-400 hover:border-emerald-500/30 transition-all text-[11px] font-black uppercase tracking-widest"
                >
                  <ExternalLink size={14} />
                  Miles Shang
                </a>
              </div>
              <div className="bg-black/40 p-5 md:p-8 rounded-[1.5rem] md:rounded-[2rem] border border-white/5 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/80">Canopy Code</p>
                  <button
                    onClick={() => onCopy(notation)}
                    className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl border transition-all text-[10px] font-black uppercase tracking-widest ${
                      copied
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'bg-white/5 border-white/10 text-white/45 hover:text-emerald-400 hover:border-emerald-500/30'
                    }`}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied to Soil' : 'Copy Canopy'}
                  </button>
                </div>
                {copyStatus === 'failed' && (
                  <p role="alert" className="mb-4 text-sm text-rose-300">
                    The browser blocked clipboard access. Select the bracketing below to copy it.
                  </p>
                )}
                <code className="text-emerald-400 mono text-sm md:text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
                  {notation}
                </code>
              </div>
          </div>
        )}
      </div>
  </div>
  );
}
