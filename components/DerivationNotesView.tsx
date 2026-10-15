import { Check, Copy, ExternalLink, Info, Layers } from 'lucide-react';

export type CopyCodeKey = 'canopy' | 'derivation';
const BRACKETING_PANELS: ReadonlyArray<{ key: CopyCodeKey; title: string; copyLabel: string }> = [
  { key: 'canopy', title: 'Canopy Code', copyLabel: 'Copy Canopy' },
  { key: 'derivation', title: 'Derivation Code (Movement Indexed)', copyLabel: 'Copy Derivation' }
];
interface DerivationNotesViewProps {
  paragraphs: string[];
  notation: string;
  copiedCodeKey: CopyCodeKey | null;
  copyMilesCode: (text: string, key: CopyCodeKey) => void;
}

export function DerivationNotesView({ paragraphs, notation, copiedCodeKey, copyMilesCode }: DerivationNotesViewProps) {
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
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/40">Canopy + Derivation Miles Shang Formalism</p>
                  </div>
                </div>
                <a 
                  href="https://mshang.ca/syntree/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-6 py-3 rounded-2xl border bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30 transition-all text-[11px] font-black uppercase tracking-widest"
                >
                  <ExternalLink size={14} />
                  Miles Shang
                </a>
              </div>
              <div className="space-y-6">
                {BRACKETING_PANELS.map(({ key, title, copyLabel }) => (
                  <div key={key} className="bg-black/40 p-5 md:p-8 rounded-[1.5rem] md:rounded-[2rem] border border-white/5 shadow-inner">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/80">{title}</p>
                      <button 
                        onClick={() => copyMilesCode(notation, key)}
                        className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl border transition-all text-[10px] font-black uppercase tracking-widest ${
                          copiedCodeKey === key
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                          : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
                        }`}
                      >
                        {copiedCodeKey === key ? <Check size={13} /> : <Copy size={13} />}
                        {copiedCodeKey === key ? 'Copied to Soil' : copyLabel}
                      </button>
                    </div>
                    <code className="text-emerald-400 mono text-sm md:text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
                      {notation}
                    </code>
                  </div>
                ))}
              </div>
          </div>
        )}
      </div>
  </div>
  );
}
