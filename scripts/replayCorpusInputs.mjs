import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { replayMotionFaults } from './replayMotionContinuity.mjs';

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

export function compareCorpusSnapshots(baseline, candidate, records) {
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
      if (next.kind !== 'macro') continue;
      const oldWidths = new Map(previous.widths.map(width => [width.root, width.width]));
      for (const width of next.widths) {
        const oldWidth = oldWidths.get(width.root), growth = oldWidth !== undefined && width.width > oldWidth + 1e-6;
        completedWidths.push({ frame: index + 1, root: width.root, before: oldWidth, after: width.width });
        if (growth && !record.allow.completedWidthGrowth) violations.push({ kind: 'completed-width-growth', frame: index + 1, root: width.root });
      }
    }
    const finalBefore = before.frames.at(-1)?.points ?? [], finalAfter = after.frames.at(-1)?.points ?? [];
    const finalChanges = pointChanges(finalBefore, finalAfter);
    if (finalChanges.length && !record.allow.finalCoordinates) violations.push({ kind: 'final-coordinate-change' });
    const oldFaults = new Set(before.continuity.map(objectHash));
    const newContinuityFaults = after.continuity.filter(fault => !oldFaults.has(objectHash(fault)));
    if (newContinuityFaults.length) violations.push({ kind: 'new-continuity-fault', faults: newContinuityFaults });
    // Unowned motion is already a continuity fault; attachment-site motion is
    // owned by its step, so only this rule can reject a new joining jump.
    const motionKey = fault => JSON.stringify([fault.kind, fault.frame, fault.node]);
    const motion = { baseline: replayMotionFaults(before), candidate: replayMotionFaults(after) };
    const oldMotion = new Set(motion.baseline.map(motionKey));
    motion.new = motion.candidate.filter(fault => !oldMotion.has(motionKey(fault)));
    const newJoins = motion.new.filter(fault => fault.kind === 'attachment-site-motion');
    if (newJoins.length) violations.push({ kind: 'new-motion-fault', faults: newJoins });
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
