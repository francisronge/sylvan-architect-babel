import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import * as d3 from 'd3';

import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import {
  applyPreFrontingSentenceInitialCasing,
  adaptDerivationStagesForReplay,
  applyVizIds,
  buildTraceDisplayLabel,
  buildPlaybackStepsFromDerivationFrames,
  buildReplaySupportLines,
  buildResolvedLinkTraceIndexMap,
  collectPronouncedLeafNodeIdsInOrder,
  formatAuthoredWitnessSurface,
  getNodeId,
  isDisplayTraceLabel,
  isTraceLike,
  maybeLowercaseSentenceInitialFunctionSurface
} from '../replay/replayCompiler.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));

const collectNodes = (node, nodes = []) => {
  if (!node) return nodes;
  nodes.push(node);
  for (const child of node.children || []) collectNodes(child, nodes);
  return nodes;
};

const findNode = (forest, nodeId) => {
  for (const root of forest || []) {
    const match = collectNodes(root, []).find((node) => String(node.id || '') === nodeId);
    if (match) return match;
  }
  return null;
};

const loadAtlasCases = async (t) => {
  const outfile = join(tmpdir(), `babel-named-atlas-regressions-${process.pid}-${Date.now()}.mjs`);
  t.after(() => rm(outfile, { force: true }));
  await build({
    entryPoints: [`${repo}/docs/design/visual-relations-current-lab.tsx`],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent'
  });
  return import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
};

const playback = (card) => applyPreFrontingSentenceInitialCasing(
  buildPlaybackStepsFromDerivationFrames(
    adaptDerivationStagesForReplay(card.derivationStages || []),
    card.sentence,
    buildDerivationReplayPlan({ derivationStages: card.derivationStages || [] })
  ),
  card.sentence
);

const cardNamed = (rawCases, title) => {
  const card = rawCases.find((candidate) => candidate.title === title);
  assert.ok(card, `missing Atlas card: ${title}`);
  return card;
};

const exactRelationStepIndex = (steps, stageIndex, relationIndex) => steps.findIndex((step) => (
  step.replayKind === 'relation'
  && step.replayRelationIdentity?.stageIndex === stageIndex
  && step.replayRelationIdentity?.relationIndex === relationIndex
));

const isTraceSurface = (value) => /^t(?:[₀-₉]+|[_-](?:\{?[A-Za-z0-9]+\}?|\[[A-Za-z0-9]+\]|\([A-Za-z0-9]+\))|\p{Lm}+)?$/u.test(
  String(value || '').trim()
);

const visibleTraceSurfaces = (step) => {
  const visibleIds = new Set(step?.replayVisibleNodeIds || []);
  return collectNodes(step?.replayCanvasData, [])
    .filter((node) => !(node.children || []).length)
    .filter((node) => visibleIds.has(String(node.id || '')))
    .map((node) => String(node.word || node.label || '').trim())
    .filter(isTraceSurface);
};

const layoutPositions = (canvas) => {
  const hierarchy = d3.hierarchy(structuredClone(canvas));
  applyVizIds(hierarchy);
  const laidOut = d3.tree()
    .size([1200, 900])
    .separation((a, b) => (a.parent === b.parent ? 2.5 : 3.5))(hierarchy);
  return new Map(
    laidOut.descendants().map((entry) => [getNodeId(entry), [entry.x, entry.y]])
  );
};

test('registered name normalization preserves every covert movement moment and visible tree', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const cards = rawCases.filter(card => card.derivationStages?.some(stage =>
    stage.relations.some(relation => relation.relation === 'QuantifierRaising')));
  assert.ok(cards.length > 0);
  const visibleFrames = steps => steps.map(step => ({
    kind: step.replayKind, stage: step.replayFrameIndex,
    relationIndex: step.replayRelationIdentity?.relationIndex,
    visible: step.replayVisibleNodeIds,
    tree: collectNodes(step.replayCanvasData, []).map(node => ({
      id: node.id, children: node.children?.map(child => child.id),
      label: node.label, word: node.word, silent: node.silent
    }))
  }));
  for (const card of cards) {
    const expected = visibleFrames(playback(card));
    for (const name of ['QUANTIFIERRAISING', '  QuantifierRaising  ']) {
      const changed = structuredClone(card);
      changed.derivationStages.forEach(stage => stage.relations.forEach(relation => {
        if (relation.relation === 'QuantifierRaising') relation.relation = name;
      }));
      assert.deepEqual(visibleFrames(playback(changed)), expected, `${card.title}: ${name}`);
    }
  }
});

test('PF spell-out and the archived ACD composition reveal tree changes only at their owning relation moment', async (t) => {
  const { rawCases } = await loadAtlasCases(t);

  const spelloutSteps = playback(cardNamed(rawCases, 'Phrasal Spell-Out'));
  const spelloutIndex = exactRelationStepIndex(spelloutSteps, 1, 0);
  assert.ok(spelloutIndex > 0);
  const spelloutBefore = collectNodes(spelloutSteps[spelloutIndex - 1].replayCanvasData, [])
    .find((candidate) => candidate.id === 'n_mira_phrasal_spellout');
  const spelloutAtRelation = collectNodes(spelloutSteps[spelloutIndex].replayCanvasData, [])
    .find((candidate) => candidate.id === 'n_mira_phrasal_spellout');
  assert.equal(spelloutBefore?.word || spelloutBefore?.label, '√MIRA');
  assert.equal(spelloutAtRelation?.word || spelloutAtRelation?.label, 'Mirának');

  const acdSteps = playback(cardNamed(rawCases, 'Antecedent-Contained Deletion'));
  const acdIndex = exactRelationStepIndex(acdSteps, 1, 0);
  assert.ok(acdIndex > 0);
  assert.equal(
    new Set(acdSteps[acdIndex - 1].replayVisibleNodeIds).has('qp_high_acd'),
    false,
    'the LF landing must not be constructed before QuantifierRaising'
  );
  assert.equal(
    new Set(acdSteps[acdIndex].replayVisibleNodeIds).has('qp_high_acd'),
    true,
    'QuantifierRaising owns the covert QP transition'
  );
});

test('reported movement cards base-generate lexical material before any trace exists', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  for (const title of [
    'Anti-Locality (too short)',
    'Anti-Locality (facilitated)',
    'Improper Movement (CP origin)',
    'Remnant Movement',
    'Across-the-Board Movement'
  ]) {
    const baseMicrosteps = playback(cardNamed(rawCases, title)).filter((step) => (
      step.replayFrameIndex === 0 && step.replayKind === 'micro'
    ));
    assert.ok(baseMicrosteps.length > 0, `${title}: missing explicit base-generation microsteps`);
    baseMicrosteps.forEach((step) => {
      assert.equal(isTraceSurface(step.targetLabel), false, `${title}: selected trace ${step.targetLabel}`);
      assert.equal(
        (step.sourceLabels || []).some(isTraceSurface),
        false,
        `${title}: built a trace source before movement`
      );
    });
  }

  for (const title of ['Anti-Locality (too short)', 'Anti-Locality (facilitated)']) {
    const antiLocalitySteps = playback(cardNamed(rawCases, title));
    const headMovementIndex = exactRelationStepIndex(antiLocalitySteps, 1, 0);
    const phraseMovementIndex = exactRelationStepIndex(antiLocalitySteps, 2, 0);
    assert.ok(headMovementIndex > 0, `${title}: missing HeadMove relation step`);
    assert.ok(phraseMovementIndex > headMovementIndex, `${title}: missing later AMove relation step`);
    assert.deepEqual(
      visibleTraceSurfaces(antiLocalitySteps[headMovementIndex - 1]),
      [],
      `${title}: no trace may exist before HeadMove`
    );
    assert.deepEqual(
      visibleTraceSurfaces(antiLocalitySteps[headMovementIndex]),
      ['t₁'],
      `${title}: HeadMove must introduce only numeric trace t₁`
    );
    assert.deepEqual(
      visibleTraceSurfaces(antiLocalitySteps[phraseMovementIndex - 1]),
      ['t₁'],
      `${title}: the DP trace must remain absent before AMove`
    );
    assert.deepEqual(
      visibleTraceSurfaces(antiLocalitySteps[phraseMovementIndex]),
      ['t₁', 't₂', 't₂'],
      `${title}: AMove must add only the numeric DP trace chain t₂`
    );
  }

  const improperSteps = playback(cardNamed(rawCases, 'Improper Movement (CP origin)'));
  assert.deepEqual(
    improperSteps.filter((step) => step.replayFrameIndex === 1).map((step) => step.replayKind),
    ['relation', 'macro'],
    'the movement stage must not destroy and structurally rebuild the completed base tree'
  );
  assert.deepEqual(
    improperSteps.filter((step) => step.replayFrameIndex === 2).map((step) => step.replayKind),
    ['relation', 'macro'],
    'the diagnostic stage must judge the existing chain without rebuilding syntax'
  );
  const improperMovementIndex = exactRelationStepIndex(improperSteps, 1, 0);
  const beforeImproperMovement = improperSteps[improperMovementIndex - 1];
  const atImproperMovement = improperSteps[improperMovementIndex];
  assert.equal(beforeImproperMovement.replayUsesFutureLayoutScaffold, true);
  assert.equal(
    findNode([beforeImproperMovement.replayCanvasData], 'cp_clause_high_improper_cp')?.replayLayoutOnly,
    true,
    'the future matrix landing must reserve geometry without becoming visible'
  );
  for (const nodeId of [
    'n_mia_improper_cp',
    'v_believed_improper_cp',
    'n_noa_low_improper_cp',
    'v_left_low_improper_cp'
  ]) {
    assert.equal(
      beforeImproperMovement.replayVisibleNodeIds?.includes(nodeId),
      true,
      `Improper Movement dropped ${nodeId} before its relation moment`
    );
  }
  const beforeImproperPositions = layoutPositions(beforeImproperMovement.replayCanvasData);
  const atImproperPositions = layoutPositions(atImproperMovement.replayCanvasData);
  for (const nodeId of [
    'cbar_improper_cp_root',
    'tp_improper_cp_matrix',
    'v_believed_improper_cp',
    'cp_clause_low_improper_cp',
    'n_noa_low_improper_cp',
    'v_left_low_improper_cp'
  ]) {
    assert.deepEqual(
      beforeImproperPositions.get(nodeId),
      atImproperPositions.get(nodeId),
      `Improper Movement shifted ${nodeId} when the landing appeared`
    );
  }
});

