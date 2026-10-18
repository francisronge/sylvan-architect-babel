import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { authoredWord } from '../server/babelParser/nodePronunciation.js';
import { normalizeSurfaceToken } from '../server/babelParser/surfaceTokens.js';

/*
 * Experimental contract variant for the input-segmentation comparison
 * (docs/research/input-segmentation.md). The model receives only the sentence
 * and decides where words are. Babel checks that the final stage spells the
 * sentence, then turns the model's own words into the token list, so the
 * unchanged parser, Replay and review process the result. Qualification only:
 * no product route uses this variant.
 */
export const SPELLOUT_CONTRACT_VERSION = 'character-spellout-v2';

const REPLACEMENTS = [
  ['Its optional fields are word, tokenIndex, silent, and lineageId:', 'Its optional fields are word, silent, and lineageId:'],
  ['- tokenIndex is the zero-based integer index of the input token pronounced by this terminal at this stage. Its word matches that token. Assign each index to at most one pronounced terminal per stage. Unpronounced or not-yet-realized items have no tokenIndex.\n', ''],
  [' Missing tokenIndex alone does not mean silence.', ''],
  ['The supplied input-token boundaries are for reference; they do not prescribe syntactic or morpheme boundaries.\nOmit realizations when ordinary whole-word terminals already express the stage\'s input associations. Use it when the analysis retains syntax whose collective realization differs from one terminal per input token.',
    'The writing of the sentence, including its spacing, does not prescribe word, syntactic or morpheme boundaries.\nOmit realizations when each word of the sentence is pronounced by one ordinary terminal whose word is exactly that text. Use it when the analysis retains syntax whose collective realization differs from one terminal per word.'],
  ['- tokenIndices: a nonempty, duplicate-free array of zero-based positions in the supplied input-token list, in input order. The positions need not be adjacent.',
    '- text: a nonblank string, the exact contiguous stretch of the input sentence that these objects collectively realize, made of whole words as the final stage spells them.'],
  ['A group says that these existing syntax objects collectively correspond to these exact input tokens. Groups have disjoint tokenIndices: put all contributors to the same token in one group.',
    'A group says that these existing syntax objects collectively correspond to this exact written text. Groups realize disjoint stretches of the sentence: put all contributors to the same stretch in one group.'],
  ['Keep the authored tree and lexical forms. A grouped leaf may keep tokenIndex only if its own word independently matches that whole input token and the token belongs to a group covering it; this redundant index does not count the token twice.',
    'Keep the authored tree and lexical forms.'],
  ['In the final stage, ordinary pronounced terminals and explicit realization groups together account for every supplied input token exactly once. Without groups, the pronounced terminals in tree order match the supplied input tokens. With groups, set aside their covered lexical leaves and claimed input positions; the remaining pronounced terminals in tree order match the remaining input tokens, retaining their original indices.',
    'In the final stage, ordinary pronounced terminals and explicit realization groups together spell out the input sentence exactly once, in order, ignoring letter case, whitespace and punctuation. Reading the pronounced terminals in tree order, an ordinary terminal spells its word, and a group spells its text at its first covered terminal; its other covered terminals spell nothing further. You decide where words begin and end; Babel checks the spelling character by character.']
];

/** Babel's system instruction with every input-token passage replaced. Each
 * passage must still occur exactly once, so a contract edit forces review. */
export const buildSpelloutSystemInstruction = (framework) => REPLACEMENTS.reduce((text, [from, to]) => {
  if (text.split(from).length !== 2) throw new Error(`Spell-out variant no longer matches the system instruction: ${from.slice(0, 60)}`);
  return text.replace(from, to);
}, buildSystemInstruction(framework, 'gpt'));

export const buildSpelloutContentsPrompt = (sentence) => `Sentence: ${JSON.stringify(sentence)}`;

// U+200B separates Khmer and Burmese words but is not Unicode White_Space.
const SPACE = /[\p{White_Space}​]/u;
const IGNORED = /[\p{White_Space}​\p{P}]/u;
const codePoints = (text) => [...String(text).normalize('NFC')];
const significant = (text) => codePoints(text).filter(character => !IGNORED.test(character));
const sameCharacter = (a, b) => a === b || a.toLowerCase() === b.toLowerCase();
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failure = (rule, detail) => ({ rule, detail });

