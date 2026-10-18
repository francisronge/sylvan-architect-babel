import { authoredWord } from './nodePronunciation.js';
import { normalizeSurfaceToken } from './surfaceTokens.js';

/*
 * Babel's input contract: the model receives only the sentence and decides
 * where words are. A realization group names the text it realizes. Babel
 * checks that each analysis's final stage spells the sentence, then converts
 * the analyses into token positions over one shared word list, so the parser,
 * Replay and saved records keep their token-based form. The functions are pure
 * and run in Node and the browser.
 */
export const SPELLOUT_CONTRACT_VERSION = 'character-spellout-v3';

// U+200B separates Khmer and Burmese words but is not Unicode White_Space.
const SPACE = /[\p{White_Space}​]/u;
const IGNORED = /[\p{White_Space}​\p{P}]/u;
const codePoints = (text) => [...String(text).normalize('NFC')];
const significant = (text) => codePoints(text).filter(character => !IGNORED.test(character));
const sameCharacter = (a, b) => a === b || a.toLowerCase() === b.toLowerCase();
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failure = (rule, detail) => ({ rule, detail });

/** Thrown when a workspace cannot be read; the parser reports structure in detail. */
class SpelloutStructureError extends Error {}

// Bounds that keep the check linear and its recursion shallow for any output.
// Real analyses stay far below them: a stage has hundreds of nodes, not thousands.
const MAX_STAGE_NODES = 5_000;
const MAX_ANALYSIS_NODES = 50_000;
const MAX_DEPTH = 256;
const MAX_READING_UNITS = 1_000;

/**
 * Expands refIds as the parser does: from the latest earlier expanded
 * definition. An occurrence id may appear once per expanded workspace, so a
 * stage that references a subtree twice stops at the repeat instead of
 * copying it, and expansion stays linear in the authored size.
 */
