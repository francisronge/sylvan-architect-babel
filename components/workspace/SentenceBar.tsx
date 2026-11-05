import React from 'react';
import FailurePanel, { dismissesFailure } from '../FailurePanel';
import type { GenerationError } from '../../services/generationState';
import SentenceForm from './SentenceForm';

interface SentenceBarProps {
  inputRef: React.Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  placeholder: string;
  /** The failure of the last request, shown above the sentence box until dismissed or replaced. */
  error: GenerationError | null;
  /** Closes the failure display, from its close button or Escape anywhere in the bar. */
  onDismiss: () => void;
  /** Extra notices inside the failure panel. */
  failureNotice?: React.ReactNode;
}

/**
 * The input screen's sentence bar at the bottom of the workspace, shared by
 * public Babel and the internal app. Neither app shows it while a tree is
 * shown, so it never takes the tree's room (ROADMAP, Program 3B.2).
 */
const SentenceBar: React.FC<SentenceBarProps> = ({
  inputRef, value, onChange, onSubmit, loading, placeholder, error, onDismiss, failureNotice
}) => (
  <div
    data-babel-tree-controls="bottom"
    className="absolute left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4 md:px-8"
    style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
    onKeyDown={(event) => {
      if (!error || !dismissesFailure(event.nativeEvent)) return;
      event.preventDefault();
      onDismiss();
    }}
  >
    <div className="glass-dark rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] overflow-hidden p-4 md:p-6">
      {error && (
        <FailurePanel
          message={error.message}
          failure={error.failure}
          rawOutput={error.rawOutput}
          generationRecord={error.generationRecord}
          sentence={error.request?.sentence}
          inputTokens={error.inputTokens}
          onDismiss={onDismiss}
        >
          {failureNotice}
        </FailurePanel>
      )}
      <SentenceForm
        inputRef={inputRef}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        loading={loading}
        placeholder={placeholder}
      />
    </div>
  </div>
);

export default SentenceBar;
