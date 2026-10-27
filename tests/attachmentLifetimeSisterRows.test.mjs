import assert from 'node:assert/strict';
import test from 'node:test';
import { auditVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word === undefined ? {} : { word }), ...extra, children: [] });
const node = (id, label, ...children) => ({ id, label, children });
const stage = (statement, forest, relations = []) => ({ statement, stageRecord: statement, relations, workspaceForest: [forest] });
const send = () => leaf('v_send', 'V', 'send', { lineageId: 'L_send' });
const lower = verb => node('vp_low', 'VP', leaf('np_brother', 'NP', 'her brother'),
  node('vbar_low', "V'", verb, leaf('np_letter', 'NP', 'a letter')));
const raised = () => node('vbar_up', "V'", send(), lower(leaf('t_v', 'V', undefined, { lineageId: 'L_send', silent: true })));
const shell = subject => node('vp_up', 'VP', subject, raised());

// Reduced from Claude Opus 5.5's Larsonian analysis of "She sent her brother a
// letter." (qualification run n3-54-en-double-object). An upper V′ takes an
// empty V head beside the lower VP; the verb later replaces that head. The
// attachment lifetime of the later V′ carried its rows back into the stage that
// built it, raising V′ and the VP but leaving the empty V a row lower.
const larsonianShell = {
  sentence: 'She sent her brother a letter.',
  derivationStages: [
    stage('The lower VP is formed.', lower(send())),
    stage('An upper VP shell with an empty V head takes the lower VP.',
      node('vbar_up', "V'", leaf('v_empty', 'V', undefined, { silent: true }), lower(send()))),
    stage('The verb raises into the empty upper V.', raised(),
      [{ relation: 'head-movement', anchors: { moved: 'v_send', trace: 't_v' }, priorAnchors: { substitutionSite: 'v_empty' } }]),
    stage('The subject merges in the upper specifier.', shell(leaf('np_she', 'NP', 'she', { lineageId: 'L_she' }))),
    stage('Past-tense INFL merges with the VP.', node('ibar', "I'", leaf('i_past', 'I[+past]'),
      shell(leaf('np_she', 'NP', 'she', { lineageId: 'L_she' })))),
    stage('The subject raises to the specifier of IP.', node('ip', 'IP', leaf('np_she', 'NP', 'she', { lineageId: 'L_she' }),
      node('ibar', "I'", leaf('i_past', 'I[+past]'), shell(leaf('t_she', 'NP', undefined, { lineageId: 'L_she', silent: true })))),
    [{ relation: 'NP-movement', anchors: { moved: 'np_she', trace: 't_she' } }])
  ]
};

test('a daughter outside a reserved attachment lifetime stays on its sisters\' row', () => {
  const { findings } = auditVisualRecord('larsonian-shell', larsonianShell, { viewports: VIEWPORTS });
  assert.deepEqual(findings.filter(finding => ['branch-geometry', 'parent-centring'].includes(finding.rule))
    .map(finding => `${finding.frame}@${finding.viewport}: ${finding.detail}`), []);
});
