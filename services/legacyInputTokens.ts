import type { ParseResult } from '../types';
import { finalForestForAnalysis } from '../replay/finalForest.ts';
import { collectPronouncedTerminalSequence } from '../replay/pronouncedTerminals.ts';

/**
 * Records saved before Babel kept the tokens it sent recover them from their
 * own final words, which validation matched to those tokens, rather than by
 * segmenting the sentence with this browser's Unicode data. Each token keeps the
 * sentence's spelling, so sentence-initial capitals survive. Analyses with
 * realization groups, or words that cannot be found in order, return undefined
 * and keep the legacy fallback.
 */
export const recoverLegacyInputTokens = (analysis: ParseResult | null | undefined, sentence: string): string[] | undefined => {
  if (!analysis || !sentence.trim()) return undefined;
  if (analysis.derivationStages?.some(stage => stage.realizations?.length)) return undefined;
  const words = collectPronouncedTerminalSequence(finalForestForAnalysis(analysis));
  if (!words.length) return undefined;
  const text = sentence.normalize('NFC');
  const tokens: string[] = [];
  let at = 0;
  for (const word of words.map(item => item.normalize('NFC'))) {
    const target = word.toLocaleLowerCase();
    let found = -1;
    for (let start = at; start + word.length <= text.length; start++) {
      if (text.slice(start, start + word.length).toLocaleLowerCase() === target) { found = start; break; }
    }
    if (found < 0) return undefined;
    tokens.push(text.slice(found, found + word.length));
    at = found + word.length;
  }
  return tokens;
};