/** Expands refIds as the parser does: from the latest earlier expanded definition. */
const expandStages = (stages) => {
  const definitions = new Map();
  return stages.map((stage, stageIndex) => {
    const expand = (node) => {
      if (isPlainObject(node) && Object.keys(node).length === 1 && typeof node.refId === 'string') {
        if (!definitions.has(node.refId)) throw new Error(`Stage ${stageIndex + 1} refId ${node.refId} has no earlier definition.`);
        return definitions.get(node.refId);
      }
      if (!isPlainObject(node)) throw new Error(`Stage ${stageIndex + 1} contains a malformed node.`);
      return { ...node, children: Array.isArray(node.children) ? node.children.map(expand) : [] };
    };
    const forest = (Array.isArray(stage?.workspaceForest) ? stage.workspaceForest : []).map(expand);
    const record = (node) => { if (typeof node.id === 'string') definitions.set(node.id, node); node.children.forEach(record); };
    forest.forEach(record);
    return forest;
  });
};

/** Leaves in tree order with inherited silence, and each node's pronounced leaves. */
const readForest = (forest) => {
  const leaves = [], pronouncedUnder = new Map();
  const visit = (node, inheritedSilence) => {
    const silent = inheritedSilence || node.silent === true;
    const start = leaves.length;
    if (!node.children.length) leaves.push({ node, silent });
    else node.children.forEach(child => visit(child, silent));
    if (typeof node.id === 'string') {
      pronouncedUnder.set(node.id, leaves.slice(start).filter(leaf => !leaf.silent).map(leaf => leaf.node));
    }
  };
  forest.forEach(root => visit(root, false));
  return { leaves, pronouncedUnder };
};

/** The variant's own field rules; the parser checks everything else after conversion. */
const variantShapeDiagnostics = (stages) => {
  const diagnostics = [];
  const visit = (node, path) => {
    if (!isPlainObject(node)) return;
    if (Object.hasOwn(node, 'tokenIndex')) diagnostics.push(failure('SPELLOUT_TOKEN_INDEX', `${path} has tokenIndex, which this contract does not define.`));
    (Array.isArray(node.children) ? node.children : []).forEach((child, index) => visit(child, `${path}.children[${index}]`));
  };
  stages.forEach((stage, stageIndex) => {
    const path = `derivationStages[${stageIndex}]`;
    (Array.isArray(stage?.workspaceForest) ? stage.workspaceForest : []).forEach((root, index) => visit(root, `${path}.workspaceForest[${index}]`));
    if (!Object.hasOwn(stage || {}, 'realizations')) return;
    if (!Array.isArray(stage.realizations)) {
      diagnostics.push(failure('SPELLOUT_GROUP_SHAPE', `${path}.realizations is not an array.`));
      return;
    }
    stage.realizations.forEach((group, index) => {
      const valid = isPlainObject(group) && Object.keys(group).length === 2 && Array.isArray(group.nodeIds)
        && typeof group.text === 'string' && group.text.trim();
      if (!valid) diagnostics.push(failure('SPELLOUT_GROUP_SHAPE', `${path}.realizations[${index}] needs exactly nodeIds and nonblank text.`));
    });
  });
  return diagnostics;
};

/** Code-point offsets where the sentence's grapheme clusters begin or end. */
const graphemeBoundaries = (text) => {
  const boundaries = new Set([0]);
  let offset = 0;
  for (const { segment } of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)) {
    offset += [...segment].length;
    boundaries.add(offset);
  }
  return boundaries;
};

/**
 * Reads the final stage's pronounced terminals in tree order and aligns their
 * spelling to the sentence, left to right. Each unit becomes one input token,
 * spelled as in the sentence.
 */
