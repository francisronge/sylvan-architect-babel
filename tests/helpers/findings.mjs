/** Structured findings and the exceptions that may cover them, for any check
 * that reports faults at places in Replay.
 *
 * A finding is one fault at one place: `{ rule, subtype, record, subject, frame,
 * viewport, measure, detail }`. `frame` is a Replay frame number, 'canopy' or a
 * transition such as '20>21'; `viewport` names the pass (for example a Fit size)
 * or is null; `measure` is the fault's size in the rule's own unit, or null when
 * the rule has none. `detail` is for people and is never matched.
 *
 * An exception covers one subject: `{ rule, subtype, record, subject, at, max,
 * reason }`. `at` maps each viewport ('-' for none) to the exact frames where the
 * fault occurs, written like '3-7,9,canopy'; `max` bounds `measure`. Matching
 * reports a finding no exception covers, a finding whose measure exceeds its
 * bound, and every listed place where the fault no longer occurs. */

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

export function matchFindings(findings, exceptions) {
  const byIdentity = new Map();
  for (const exception of exceptions) {
    if (byIdentity.has(identity(exception))) throw Error(`Duplicate exception for ${identity(exception)}`);
    byIdentity.set(identity(exception), exception);
  }
  const unexpected = [], exceeded = [], seen = new Set();
  for (const finding of findings) {
    const exception = byIdentity.get(identity(finding)), viewport = finding.viewport ?? NO_VIEWPORT;
    const frames = exception?.at[viewport];
    if (!frames || !frameList(frames).includes(String(finding.frame))) { unexpected.push(finding); continue; }
    seen.add(JSON.stringify([identity(exception), viewport, String(finding.frame)]));
    if (finding.measure !== null && finding.measure !== undefined && !(finding.measure <= (exception.max ?? -Infinity) + 1e-9))
      exceeded.push({ finding, exception });
  }
  const stale = exceptions.flatMap(exception => Object.entries(exception.at).flatMap(([viewport, frames]) => frameList(frames)
    .filter(frame => !seen.has(JSON.stringify([identity(exception), viewport, frame])))
    .map(frame => ({ exception, viewport, frame }))));
  return { unexpected, exceeded, stale };
}

/** The exceptions that would cover exactly these findings, with `max` rounded up
 * to two decimals. For review: a listed exception needs its own reason. */
export function proposeExceptions(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = identity(finding);
    if (!grouped.has(key)) grouped.set(key, { rule: finding.rule, subtype: finding.subtype, record: finding.record,
      subject: finding.subject, frames: new Map(), max: null });
    const entry = grouped.get(key), viewport = finding.viewport ?? NO_VIEWPORT;
    if (!entry.frames.has(viewport)) entry.frames.set(viewport, []);
    entry.frames.get(viewport).push(finding.frame);
    if (finding.measure !== null && finding.measure !== undefined) entry.max = Math.max(entry.max ?? -Infinity, Math.ceil(finding.measure * 100) / 100);
  }
  return [...grouped.values()].map(({ frames, ...entry }) => ({ ...entry,
    at: Object.fromEntries([...frames].sort(([a], [b]) => a.localeCompare(b)).map(([viewport, list]) => [viewport, formatFrames(list)])) }));
}