test('movement trace display accepts numeric indices only', async (t) => {
  assert.equal(isTraceLike('tᵥ'), true, 'legacy letter-subscript surfaces must still be recognized as traces');
  assert.equal(buildTraceDisplayLabel('v'), 't', 'the renderer must never synthesize a letter-indexed trace');
  assert.equal(buildTraceDisplayLabel('ᵥ'), 't');
  assert.equal(formatAuthoredWitnessSurface('tᵥ'), 't');
  assert.equal(formatAuthoredWitnessSurface('tᵥ', '2'), 't₂');
  assert.equal(isDisplayTraceLabel('tᵥ'), false);
  assert.equal(isDisplayTraceLabel('t₂'), true);

  const { rawCases } = await loadAtlasCases(t);
  const final = playback(cardNamed(rawCases, 'Anti-Locality (too short)')).at(-1);
  const legacyForest = structuredClone(final.replayCanvasData);
  const legacyHeadTrace = findNode([legacyForest], 'v_photographs_low_anti_short');
  assert.ok(legacyHeadTrace);
  legacyHeadTrace.word = 'tᵥ';
  const legacyIndexMap = buildResolvedLinkTraceIndexMap(
    [legacyForest],
    final.replayRelationLinks,
    Number.MAX_SAFE_INTEGER
  );
  assert.equal(
    legacyIndexMap.get('v_photographs_low_anti_short'),
    '1',
    'legacy letter indices must yield to the numeric movement-chain fallback'
  );
});

test('Sluicing workspaces retain their future-layout coordinates through final External Merge', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const steps = playback(cardNamed(rawCases, 'Ellipsis / Sluicing'));
  const checkpoints = [0, 1, 2].map((frameIndex) => (
    steps.find((step) => step.replayFrameIndex === frameIndex && step.replayKind === 'macro')
  ));
  const before = steps.find((step) => step.replayFrameIndex === 2 && step.replayKind === 'macro');
  const after = steps.find((step) => step.replayFrameIndex === 3);
  assert.ok(checkpoints.every(Boolean) && before && after);
  checkpoints.forEach((step) => assert.equal(step.replayUsesFutureLayoutScaffold, true));
  assert.equal(before.replayUsesFutureLayoutScaffold, true);
  const afterPositions = layoutPositions(after.replayCanvasData);
  for (const step of checkpoints) {
    const checkpointPositions = layoutPositions(step.replayCanvasData);
    for (const nodeId of ['tp_sluice_antecedent', 'cbar_sluice', 'tp_sluice_site']) {
      assert.deepEqual(
        checkpointPositions.get(nodeId),
        afterPositions.get(nodeId),
        `${nodeId} changed position between detached frame ${step.replayFrameIndex} and final composition`
      );
    }
  }
});

test('Identity reserves one authored outer-wrapper layout across its movement boundaries', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const steps = playback(cardNamed(rawCases, 'Identity / Copy Chain'));
  const checkpoints = [
    steps.find((step) => step.replayFrameIndex === 0 && step.replayKind === 'macro'),
    steps.find((step) => step.replayFrameIndex === 1 && step.replayKind === 'relation'),
    steps.find((step) => step.replayFrameIndex === 2 && step.replayKind === 'macro'),
    steps.find((step) => step.replayFrameIndex === 3 && step.replayKind === 'relation'),
    steps.find((step) => (
      step.replayFrameIndex === 4
      && step.replayKind === 'relation'
      && step.replayRelationIdentity?.relationIndex === 0
    ))
  ];
  assert.ok(checkpoints.every(Boolean), 'Identity is missing a stage-boundary checkpoint');
  checkpoints.slice(0, -1).forEach((step) => {
    assert.equal(step.replayUsesFutureLayoutScaffold, true);
  });
  assert.equal(checkpoints.at(-1).replayUsesFutureLayoutScaffold, false);

  const baseStep = checkpoints[0];
  assert.equal(findNode([baseStep.replayCanvasData], 'cp_identity')?.replayLayoutOnly, true);
  assert.equal(findNode([baseStep.replayCanvasData], 'dp_book_high')?.replayLayoutOnly, true);
  assert.equal(baseStep.replayVisibleNodeIds?.includes('cp_identity'), false);
  assert.equal(baseStep.replayVisibleNodeIds?.includes('dp_book_high'), false);
  assert.equal(findNode([baseStep.replayCanvasData], 'd_book_file_trace')?.word, 'Which');
  assert.notEqual(findNode([baseStep.replayCanvasData], 'd_book_file_trace')?.silent, true);

  const stableNodeIds = [
    'cbar_embedded_identity',
    'c_that_identity',
    'tp_embedded_identity',
    'subj_noa_identity',
    'vp_file_identity',
    'dp_book_file_gap'
  ];
  const basePositions = layoutPositions(baseStep.replayCanvasData);
  checkpoints.slice(1).forEach((step) => {
    const positions = layoutPositions(step.replayCanvasData);
    stableNodeIds.forEach((nodeId) => {
      assert.deepEqual(
        positions.get(nodeId),
        basePositions.get(nodeId),
        `Identity shifted ${nodeId} at frame ${step.replayFrameIndex}`
      );
    });
  });
});

test('Across-the-Board reserves its matrix wrapper before the shared movement appears', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const steps = playback(cardNamed(rawCases, 'Across-the-Board Movement'));
  const checkpoints = [
    steps.find((step) => step.replayFrameIndex === 0 && step.replayKind === 'macro'),
    steps.find((step) => step.replayFrameIndex === 1 && step.replayKind === 'relation'),
    steps.find((step) => step.replayFrameIndex === 2 && step.replayKind === 'macro')
  ];
  assert.ok(checkpoints.every(Boolean), 'Across-the-Board is missing a stage-boundary checkpoint');
  assert.equal(checkpoints[0].replayUsesFutureLayoutScaffold, true);
  assert.equal(checkpoints[1].replayUsesFutureLayoutScaffold, true);
  assert.equal(checkpoints[2].replayUsesFutureLayoutScaffold, false);

  const baseStep = checkpoints[0];
  assert.equal(findNode([baseStep.replayCanvasData], 'tp_atb')?.replayLayoutOnly, true);
  assert.equal(findNode([baseStep.replayCanvasData], 'dp_who_atb')?.replayLayoutOnly, true);
  assert.equal(baseStep.replayVisibleNodeIds?.includes('tp_atb'), false);
  assert.equal(baseStep.replayVisibleNodeIds?.includes('dp_who_atb'), false);

  const stableNodeIds = [
    'cbar_embedded_atb',
    'coordp_atb',
    'tp_left_atb',
    'dp_jack_atb',
    'vp_left_atb',
    'tp_right_atb',
    'dp_mary_atb',
    'vp_right_atb'
  ];
  const basePositions = layoutPositions(baseStep.replayCanvasData);
  checkpoints.slice(1).forEach((step) => {
    const positions = layoutPositions(step.replayCanvasData);
    stableNodeIds.forEach((nodeId) => {
      assert.deepEqual(
        positions.get(nodeId),
        basePositions.get(nodeId),
        `Across-the-Board shifted ${nodeId} at frame ${step.replayFrameIndex}`
      );
    });
  });
});