const alignFinalStage = (forest, groups, sentence) => {
  const { leaves, pronouncedUnder } = readForest(forest);
  const groupLeaves = groups.map(group => new Set(group.nodeIds.flatMap(id => pronouncedUnder.get(id) || [])));
  const units = [], placed = new Set(), diagnostics = [];
  for (const { node, silent } of leaves) {
    if (silent) continue;
    const covering = groups.map((_, index) => index).filter(index => groupLeaves[index].has(node));
    if (covering.length) {
      covering.filter(index => !placed.has(index)).forEach(index => {
        placed.add(index);
        units.push({ text: groups[index].text.trim(), group: index });
      });
    } else if (authoredWord(node)) units.push({ text: authoredWord(node), nodeId: node.id });
  }
  groups.forEach((_, index) => {
    if (!placed.has(index)) diagnostics.push(failure('SPELLOUT_GROUP_UNPLACED', `Final-stage group ${index} covers no pronounced terminal.`));
  });
  const text = sentence.normalize('NFC');
  const chars = codePoints(text);
  const graphemes = graphemeBoundaries(text);
  const observations = [];
  let position = 0;
  const skip = (pattern) => { while (position < chars.length && pattern.test(chars[position])) position += 1; };
  for (const unit of units) {
    const wanted = significant(unit.text);
    // A word made only of punctuation spells that punctuation literally.
    const literal = wanted.length === 0;
    const target = literal ? codePoints(unit.text) : wanted;
    skip(literal ? SPACE : IGNORED);
    const start = position;
    let matched = 0;
    while (matched < target.length && position < chars.length) {
      if (!literal && IGNORED.test(chars[position])) { position += 1; continue; }
      if (!sameCharacter(chars[position], target[matched])) break;
      position += 1; matched += 1;
    }
    if (matched < target.length) {
      diagnostics.push(failure('SPELLOUT_MISMATCH', `"${unit.text}" does not spell the sentence at "${chars.slice(start, start + target.length + 2).join('')}".`));
      return { units, diagnostics, observations };
    }
    unit.token = chars.slice(start, position).join('');
    unit.span = [start, position];
    if ([...unit.token].some(character => SPACE.test(character))) observations.push({ rule: 'SPELLOUT_SPAN_CROSSES_WHITESPACE', token: unit.token });
    if (!literal && [...unit.token].some(character => IGNORED.test(character) && !SPACE.test(character))) {
      observations.push({ rule: 'SPELLOUT_SPAN_CONTAINS_PUNCTUATION', token: unit.token });
    }
    if (!graphemes.has(start) || !graphemes.has(position)) observations.push({ rule: 'SPELLOUT_SPAN_SPLITS_GRAPHEME', token: unit.token, span: unit.span });
  }
  skip(IGNORED);
  if (position < chars.length) diagnostics.push(failure('SPELLOUT_INCOMPLETE', `The final stage leaves "${chars.slice(position).join('')}" unspelled.`));
  return { units, diagnostics, observations };
};

/** Final positions of the pronounced leaves under a group's nodes in its own stage. */
const groupPositions = (group, forest, positionByLeafId) => {
  const { pronouncedUnder } = readForest(forest);
  return new Set(group.nodeIds.flatMap(id => (pronouncedUnder.get(id) || [])
    .flatMap(leaf => [...(positionByLeafId.get(leaf.id) || [])])));
};

/** Earlier-stage groups usually name whole final words; find the one run of them they cover. */
const resolveEarlierGroup = (group, forest, tokens, positionByLeafId) => {
  const wanted = significant(group.text).join('').toLowerCase();
  const runs = [];
  for (let first = 0; first < tokens.length; first += 1) {
    let spelled = '';
    for (let last = first; last < tokens.length && spelled.length < wanted.length; last += 1) {
      spelled += significant(tokens[last]).join('').toLowerCase();
      if (spelled === wanted) runs.push([first, last]);
    }
  }
  if (runs.length > 1) {
    const positions = groupPositions(group, forest, positionByLeafId);
    const owned = runs.filter(([first, last]) => [...positions].some(index => index >= first && index <= last));
    if (owned.length) return owned;
  }
  return runs;
};

/** Spans where text spells the sentence, matched as final words are. */
const occurrences = (chars, text) => {
  const wanted = significant(text), spans = [];
  for (let start = 0; wanted.length && start < chars.length; start += 1) {
    if (IGNORED.test(chars[start])) continue;
    let position = start, matched = 0;
    while (matched < wanted.length && position < chars.length) {
      if (IGNORED.test(chars[position])) { position += 1; continue; }
      if (!sameCharacter(chars[position], wanted[matched])) break;
      position += 1; matched += 1;
    }
    if (matched === wanted.length) spans.push([start, position]);
  }
  return spans;
};

/**
 * The sentence span an earlier-stage group realizes. A group that matches no
 * run of whole final words may name part of a word that grows later (吃完
 * before 吃完了); it resolves to its one occurrence inside the final words its
 * own nodes pronounce.
 */
