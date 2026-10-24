import assert from 'node:assert/strict';

/** Wrapped plaque lines spell their text in order. A break consumes only
 * whitespace, and neither line keeps the whitespace it consumes; whitespace at
 * either end of the text stays on the line next to it. */
export const assertSpells = (lines, text) => {
  let rest = text;
  lines.forEach((line, index) => {
    if (index > 0) {
      rest = rest.trimStart();
      assert(!/^\s/u.test(line) && !/\s$/u.test(lines[index - 1]), `${JSON.stringify(lines)} keeps whitespace at a break`);
    }
    assert(rest.startsWith(line), `${JSON.stringify(lines)} does not spell ${JSON.stringify(text)}`);
    rest = rest.slice(line.length);
  });
  assert.equal(rest, '');
};
