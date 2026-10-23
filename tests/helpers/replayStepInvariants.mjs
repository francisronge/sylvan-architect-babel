/** Step semantics and mark persistence: what each Replay step declares (its
 * panel's operation and target) against what its frame visibly changes, and
 * why each painted relation mark ends. Checkers take a prepared Replay
 * (`prepareReplay` with `includePlayback: true`) and its authored record, and
 * return findings `{ rule, subtype, subject, frame, detail }` for
 * tests/helpers/findings.mjs; the caller adds the record. Reveals, detached
 * syntax and new edges to a displayed parent belong to no-early-reveal,
 * stable-construction and attach-at-merge (replayInvariants.mjs), which these
 * rules do not repeat. */
import { momentRelationIdentities } from '../../replay/momentRelations.ts';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { indexHierarchyNodesByIdAndAliases } from '../../replay/replayCanvas.ts';
import {
  isPlanItemRevealed, planItemDependencyNodeIds, planItemRelationRefs, resolveDisplayedTrajectoryAttachments
} from '../../replay/relations/renderPlan.ts';
import { projectThetaGrid } from '../../replay/relations/thetaGridComposition.ts';
import { resolveSavedInputTokens } from '../../server/babelParser/surfaceTokens.js';
import { authoredIdentity, frameStructure, momentOwnership, momentVoices, pronunciationOwners } from './replayInvariants.mjs';

const finding = (rule, subtype, subject, frame, detail) => ({ rule, subtype, subject, frame, detail });
const EMPTY_FRAME = { nodes: new Map(), visible: new Set(), displayed: new Set(), parent: new Map(), children: new Map() };
const trimmed = value => typeof value === 'string' ? value.trim() : '';
const relationKey = (stageIndex, relationIndex) => `${stageIndex}:${relationIndex}`;
const refKey = ref => relationKey(ref.stageIndex, ref.relationIndex);
const anchorIds = anchors => anchors && typeof anchors === 'object' ? Object.values(anchors).flat().map(String) : [];

/** Authored ids each stage holds and the ids each of its relations names. */
function authoredStages(record) {
  return (record.derivationStages ?? []).map(stage => {
    const ids = new Set();
    const visit = node => { if (node?.id) ids.add(String(node.id)); (node?.children ?? []).forEach(visit); };
    (stage.workspaceForest ?? []).forEach(visit);
    return { ids, named: new Set((stage.relations ?? []).flatMap(relation => [...anchorIds(relation?.anchors), ...anchorIds(relation?.priorAnchors)])) };
  });
}

/** The authored node a displayed canvas node paints; a derived word leaf stands for its owner. */
const authoredOf = (structure, id) => {
  const identity = authoredIdentity(structure.nodes.get(id));
  return identity.derivedWordOf ?? identity.id;
};
/** The authored occurrence whose pronunciation a displayed node paints: a derived word leaf's owner, by its authored id. */
const occurrenceOf = (structure, id) => {
  const owner = authoredOf(structure, id);
  return owner !== id && structure.nodes.has(owner) ? authoredOf(structure, owner) : owner;
};

/** What a displayed node paints. The sentence-initial word is compared without
 * case: Replay recases it from its visible context, which is not a change. */
const paintOf = (node, initialKey) => {
  const uncased = value => initialKey && value.toLocaleLowerCase() === initialKey ? initialKey : value;
  return JSON.stringify([uncased(trimmed(node.data.label)), uncased(trimmed(node.data.word)), node.data.silent === true]);
};
/** The word a displayed node paints: a derived word leaf's text, or an occurrence's word field. */
const wordOf = (node, initialKey) => {
  const [label, word] = JSON.parse(paintOf(node, initialKey));
  return node.data.replayOrigin?.kind === 'word' ? label : word;
};
const describePaint = (node, initialKey) => {
  const [label, word, silent] = JSON.parse(paintOf(node, initialKey));
  return `${label}${word ? ` "${word}"` : ''}${silent ? ' silent' : ''}`;
};
const ancestorsIn = (structure, id) => {
  const out = [];
  for (let at = structure.parent.get(id); at; at = structure.parent.get(at)) out.push(at);
  return out;
};