const locateEarlierGroup = (group, forest, units, positionByLeafId, chars) => {
  const runs = resolveEarlierGroup(group, forest, units.map(unit => unit.token), positionByLeafId);
  if (runs.length === 1) return { span: [units[runs[0][0]].span[0], units[runs[0][1]].span[1]] };
  if (runs.length > 1) return { matches: runs.length };
  const positions = [...groupPositions(group, forest, positionByLeafId)];
  if (!positions.length) return { matches: 0 };
  const low = Math.min(...positions.map(index => units[index].span[0]));
  const high = Math.max(...positions.map(index => units[index].span[1]));
  const boundaries = graphemeBoundaries(chars.join(''));
  const inside = occurrences(chars, group.text)
    .filter(([start, end]) => start >= low && end <= high && boundaries.has(start) && boundaries.has(end));
  return inside.length === 1 ? { span: inside[0] } : { matches: inside.length };
};

/** Checks one analysis's spelling and locates every group it authors in the sentence. */
const alignAnalysis = (analysis, sentence) => {
  const stages = Array.isArray(analysis?.derivationStages) ? analysis.derivationStages : [];
  if (!stages.length) return { diagnostics: [failure('SPELLOUT_NO_STAGES', 'The analysis has no derivation stages.')] };
  const shape = variantShapeDiagnostics(stages);
  if (shape.length) return { diagnostics: shape };
  const forests = expandStages(stages);
  const finalGroups = stages.at(-1).realizations || [];
  const { units, diagnostics, observations } = alignFinalStage(forests.at(-1), finalGroups, sentence);
  if (diagnostics.length) return { diagnostics, observations, units };
  const { pronouncedUnder } = readForest(forests.at(-1));
  const positionByLeafId = new Map();
  const assign = (id, index) => positionByLeafId.set(id, new Set([...(positionByLeafId.get(id) || []), index]));
  units.forEach((unit, index) => {
    if (unit.group === undefined) assign(unit.nodeId, index);
    else finalGroups[unit.group].nodeIds.forEach(id => (pronouncedUnder.get(id) || []).forEach(leaf => assign(leaf.id, index)));
  });
  const chars = codePoints(sentence.normalize('NFC'));
  const earlier = [];
  stages.slice(0, -1).forEach((stage, stageIndex) => (Array.isArray(stage.realizations) ? stage.realizations : []).forEach((group, groupIndex) => {
    const located = locateEarlierGroup(group, forests[stageIndex], units, positionByLeafId, chars);
    if (located.span) earlier.push({ stageIndex, groupIndex, span: located.span });
    else diagnostics.push(failure('SPELLOUT_GROUP_UNRESOLVED',
      `Stage ${stageIndex + 1} group ${groupIndex} text "${group.text}" matches ${located.matches} places in the final words.`));
  }));
  return { diagnostics, observations, units, earlier, stages, finalGroups };
};

/**
 * One word list for every analysis: the sentence is cut wherever any analysis
 * starts or ends a final word or an earlier group. A word that another
 * analysis or an earlier stage divides then covers several tokens.
 */
const segmentSentence = (aligned, sentence) => {
  const chars = codePoints(sentence.normalize('NFC'));
  const spans = aligned.flatMap(item => [...item.units.map(unit => unit.span), ...item.earlier.map(group => group.span)]);
  const cuts = [...new Set(spans.flat())].sort((a, b) => a - b);
  const literal = new Set(aligned.flatMap(item => item.units
    .filter(unit => !significant(unit.text).length).map(unit => unit.span.join(':'))));
  const tokens = [];
  cuts.slice(0, -1).forEach((cut, index) => {
    let start = cut, end = cuts[index + 1];
    if (!aligned.some(item => item.units.some(unit => unit.span[0] <= start && end <= unit.span[1]))) return;
    if (!literal.has(`${start}:${end}`)) {
      while (start < end && IGNORED.test(chars[start])) start += 1;
      while (end > start && IGNORED.test(chars[end - 1])) end -= 1;
      if (start === end) return;
    }
    tokens.push({ span: [start, end], text: chars.slice(start, end).join('') });
  });
  return tokens;
};

