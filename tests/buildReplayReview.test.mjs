import assert from 'node:assert/strict';
import test from 'node:test';
import { auditBatches, reviewBatches, reviewIndexHtml, reviewNotes } from '../scripts/buildReplayReview.mjs';

// Francis found by eye what the checks already knew: Sol n4-34's unresolved
// V-to-I group (27 Oct) carried MOVEMENT_ENDPOINTS_UNRESOLVED, but the review page
// hid it. The tool writes these notes itself.
test('review notes print movement diagnostics and Replay violations before visual findings', () => {
  const notes = reviewNotes({
    movementDiagnostics: [{ step: 78, detail: 'MOVEMENT_ENDPOINTS_UNRESOLVED: lists' }, { step: 78, detail: 'MOVEMENT_ENDPOINTS_UNRESOLVED: lists' }],
    violations: [{ rule: 'movement-shown-as-movement', frame: 34, detail: 'dp_subj arrives at construction ExternalMerge' }],
    visual: [{ rule: 'mark-distance', measure: 1.1, viewport: 'desktop', frame: 3 }, { rule: 'glyph-overlap', subtype: 'text', measure: 20.4, viewport: 'desktop', frame: '21>22' }]
  });
  assert.deepEqual(notes, [
    'Babel could not draw a movement at step 78: MOVEMENT_ENDPOINTS_UNRESOLVED: lists',
    'Replay check movement-shown-as-movement at step 34: dp_subj arrives at construction ExternalMerge',
    'glyph-overlap (text) 20.4 at desktop, step 21',
    'mark-distance 1.1 at desktop, step 3'
  ]);
  assert.deepEqual(reviewNotes({}), []);
});

test('review notes keep every distinct visual and camera fault, grouped by rule', () => {
  const at = (rule, subtype, measure, subject) => ({ rule, subtype, measure, subject, viewport: 'desktop', frame: '4>5' });
  const notes = reviewNotes({ visual: [at('clipping', 'panel', 3, 'a'), at('branch-geometry', 'row', 40, 'b'), at('parent-centring', null, 12, 'c'),
    at('glyph-overlap', 'text', 2, 'd'), at('glyph-overlap', 'text', 9, 'e'), at('glyph-overlap', 'text', 1, 'e')] });
  assert.deepEqual(notes, [
    'branch-geometry (row) 40 at desktop, step 4',
    'clipping (panel) 3 at desktop, step 4',
    'glyph-overlap (text) 9 at desktop, step 4',
    'glyph-overlap (text) 2 at desktop, step 4',
    'parent-centring 12 at desktop, step 4'
  ]);
});

test('two batches sharing a directory name keep their own audit results', () => {
  const batches = [{ dir: '/archive/sol/batch', label: 'Sol' }, { dir: '/archive/opus/batch', label: 'Opus' }];
  const audits = auditBatches(batches, {
    auditInvariants: (_batch, index) => ({ records: index ? [] : [{ id: 'sol/batch/n4-34 a1', violations: [{ rule: 'whole-parent', frame: 3, detail: 'sol' }] }] }),
    auditVisual: (_batch, index) => index ? [{ record: 'run:opus/batch/n4-34/parse#0', rule: 'clipping', measure: 2 }] : []
  });
  assert.deepEqual(audits.map(({ violations }) => violations.get('n4-34 a1')?.map(v => v.detail)), [['sol'], undefined]);
  assert.deepEqual(audits.map(({ visual }) => visual.get('n4-34 a1')?.map(f => f.rule)), [undefined, ['clipping']]);
  // An audit result naming the other batch is refused, never filed under this one.
  assert.throws(() => auditBatches(batches.slice(0, 1), { auditInvariants: () => ({ records: [{ id: 'opus/batch/n4-34 a1', violations: [] }] }) }),
    /The audit of \/archive\/sol\/batch returned opus\/batch\/n4-34 a1, which names another batch/);
  // A --root checkout older than archive-qualified ids still names the batch folder alone.
  const legacy = auditBatches(batches.slice(1), { auditInvariants: () => ({ records: [] }),
    auditVisual: () => [{ record: 'run:batch/n4-34/parse#0', rule: 'clipping', measure: 2 }] });
  assert.deepEqual(legacy[0].visual.get('n4-34 a1')?.map(f => f.rule), ['clipping']);
});

test('review batches are labelled by archive and batch, and none may repeat a folder or label', () => {
  assert.deepEqual(reviewBatches(['/a/codex-qualification/heldout-20261029', '/a/anthropic-qualification/heldout-20261029=Opus']).map(b => b.label),
    ['codex-qualification/heldout-20261029', 'Opus']);
  assert.throws(() => reviewBatches(['/a/sol/batch', '/a/sol/batch=Sol']), /share the folder \/a\/sol\/batch/);
  assert.throws(() => reviewBatches(['/a/sol/batch=Sol', '/a/opus/batch=Sol']), /share the label Sol/);
});

test('the review page opens every tree at step 1 and keeps the arrow keys on Replay', () => {
  const html = reviewIndexHtml([{ group: 'Sol', title: 'n4-34', sentence: 's', notes: ['x'], steps: [78, 87], total: 87 }]);
  assert.match(html, /show\(Number\(location\.hash\.slice\(1\)\)\|\|0,1\)/);
  assert.match(html, /d\.onclick=\(\)=>show\(i,1\)/);
  assert.match(html, /frame\.contentWindow\.addEventListener\('keydown',keys,true\)/);
  assert.match(html, /pane\.html\?case='\+i\+'&step='\+step/);
});
