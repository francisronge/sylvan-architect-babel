/** Structured findings and the exceptions that may cover them, for any check
 * that reports faults at places in Replay.
 *
 * A finding is one fault at one place: `{ rule, subtype, record, subject, frame,
 * viewport, measure, detail }`. `frame` is a Replay frame number, 'canopy' or a
 * transition such as '20>21'; `viewport` names the pass (for example a Fit size)
 * or is null; `measure` is the fault's size in the rule's own unit, or null when
 * the rule has none. `detail` is for people and is never matched.
 *
 * An exception covers one subject: `{ rule, subtype, record, subject, at, reason }`.
 * `at` maps each viewport ('-' for none) to the exact frames where the fault
 * occurs, each frame list (written like '3-7,9,canopy') with the bound of
 * `measure` at those frames, or null for a rule without a measure. Matching
 * reports a finding no exception covers, a finding whose measure exceeds the
 * bound of its own place by more than BOUND_TOLERANCE, and every listed place
 * where the fault no longer occurs.
 *
 * An exception that a change adds, or lets grow, also carries the owner's
 * `approval: { by, on, expires, note, accepts }`, where `accepts` is the `at`
 * he accepted (`exceptionGrowth`); see scripts/checkExceptionGrowth.mjs. */

const NO_VIEWPORT = '-';

/** The share by which a measure may exceed its listed bound, and a bound may
 * grow, before it counts: the owner does not want a change he could not notice
 * brought to him (27 Oct 2026). More places always count. */
export const BOUND_TOLERANCE = 0.05;
/** The most `measure` may be and still lie within `bound`. */
export const withinBound = (measure, bound) => measure <= (bound ?? -Infinity) + Math.abs(bound ?? 0) * BOUND_TOLERANCE + 1e-9;
const identity = item => JSON.stringify([item.rule, item.subtype, item.record, item.subject]);

/** '3-5,9,canopy' → ['3', '4', '5', '9', 'canopy']. */
export function frameList(text) {
  return String(text).split(',').map(part => part.trim()).filter(Boolean).flatMap(part => {
    const range = /^(\d+)-(\d+)$/.exec(part);
    return range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, index) => String(Number(range[1]) + index)) : [part];
  });
}

/** The shortest frame list for these frames: consecutive numbers become ranges. */
export function formatFrames(frames) {
  const numbers = [...new Set(frames.filter(frame => typeof frame === 'number'))].sort((a, b) => a - b);
  const others = [...new Set(frames.filter(frame => typeof frame !== 'number').map(String))].sort();
  const spans = [];
  for (const frame of numbers) {
    const last = spans.at(-1);
    if (last && frame === last[1] + 1) last[1] = frame; else spans.push([frame, frame]);
  }
  return [...spans.map(([first, last]) => first === last ? `${first}` : `${first}-${last}`), ...others].join(',');
}

const placesOf = exception => Object.entries(exception.at).flatMap(([viewport, lists]) => Object.entries(lists)
  .flatMap(([frames, bound]) => frameList(frames).map(frame => ({ viewport, frame, bound }))));

export function matchFindings(findings, exceptions) {
  const places = new Map();
  for (const exception of exceptions) {
    if (places.has(identity(exception))) throw Error(`Duplicate exception for ${identity(exception)}`);
    places.set(identity(exception), new Map(placesOf(exception).map(place => [`${place.viewport} ${place.frame}`, place])));
  }
  const unexpected = [], exceeded = [], seen = new Set();
  for (const finding of findings) {
    const own = places.get(identity(finding)), key = `${finding.viewport ?? NO_VIEWPORT} ${finding.frame}`, place = own?.get(key);
    if (!place) { unexpected.push(finding); continue; }
    seen.add(`${identity(finding)} ${key}`);
    if (finding.measure !== null && finding.measure !== undefined && !withinBound(finding.measure, place.bound))
      exceeded.push({ finding, bound: place.bound });
  }
  const stale = exceptions.flatMap(exception => placesOf(exception)
    .filter(place => !seen.has(`${identity(exception)} ${place.viewport} ${place.frame}`))
    .map(({ viewport, frame }) => ({ exception, viewport, frame })));
  return { unexpected, exceeded, stale };
}

/** The exceptions that would cover exactly these findings: each place bounded by
 * its measure rounded up to two decimals, consecutive frames sharing a bound
 * written as one list. For the owner's review: a listed exception needs its own
 * reason and his approval. */
export function proposeExceptions(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = identity(finding), viewport = finding.viewport ?? NO_VIEWPORT;
    if (!grouped.has(key)) grouped.set(key, { rule: finding.rule, subtype: finding.subtype, record: finding.record,
      subject: finding.subject, places: new Map() });
    const places = grouped.get(key).places;
    if (!places.has(viewport)) places.set(viewport, new Map());
    const bound = finding.measure === null || finding.measure === undefined ? null : Math.ceil(finding.measure * 100 - 1e-9) / 100;
    const prior = places.get(viewport).get(finding.frame);
    places.get(viewport).set(finding.frame, prior === undefined || bound === null ? bound : Math.max(prior, bound));
  }
  return [...grouped.values()].map(({ places, ...entry }) => ({ ...entry,
    at: Object.fromEntries([...places].sort(([a], [b]) => a.localeCompare(b)).map(([viewport, frames]) => {
      const lists = new Map();
      for (const [frame, bound] of frames) lists.set(bound, [...(lists.get(bound) ?? []), frame]);
      // Consecutive frames with one bound compress; split runs keep their own lists.
      return [viewport, Object.fromEntries([...lists].flatMap(([bound, list]) => runs(list).map(run => [formatFrames(run), bound]))
        .sort(([a], [b]) => frameList(a)[0].localeCompare(frameList(b)[0], undefined, { numeric: true })))];
    })) }));
}