/** One aligned analysis in Babel's current contract over the shared word list. */
const convertAligned = (item, tokens) => {
  const within = ([start, end]) => tokens.flatMap((token, index) => (token.span[0] >= start && token.span[1] <= end ? [index] : []));
  const uncovered = tokens.filter(token => !item.units.some(unit => unit.span[0] <= token.span[0] && token.span[1] <= unit.span[1]));
  if (uncovered.length) {
    return { diagnostics: uncovered.map(token => failure('SPELLOUT_SEGMENTATION_CONFLICT',
      `"${token.text}" is a word in another analysis but this analysis does not spell it.`)), observations: item.observations };
  }
  const units = item.units.map(unit => ({ ...unit, tokenIndices: within(unit.span) }));
  // The parser compares an ordinary word with its single token after removing
  // edge punctuation and case. A word that spells its token with other inner
  // marks (don't for don’t), or covers several tokens, is recorded as a
  // single-leaf group instead.
  const spellingGroups = units.flatMap(unit => (unit.group === undefined && (unit.tokenIndices.length !== 1
    || normalizeSurfaceToken(unit.text) !== normalizeSurfaceToken(tokens[unit.tokenIndices[0]].text))
    ? [{ nodeIds: [unit.nodeId], tokenIndices: unit.tokenIndices }] : []));
  const earlierSpans = new Map(item.earlier.map(group => [`${group.stageIndex}:${group.groupIndex}`, group.span]));
  const groupUnits = new Map(units.flatMap(unit => (unit.group === undefined ? [] : [[unit.group, unit]])));
  const last = item.stages.length - 1;
  const derivationStages = item.stages.map((stage, stageIndex) => {
    const final = stageIndex === last;
    if (!Array.isArray(stage.realizations) && !(final && spellingGroups.length)) return stage;
    const realizations = (stage.realizations || []).map((group, groupIndex) => ({ nodeIds: group.nodeIds,
      tokenIndices: final ? groupUnits.get(groupIndex).tokenIndices : within(earlierSpans.get(`${stageIndex}:${groupIndex}`)) }));
    return { ...stage, realizations: final ? [...realizations, ...spellingGroups] : realizations };
  });
  return {
    diagnostics: [], observations: item.observations,
    units: units.map(({ text, token, span, tokenIndices, group, nodeId }) => ({ text, token, span, tokenIndices, ...(group === undefined ? { nodeId } : { group }) })),
    spellingGroups, inputTokens: tokens.map(token => token.text), analysis: { ...item.analysis, derivationStages }
  };
};

/**
 * Checks each analysis of a spell-out response and converts the passing ones
 * into Babel's current contract over one shared word list. Results keep the
 * authored analysis index.
 */
export const convertSpelloutPayload = (payload, sentence) => {
  const analyses = Array.isArray(payload?.analyses) && payload.analyses.length ? payload.analyses : [payload];
  const aligned = analyses.map((analysis, analysisIndex) => {
    try {
      return { analysisIndex, analysis, ...alignAnalysis(analysis, sentence) };
    } catch (error) {
      return { analysisIndex, diagnostics: [failure('SPELLOUT_UNREADABLE', String(error.message))] };
    }
  });
  const passing = aligned.filter(item => !item.diagnostics.length);
  const tokens = segmentSentence(passing, sentence);
  return aligned.map((item) => {
    const result = item.diagnostics.length
      ? { diagnostics: item.diagnostics, observations: item.observations, units: item.units }
      : convertAligned(item, tokens);
    return { analysisIndex: item.analysisIndex, ok: result.diagnostics.length === 0, ...result };
  });
};

/**
 * One ordinary qualification attempt holds every analysis that passed, over
 * their shared word list; each analysis that failed the check is recorded on
 * its own.
 */
export const planSpelloutAttempts = (payload, results) => {
  const passing = results.filter(result => result.ok);
  const attempts = passing.length ? [{
    id: 'parse',
    inputTokens: passing[0].inputTokens,
    analysisIndices: passing.map(result => result.analysisIndex),
    payload: Array.isArray(payload?.analyses) ? { ...payload, analyses: passing.map(result => result.analysis) } : passing[0].analysis
  }] : [];
  const failures = results.filter(result => !result.ok).map(result => ({
    id: `parse-analysis-${result.analysisIndex + 1}-spellout`, analysisIndex: result.analysisIndex, diagnostics: result.diagnostics
  }));
  return { attempts, failures };
};
