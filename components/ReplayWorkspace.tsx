import React from 'react';
import type { ReplayWorkspace as Workspace } from '../replay/replayWorkspace.ts';
import type { SyntaxNode } from '../types';

// Light bark for the notation's brackets, braces and equals signs, as in the
// Tree Bank's grove; the WS and LA names are Babel's emerald.
const BARK = '#c9a46a';
// The node a step built or selected wears mint brackets and label.
const MINT = '#a7f3d0';
const NAME = 'serif italic text-[14px] sm:text-[15px] text-emerald-300 no-underline cursor-help';

const isWord = (node: SyntaxNode) => !node.children?.length;
const wordsOf = (node: SyntaxNode): SyntaxNode[] => (isWord(node) ? [node] : (node.children ?? []).flatMap(wordsOf));

const Word: React.FC<{ node: SyntaxNode }> = ({ node }) => (
  <span className={`serif italic ${node.silent ? 'text-white/55' : 'text-emerald-50'}`}>{String(node.word || node.label)}</span>
);
const Open: React.FC<{ label: string; marked?: boolean }> = ({ label, marked = false }) => (
  // The label sits on the words' baseline, smaller and bold: a dropped
  // subscript put labels and words on different lines.
  <><span style={{ color: marked ? MINT : BARK }}>[</span><span className={`serif font-bold not-italic text-[0.72em] mr-0.5 ${marked ? '' : 'text-white/85'}`} style={marked ? { color: MINT } : undefined}>{label}</span></>
);
const Close: React.FC<{ marked?: boolean }> = ({ marked = false }) => <span style={{ color: marked ? MINT : BARK }}>]</span>;
// The triangle over an abbreviated phrase, drawn so its base sits on the
// words' baseline at their x-height (a text glyph comes from a fallback font
// with its own size and baseline).
const Roof = () => (
  <svg viewBox="0 0 12 10" aria-label="abbreviated" role="img" className="inline-block h-[0.62em] w-[0.75em] mx-1 align-baseline overflow-visible">
    <path d="M6 0.8 L11.2 9.4 H0.8 Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" className="text-white/45" />
  </svg>
);

/**
 * Labelled bracketing, each label small and bold on the words' baseline:
 * [DP [D Which] [N book]]. Below `depth`, a phrase is abbreviated with a
 * triangle over its words, [CP △ to leave], as on a drawn tree.
 */
const Bracketing: React.FC<{ node: SyntaxNode; depth: number; targetId: string | null }> = ({ node, depth, targetId }) => {
  const kids = node.children ?? [];
  const marked = targetId !== null && String(node.id) === targetId;
  if (isWord(node)) {
    // A drawn word under its category, or an authored head with its word: [D Which]; a silent head alone: [v].
    if (node.word && (!node.label || node.label === node.word)) return <Word node={node} />;
    return <span><Open label={String(node.label)} marked={marked} />{node.word && <Word node={node} />}<Close marked={marked} /></span>;
  }
  // A head written as its category over its word is one bracket: [N book].
  if (kids.length === 1 && isWord(kids[0])) return <span><Open label={String(node.label)} marked={marked} /><Word node={kids[0]} /><Close marked={marked} /></span>;
  if (depth <= 0) {
    return (
      <span>
        <Open label={String(node.label)} marked={marked} /><Roof />
        {wordsOf(node).map((word, index) => <React.Fragment key={index}>{index ? ' ' : ''}<Word node={word} /></React.Fragment>)}
        <Close marked={marked} />
      </span>
    );
  }
  return (
    <span>
      <Open label={String(node.label)} marked={marked} />
      {kids.map((kid, index) => <React.Fragment key={String(kid.id ?? index)}>{index ? ' ' : ''}<Bracketing node={kid} depth={depth - 1} targetId={targetId} /></React.Fragment>)}
      <Close marked={marked} />
    </span>
  );
};

/**
 * A construction step's state in the notation of the Minimalist literature:
 * WS = [ … ], [ … ] lists the workspace's syntax objects, the one this step
 * built written out to its daughters and the rest abbreviated; LA = { … }
 * lists the lexical array, the words still to be selected.
 */
const ReplayWorkspace: React.FC<{ workspace: Workspace }> = ({ workspace }) => {
  const { objects, currentIndex, lexicalArray } = workspace;
  return (
    <div data-babel-replay-workspace="true" className="space-y-0.5 sm:space-y-1 text-[14px] sm:text-[15px] leading-snug">
      <div className="flex items-baseline gap-2">
        <abbr title="Workspace: the syntax objects built so far" className={NAME}>WS</abbr>
        <span style={{ color: BARK }}>=</span>
        <span className="inline-flex flex-wrap items-baseline gap-x-4 gap-y-1 min-w-0">
          {objects.map((object, index) => (
            <span key={String(object.id ?? index)} className={index === currentIndex ? '' : 'text-white/90'}>
              <Bracketing node={object} depth={index === currentIndex ? 1 : 0} targetId={workspace.targetId} />
              {index < objects.length - 1 && <span className="text-white/60">,</span>}
            </span>
          ))}
        </span>
      </div>
      {lexicalArray.length > 0 && (
        <div className="flex items-baseline gap-2">
          <abbr title="Lexical array: the words not yet selected" className={NAME}>LA</abbr>
          <span style={{ color: BARK }}>=</span>
          <span>
            <span style={{ color: BARK }}>{'{'}</span>{' '}
            {lexicalArray.map((word, index) => (
              <React.Fragment key={index}>{index ? ', ' : ''}<span className="serif italic text-emerald-50">{word}</span></React.Fragment>
            ))}
            {' '}<span style={{ color: BARK }}>{'}'}</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default ReplayWorkspace;
