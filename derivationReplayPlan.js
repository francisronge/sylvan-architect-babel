const asText = (value) => String(value || '').trim();

const asArray = (value) => (Array.isArray(value) ? value : []);

const cloneJson = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const nodeId = (node) => asText(node?.id || node?.refId);

const nodeLabel = (node) => asText(node?.label || node?.word || node?.refId || node?.id);

const isSilentLabel = (value) => /^(?:t|trace|copy|gap|empty|silent|null|epsilon|eps|e|\u2205|\u00f8)$/i.test(asText(value));

const isSilentLeaf = (node) => {
  const children = asArray(node?.children);
  if (children.length > 0) return false;
  if (node?.silent === true) return true;
  return !asText(node?.word) && isSilentLabel(node?.label);
};

const flattenAnchorNodeIds = (anchors = {}) => {
  const ids = [];
  Object.values(anchors || {}).forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        const id = asText(item);
        if (id) ids.push(id);
      });
      return;
    }
    const id = asText(value);
    if (id) ids.push(id);
  });
  return Array.from(new Set(ids));
};

const firstAnchor = (anchors = {}, names = []) => {
  for (const name of names) {
    const value = anchors?.[name];
    if (Array.isArray(value)) {
      const first = value.map(asText).find(Boolean);
      if (first) return first;
    }
    const text = asText(value);
    if (text) return text;
  }
  return '';
};

const normalizeVisualRelations = (value) => asArray(value)
  .map((relation) => {
    const label = asText(relation?.relation);
    const anchors = relation?.anchors && typeof relation.anchors === 'object' && !Array.isArray(relation.anchors)
      ? relation.anchors
      : {};
    if (!label) return null;
    return {
      relation: label,
      anchors: cloneJson(anchors)
    };
  })
  .filter(Boolean);

const normalizeStage = (stage, index) => {
  const details = stage?.change?.details && typeof stage.change.details === 'object'
    ? stage.change.details
    : {};
  return {
    stageIndex: index,
    stageNumber: index + 1,
    stepId: asText(stage?.stepId || stage?.frameId || `stage-${index + 1}`),
    statement: asText(stage?.statement || stage?.change?.statement),
    stageRecord: asText(stage?.stageRecord || details.stageRecord || details.note || stage?.note),
    visualRelations: normalizeVisualRelations(
      stage?.visualRelations || details.derivationStageVisualRelations
    ),
    workspaceForest: asArray(stage?.workspaceForest || stage?.after?.workspaceForest)
  };
};

const makeStep = (kind, stage, partial) => ({
  kind,
  stageIndex: stage.stageIndex,
  stageNumber: stage.stageNumber,
  stageId: stage.stepId,
  statement: stage.statement,
  ...partial
});

const buildNodeMicrosteps = (node, stage, path = []) => {
  if (!node || typeof node !== 'object') return [];

  const id = nodeId(node);
  const label = nodeLabel(node);
  const children = asArray(node.children);

  if (node.refId && !node.id) {
    return [
      makeStep('micro', stage, {
        operation: 'preserve',
        label: `Preserve ${label}`,
        targetNodeId: id,
        targetLabel: label,
        nodePath: path
      })
    ];
  }

  if (children.length === 0) {
    const operation = isSilentLeaf(node) ? 'introduce-silent' : 'select';
    return [
      makeStep('micro', stage, {
        operation,
        label: operation === 'introduce-silent' ? `Introduce silent ${label}` : `Select ${label}`,
        targetNodeId: id,
        targetLabel: label,
        nodePath: path
      })
    ];
  }

  const childSteps = children.flatMap((child, childIndex) =>
    buildNodeMicrosteps(child, stage, [...path, id || label || String(childIndex)])
  );
  const childLabels = children.map(nodeLabel).filter(Boolean);
  const operation = children.length === 1 ? 'project' : 'merge';
  const labelText = operation === 'project'
    ? `Project ${label}`
    : `Merge ${childLabels.join(' + ')} as ${label}`;
  return [
    ...childSteps,
    makeStep('micro', stage, {
      operation,
      label: labelText,
      targetNodeId: id,
      targetLabel: label,
      sourceNodeIds: children.map(nodeId).filter(Boolean),
      sourceLabels: childLabels,
      nodePath: path
    })
  ];
};

const buildStageMicrosteps = (stage) =>
  stage.workspaceForest.flatMap((root, rootIndex) => buildNodeMicrosteps(root, stage, [String(rootIndex)]));

const buildRelationSteps = (stage) => stage.visualRelations.map((relation) => {
  const anchors = relation.anchors || {};
  const targetNodeId = firstAnchor(anchors, [
    'target',
    'landing',
    'to',
    'moved',
    'moving',
    'operator',
    'head_copy',
    'movedCopy',
    'pronouncedCopy'
  ]);
  const sourceNodeIds = flattenAnchorNodeIds(anchors).filter((id) => id !== targetNodeId);
  return makeStep('relation', stage, {
    operation: 'visual-relation',
    label: relation.relation,
    relation: relation.relation,
    anchors: cloneJson(anchors),
    targetNodeId,
    sourceNodeIds,
    stageRecord: stage.stageRecord
  });
});

const buildMacroStep = (stage) => makeStep('macro', stage, {
  operation: 'stage-record',
  label: stage.statement || `Stage ${stage.stageNumber}`,
  stageRecord: stage.stageRecord,
  workspaceForest: cloneJson(stage.workspaceForest),
  visualRelations: cloneJson(stage.visualRelations)
});

const addStageProgress = (stages) => {
  stages.forEach((stage) => {
    const steps = stage.steps;
    steps.forEach((step, stepIndex) => {
      step.stageStepIndex = stepIndex;
      step.stageStepNumber = stepIndex + 1;
      step.stageStepCount = steps.length;
      step.progressLabel = `Stage ${stage.stageNumber}/${stages.length} \u00b7 Step ${stepIndex + 1}/${steps.length}`;
    });
  });
  return stages;
};

export const buildDerivationReplayPlan = (input = {}) => {
  const rawStages = asArray(input.derivationStages || input.growthFrames);
  const stages = rawStages.map(normalizeStage).map((stage) => {
    const microsteps = buildStageMicrosteps(stage);
    const relationSteps = buildRelationSteps(stage);
    const macroStep = buildMacroStep(stage);
    return {
      ...stage,
      microsteps,
      relationSteps,
      macroStep,
      steps: [...microsteps, ...relationSteps, macroStep]
    };
  });

  addStageProgress(stages);

  return {
    stages,
    steps: stages.flatMap((stage) => stage.steps)
  };
};

export const __test__ = {
  buildNodeMicrosteps,
  buildRelationSteps,
  flattenAnchorNodeIds,
  isSilentLeaf,
  normalizeStage
};
