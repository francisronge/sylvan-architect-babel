/** Contract-level warnings: properties of what a model authored, or of what
 * Babel recognized in it, that a careful reviewer notices in Replay but that are
 * not Replay construction defects. Each checker returns findings
 * `{ rule, subtype, subject, frame, detail }` for tests/helpers/findings.mjs;
 * `frame` is a 1-based Replay step or 'record' for a fact about the record. */
import { planItemRelationRefs } from '../../replay/relations/renderPlan.ts';
import { resolveSavedInputTokens } from '../../server/babelParser/surfaceTokens.js';
import { vanishedAnchors } from './replayStepInvariants.mjs';

const warning = (rule, subtype, subject, frame, detail) => ({ rule, subtype, subject, frame, detail });
const relationKey = (stageIndex, relationIndex) => `${stageIndex}:${relationIndex}`;
const nodesOf = forest => {
  const out = [];
  const visit = node => { if (!node || typeof node !== 'object') return; out.push(node); (node.children ?? []).forEach(visit); };
  (forest ?? []).forEach(visit);
  return out;
};

/** A persistent mark the plan compiler stopped drawing because its anchor is
 * absent from a later stage, where that stage authors a new occurrence of the
 * same lineage: the model renamed an occurrence (v1 to v2) instead of keeping
 * its id, so the mark cannot follow it. One warning per renamed anchor. */
export function checkRenamedAnchors(replay, record) {
  const stages = record.derivationStages ?? [], out = [], vanished = vanishedAnchors(replay.relationRenderPlan);
  for (const stageIndex of new Set(vanished.map(entry => entry.frameIndex))) {
    const before = nodesOf(stages[stageIndex - 1]?.workspaceForest), after = nodesOf(stages[stageIndex]?.workspaceForest);
    const earlier = new Set(before.map(node => node.id)), here = vanished.filter(entry => entry.frameIndex === stageIndex);
    for (const id of new Set(here.flatMap(entry => entry.ids))) {
      const lineage = before.find(node => node.id === id)?.lineageId;
      const successors = lineage ? after.filter(node => node.lineageId === lineage && !earlier.has(node.id)).map(node => node.id) : [];
      if (!successors.length) continue;
      const owners = [...new Set(here.filter(entry => entry.ids.includes(id)).map(entry => entry.relation))];
      out.push(warning('contract-output', 'renamed-anchor', `${stageIndex + 1}:${id}`, 'record', `stage ${stageIndex + 1} replaces ${id} `
        + `(lineage ${lineage}) with ${successors.join(', ')}; the marks of ${owners.join(', ')} end there`));
    }
  }
  return out;
}

const IGNORED = /[\p{White_Space}\u200B\p{P}]/gu;
const significant = text => String(text ?? '').normalize('NFC').replace(IGNORED, '').toLocaleLowerCase();
const unpunctuated = text => String(text ?? '').normalize('NFC').replace(/\p{P}/gu, '').toLocaleLowerCase();

/** Under the character spell-out contract a realization group exists to claim
 * text that the remaining pronounced terminals cannot spell. A group whose
 * covered terminals' own words, in tree order, already spell its text claims
 * nothing when it joins words the writing separates (its text crosses a space
 * of the sentence) or a whole unspaced sentence, as the Thai whole-sentence
 * group did. A group
 * inside one written word (a noun and its case particle, a verb and its tense)
 * keeps that word whole in Babel's word list, which spell-out otherwise cuts
 * wherever an analysis divides a word, so it is not reported. Under the earlier
 * indexed-token contract a group is the only way several terminals share one
 * tokenizer word, so no group is reported there. */
