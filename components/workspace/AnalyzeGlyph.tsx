import React from 'react';

// Light bark for the branches and mint for the words, as in the Tree Bank's grove.
const BARK = '#c9a46a';
const MINT = '#a7f3d0';

/**
 * The Analyze button's mark: a small labelled tree, S over NP and VP above
 * two words. Its branches draw themselves on hover and keep drawing while a
 * request runs (styles.css, `.analyze-glyph`).
 */
const AnalyzeGlyph: React.FC<{ drawing?: boolean }> = ({ drawing = false }) => (
  <svg viewBox="0 0 48 48" fill="none" strokeLinecap="round" aria-hidden="true"
    className={`analyze-glyph w-11 h-11 md:w-14 md:h-14 overflow-visible ${drawing ? 'is-drawing' : ''}`}>
    <path d="M22 13 L13 26" pathLength={1} stroke={BARK} strokeWidth={1.6} className="analyze-glyph-branch" />
    <path d="M26 13 L35 26" pathLength={1} stroke={BARK} strokeWidth={1.6} className="analyze-glyph-branch" />
    <text x="24" y="11" textAnchor="middle" className="serif" fontWeight="700" fontSize="12" fill="#fff">S</text>
    <text x="12" y="35" textAnchor="middle" className="serif" fontWeight="700" fontSize="11" fill="#fff">NP</text>
    <text x="36" y="35" textAnchor="middle" className="serif" fontWeight="700" fontSize="11" fill="#fff">VP</text>
    <path d="M6 42 H18 M30 42 H42" stroke={MINT} strokeWidth="2" className="analyze-glyph-words" />
  </svg>
);

export default AnalyzeGlyph;