test('Sluicing composes only ordinary movement and ordinary ellipsis', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const sluicing = cardNamed(rawCases, 'Ellipsis / Sluicing');
  assert.deepEqual(
    sluicing.derivationStages.flatMap((stage) => stage.relations.map((relation) => relation.relation)),
    ['AbarMove', 'Ellipsis']
  );
  assert.equal(
    findNode(sluicing.derivationStages[2].workspaceForest, 'tp_sluice_site')?.silent,
    true,
    'the ordinary Ellipsis moment owns the silent TP'
  );
  assert.equal(rawCases.some((card) => card.title === 'Ellipsis Licensing'), false);
});

test('named Atlas regressions keep traces, movement hosts, casing, and copy states honest', async (t) => {
  const { rawCases, canonicalCases } = await loadAtlasCases(t);

  canonicalCases.forEach((card) => {
    assert.match(
      String(card.sentence || '').trim(),
      /^\p{Lu}/u,
      `${card.title}: canonical sentence must begin with uppercase lexical material`
    );
  });

  assert.equal(
    maybeLowercaseSentenceInitialFunctionSurface({
      surface: 'The',
      sentenceInitialSurface: 'The',
      nodeId: 'determiner',
      parentLabel: 'D',
      tokenIndex: 0,
      visibleOvertLeafIds: ['arrived', 'determiner'],
      isWorkspaceForest: true,
      hasNominalComplement: true
    }),
    'The',
    'an authored sentence-initial token keeps its case in a detached workspace'
  );
  assert.equal(
    maybeLowercaseSentenceInitialFunctionSurface({
      surface: 'The',
      sentenceInitialSurface: 'The',
      nodeId: 'determiner',
      parentLabel: 'D',
      visibleOvertLeafIds: ['determiner', 'arrived'],
      isWorkspaceForest: true,
      hasNominalComplement: true
    }),
    'The',
    'an unindexed first visible token keeps its authored case'
  );
  assert.equal(
    maybeLowercaseSentenceInitialFunctionSurface({
      surface: 'The',
      sentenceInitialSurface: 'The',
      nodeId: 'determiner',
      parentLabel: 'D',
      visibleOvertLeafIds: ['arrived', 'determiner'],
      isWorkspaceForest: true,
      hasNominalComplement: true
    }),
    'The',
    'an exactly authored sentence-initial form is never recased by construction order'
  );
  assert.equal(
    maybeLowercaseSentenceInitialFunctionSurface({
      surface: 'The',
      sentenceInitialSurface: 'The',
      nodeId: 'determiner',
      parentLabel: 'D',
      tokenIndex: 0,
      visibleOvertLeafIds: ['arrived', 'determiner'],
      hasNominalComplement: true
    }),
    'the',
    'an input-initial determiner is lowercase while pronounced after the verb'
  );
  assert.equal(
    maybeLowercaseSentenceInitialFunctionSurface({
      surface: 'That',
      sentenceInitialSurface: 'That',
      nodeId: 'complementizer',
      parentLabel: 'C',
      tokenIndex: 0,
      visibleOvertLeafIds: ['matrix-subject', 'matrix-verb', 'complementizer']
    }),
    'that',
    'an input-initial complementizer is lowercase while its CP remains a complement'
  );
  assert.equal(
    maybeLowercaseSentenceInitialFunctionSurface({
      surface: 'Noa',
      sentenceInitialSurface: 'Noa',
      nodeId: 'proper-name',
      parentLabel: 'N',
      tokenIndex: 0,
      visibleOvertLeafIds: ['verb', 'proper-name']
    }),
    'Noa',
    'proper names are not sentence-case morphology'
  );
  assert.equal(
    maybeLowercaseSentenceInitialFunctionSurface({
      surface: 'which',
      sentenceInitialSurface: 'Which',
      nodeId: 'lower-copy',
      parentLabel: 'D',
      tokenIndex: 0,
      visibleOvertLeafIds: ['lower-copy'],
      isWorkspaceForest: true,
      hasNominalComplement: true
    }),
    'which',
    'a genuine pre-fronting lowercase form remains lowercase'
  );

  for (const [title, nodeId, expectedSurface] of [
    ['Agree / Feature Valuation', 'd_girls::__leaf', 'The'],
    ['Multiple Agree', 'd_we_multiple_agree::__leaf', 'We'],
    ['Anti-Locality (too short)', 'd_the_high_anti_short::__leaf', 'the'],
    ['Feature Sharing', 'd_feature_sharing::__leaf', 'The'],
    ['Case Assignment / Feature Collection', 'p_case_assignment::__leaf', 'Af'],
    ['Deletion (structured DP)', 'd_the_deletion_contrast::__lex_tok_0_the', 'The']
  ]) {
    const lexicalStep = playback(cardNamed(rawCases, title)).find((step) => step.targetNodeId === nodeId);
    assert.equal(lexicalStep?.targetLabel, expectedSurface, `${title}: lexical selection casing drifted`);
    assert.deepEqual(lexicalStep?.sourceLabels, [expectedSurface], `${title}: replay source casing drifted`);
  }

  const multipleAgree = cardNamed(rawCases, 'Multiple Agree');
  const multipleAgreeSteps = playback(multipleAgree);
  const multipleAgreeRelationIndex = exactRelationStepIndex(multipleAgreeSteps, 0, 0);
  const multipleAgreeRelationCanvas = multipleAgreeSteps[multipleAgreeRelationIndex]?.replayCanvasData;
  assert.equal(
    collectPronouncedLeafNodeIdsInOrder(multipleAgreeRelationCanvas)[0],
    'd_we_multiple_agree::__leaf',
    'a silent probe must not displace We as the first pronounced relation-frame leaf'
  );
  assert.equal(
    findNode([multipleAgreeRelationCanvas], 'd_we_multiple_agree::__leaf')?.word,
    'We',
    'Multiple Agree must preserve sentence-initial We during its relation frame'
  );

  const embeddedMultipleAgree = cardNamed(rawCases, 'Multiple Agree (embedded clause)');
  const embeddedMultipleAgreeSteps = playback(embeddedMultipleAgree);
  const embeddedMultipleAgreeRelationIndex = exactRelationStepIndex(embeddedMultipleAgreeSteps, 1, 0);
  assert.equal(
    findNode(
      [embeddedMultipleAgreeSteps[embeddedMultipleAgreeRelationIndex]?.replayCanvasData],
      'd_we_multiple_agree_embedded::__leaf'
    )?.word,
    'we',
    'embedded noninitial we must remain lowercase'
  );

  for (const title of ['Dependent Case (low)', 'Dependent Case (high)']) {
    const dependentCase = cardNamed(rawCases, title);
    const probeId = title.endsWith('(low)')
      ? 't_probe_low_dependent_case'
      : 'v_probe_high_dependent_case';
    const subjectLeafId = title.endsWith('(low)')
      ? 'd_aya_low_dependent_case::__leaf'
      : 'd_aya_high_dependent_case::__leaf';
    const probe = findNode(dependentCase.derivationStages[0].workspaceForest, probeId);
    assert.equal(probe?.silent, true, `${title}: [uφ] probe must be unpronounced`);
    assert.equal(probe?.children?.[0]?.silent, true, `${title}: [uφ] terminal must render muted`);
    const relationIndex = exactRelationStepIndex(playback(dependentCase), 0, 0);
    const relationCanvas = playback(dependentCase)[relationIndex]?.replayCanvasData;
    assert.equal(
      collectPronouncedLeafNodeIdsInOrder(relationCanvas)[0],
      subjectLeafId,
      `${title}: Aya must remain the first pronounced leaf`
    );
    assert.equal(findNode([relationCanvas], subjectLeafId)?.word, 'Aya', `${title}: Aya casing drifted`);
  }

  const control = cardNamed(rawCases, 'Control Dependency (object control)');
  const controlNodes = control.derivationStages.flatMap((stage) => (
    stage.workspaceForest.flatMap((root) => collectNodes(root, []))
  ));
  assert.equal(controlNodes.some((node) => /trace/i.test(String(node.id || ''))), false);
  assert.equal(controlNodes.some((node) => /^t(?:[_₀-₉\d]+)?$/i.test(String(node.word || '').trim())), false);
  assert.equal(control.derivationStages.some((stage) => (
    stage.relations.some((relation) => /move/i.test(relation.relation))
  )), false);

  const cyclicAgree = cardNamed(rawCases, 'Cyclic Agree (embedded clause)');
  assert.deepEqual(
    cyclicAgree.derivationStages.map((stage) => stage.workspaceForest[0]?.label),
    ["v'", 'vP', 'CP']
  );
  assert.equal(findNode(cyclicAgree.derivationStages[0].workspaceForest, 'cp_cyclic_agree_embedded'), null);
  assert.equal(findNode(cyclicAgree.derivationStages[1].workspaceForest, 'cp_cyclic_agree_embedded'), null);
  assert.ok(findNode(cyclicAgree.derivationStages[2].workspaceForest, 'cp_cyclic_agree_embedded'));

  const cyclicLinearization = cardNamed(rawCases, 'Cyclic Linearization / Edge Movement');
  assert.equal(cyclicLinearization.derivationStages[0].workspaceForest[0]?.label, "C'");
  assert.equal(findNode(cyclicLinearization.derivationStages[0].workspaceForest, 'cp_cyclic_licensed'), null);
  assert.equal(cyclicLinearization.derivationStages.length, 3);
  assert.equal(cyclicLinearization.derivationStages[0].relations[0]?.relation, 'AbarMove');
  assert.equal(cyclicLinearization.derivationStages[1].relations[0]?.relation, 'AbarMove');
  assert.equal(cyclicLinearization.derivationStages[2].relations[0]?.relation, 'CyclicLinearization');
  assert.ok(cyclicLinearization.derivationStages[1].relations[0]?.anchors?.pronouncedCopy);
  assert.equal(cyclicLinearization.derivationStages[1].relations[0]?.anchors?.order, undefined);
  assert.ok(cyclicLinearization.derivationStages[2].relations[0]?.anchors?.order);
  assert.equal(cyclicLinearization.derivationStages[2].relations[0]?.anchors?.pronouncedCopy, undefined);

  const cyclicConflict = cardNamed(rawCases, 'Cyclic Linearization / Order Conflict');
  assert.equal(cyclicConflict.derivationStages[0].workspaceForest[0]?.label, "C'");
  assert.equal(findNode(cyclicConflict.derivationStages[0].workspaceForest, 'cp_cyclic_conflict'), null);
  assert.equal(cyclicConflict.derivationStages[1].relations[0]?.relation, 'AbarMove');
  assert.equal(cyclicConflict.derivationStages[2].relations[0]?.relation, 'CyclicLinearization');
  assert.ok(cyclicConflict.derivationStages[1].relations[0]?.anchors?.pronouncedCopy);
  assert.equal(cyclicConflict.derivationStages[1].relations[0]?.anchors?.order, undefined);
  assert.ok(cyclicConflict.derivationStages[2].relations[0]?.anchors?.order);
  const cyclicConflictSteps = playback(cyclicConflict);
  const cyclicConflictMovementIndex = exactRelationStepIndex(cyclicConflictSteps, 1, 0);
  assert.ok(cyclicConflictSteps[cyclicConflictMovementIndex]?.replayVisibleNodeIds?.includes('cp_cyclic_conflict'));
  assert.equal(cyclicConflictSteps.slice(0, cyclicConflictMovementIndex).some((step) => (
    ['Project', 'ExternalMerge'].includes(String(step.operation || ''))
    && String(step.targetNodeId || '').replace(/::__leaf$/, '') === 'cp_cyclic_conflict'
  )), false);

  const stagedSluicing = cardNamed(rawCases, 'Ellipsis / Sluicing');
  assert.deepEqual(stagedSluicing.derivationStages[0].relations, []);
  assert.equal(findNode(stagedSluicing.derivationStages[0].workspaceForest, 'why_sluice_low'), null);
  assert.ok(findNode(stagedSluicing.derivationStages[1].workspaceForest, 'why_sluice_low'));
  assert.ok(exactRelationStepIndex(playback(stagedSluicing), 1, 0) >= 0);

  const orderingCases = [
    ['Remnant Escape / Pseudogapping', 0, 0, 'tbar_pseudogapping']
  ];
  for (const [title, stageIndex, relationIndex, laterTargetId] of orderingCases) {
    const steps = playback(cardNamed(rawCases, title));
    const relationStepIndex = exactRelationStepIndex(steps, stageIndex, relationIndex);
    const laterStructuralStepIndex = steps.findIndex((step) => (
      ['Project', 'ExternalMerge'].includes(String(step.operation || ''))
      && String(step.targetNodeId || '').replace(/::__leaf$/, '') === laterTargetId
    ));
    assert.ok(relationStepIndex >= 0, `${title}: missing movement relation step`);
    assert.ok(laterStructuralStepIndex > relationStepIndex, `${title}: ancestor appeared before movement`);
  }
  const remnantSteps = playback(cardNamed(rawCases, 'Remnant Movement'));
  assert.ok(exactRelationStepIndex(remnantSteps, 1, 0) >= 0);
  assert.equal(
    remnantSteps.some((step) => step.replayFrameIndex === 1 && step.replayKind === 'micro'),
    false,
    'the evacuation stage must move the completed base object without rebuilding syntax'
  );

  const cyclicSteps = playback(cyclicLinearization);
  const cyclicMovementIndex = exactRelationStepIndex(cyclicSteps, 1, 0);
  assert.equal(cyclicSteps[cyclicMovementIndex]?.targetNodeId, 'dp_which_book_cyclic_licensed_high');
  assert.ok(cyclicSteps[cyclicMovementIndex]?.replayVisibleNodeIds?.includes('cp_cyclic_licensed'));
  assert.equal(cyclicSteps.slice(0, cyclicMovementIndex).some((step) => (
    ['Project', 'ExternalMerge'].includes(String(step.operation || ''))
    && String(step.targetNodeId || '').replace(/::__leaf$/, '') === 'cp_cyclic_licensed'
  )), false);
  const cyclicOrderingIndex = exactRelationStepIndex(cyclicSteps, 2, 0);
  assert.ok(cyclicOrderingIndex > cyclicMovementIndex);
  assert.equal(cyclicSteps[cyclicMovementIndex]?.detailBlocks?.some((block) => (
    block.lines?.some((line) => /ordering/i.test(line))
  )), false);

  for (const [title, relationOperation, leafId, expectedSurface] of [
    [
      'Cyclic Linearization / Edge Movement',
      'AbarMove',
      'd_which_cyclic_licensed_edge::__leaf',
      'which'
    ],
    [
      'Intervention / Relativized Minimality',
      'Intervention',
      'd_what_intervention_low__silent',
      't₂'
    ]
  ]) {
    const steps = playback(cardNamed(rawCases, title));
    const relationStepIndex = steps.findIndex((step) => step.operation === relationOperation);
    assert.ok(relationStepIndex >= 0, `${title}: missing ${relationOperation} relation step`);
    const sourceFrameIndex = steps[relationStepIndex].sourceFrameIndex;
    const retainedSurfaces = steps
      .filter((step) => step.sourceFrameIndex === sourceFrameIndex)
      .map((step) => findNode([step.replayCanvasData], leafId))
      .filter(Boolean)
      .map((leaf) => String(leaf.word || leaf.label || '').trim());
    assert.ok(retainedSurfaces.length > 1, `${title}: expected a post-relation replay state`);
    assert.deepEqual(
      [...new Set(retainedSurfaces)],
      [expectedSurface],
      `${title}: a retained noninitial occurrence changed case after its relation moment`
    );
  }

  const multiplePhaseIndex = rawCases.findIndex((card) => card.title === 'Multiple Phase Boundaries');
  const mixedPhaseIndex = rawCases.findIndex((card) => card.title === 'Phase Boundaries (nested and disjoint)');
  assert.ok(multiplePhaseIndex >= 0);
  assert.equal(mixedPhaseIndex, multiplePhaseIndex + 1, 'the mixed phase example must stay beside the phase cards');

  const headMovement = cardNamed(rawCases, 'Head Movement');
  assert.equal(findNode(headMovement.derivationStages[0].workspaceForest, 't_head_trace')?.word, 'did');
  assert.equal(findNode(headMovement.derivationStages[1].workspaceForest, 'c_head_did')?.word, 'Did');
  const uppercaseBaseHeadMovement = structuredClone(headMovement);
  findNode(uppercaseBaseHeadMovement.derivationStages[0].workspaceForest, 't_head_trace').word = 'Did';
  const uppercaseBaseHeadSteps = playback(uppercaseBaseHeadMovement);
  assert.equal(
    uppercaseBaseHeadSteps.find((step) => step.targetNodeId === 't_head_trace::__leaf')?.targetLabel,
    'did'
  );

  const sluicingSteps = playback(cardNamed(rawCases, 'Ellipsis / Sluicing'));
  const completedSluicingBaseStage = sluicingSteps.find((step) => (
    step.replayFrameIndex === 0 && step.replayKind === 'macro'
  ));
  assert.equal(completedSluicingBaseStage?.replayUsesFutureLayoutScaffold, true);
  assert.equal(
    findNode([completedSluicingBaseStage?.replayCanvasData], 'coordp_sluice')?.replayLayoutOnly,
    true,
    'the final wrapper reserves the detached clauses at their composed positions'
  );
  assert.equal(completedSluicingBaseStage?.replayVisibleNodeIds?.includes('coordp_sluice'), false);
  assert.equal(
    collectNodes(completedSluicingBaseStage?.replayCanvasData, [])
      .filter((node) => node.id === 'why_sluice').length,
    1,
    'future layout geometry must not duplicate the current why occurrence'
  );
  assert.ok(
    findNode(
      [findNode([completedSluicingBaseStage?.replayCanvasData], 'vp_sluice_site')],
      'why_sluice'
    ),
    'why must be built in its VP base position before Sluicing'
  );
  assert.equal(
    completedSluicingBaseStage?.replayVisibleNodeIds?.includes('why_sluice_low'),
    false,
    'the lower silent copy must not exist before movement'
  );
  const sluicingMovementIndex = exactRelationStepIndex(sluicingSteps, 1, 0);
  assert.ok(sluicingSteps[sluicingMovementIndex]?.replayVisibleNodeIds?.includes('tp_sluice_antecedent'));
  assert.ok(sluicingSteps[sluicingMovementIndex]?.replayVisibleNodeIds?.includes('tp_sluice_site'));
  for (const nodeId of ['v_knows_sluice', 't_sluice_second']) {
    assert.equal(sluicingSteps[sluicingMovementIndex - 1]?.replayVisibleNodeIds?.some((visibleNodeId) => (
      visibleNodeId === nodeId
      || visibleNodeId.startsWith(`${nodeId}::__`)
      || visibleNodeId === `${nodeId}__silent`
    )), false, `${nodeId} must not be built before Sluicing applies inside the embedded CP`);
    assert.equal(sluicingSteps[sluicingMovementIndex]?.replayVisibleNodeIds?.some((visibleNodeId) => (
      visibleNodeId === nodeId
      || visibleNodeId.startsWith(`${nodeId}::__`)
      || visibleNodeId === `${nodeId}__silent`
    )), false, `${nodeId} must not be introduced by the Sluicing relation`);
  }
  const completedSluicingRelationStage = sluicingSteps.find((step) => (
    step.replayFrameIndex === 1 && step.replayKind === 'macro'
  ));
  assert.equal(completedSluicingRelationStage?.replayUsesFutureLayoutScaffold, true);
  assert.equal(
    findNode([completedSluicingRelationStage?.replayCanvasData], 'coordp_sluice')?.replayLayoutOnly,
    true,
    'the completed sluice reserves the future coordination geometry without exposing it'
  );
  assert.equal(completedSluicingRelationStage?.replayVisibleNodeIds?.includes('coordp_sluice'), false);
  for (const [stageIndex, relationName] of [
    [1, 'AbarMove'],
    [2, 'Ellipsis']
  ]) {
    assert.ok(
      sluicingSteps.some((step) => (
        step.replayRelationIdentity?.stageIndex === stageIndex
        && step.operation === relationName
      )),
      `missing independent ${relationName} moment`
    );
  }
  const completedSluicing = sluicingSteps.findLast((step) => step.sourceFrameIndex === 3);
  assert.ok(completedSluicing?.replayVisibleNodeIds?.includes('v_knows_sluice'));
  assert.ok(completedSluicing?.replayVisibleNodeIds?.includes('coordp_sluice'));

  for (const title of [
    'QR / Covert Scope',
    'QR / Inverse Scope',
    'QR / Clause-Bounded Scope'
  ]) {
    const qrSteps = playback(cardNamed(rawCases, title));
    const completedSurfaceStage = qrSteps.findLast((step) => step.replayFrameIndex === 0);
    const qrRelationIndex = exactRelationStepIndex(qrSteps, 1, 0);
    assert.ok(completedSurfaceStage, `${title}: missing completed surface stage`);
    assert.ok(qrRelationIndex >= 0, `${title}: missing QuantifierRaising relation step`);

    const surfaceNodeIds = new Set(completedSurfaceStage.replayVisibleNodeIds || []);
    qrSteps
      .slice(qrSteps.indexOf(completedSurfaceStage) + 1)
      .filter((step) => step.replayFrameIndex === 1)
      .forEach((step) => {
        const visibleNodeIds = new Set(step.replayVisibleNodeIds || []);
        surfaceNodeIds.forEach((nodeId) => {
          assert.equal(
            visibleNodeIds.has(nodeId),
            true,
            `${title}: ${nodeId} disappeared during ${step.operation}`
          );
        });
      });

    assert.equal(
      qrSteps.slice(qrSteps.indexOf(completedSurfaceStage) + 1, qrRelationIndex).some((step) => (
        ['LexicalSelect', 'Project', 'ExternalMerge'].includes(String(step.operation || ''))
      )),
      false,
      `${title}: Replay base-generated the LF landing before QuantifierRaising`
    );
  }

  for (const [title, nodeId, expectedName] of [
    ['Control Dependency (object control)', 'mia_ctrl2_n::__leaf', 'Mia'],
    ['Ellipsis / Sluicing', 'mia_sluice_n::__leaf', 'Mia'],
    ['Remnant Escape / Pseudogapping', 'n_mary_pseudogapping::__leaf', 'Mary'],
    ['Antecedent-Contained Deletion', 'd_john_acd::__leaf', 'John'],
    ['Split Antecedence', 'd_kyle_split_antecedence::__leaf', 'Kyle'],
    ['Phase Boundaries (nested and disjoint)', 'd_lena_edge_phase_stress::__leaf', 'Lena']
  ]) {
    const lexicalStep = playback(cardNamed(rawCases, title)).find((step) => step.targetNodeId === nodeId);
    assert.equal(lexicalStep?.targetLabel, expectedName, `${title}: proper name casing drifted`);
  }

  const partial = cardNamed(rawCases, 'Partial Copy Deletion (Resumptive D)');
  const lowerDByStage = partial.derivationStages.map((stage) => (
    findNode(stage.workspaceForest, 'd_di_low_resumptive_partial_copy')
  ));
  assert.deepEqual(lowerDByStage.map((node) => node?.lineageId), [
    'resumptive-book-d',
    'resumptive-book-d',
    'resumptive-book-d',
    'resumptive-book-d',
    'resumptive-book-d'
  ]);
  assert.equal(lowerDByStage[3]?.label, 'D');
  assert.equal(lowerDByStage[3]?.children?.[0]?.label, '[D]');
  assert.equal(lowerDByStage[3]?.silent, true);
  assert.equal(
    findNode(partial.derivationStages[3].workspaceForest, 'np_book_low_resumptive_partial_copy')?.silent,
    true
  );
  assert.equal(lowerDByStage[4]?.word, 'keoi');
  assert.equal(partial.derivationStages[4].relations[0]?.relation, 'VocabularyInsertion');
  const partialSteps = playback(partial);
  const partialRelationIndex = exactRelationStepIndex(partialSteps, 1, 0);
  for (const nodeId of ['t_jiu_resumptive_partial_copy', 'disp_zoeng_resumptive_partial_copy']) {
    assert.equal(
      partialSteps.slice(0, partialRelationIndex + 1).some((step) => (
        step.replayVisibleNodeIds?.includes(nodeId)
      )),
      false,
      `${nodeId} must be selected only after the lower vP and object movement are complete`
    );
  }
  const completedUpperSpine = partialSteps.findLast((step) => step.sourceFrameIndex === 2);
  assert.ok(completedUpperSpine?.replayVisibleNodeIds?.includes('t_jiu_resumptive_partial_copy'));
  assert.ok(completedUpperSpine?.replayVisibleNodeIds?.includes('disp_zoeng_resumptive_partial_copy'));
  const neiSelection = partialSteps.find((step) => (
    step.targetNodeId === 'd_nei_resumptive_partial_copy::__leaf'
  ));
  assert.equal(neiSelection?.targetLabel, 'Nei');
  assert.deepEqual(neiSelection?.sourceLabels, ['Nei']);

  for (const [title, expectedOperatorCounts] of [
    ['Operator / Variable Binding', { every: 2, some: 1 }],
    ['Operator / Variable Binding (subject variable)', { who: 1 }]
  ]) {
    const operatorCard = cardNamed(rawCases, title);
    const baseNodes = operatorCard.derivationStages[0].workspaceForest.flatMap((root) => collectNodes(root, []));
    assert.equal(baseNodes.some((node) => (
      !(node.children || []).length
      && !node.silent
      && /^t$/i.test(String(node.word || node.label || '').trim())
    )), false);
    const words = baseNodes.map((node) => String(node.word || '').trim().toLowerCase()).filter(Boolean);
    Object.entries(expectedOperatorCounts).forEach(([operator, count]) => {
      assert.equal(
        words.filter((word) => word === operator).length,
        count,
        `${title} must retain its ${count} pronounced ${operator} operator${count === 1 ? '' : 's'}`
      );
    });
  }
  const overtVariableCard = cardNamed(rawCases, 'Operator / Variable Binding');
  const overtVariableStage = overtVariableCard.derivationStages[0];
  const overtVariableRelations = overtVariableStage.relations.filter((relation) => (
    relation.relation === 'OperatorVariableBinding'
  ));
  assert.equal(overtVariableRelations.length, 3);
  assert.ok(overtVariableRelations.every((relation) => !relation.anchors.traceWitness));
  for (const relation of overtVariableRelations) {
    const variable = findNode(overtVariableStage.workspaceForest, relation.anchors.variable);
    assert.equal(variable?.word, 'their');
    assert.equal(variable?.silent, undefined);
  }
  const overtVariableNodes = overtVariableStage.workspaceForest.flatMap((root) => collectNodes(root, []));
  assert.equal(overtVariableNodes.some((node) => String(node.label || '').trim() === 't'), false);

  assert.equal(
    cardNamed(rawCases, 'Pair Merge (lexical member)').derivationStages.length,
    1,
    'the lexical Pair Merge card is one complete authored stage'
  );

  const acrossTheBoard = cardNamed(rawCases, 'Across-the-Board Movement');
  assert.equal(acrossTheBoard.derivationStages.length, 3);
  assert.equal(findNode(acrossTheBoard.derivationStages[0].workspaceForest, 'v_know_atb'), null);
  assert.equal(findNode(acrossTheBoard.derivationStages[1].workspaceForest, 'v_know_atb'), null);
  assert.ok(findNode(acrossTheBoard.derivationStages[2].workspaceForest, 'v_know_atb'));

  for (const [title, prefix] of [
    ['Parasitic Gap in a Subject Island (connected)', 'licensed'],
    ['Parasitic Gap in a Subject Island (blocked)', 'blocked']
  ]) {
    const islandCard = cardNamed(rawCases, title);
    const baseForest = islandCard.derivationStages[0].workspaceForest;
    const finalForest = islandCard.derivationStages[1].workspaceForest;
    assert.equal(findNode(baseForest, `d_which_pg_island_${prefix}`)?.word, 'which');
    assert.equal(findNode(baseForest, `n_monument_pg_island_${prefix}`)?.word, 'monument');
    assert.ok(findNode(finalForest, `np_real_pg_island_${prefix}`));
    assert.ok(findNode(finalForest, `n_real_pg_island_${prefix}`));
    const islandSteps = playback(islandCard);
    const relationIndex = exactRelationStepIndex(islandSteps, 1, 0);
    assert.equal(
      findNode([islandSteps[relationIndex - 1]?.replayCanvasData], `d_which_pg_island_${prefix}`)?.word,
      'which'
    );
    assert.ok(findNode(
      [islandSteps[relationIndex]?.replayCanvasData],
      `n_real_pg_island_${prefix}`
    ));
  }

  const remnant = playback(cardNamed(rawCases, 'Remnant Movement'));
  const remnantMovementIndex = remnant.findLastIndex((step) => step.operation === 'RemnantMovement');
  assert.ok(remnantMovementIndex > 0);
  const preFrontingAuf = findNode([remnant[remnantMovementIndex - 1]?.replayCanvasData], 'p_auf_rt::__leaf');
  const frontedAuf = findNode([remnant[remnantMovementIndex]?.replayCanvasData], 'p_auf_rt::__leaf');
  assert.equal(
    preFrontingAuf?.word,
    'auf',
    'the PP-internal source stays lowercase before remnant fronting'
  );
  assert.equal(preFrontingAuf?.label, 'auf', 'pre-fronting lexical data must match its rendered surface');
  assert.equal(
    frontedAuf?.word,
    'Auf',
    'the moved first-position occurrence receives sentence-initial capitalization'
  );
  assert.equal(frontedAuf?.label, 'Auf', 'fronted lexical data must match its rendered surface');

  for (const [title, leafId, lowerSurface, frontedSurface, stageCount] of [
    ['Anti-Locality (too short)', 'd_the_high_anti_short::__leaf', 'the', 'The', 4],
    ['Improper Movement (CP origin)', 'c_that_low_improper_cp', 'that', 'That', 3]
  ]) {
    const steps = playback(cardNamed(rawCases, title));
    const baseStage = steps.findLast((step) => (
      String(step.replayProgressLabel || '').startsWith(`Stage 1/${stageCount}`)
    ));
    const baseOccurrence = findNode([baseStage?.replayCanvasData], leafId);
    const baseSurfaceNode = title === 'Improper Movement (CP origin)'
      ? collectNodes(baseOccurrence, []).find((node) => (node.children || []).length === 0)
      : baseOccurrence;
    assert.equal(
      baseSurfaceNode?.word || baseSurfaceNode?.label,
      lowerSurface,
      `${title}: the pronounced lower occurrence must follow its current position`
    );
    assert.equal(
      findNode(
        [steps.at(-1)?.replayCanvasData],
        title === 'Improper Movement (CP origin)' ? 'c_that_high_improper_cp::__leaf' : leafId
      )?.word,
      frontedSurface,
      `${title}: the landed occurrence must receive sentence-initial case`
    );
  }

  for (const [title, nodeId, expectedSurface] of [
    // Occupant-as-authored: these cards author their vacated occurrences as
    // traces, so the stable authored surface is the trace itself.
    ['Bounding-Node Crossing (complex NP)', 'd_which_cnpc_low', 't₁'],
    ['Improper Movement (CP origin)', 'c_that_low_improper_cp', 't₁'],
    ['Improper Movement (TP origin)', 't_to_low_improper_tp', 't₁']
  ]) {
    const steps = playback(cardNamed(rawCases, title));
    const occurrence = findNode([steps.at(-1)?.replayCanvasData], nodeId);
    assert.equal(
      occurrence?.word || occurrence?.children?.[0]?.word || occurrence?.children?.[0]?.label,
      expectedSurface,
      `${title}: silent lower copy surface drifted`
    );
  }

  const partialMovement = cardNamed(rawCases, 'Partial Copy Deletion');
  const partialMovementSteps = playback(partialMovement);
  const partialMovementRelationIndex = exactRelationStepIndex(partialMovementSteps, 1, 0);
  for (const nodeId of ['c_partial_copy', 'cbar_partial_copy']) {
    assert.ok(partialMovementSteps.slice(0, partialMovementRelationIndex).some((step) => (
      step.replayVisibleNodeIds?.includes(nodeId)
    )));
  }
  assert.equal(partialMovementSteps.slice(0, partialMovementRelationIndex).some((step) => (
    step.replayVisibleNodeIds?.includes('cp_partial_copy')
  )), false);

  const unaccusative = cardNamed(rawCases, 'Theta Roles / Unaccusative');
  for (const nodeId of ['d_the_low_theta2', 'n_vase_low_theta2']) {
    const trace = findNode(unaccusative.derivationStages[1].workspaceForest, nodeId);
    assert.equal(trace?.word || trace?.children?.[0]?.word || trace?.children?.[0]?.label, 't_1');
  }

  const localDislocation = cardNamed(rawCases, 'Local Dislocation / String-Vacuous Rebracketing');
  assert.equal(localDislocation.derivationStages.length, 2);
  assert.deepEqual(
    localDislocation.derivationStages[0].relations,
    []
  );
  assert.deepEqual(
    localDislocation.derivationStages[1].relations.map((relation) => relation.relation),
    ['LocalDislocation']
  );
  assert.deepEqual(
    localDislocation.derivationStages[1].relations[0].anchors.sequence,
    [
      'root_landed_local_dislocation',
      'k_landed_local_dislocation',
      'poss_host_local_dislocation'
    ]
  );
  for (const nodeId of [
    'root_origin_local_dislocation',
    'root_landed_local_dislocation',
    'n_host_local_dislocation',
    'k_landed_local_dislocation',
    'poss_host_local_dislocation',
    'k_origin_local_dislocation'
  ]) {
    const abstractHead = findNode(localDislocation.derivationStages[0].workspaceForest, nodeId);
    assert.deepEqual(abstractHead?.children, [], `${nodeId} must be an explicit contract-valid leaf`);
  }
  const localRelationNames = localDislocation.derivationStages
    .flatMap((derivationStage) => derivationStage.relations.map((relation) => relation.relation));
  assert.equal(localRelationNames.includes('HeadMove'), false);
  assert.equal(localRelationNames.includes('Lowering'), false);
  assert.equal(localRelationNames.includes('VocabularyInsertion'), false);
  const localSurface = localDislocation.derivationStages[1].workspaceForest
    .flatMap((root) => collectNodes(root, []))
    .filter((node) => Number.isInteger(node.tokenIndex) && node.silent !== true && node.word)
    .sort((left, right) => left.tokenIndex - right.tokenIndex)
    .map((node) => node.word);
  assert.deepEqual(localSurface, ['Tery', '-eer', '-maan']);

  const phrasalSpellOut = cardNamed(rawCases, 'Phrasal Spell-Out');
  const phrasalSpellOutAbstractStage = phrasalSpellOut.derivationStages[0];
  const phrasalSpellOutFinalStage = phrasalSpellOut.derivationStages.at(-1);
  assert.equal(phrasalSpellOut.sentence, 'Mirának');
  assert.equal(phrasalSpellOutFinalStage.workspaceForest.length, 1);
  assert.equal(findNode(phrasalSpellOutFinalStage.workspaceForest, 'pf_nak_phrasal_spellout'), null);
  const abstractMira = findNode(
    phrasalSpellOutAbstractStage.workspaceForest,
    'n_mira_phrasal_spellout'
  );
  const realizedMira = findNode(
    phrasalSpellOutFinalStage.workspaceForest,
    'n_mira_phrasal_spellout'
  );
  assert.equal(abstractMira?.label, '√MIRA');
  assert.equal(abstractMira?.word, undefined);
  assert.equal(abstractMira?.tokenIndex, undefined);
  assert.equal(realizedMira?.word, 'Mirának');
  assert.equal(realizedMira?.tokenIndex, 0);
  assert.deepEqual(phrasalSpellOutFinalStage.relations[0].anchors, {
    phrase: 'datp_phrasal_spellout'
  });
  assert.deepEqual(phrasalSpellOutFinalStage.relations[0].values, {
    exponent: '-nak'
  });
});