export function checkSelfSpelledRealizations(record, { contract } = {}) {
  if (!String(contract ?? '').startsWith('character-spellout')) return [];
  const tokens = resolveSavedInputTokens(record.sentence ?? '', record.inputTokens), out = [], seen = new Set();
  const written = unpunctuated(record.sentence);
  (record.derivationStages ?? []).forEach((stage, stageIndex) => {
    const order = new Map(), pronounced = [];
    const visit = (node, silent) => {
      if (!node || typeof node !== 'object') return;
      const quiet = silent || node.silent === true;
      order.set(node.id, pronounced.length);
      const children = node.children ?? [];
      if (!children.length && !quiet && String(node.word ?? '').trim()) pronounced.push(node);
      children.forEach(child => visit(child, quiet));
      node.__end = pronounced.length;
    };
    const forest = structuredClone(stage.workspaceForest ?? []);
    forest.forEach(root => visit(root, false));
    const spans = new Map(nodesOf(forest).map(node => [node.id, [order.get(node.id), node.__end]]));
    for (const group of stage.realizations ?? []) {
      const text = Array.isArray(group.tokenIndices) ? group.tokenIndices.map(index => tokens[index] ?? '').join('') : group.text;
      const covered = [...new Set((group.nodeIds ?? []).flatMap(id => {
        const [start, end] = spans.get(id) ?? [0, 0];
        return pronounced.slice(start, end);
      }))].sort((left, right) => pronounced.indexOf(left) - pronounced.indexOf(right));
      const key = JSON.stringify([group.nodeIds, text]);
      const joinsWords = !written.includes(unpunctuated(text))
        || covered.length > 1 && significant(text) === significant(record.sentence);
      if (!joinsWords || seen.has(key) || significant(covered.map(node => node.word).join('')) !== significant(text)) continue;
      seen.add(key);
      out.push(warning('contract-output', 'self-spelled-realization', `${stageIndex + 1}:${covered.map(node => node.id).join(',')}`, 'record',
        `stage ${stageIndex + 1} groups ${covered.map(node => node.id).join(', ')} `
        + `as "${text}", which their own words already spell`));
    }
  });
  return out;
}

const SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Hangul', 'Thai', 'Lao', 'Khmer', 'Myanmar', 'Arabic', 'Hebrew', 'Syriac', 'Thaana',
  'Cyrillic', 'Greek', 'Armenian', 'Georgian', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu',
  'Kannada', 'Malayalam', 'Sinhala', 'Tibetan', 'Mongolian', 'Ethiopic', 'Cherokee', 'Tifinagh']
  .map(name => ({ name, pattern: new RegExp(`\\p{Script=${name}}`, 'u') }));
const scriptOf = character => SCRIPTS.find(script => script.pattern.test(character))?.name;

/* Letters in canonical decomposition without combining marks: Hangul syllables
 * become jamo, and vowel points, shadda and similar marks drop. */
const lettersOf = text => [...String(text).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()];
/* A run cites a word's lexeme when the word begins with more than half of the
 * run's letters: an inflected or vocalized word keeps its stem's beginning. */
const citesLexeme = (run, word) => {
  const cited = lettersOf(run), written = lettersOf(word);
  let shared = 0;
  while (shared < cited.length && cited[shared] === written[shared]) shared += 1;
  return shared * 2 > cited.length;
};

/** Relation names, anchor and value role names and node labels are Babel's
 * metalanguage. One that writes words in a non-Latin script the sentence uses,
 * other than the sentence's own words (quoted or cited), means the analysis
 * was written in the object language. A terminal's label may also cite its own
 * word's lexeme (말하- on 말했다, إنّ on إنَّ). A lone Greek letter (φ, θ) is
 * ordinary metalanguage notation. One warning per record, with counts per field. */
