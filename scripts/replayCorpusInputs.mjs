import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MOTION_FAULT_THRESHOLD, noticeableMotion, replayMotionFaults, replayStepKeys } from './replayMotionContinuity.mjs';
import { matchFindings } from '../tests/helpers/findings.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const objectHash = value => sha256(JSON.stringify(value));

export function selectRecord(value, selector = '') {
  const keys = Array.isArray(selector) ? selector : String(selector).startsWith('/')
    ? selector.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))
    : selector ? String(selector).match(/[A-Za-z_]\w*|\[\d+\]/g) : [];
  if (!keys || typeof selector === 'string' && selector && !selector.startsWith('/')
    && keys.join('.').replace(/\.\[/g, '[') !== selector) throw Error(`Invalid selector: ${selector}`);
  let result = value;
  for (const key of keys) {
    const field = String(key).replace(/^\[|\]$/g, '');
    if (!result || !Object.hasOwn(result, field)) throw Error(`Selector does not resolve: ${JSON.stringify(selector)}`);
    result = result[field];
  }
  return result;
}

/** Explicit selectors replace archive discovery heuristics. Legacy review indices
 * may use dotted paths; new manifests use JSON pointers and explicit contexts. */
export async function loadCorpusManifest(filename) {
  const text = await readFile(filename, 'utf8'), manifest = JSON.parse(text);
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) throw Error(`${filename}: unsupported schemaVersion`);
  if (!Array.isArray(manifest.records) || !manifest.records.length) throw Error(`${filename}: records must be nonempty`);
  const seen = new Set(), files = new Map(), records = [];
  for (const [index, record] of manifest.records.entries()) {
    if (typeof record.source !== 'string' || !record.source.trim()) throw Error(`${filename}: record ${index} needs a source`);
    if (record.mechanisms !== undefined && (!Array.isArray(record.mechanisms)
      || record.mechanisms.some(mechanism => typeof mechanism !== 'string' || !mechanism.trim())))
      throw Error(`${filename}: record ${index} mechanisms must be nonblank strings`);
    const source = path.resolve(path.dirname(filename), record.source ?? '');
    const id = record.id ?? `${source}:${JSON.stringify(record.selector ?? '')}`;
    if (seen.has(id)) throw Error(`${filename}: duplicate record id ${id}`);
    seen.add(id);
    if (!files.has(source)) {
      const raw = await readFile(source, 'utf8');
      const embedded = /<script\s+id=["']review-data["'][^>]*>([\s\S]*?)<\/script>/.exec(raw);
      files.set(source, { document: JSON.parse(embedded ? embedded[1] : raw), rawSha256: sha256(raw) });
    }
    const { document, rawSha256 } = files.get(source), analysis = selectRecord(document, record.selector);
    const legacyAttempt = typeof record.selector === 'string' && /^attempts\[(\d+)\]/.exec(record.selector);
    const context = record.contextSelector !== undefined ? selectRecord(document, record.contextSelector)
      : legacyAttempt ? document.attempts[Number(legacyAttempt[1])] : document;
    const response = context.normalizedRecord?.response ?? context.response ?? context;
    const sentence = analysis.sentence ?? response.sentence ?? context.request?.sentence ?? context.sentence
      ?? context.input?.sentence ?? document.sentence ?? document.input?.sentence;
    const inputTokens = analysis.inputTokens ?? response.inputTokens ?? context.inputTokens ?? document.inputTokens;
    if (!Array.isArray(analysis.derivationStages) || !analysis.derivationStages.length || !sentence?.trim())
      throw Error(`${filename}: record ${index} (${id}) needs derivationStages and its original sentence`);
    const allow = record.allow ?? {};
    if (Object.keys(allow).some(key => !['replay', 'plan', 'finalCoordinates', 'completedWidthGrowth', 'reason'].includes(key))
      || Object.keys(allow).some(key => key !== 'reason' && typeof allow[key] !== 'boolean')
      || Object.keys(allow).some(key => key !== 'reason' && allow[key]) && !allow.reason?.trim())
      throw Error(`${id}: an intentional comparison exception needs a supported boolean and a reason`);
    const input = { sentence, inputTokens, derivationStages: analysis.derivationStages, includePlayback: true };
    const expect = record.expect ?? {};
    const limits = ['minMovementMoments', 'maxMovementMoments', 'minMerges', 'minRealizationGroups', 'minWorkspaceRoots'];
    if (Object.keys(expect).some(key => ![...limits, 'facets', 'fallbacks', 'samePoints'].includes(key))
      || limits.some(key => expect[key] !== undefined && (!Number.isInteger(expect[key]) || expect[key] < 0))
      || expect.facets !== undefined && (!Array.isArray(expect.facets) || expect.facets.some(check =>
        !Number.isInteger(check.stage) || check.stage < 0 || typeof check.facet !== 'string' || typeof check.present !== 'boolean'))
      || expect.fallbacks !== undefined && (!Array.isArray(expect.fallbacks) || expect.fallbacks.some(check =>
        !Number.isInteger(check.stage) || check.stage < 0 || !Number.isInteger(check.relationIndex) || check.relationIndex < 0))
      || expect.samePoints !== undefined && (!Array.isArray(expect.samePoints) || expect.samePoints.some(check =>
        !Array.isArray(check) || check.length < 2 || check.some(point => !Number.isInteger(point.stage)
          || point.stage < 0 || !['macro', 'micro', 'relation'].includes(point.kind) || typeof point.node !== 'string'))))
      throw Error(`${id}: unsupported or malformed mechanism expectation`);
    records.push({ id, source, selector: record.selector ?? '', rawSha256, inputSha256: objectHash(input), input,
      mechanisms: record.mechanisms ?? [], expect, allow });
  }
  const coverage = [...new Set(records.flatMap(record => record.mechanisms))].sort();
  for (const mechanism of manifest.requiredMechanisms ?? [])
    if (!coverage.includes(mechanism)) throw Error(`${filename}: missing required mechanism ${mechanism}`);
  return { filename: path.resolve(filename), sha256: sha256(text), coverage, records };
}