test('Atlas relation moments keep every retained visible node at its reserved coordinate', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const transitions = [
    ['Remnant Escape / Pseudogapping', 0, 0],
    ['Partial Copy Deletion', 1, 0],
    ['Cyclic Linearization / Edge Movement', 0, 0],
    ['Intervention / Relativized Minimality', 3, 0],
    ['Smuggling', 0, 0],
    ['Smuggling', 1, 0],
    ['Ordered Case Stacking', 1, 0]
  ];

  for (const [title, stageIndex, relationIndex] of transitions) {
    const steps = playback(cardNamed(rawCases, title));
    const afterIndex = exactRelationStepIndex(steps, stageIndex, relationIndex);
    assert.ok(afterIndex > 0, `${title}: missing relation transition ${stageIndex}:${relationIndex}`);
    const before = steps[afterIndex - 1];
    const after = steps[afterIndex];
    assert.ok(before.replayCanvasData && after.replayCanvasData, `${title}: missing replay canvas`);

    const beforePositions = layoutPositions(before.replayCanvasData);
    const afterPositions = layoutPositions(after.replayCanvasData);
    const beforeVisible = new Set(before.replayVisibleNodeIds || []);
    const retainedVisibleNodeIds = (after.replayVisibleNodeIds || []).filter((nodeId) => (
      beforeVisible.has(nodeId)
      && beforePositions.has(nodeId)
      && afterPositions.has(nodeId)
      && !String(nodeId).startsWith('__babel_future_layout_')
    ));
    assert.ok(retainedVisibleNodeIds.length > 0, `${title}: no retained visible nodes to compare`);
    retainedVisibleNodeIds.forEach((nodeId) => {
      assert.deepEqual(
        beforePositions.get(nodeId),
        afterPositions.get(nodeId),
        `${title}: ${nodeId} moved when relation ${stageIndex}:${relationIndex} appeared`
      );
    });
  }
});