export function checkObjectLanguageMetalanguage(record) {
  const sentence = String(record.sentence ?? '').normalize('NFC').toLocaleLowerCase();
  const scripts = new Set([...sentence].map(scriptOf).filter(Boolean));
  if (!scripts.size) return [];
  const runs = new RegExp(`(?:${[...scripts].map(name => `\\p{Script=${name}}`).join('|')})(?:[\\p{M}]|${[...scripts].map(name => `\\p{Script=${name}}`).join('|')})*`, 'gu');
  const offending = (name, word) => (String(name ?? '').normalize('NFC').match(runs) ?? [])
    .filter(run => !(run.length === 1 && scriptOf(run) === 'Greek') && !sentence.includes(run.toLocaleLowerCase())
      && !(word && citesLexeme(run, word)));
  const found = { relation: new Set(), role: new Set(), label: new Set() };
  for (const stage of record.derivationStages ?? []) {
    for (const relation of stage.relations ?? []) {
      if (offending(relation?.relation).length) found.relation.add(relation.relation);
      for (const field of [relation?.anchors, relation?.priorAnchors, relation?.values])
        for (const role of Object.keys(field && typeof field === 'object' ? field : {})) if (offending(role).length) found.role.add(role);
    }
    for (const node of nodesOf(stage.workspaceForest)) if (offending(node.label, node.word).length) found.label.add(node.label);
  }
  const total = found.relation.size + found.role.size + found.label.size;
  if (!total) return [];
  const examples = [...found.relation, ...found.role, ...found.label].slice(0, 4).map(name => `"${name}"`).join(', ');
  return [warning('contract-output', 'object-language-metalanguage', [...scripts].join('/'), 'record', `${found.relation.size} relation names, ${found.role.size} role names and `
    + `${found.label.size} labels are written in ${[...scripts].join('/')} script, e.g. ${examples}`)];
}

const MOVEMENT_CODE = /^(MOVEMENT_[A-Z_]+)/;

/** Every occurrence of one stage's forest, with its parent and whether it
 * pronounces any word under the silence it inherits. */
const occurrencesOf = forest => {
  const out = new Map();
  const visit = (node, parent, silent) => {
    if (!node || typeof node !== 'object') return false;
    const quiet = silent || node.silent === true, children = node.children ?? [];
    const entry = { node, parent: parent?.id ?? null, ancestors: parent ? [parent.id, ...out.get(parent.id).ancestors] : [] };
    out.set(node.id, entry);
    const voiced = children.map(child => visit(child, node, quiet));
    entry.pronounced = children.length ? voiced.some(Boolean) : !quiet && Boolean(String(node.word ?? '').trim());
    return entry.pronounced;
  };
  (forest ?? []).forEach(root => visit(root, null, false));
  return out;
};

/** The displacements a stage's syntax shows, read from structure alone: a
 * lineage's pronounced earlier occurrence falls silent, or leaves a new silent
 * occurrence in its slot, while an occurrence of that lineage is pronounced in
 * a new position. Each is `{ landing, lower }`: the pronounced new position
 * and the earlier occurrences and silent copies it displaces. A landing inside
 * another displaced landing travels with it and is not listed. */
export function structuralDisplacements(previousForest, currentForest) {
  const before = occurrencesOf(previousForest), after = occurrencesOf(currentForest), found = [];
  const silentCopiesAt = (lineageId, parent) => [...after].filter(([id, copy]) => !before.has(id)
    && copy.node.lineageId === lineageId && !copy.pronounced && copy.parent === parent).map(([id]) => id);
  for (const [id, entry] of after) {
    const lineageId = entry.node.lineageId, prior = before.get(id);
    if (!lineageId || !entry.pronounced) continue;
    const lower = prior
      ? prior.pronounced && prior.parent !== entry.parent ? silentCopiesAt(lineageId, prior.parent) : []
      : [...before].filter(([, earlier]) => earlier.node.lineageId === lineageId && earlier.pronounced).flatMap(([priorId, earlier]) => {
        if (after.has(priorId)) return after.get(priorId).pronounced ? [] : [priorId];
        const copies = silentCopiesAt(lineageId, earlier.parent);
        return copies.length ? [priorId, ...copies] : [];
      });
    if (lower.length) found.push({ landing: id, lower });
  }
  return found.filter(({ landing }) => !after.get(landing).ancestors.some(ancestor => found.some(other => other.landing === ancestor)));
}

/** Movement Babel recognized, or tried to recognize, but drew without an
 * arrow: a relation moment whose own movement recognition emitted a MOVEMENT_*
 * diagnostic, or whose own link proved a movement transition, while no plan
 * item of that relation draws a movement path (a trajectory or a covert
 * raising path) in any frame. A moment with only MOVEMENT_NOT_ESTABLISHED is
 * the model denying the movement and is not reported. A displacement the
 * stage's syntax shows (`structuralDisplacements`) whose landing no movement
 * path of the stage reaches is reported as COPY_WITHOUT_PATH at the moment of
 * the stage's first relation naming both its landing and a displaced
 * occurrence, whatever that relation is called: its recognition, not its
 * name, decides whether Replay draws the arrow. */
