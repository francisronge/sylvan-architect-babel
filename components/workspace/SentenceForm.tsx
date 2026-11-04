import React from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { submitsSentence } from '../sentenceSubmitKey';

interface SentenceFormProps {
  inputRef?: React.Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  placeholder: string;
}

/** The sentence box and its Analyze button. Enter submits; Shift+Enter starts a new line. */
const SentenceForm: React.FC<SentenceFormProps> = ({ inputRef, value, onChange, onSubmit, loading, placeholder }) => (
  <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="flex gap-3 md:gap-4 items-end">
    <div className="flex-1 relative">
      <textarea
        ref={inputRef}
        aria-label="Sentence to analyze"
        className="w-full bg-black/40 border border-white/10 rounded-2xl p-3 md:p-4 text-emerald-50 serif italic placeholder:text-emerald-500/75 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all resize-none h-16 md:h-20 text-base md:text-lg shadow-inner leading-relaxed"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (submitsSentence(e)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={loading}
      />
    </div>
    <button
      type="submit"
      aria-label={loading ? 'Analyzing sentence' : 'Analyze sentence'}
      disabled={loading}
      className="moss-gradient hover:brightness-110 disabled:opacity-40 text-white font-black w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center shadow-[0_10px_20px_rgba(0,0,0,0.4)] active:scale-90 transition-all group shrink-0"
    >
      {loading ? (
        <RotateCcw className="animate-spin" size={20} />
      ) : (
        <Sparkles size={20} className="group-hover:rotate-12 group-hover:scale-110 transition-transform md:w-6 md:h-6" />
      )}
    </button>
  </form>
);

export default SentenceForm;