test('Atlas replay never exposes or links to layout-only future syntax', async (t) => {
  const { rawCases } = await loadAtlasCases(t);

  for (const card of rawCases) {
    for (const step of playback(card)) {
      const visibleNodeIds = new Set(step.replayVisibleNodeIds || []);
      const layoutOnlyNodeIds = new Set(
        collectNodes(step.replayCanvasData, [])
          .filter((node) => (
            node.replayLayoutOnly === true
            || String(node.id || '').startsWith('__babel_future_layout_')
          ))
          .map((node) => String(node.id || ''))
          .filter(Boolean)
      );
      layoutOnlyNodeIds.forEach((nodeId) => {
        assert.equal(
          visibleNodeIds.has(nodeId),
          false,
          `${card.title}: ${nodeId} became visible at replay step ${step.replayStepIndex}`
        );
      });

      for (const link of step.replayRelationLinks || []) {
        const endpointIds = Object.entries(link)
          .filter(([key]) => /NodeIds?$/u.test(key))
          .flatMap(([, value]) => Array.isArray(value) ? value : [value])
          .map((value) => String(value || ''))
          .filter(Boolean);
        endpointIds.forEach((nodeId) => {
          assert.equal(
            layoutOnlyNodeIds.has(nodeId),
            false,
            `${card.title}: relation link targets layout-only node ${nodeId}`
          );
        });
      }
    }
  }
});