export function checkMovementUnrendered(replay, record) {
  const plan = replay.relationRenderPlan, out = [], stages = record.derivationStages ?? [];
  const paths = (plan?.frames ?? []).flatMap(frame => frame.items)
    .filter(item => item.kind === 'trajectory' || item.kind === 'quantifier-raising');
  const drawn = new Set(paths.flatMap(item => planItemRelationRefs(item).map(ref => relationKey(ref.stageIndex, ref.relationIndex))));
  const reached = new Set(paths.map(item => `${item.relationRef.stageIndex}:${item.kind === 'trajectory' ? item.targetNodeId : item.lfNodeId}`));
  const momentOf = new Map();
  replay.playbackSteps.forEach((step, index) => {
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
    if (identity && !momentOf.has(relationKey(identity.stageIndex, identity.relationIndex)))
      momentOf.set(relationKey(identity.stageIndex, identity.relationIndex), index);
  });
  const nameOf = (stageIndex, relationIndex, step) => stages[stageIndex]?.relations?.[relationIndex]?.relation ?? step.operation;
  for (const [key, index] of momentOf) {
    if (drawn.has(key)) continue;
    const step = replay.playbackSteps[index], { stageIndex, relationIndex } = step.replayRelationIdentity;
    const codes = [...new Set((step.movementDiagnostics ?? []).map(text => MOVEMENT_CODE.exec(String(text))?.[1]).filter(Boolean))]
      .filter(code => code !== 'MOVEMENT_NOT_ESTABLISHED');
    const proven = (step.replayRelationLinks ?? []).some(link => link.authoredRelationKey === key && link.movementTransition === true);
    if (!codes.length && !proven) continue;
    out.push(warning('movement-unrendered', codes[0] ?? 'MOVEMENT_TRANSITION_WITHOUT_PATH', key, index + 1,
      `relation ${key} "${nameOf(stageIndex, relationIndex, step)}" draws no movement path: ${codes.length ? codes.join(', ') : 'its movement transition is proven'}`));
  }
  const reported = new Set(out.map(found => found.subject));
  stages.forEach((stage, stageIndex) => {
    if (!stageIndex) return;
    for (const { landing, lower } of structuralDisplacements(stages[stageIndex - 1].workspaceForest, stage.workspaceForest)) {
      if (reached.has(`${stageIndex}:${landing}`)) continue;
      const named = (stage.relations ?? []).map(relation => new Set([...Object.values(relation?.anchors ?? {}),
        ...Object.values(relation?.priorAnchors ?? {})].flat().map(String)));
      // A claim about this landing already reported for its own movement
      // recognition stands for the displacement.
      if (named.some((ids, index) => ids.has(landing) && reported.has(relationKey(stageIndex, index)))) continue;
      const relationIndex = named.findIndex(ids => ids.has(landing) && lower.some(id => ids.has(id)));
      const key = relationKey(stageIndex, relationIndex);
      if (relationIndex < 0 || reported.has(key) || !momentOf.has(key)) continue;
      reported.add(key);
      const step = replay.playbackSteps[momentOf.get(key)];
      out.push(warning('movement-unrendered', 'COPY_WITHOUT_PATH', key, momentOf.get(key) + 1,
        `relation ${key} "${nameOf(stageIndex, relationIndex, step)}" names the displacement of ${lower.join(', ')} to ${landing}, `
        + 'which no movement path of the stage reaches'));
    }
  });
  return out.sort((left, right) => left.frame - right.frame);
}

/** Every contract-level warning of one prepared record. `contract` is the input
 * contract the record was authored under, when known. */
export const checkContractWarnings = (replay, record, { contract } = {}) => [...checkRenamedAnchors(replay, record),
  ...checkSelfSpelledRealizations(record, { contract }), ...checkObjectLanguageMetalanguage(record), ...checkMovementUnrendered(replay, record)];