/** The visible difference between consecutive frames: displayed nodes that
 * disappear, move to another displayed parent (or none), or repaint. */
function frameChange(previous, current, initialKey) {
  const kept = [...current.displayed].filter(id => previous.displayed.has(id));
  return {
    added: [...current.displayed].filter(id => !previous.displayed.has(id)),
    removed: [...previous.displayed].filter(id => !current.displayed.has(id)),
    reparented: kept.filter(id => previous.parent.get(id) !== current.parent.get(id)),
    repainted: kept.filter(id => paintOf(previous.nodes.get(id), initialKey) !== paintOf(current.nodes.get(id), initialKey)),
    reworded: kept.filter(id => wordOf(previous.nodes.get(id), initialKey) !== wordOf(current.nodes.get(id), initialKey))
  };
}

/**
 * Each playback step changes what its operation and target declare. Steps are
 * the kinds the compiler emits (replay/stageScheduling.ts,
 * replay/structuralPlayback.ts): micro LexicalSelect, Project and
 * ExternalMerge; relation moments, whose operation is the authored relation;
 * and the macro StageRecord. Subtypes:
 * - `empty-step`: a structural step whose target is not displayed, a selection
 *   or projection of a target already displayed, or a merge into a displayed
 *   target that gains no displayed child.
 * - `child-count`: a new projection over other than one displayed child, or a
 *   new merge over fewer than two.
 * - `authored-removal`: a structural step removes a node its stage still
 *   authors (it returns later in the stage: a blink).
 * - `unowned-removal` and `unowned-move`: a relation moment removes or
 *   re-parents displayed syntax it does not own (its movement endpoints and
 *   proved rewrite with their subtrees, and for removal the previous-stage
 *   witnesses it names), or a Stage Record removes or re-parents syntax its
 *   stage authors or names. An edge to a parent already displayed is left to
 *   attach-at-merge. The derived word of an occurrence may leave while the
 *   occurrence stays at the moment that voices it: that is its repaint. A
 *   relation that pronounces the occurrence or an ancestor
 *   (`pronunciationOwners`) voices it; without one, a relation naming it does.
 * - `unowned-repaint`: a node's label, word or silence changes at a step that
 *   does not own it: a structural step owns its target and word leaf, a
 *   relation moment what it owns, names or attaches new material to, a Stage
 *   Record nothing. A stage's first step may restate retained syntax no
 *   relation of the stage names; a change to syntax a relation names belongs
 *   to that relation's moment. A word with a pronunciation owner changes only
 *   at that relation's moment, whatever else owns the occurrence.
 * - `movement-incomplete`: a movement moment without its displayed landing or
 *   lower occurrence, or whose landing was already displayed, unless an
 *   earlier moment of the stage introduced that shared landing.
 * - `trajectory-off-moment`: a relation's movement path first appears at a
 *   step other than that relation's own moment, so the moment draws nothing
 *   or another claim's step draws it.
 * - `unknown-step`: a step of another kind.
 */