test('single-tree movement cards do not inherit detached-workspace scaffolds', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const checkpoints = [
    ['Bounding-Node Crossing (complex NP)', 0],
    ['Bounding-Node Crossing (wh-island)', 0],
    ['Anti-Locality (too short)', 1],
    ['Anti-Locality (facilitated)', 1],
    ['Improper Movement (TP origin)', 0],
    ['Intervention / Superiority', 0],
    ['Remnant Movement', 1],
    ['Blocked Extraction Diagnostic (temporal adjunct)', 0]
  ];

  for (const [title, replayFrameIndex] of checkpoints) {
    const completedStage = playback(cardNamed(rawCases, title)).find((step) => (
      step.replayFrameIndex === replayFrameIndex && step.replayKind === 'macro'
    ));
    assert.ok(completedStage, `${title}: missing macro frame ${replayFrameIndex}`);
    assert.equal(
      completedStage.replayUsesFutureLayoutScaffold,
      false,
      `${title}: single-tree movement adopted a detached-workspace scaffold`
    );
  }
});

test('Intervention, Roll-up, and Sideward Replay never build later topology early', async (t) => {
  const { rawCases } = await loadAtlasCases(t);

  const interventionSteps = playback(cardNamed(rawCases, 'Intervention / Relativized Minimality'));
  const subjectMovementIndex = exactRelationStepIndex(interventionSteps, 1, 0);
  assert.ok(subjectMovementIndex >= 0);
  const subjectMovement = interventionSteps[subjectMovementIndex];
  assert.equal(subjectMovement.replayVisibleNodeIds?.includes('dp_what_intervention_high'), false);
  assert.equal(subjectMovement.replayVisibleNodeIds?.includes('d_what_intervention_high'), false);
  assert.equal(
    findNode([subjectMovement.replayCanvasData], 'dp_what_intervention_high')?.replayLayoutOnly,
    true,
    'the blocked landing may reserve geometry but cannot become current syntax'
  );

  const objectMovementIndex = exactRelationStepIndex(interventionSteps, 2, 0);
  const interventionIndex = exactRelationStepIndex(interventionSteps, 3, 0);
  assert.ok(objectMovementIndex > subjectMovementIndex);
  assert.ok(interventionIndex > objectMovementIndex);
  assert.equal(interventionSteps[objectMovementIndex]?.replayVisibleNodeIds?.includes('dp_what_intervention_high'), true);
  assert.deepEqual(
    interventionSteps[interventionIndex]?.replayCanvasData,
    interventionSteps[interventionIndex - 1]?.replayCanvasData,
    'Intervention must judge the existing chain without changing the tree'
  );

  const rollUpSteps = playback(cardNamed(rawCases, 'Roll-up Movement'));
  for (const stageIndex of [1, 2]) {
    const relationIndex = exactRelationStepIndex(rollUpSteps, stageIndex, 0);
    assert.ok(relationIndex >= 0);
    assert.equal(
      rollUpSteps[relationIndex].replayUsesFutureLayoutScaffold,
      false,
      `roll-up stage ${stageIndex + 1} must use its authored complete tree`
    );
    assert.equal(
      collectNodes(rollUpSteps[relationIndex].replayCanvasData, [])
        .some((node) => String(node.id || '').startsWith('__babel_future_layout_')),
      false
    );
  }

  const sidewardSteps = playback(cardNamed(rawCases, 'Sideward Movement'));
  for (const [stageIndex, usesFutureWrapper] of [[0, false], [1, true]]) {
    const completedStage = sidewardSteps.find((step) => (
      step.replayFrameIndex === stageIndex && step.replayKind === 'macro'
    ));
    assert.ok(completedStage);
    assert.equal(completedStage.replayUsesFutureLayoutScaffold, usesFutureWrapper);
    const futureWrapper = findNode([completedStage.replayCanvasData], 'coordp_sideward_sw');
    assert.equal(usesFutureWrapper ? futureWrapper?.replayLayoutOnly : futureWrapper, usesFutureWrapper ? true : null);
    assert.equal(completedStage.replayVisibleNodeIds?.includes('coordp_sideward_sw'), false);
  }
});

