import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewIndexHtml, reviewNotes } from '../scripts/buildReplayReview.mjs';

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
    'glyph-overlap (text) 20.4 at desktop, step 21'
  ]);
  assert.deepEqual(reviewNotes({}), []);
});

test('the review page opens every tree at step 1 and keeps the arrow keys on Replay', () => {
  const html = reviewIndexHtml([{ group: 'Sol', title: 'n4-34', sentence: 's', notes: ['x'], steps: [78, 87], total: 87 }]);
  assert.match(html, /show\(Number\(location\.hash\.slice\(1\)\)\|\|0,1\)/);
  assert.match(html, /d\.onclick=\(\)=>show\(i,1\)/);
  assert.match(html, /frame\.contentWindow\.addEventListener\('keydown',keys,true\)/);
  assert.match(html, /pane\.html\?case='\+i\+'&step='\+step/);
});