export function checkStepSemantics(replay, record) {
  const steps = replay.playbackSteps, out = [], stages = authoredStages(record), introducedLandings = new Set();
  const moments = new Map(), firstTrajectories = new Map();
  const pronunciation = pronunciationOwners(replay);
  const initialKey = String(resolveSavedInputTokens(record.sentence ?? '', record.inputTokens)[0] ?? '').trim().toLocaleLowerCase();
  let previous = EMPTY_FRAME;
  steps.forEach((step, index) => {
    const frame = index + 1, current = frameStructure(step), stageIndex = step.replayFrameIndex, stage = stages[stageIndex];
    const firstOfStage = index === 0 || steps[index - 1].replayFrameIndex !== stageIndex;
    const change = frameChange(previous, current, initialKey);
    const target = String(step.targetNodeId ?? ''), operation = String(step.operation ?? '');
    const at = step.replayKind === 'relation' ? `relation "${operation}"` : `${step.replayKind} ${operation} ${target}`;
    const report = (subtype, subject, detail) => out.push(finding('step-semantics', subtype, subject, frame, `${detail} at ${at}`));
    const move = id => `${id} moves from ${previous.parent.get(id) ?? 'no parent'} to ${current.parent.get(id) ?? 'no parent'}`;
    // An edge to a parent displayed at the preceding step is attach-at-merge's.
    const newEdgeElsewhere = id => !(current.parent.get(id) && previous.displayed.has(current.parent.get(id)));
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
    momentRelationIdentities(step).forEach(shown => { if (!moments.has(refKey(shown))) moments.set(refKey(shown), frame); });
    (step.replayRelationLinks ?? []).filter(link => link.renderFamily === 'trajectory' && Number(link.stepIndex) === stageIndex
      && !firstTrajectories.has(link.authoredRelationKey)).forEach(link => firstTrajectories.set(link.authoredRelationKey, frame));
    // A word whose occurrence has a pronunciation owner belongs to that owner's moment alone.
    const separatelyVoiced = id => change.reworded.includes(id) && pronunciation(stageIndex, occurrenceOf(current, id)) !== undefined
      && !(identity?.stageIndex === stageIndex && momentVoices(pronunciation, step, occurrenceOf(current, id), false));
    const reportRepaints = owns => change.repainted
      .filter(id => separatelyVoiced(id) || !owns(id) && !(firstOfStage && !stage?.named.has(authoredOf(current, id))))
      .forEach(id => report('unowned-repaint', id, `${id} repaints from ${describePaint(previous.nodes.get(id), initialKey)} `
        + `to ${describePaint(current.nodes.get(id), initialKey)}`));

    if (step.replayKind === 'micro') {
      const own = new Set([target, ...[...current.nodes].filter(([, node]) => node.data.replayOrigin?.kind === 'word'
        && node.data.replayOrigin.ownerId === target).map(([id]) => id)]);
      const children = current.children.get(target) ?? [], retained = previous.displayed.has(target);
      if (!current.displayed.has(target)) report('empty-step', target, `target ${target} is not displayed`);
      else if (operation === 'LexicalSelect' || operation === 'Project') {
        if (retained) report('empty-step', target, `${target} is already displayed`);
        else if (operation === 'Project' && children.length !== 1) report('child-count', target, `${target} projects over ${children.length} children [${children}]`);
      } else if (operation === 'ExternalMerge') {
        if (!retained && children.length < 2) report('child-count', target, `${target} merges ${children.length} children [${children}]`);
        if (retained && !children.some(child => previous.parent.get(child) !== target))
          report('empty-step', target, `${target} attaches nothing new: [${children}] were already its children`);
      } else report('unknown-step', target, 'unknown structural operation');
      change.removed.filter(id => stage?.ids.has(authoredOf(previous, id)))
        .forEach(id => report('authored-removal', id, `${id} disappears although stage ${stageIndex + 1} authors it`));
      reportRepaints(id => own.has(id));
    } else if (step.replayKind === 'relation' && step.replayRelationIdentity) {
      const { stageIndex: owner, relationIndex } = step.replayRelationIdentity, key = relationKey(owner, relationIndex);
      const ownership = momentOwnership(step), authored = record.derivationStages?.[owner]?.relations?.[relationIndex];
      const structural = new Set([...ownership.endpoints, ...ownership.rewritten, ...(step.replayTreeTransition?.priorNodeIds ?? [])]);
      // A duplicate sharing the moment names its own anchors too.
      const authoredAtMoment = momentRelationIdentities(step).map(shown => record.derivationStages?.[shown.stageIndex]?.relations?.[shown.relationIndex]);
      const prior = new Set(authoredAtMoment.flatMap(relation => anchorIds(relation?.priorAnchors)));
      const named = new Set([...authoredAtMoment.flatMap(relation => anchorIds(relation?.anchors)), ...prior, ...ownership.anchored]);
      const ownedIn = (structure, id, owned) => [id, ...ancestorsIn(structure, id)].some(at => owned.has(at) || owned.has(authoredOf(structure, at)));
      const removable = new Set([...structural, ...prior]);
      // A derived word leaving an occurrence that stays, at the moment voicing it, is that occurrence's repaint.
      const unvoiced = id => { const origin = previous.nodes.get(id)?.data.replayOrigin;
        return origin?.kind === 'word' && current.displayed.has(origin.ownerId)
          && momentVoices(pronunciation, step, authoredOf(previous, origin.ownerId), named.has(origin.ownerId)); };
      change.removed.filter(id => !ownedIn(previous, id, removable) && !unvoiced(id)).forEach(id => report('unowned-removal', id, `${id} disappears`));
      change.reparented.filter(id => newEdgeElsewhere(id) && !ownedIn(previous, id, removable) && !ownedIn(current, id, structural)
        && !change.added.includes(current.parent.get(id))).forEach(id => report('unowned-move', id, move(id)));
      const owned = new Set([...structural, ...named]), receiving = new Set(change.added.map(id => current.parent.get(id)).filter(Boolean));
      reportRepaints(id => ownedIn(previous, id, owned) || ownedIn(current, id, owned) || receiving.has(id)
        || change.added.includes(current.parent.get(id)));
      for (const link of (step.replayRelationLinks ?? []).filter(item => item.authoredRelationKey === key && item.movementTransition === true)) {
        const landing = String(link.targetNodeId ?? ''), lower = String(link.sourceNodeId ?? '');
        if (!current.displayed.has(landing)) { report('movement-incomplete', landing, `movement landing ${landing} is not displayed`); continue; }
        if (lower && !current.displayed.has(lower)) report('movement-incomplete', lower, `lower occurrence ${lower} is not displayed`);
        if (change.added.includes(landing) || change.reparented.includes(landing)) introducedLandings.add(`${stageIndex}:${landing}`);
        else if (!introducedLandings.has(`${stageIndex}:${landing}`)) report('movement-incomplete', landing, `movement landing ${landing} was already displayed`);
      }
    } else if (step.replayKind === 'macro' && operation === 'StageRecord') {
      change.reparented.filter(newEdgeElsewhere).forEach(id => report('unowned-move', id, move(id)));
      change.removed.filter(id => stage?.ids.has(authoredOf(previous, id)) || stage?.named.has(authoredOf(previous, id)))
        .forEach(id => report('unowned-removal', id, `${id} disappears`));
      reportRepaints(() => false);
    } else report('unknown-step', target, 'unknown step kind');
    previous = current;
  });
  for (const [key, frame] of firstTrajectories) {
    const own = moments.get(key);
    if (own !== undefined && own !== frame) out.push(finding('step-semantics', 'trajectory-off-moment', key, frame,
      `the movement path of relation ${key} first appears at frame ${frame}, not at its own moment at frame ${own}`));
  }
  return out;
}