test('the repaired locality cards keep movement, judgment, and real syntax separate', async (t) => {
  const { rawCases } = await loadAtlasCases(t);

  const bounding = cardNamed(rawCases, 'Bounding-Node Crossing (complex NP)');
  assert.deepEqual(
    bounding.derivationStages.flatMap((stage) => stage.relations.map((relation) => relation.relation)),
    ['AbarMove', 'BoundingNodeCrossing', 'IllicitAnalysis']
  );
  assert.deepEqual(
    bounding.derivationStages[2].relations[0].anchors.boundary,
    ['tp_cnpc_embedded', 'np_claim_cnpc', 'tp_cnpc_matrix']
  );

  const intervention = cardNamed(rawCases, 'Intervention / Relativized Minimality');
  assert.deepEqual(
    intervention.derivationStages.flatMap((stage) => stage.relations.map((relation) => relation.relation)),
    ['AbarMove', 'AbarMove', 'Intervention', 'IllicitAnalysis']
  );
  assert.equal(intervention.derivationStages[3].workspaceForest[0], intervention.data);
  assert.deepEqual(intervention.derivationStages[3].relations[0].anchors, {
    target: 'dp_what_intervention_low',
    landing: 'dp_what_intervention_high',
    intervener: 'dp_wh_subject_intervention_high'
  });

  const blocked = cardNamed(rawCases, 'Blocked Extraction Diagnostic (temporal adjunct)');
  assert.equal(blocked.sentence, 'Who did Mary cry after John hit');
  assert.deepEqual(
    blocked.derivationStages.flatMap((stage) => stage.relations.map((relation) => relation.relation)),
    ['AbarMove', 'BlockedExtraction', 'IllicitAnalysis']
  );
  assert.deepEqual(blocked.derivationStages[2].relations[0].anchors, {
    source: 'dp_who_low_temporal_blocked',
    target: 'dp_who_high_temporal_blocked',
    adjunctDomain: 'cp_temporal_blocked'
  });
  assert.deepEqual(blocked.derivationStages[2].relations[0].values, {
    outcome: 'blocked'
  });
  assert.deepEqual(blocked.derivationStages[2].relations[1], {
    relation: 'IllicitAnalysis',
    anchors: { analysis: 'cp_blocked_temporal' },
    values: { judgment: '*', label: 'extraction' }
  });

  const postTransfer = cardNamed(rawCases, 'Post-Transfer Access Failure');
  assert.equal(postTransfer.sentence, 'Parecem que os alunos visitaram o zoológico');
  assert.deepEqual(
    postTransfer.derivationStages.flatMap((stage) => stage.relations.map((relation) => relation.relation)),
    ['Phase', 'TransferDomain', 'PostTransferAccess', 'IllicitAnalysis']
  );
  assert.deepEqual(postTransfer.derivationStages[2].relations[0].anchors, {
    source: 't_probe_fong_lda',
    target: 'dp_students_fong_lda',
    spellOutDomain: 'tp_embedded_fong_lda'
  });

  const failedAntiLocality = cardNamed(rawCases, 'Anti-Locality (too short)');
  const licensedAntiLocality = cardNamed(rawCases, 'Anti-Locality (facilitated)');
  assert.equal(failedAntiLocality.sentence, 'The ocean photographs');
  assert.equal(licensedAntiLocality.sentence, 'The ocean photographs well');
  for (const card of [failedAntiLocality, licensedAntiLocality]) {
    assert.deepEqual(
      card.derivationStages.flatMap((stage) => stage.relations.map((relation) => relation.relation)),
      card === failedAntiLocality
        ? ['HeadMove', 'AMove', 'AntiLocality', 'IllicitAnalysis']
        : ['HeadMove', 'AMove', 'AntiLocality']
    );
    const renderedTraceSurfaces = collectNodes(playback(card).at(-1)?.replayCanvasData, [])
      .filter((node) => !(node.children || []).length)
      .map((node) => String(node.word || node.label || '').trim())
      .filter((surface) => surface.startsWith('t'));
    assert.deepEqual(
      renderedTraceSurfaces,
      ['t₁', 't₂', 't₂'],
      `${card.title}: head and DP movement must retain separate numeric trace chains`
    );
  }
  assert.equal(failedAntiLocality.derivationStages[3].relations[0].values.outcome, 'blocked');
  assert.equal(licensedAntiLocality.derivationStages[3].relations[0].values.outcome, 'licensed');
  assert.equal(
    licensedAntiLocality.derivationStages[3].relations[0].anchors.facilitator,
    'advp_anti_facilitator'
  );
});

