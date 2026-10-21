import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';

// useTreeBank runs in a React root that renders nothing, so it needs only the
// window events and timers the hook and store use, plus what React reads while
// committing. The store binds to this IndexedDB when it is first imported.
globalThis.indexedDB = new IDBFactory();
const window = Object.assign(new EventTarget(), {
  setTimeout, clearTimeout, HTMLIFrameElement: class {}, document: { activeElement: null, body: null }
});
globalThis.window = window;
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { useTreeBank } = await import('../hooks/useTreeBank.ts');

const listeners = { addEventListener() {}, removeEventListener() {} };
const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  ownerDocument: { nodeType: 9, ...listeners }, ...listeners };

const renders = [];
let bank;
function Probe() {
  bank = useTreeBank();
  renders.push({ loading: bank.loading, ids: bank.entries.map(entry => entry.id) });
  return null;
}
const until = async (predicate, label) => {
  for (let turn = 0; turn < 2000; turn++) {
    if (predicate(renders.at(-1))) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail(`Timed out waiting for ${label}: ${JSON.stringify(renders.at(-1))}`);
};
const entry = sentence => ({
  sentence, framework: 'xbar', activeParseIndex: 0, view: 'tree', replayStep: null, abstractionMode: false,
  bundle: { sentence, ambiguityDetected: false, analyses: [{ tree: { id: 'a', label: 'N', word: sentence }, derivationStages: [] }] }
});

test('only the first listing shows the loading state; later refreshes keep the saved cards', async t => {
  const root = createRoot(container);
  // Unmounting releases the store's focus listener and change channel.
  t.after(() => root.unmount());
  root.render(React.createElement(Probe));
  await until(state => state && !state.loading, 'the first listing');

  await bank.save(entry('Mia laughed.'));
  await until(state => state.ids.length === 1, 'the first save');
  const loaded = renders.length;
  await bank.save(entry('Nia smiled.'));
  await until(state => state.ids.length === 2, 'the second save');
  for (let focus = 0; focus < 3; focus++) window.dispatchEvent(new Event('focus'));
  await new Promise(resolve => setTimeout(resolve, 50));
  bank.setPendingDelete({ id: renders.at(-1).ids[0] });
  await until(state => state && bank.pendingDelete, 'the pending deletion');
  await bank.deletePending();
  await until(state => state.ids.length === 1, 'the deletion');
  await new Promise(resolve => setTimeout(resolve, 50));

  const later = renders.slice(loaded);
  assert.deepEqual(later.filter(state => state.loading), [], 'saves, focus and deletions refresh without the loading state');
  assert.ok(later.every(state => state.ids.length > 0), 'the library never empties while it refreshes');
  assert.equal(renders[0].loading, true, 'the library starts loading before its first listing');
});
