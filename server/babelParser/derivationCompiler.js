import { createFailure, withFailureDetails } from './validationErrors.js';
import { resolveRealizations, validateRealizations } from './realizations.js';
import { tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';

// The complete node contract: required id/label/children, the optional
// authored fields, and the server-derived surfaceSpan.
const DERIVATION_NODE_FIELDS = new Set(['id', 'label', 'children', 'word', 'tokenIndex', 'silent', 'lineageId', 'surfaceSpan']);

export const createDerivationCompilerHelpers = ({
  ParseApiError,
  normalizeOptionalText,
  collectNodeReferencesById,
  collectOvertTerminalNodes,
  authoredWord,
  sameTokenSequence,
  deriveCanonicalSurfaceSpans
}) => {
  const REQUIRED_STAGE_FIELDS = Object.freeze([
    'statement',
    'stageRecord',
    'relations',
    'workspaceForest'
  ]);

  const cloneJson = (value) => {
    if (Array.isArray(value)) return value.map((item) => cloneJson(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJson(item)])
    );
  };

  const invalidField = (ruleId, stageIndex, fieldPath, offendingValue, expectedForm, diagnostics) => {
    const received = typeof offendingValue === 'undefined' ? 'a missing field'
      : offendingValue === null ? 'null'
        : Array.isArray(offendingValue) ? 'an array'
          : typeof offendingValue === 'string' ? `the string ${JSON.stringify(offendingValue).slice(0, 160)}`
            : `a ${typeof offendingValue}`;
    const message = `${stageIndex === null ? 'Analysis' : `Stage ${stageIndex + 1}`}, ${fieldPath}: expected ${expectedForm}; received ${received}.`;
    const details = withFailureDetails({}, {
      failureClass: 'contract_misunderstanding',
      ruleId,
      stageIndex,
      fieldPath,
      offendingValue,
      expectedForm,
      message,
      processingStep: 'stage-shape'
    });
    if (diagnostics) diagnostics.push(details.failure);
    else throw new ParseApiError('BAD_MODEL_RESPONSE', message, 502, details);
  };

  const isSubstantiveStageRecordText = (value) => typeof value === 'string' && Boolean(value.trim());

  const normalizeRelations = (value, stageIndex, diagnostics) => {
    if (!Array.isArray(value)) {
      invalidField('DERIVATION_STAGE_RELATIONS_ARRAY', stageIndex,
        `$.derivationStages[${stageIndex}].relations`, value, 'an array', diagnostics);
      return cloneJson(value);
    }

    const normalized = [];
    const isAnchorValue = (anchorValue) => (
      typeof anchorValue === 'string'
        ? Boolean(anchorValue.trim())
        : Array.isArray(anchorValue)
          && anchorValue.length > 0
          && anchorValue.every((item) => typeof item === 'string' && item.trim())
    );
    /*
     * `values` entries are verbatim authored literals: strings or non-empty
     * string arrays. Unlike anchors, an empty string is a legal literal.
     */
    const isValuesValue = (literal) => (
      typeof literal === 'string'
        ? true
        : Array.isArray(literal)
          && literal.length > 0
          && literal.every((item) => typeof item === 'string')
    );
    const RELATION_FIELDS = ['relation', 'anchors', 'priorAnchors', 'values'];
    for (let relationIndex = 0; relationIndex < value.length; relationIndex += 1) {
      const relation = value[relationIndex];
      const fieldPath = `$.derivationStages[${stageIndex}].relations[${relationIndex}]`;
      if (
        !relation
        || typeof relation !== 'object'
        || Array.isArray(relation)
        || Object.keys(relation).some((key) => !RELATION_FIELDS.includes(key))
        || !Object.hasOwn(relation, 'relation')
        || !Object.hasOwn(relation, 'anchors')
      ) {
        invalidField('DERIVATION_STAGE_RELATION_EXACT', stageIndex, fieldPath, relation,
          'an object containing relation and anchors, with only values and priorAnchors optional', diagnostics);
        normalized.push(cloneJson(relation));
        continue;
      }
      if (typeof relation.relation !== 'string' || !relation.relation.trim()) {
        invalidField('DERIVATION_STAGE_RELATION_EXACT', stageIndex, `${fieldPath}.relation`,
          relation.relation, 'a nonblank string', diagnostics);
      }
      for (const field of ['anchors', 'priorAnchors', 'values']) {
        if (field !== 'anchors' && !Object.hasOwn(relation, field)) continue;
        const block = relation[field];
        if (!block || typeof block !== 'object' || Array.isArray(block) || Object.keys(block).length === 0) {
          invalidField('DERIVATION_STAGE_RELATION_EXACT', stageIndex, `${fieldPath}.${field}`,
            block, 'a nonempty object with named entries', diagnostics);
          continue;
        }
        for (const [key, entry] of Object.entries(block)) {
          const entryPath = `${fieldPath}.${field}[${JSON.stringify(key)}]`;
          if (!key.trim()) {
            invalidField('DERIVATION_STAGE_RELATION_EXACT', stageIndex, entryPath, key, 'a nonblank entry name', diagnostics);
          }
          const entries = Array.isArray(entry) && entry.length > 0 ? entry : [entry];
          entries.forEach((item, itemIndex) => {
            const valid = Array.isArray(entry) && entry.length > 0
              ? typeof item === 'string' && (field === 'values' || Boolean(item.trim()))
              : (field === 'values' ? isValuesValue(item) : isAnchorValue(item));
            if (valid) return;
            const isArrayItem = Array.isArray(entry) && entry.length > 0;
            invalidField('DERIVATION_STAGE_RELATION_EXACT', stageIndex,
              isArrayItem ? `${entryPath}[${itemIndex}]` : entryPath, item,
              isArrayItem ? (field === 'values' ? 'a string' : 'a nonblank node ID')
                : field === 'values' ? 'a string or a nonempty list of strings'
                  : 'a nonblank node ID or a nonempty list of nonblank node IDs', diagnostics);
          });
        }
      }
      normalized.push(cloneJson(relation));
    }
    return normalized;
  };

  const normalizeDerivationStagesToDerivationFrames = (value, options = {}) => {
    const diagnostics = options.validationIssues;
    const integrityFlags = Array.isArray(options?.integrityFlags)
      ? options.integrityFlags
      : [];
    if (!Array.isArray(value)) {
      invalidField('DERIVATION_STAGE_FIELDS_EXACT', null, '$.derivationStages', value, 'an array', diagnostics);
      return [];
    }

    return value
      .map((rawStage, stageIndex) => {
        const stage = rawStage;
        const stageId = `d${stageIndex + 1}`;
        if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
          invalidField('DERIVATION_STAGE_OBJECT', stageIndex,
            `$.derivationStages[${stageIndex}]`, stage, 'an object', diagnostics);
          return cloneJson(stage);
        }

        const authoredFields = Object.keys(stage);
        if (
          authoredFields.some((field) => !REQUIRED_STAGE_FIELDS.includes(field) && field !== 'realizations')
          || REQUIRED_STAGE_FIELDS.some((field) => !Object.hasOwn(stage, field))
        ) {
          integrityFlags.push(`derivation_stage_contract_fields_invalid:${stageId}`);
          invalidField('DERIVATION_STAGE_FIELDS_EXACT', stageIndex,
            `$.derivationStages[${stageIndex}]`, stage,
            'statement, stageRecord, relations, and workspaceForest, with only realizations optional', diagnostics);
        }

        if (typeof stage.statement !== 'string' || !stage.statement.trim()) {
          integrityFlags.push(`statement_missing_on_derivation_stage:${stageId}`);
          invalidField('DERIVATION_STAGE_STATEMENT_NONEMPTY', stageIndex,
            `$.derivationStages[${stageIndex}].statement`, stage.statement, 'a nonblank string', diagnostics);
        }

        if (!isSubstantiveStageRecordText(stage.stageRecord)) {
          integrityFlags.push(`stage_record_missing:${stageId}`);
          invalidField('DERIVATION_STAGE_RECORD_NONEMPTY', stageIndex,
            `$.derivationStages[${stageIndex}].stageRecord`, stage.stageRecord, 'a nonblank string', diagnostics);
        }

        const relations = normalizeRelations(stage.relations, stageIndex, diagnostics);
        if (Object.hasOwn(stage, 'realizations')) {
          const issues = validateRealizations(stage.realizations, { stageIndex, fieldPath: `$.derivationStages[${stageIndex}]` });
          if (diagnostics) diagnostics.push(...issues);
          else if (issues.length) throw new ParseApiError('BAD_MODEL_RESPONSE', issues[0].message, 502,
            withFailureDetails({}, { ...issues[0], failureClass: issues[0].class }));
        }

        if (typeof stage.workspaceForest === 'undefined') {
          integrityFlags.push(`workspace_forest_missing_on_derivation_stage:${stageId}`);
          invalidField('DERIVATION_STAGE_WORKSPACE_FOREST_PRESENT', stageIndex,
            `$.derivationStages[${stageIndex}].workspaceForest`, stage.workspaceForest, 'an array', diagnostics);
        }

        return {
          frameId: stageId,
          stepId: stageId,
          after: {
            workspaceForest: cloneJson(stage.workspaceForest),
            ...(Object.hasOwn(stage, 'realizations') ? { realizations: cloneJson(stage.realizations) } : {})
          },
          change: {
            statement: stage.statement,
            details: {
              stageRecord: stage.stageRecord,
              derivationStageRelations: relations,
              derivationStageRelationsContract: true
            }
          }
        };
      });
  };

  const expandWorkspaceForest = (
    value,
    priorNodes,
    stageIndex,
    integrityFlags,
    diagnostics,
    nodeFieldPaths
  ) => {
    const throwMalformedWorkspace = (message, fieldPath, offendingValue, expectedForm, inspectable = false) => {
      const details = withFailureDetails({}, {
        failureClass: 'contract_misunderstanding',
        ruleId: 'DERIVATION_WORKSPACE_VALID',
        stageIndex,
        fieldPath,
        offendingValue,
        expectedForm,
        message,
        processingStep: 'workspace-expansion'
      });
      if (inspectable && diagnostics) diagnostics.push(details.failure);
      else throw new ParseApiError('BAD_MODEL_RESPONSE', message, 502, details);
    };
    if (!Array.isArray(value)) {
      throwMalformedWorkspace(
        `Malformed workspaceForest at derivation stage ${stageIndex + 1}: expected an array.`,
        `$.derivationStages[${stageIndex}].workspaceForest`, value, 'an array'
      );
    }

    const stageNodeIds = new Set();
    const resolvingRefIds = new Set();

    const expandNode = (rawNode, path, carriedFrom = null) => {
      if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
        throwMalformedWorkspace(`Malformed syntax node at ${path}: expected an object.`,
          path, rawNode, 'a complete syntax node or a refId object');
      }

      if (Object.hasOwn(rawNode, 'refId')) {
        if (
          Object.keys(rawNode).length !== 1
          || typeof rawNode.refId !== 'string'
          || !rawNode.refId.trim()
        ) {
          throwMalformedWorkspace(
            `Malformed syntax node at ${path}: refId objects must contain exactly one non-empty refId.`,
            Object.keys(rawNode).length === 1 ? `${path}.refId` : path,
            Object.keys(rawNode).length === 1 ? rawNode.refId : rawNode,
            'an object containing only a nonblank refId'
          );
        }
        const refId = rawNode.refId.trim();
        const referencedNode = priorNodes.get(refId);
        if (!referencedNode) {
          throwMalformedWorkspace(
            `Stage ${stageIndex + 1}, ${path}.refId: no earlier stage defines node ${JSON.stringify(refId)}.`,
            `${path}.refId`, rawNode.refId, 'the exact ID of a node defined in an earlier stage'
          );
        }
        if (resolvingRefIds.has(refId)) {
          throwMalformedWorkspace(
            `Malformed syntax node at ${path} (cyclic prior-stage refId: ${refId}).`,
            `${path}.refId`, rawNode.refId, 'an acyclic earlier subtree reference'
          );
        }
        resolvingRefIds.add(refId);
        try {
          integrityFlags.push(`prior_stage_refid_expanded:${stageIndex + 1}:${refId}`);
          return expandNode(referencedNode, path, { fieldPath: `${path}.refId`, refId: rawNode.refId });
        } finally {
          resolvingRefIds.delete(refId);
        }
      }

      for (const field of ['id', 'label', 'children']) {
        const valid = field === 'children' ? Array.isArray(rawNode[field])
          : typeof rawNode[field] === 'string' && Boolean(rawNode[field].trim());
        if (valid) continue;
        throwMalformedWorkspace(
          `Malformed syntax node at ${path}: complete nodes require non-empty id, non-empty label, and children.`,
          `${path}.${field}`, rawNode[field], field === 'children' ? 'an array' : 'a nonblank string'
        );
      }

      const nodeId = rawNode.id.trim();
      if (stageNodeIds.has(nodeId)) {
        throwMalformedWorkspace(
          `Malformed workspaceForest at derivation stage ${stageIndex + 1}: duplicate active node id ${nodeId}.`,
          carriedFrom?.fieldPath || `${path}.id`, carriedFrom?.refId || rawNode.id,
          'an ID used at only one position in this workspace', true
        );
      }
      stageNodeIds.add(nodeId);

      // Inspection keeps every authored key on the expanded node. Keys outside
      // the contract are recorded here and ignored by every interpreter; they
      // never become a pronunciation, identity or display instruction.
      Object.keys(rawNode).forEach((field) => {
        if (!DERIVATION_NODE_FIELDS.has(field)) {
          integrityFlags.push(`node_field_ignored:${stageIndex + 1}:${path}.${field}`);
        }
      });
      const expanded = {
        ...cloneJson(rawNode),
        children: rawNode.children.map((child, childIndex) => (
          expandNode(child, `${path}.children[${childIndex}]`, carriedFrom)
        ))
      };
      if (nodeFieldPaths) {
        nodeFieldPaths.set(expanded, nodeFieldPaths.get(rawNode) || { stageIndex, fieldPath: path });
      }
      return expanded;
    };

    return value.map((root, rootIndex) => (
      expandNode(root, `$.derivationStages[${stageIndex}].workspaceForest[${rootIndex}]`)
    ));
  };

  // Inspection reports defects without making malformed records eligible for Replay.
  const inspectDerivationWorkspaces = (stages, options = {}) => {
    if (!Array.isArray(stages)) return null;
    const shapeDiagnostics = [];
    normalizeDerivationStagesToDerivationFrames(stages, { validationIssues: shapeDiagnostics });
    const priorNodes = new Map();
    const stageNodes = [];
    let blockedByStageIndex = null;
    const entries = stages.map((stage, stageIndex) => {
      const diagnostics = shapeDiagnostics.filter((issue) => issue.stageIndex === stageIndex);
      const entry = {
        stageIndex, authoredStage: cloneJson(stage), workspaceForest: null,
        diagnostics, anchorChecks: [], replayStatus: 'not-compiled',
        ...(blockedByStageIndex === null ? {} : { transitionUnavailableSinceStageIndex: blockedByStageIndex })
      };
      const report = (fieldPath, offendingValue, expectedForm, ruleId = 'DERIVATION_NODE_OPTIONAL_FIELD') => {
        diagnostics.push(createFailure({
          failureClass: 'contract_misunderstanding', ruleId, stageIndex, fieldPath,
          offendingValue, expectedForm, processingStep: 'node-shape',
          message: `Stage ${stageIndex + 1}, ${fieldPath}: expected ${expectedForm}.`
        }));
      };
      const tokenIndexes = new Set();
      const inspectNode = (node, path) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        for (const field of ['word', 'silent', 'lineageId', 'tokenIndex', 'surfaceSpan']) {
          if (!Object.hasOwn(node, field)) continue;
          const value = node[field];
          const fieldPath = `${path}.${field}`;
          if (field === 'word' && typeof value !== 'string') report(fieldPath, value, 'a string');
          if (field === 'silent' && typeof value !== 'boolean') report(fieldPath, value, 'a boolean');
          if (field === 'lineageId' && (typeof value !== 'string' || !value.trim())) {
            report(fieldPath, value, 'a nonblank string');
          }
          if (field === 'tokenIndex' && (!Number.isInteger(value) || value < 0)) {
            report(fieldPath, value, 'a nonnegative integer');
          }
          if (field === 'surfaceSpan') {
            if (!Array.isArray(value) || value.length !== 2) {
              report(fieldPath, value, 'a two-item array of nonnegative integer token indexes');
            } else {
              value.forEach((index, itemIndex) => {
                if (!Number.isInteger(index) || index < 0) {
                  report(`${fieldPath}[${itemIndex}]`, index, 'a nonnegative integer');
                }
              });
              if (value.every((index) => Number.isInteger(index) && index >= 0) && value[1] < value[0]) {
                report(`${fieldPath}[1]`, value[1], 'an ending token index at least as large as the starting index');
              }
            }
          }
        }
        if (Array.isArray(node.children)) node.children.forEach((child, index) => inspectNode(child, `${path}.children[${index}]`));
      };
      if (Array.isArray(stage?.workspaceForest)) {
        stage.workspaceForest.forEach((node, index) => inspectNode(node, `$.derivationStages[${stageIndex}].workspaceForest[${index}]`));
      }
      const workspaceDiagnostics = [];
      try {
        const workspaceForest = expandWorkspaceForest(stage?.workspaceForest, priorNodes, stageIndex, [], workspaceDiagnostics);
        entry.workspaceForest = workspaceForest;
        const nodes = new Map();
        const visit = (node, authoredNode, path, carriedFrom = null, underSilentAncestor = false) => {
          const reference = authoredNode && Object.hasOwn(authoredNode, 'refId')
            ? { fieldPath: `${path}.refId`, refId: authoredNode.refId } : carriedFrom;
          const referencePath = reference?.fieldPath;
          const occurrences = nodes.get(node.id.trim()) || [];
          occurrences.push({ node, fieldPath: referencePath || `${path}.id`, carried: Boolean(referencePath) });
          nodes.set(node.id.trim(), occurrences);
          const hasTokenIndex = Number.isInteger(node.tokenIndex) && node.tokenIndex >= 0 && node.children.length === 0;
          // Silence covers the whole occurrence: a terminal under a silent
          // ancestor is unpronounced and cannot carry a token index.
          if (hasTokenIndex && underSilentAncestor && node.silent !== true) {
            report(referencePath || `${path}.tokenIndex`, reference ? reference.refId : node.tokenIndex,
              'no token index on a terminal beneath a silent ancestor', 'DERIVATION_TOKEN_INDEX_SILENT');
          }
          if (hasTokenIndex && node.silent !== true && !underSilentAncestor) {
            if (tokenIndexes.has(node.tokenIndex)) {
              report(referencePath || `${path}.tokenIndex`, reference ? reference.refId : node.tokenIndex,
                'a token index used by only one non-silent terminal in this workspace', 'DERIVATION_TOKEN_INDEX_UNIQUE');
            }
            tokenIndexes.add(node.tokenIndex);
          }
          const silentHere = underSilentAncestor || node.silent === true;
          node.children.forEach((child, index) => visit(child, authoredNode?.children?.[index], `${path}.children[${index}]`, reference, silentHere));
        };
        workspaceForest.forEach((node, index) => visit(node, stage.workspaceForest[index], `$.derivationStages[${stageIndex}].workspaceForest[${index}]`));
        if (stage.realizations?.length > 0 && workspaceDiagnostics.length === 0) {
          const surface = resolveRealizations(workspaceForest, stage.realizations,
            options.sentenceTokens ?? (typeof options.sentence === 'string' ? tokenizeSentenceSurfaceOrder(options.sentence) : undefined),
            { stageIndex, fieldPath: `$.derivationStages[${stageIndex}]`, complete: stageIndex === stages.length - 1 });
          // Shape diagnostics were already recorded before expansion.
          diagnostics.push(...surface.diagnostics.filter((issue) => issue.ruleId !== 'DERIVATION_REALIZATION_SHAPE'));
        }
        stageNodes[stageIndex] = nodes;
        if (workspaceDiagnostics.length === 0) {
          nodes.forEach(([{ node }], nodeId) => priorNodes.set(nodeId, cloneJson(node)));
        } else {
          priorNodes.clear();
          blockedByStageIndex ??= stageIndex;
        }
      } catch (error) {
        if (!(error instanceof ParseApiError) || !error.failure) throw error;
        const diagnostic = cloneJson(error.failure);
        if (blockedByStageIndex !== null && diagnostic.fieldPath.endsWith('.refId')) {
          entry.blockedByStageIndex = blockedByStageIndex;
          diagnostic.message = `Stage ${stageIndex + 1}, ${diagnostic.fieldPath}: the reference cannot be resolved from verified history after workspace expansion failed at stage ${blockedByStageIndex + 1}.`;
        }
        workspaceDiagnostics.push(diagnostic);
        // A failed stage may redefine any earlier ID. None of that cache is trustworthy.
        priorNodes.clear();
        blockedByStageIndex ??= stageIndex;
        stageNodes[stageIndex] = null;
      }
      diagnostics.push(...workspaceDiagnostics);
      return entry;
    });

    entries.forEach((entry, stageIndex) => {
      const relations = stages[stageIndex]?.relations;
      if (Array.isArray(relations)) relations.forEach((relation, relationIndex) => {
        for (const field of ['anchors', 'priorAnchors']) {
          const block = relation?.[field];
          if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
          const requiredStageIndex = field === 'anchors' ? stageIndex : stageIndex - 1;
          const requiredNodes = requiredStageIndex < 0 ? new Map() : stageNodes[requiredStageIndex];
          Object.entries(block).forEach(([role, value]) => {
            const values = Array.isArray(value) ? value : [value];
            values.forEach((nodeId, itemIndex) => {
              if (typeof nodeId !== 'string' || !nodeId.trim()) return;
              const fieldPath = `$.derivationStages[${stageIndex}].relations[${relationIndex}].${field}[${JSON.stringify(role)}]${Array.isArray(value) ? `[${itemIndex}]` : ''}`;
              const occurrences = requiredNodes?.get(nodeId) || [];
              const matchingStageIndexes = stageNodes.flatMap((nodes, index) => nodes?.has(nodeId) ? [index] : []);
              let status = 'missing';
              if (!requiredNodes) status = 'unavailable';
              else if (occurrences.length > 1) status = 'duplicate';
              else if (occurrences.length === 1) status = 'resolved';
              else if (matchingStageIndexes.length > 0) {
                if (matchingStageIndexes.every((index) => index < requiredStageIndex)) status = 'previous-only';
                else if (matchingStageIndexes.every((index) => index > stageIndex)) status = 'future-only';
                else if (matchingStageIndexes.every((index) => index === stageIndex)) status = 'current-only';
                else status = 'outside-required-workspace';
              }
              const check = {
                fieldPath, nodeId, requiredStageIndex, status, matchingStageIndexes,
                carried: occurrences.some((occurrence) => occurrence.carried),
                occurrencePaths: occurrences.map((occurrence) => occurrence.fieldPath)
              };
              entry.anchorChecks.push(check);
              if (status === 'resolved') return;
              const expectedForm = field === 'anchors'
                ? 'exactly one node with this ID in the current expanded workspace'
                : 'exactly one node with this ID in the immediately preceding expanded workspace';
              const observation = status === 'unavailable' ? 'the required workspace could not be expanded; membership is unavailable'
                : status === 'duplicate' ? 'the required workspace contains duplicate occurrences of this ID'
                  : `the ID is ${status} relative to the required workspace`;
              entry.diagnostics.push(createFailure({
                failureClass: 'contract_misunderstanding', ruleId: 'DERIVATION_RELATION_ANCHOR_RESOLUTION',
                stageIndex, fieldPath, offendingValue: nodeId, expectedForm,
                processingStep: 'anchor-resolution', resolution: status, requiredStageIndex,
                message: `Stage ${stageIndex + 1}, ${fieldPath}: ${observation}; expected ${expectedForm}.`
              }));
            });
          });
        }
      });
      if (stageIndex === entries.length - 1 && entry.workspaceForest?.length > 1) {
        const fieldPath = `$.derivationStages[${stageIndex}].workspaceForest`;
        entry.diagnostics.push(createFailure({
          failureClass: 'valid_but_unexpected', ruleId: 'DERIVATION_FINAL_WORKSPACE_MULTIPLE_ROOTS',
          stageIndex, fieldPath, offendingValue: entry.workspaceForest.map((root) => root.id),
          expectedForm: 'a convergence review of the complete final workspace', processingStep: 'workspace-convergence',
          message: `Stage ${stageIndex + 1}, ${fieldPath}: the final workspace contains ${entry.workspaceForest.length} roots. Selecting a sentence-matching root does not establish whole-workspace convergence.`
        }));
      }
      const prefix = options.fieldPath || '$';
      entry.diagnostics = entry.diagnostics.map((diagnostic) => {
        const fieldPath = `${prefix}${diagnostic.fieldPath.slice(1)}`;
        return {
          ...diagnostic,
          ...(Number.isInteger(options.analysisIndex) ? { analysisIndex: options.analysisIndex } : {}),
          fieldPath,
          message: diagnostic.message?.replace(diagnostic.fieldPath, fieldPath)
        };
      });
      entry.anchorChecks.forEach((check) => {
        check.fieldPath = `${prefix}${check.fieldPath.slice(1)}`;
        check.occurrencePaths = check.occurrencePaths.map((path) => `${prefix}${path.slice(1)}`);
      });
      if (entry.diagnostics.length > 0) entry.diagnostic = entry.diagnostics[0];
    });
    return entries;
  };

  const normalizeDerivationFrames = (value, options = {}) => {
    if (!Array.isArray(value)) return [];
    const integrityFlags = Array.isArray(options?.integrityFlags)
      ? options.integrityFlags
      : [];
    const priorNodes = new Map();

    return value.map((frame, stageIndex) => {
      const rawForest = frame?.after?.workspaceForest;
      const workspaceForest = expandWorkspaceForest(
        rawForest,
        priorNodes,
        stageIndex,
        integrityFlags,
        undefined,
        options.nodeFieldPaths
      );
      if (frame?.after?.realizations?.length > 0) {
        const surface = resolveRealizations(workspaceForest, frame.after.realizations, options.sentenceTokens,
          { stageIndex, fieldPath: `$.derivationStages[${stageIndex}]` });
        if (surface.diagnostics.length) {
          const failure = surface.diagnostics[0];
          throw new ParseApiError('BAD_MODEL_RESPONSE', failure.message, 502,
            withFailureDetails({}, { ...failure, failureClass: failure.class }));
        }
      }
      collectNodeReferencesById(workspaceForest).forEach((node, nodeId) => {
        // Expansion clones each use; retaining this version also retains its field origins.
        priorNodes.set(nodeId, node);
      });
      return {
        ...frame,
        after: {
          ...(frame?.after || {}),
          workspaceForest
        }
      };
    });
  };

  const getFrameWorkspaceForest = (frame) => (
    Array.isArray(frame?.after?.workspaceForest)
      ? frame.after.workspaceForest
      : []
  );

  const canonicalizeDerivationRootCandidateForSentence = (root, sentenceTokens = [], options = {}) => {
    if (!root || typeof root !== 'object' || !Array.isArray(sentenceTokens) || sentenceTokens.length === 0) {
      return null;
    }
    const candidate = cloneJson(root);
    const fieldPathsById = new Map(Array.from(collectNodeReferencesById(root), ([nodeId, node]) => [
      nodeId, options.nodeFieldPaths?.get(node)
    ]));
    const alignmentError = (node, field, expectedForm) => {
      const origin = fieldPathsById.get(node.id.trim());
      const fieldPath = `${origin?.fieldPath || options.fieldPath || '$'}.${field}`;
      const message = `${fieldPath}: authored ${field} does not match final sentence alignment; expected ${expectedForm}.`;
      throw new ParseApiError('BAD_MODEL_RESPONSE', message, 502, withFailureDetails({}, {
        failureClass: 'contract_misunderstanding', ruleId: 'DERIVATION_TOKEN_ALIGNMENT',
        stageIndex: origin?.stageIndex ?? options.stageIndex ?? null,
        fieldPath, offendingValue: node[field], expectedForm, message, processingStep: 'token-alignment'
      }));
    };
    try {
      const nodesById = collectNodeReferencesById(candidate);
      const authoredTechnicalFields = new Map(
        Array.from(nodesById, ([nodeId, node]) => [
          nodeId,
          {
            hasSurfaceSpan: Object.hasOwn(node, 'surfaceSpan'),
            hasTokenIndex: Object.hasOwn(node, 'tokenIndex'),
            surfaceSpan: cloneJson(node.surfaceSpan),
            tokenIndex: node.tokenIndex
          }
        ])
      );
      const overtTerminals = collectOvertTerminalNodes(candidate);
      const overtTerminalIds = new Set(
        overtTerminals.map((node) => String(node.id || '').trim())
      );
      const overtSurfaces = overtTerminals
        .map((node) => authoredWord(node))
        .map((token) => String(token || '').trim())
        .filter(Boolean);
      const hasRealizations = options.realizations?.length > 0;
      if (!hasRealizations && !sameTokenSequence(overtSurfaces, sentenceTokens)) return null;

      let realizedTokenIndices;
      if (hasRealizations) {
        const exactNodes = new Map(Array.from(nodesById.values(), (node) => [node.id, node]));
        // A final root must contain every declared source; groups in another
        // workspace cannot be discarded merely because this root matches words.
        if (options.realizations.some((group) => group.nodeIds.some((id) => !exactNodes.has(id)))) return null;
        const fieldPath = `$.derivationStages[${options.stageIndex}]`;
        const surface = resolveRealizations([candidate], options.realizations, sentenceTokens,
          { stageIndex: options.stageIndex, fieldPath, complete: true });
        if (surface.diagnostics.length) {
          const failure = surface.diagnostics[0];
          throw new ParseApiError('BAD_MODEL_RESPONSE', failure.message, 502,
            withFailureDetails({}, { ...failure, failureClass: failure.class }));
        }
        surface.tokenAssignments.forEach((tokenIndex, id) => { exactNodes.get(id).tokenIndex = tokenIndex; });
        realizedTokenIndices = surface.tokenIndicesByNodeId;
      } else {
        nodesById.forEach((node, nodeId) => {
          if (!overtTerminalIds.has(nodeId) && Object.hasOwn(node, 'tokenIndex')) {
            alignmentError(node, 'tokenIndex', 'no tokenIndex on a non-overt node');
          }
        });
        overtTerminals.forEach((node, tokenIndex) => {
          if (Object.hasOwn(node, 'tokenIndex') && node.tokenIndex !== tokenIndex) {
            alignmentError(node, 'tokenIndex', `the integer ${tokenIndex}`);
          }
          node.tokenIndex = tokenIndex;
        });
      }
      deriveCanonicalSurfaceSpans(candidate, realizedTokenIndices);
      collectNodeReferencesById(candidate).forEach((node, nodeId) => {
        const authored = authoredTechnicalFields.get(nodeId);
        if (!authored) return;
        if (
          authored.hasTokenIndex
          && authored.tokenIndex !== node.tokenIndex
        ) {
          alignmentError({ ...node, tokenIndex: authored.tokenIndex }, 'tokenIndex', `the integer ${node.tokenIndex}`);
        }
        if (
          authored.hasSurfaceSpan
          && JSON.stringify(authored.surfaceSpan) !== JSON.stringify(node.surfaceSpan)
        ) {
          const differingIndex = Array.isArray(authored.surfaceSpan) && Array.isArray(node.surfaceSpan)
            && authored.surfaceSpan.length === 2
            ? authored.surfaceSpan.findIndex((value, index) => value !== node.surfaceSpan[index]) : -1;
          if (differingIndex >= 0) {
            alignmentError({ ...node, [`surfaceSpan[${differingIndex}]`]: authored.surfaceSpan[differingIndex] },
              `surfaceSpan[${differingIndex}]`, `the integer ${node.surfaceSpan[differingIndex]}`);
          }
          alignmentError({ ...node, surfaceSpan: authored.surfaceSpan }, 'surfaceSpan', JSON.stringify(node.surfaceSpan) || 'no span on a non-overt node');
        }
      });
    } catch (error) {
      if (options.validationIssues) {
        if (!(error instanceof ParseApiError)
          || !['token-alignment', 'realization-alignment'].includes(error.failure?.processingStep)) throw error;
        options.validationIssues.push(error.failure);
      }
      return null;
    }
    const overtTerminals = collectOvertTerminalNodes(candidate)
      .map((node) => authoredWord(node))
      .map((token) => String(token || '').trim())
      .filter(Boolean);
    return options.realizations?.length > 0 || sameTokenSequence(overtTerminals, sentenceTokens) ? candidate : null;
  };

  const selectCommittedDerivationRoot = (workspaceForest, sentenceTokens = [], options = {}) => {
    if (!Array.isArray(workspaceForest) || workspaceForest.length === 0) return null;
    const candidates = workspaceForest
      .map((root, index) => canonicalizeDerivationRootCandidateForSentence(root, sentenceTokens, {
        ...options, fieldPath: `${options.fieldPath || '$.workspaceForest'}[${index}]`
      }))
      .filter(Boolean);
    return candidates.length === 1 ? candidates[0] : null;
  };

  const findCommittedFinalDerivationFrame = (derivationFrames, sentenceTokens = [], options = {}) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0) return null;
    const frameIndex = derivationFrames.length - 1;
    const frame = derivationFrames[frameIndex];
    const root = selectCommittedDerivationRoot(
      getFrameWorkspaceForest(frame),
      sentenceTokens,
      { ...options, realizations: frame?.after?.realizations, stageIndex: frameIndex, fieldPath: `$.derivationStages[${frameIndex}].workspaceForest` }
    );
    return root ? { frame, frameIndex, root } : null;
  };

  const buildCanonicalDerivationFromDerivationFrames = (
    derivationFrames,
    sentenceTokens = [],
    options = {}
  ) => {
    const committedFrame = findCommittedFinalDerivationFrame(
      derivationFrames,
      sentenceTokens,
      options
    );
    if (!committedFrame?.root) return null;
    const pronouncedTerminals = collectOvertTerminalNodes(committedFrame.root)
      .map((node) => authoredWord(node))
      .map((token) => String(token || '').trim())
      .filter(Boolean);
    if (!committedFrame.frame?.after?.realizations?.length && !sameTokenSequence(pronouncedTerminals, sentenceTokens)) return null;

    return { tree: committedFrame.root };
  };

  return {
    inspectDerivationWorkspaces,
    normalizeDerivationStagesToDerivationFrames,
    normalizeDerivationFrames,
    canonicalizeDerivationRootCandidateForSentence,
    selectCommittedDerivationRoot,
    findCommittedFinalDerivationFrame,
    buildCanonicalDerivationFromDerivationFrames
  };
};
