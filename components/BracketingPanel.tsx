import { useEffect, useRef } from 'react';
import { Check, Copy, ExternalLink, Layers, X } from 'lucide-react';

export type CopyStatus = 'idle' | 'copied' | 'failed';
interface BracketingPanelProps {
  id: string;
  /** Bracketing of the final forest only; no derivation stage or movement index. */
  notation: string;
  copyStatus: CopyStatus;
  onCopy: (text: string) => void;
  onClose: () => void;
}

/**
 * The final tree's labeled bracketing, opened from the button beside Replay.
 * It floats over the tree and is not a view of its own, so opening it never
 * changes the tree's layout or Replay position. Escape closes it.
 */
export function BracketingPanel({ id, notation, copyStatus, onCopy, onClose }: BracketingPanelProps) {
  const copied = copyStatus === 'copied';
  const copyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { copyRef.current?.focus(); }, []);
  return (
    <div
      id={id}
      role="dialog"
      aria-label="Labeled Bracketing"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
      className="glass-dark w-[min(36rem,calc(100vw-6rem))] max-h-[min(70vh,36rem)] overflow-y-auto p-5 md:p-7 rounded-[1.5rem] md:rounded-[2rem] border border-white/10 shadow-2xl"
    >
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div className="w-9 h-9 md:w-10 md:h-10 shrink-0 bg-white/5 rounded-2xl flex items-center justify-center text-emerald-500 border border-white/10">
            <Layers size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg md:text-2xl font-bold text-white serif tracking-tight">Labeled Bracketing</h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/40">Final Tree · Miles Shang Notation</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close labeled bracketing"
          className="shrink-0 p-1.5 rounded-xl text-emerald-500/60 hover:bg-white/10 hover:text-emerald-300 transition-colors"
        >
          <X size={18} />
        </button>
      </div>
      <div className="bg-black/40 p-4 md:p-6 rounded-[1.25rem] md:rounded-[1.5rem] border border-white/5 shadow-inner">
        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
          <button
            ref={copyRef}
            type="button"
            onClick={() => onCopy(notation)}
            className={`flex items-center gap-3 px-4 py-2 rounded-2xl border transition-all text-[10px] font-black uppercase tracking-widest ${
              copied
              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
              : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
            }`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied to Soil' : 'Copy Bracketing'}
          </button>
          <a
            href="https://mshang.ca/syntree/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-2xl border bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30 transition-all text-[10px] font-black uppercase tracking-widest"
          >
            <ExternalLink size={13} />
            Miles Shang
          </a>
        </div>
        {copyStatus === 'failed' && (
          <p role="alert" className="mb-4 text-sm text-rose-300">
            The browser blocked clipboard access. Select the bracketing below to copy it.
          </p>
        )}
        <code className="block text-emerald-400 mono text-sm md:text-base break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
          {notation}
        </code>
      </div>
    </div>
  );
}