/** Whether a plan anchor resolves to displayed syntax at one step, as
 * components/renderer/relationAnchors.ts resolves it: the visible node itself,
 * or laid-out syntax with visible material. */
function anchorResolver(step) {
  const structure = frameStructure(step);
  const visible = [...structure.nodes.values()].filter(node => structure.visible.has(getNodeId(node))
    && node.data.replayOrigin?.kind !== 'workspace');
  const overlay = indexHierarchyNodesByIdAndAliases(visible), overlayIds = new Set(overlay.keys());
  const laidOut = indexHierarchyNodesByIdAndAliases([...structure.nodes.values()]);
  return { overlay, resolves: id => overlay.has(id) || Boolean(laidOut.get(id)?.descendants().some(node => overlayIds.has(getNodeId(node)))) };
}

/** Whether an item must be revealed, read from the authored moments alone:
 * a relation-only mark at its own relation's moment; any other mark from the
 * moment of a relation it represents onward in that stage, or throughout a
 * later stage it persists into, until the later moment that supersedes it.
 * This restates the contract independently of renderPlan.ts's selector, so a
 * broken selector is reported instead of hiding every mark from the rule. */
export function authoredReveal(item, stage, played, active) {
  const refs = planItemRelationRefs(item);
  if (item.supersededAt && item.supersededAt.stageIndex === stage && played.has(item.supersededAt.relationIndex)) return false;
  if (item.persistence === 'relation-only') return active !== null && refs.some(ref => ref.stageIndex === stage && ref.relationIndex === active);
  return item.appearsAtStage < stage || refs.some(ref => ref.stageIndex === stage && played.has(ref.relationIndex));
}