const expandStages = (stages) => {
  const definitions = new Map();
  let total = 0;
  return stages.map((stage, stageIndex) => {
    const seen = new Set();
    const where = `Stage ${stageIndex + 1}`;
    let count = 0;
    const claim = (id, depth) => {
      if (depth > MAX_DEPTH) throw new SpelloutStructureError(`${where} nests deeper than ${MAX_DEPTH} levels.`);
      if ((count += 1) > MAX_STAGE_NODES || (total += 1) > MAX_ANALYSIS_NODES) {
        throw new SpelloutStructureError(`${where} expands to more nodes than the spelling check reads.`);
      }
      if (typeof id !== 'string') return;
      if (seen.has(id)) throw new SpelloutStructureError(`${where} repeats occurrence id ${id}.`);
      seen.add(id);
    };
    const expandDefinition = (node, depth) => {
      claim(node.id, depth);
      return { ...node, children: node.children.map(child => expandDefinition(child, depth + 1)) };
    };
    const expand = (node, depth = 0) => {
      if (isPlainObject(node) && Object.keys(node).length === 1 && typeof node.refId === 'string') {
        if (!definitions.has(node.refId)) throw new SpelloutStructureError(`${where} refId ${node.refId} has no earlier definition.`);
        return expandDefinition(definitions.get(node.refId), depth);
      }
      if (!isPlainObject(node)) throw new SpelloutStructureError(`${where} contains a malformed node.`);
      claim(node.id, depth);
      return { ...node, children: Array.isArray(node.children) ? node.children.map(child => expand(child, depth + 1)) : [] };
    };
    const forest = (Array.isArray(stage?.workspaceForest) ? stage.workspaceForest : []).map(root => expand(root, 0));
    const record = (node) => { if (typeof node.id === 'string') definitions.set(node.id, node); node.children.forEach(record); };
    forest.forEach(record);
    (Array.isArray(stage?.realizations) ? stage.realizations : []).forEach((group, groupIndex) => group.nodeIds
      .filter(id => !seen.has(id))
      .forEach((id) => { throw new SpelloutStructureError(`${where} group ${groupIndex} names ${id}, which is not in its workspace.`); }));
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

/** Spell-out's own field rules; the parser checks everything else after conversion. */
const spelloutShapeDiagnostics = (stages) => {
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
      const text = group?.text;
      const validText = (typeof text === 'string' && text.trim()) || (Array.isArray(text) && text.length > 0
        && text.every(piece => typeof piece === 'string' && piece.trim()));
      const valid = isPlainObject(group) && Object.keys(group).length === 2 && Array.isArray(group.nodeIds)
        && group.nodeIds.every(id => typeof id === 'string' && id.trim()) && validText;
      if (!valid) diagnostics.push(failure('SPELLOUT_GROUP_SHAPE',
        `${path}.realizations[${index}] needs exactly nodeIds and text: a nonblank string or a nonempty array of nonblank strings.`));
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

/** A group's text as its pieces, in sentence order. */
const textPieces = (text) => (Array.isArray(text) ? text : [text]).map(piece => piece.trim());

/** Punctuation (not whitespace) at either edge of a word, as code-point counts. */
const edgePunctuation = (text) => {
  const points = codePoints(text.trim());
  const mark = character => IGNORED.test(character) && !SPACE.test(character);
  let lead = 0, trail = 0;
  while (lead < points.length && mark(points[lead])) lead += 1;
  while (trail < points.length - lead && mark(points[points.length - 1 - trail])) trail += 1;
  return { lead, trail };
};

/**
 * Spells text at position, after any separators, as final words are matched.
 * Punctuation that the word itself writes at its edges (’s, etc.) joins its
 * span when the sentence has punctuation there.
 */
const spellAt = (chars, position, text) => {
  const wanted = significant(text);
  // A word made only of punctuation spells that punctuation literally.
  const literal = wanted.length === 0;
  const target = literal ? codePoints(text) : wanted;
  const from = position;
  while (position < chars.length && (literal ? SPACE : IGNORED).test(chars[position])) position += 1;
  let start = position;
  let matched = 0;
  while (matched < target.length && position < chars.length) {
    if (!literal && IGNORED.test(chars[position])) { position += 1; continue; }
    if (!sameCharacter(chars[position], target[matched])) break;
    position += 1; matched += 1;
  }
  const complete = matched === target.length;
  if (complete && !literal) {
    const mark = character => IGNORED.test(character) && !SPACE.test(character);
    let { lead, trail } = edgePunctuation(text);
    while (lead > 0 && start > from && mark(chars[start - 1])) { start -= 1; lead -= 1; }
    while (trail > 0 && position < chars.length && mark(chars[position])) { position += 1; trail -= 1; }
  }
  return { start, end: position, complete, length: target.length };
};

const ALIGNMENT_STATE_LIMIT = 200_000;

/**
 * Aligns the final stage's spelling to the sentence. Each group's text claims
 * its own stretches, its pieces in sentence order; the remaining pronounced
 * terminals, in tree order, spell the rest from left to right. Babel takes the
 * first alignment found when each group is tried where its first covered
 * terminal is read, so an alignment that reads straight through the tree is
 * always kept, and repeated text resolves through the tree.
 */
const alignFinalStage = (forest, groups, sentence) => {
  const { leaves, pronouncedUnder } = readForest(forest);
  const groupLeaves = groups.map(group => new Set(group.nodeIds.flatMap(id => pronouncedUnder.get(id) || [])));
  const groupPieces = groups.map(group => textPieces(group.text));
  const words = [], preferred = [], placed = new Set(), diagnostics = [];
  for (const { node, silent } of leaves) {
    if (silent) continue;
    const covering = groups.map((_, index) => index).filter(index => groupLeaves[index].has(node));
    if (covering.length) {
      covering.filter(index => !placed.has(index)).forEach(index => {
        placed.add(index);
        groupPieces[index].forEach((_, piece) => preferred.push({ group: index, piece }));
      });
    } else if (authoredWord(node)) {
      preferred.push({ word: words.length });
      words.push({ text: authoredWord(node), nodeId: node.id });
    }
  }
  groups.forEach((_, index) => {
    if (!placed.has(index)) diagnostics.push(failure('SPELLOUT_GROUP_UNPLACED', `Final-stage group ${index} covers no pronounced terminal.`));
  });
  if (diagnostics.length) return { units: [], diagnostics, observations: [] };
  if (preferred.length > MAX_READING_UNITS) {
    return { units: [], diagnostics: [failure('SPELLOUT_ALIGNMENT_LIMIT', `The final stage has more than ${MAX_READING_UNITS} words and groups to align.`)], observations: [] };
  }
  const text = sentence.normalize('NFC');
  const chars = codePoints(text);
  const textOf = item => (item.word === undefined ? groupPieces[item.group][item.piece] : words[item.word].text);
  const next = groups.map(() => 0), trail = [], failed = new Set();
  let word = 0, explored = 0;
  const finished = (position) => {
    while (position < chars.length && IGNORED.test(chars[position])) position += 1;
    return position === chars.length;
  };
  const search = (position) => {
    if (word === words.length && next.every((piece, group) => piece === groupPieces[group].length)) return finished(position);
    const key = `${position}|${word}|${next.join(',')}`;
    if (failed.has(key) || (explored += 1) > ALIGNMENT_STATE_LIMIT) return false;
    const pending = preferred.find(item => (item.word === undefined ? next[item.group] <= item.piece : item.word >= word));
    const candidates = [pending, ...(word < words.length ? [{ word }] : []), ...groups.map((_, group) => ({ group, piece: next[group] }))
      .filter(item => item.piece < groupPieces[item.group].length)];
    const tried = new Set();
    for (const item of candidates) {
      const kind = item.word === undefined ? `group ${item.group}` : 'word';
      if (tried.has(kind)) continue;
      tried.add(kind);
      const spelled = spellAt(chars, position, textOf(item));
      if (!spelled.complete) continue;
      if (item.word === undefined) next[item.group] += 1; else word += 1;
      trail.push({ item, span: [spelled.start, spelled.end] });
      if (search(spelled.end)) return true;
      trail.pop();
      if (item.word === undefined) next[item.group] -= 1; else word -= 1;
    }
    failed.add(key);
    return false;
  };
  if (!search(0)) {
    if (explored > ALIGNMENT_STATE_LIMIT) {
      diagnostics.push(failure('SPELLOUT_ALIGNMENT_LIMIT', 'The final stage has too many possible alignments to check.'));
      return { units: [], diagnostics, observations: [] };
    }
    // Report where reading straight through the tree stops matching.
    let position = 0;
    for (const item of preferred) {
      const spelled = spellAt(chars, position, textOf(item));
      if (!spelled.complete) {
        diagnostics.push(failure('SPELLOUT_MISMATCH',
          `"${textOf(item)}" does not spell the sentence at "${chars.slice(spelled.start, spelled.start + spelled.length + 2).join('')}".`));
        return { units: [], diagnostics, observations: [] };
      }
      position = spelled.end;
    }
    while (position < chars.length && IGNORED.test(chars[position])) position += 1;
    diagnostics.push(position < chars.length
      ? failure('SPELLOUT_INCOMPLETE', `The final stage leaves "${chars.slice(position).join('')}" unspelled.`)
      : failure('SPELLOUT_MISMATCH', 'The groups and the remaining words cannot spell the sentence in order.'));
    return { units: [], diagnostics, observations: [] };
  }
  const graphemes = graphemeBoundaries(text);
  const observations = [];
  const units = trail.map(({ item, span: [start, end] }) => {
    const unit = item.word === undefined ? { text: textOf(item), group: item.group, piece: item.piece } : { ...words[item.word] };
    unit.token = chars.slice(start, end).join('');
    unit.span = [start, end];
    const literal = !significant(unit.text).length;
    if ([...unit.token].some(character => SPACE.test(character))) observations.push({ rule: 'SPELLOUT_SPAN_CROSSES_WHITESPACE', token: unit.token });
    if (!literal && [...unit.token].some(character => IGNORED.test(character) && !SPACE.test(character))) {
      observations.push({ rule: 'SPELLOUT_SPAN_CONTAINS_PUNCTUATION', token: unit.token });
    }
    if (!graphemes.has(start) || !graphemes.has(end)) observations.push({ rule: 'SPELLOUT_SPAN_SPLITS_GRAPHEME', token: unit.token, span: unit.span });
    return unit;
  });
  return { units, diagnostics, observations };
};

/** Final positions of the pronounced leaves under a group's nodes in its own stage. */
const groupPositions = (group, forest, positionByLeafId) => {
  const { pronouncedUnder } = readForest(forest);
  return new Set(group.nodeIds.flatMap(id => (pronouncedUnder.get(id) || [])
    .flatMap(leaf => [...(positionByLeafId.get(leaf.id) || [])])));
};

/** Runs of whole final words that spell text. */
const wholeWordRuns = (text, tokens) => {
  const wanted = significant(text).join('').toLowerCase();
  const runs = [];
  for (let first = 0; first < tokens.length; first += 1) {
    let spelled = '';
    for (let last = first; last < tokens.length && spelled.length < wanted.length; last += 1) {
      spelled += significant(tokens[last]).join('').toLowerCase();
      if (spelled === wanted) runs.push([first, last]);
    }
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
 * The sentence spans an earlier-stage group realizes, one per piece. A piece
 * usually names whole final words; repeated text resolves through the final
 * words the group's own nodes pronounce. A piece that matches no run of whole
 * final words may name part of a word that grows later (吃完 before 吃完了);
 * it resolves to its occurrence inside those final words.
 */
const locateEarlierGroup = (group, forest, units, positionByLeafId, chars, boundaries) => {
  const tokens = units.map(unit => unit.token);
  const positions = [...groupPositions(group, forest, positionByLeafId)];
  const low = Math.min(...positions.map(index => units[index].span[0]));
  const high = Math.max(...positions.map(index => units[index].span[1]));
  const candidates = textPieces(group.text).map((piece) => {
    const runs = wholeWordRuns(piece, tokens);
    const owned = runs.filter(([first, last]) => positions.some(index => index >= first && index <= last));
    const spans = (runs.length > 1 && owned.length ? owned : runs).map(([first, last]) => [units[first].span[0], units[last].span[1]]);
    if (spans.length || !positions.length) return spans;
    return occurrences(chars, piece).filter(([start, end]) => start >= low && end <= high && boundaries.has(start) && boundaries.has(end));
  });
  // Counts the in-order choices of one span per piece, capped at two, so the
  // search is polynomial however often a piece's text repeats.
  const counts = new Map();
  const count = (index, after) => {
    if (index === candidates.length) return 1;
    const key = `${index}:${after}`;
    if (!counts.has(key)) {
      let found = 0;
      for (const span of candidates[index]) {
        if (span[0] >= after && (found += count(index + 1, span[1])) > 1) break;
      }
      counts.set(key, Math.min(found, 2));
    }
    return counts.get(key);
  };
  const matches = count(0, 0);
  if (matches !== 1) return { matches };
  const spans = [];
  for (let index = 0, after = 0; index < candidates.length; index += 1) {
    const span = candidates[index].find(([start, end]) => start >= after && count(index + 1, end) === 1);
    spans.push(span);
    after = span[1];
  }
  return { spans };
};

/** Checks one analysis's spelling and locates every group it authors in the sentence. */
const alignAnalysis = (analysis, sentence) => {
  const stages = Array.isArray(analysis?.derivationStages) ? analysis.derivationStages : [];
  if (!stages.length) return { diagnostics: [failure('SPELLOUT_NO_STAGES', 'The analysis has no derivation stages.')] };
  const malformed = stages.findIndex(stage => !isPlainObject(stage));
  if (malformed >= 0) return { diagnostics: [failure('SPELLOUT_UNREADABLE', `Stage ${malformed + 1} is not an object.`)] };
  const shape = spelloutShapeDiagnostics(stages);
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
  const boundaries = graphemeBoundaries(chars.join(''));
  const earlier = [];
  stages.slice(0, -1).forEach((stage, stageIndex) => (Array.isArray(stage.realizations) ? stage.realizations : []).forEach((group, groupIndex) => {
    const located = locateEarlierGroup(group, forests[stageIndex], units, positionByLeafId, chars, boundaries);
    if (located.spans) earlier.push({ stageIndex, groupIndex, spans: located.spans });
    else diagnostics.push(failure('SPELLOUT_GROUP_UNRESOLVED',
      `Stage ${stageIndex + 1} group ${groupIndex} text ${JSON.stringify(group.text)} matches ${located.matches ? 'more than one place' : 'no place'} in the final words.`));
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
  const spans = aligned.flatMap(item => [...item.units.map(unit => unit.span), ...item.earlier.flatMap(group => group.spans)]);
  const cuts = [...new Set(spans.flat())].sort((a, b) => a - b);
  const literal = new Set(aligned.flatMap(item => item.units
    .filter(unit => !significant(unit.text).length).map(unit => unit.span.join(':'))));
  // A word's own edges keep its punctuation; other cuts drop separators.
  const edges = new Set(aligned.flatMap(item => item.units.flatMap(unit => unit.span)));
  const tokens = [];
  cuts.slice(0, -1).forEach((cut, index) => {
    let start = cut, end = cuts[index + 1];
    if (!aligned.some(item => item.units.some(unit => unit.span[0] <= start && end <= unit.span[1]))) return;
    if (!literal.has(`${start}:${end}`)) {
      if (!edges.has(start)) while (start < end && IGNORED.test(chars[start])) start += 1;
      if (!edges.has(end)) while (end > start && IGNORED.test(chars[end - 1])) end -= 1;
      if (!significant(chars.slice(start, end).join('')).length) return;
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
  const earlierSpans = new Map(item.earlier.map(group => [`${group.stageIndex}:${group.groupIndex}`, group.spans]));
  const groupTokens = new Map();
  units.forEach((unit) => {
    if (unit.group !== undefined) groupTokens.set(unit.group, [...(groupTokens.get(unit.group) || []), ...unit.tokenIndices]);
  });
  const last = item.stages.length - 1;
  const derivationStages = item.stages.map((stage, stageIndex) => {
    const final = stageIndex === last;
    if (!Array.isArray(stage.realizations) && !(final && spellingGroups.length)) return stage;
    const realizations = (stage.realizations || []).map((group, groupIndex) => ({ nodeIds: group.nodeIds,
      tokenIndices: final ? groupTokens.get(groupIndex) : earlierSpans.get(`${stageIndex}:${groupIndex}`).flatMap(within) }));
    return { ...stage, realizations: final ? [...realizations, ...spellingGroups] : realizations };
  });
  return {
    diagnostics: [], observations: item.observations,
    units: units.map(({ text, token, span, tokenIndices, group, piece, nodeId }) => ({
      text, token, span, tokenIndices, ...(group === undefined ? { nodeId } : { group, piece }) })),
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
      // Any other exception is still a model output Babel cannot read, never a crash.
      const detail = error instanceof SpelloutStructureError ? error.message : 'The analysis could not be read for its spelling.';
      return { analysisIndex, diagnostics: [failure('SPELLOUT_UNREADABLE', detail)] };
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