test('Roll-up builds each modifier complement before selecting the head that merges with it', async (t) => {
  const { rawCases } = await loadAtlasCases(t);
  const rollUpSteps = playback(cardNamed(rawCases, 'Roll-up Movement'));
  const baseStageSteps = rollUpSteps.filter((step) => step.replayFrameIndex === 0);
  const baseMicrosteps = baseStageSteps
    .filter((step) => step.replayKind === 'micro')
    .map((step) => [step.operation, step.targetNodeId]);

  baseStageSteps.forEach((step) => {
    assert.equal(
      step.replayUsesFutureLayoutScaffold,
      false,
      'base generation must not borrow a future movement landing for layout'
    );
    assert.equal(
      collectNodes(step.replayCanvasData, []).some((node) => node.replayLayoutOnly === true),
      false,
      'base generation must contain no hidden future movement topology'
    );
  });

  assert.deepEqual(baseMicrosteps, [
    ['LexicalSelect', 'n_books_ru::__leaf'],
    ['Project', 'n_books_ru'],
    ['Project', 'np_ru'],
    ['LexicalSelect', 'a_red_ru::__leaf'],
    ['Project', 'a_red_ru'],
    ['ExternalMerge', 'abar_red_ru'],
    ['Project', 'ap_red_ru'],
    ['LexicalSelect', 'a_big_ru::__leaf'],
    ['Project', 'a_big_ru'],
    ['ExternalMerge', 'abar_big_ru'],
    ['Project', 'ap_big_ru'],
    ['LexicalSelect', 'dem_ru::__leaf'],
    ['Project', 'dem_ru'],
    ['ExternalMerge', 'dembar_ru'],
    ['Project', 'demp_ru']
  ]);
});

test('across-the-board chains share one index across every conjunct gap', async (t) => {
  const { rawCases } = await loadAtlasCases(t);

  /*
   * One ATB dependency is one chain: every authored source and witness in its
   * anchor arrays carries the same chain index, and every conjunct gap authors
   * the same trace surface. Guards the multi-source indexing repair — the
   * scalar sourceNodeId/witnessNodeId fields hold only the first pair.
   */
  for (const [title, gapLeafIds] of [
    ['Across-the-Board Movement', [
      'd_trace_left_atb__silent',
      'd_trace_right_atb__silent'
    ]],
    ['Across-the-Board Movement (three conjuncts)', [
      'd_trace_lena_atb_three__silent',
      'd_trace_noa_atb_three__silent',
      'd_trace_mira_atb_three__silent'
    ]]
  ]) {
    const steps = playback(cardNamed(rawCases, title));
    const final = steps.at(-1);
    const map = buildResolvedLinkTraceIndexMap(
      [final.replayCanvasData],
      final.replayRelationLinks,
      Number.MAX_SAFE_INTEGER
    );
    const indices = gapLeafIds.map((leafId) => map.get(leafId));
    assert.ok(
      indices.every(Boolean),
      `${title}: every conjunct gap must carry a chain index (got ${JSON.stringify(indices)})`
    );
    assert.equal(
      new Set(indices).size,
      1,
      `${title}: all conjunct gaps must share one chain index (got ${JSON.stringify(indices)})`
    );
    for (const leafId of gapLeafIds) {
      const leaf = findNode([final.replayCanvasData], leafId);
      assert.ok(leaf, `${title}: missing conjunct gap leaf ${leafId}`);
      assert.equal(
        String(leaf.word || leaf.label || '').trim(),
        't₁',
        `${title}: every conjunct gap authors the shared trace surface`
      );
    }
  }
});

test('a gap keeps its own chain index inside a later-moved constituent', async (t) => {
  const { rawCases } = await loadAtlasCases(t);

  /*
   * Müller's remnant notation: the fronted VP's vacated copy shows the VP
   * chain's index on its own material, while the object gap inside it keeps
   * the object chain's index — [t₁ auf den Tisch gelegt]₂ … das Buch₁ … t₂.
   * Containment never overwrites chain membership.
   */
  const steps = playback(cardNamed(rawCases, 'Remnant Movement'));
  const final = steps.at(-1);
  const map = buildResolvedLinkTraceIndexMap(
    [final.replayCanvasData],
    final.replayRelationLinks,
    Number.MAX_SAFE_INTEGER
  );
  for (const objectGapLeafId of ['d_das_gap__silent', 'n_buch_gap__silent']) {
    assert.equal(
      map.get(objectGapLeafId),
      '1',
      `${objectGapLeafId}: the object gap belongs to the evacuation chain`
    );
  }
  for (const vpLeafId of [
    'p_auf_low__silent',
    'd_den_low__silent',
    'n_tisch_low__silent',
    'v_gelegt_low__silent'
  ]) {
    assert.equal(
      map.get(vpLeafId),
      '2',
      `${vpLeafId}: the remnant VP's own material belongs to the fronting chain`
    );
  }
});