/** The marks one step paints, as components/renderer/relationScene.ts selects
 * them: the stage's plan items, with theta rows and occurrence transfers
 * projected for the relations played so far, revealed at the authored moments
 * (`selected` keeps the production selector's answer) and drawn only when every
 * dependency anchor resolves. */
export function stepMarks(plan, step, played, { select = isPlanItemRevealed, resolver = anchorResolver(step) } = {}) {
  const stage = step.replayFrameIndex, { overlay, resolves } = resolver;
  const active = step.replayKind === 'relation' ? step.replayRelationIdentity?.relationIndex ?? null : null;
  return (plan.frames[stage]?.items ?? []).map(item => {
    const projected = resolveDisplayedTrajectoryAttachments(projectThetaGrid(item, stage, played),
      id => overlay.get(id)?.data, { stageIndex: stage, playedRelationIndices: played });
    const revealed = authoredReveal(projected, stage, played, active);
    const missing = planItemDependencyNodeIds(projected).filter(id => !resolves(id));
    return { item: projected, revealed, selected: select(projected, stage, played, active), missing, painted: revealed && !missing.length };
  });
}

/** One mark per relation it represents, by kind and registered piece, so
 * coalescing a later identical claim into an earlier mark is not an end. */
const markKeys = item => planItemRelationRefs(item).map(ref => JSON.stringify([item.kind, item.familyId ?? null, item.tier2RenderPart ?? null,
  item.plaqueStyle ?? item.pathStyle ?? item.badgeStyle ?? item.linkStyle ?? item.domainStyle ?? null, ref.stageIndex, ref.relationIndex]));
