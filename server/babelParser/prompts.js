/** The request names only the sentence; the model decides where its words are. */
export const buildParseContentsPrompt = (sentence) => `Sentence: ${JSON.stringify(sentence)}`;