const runs = frames => {
  const numbers = frames.filter(frame => typeof frame === 'number').sort((a, b) => a - b), out = [];
  for (const frame of numbers) if (out.at(-1)?.at(-1) === frame - 1) out.at(-1).push(frame); else out.push([frame]);
  const others = frames.filter(frame => typeof frame !== 'number');
  return [...out, ...(others.length ? [others] : [])];
};

/** Who may accept a fault as an exception. */
export const EXCEPTION_OWNERS = ['Francis Ronge'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = text => typeof text === 'string' && DATE.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
const boundsOf = exception => {
  const out = new Map();
  for (const { viewport, bound } of placesOf(exception)) out.set(viewport, [...(out.get(viewport) ?? []), bound]);
  for (const bounds of out.values()) bounds.sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity));
  return out;
};

/** How `head`'s entry grew from `base`'s (undefined when new): the viewports
 * where it lists more places, or where a place's bound exceeds what the base
 * allowed by more than BOUND_TOLERANCE, comparing bounds largest first.
 * Renumbered frames and smaller bounds are not growth; a fault may move with
 * its frames but not spread or noticeably worsen. */
function growthOf(base, head) {
  if (!base) return ['new exception'];
  const before = boundsOf(base), out = [];
  for (const [viewport, bounds] of boundsOf(head)) {
    const allowed = before.get(viewport) ?? [];
    if (bounds.length > allowed.length) { out.push(`${viewport}: ${allowed.length} → ${bounds.length} places`); continue; }
    const index = bounds.findIndex((bound, at) => !withinBound(bound ?? -Infinity, allowed[at]));
    if (index >= 0) out.push(`${viewport}: bound ${allowed[index]} → ${bounds[index]}`);
  }
  return out;
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validAt = at => isPlainObject(at) && Object.values(at).every(lists => isPlainObject(lists)
  && Object.values(lists).every(bound => bound === null || Number.isFinite(bound)));

/** What is wrong with `entry`'s approval, or null. The approval binds to the
 * value it accepts, not to a date: `accepts` is the `at` the owner accepted,
 * and the entry may not grow beyond it (by `growthOf`), so it stays valid
 * across unrelated commits and over time, but a later growth needs his
 * approval again. */
export function approvalProblem(entry) {
  const approval = entry.approval;
  if (!approval) return 'no approval';
  if (!EXCEPTION_OWNERS.includes(approval.by)) return `approval by ${JSON.stringify(approval.by)}, not ${EXCEPTION_OWNERS.join(' or ')}`;
  if (!validDate(approval.on)) return 'approval needs the date it was given, on (YYYY-MM-DD)';
  if (typeof approval.note !== 'string' || !approval.note.trim()) return 'approval needs a note saying where the owner gave it';
  if (!validAt(approval.accepts))
    return 'approval needs accepts: the entry\'s `at` (viewport → frame list → bound) exactly as the owner accepted it';
  const beyond = growthOf({ at: approval.accepts }, entry);
  if (beyond.length) return `grown beyond what the approval of ${approval.on} accepts (${beyond.join('; ')}); `
    + 'the owner must accept the new value';
  return null;
}

/** An approval is a record of the owner's words. While its entry stays
 * within what it accepts, its owner, date and note stay exactly as written
 * (its `accepts` may narrow with the entry) and it is never removed. A new
 * approval for a value the old one does not accept may follow it, never
 * dated earlier. Returns what was changed, or null. */
function approvalRewritten(previous, entry) {
  const before = previous?.approval, after = entry.approval;
  if (!before) return null;
  if (!after) return 'removed';
  if (growthOf({ at: before.accepts }, entry).length) return String(after.on) < String(before.on) ? 'dated earlier' : null;
  const changed = ['by', 'on', 'note'].filter(field => String(before[field] ?? '').trim() !== String(after[field] ?? '').trim());
  if (growthOf({ at: before.accepts }, { at: after.accepts }).length) changed.push('accepts widened');
  return changed.length ? changed.join(', ') : null;
}

/** Compares exception lists (`{ name: entries }`, keyed by file and export)
 * between a change's base and head. Every head entry needs a reason; an entry
 * the change adds or lets grow needs a valid owner approval; any approval
 * fails once its entry grows beyond what it accepts. Returns one problem per
 * entry. */
export function exceptionGrowth(base, head) {
  const problems = [];
  for (const [list, entries] of Object.entries(head)) {
    const before = new Map((base[list] ?? []).map(entry => [identity(entry), entry]));
    for (const entry of entries) {
      const name = `${list} ${entry.rule}/${entry.subtype ?? '-'} ${entry.record} ${entry.subject}`;
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) problems.push({ name, problem: 'no reason' });
      const previous = before.get(identity(entry));
      const grown = growthOf(previous, entry);
      const problem = (grown.length || entry.approval) && approvalProblem(entry);
      if (problem) problems.push({ name, grown, problem });
      else {
        const edit = approvalRewritten(previous, entry);
        if (edit) problems.push({ name, grown, problem: `its existing approval was edited (${edit}). An approval records what the `
          + 'owner said, when and where: keep its by, on and note exactly as written. Only a new approval for a value the old one '
          + 'does not accept may replace it, and never with an earlier date' });
      }
    }
  }
  return problems;
}
