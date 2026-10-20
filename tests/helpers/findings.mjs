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
 * bound of its own place, and every listed place where the fault no longer occurs.
 *
 * An exception that a change adds, or lets grow, also carries the owner's
 * `approval: { by, on, expires, note }` (`exceptionGrowth`); see
 * scripts/checkExceptionGrowth.mjs. */

const NO_VIEWPORT = '-';
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
    if (finding.measure !== null && finding.measure !== undefined && !(finding.measure <= (place.bound ?? -Infinity) + 1e-9))
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
 * allowed, comparing bounds largest first. Renumbered frames and smaller
 * bounds are not growth; a fault may move with its frames but not spread or
 * worsen. */
function growthOf(base, head) {
  if (!base) return ['new exception'];
  const before = boundsOf(base), out = [];
  for (const [viewport, bounds] of boundsOf(head)) {
    const allowed = before.get(viewport) ?? [];
    if (bounds.length > allowed.length) { out.push(`${viewport}: ${allowed.length} → ${bounds.length} places`); continue; }
    const index = bounds.findIndex((bound, at) => (bound ?? -Infinity) > (allowed[at] ?? -Infinity) + 1e-9);
    if (index >= 0) out.push(`${viewport}: bound ${allowed[index]} → ${bounds[index]}`);
  }
  return out;
}

/** What is wrong with an approval for a change whose base was committed on
 * `baseDate`, judged on `today` (both 'YYYY-MM-DD'), or null. */
export function approvalProblem(approval, { baseDate, today }) {
  if (!approval) return 'no approval';
  if (!EXCEPTION_OWNERS.includes(approval.by)) return `approval by ${JSON.stringify(approval.by)}, not ${EXCEPTION_OWNERS.join(' or ')}`;
  if (!validDate(approval.on) || !validDate(approval.expires) || !(approval.expires > approval.on))
    return 'approval needs on and expires dates (YYYY-MM-DD), expires after on';
  if (typeof approval.note !== 'string' || !approval.note.trim()) return 'approval needs a note saying where the owner gave it';
  if (baseDate && approval.on < baseDate) return `approval of ${approval.on} predates this change (base ${baseDate})`;
  if (today && approval.expires < today) return `approval expired on ${approval.expires}`;
  return null;
}

/** Compares exception lists (`{ name: entries }`, keyed by file and export)
 * between a change's base and head. Every head entry needs a reason; an entry
 * the change adds or lets grow needs a valid owner approval; any approval
 * fails once it expires. Returns one problem per entry. */
export function exceptionGrowth(base, head, { baseDate, today }) {
  const problems = [];
  for (const [list, entries] of Object.entries(head)) {
    const before = new Map((base[list] ?? []).map(entry => [identity(entry), entry]));
    for (const entry of entries) {
      const name = `${list} ${entry.rule}/${entry.subtype ?? '-'} ${entry.record} ${entry.subject}`;
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) problems.push({ name, problem: 'no reason' });
      const grown = growthOf(before.get(identity(entry)), entry);
      const problem = grown.length ? approvalProblem(entry.approval, { baseDate, today })
        : entry.approval && approvalProblem(entry.approval, { today });
      if (problem) problems.push({ name, grown, problem });
    }
  }
  return problems;
}
