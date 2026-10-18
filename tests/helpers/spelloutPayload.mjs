import { resolveSavedInputTokens } from '../../server/babelParser/surfaceTokens.js';

/**
 * Restates an older token-addressed model output as the spell-out contract a
 * live route now receives: terminals lose tokenIndex, and each realization
 * group names its text, with separate pieces for positions that are not
 * adjacent. Tokens default to the saved list or the sentence's tokenizer list.
 */
export const restateAsSpellout = (payload, sentence, tokens = resolveSavedInputTokens(sentence, undefined)) => {
  const text = sentence.normalize('NFC');
  let at = 0;
  const spans = tokens.map((token) => {
    const start = text.toLowerCase().indexOf(token.normalize('NFC').toLowerCase(), at);
    if (start < 0) throw new Error(`Token ${token} does not occur in ${sentence}.`);
    at = start + token.normalize('NFC').length;
    return [start, at];
  });
  const strip = (item) => {
    if (!item || typeof item !== 'object' || (Object.keys(item).length === 1 && 'refId' in item)) return item;
    const { tokenIndex: _tokenIndex, ...rest } = item;
    return Array.isArray(item.children) ? { ...rest, children: item.children.map(strip) } : rest;
  };
  const restateGroup = ({ nodeIds, tokenIndices }) => {
    const runs = tokenIndices.reduce((list, index) => {
      if (list.length && index === list.at(-1).at(-1) + 1) list.at(-1).push(index); else list.push([index]);
      return list;
    }, []);
    const pieces = runs.map(run => text.slice(spans[run[0]][0], spans[run.at(-1)][1]));
    return { nodeIds, text: pieces.length === 1 ? pieces[0] : pieces };
  };
  const restateAnalysis = analysis => ({
    ...analysis,
    derivationStages: analysis.derivationStages.map(stage => ({
      ...stage,
      workspaceForest: stage.workspaceForest.map(strip),
      ...(Array.isArray(stage.realizations) ? { realizations: stage.realizations.map(restateGroup) } : {})
    }))
  });
  return Array.isArray(payload.analyses)
    ? { ...payload, analyses: payload.analyses.map(restateAnalysis) }
    : restateAnalysis(payload);
};
