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

/** Relation names, anchor and value role names and node labels are Babel's
 * metalanguage. One that writes words in a non-Latin script the sentence uses,
 * other than the sentence's own words (quoted or cited), means the analysis
 * was written in the object language. A lone Greek letter (φ, θ) is ordinary
 * metalanguage notation. One warning per record, with counts per field. */
export function checkObjectLanguageMetalanguage(record) {
  const sentence = String(record.sentence ?? '').normalize('NFC').toLocaleLowerCase();
  const scripts = new Set([...sentence].map(scriptOf).filter(Boolean));
  if (!scripts.size) return [];
  const runs = new RegExp(`(?:${[...scripts].map(name => `\\p{Script=${name}}`).join('|')})(?:[\\p{M}]|${[...scripts].map(name => `\\p{Script=${name}}`).join('|')})*`, 'gu');
  const offending = name => (String(name ?? '').normalize('NFC').match(runs) ?? [])
    .filter(run => !(run.length === 1 && scriptOf(run) === 'Greek') && !sentence.includes(run.toLocaleLowerCase()));
  const found = { relation: new Set(), role: new Set(), label: new Set() };
  for (const stage of record.derivationStages ?? []) {
    for (const relation of stage.relations ?? []) {
      if (offending(relation?.relation).length) found.relation.add(relation.relation);
      for (const field of [relation?.anchors, relation?.priorAnchors, relation?.values])
        for (const role of Object.keys(field && typeof field === 'object' ? field : {})) if (offending(role).length) found.role.add(role);
    }
    for (const node of nodesOf(stage.workspaceForest)) if (offending(node.label).length) found.label.add(node.label);
  }
  const total = found.relation.size + found.role.size + found.label.size;
  if (!total) return [];
  const examples = [...found.relation, ...found.role, ...found.label].slice(0, 4).map(name => `"${name}"`).join(', ');
  return [warning('contract-output', 'object-language-metalanguage', [...scripts].join('/'), 'record', `${found.relation.size} relation names, ${found.role.size} role names and `
    + `${found.label.size} labels are written in ${[...scripts].join('/')} script, e.g. ${examples}`)];
}

const MOVEMENT_CODE = /^(MOVEMENT_[A-Z_]+)/;
/** Movement Babel recognized, or tried to recognize, but drew without an
 * arrow: a relation moment whose own movement recognition emitted a MOVEMENT_*
 * diagnostic, or whose own link proved a movement transition, while no plan
 * item of that relation draws a movement path (a trajectory or a covert
 * raising path) in any frame. The warning names the diagnostic codes; a moment
 * with only MOVEMENT_NOT_ESTABLISHED is the model denying the movement and is
 * not reported. */
export function checkMovementUnrendered(replay, record) {
  const plan = replay.relationRenderPlan, out = [];
  const drawn = new Set((plan?.frames ?? []).flatMap(frame => frame.items)
    .filter(item => item.kind === 'trajectory' || item.kind === 'quantifier-raising')
    .flatMap(item => planItemRelationRefs(item).map(ref => relationKey(ref.stageIndex, ref.relationIndex))));
  const seen = new Set();
  replay.playbackSteps.forEach((step, index) => {
    if (step.replayKind !== 'relation' || !step.replayRelationIdentity) return;
    const { stageIndex, relationIndex } = step.replayRelationIdentity, key = relationKey(stageIndex, relationIndex);
    if (seen.has(key) || drawn.has(key)) return;
    seen.add(key);
    const codes = [...new Set((step.movementDiagnostics ?? []).map(text => MOVEMENT_CODE.exec(String(text))?.[1]).filter(Boolean))]
      .filter(code => code !== 'MOVEMENT_NOT_ESTABLISHED');
    const proven = (step.replayRelationLinks ?? []).some(link => link.authoredRelationKey === key && link.movementTransition === true);
    if (!codes.length && !proven) return;
    const name = record.derivationStages?.[stageIndex]?.relations?.[relationIndex]?.relation ?? step.operation;
    out.push(warning('movement-unrendered', codes[0] ?? 'MOVEMENT_TRANSITION_WITHOUT_PATH', key, index + 1,
      `relation ${key} "${name}" draws no movement path: ${codes.length ? codes.join(', ') : 'its movement transition is proven'}`));
  });
  return out;
}

/** Every contract-level warning of one prepared record. `contract` is the input
 * contract the record was authored under, when known. */
export const checkContractWarnings = (replay, record, { contract } = {}) => [...checkRenamedAnchors(replay, record),
  ...checkSelfSpelledRealizations(record, { contract }), ...checkObjectLanguageMetalanguage(record), ...checkMovementUnrendered(replay, record)];