const keyRef = key => { const [, , , , stageIndex, relationIndex] = JSON.parse(key); return { stageIndex, relationIndex }; };
const describeKey = key => { const [kind, family] = JSON.parse(key); return `${kind}${family ? ` ${family}` : ''} ${refKey(keyRef(key))}`; };
const ENDING_PERSISTENCE = new Set(['stage-only', 'relation-only', 'replace-prior-stage', 'replace-previous-instance']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
/** An authored claim, so an identical restatement under another moment is the same claim. */
const claimKey = ref => JSON.stringify(canonical([ref.relation ?? null, ref.anchors ?? null, ref.values ?? null]));
const isThetaBadges = item => item.kind === 'node-badges' && item.badgeStyle === 'theta-role';
const isComposedThetaGrid = item => item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid' && Boolean(item.composedRefs?.length);

const VANISHED = /^persistent mark from stage (\d+) is not drawn at stage (\d+): anchored node\(s\) (.+) no longer exist in this stage's forest/;
/** The plan compiler's record of persistent marks it did not materialize because
 * an anchor is absent from a later stage (replay/relations/planPersistence.ts):
 * `{ frameIndex, relation, ids }`. */
export function vanishedAnchors(plan) {
  return (plan?.diagnostics ?? []).filter(diagnostic => diagnostic.kind === 'anchor-vanished').map(diagnostic => {
    const match = VANISHED.exec(diagnostic.detail);
    if (!match) throw new Error(`unrecognized anchor-vanished diagnostic: ${diagnostic.detail}`);
    return { frameIndex: diagnostic.stageIndex, relation: relationKey(Number(match[1]) - 1, diagnostic.relationIndex), ids: match[3].split(', ') };
  });
}

/**
 * A painted relation mark (plaque, theta grid, badge, index, path, rail, ...)
 * ends only for an authored reason and paints from its own moment. When a mark
 * painted at step k-1 is not painted at step k:
 * - its item is still revealed, so an anchor stopped resolving: allowed when the
 *   stage no longer authors the anchor, otherwise `hidden-anchor`;
 * - its item is present but no longer revealed: its persistence ended;
 * - its item is absent from the stage's plan frame: the compiler dropped it for
 *   a vanished anchor, allowed once that anchor is off screen
 *   (`ends-before-removal` while it is still shown); a mark composing it with a
 *   later relation paints, allowed at that relation's moment
 *   (`composed-before-moment`); otherwise allowed only for a lifetime that ends
 *   or is replaced (`dropped`).
 * An ended mark does not paint again (`paints-again`). A relation-only mark that
 * coalesces identical claims of several relations paints at each of their
 * moments as the mark of that moment's claim, so each claim paints once. A
 * piece revealed at its relation's moment paints there (`late-start` when
 * later, `never-paints`).
 * A composed theta grid replaces its contributors' badges: theta badges do not
 * paint beside a grid that composes their claim with another claim already
 * played, in this stage or an earlier one (`composed-still-paints`).
 * `reveal-selector` reports a frame where the production selector disagrees
 * with the authored moments. Whether an authored removal renames an occurrence
 * is a contract question (replayContractWarnings.mjs, renamed-anchor).
 */
export function checkMarkPersistence(replay, record, { select = isPlanItemRevealed } = {}) {
  const steps = replay.playbackSteps, plan = replay.relationRenderPlan, out = [], stages = authoredStages(record);
  if (!plan) return out;
  const vanished = new Map(vanishedAnchors(plan).map(entry => [`${entry.frameIndex}|${entry.relation}`, entry.ids]));
  const played = new Map(), ended = new Map(), first = new Set(), unpaintedAtMoment = new Map(), disagreed = new Set(), composed = new Set();
  let previousPainted = new Map();
  steps.forEach((step, index) => {
    const stage = step.replayFrameIndex, frame = index + 1;
    if (!played.has(stage)) played.set(stage, new Set());
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : null;
    momentRelationIdentities(step).filter(shown => shown.stageIndex === stage).forEach(shown => played.get(stage).add(shown.relationIndex));
    const resolver = anchorResolver(step), painted = new Map(), all = new Map();
    const report = (subtype, key, detail) => out.push(finding('mark-persistence', subtype, describeKey(key), frame, `${describeKey(key)} ${detail}`));
    // A relation-only mark coalescing identical claims paints, at each moment, for the claim whose moment it is.
    const momentKey = identity?.stageIndex === stage ? refKey(identity) : null;
    const paintsFor = (mark, key) => mark.item.persistence !== 'relation-only' || refKey(keyRef(key)) === momentKey;
    for (const mark of stepMarks(plan, step, played.get(stage), { select, resolver })) for (const key of markKeys(mark.item)) {
      if (!all.has(key)) all.set(key, []);
      all.get(key).push(mark);
      if (mark.painted && paintsFor(mark, key) && !painted.has(key)) painted.set(key, mark);
      if (mark.selected !== mark.revealed && !disagreed.has(`${frame} ${key}`)) {
        disagreed.add(`${frame} ${key}`);
        report('reveal-selector', key, `is ${mark.selected ? 'selected' : 'not selected'} where the authored moments ${mark.revealed ? 'reveal' : 'hide'} it`);
      }
    }
    const hasPlayed = ref => ref.stageIndex < stage || ref.stageIndex === stage && played.get(stage).has(ref.relationIndex);
    const shown = [...new Set(painted.values())], grids = shown.filter(mark => isComposedThetaGrid(mark.item));
    for (const mark of shown.filter(candidate => isThetaBadges(candidate.item))) {
      const refs = planItemRelationRefs(mark.item), own = new Set(refs.map(refKey)), claims = new Set(refs.map(claimKey));
      const key = markKeys(mark.item)[0];
      const other = grids.map(grid => planItemRelationRefs(grid.item)).filter(gridRefs => gridRefs.some(ref => own.has(refKey(ref))))
        .flat().find(ref => !own.has(refKey(ref)) && !claims.has(claimKey(ref)) && hasPlayed(ref));
      if (!other || composed.has(key)) continue;
      composed.add(key);
      report('composed-still-paints', key, `paints beside a theta grid that composes it with ${refKey(other)}, which has played`);
    }
    for (const [key, before] of previousPainted) {
      if (painted.has(key)) continue;
      ended.set(key, frame);
      const here = all.get(key) ?? [], own = refKey(keyRef(key)), revealed = here.find(mark => mark.revealed);
      if (revealed) {
        const kept = revealed.missing.filter(id => stages[stage]?.ids.has(id));
        if (kept.length) report('hidden-anchor', key, `ends because ${kept.join(', ')} is not displayed, although stage ${stage + 1} authors it`);
        continue;
      }
      if (here.length) continue;
      const lost = vanished.get(`${stage}|${own}`);
      if (lost) {
        const shown = lost.filter(resolver.resolves);
        if (shown.length) report('ends-before-removal', key, `ends at stage ${stage + 1} while ${shown.join(', ')}, which the stage removes, is still displayed`);
        continue;
      }
      const holder = [...painted.values()].map(mark => planItemRelationRefs(mark.item))
        .find(refs => refs.some(ref => refKey(ref) === own) && refs.some(ref => refKey(ref) !== own));
      if (holder) {
        const others = holder.filter(ref => refKey(ref) !== own);
        if (!others.some(ref => identity && refKey(ref) === refKey(identity)))
          report('composed-before-moment', key, `ends when a mark composes it with ${others.map(refKey).join('/')}, before that relation's moment`);
        continue;
      }
      if (!ENDING_PERSISTENCE.has(before.item.persistence)) report('dropped', key, `ends while its anchors remain and its ${before.item.persistence} persistence continues`);
    }
    for (const key of painted.keys()) {
      if (previousPainted.has(key)) continue;
      if (ended.has(key)) { report('paints-again', key, `paints again after ending at frame ${ended.get(key)}`); ended.delete(key); }
      if (first.has(key)) continue;
      first.add(key);
      // Only a piece revealed at its moment starts late; a later stage may reshape a claim into new pieces.
      if (unpaintedAtMoment.has(key)) report('late-start', key, `first paints after its moment at frame ${unpaintedAtMoment.get(key).frame}`);
    }
    if (identity) for (const [key, marks] of all) {
      if (refKey(keyRef(key)) !== refKey(identity) || painted.has(key)) continue;
      const own = marks.find(mark => mark.revealed && refKey(mark.item.relationRef) === refKey(identity));
      if (own) unpaintedAtMoment.set(key, { frame, missing: own.missing });
    }
    previousPainted = painted;
  });
  for (const [key, { frame, missing }] of unpaintedAtMoment) if (!first.has(key))
    out.push(finding('mark-persistence', 'never-paints', describeKey(key), frame, `${describeKey(key)} never paints: ${missing.join(', ')} is not displayed at its moment`));
  return out.sort((left, right) => left.frame - right.frame);
}