const pointChanges = (before, after) => {
  const prior = new Map(before.map(point => [point.id, point])), current = new Map(after.map(point => [point.id, point]));
  return [...new Set([...prior.keys(), ...current.keys()])].flatMap(id => {
    const old = prior.get(id), next = current.get(id);
    return !old || !next || Math.hypot(next.x - old.x, next.y - old.y) > 1e-6
      ? [{ id, before: old ?? null, after: next ?? null }] : [];
  });
};

/** Movements the baseline shows as movement that the candidate no longer does
 * (`movementPresentations` in tests/helpers/replayInvariants.mjs): the landing
 * must still arrive at the moment of the same relation, with nothing of it
 * built earlier, and keep the trajectory the baseline draws to it. */
export function lostMovementPresentations(baseline, candidate) {
  const current = new Map(candidate.map(movement => [`${movement.stage}:${movement.landing}`, movement]));
  return baseline.filter(movement => movement.shown).flatMap(movement => {
    const after = current.get(`${movement.stage}:${movement.landing}`);
    const fault = reason => [{ stage: movement.stage, landing: movement.landing, reason, baseline: movement, candidate: after ?? null }];
    if (!after) return fault('the candidate no longer recognizes this movement');
    if (!after.shown || after.relationKey !== movement.relationKey)
      return fault(`the landing arrives at ${after.kind ?? 'no'} ${after.operation ?? 'step'}${after.relationKey ? ` (${after.relationKey})` : ''}, `
        + `not at the moment of ${movement.relationKey}${after.built.length ? `, after construction built ${after.built.join(' ')}` : ''}`);
    return movement.trajectory && !after.trajectory ? fault(`${movement.relationKey} no longer draws its trajectory`) : [];
  });
}

