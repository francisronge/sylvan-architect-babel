import { authoredWord } from './nodePronunciation.js';
import { normalizeSurfaceToken } from './surfaceTokens.js';
import { expandPartsListAnalysis } from './partsList.js';

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
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failure = (rule, detail) => ({ rule, detail });

/** Thrown when a workspace cannot be read; the parser reports structure in detail. */
class SpelloutStructureError extends Error {}

/** Thrown when a response needs more search work than MAX_SEARCH_WORK. */
class SpelloutWorkLimitError extends Error {}

// Bounds on what the spelling check reads of one analysis: expanded nodes, tree
// depth, and final words and groups. They also keep its recursion shallow. Real
// analyses stay far below them: a stage has hundreds of nodes, not thousands.
const MAX_STAGE_NODES = 5_000;
const MAX_ANALYSIS_NODES = 50_000;
const MAX_DEPTH = 256;
const MAX_READING_UNITS = 1_000;
// Spelling-check steps one response may take. Saved responses take at most
// about 1,700; the reviewed hostile responses reach the limit in tens of
// milliseconds of spelling-check time.
const MAX_SEARCH_WORK = 1_000_000;

/**
 * Counts the spelling check's steps for one response: each expanded node and
 * each search step (alignment states, character comparisons, scans for runs
 * and occurrences, choice counting, and the leaves and positions a group
 * reads). The check's other loops are linear in the authored analysis, its
 * expanded nodes, the sentence, or work already charged. The meter bounds only
 * the spelling check, not the parsing that follows it.
 */
const workMeter = () => {
  let used = 0;
  return {
    charge(steps = 1) {
      used += steps;
      if (used > MAX_SEARCH_WORK) throw new SpelloutWorkLimitError();
    }
  };
};

/**
 * Expands refIds as the parser does: from the latest earlier expanded
 * definition. An occurrence id may appear once per expanded workspace, so a
 * stage that references a subtree twice stops at the repeat instead of
 * copying it. A stage that references earlier subtrees still expands to more
 * nodes than it authors; each node is charged to the meter before it is copied,
 * and the node bounds cap one analysis.
 */
