import { useEffect, useId, useRef, useState } from 'react';
import { Archive, Clock3, FolderOpen, RotateCcw, Trash2 } from 'lucide-react';
import type { TreeBankEntrySummary } from '../services/treeBankStore.ts';
import TreeBankPreview from './TreeBankPreview';

// Each card is a blurred glass panel, so mounting a whole large library is
// expensive, particularly on mobile. Cards render one page at a time.
const TREE_BANK_PAGE_SIZE = 24;

const formatTreeBankDate = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Unknown timestamp';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

interface TreeBankViewProps {
  entries: TreeBankEntrySummary[];
  /** True only until the first listing; later refreshes keep the cards mounted. */
  loading: boolean;
  error: string | null;
  opening: boolean;
  onOpen: (entry: TreeBankEntrySummary) => Promise<void>;
  onDelete: (entry: TreeBankEntrySummary) => void;
}

export function TreeBankView({ entries, loading, error, opening, onOpen, onDelete }: TreeBankViewProps) {
  const [visibleCount, setVisibleCount] = useState(TREE_BANK_PAGE_SIZE);
  const hiddenCount = Math.max(0, entries.length - visibleCount);
  return (
  <div className="absolute inset-0 z-20 overflow-y-auto px-4 py-6 md:px-12 md:py-12">
    <div className="max-w-7xl mx-auto space-y-8 pb-24">
      <div className="glass-dark rounded-[2.5rem] p-8 md:p-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.5em] text-emerald-500/60">Saved Workspace</p>
            <h2 className="serif text-4xl text-white tracking-tight mt-2">Tree Bank</h2>
            <p className="text-emerald-50/70 mt-3 max-w-2xl">
              Re-open any saved sentence with its full generated artifacts, or prune entries you no longer need.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-emerald-400/80">
            <Archive size={14} />
            {entries.length} {entries.length === 1 ? 'Saved Tree' : 'Saved Trees'}
          </div>
        </div>
        {error && (
          <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300 text-sm">
            {error}
          </div>
        )}
      </div>

      {loading ? (
        <div className="glass-dark rounded-[2.5rem] p-12 flex flex-col items-center justify-center gap-4 text-emerald-200/80">
          <RotateCcw size={22} className="animate-spin" />
          <p className="text-sm uppercase tracking-[0.25em] font-black">Loading Tree Bank</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="glass-dark rounded-[2.5rem] p-14 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Archive size={28} />
          </div>
          <p className="serif italic text-2xl text-white mb-2">No saved trees yet</p>
          <p className="text-emerald-50/60 max-w-xl mx-auto">
            Parse a sentence in the Arboretum, then use "Save to Tree Bank" in the header.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {entries.slice(0, visibleCount).map((entry) => {
            const stageCount = entry.stageCount;

            return (
              <div
                key={entry.id}
                className="glass-dark rounded-[2.2rem] p-8 border border-white/10 hover:border-emerald-500/40 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.35em] text-emerald-400/70">
                      {entry.framework === 'xbar' ? 'X-Bar Theory' : 'Minimalist Program'}
                    </p>
                    <p className="mt-3 serif italic text-2xl leading-tight text-white break-words">"{entry.sentence}"</p>
                  </div>
                  <div className="text-[9px] uppercase tracking-[0.2em] font-black text-emerald-500/60 shrink-0 flex items-center gap-2">
                    <Clock3 size={12} />
                    {formatTreeBankDate(entry.updatedAt)}
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-[0.18em]">
                  <span className="px-3 py-1.5 rounded-full border border-emerald-500/25 text-emerald-300/80 bg-emerald-500/10">
                    {entry.analysisCount} {entry.analysisCount === 1 ? 'Parse' : 'Parses'}
                  </span>
                  <span className="px-3 py-1.5 rounded-full border border-white/15 text-white/70 bg-white/5">
                    {stageCount} {stageCount === 1 ? 'Stage' : 'Stages'}
                  </span>
                </div>

                <div className="mt-6 rounded-[1.4rem] border border-white/10 bg-[#020806] overflow-hidden h-56">
                  <TreeBankPreview previewId={entry.previewId} sentence={entry.sentence} />
                </div>

                <div className="mt-7 flex items-center gap-3">
                  <button
                    onClick={() => void onOpen(entry)}
                    disabled={opening}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20 transition-all text-[10px] font-black uppercase tracking-widest"
                  >
                    <FolderOpen size={13} />
                    Open Tree
                  </button>
                  <button
                    onClick={() => onDelete(entry)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all text-[10px] font-black uppercase tracking-widest"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && hiddenCount > 0 && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500/60">
            Showing {entries.length - hiddenCount} of {entries.length} Saved Trees
          </p>
          <button
            onClick={() => setVisibleCount(count => count + TREE_BANK_PAGE_SIZE)}
            className="px-5 py-2.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20 transition-all text-[10px] font-black uppercase tracking-widest"
          >
            Show {Math.min(hiddenCount, TREE_BANK_PAGE_SIZE)} More
          </button>
        </div>
      )}
    </div>
  </div>
  );
}

interface TreeBankDeleteDialogProps {
  entry: TreeBankEntrySummary;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

// A modal dialog: the rest of the page is inert while it is open, Escape
// cancels, and focus starts on Cancel and returns to the control that opened it.
// The transparent dialog only hosts the overlay, which keeps its own look.
export function TreeBankDeleteDialog({ entry, onConfirm, onCancel }: TreeBankDeleteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previouslyFocused = document.activeElement;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, []);
  return (
  <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onCancel(); }}
    className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-visible border-0 bg-transparent p-0 backdrop:bg-transparent">
  <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center px-6">
    <div className="glass-dark rounded-[2rem] p-8 w-full max-w-xl border border-emerald-500/40 shadow-[0_0_30px_rgba(16,185,129,0.14)]">
      <h3 id={titleId} className="serif text-3xl text-white mt-1 mb-4">Delete saved tree?</h3>
      <p id={descriptionId} className="text-emerald-50/80 leading-relaxed">
        This will permanently remove <span className="italic">"{entry.sentence}"</span> from Tree Bank.
      </p>
      <div className="mt-7 flex items-center gap-3">
        <button
          onClick={onConfirm}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 transition-all text-[10px] font-black uppercase tracking-widest"
        >
          <Trash2 size={13} />
          Delete Tree
        </button>
        <button
          ref={cancel}
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl border border-white/15 bg-white/5 text-white/70 hover:text-emerald-300 hover:border-emerald-500/40 transition-all text-[10px] font-black uppercase tracking-widest"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
  </dialog>
  );
}