/** Compares each record's baseline and candidate snapshots. `motionExceptions`
 * are approved motion faults (tests/helpers/motionExceptions.mjs): a new or
 * worsened fault one covers within its bound is reported, not a violation. */
export function compareCorpusSnapshots(baseline, candidate, records, { motionExceptions = [] } = {}) {
  const old = new Map(baseline.records.map(record => [record.id, record]));
  const current = new Map(candidate.records.map(record => [record.id, record]));
  return records.map(record => {
    const before = old.get(record.id), after = current.get(record.id), violations = [];
    const inputIdentity = { id: record.id, source: record.source, selector: record.selector, rawSha256: record.rawSha256,
      inputSha256: record.inputSha256, mechanisms: record.mechanisms, allow: record.allow };
    if (!before || !after) throw Error(`Snapshot missing manifest record ${record.id}`);
    if (before.error || after.error) return { ...inputIdentity, beforeError: before.error, afterError: after.error,
      violations: [{ kind: 'record-error' }] };
    for (const snapshot of [before, after]) {
      if (snapshot.inputSha256 !== record.inputSha256) violations.push({ kind: 'input-mismatch' });
      if (snapshot.authoredBeforeSha256 !== snapshot.authoredAfterSha256) violations.push({ kind: 'authored-mutation' });
    }
    const replayChanged = before.replaySha256 !== after.replaySha256, planChanged = before.planSha256 !== after.planSha256;
    if (replayChanged && !record.allow.replay) violations.push({ kind: 'replay-change' });
    if (planChanged && !record.allow.plan) violations.push({ kind: 'relation-plan-change' });
    const changedFrames = [], completedWidths = [];
    for (let index = 0; index < Math.max(before.frames.length, after.frames.length); index++) {
      const previous = before.frames[index], next = after.frames[index];
      if (!previous || !next) { changedFrames.push({ frame: index + 1, missing: previous ? 'candidate' : 'baseline' }); continue; }
      const changes = pointChanges(previous.points, next.points);
      if (changes.length) changedFrames.push({ frame: index + 1, kind: next.kind, operation: next.operation, changes });
    }
    // A stage's completed frame is compared with the same stage's completed
    // frame, so a change in how many steps build a stage never compares two stages.
    const completedFrames = frames => {
      const seen = new Map();
      return frames.map(frame => {
        if (frame.kind !== 'macro') return null;
        const occurrence = seen.get(frame.stage) ?? 0;
        seen.set(frame.stage, occurrence + 1);
        return JSON.stringify([frame.stage, occurrence]);
      });
    };
    const oldCompleted = new Map(completedFrames(before.frames).flatMap((key, index) => key ? [[key, before.frames[index]]] : []));
    completedFrames(after.frames).forEach((key, index) => {
      const previous = key && oldCompleted.get(key);
      if (!previous) return;
      const oldWidths = new Map(previous.widths.map(width => [width.root, width.width]));
      for (const width of after.frames[index].widths) {
        const oldWidth = oldWidths.get(width.root), growth = oldWidth !== undefined && width.width > oldWidth + 1e-6;
        completedWidths.push({ frame: index + 1, root: width.root, before: oldWidth, after: width.width });
        if (growth && !record.allow.completedWidthGrowth) violations.push({ kind: 'completed-width-growth', frame: index + 1, root: width.root });
      }
    });
    const finalBefore = before.frames.at(-1)?.points ?? [], finalAfter = after.frames.at(-1)?.points ?? [];
    const finalChanges = pointChanges(finalBefore, finalAfter);
    if (finalChanges.length && !record.allow.finalCoordinates) violations.push({ kind: 'final-coordinate-change' });
    // Continuity faults are named by their step, as motion faults are, so a
    // frame inserted or removed elsewhere neither invents nor hides one.
    const continuityKey = snapshot => {
      const steps = replayStepKeys(snapshot.frames);
      return ({ index, ...fault }) => objectHash({ ...fault, step: steps[index] ?? `#${index}` });
    };
    const oldFaults = new Set(before.continuity.map(continuityKey(before)));
    const afterKey = continuityKey(after);
    const newContinuityFaults = after.continuity.filter(fault => !oldFaults.has(afterKey(fault)));
    if (newContinuityFaults.length) violations.push({ kind: 'new-continuity-fault', faults: newContinuityFaults });
    // The motion rule decides ownership from each frame's own step, not from the
    // checkout's planner diagnostics. A fault the baseline already has still
    // fails if the candidate makes it move noticeably farther. Every new or
    // worsened fault is reported; one below `noticeableMotion`, or covered by an
    // approved motion exception, is not a violation.
    const motionKey = fault => JSON.stringify([fault.kind, fault.step, fault.node]);
    const motion = { baseline: replayMotionFaults(before), candidate: replayMotionFaults(after) };
    const oldMotion = new Map(motion.baseline.map(fault => [motionKey(fault), fault]));
    motion.new = motion.candidate.filter(fault => !oldMotion.has(motionKey(fault)));
    motion.worsened = motion.candidate.filter(fault => fault.distance > (oldMotion.get(motionKey(fault))?.distance ?? Infinity) + MOTION_FAULT_THRESHOLD);
    const exceptions = motionExceptions.filter(entry => entry.record === record.id);
    const excepted = fault => {
      const { unexpected, exceeded } = matchFindings([{ rule: 'motion', subtype: fault.kind, record: record.id, subject: fault.node,
        frame: fault.frame, viewport: null, measure: fault.distance }], exceptions);
      return !unexpected.length && !exceeded.length;
    };
    const judged = [...motion.new, ...motion.worsened].map(fault => ({ fault,
      noticeable: noticeableMotion(fault, oldMotion.get(motionKey(fault))), excepted: excepted(fault) }));
    motion.tolerated = judged.filter(item => !item.noticeable).map(item => item.fault);
    motion.excepted = judged.filter(item => item.noticeable && item.excepted).map(item => item.fault);
    const failing = new Set(judged.filter(item => item.noticeable && !item.excepted).map(item => item.fault));
    const newFaults = motion.new.filter(fault => failing.has(fault)), worsened = motion.worsened.filter(fault => failing.has(fault));
    if (newFaults.length) violations.push({ kind: 'new-motion-fault', faults: newFaults });
    if (worsened.length) violations.push({ kind: 'worsened-motion-fault', faults: worsened });
    const lostMovements = lostMovementPresentations(before.evidence.movements ?? [], after.evidence.movements ?? []);
    if (lostMovements.length) violations.push({ kind: 'movement-not-shown', faults: lostMovements });
    if (after.invalid.length) violations.push({ kind: 'invalid-geometry', faults: after.invalid });
    if (after.expectationFailures.length) violations.push({ kind: 'mechanism-control-failed', failures: after.expectationFailures });
    return { ...inputIdentity,
      hashes: { baseline: { authoredBefore: before.authoredBeforeSha256, authoredAfter: before.authoredAfterSha256,
        replay: before.replaySha256, plan: before.planSha256 }, candidate: { authoredBefore: after.authoredBeforeSha256,
        authoredAfter: after.authoredAfterSha256, replay: after.replaySha256, plan: after.planSha256 } },
      frames: after.frames.length, replayChanged, planChanged, changedFrames, completedWidths,
      finalCoordinates: { before: finalBefore, after: finalAfter }, finalChanges,
      continuity: { baseline: before.continuity, candidate: after.continuity, new: newContinuityFaults }, motion,
      geometry: { baseline: before.invalid, candidate: after.invalid },
      controls: after.evidence, controlFailures: { baseline: before.expectationFailures, candidate: after.expectationFailures }, violations };
  });
}