const expandStages = (stages, meter) => {
  const definitions = new Map();
  let total = 0;
  return stages.map((stage, stageIndex) => {
    const seen = new Set();
    const where = `Stage ${stageIndex + 1}`;
    let count = 0;
    const claim = (id, depth) => {
      meter.charge();
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

/**
 * Reads an expanded stage once: its leaves in tree order with inherited
 * silence, and each node's leaves as a range [start, end) of that list. A
 * node's pronounced leaves are the non-silent leaves in its range.
 */
const readForest = (forest) => {
  const leaves = [], ranges = new Map();
  const visit = (node, inheritedSilence) => {
    const silent = inheritedSilence || node.silent === true;
    const start = leaves.length;
    if (!node.children.length) leaves.push({ node, silent });
    else node.children.forEach(child => visit(child, silent));
    if (typeof node.id === 'string') ranges.set(node.id, [start, leaves.length]);
  };
  forest.forEach(root => visit(root, false));
  return { leaves, ranges };
};

/** Visits the pronounced leaves under a node of a read stage, with their leaf indices. */
const eachPronounced = ({ leaves, ranges }, id, meter, visit) => {
  const range = ranges.get(id);
  if (!range) return;
  meter.charge(range[1] - range[0]);
  for (let index = range[0]; index < range[1]; index += 1) {
    if (!leaves[index].silent) visit(leaves[index].node, index);
  }
};

/** Spell-out's own field rules; the parser checks everything else after conversion. */
const spelloutShapeDiagnostics = (stages) => {
  const diagnostics = [];
  const visit = (node, path, depth) => {
    // Expansion reports deeper nesting; stopping here keeps this walk shallow.
    if (!isPlainObject(node) || depth > MAX_DEPTH) return;
    if (Object.hasOwn(node, 'tokenIndex')) diagnostics.push(failure('SPELLOUT_TOKEN_INDEX', `${path} has tokenIndex, which this contract does not define.`));
    (Array.isArray(node.children) ? node.children : []).forEach((child, index) => visit(child, `${path}.children[${index}]`, depth + 1));
  };
  stages.forEach((stage, stageIndex) => {
    const path = `derivationStages[${stageIndex}]`;
    (Array.isArray(stage?.workspaceForest) ? stage.workspaceForest : []).forEach((root, index) => visit(root, `${path}.workspaceForest[${index}]`, 0));
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

/**
 * A code point's caseless form, so a word matches the sentence whatever its
 * letter case. Upper- then lowercasing applies the full case mappings that one
 * lowering misses (ß and ẞ are ss, final ς is σ, ſ is s, ﬁ is fi); İ is i, as
 * Turkish lowers it, and the combining dot above that default lowering writes
 * after i (i̇) is part of that i, so i̇ is i too; dotless ı stays its own
 * letter. Forms are decomposed
 * (NFD), so a precomposed letter and its uppercase spelled with a combining
 * mark agree. A form may be longer than one code point; matching reads it
 * whole, so a sentence character is never split. Only case is ignored: accents
 * and other character variants still count, and punctuation is classified
 * before folding.
 */
const foldCharacter = (character, previous) => {
  if (character === 'İ') return 'i';
  if (character === 'ı') return character;
  if (character === '\u0307' && previous === 'i') return '';
  return character.toUpperCase().toLowerCase().replace(/ß/gu, 'ss').normalize('NFD');
};
const foldCharacters = (characters) => characters.map((character, index) => foldCharacter(character, characters[index - 1]));
const foldText = (characters) => foldCharacters(characters).join('');

/** What the spelling check compares of a text: its caseless characters, without spacing or punctuation. */
export const caselessSpelling = (text) => foldText(significant(text));

/** The sentence's code points with their caseless forms and character classes, read once per response. */
const readSentence = (sentence) => {
  const text = sentence.normalize('NFC');
  const chars = codePoints(text);
  return {
    chars,
    fold: foldCharacters(chars),
    ignored: chars.map(character => IGNORED.test(character)),
    space: chars.map(character => SPACE.test(character)),
    boundaries: graphemeBoundaries(text)
  };
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

/** What a word or piece must match in the sentence, prepared once per text. */
const spellingOf = (text) => {
  const wanted = significant(text);
  // A word made only of punctuation spells that punctuation literally.
  const literal = wanted.length === 0;
  const target = literal ? codePoints(text) : wanted;
  return { literal, target, folded: literal ? '' : foldText(target), ...edgePunctuation(text) };
};

/**
 * Reads a spelling from position. A literal spelling matches code point for
 * code point; any other skips punctuation and whitespace and matches caseless
 * forms, each sentence character whole. Returns where reading stopped.
 */
const readSpelling = ({ chars, fold, ignored }, position, { literal, target, folded }) => {
  if (literal) {
    let matched = 0;
    while (matched < target.length && position < chars.length && chars[position] === target[matched]) {
      position += 1; matched += 1;
    }
    return { position, complete: matched === target.length };
  }
  let offset = 0;
  while (offset < folded.length && position < chars.length) {
    if (ignored[position]) { position += 1; continue; }
    if (!folded.startsWith(fold[position], offset)) break;
    offset += fold[position].length; position += 1;
  }
  // A mark that folds to nothing belongs to the character the spelling ended on.
  while (offset === folded.length && position < chars.length && fold[position] === '') position += 1;
  return { position, complete: offset === folded.length };
};

/**
 * Spells a word or piece at position, after any separators, as final words
 * are matched. Punctuation that the word itself writes at its edges (’s, etc.)
 * joins its span when the sentence has punctuation there.
 */
const spellAt = (sentence, position, spelling, meter) => {
  const { chars, ignored, space } = sentence;
  const { literal, target } = spelling;
  const from = position;
  const separator = literal ? space : ignored;
  while (position < chars.length && separator[position]) position += 1;
  let start = position;
  const read = readSpelling(sentence, position, spelling);
  position = read.position;
  const { complete } = read;
  if (complete && !literal) {
    const mark = index => ignored[index] && !space[index];
    let { lead, trail } = spelling;
    while (lead > 0 && start > from && mark(start - 1)) { start -= 1; lead -= 1; }
    while (trail > 0 && position < chars.length && mark(position)) { position += 1; trail -= 1; }
  }
  meter.charge(1 + position - from);
  return { start, end: position, complete, length: target.length };
};

/**
 * Aligns the final stage's spelling to the sentence. Each group's text claims
 * its own stretches, its pieces in sentence order; the remaining pronounced
 * terminals, in tree order, spell the rest from left to right. Babel takes the
 * first alignment found when each group is tried where its first covered
 * terminal is read, so an alignment that reads straight through the tree is
 * always kept, and repeated text resolves through the tree.
 */
const alignFinalStage = (reading, groups, sentence, meter) => {
  const { leaves } = reading;
  const groupPieces = groups.map(group => textPieces(group.text));
  // The groups that pronounce each leaf, in group order.
  const covering = leaves.map(() => []);
  groups.forEach((group, index) => group.nodeIds.forEach(id => eachPronounced(reading, id, meter, (_, leaf) => {
    if (covering[leaf].at(-1) !== index) covering[leaf].push(index);
  })));
  const words = [], preferred = [], placed = new Set(), diagnostics = [];
  leaves.forEach(({ node, silent }, leaf) => {
    if (silent) return;
    if (covering[leaf].length) {
      covering[leaf].filter(index => !placed.has(index)).forEach(index => {
        placed.add(index);
        groupPieces[index].forEach((_, piece) => preferred.push({ group: index, piece }));
      });
    } else if (authoredWord(node)) {
      preferred.push({ word: words.length });
      words.push({ text: authoredWord(node), nodeId: node.id });
    }
  });
  groups.forEach((_, index) => {
    if (!placed.has(index)) diagnostics.push(failure('SPELLOUT_GROUP_UNPLACED', `Final-stage group ${index} covers no pronounced terminal.`));
  });
  if (diagnostics.length) return { units: [], diagnostics, observations: [] };
  if (preferred.length > MAX_READING_UNITS) {
    return { units: [], diagnostics: [failure('SPELLOUT_ALIGNMENT_LIMIT', `The final stage has more than ${MAX_READING_UNITS} words and groups to align.`)], observations: [] };
  }
  const { chars, ignored } = sentence;
  const textOf = item => (item.word === undefined ? groupPieces[item.group][item.piece] : words[item.word].text);
  const wordSpellings = words.map(word => spellingOf(word.text));
  const pieceSpellings = groupPieces.map(pieces => pieces.map(piece => spellingOf(piece)));
  const spellingFor = item => (item.word === undefined ? pieceSpellings[item.group][item.piece] : wordSpellings[item.word]);
  // Each word's and piece's place when the tree is read straight through.
  const wordOrder = [], pieceOrder = groups.map(() => []);
  preferred.forEach((item, order) => {
    if (item.word === undefined) pieceOrder[item.group][item.piece] = order;
    else wordOrder[item.word] = order;
  });
  // A reading takes the next word (WORD) or the next piece of a group (its index).
  const WORD = -1;
  const next = groups.map(() => 0), trail = [], failed = new Set();
  let word = 0, read = 0;
  const unread = kind => (kind === WORD ? word < words.length : next[kind] < groupPieces[kind].length);
  // The unread reading that comes first in the tree.
  const pending = () => {
    let kind = WORD, order = unread(WORD) ? wordOrder[word] : Infinity;
    next.forEach((piece, group) => {
      if (unread(group) && pieceOrder[group][piece] < order) { kind = group; order = pieceOrder[group][piece]; }
    });
    return kind;
  };
  const finished = (position) => {
    while (position < chars.length && ignored[position]) position += 1;
    return position === chars.length;
  };
  const attempt = (kind, position) => {
    const item = kind === WORD ? { word } : { group: kind, piece: next[kind] };
    const spelled = spellAt(sentence, position, spellingFor(item), meter);
    if (!spelled.complete) return false;
    if (kind === WORD) word += 1; else next[kind] += 1;
    read += 1;
    trail.push({ item, span: [spelled.start, spelled.end] });
    if (search(spelled.end)) return true;
    trail.pop();
    read -= 1;
    if (kind === WORD) word -= 1; else next[kind] -= 1;
    return false;
  };
  // Tries the pending reading, then the next word, then each group's next piece.
  const search = (position) => {
    if (read === preferred.length) return finished(position);
    meter.charge(1 + groups.length);
    const key = `${position}|${word}|${next.join(',')}`;
    if (failed.has(key)) return false;
    const first = pending();
    if (attempt(first, position)) return true;
    if (first !== WORD && unread(WORD) && attempt(WORD, position)) return true;
    for (let group = 0; group < groups.length; group += 1) {
      if (group !== first && unread(group) && attempt(group, position)) return true;
    }
    failed.add(key);
    return false;
  };
  if (!search(0)) {
    // Report where reading straight through the tree stops matching.
    let position = 0;
    for (const item of preferred) {
      const spelled = spellAt(sentence, position, spellingFor(item), meter);
      if (!spelled.complete) {
        diagnostics.push(failure('SPELLOUT_MISMATCH',
          `"${textOf(item)}" does not spell the sentence at "${chars.slice(spelled.start, spelled.start + spelled.length + 2).join('')}".`));
        return { units: [], diagnostics, observations: [] };
      }
      position = spelled.end;
    }
    while (position < chars.length && ignored[position]) position += 1;
    diagnostics.push(position < chars.length
      ? failure('SPELLOUT_INCOMPLETE', `The final stage leaves "${chars.slice(position).join('')}" unspelled.`)
      : failure('SPELLOUT_MISMATCH', 'The groups and the remaining words cannot spell the sentence in order.'));
    return { units: [], diagnostics, observations: [] };
  }
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
    if (!sentence.boundaries.has(start) || !sentence.boundaries.has(end)) {
      observations.push({ rule: 'SPELLOUT_SPAN_SPLITS_GRAPHEME', token: unit.token, span: unit.span });
    }
    return unit;
  });
  return { units, diagnostics, observations };
};

/** Runs of whole final words that spell text; tokens holds each word's caseless significant spelling. */
const wholeWordRuns = (text, tokens, meter) => {
  const wanted = foldText(significant(text));
  const runs = [];
  for (let first = 0; first < tokens.length; first += 1) {
    let spelled = '';
    for (let last = first; last < tokens.length && spelled.length < wanted.length; last += 1) {
      meter.charge(1 + tokens[last].length);
      spelled += tokens[last];
      if (spelled === wanted) runs.push([first, last]);
    }
  }
  return runs;
};

/** Spans where a spelling occurs in the sentence, matched as final words are. */
const occurrences = (sentence, spelling, meter) => {
  const { chars, ignored } = sentence;
  const spans = [];
  for (let start = 0; !spelling.literal && start < chars.length; start += 1) {
    if (ignored[start]) continue;
    const { position, complete } = readSpelling(sentence, start, spelling);
    meter.charge(1 + position - start);
    if (complete) spans.push([start, position]);
  }
  return spans;
};

/**
 * The sentence spans an earlier-stage group realizes, one per piece. A piece
 * usually names whole final words; repeated text resolves through the final
 * words the group's own nodes pronounce. A piece that matches no run of whole
 * final words they pronounce may name part of a word that grows later (吃完
 * before 吃完了); it resolves to its occurrence inside those final words, even
 * when the same text is also a whole word elsewhere.
 */
const locateEarlierGroup = (group, reading, final, sentence, meter) => {
  const { units, tokens, positionByLeafId } = final;
  const pieces = textPieces(group.text);
  // Each piece needs its own stretch of the sentence, after the previous piece's.
  if (pieces.length > sentence.chars.length) return { matches: 0 };
  const positions = new Set();
  group.nodeIds.forEach(id => eachPronounced(reading, id, meter, leaf => (positionByLeafId.get(leaf.id) || []).forEach((index) => {
    meter.charge();
    positions.add(index);
  })));
  let low = Infinity, high = -Infinity;
  positions.forEach((index) => {
    low = Math.min(low, units[index].span[0]);
    high = Math.max(high, units[index].span[1]);
  });
  const owns = ([first, last]) => {
    for (let index = first; index <= last; index += 1) {
      meter.charge();
      if (positions.has(index)) return true;
    }
    return false;
  };
  const candidates = pieces.map((piece) => {
    const runs = wholeWordRuns(piece, tokens, meter);
    const owned = runs.filter(owns);
    const toSpans = list => list.map(([first, last]) => [units[first].span[0], units[last].span[1]]);
    if (owned.length || !positions.size) return toSpans(owned.length ? owned : runs);
    const inside = occurrences(sentence, spellingOf(piece), meter)
      .filter(([start, end]) => start >= low && end <= high && sentence.boundaries.has(start) && sentence.boundaries.has(end));
    // Whole words the group's nodes do not pronounce remain its spelling only when nothing they pronounce spells it.
    return inside.length ? inside : toSpans(runs);
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
        meter.charge();
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
const alignAnalysis = (analysis, sentence, meter) => {
  const stages = Array.isArray(analysis?.derivationStages) ? analysis.derivationStages : [];
  if (!stages.length) return { diagnostics: [failure('SPELLOUT_NO_STAGES', 'The analysis has no derivation stages.')] };
  const malformed = stages.findIndex(stage => !isPlainObject(stage));
  if (malformed >= 0) return { diagnostics: [failure('SPELLOUT_UNREADABLE', `Stage ${malformed + 1} is not an object.`)] };
  const shape = spelloutShapeDiagnostics(stages);
  if (shape.length) return { diagnostics: shape };
  const readings = expandStages(stages, meter).map(readForest);
  const finalReading = readings.at(-1);
  const finalGroups = stages.at(-1).realizations || [];
  const { units, diagnostics, observations } = alignFinalStage(finalReading, finalGroups, sentence, meter);
  if (diagnostics.length) return { diagnostics, observations, units };
  const earlierGroups = stages.slice(0, -1).flatMap((stage, stageIndex) => (Array.isArray(stage.realizations) ? stage.realizations : [])
    .map((group, groupIndex) => ({ group, stageIndex, groupIndex })));
  const earlier = [];
  if (earlierGroups.length) {
    // Each final leaf's positions among the final words; earlier groups resolve through them.
    const positionByLeafId = new Map();
    const assign = (id, index) => {
      meter.charge();
      if (!positionByLeafId.has(id)) positionByLeafId.set(id, new Set());
      positionByLeafId.get(id).add(index);
    };
    units.forEach((unit, index) => {
      if (unit.group === undefined) assign(unit.nodeId, index);
      else finalGroups[unit.group].nodeIds.forEach(id => eachPronounced(finalReading, id, meter, leaf => assign(leaf.id, index)));
    });
    const final = { units, positionByLeafId, tokens: units.map(unit => foldText(significant(unit.token))) };
    earlierGroups.forEach(({ group, stageIndex, groupIndex }) => {
      const located = locateEarlierGroup(group, readings[stageIndex], final, sentence, meter);
      if (located.spans) earlier.push({ stageIndex, groupIndex, spans: located.spans });
      else diagnostics.push(failure('SPELLOUT_GROUP_UNRESOLVED',
        `Stage ${stageIndex + 1} group ${groupIndex} text ${JSON.stringify(group.text)} matches ${located.matches ? 'more than one place' : 'no place'} in the final words.`));
    });
  }
  return { diagnostics, observations, units, earlier, stages, finalGroups };
};

/**
 * One word list for every analysis: the sentence is cut wherever any analysis
 * starts or ends a final word or an earlier group. A word that another
 * analysis or an earlier stage divides then covers several tokens.
 */
const segmentSentence = (aligned, { chars, ignored }) => {
  const spans = aligned.flatMap(item => [...item.units.map(unit => unit.span), ...item.earlier.flatMap(group => group.spans)]);
  const cuts = [...new Set(spans.flat())].sort((a, b) => a - b);
  const literal = new Set(aligned.flatMap(item => item.units
    .filter(unit => !significant(unit.text).length).map(unit => unit.span.join(':'))));
  // A word's own edges keep its punctuation; other cuts drop separators.
  const edges = new Set(aligned.flatMap(item => item.units.flatMap(unit => unit.span)));
  // Every final word's edges are cuts, so the stretch between two consecutive
  // cuts lies inside a word or outside every word; open counts the words around it.
  const cutIndex = new Map(cuts.map((cut, index) => [cut, index]));
  const opening = cuts.map(() => 0);
  aligned.forEach(item => item.units.forEach(({ span: [start, end] }) => {
    opening[cutIndex.get(start)] += 1;
    opening[cutIndex.get(end)] -= 1;
  }));
  const tokens = [];
  let open = 0;
  cuts.slice(0, -1).forEach((cut, index) => {
    open += opening[index];
    if (!open) return;
    let start = cut, end = cuts[index + 1];
    if (!literal.has(`${start}:${end}`)) {
      if (!edges.has(start)) while (start < end && ignored[start]) start += 1;
      if (!edges.has(end)) while (end > start && ignored[end - 1]) end -= 1;
      if (!significant(chars.slice(start, end).join('')).length) return;
    }
    tokens.push({ span: [start, end], text: chars.slice(start, end).join('') });
  });
  return tokens;
};

/** The first index below length at which a test that stays true once true holds, or length. */
const firstIndex = (length, holds) => {
  let low = 0, high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (holds(middle)) high = middle; else low = middle + 1;
  }
  return low;
};

/** One aligned analysis in Babel's current contract over the shared word list. */
const convertAligned = (item, tokens) => {
  // Tokens and this analysis's words are nonempty, disjoint and in sentence
  // order: the tokens inside a span are one consecutive run, and a token lies
  // inside a word only if it lies inside the last word starting at or before it.
  const within = ([start, end]) => {
    const first = firstIndex(tokens.length, index => tokens[index].span[0] >= start);
    const after = firstIndex(tokens.length, index => tokens[index].span[1] > end);
    return Array.from({ length: Math.max(0, after - first) }, (_, offset) => first + offset);
  };
  const covered = ({ span: [start, end] }) => {
    const unit = item.units[firstIndex(item.units.length, index => item.units[index].span[0] > start) - 1];
    return Boolean(unit) && end <= unit.span[1];
  };
  // Each analysis decides whether punctuation is a word: one that leaves out
  // punctuation another analysis writes does not claim that token. Spelling
  // covers every other character, so any other uncovered token is a defect.
  const uncovered = tokens.filter(token => !covered(token));
  const conflicts = uncovered.filter(token => significant(token.text).length);
  if (conflicts.length) {
    return { diagnostics: conflicts.map(token => failure('SPELLOUT_SEGMENTATION_CONFLICT',
      `"${token.text}" is a word in another analysis but this analysis does not spell it.`)), observations: item.observations };
  }
  const units = item.units.map(unit => ({ ...unit, tokenIndices: within(unit.span) }));
  // The parser compares an ordinary word with its single token after removing
  // edge punctuation and case. A word that spells its token with other inner
  // marks (don't for don’t), or covers several tokens, is recorded as a
  // single-leaf group instead. So is a punctuation word of an analysis that
  // leaves other punctuation unclaimed, because the parser could otherwise
  // place it on the unclaimed token.
  const spellingGroups = units.flatMap(unit => (unit.group === undefined && (unit.tokenIndices.length !== 1
    || normalizeSurfaceToken(unit.text) !== normalizeSurfaceToken(tokens[unit.tokenIndices[0]].text)
    || (uncovered.length && !normalizeSurfaceToken(unit.text)))
    ? [{ nodeIds: [unit.nodeId], tokenIndices: unit.tokenIndices }] : []));
  const earlierSpans = new Map(item.earlier.map(group => [`${group.stageIndex}:${group.groupIndex}`, group.spans]));
  const groupTokens = new Map();
  units.forEach((unit) => {
    if (unit.group === undefined) return;
    if (!groupTokens.has(unit.group)) groupTokens.set(unit.group, []);
    groupTokens.get(unit.group).push(...unit.tokenIndices);
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
  const reading = readSentence(sentence);
  // One meter covers the spelling check of every analysis in the response.
  const meter = workMeter();
  const aligned = analyses.map((authored, analysisIndex) => {
    // A parts-list analysis is read, and converted, in its expanded nested form.
    const expanded = expandPartsListAnalysis(authored);
    if (expanded.issue) return { analysisIndex, diagnostics: [failure('SPELLOUT_UNREADABLE', expanded.issue.message)] };
    const analysis = expanded.analysis;
    try {
      // Once the meter is spent, later analyses are not read at all.
      meter.charge();
      return { analysisIndex, analysis, ...alignAnalysis(analysis, reading, meter) };
    } catch (error) {
      if (error instanceof SpelloutWorkLimitError) {
        return { analysisIndex, diagnostics: [failure('SPELLOUT_ALIGNMENT_LIMIT', 'The response needs more work than the spelling check allows.')] };
      }
      // Any other exception is still a model output Babel cannot read, never a crash.
      const detail = error instanceof SpelloutStructureError ? error.message : 'The analysis could not be read for its spelling.';
      return { analysisIndex, diagnostics: [failure('SPELLOUT_UNREADABLE', detail)] };
    }
  });
  const passing = aligned.filter(item => !item.diagnostics.length);
  const tokens = segmentSentence(passing, reading);
  return aligned.map((item) => {
    const result = item.diagnostics.length
      ? { diagnostics: item.diagnostics, observations: item.observations, units: item.units }
      : convertAligned(item, tokens);
    return { analysisIndex: item.analysisIndex, ok: result.diagnostics.length === 0, ...result };
  });
};
