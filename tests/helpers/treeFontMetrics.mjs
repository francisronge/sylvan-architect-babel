import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/replay-regressions/workspace-font-metrics.json', import.meta.url)));
const categories = new Map(fixture.categories), ink = new Map(fixture.treeInk);
for (const value of categories.values()) assert(Number.isFinite(value));
for (const value of ink.values()) if (value !== null) assert(Object.values(value).every(Number.isFinite));
const required = (values, key) => {
  assert(values.has(key), `the fixture captures the production font measurement for ${key}`);
  return values.get(key);
};

export const measureCategoryText = text => required(categories, text);
export const measureTreeInk = (text, style) => required(ink, JSON.stringify([text, style])) ?? undefined;
