/** The joined `data:` lines of one server-sent event block, without the optional leading space. */
export const sseEventData = block => block.split(/\r?\n/u).filter(line => line.startsWith('data:'))
  .map(line => line.slice(5).replace(/^ /u, '')).join('\n');

/** Passes every complete event block in `buffer` to `accept`, in order, and
 * returns the incomplete remainder to prepend to the next decoded chunk.
 * A block is complete only at its blank line. As the SSE specification requires,
 * callers discard the remainder at end of stream instead of dispatching it, so a
 * terminal event cut off before its blank line is not proof of completion. The
 * remainder's size is journaled at EOF and its bytes stay in the raw archive. */
export const drainSseEvents = (buffer, accept) => {
  let separator;
  while ((separator = /\r?\n\r?\n/u.exec(buffer))) {
    accept(buffer.slice(0, separator.index));
    buffer = buffer.slice(separator.index + separator[0].length);
  }
  return buffer;
};
