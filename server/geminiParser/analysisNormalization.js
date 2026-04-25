export const createAnalysisNormalizationHelpers = ({
  normalizeOpenChainType,
  normalizeChainType,
  normalizeKey,
  normalizeNodeIdArray,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  normalizeTransportJsonArray
}) => {
  const normalizeChains = (value, nodeIds) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const chainId = normalizeOptionalStepText(item.chainId || item.id);
        if (!chainId) return null;
        const copies = normalizeNodeIdArray(
          Array.isArray(item.copies) && item.copies.length > 0
            ? item.copies
            : item.hops,
          nodeIds
        ) || [];
        const pronouncedCopy = (() => {
          const nodeId = String(item.pronouncedCopy || item.targetNodeId || '').trim();
          return nodeId && nodeIds.has(nodeId) ? nodeId : undefined;
        })();
        const explicitSilentCopies = normalizeNodeIdArray(item.silentCopies, nodeIds) || [];
        const silentCopies = explicitSilentCopies.length > 0
          ? explicitSilentCopies
          : copies.filter((copyId) => copyId && copyId !== pronouncedCopy);
        return {
          chainId,
          type: normalizeOpenChainType(item.type) || normalizeChainType(item.type),
          family: normalizeChainType(item.family || item.type),
          copies,
          pronouncedCopy,
          silentCopies,
          features: normalizeOptionalStringArray(item.features),
          note: normalizeOptionalStepText(item.note || item.description)
        };
      })
      .filter(Boolean);
  };

  const collectStructuredEntries = (value) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (Array.isArray(parsedValue)) return parsedValue;
    if (!parsedValue || typeof parsedValue !== 'object') return [];
    return Object.entries(parsedValue)
      .map(([key, payload]) => ({
        __entryKey: String(key || '').trim(),
        ...(payload && typeof payload === 'object' ? payload : { value: payload })
      }))
      .filter((item) => Object.keys(item).length > 0);
  };

  const normalizeLedgerSupportAnchors = (item, nodeIds, stepIds) => {
    if (!item || typeof item !== 'object') return {};
    const normalizedNodeIds = normalizeNodeIdArray(item.nodeIds, nodeIds);
    const normalizedStepIds = Array.isArray(item.stepIds)
      ? item.stepIds
          .map((stepId) => normalizeOptionalStepText(stepId))
          .filter((stepId) => stepId && (!stepIds || stepIds.has(stepId)))
      : undefined;
    return {
      ...(normalizedNodeIds && normalizedNodeIds.length > 0 ? { nodeIds: normalizedNodeIds } : {}),
      ...(normalizedStepIds && normalizedStepIds.length > 0 ? { stepIds: normalizedStepIds } : {})
    };
  };

  const normalizeCaseAssignments = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        if (Array.isArray(item.arguments)) return [];
        return [item];
      })
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const supportAnchors = normalizeLedgerSupportAnchors(item, nodeIds, stepIds);
        if (item.__entryKey && typeof item.value !== 'undefined' && !item.nodeId && !item.assignee) {
          const assigneeLabel = normalizeOptionalStepText(item.__entryKey);
          const caseValue = normalizeOptionalStepText(item.value);
          if (!assigneeLabel && !caseValue) return null;
          return {
            ...supportAnchors,
            assignmentId: normalizeOptionalStepText(item.assignmentId || item.id || assigneeLabel),
            assigneeLabel,
            case: caseValue,
            assigner: normalizeOptionalStepText(item.assigner),
            mechanism: normalizeOptionalStepText(item.mechanism),
            evidence: normalizeOptionalStepText(item.evidence),
            overt: typeof item.overt === 'boolean' ? item.overt : undefined,
            position: normalizeOptionalStepText(item.position)
          };
        }
        const nodeId = String(
          item.nodeId
          || item.assigneeNodeId
          || item.assigneeId
          || item.dependentNodeId
          || ''
        ).trim();
        const assigneeLabel = normalizeOptionalStepText(
          item.assigneeLabel
          || item.assignee
          || item.dependent
          || item.nodeLabel
        );
        const caseValue = normalizeOptionalStepText(item.case || item.caseValue || item.value);
        const assigner = normalizeOptionalStepText(
          item.assigner
          || item.assignerLabel
          || item.caseAssigner
          || item.assignerId
        );
        if (!nodeId && !assigneeLabel) return null;
        if (!caseValue) return null;
        return {
          ...supportAnchors,
          assignmentId: normalizeOptionalStepText(item.assignmentId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          assigneeLabel,
          case: caseValue,
          assigner,
          mechanism: normalizeOptionalStepText(item.mechanism),
          evidence: normalizeOptionalStepText(item.evidence),
          overt: typeof item.overt === 'boolean' ? item.overt : undefined,
          position: normalizeOptionalStepText(item.position)
        };
      })
      .filter(Boolean);
  };

  const normalizeArgumentStructure = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const supportAnchors = normalizeLedgerSupportAnchors(item, nodeIds, stepIds);
        if (Array.isArray(item.arguments) && item.arguments.length > 0) {
          const predicate = normalizeOptionalStepText(
            item.predicate
            || item.predicateLabel
            || item.introducer
            || item.introducerHead
            || item.head
            || item.__entryKey
          );
          return item.arguments
            .map((argument, index) => {
              if (!argument || typeof argument !== 'object') return null;
              const nodeId = String(argument.nodeId || '').trim();
              const referent = normalizeOptionalStepText(
                argument.argument
                || argument.argumentLabel
                || argument.referent
                || argument.participant
                || argument.value
              );
              const role = normalizeOptionalStepText(
                argument.role
                || argument.thetaRole
                || argument.thematicRole
                || argument.theta
              );
              const position = normalizeOptionalStepText(argument.position || argument.mergeSite);
              if (!predicate || !role || (!referent && !nodeId)) return null;
              return {
                ...supportAnchors,
                argumentId: normalizeOptionalStepText(argument.argumentId || argument.id || `${predicate || 'argument'}:${index + 1}`),
                nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
                role,
                introducer: normalizeOptionalStepText(argument.introducer || argument.introducerHead || argument.head),
                predicate,
                referent,
                position,
                note: normalizeOptionalStepText(argument.note || item.note)
              };
            })
            .filter(Boolean);
        }
        const nodeId = String(item.nodeId || '').trim();
        const role = normalizeOptionalStepText(
          item.role
          || item.thetaRole
          || item.thematicRole
          || item.theta
          || item.__entryKey
        );
        const predicate = normalizeOptionalStepText(
          item.predicate
          || item.predicateLabel
          || item.introducer
          || item.introducerHead
          || item.head
          || item.__entryKey
        );
        const referent = normalizeOptionalStepText(
          item.referent
          || item.argument
          || item.argumentLabel
          || item.participant
          || item.value
        );
        if (item.__entryKey && !item.role && !item.thetaRole && !item.nodeId && !item.introducer && !item.position && typeof item.value !== 'undefined') {
          if (!referent) return null;
          return {
            ...supportAnchors,
            argumentId: normalizeOptionalStepText(item.argumentId || item.id || `${item.__entryKey}`),
            role: predicate,
            referent,
            note: normalizeOptionalStepText(item.note)
          };
        }
        if (item.__entryKey && !item.nodeId && item.value === undefined) {
          return Object.entries(item)
            .filter(([key]) => key !== '__entryKey')
            .map(([entryRole, entryReferent]) => {
              const normalizedRole = normalizeOptionalStepText(entryRole);
              const normalizedReferent = normalizeOptionalStepText(entryReferent);
              if (!normalizedRole || !normalizedReferent) return null;
              return {
                ...supportAnchors,
                argumentId: normalizeOptionalStepText(item.argumentId || item.id || `${item.__entryKey}:${entryRole}`),
                role: normalizedRole,
                predicate: normalizeOptionalStepText(item.__entryKey),
                referent: normalizedReferent,
                note: normalizeOptionalStepText(item.note)
              };
            })
            .filter(Boolean);
        }
        if (nodeId && !nodeIds.has(nodeId)) return null;
        if (!predicate || !role || (!referent && !nodeId)) return null;
        return {
          ...supportAnchors,
          argumentId: normalizeOptionalStepText(item.argumentId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          role,
          introducer: normalizeOptionalStepText(item.introducer || item.introducerHead || item.head),
          predicate,
          referent,
          position: normalizeOptionalStepText(item.position || item.mergeSite),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .flat()
      .filter(Boolean);
  };

  const normalizePhaseLog = (value, nodeIds, stepIds) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          phaseId: normalizeOptionalStepText(item.phaseId),
          phaseHead: normalizeOptionalStepText(item.phaseHead),
          complementDomain: normalizeOptionalStepText(item.complementDomain),
          transferredNodes: normalizeNodeIdArray(item.transferredNodes, nodeIds),
          edgeNodes: normalizeNodeIdArray(item.edgeNodes, nodeIds),
          spelloutDomain: normalizeOptionalStepText(item.spelloutDomain)
        };
      })
      .filter(Boolean);
  };

  const normalizeMorphologyRealization = (value, nodeIds, stepIds) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || '').trim();
        if (!nodeId || !nodeIds.has(nodeId)) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          realizationId: normalizeOptionalStepText(item.realizationId),
          nodeId,
          surfaceExponent: normalizeOptionalStepText(item.surfaceExponent),
          featuresRealized: normalizeOptionalStringArray(item.featuresRealized),
          hostHead: normalizeOptionalStepText(item.hostHead),
          isPortmanteau: typeof item.isPortmanteau === 'boolean' ? item.isPortmanteau : undefined,
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeFeatureLedger = (value, nodeIds, stepIds) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const feature = normalizeOptionalStepText(item.feature);
        if (!feature) return null;
        const nodeId = String(item.nodeId || '').trim();
        const sourceStepId = normalizeOptionalStepText(item.sourceStepId);
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          entryId: normalizeOptionalStepText(item.entryId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          feature,
          value: normalizeOptionalStepText(item.value),
          status: normalizeOptionalStepText(item.status),
          sourceStepId: sourceStepId && stepIds.has(sourceStepId) ? sourceStepId : undefined,
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeSelectionLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const selectorNodeId = String(item.selectorNodeId || '').trim();
        const selectedNodeId = String(item.selectedNodeId || '').trim();
        const selectorHead = normalizeOptionalStepText(
          item.selectorHead
          || item.selector
          || item.selectorLabel
          || item.head
          || item.__entryKey
        );
        const selectedCategory = normalizeOptionalStepText(
          item.selectedCategory
          || item.selectedLabel
          || item.selectee
          || item.selected
          || item.complementCategory
          || item.complement
          || item.specifierCategory
          || item.specifier
          || item.value
        );
        const relation = normalizeOptionalStepText(
          item.relation
          || (item.complementCategory || item.complement ? 'complement' : '')
          || (item.specifierCategory || item.specifier ? 'specifier' : '')
        );
        if (!selectorNodeId && !selectedNodeId && !selectorHead && !selectedCategory && !relation) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          selectionId: normalizeOptionalStepText(item.selectionId || item.id),
          selectorNodeId: selectorNodeId && nodeIds.has(selectorNodeId) ? selectorNodeId : undefined,
          selectorHead,
          selectedNodeId: selectedNodeId && nodeIds.has(selectedNodeId) ? selectedNodeId : undefined,
          selectedCategory,
          selectorLabel: normalizeOptionalStepText(item.selectorLabel || item.selector),
          selectedLabel: normalizeOptionalStepText(item.selectedLabel || item.selectee),
          relation,
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeBindingLedger = (value, nodeIds, stepIds) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const domainNodeId = String(item.domainNodeId || '').trim();
        const antecedentNodeId = String(item.antecedentNodeId || '').trim();
        const dependentNodeId = String(item.dependentNodeId || '').trim();
        const antecedentLabel = normalizeOptionalStepText(item.antecedentLabel || item.antecedent || item.binder);
        const dependentLabel = normalizeOptionalStepText(item.dependentLabel || item.dependent || item.bindee || item.anaphor);
        const relation = normalizeOptionalStepText(item.relation);
        const principle = normalizeOptionalStepText(item.principle);
        const status = normalizeOptionalStepText(item.status);
        if (!domainNodeId && !antecedentNodeId && !dependentNodeId && !antecedentLabel && !dependentLabel && !relation && !principle && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          bindingId: normalizeOptionalStepText(item.bindingId || item.id),
          domainNodeId: domainNodeId && nodeIds.has(domainNodeId) ? domainNodeId : undefined,
          antecedentNodeId: antecedentNodeId && nodeIds.has(antecedentNodeId) ? antecedentNodeId : undefined,
          dependentNodeId: dependentNodeId && nodeIds.has(dependentNodeId) ? dependentNodeId : undefined,
          antecedentLabel,
          dependentLabel,
          relation,
          principle,
          status,
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeClausalDependencies = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const rawType = normalizeOptionalStepText(item.type || item.dependencyType || item.relationType || item.__entryKey);
        let type = rawType;
        let subtype = normalizeOptionalStepText(item.subtype || item.dependencySubtype || item.kind);
        if (rawType) {
          const normalizedRawType = normalizeKey(rawType);
          if (normalizedRawType.includes('raising')) {
            type = 'raising';
            subtype ||= rawType;
          } else if (normalizedRawType.includes('control')) {
            type = 'control';
            subtype ||= rawType;
          } else if (normalizedRawType === 'ecm' || normalizedRawType.includes('exceptional-case-marking')) {
            type = 'ecm';
            subtype ||= rawType;
          }
        }
        const predicateNodeId = String(item.predicateNodeId || item.predicateId || '').trim();
        const clauseNodeId = String(item.clauseNodeId || item.clauseId || '').trim();
        const controllerNodeId = String(item.controllerNodeId || item.controllerId || '').trim();
        const dependentNodeId = String(item.dependentNodeId || item.dependentId || '').trim();
        const predicateLabel = normalizeOptionalStepText(item.predicateLabel || item.predicate || item.matrixPredicate || item.matrix);
        const clauseLabel = normalizeOptionalStepText(item.clauseLabel || item.clause || item.dependentClause || item.embeddedClause || item.embedded);
        const controllerLabel = normalizeOptionalStepText(item.controllerLabel || item.controller || item.matrixSubject);
        const dependentLabel = normalizeOptionalStepText(
          item.dependentLabel
          || item.dependent
          || item.controllee
          || item.raisedArgument
          || item.embeddedSubject
        );
        if (!type && !subtype && !predicateNodeId && !clauseNodeId && !controllerNodeId && !dependentNodeId && !predicateLabel && !clauseLabel && !controllerLabel && !dependentLabel) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          dependencyId: normalizeOptionalStepText(item.dependencyId || item.id),
          type,
          subtype,
          predicateNodeId: predicateNodeId && nodeIds.has(predicateNodeId) ? predicateNodeId : undefined,
          clauseNodeId: clauseNodeId && nodeIds.has(clauseNodeId) ? clauseNodeId : undefined,
          controllerNodeId: controllerNodeId && nodeIds.has(controllerNodeId) ? controllerNodeId : undefined,
          dependentNodeId: dependentNodeId && nodeIds.has(dependentNodeId) ? dependentNodeId : undefined,
          predicateLabel,
          clauseLabel,
          controllerLabel,
          dependentLabel,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeAgreementLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const probeNodeId = String(item.probeNodeId || '').trim();
        const goalNodeId = String(item.goalNodeId || '').trim();
        const probeLabel = normalizeOptionalStepText(item.probeLabel || item.probe || item.agreeingHead || item.head || item.__entryKey);
        const goalLabel = normalizeOptionalStepText(item.goalLabel || item.goal || item.agreeWith || item.controller);
        const feature = normalizeOptionalStepText(item.feature || item.agreementFeature || item.phiFeature || item.nounClassFeature);
        const valueLabel = normalizeOptionalStepText(item.value || item.classValue || item.nounClass || item.agreementValue);
        const morphology = normalizeOptionalStepText(item.morphology || item.exponent || item.prefix || item.surfaceExponent);
        const status = normalizeOptionalStepText(item.status || item.outcome);
        const direction = normalizeOptionalStepText(item.direction || item.probeDirection);
        const domain = normalizeOptionalStepText(item.domain || item.probeDomain);
        const defaultValue = typeof item.defaultValue === 'boolean'
          ? item.defaultValue
          : normalizeKey(item.status) === 'default';
        if (!probeNodeId && !goalNodeId && !probeLabel && !goalLabel && !feature && !valueLabel && !morphology && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          agreementId: normalizeOptionalStepText(item.agreementId || item.id),
          probeNodeId: probeNodeId && nodeIds.has(probeNodeId) ? probeNodeId : undefined,
          goalNodeId: goalNodeId && nodeIds.has(goalNodeId) ? goalNodeId : undefined,
          probeLabel,
          goalLabel,
          feature,
          value: valueLabel,
          morphology,
          status,
          direction,
          domain,
          defaultValue,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizePredicateClassLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const predicateNodeId = String(item.predicateNodeId || '').trim();
        const predicateLabel = normalizeOptionalStepText(item.predicateLabel || item.predicate || item.head || item.__entryKey);
        const classification = normalizeOptionalStepText(item.classification || item.type || item.value);
        const subtype = normalizeOptionalStepText(item.subtype || item.kind);
        const diagnostics = normalizeOptionalStringArray(item.diagnostics || item.tests || item.diagnosticSupport);
        if (!predicateNodeId && !predicateLabel && !classification && !subtype && (!diagnostics || diagnostics.length === 0)) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          predicateClassId: normalizeOptionalStepText(item.predicateClassId || item.id),
          predicateNodeId: predicateNodeId && nodeIds.has(predicateNodeId) ? predicateNodeId : undefined,
          predicateLabel,
          classification,
          subtype,
          diagnostics,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeProbeLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const probeNodeId = String(item.probeNodeId || '').trim();
        const goalNodeId = String(item.goalNodeId || '').trim();
        const probeLabel = normalizeOptionalStepText(item.probeLabel || item.probe || item.head || item.__entryKey);
        const goalLabel = normalizeOptionalStepText(item.goalLabel || item.goal || item.target);
        const feature = normalizeOptionalStepText(item.feature || item.probedFeature || item.value);
        const direction = normalizeOptionalStepText(item.direction || item.probeDirection);
        const domain = normalizeOptionalStepText(item.domain || item.probeDomain);
        const locality = normalizeOptionalStepText(item.locality || item.boundary);
        const outcome = normalizeOptionalStepText(item.outcome || item.status);
        if (!probeNodeId && !goalNodeId && !probeLabel && !goalLabel && !feature && !direction && !domain && !outcome) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          probeId: normalizeOptionalStepText(item.probeId || item.id),
          probeNodeId: probeNodeId && nodeIds.has(probeNodeId) ? probeNodeId : undefined,
          goalNodeId: goalNodeId && nodeIds.has(goalNodeId) ? goalNodeId : undefined,
          probeLabel,
          goalLabel,
          feature,
          direction,
          domain,
          locality,
          outcome,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeNullElementLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || '').trim();
        const controllerNodeId = String(item.controllerNodeId || '').trim();
        const antecedentNodeId = String(item.antecedentNodeId || '').trim();
        const label = normalizeOptionalStepText(item.label || item.surface || item.__entryKey || item.value);
        const kind = normalizeOptionalStepText(item.kindValue || item.nullElementKind || item.kind || item.type);
        const controllerLabel = normalizeOptionalStepText(item.controllerLabel || item.controller);
        const antecedentLabel = normalizeOptionalStepText(item.antecedentLabel || item.antecedent);
        const licensing = normalizeOptionalStepText(item.licensing || item.licensedBy || item.license);
        if (!nodeId && !label && !kind && !controllerNodeId && !antecedentNodeId && !controllerLabel && !antecedentLabel && !licensing) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          nullElementId: normalizeOptionalStepText(item.nullElementId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          label,
          kind,
          controllerNodeId: controllerNodeId && nodeIds.has(controllerNodeId) ? controllerNodeId : undefined,
          controllerLabel,
          antecedentNodeId: antecedentNodeId && nodeIds.has(antecedentNodeId) ? antecedentNodeId : undefined,
          antecedentLabel,
          licensing,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeDiagnosticLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const diagnostic = normalizeOptionalStepText(item.diagnostic || item.__entryKey);
        const observation = normalizeOptionalStepText(item.observation || item.value);
        const supports = normalizeOptionalStepText(item.supports || item.classification || item.conclusion);
        const status = normalizeOptionalStepText(item.status);
        if (!diagnostic && !observation && !supports && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          diagnosticId: normalizeOptionalStepText(item.diagnosticId || item.id),
          diagnostic,
          observation,
          supports,
          status,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeParameterLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const parameter = normalizeOptionalStepText(item.parameter || item.__entryKey);
        const parameterValue = normalizeOptionalStepText(item.value || item.setting || item.parameterValue);
        const domain = normalizeOptionalStepText(item.domain);
        const language = normalizeOptionalStepText(item.language);
        if (!parameter && !parameterValue && !domain && !language) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          parameterId: normalizeOptionalStepText(item.parameterId || item.id),
          parameter,
          value: parameterValue,
          domain,
          language,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeInformationStructureLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || '').trim();
        const label = normalizeOptionalStepText(item.label || item.nodeLabel || item.phrase || item.__entryKey);
        const role = normalizeOptionalStepText(item.role || item.informationRole || item.discourseRole || item.value);
        const scope = normalizeOptionalStepText(item.scope || item.domain);
        if (!nodeId && !label && !role && !scope) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          informationStructureId: normalizeOptionalStepText(item.informationStructureId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          label,
          role,
          scope,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeOperatorScopeLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const operatorNodeId = String(item.operatorNodeId || '').trim();
        const scopeNodeId = String(item.scopeNodeId || '').trim();
        const operatorLabel = normalizeOptionalStepText(item.operatorLabel || item.operator || item.__entryKey);
        const scopeLabel = normalizeOptionalStepText(item.scopeLabel || item.scope || item.domainLabel || item.target);
        const operatorType = normalizeOptionalStepText(item.operatorType || item.type);
        const relation = normalizeOptionalStepText(item.relation || item.scopeRelation || item.value);
        if (!operatorNodeId && !scopeNodeId && !operatorLabel && !scopeLabel && !operatorType && !relation) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          operatorScopeId: normalizeOptionalStepText(item.operatorScopeId || item.id),
          operatorNodeId: operatorNodeId && nodeIds.has(operatorNodeId) ? operatorNodeId : undefined,
          scopeNodeId: scopeNodeId && nodeIds.has(scopeNodeId) ? scopeNodeId : undefined,
          operatorLabel,
          scopeLabel,
          operatorType,
          relation,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeVoiceValencyLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const predicateNodeId = String(item.predicateNodeId || '').trim();
        const predicateLabel = normalizeOptionalStepText(item.predicateLabel || item.predicate || item.__entryKey);
        const voice = normalizeOptionalStepText(item.voice || item.type);
        const valency = normalizeOptionalStepText(item.valency || item.arity || item.value);
        const externalArgument = normalizeOptionalStepText(item.externalArgument || item.subjectRole);
        const internalArgument = normalizeOptionalStepText(item.internalArgument || item.objectRole);
        if (!predicateNodeId && !predicateLabel && !voice && !valency && !externalArgument && !internalArgument) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          voiceValencyId: normalizeOptionalStepText(item.voiceValencyId || item.id),
          predicateNodeId: predicateNodeId && nodeIds.has(predicateNodeId) ? predicateNodeId : undefined,
          predicateLabel,
          voice,
          valency,
          externalArgument,
          internalArgument,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeLinearizationLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const domainNodeId = String(item.domainNodeId || item.nodeId || item.targetNodeId || '').trim();
        const domainLabel = normalizeOptionalStepText(item.domainLabel || item.domain || item.nodeLabel || item.label || item.__entryKey);
        const order = normalizeOptionalStringArray(item.order || item.sequence || item.surfaceOrder || item.tokens);
        const mechanism = normalizeOptionalStepText(item.mechanism || item.linearizationMechanism || item.rule);
        const effect = normalizeOptionalStepText(item.effect || item.linearizationEffect || item.description || item.value);
        if (!domainNodeId && !domainLabel && (!order || order.length === 0) && !mechanism && !effect) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          linearizationId: normalizeOptionalStepText(item.linearizationId || item.id),
          domainNodeId: domainNodeId && nodeIds.has(domainNodeId) ? domainNodeId : undefined,
          domainLabel,
          order,
          mechanism,
          effect,
          evidence: normalizeOptionalStepText(item.evidence || item.support),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeLocalityLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const movingNodeId = String(item.movingNodeId || item.sourceNodeId || '').trim();
        const landingNodeId = String(item.landingNodeId || item.targetNodeId || '').trim();
        const movingLabel = normalizeOptionalStepText(item.movingLabel || item.mover || item.__entryKey);
        const landingLabel = normalizeOptionalStepText(item.landingLabel || item.target || item.landingSite);
        const dependencyType = normalizeOptionalStepText(item.dependencyType || item.type);
        const boundary = normalizeOptionalStepText(item.boundary || item.domain);
        const status = normalizeOptionalStepText(item.status || item.outcome || item.value);
        if (!movingNodeId && !landingNodeId && !movingLabel && !landingLabel && !dependencyType && !boundary && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          localityId: normalizeOptionalStepText(item.localityId || item.id),
          dependencyType,
          movingNodeId: movingNodeId && nodeIds.has(movingNodeId) ? movingNodeId : undefined,
          landingNodeId: landingNodeId && nodeIds.has(landingNodeId) ? landingNodeId : undefined,
          movingLabel,
          landingLabel,
          boundary,
          status,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizePredicationLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const predicateNodeId = String(item.predicateNodeId || '').trim();
        const subjectNodeId = String(item.subjectNodeId || item.controllerNodeId || '').trim();
        const predicateLabel = normalizeOptionalStepText(item.predicateLabel || item.predicate || item.__entryKey);
        const subjectLabel = normalizeOptionalStepText(item.subjectLabel || item.subject || item.referent);
        const relation = normalizeOptionalStepText(item.relation || item.kind || item.value);
        if (!predicateNodeId && !subjectNodeId && !predicateLabel && !subjectLabel && !relation) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          predicationId: normalizeOptionalStepText(item.predicationId || item.id),
          predicateNodeId: predicateNodeId && nodeIds.has(predicateNodeId) ? predicateNodeId : undefined,
          subjectNodeId: subjectNodeId && nodeIds.has(subjectNodeId) ? subjectNodeId : undefined,
          predicateLabel,
          subjectLabel,
          relation,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeParticleLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || item.particleNodeId || '').trim();
        const particleLabel = normalizeOptionalStepText(
          item.particleLabel
          || item.particle
          || item.markerLabel
          || item.marker
          || item.__entryKey
        );
        const particleType = normalizeOptionalStepText(item.particleType || item.type || item.category);
        const functionLabel = normalizeOptionalStepText(item.function || item.discourseFunction || item.clauseFunction || item.value);
        const clauseType = normalizeOptionalStepText(item.clauseType);
        const scope = normalizeOptionalStepText(item.scope || item.domain);
        if (!nodeId && !particleLabel && !particleType && !functionLabel && !clauseType && !scope) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          particleId: normalizeOptionalStepText(item.particleId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          particleLabel,
          particleType,
          function: functionLabel,
          clauseType,
          scope,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeEvidentialityLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || item.markerNodeId || '').trim();
        const markerLabel = normalizeOptionalStepText(item.markerLabel || item.marker || item.__entryKey);
        const evidentialType = normalizeOptionalStepText(item.evidentialType || item.type || item.value);
        const sourceType = normalizeOptionalStepText(item.sourceType || item.source);
        const scope = normalizeOptionalStepText(item.scope || item.domain);
        const status = normalizeOptionalStepText(item.status);
        if (!nodeId && !markerLabel && !evidentialType && !sourceType && !scope && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          evidentialityId: normalizeOptionalStepText(item.evidentialityId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          markerLabel,
          evidentialType,
          sourceType,
          scope,
          status,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeMirativityLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || item.markerNodeId || '').trim();
        const markerLabel = normalizeOptionalStepText(item.markerLabel || item.marker || item.__entryKey);
        const mirativityType = normalizeOptionalStepText(item.mirativityType || item.type || item.value);
        const scope = normalizeOptionalStepText(item.scope || item.domain);
        const status = normalizeOptionalStepText(item.status);
        if (!nodeId && !markerLabel && !mirativityType && !scope && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          mirativityId: normalizeOptionalStepText(item.mirativityId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          markerLabel,
          mirativityType,
          scope,
          status,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeHonorificityLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || item.markerNodeId || '').trim();
        const markerLabel = normalizeOptionalStepText(item.markerLabel || item.marker || item.__entryKey);
        const honorificType = normalizeOptionalStepText(item.honorificType || item.type || item.value);
        const target = normalizeOptionalStepText(item.target || item.targetLabel || item.referent);
        const status = normalizeOptionalStepText(item.status || item.level);
        if (!nodeId && !markerLabel && !honorificType && !target && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          honorificityId: normalizeOptionalStepText(item.honorificityId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          markerLabel,
          honorificType,
          target,
          status,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeSwitchReferenceLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const markerNodeId = String(item.markerNodeId || item.nodeId || '').trim();
        const controllerClauseNodeId = String(item.controllerClauseNodeId || item.matrixClauseNodeId || '').trim();
        const dependentClauseNodeId = String(item.dependentClauseNodeId || item.embeddedClauseNodeId || '').trim();
        const markerLabel = normalizeOptionalStepText(item.markerLabel || item.marker || item.__entryKey);
        const controllerLabel = normalizeOptionalStepText(item.controllerLabel || item.controller || item.sameSubjectReferent);
        const dependentLabel = normalizeOptionalStepText(item.dependentLabel || item.dependent || item.differentSubjectReferent);
        const relation = normalizeOptionalStepText(item.relation || item.type || item.value);
        const status = normalizeOptionalStepText(item.status);
        if (!markerNodeId && !controllerClauseNodeId && !dependentClauseNodeId && !markerLabel && !controllerLabel && !dependentLabel && !relation && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          switchReferenceId: normalizeOptionalStepText(item.switchReferenceId || item.id),
          markerNodeId: markerNodeId && nodeIds.has(markerNodeId) ? markerNodeId : undefined,
          controllerClauseNodeId: controllerClauseNodeId && nodeIds.has(controllerClauseNodeId) ? controllerClauseNodeId : undefined,
          dependentClauseNodeId: dependentClauseNodeId && nodeIds.has(dependentClauseNodeId) ? dependentClauseNodeId : undefined,
          markerLabel,
          controllerLabel,
          dependentLabel,
          relation,
          status,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeLogophoraLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nodeId = String(item.nodeId || item.logophoricNodeId || '').trim();
        const controllerNodeId = String(item.controllerNodeId || item.antecedentNodeId || '').trim();
        const logophoricLabel = normalizeOptionalStepText(item.logophoricLabel || item.logophor || item.__entryKey);
        const controllerLabel = normalizeOptionalStepText(item.controllerLabel || item.controller || item.antecedent);
        const domain = normalizeOptionalStepText(item.domain || item.scope);
        const status = normalizeOptionalStepText(item.status || item.type || item.value);
        if (!nodeId && !controllerNodeId && !logophoricLabel && !controllerLabel && !domain && !status) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          logophoraId: normalizeOptionalStepText(item.logophoraId || item.id),
          nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
          controllerNodeId: controllerNodeId && nodeIds.has(controllerNodeId) ? controllerNodeId : undefined,
          logophoricLabel,
          controllerLabel,
          domain,
          status,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeEventStructureLedger = (value, nodeIds, stepIds) => {
    return collectStructuredEntries(value)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const predicateNodeId = String(item.predicateNodeId || '').trim();
        const predicateLabel = normalizeOptionalStepText(item.predicateLabel || item.predicate || item.__entryKey);
        const eventType = normalizeOptionalStepText(item.eventType || item.type);
        const lexicalAspect = normalizeOptionalStepText(item.lexicalAspect || item.aspect || item.value);
        const viewpointAspect = normalizeOptionalStepText(item.viewpointAspect);
        const boundedness = normalizeOptionalStepText(item.boundedness);
        const telicity = normalizeOptionalStepText(item.telicity);
        if (!predicateNodeId && !predicateLabel && !eventType && !lexicalAspect && !viewpointAspect && !boundedness && !telicity) return null;
        return {
          ...normalizeLedgerSupportAnchors(item, nodeIds, stepIds),
          eventStructureId: normalizeOptionalStepText(item.eventStructureId || item.id),
          predicateNodeId: predicateNodeId && nodeIds.has(predicateNodeId) ? predicateNodeId : undefined,
          predicateLabel,
          eventType,
          lexicalAspect,
          viewpointAspect,
          boundedness,
          telicity,
          evidence: normalizeOptionalStepText(item.evidence),
          note: normalizeOptionalStepText(item.note)
        };
      })
      .filter(Boolean);
  };

  const normalizeOpenOntologyLabel = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const COMMITMENT_KIND_ALIASES = new Map([
    ['case', 'case'],
    ['caseassignment', 'case'],
    ['caseassignments', 'case'],
    ['argumentstructure', 'argument-structure'],
    ['argumentstructures', 'argument-structure'],
    ['argumentstructureledger', 'argument-structure'],
    ['phase', 'phase'],
    ['phaselog', 'phase'],
    ['morphology', 'morphology'],
    ['morphologyrealization', 'morphology'],
    ['feature', 'feature'],
    ['featureledger', 'feature'],
    ['selection', 'selection'],
    ['selectionledger', 'selection'],
    ['binding', 'binding'],
    ['bindingledger', 'binding'],
    ['clausaldependency', 'clausal-dependency'],
    ['clausaldependencies', 'clausal-dependency'],
    ['agreement', 'agreement'],
    ['agreementledger', 'agreement'],
    ['predicateclass', 'predicate-class'],
    ['predicateclassledger', 'predicate-class'],
    ['probe', 'probe'],
    ['probeledger', 'probe'],
    ['nullelement', 'null-element'],
    ['nullelementledger', 'null-element'],
    ['diagnostic', 'diagnostic'],
    ['diagnosticledger', 'diagnostic'],
    ['parameter', 'parameter'],
    ['parameterledger', 'parameter'],
    ['informationstructure', 'information-structure'],
    ['informationstructureledger', 'information-structure'],
    ['operatorscope', 'operator-scope'],
    ['operatorscopeledger', 'operator-scope'],
    ['voicevalency', 'voice-valency'],
    ['voicevalencyledger', 'voice-valency'],
    ['linearization', 'linearization'],
    ['linearizationledger', 'linearization'],
    ['locality', 'locality'],
    ['localityledger', 'locality'],
    ['predication', 'predication'],
    ['predicationledger', 'predication'],
    ['particle', 'particle'],
    ['particleledger', 'particle'],
    ['evidentiality', 'evidentiality'],
    ['evidentialityledger', 'evidentiality'],
    ['mirativity', 'mirativity'],
    ['mirativityledger', 'mirativity'],
    ['honorificity', 'honorificity'],
    ['honorificityledger', 'honorificity'],
    ['switchreference', 'switch-reference'],
    ['switchreferenceledger', 'switch-reference'],
    ['logophora', 'logophora'],
    ['logophoraledger', 'logophora'],
    ['eventstructure', 'event-structure'],
    ['eventstructureledger', 'event-structure']
  ]);

  const normalizeCommitmentKind = (value) => {
    const normalized = normalizeKey(value);
    if (!normalized) return '';
    return COMMITMENT_KIND_ALIASES.get(normalized) || normalizeOpenOntologyLabel(value);
  };

  const buildCommitmentLedgerSpecs = () => ([
    ['caseAssignments', 'case', 'assignmentId', normalizeCaseAssignments],
    ['argumentStructure', 'argument-structure', 'argumentId', normalizeArgumentStructure],
    ['phaseLog', 'phase', 'phaseId', normalizePhaseLog],
    ['morphologyRealization', 'morphology', 'realizationId', normalizeMorphologyRealization],
    ['featureLedger', 'feature', 'entryId', normalizeFeatureLedger],
    ['selectionLedger', 'selection', 'selectionId', normalizeSelectionLedger],
    ['bindingLedger', 'binding', 'bindingId', normalizeBindingLedger],
    ['clausalDependencies', 'clausal-dependency', 'dependencyId', normalizeClausalDependencies],
    ['agreementLedger', 'agreement', 'agreementId', normalizeAgreementLedger],
    ['predicateClassLedger', 'predicate-class', 'predicateClassId', normalizePredicateClassLedger],
    ['probeLedger', 'probe', 'probeId', normalizeProbeLedger],
    ['nullElementLedger', 'null-element', 'nullElementId', normalizeNullElementLedger],
    ['diagnosticLedger', 'diagnostic', 'diagnosticId', normalizeDiagnosticLedger],
    ['parameterLedger', 'parameter', 'parameterId', normalizeParameterLedger],
    ['informationStructureLedger', 'information-structure', 'informationStructureId', normalizeInformationStructureLedger],
    ['operatorScopeLedger', 'operator-scope', 'operatorScopeId', normalizeOperatorScopeLedger],
    ['voiceValencyLedger', 'voice-valency', 'voiceValencyId', normalizeVoiceValencyLedger],
    ['linearizationLedger', 'linearization', 'linearizationId', normalizeLinearizationLedger],
    ['localityLedger', 'locality', 'localityId', normalizeLocalityLedger],
    ['predicationLedger', 'predication', 'predicationId', normalizePredicationLedger],
    ['particleLedger', 'particle', 'particleId', normalizeParticleLedger],
    ['evidentialityLedger', 'evidentiality', 'evidentialityId', normalizeEvidentialityLedger],
    ['mirativityLedger', 'mirativity', 'mirativityId', normalizeMirativityLedger],
    ['honorificityLedger', 'honorificity', 'honorificityId', normalizeHonorificityLedger],
    ['switchReferenceLedger', 'switch-reference', 'switchReferenceId', normalizeSwitchReferenceLedger],
    ['logophoraLedger', 'logophora', 'logophoraId', normalizeLogophoraLedger],
    ['eventStructureLedger', 'event-structure', 'eventStructureId', normalizeEventStructureLedger]
  ]).map(([field, kind, idField, normalize]) => ({ field, kind, idField, normalize }));

  const commitmentLedgerSpecs = buildCommitmentLedgerSpecs();
  const commitmentLedgerSpecByKind = new Map(
    commitmentLedgerSpecs.map((spec) => [spec.kind, spec])
  );

  const isProjectedCommitmentKind = (value) =>
    commitmentLedgerSpecByKind.has(normalizeCommitmentKind(value));

  const normalizeCommitmentGraphIdArray = (items, allowedIds) => {
    if (!Array.isArray(items)) return undefined;
    const values = items
      .map((item) => normalizeOptionalStepText(item))
      .filter((item) => item && (!allowedIds || allowedIds.has(item)));
    return values.length > 0 ? Array.from(new Set(values)) : undefined;
  };

  const normalizeCommitmentParticipant = (participant, nodeIds) => {
    if (!participant || typeof participant !== 'object') return null;
    const nodeId = String(participant.nodeId || '').trim();
    const normalized = {
      role: normalizeOptionalStepText(participant.role),
      nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
      label: normalizeOptionalStepText(participant.label),
      value: normalizeOptionalStepText(participant.value)
    };
    return Object.values(normalized).some(Boolean) ? normalized : null;
  };

  const normalizeCommitmentParticipantsForMerge = (participants = []) => (
    Array.from(
      (Array.isArray(participants) ? participants : [])
        .filter((participant) => participant && typeof participant === 'object')
        .reduce((acc, participant) => {
          const normalized = {
            ...(normalizeOptionalStepText(participant.role) ? { role: normalizeOptionalStepText(participant.role) } : {}),
            ...(normalizeOptionalStepText(participant.nodeId) ? { nodeId: normalizeOptionalStepText(participant.nodeId) } : {}),
            ...(normalizeOptionalStepText(participant.label) ? { label: normalizeOptionalStepText(participant.label) } : {}),
            ...(normalizeOptionalStepText(participant.value) ? { value: normalizeOptionalStepText(participant.value) } : {})
          };
          if (Object.keys(normalized).length === 0) return acc;
          const mergeKey = `${normalized.role || ''}|${normalized.nodeId || ''}|${normalized.value || ''}`;
          const existing = acc.get(mergeKey);
          acc.set(mergeKey, {
            ...(existing || {}),
            ...normalized,
            ...(existing?.label || !normalized.label ? {} : { label: normalized.label }),
            ...(existing?.value || !normalized.value ? {} : { value: normalized.value })
          });
          return acc;
        }, new Map()).values()
    ).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  );

  const deriveRoleNameFromNodeField = (field, entry) => {
    if (field === 'nodeId') return normalizeOptionalStepText(entry?.role);
    if (!/NodeId$/.test(field)) return undefined;
    const rawRole = field.replace(/NodeId$/, '').replace(/([a-z])([A-Z])/g, '$1-$2');
    return normalizeOptionalStepText(rawRole);
  };

  const deriveOpenCommitmentSupportFromNodeFields = (entry, nodeIds) => {
    if (!entry || typeof entry !== 'object') return {};
    const derivedNodeIds = [];
    const derivedParticipants = [];

    const pushNodeId = (nodeId) => {
      const normalizedNodeId = String(nodeId || '').trim();
      if (!normalizedNodeId || !nodeIds.has(normalizedNodeId)) return undefined;
      derivedNodeIds.push(normalizedNodeId);
      return normalizedNodeId;
    };

    Object.entries(entry).forEach(([field, rawValue]) => {
      if (Array.isArray(rawValue) && /NodeIds$/.test(field)) {
        (normalizeNodeIdArray(rawValue, nodeIds) || []).forEach((nodeId) => {
          derivedNodeIds.push(nodeId);
        });
        return;
      }

      if (typeof rawValue !== 'string' || !/NodeId$/.test(field)) return;
      const nodeId = pushNodeId(rawValue);
      if (!nodeId) return;

      if (
        (field === 'hostNodeId' || field === 'targetNodeId')
        && String(entry.landingNodeId || '').trim()
        && String(entry.landingNodeId || '').trim() === nodeId
      ) {
        return;
      }

      const role = deriveRoleNameFromNodeField(field, entry);
      if (!role) return;
      derivedParticipants.push({ role, nodeId });
    });

    return {
      nodeIds: derivedNodeIds.length > 0 ? Array.from(new Set(derivedNodeIds)) : undefined,
      participants: derivedParticipants.length > 0
        ? normalizeCommitmentParticipantsForMerge(derivedParticipants)
        : undefined
    };
  };

  const normalizeOpenCommitmentFieldValue = (field, value, nodeIds, stepIds) => {
    if (value === undefined || value === null) return undefined;
    if (field === 'participants' && Array.isArray(value)) {
      const participants = value
        .map((item) => normalizeCommitmentParticipant(item, nodeIds))
        .filter(Boolean);
      return participants.length > 0 ? participants : undefined;
    }
    if (field === 'nodeIds') return normalizeNodeIdArray(value, nodeIds);
    if (field === 'stepIds') return normalizeCommitmentGraphIdArray(value, stepIds);
    if (field === 'chainId') return normalizeOptionalStepText(value);
    if (field === 'family') return normalizeCommitmentKind(value);
    if (field === 'frameworkLabel') return normalizeOptionalStepText(value);
    if (field === 'factId') return normalizeOptionalStepText(value);
    if (field === 'kind') return normalizeCommitmentKind(value);
    if (field === 'subtype') return normalizeOptionalStepText(value);
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    if (Array.isArray(value)) {
      if (/NodeIds?$/.test(field) || field === 'order' || /Nodes$/.test(field)) {
        return normalizeNodeIdArray(value, nodeIds);
      }
      return normalizeOptionalStringArray(value);
    }
    if (typeof value === 'string') {
      if (/NodeId$/.test(field)) {
        const nodeId = String(value || '').trim();
        return nodeId && nodeIds.has(nodeId) ? nodeId : undefined;
      }
      if (/StepId$/.test(field)) {
        const stepId = normalizeOptionalStepText(value);
        return stepId && (!stepIds || stepIds.has(stepId)) ? stepId : undefined;
      }
      return normalizeOptionalStepText(value);
    }
    return undefined;
  };

  const normalizeOpenCommitmentGraphEntry = (entry, nodeIds, stepIds) => {
    if (!entry || typeof entry !== 'object') return null;
    const kind = normalizeCommitmentKind(
      entry.kind
      || entry.family
      || entry.commitmentKind
      || entry.ledgerKind
      || entry.type
    );
    if (!kind) return null;

    const normalized = {
      ...normalizeLedgerSupportAnchors(entry, nodeIds, stepIds),
      factId: normalizeOptionalStepText(entry.factId || entry.id),
      kind,
      family: normalizeCommitmentKind(entry.family) || kind,
      frameworkLabel: normalizeOptionalStepText(entry.frameworkLabel || entry.kindLabel),
      chainId: normalizeOptionalStepText(entry.chainId),
      subtype: normalizeOptionalStepText(entry.subtype)
    };

    Object.entries(entry).forEach(([field, rawValue]) => {
      if (field === '__entryKey' || field === 'id') return;
      if (field in normalized) return;
      if (
        field === 'commitmentKind'
        || field === 'ledgerKind'
        || field === 'kindLabel'
      ) return;
      const normalizedValue = normalizeOpenCommitmentFieldValue(field, rawValue, nodeIds, stepIds);
      if (normalizedValue !== undefined) normalized[field] = normalizedValue;
    });

    const derivedSupport = deriveOpenCommitmentSupportFromNodeFields(normalized, nodeIds);
    const normalizedParticipants = normalizeCommitmentParticipantsForMerge([
      ...(Array.isArray(normalized.participants) ? normalized.participants : []),
      ...(Array.isArray(derivedSupport.participants) ? derivedSupport.participants : [])
    ]);
    const participantNodeIds = normalizedParticipants
      .map((participant) => String(participant?.nodeId || '').trim())
      .filter(Boolean);
    const mergedNodeIds = Array.from(new Set([
      ...((Array.isArray(normalized.nodeIds) ? normalized.nodeIds : []).map((nodeId) => String(nodeId || '').trim()).filter(Boolean)),
      ...((Array.isArray(derivedSupport.nodeIds) ? derivedSupport.nodeIds : []).map((nodeId) => String(nodeId || '').trim()).filter(Boolean)),
      ...participantNodeIds
    ]));
    if (mergedNodeIds.length > 0) normalized.nodeIds = mergedNodeIds;
    if (normalizedParticipants.length > 0) normalized.participants = normalizedParticipants;

    return normalized;
  };

  const projectLedgersFromCommitmentGraph = (value, nodeIds, stepIds) => {
    const entries = collectStructuredEntries(value);
    const entriesByKind = new Map();
    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const kind = normalizeCommitmentKind(
        entry.kind
        || entry.family
        || entry.commitmentKind
        || entry.ledgerKind
        || entry.type
      );
      if (!kind || !commitmentLedgerSpecByKind.has(kind)) return;
      if (!entriesByKind.has(kind)) entriesByKind.set(kind, []);
      entriesByKind.get(kind).push(entry);
    });

    const projected = {};
    commitmentLedgerSpecs.forEach(({ field, kind, normalize }) => {
      projected[field] = normalize(entriesByKind.get(kind) || [], nodeIds, stepIds);
    });
    return projected;
  };

  const buildCommitmentGraphFromNormalizedLedgers = (ledgersByField = {}) => {
    const graph = [];
    commitmentLedgerSpecs.forEach(({ field, kind, idField }) => {
      const entries = Array.isArray(ledgersByField?.[field]) ? ledgersByField[field] : [];
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const factId = normalizeOptionalStepText(entry[idField] || entry.id);
        const { kind: entryKind, ...rest } = entry;
        graph.push({
          ...rest,
          factId: factId || undefined,
          family: kind,
          ...(entryKind ? { kindValue: entryKind } : {}),
          kind
        });
      });
    });
    return graph;
  };

  const normalizeCommitmentGraph = (value, nodeIds, stepIds) => {
    const entries = collectStructuredEntries(value);
    return entries
      .map((entry) => normalizeOpenCommitmentGraphEntry(entry, nodeIds, stepIds))
      .filter(Boolean);
  };

  const ensureStructuredEntryIds = (entries, idField, prefix) => {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const usedIds = new Set(
      entries
        .map((entry) => normalizeOptionalStepText(entry?.[idField]))
        .filter(Boolean)
    );
    let counter = 1;

    const nextId = () => {
      let candidate = `${prefix}_${counter}`;
      while (usedIds.has(candidate)) {
        counter += 1;
        candidate = `${prefix}_${counter}`;
      }
      usedIds.add(candidate);
      counter += 1;
      return candidate;
    };

    return entries.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const existingId = normalizeOptionalStepText(entry[idField]);
      if (existingId) return entry;
      return {
        ...entry,
        [idField]: nextId()
      };
    });
  };

  return {
    normalizeChains,
    normalizeCommitmentGraph,
    normalizeCommitmentKind,
    normalizeOpenCommitmentGraphEntry,
    isProjectedCommitmentKind,
    projectLedgersFromCommitmentGraph,
    buildCommitmentGraphFromNormalizedLedgers,
    normalizeCaseAssignments,
    normalizeArgumentStructure,
    normalizePhaseLog,
    normalizeMorphologyRealization,
    normalizeFeatureLedger,
    normalizeSelectionLedger,
    normalizeBindingLedger,
    normalizeClausalDependencies,
    normalizeAgreementLedger,
    normalizePredicateClassLedger,
    normalizeProbeLedger,
    normalizeNullElementLedger,
    normalizeDiagnosticLedger,
    normalizeParameterLedger,
    normalizeInformationStructureLedger,
    normalizeOperatorScopeLedger,
    normalizeVoiceValencyLedger,
    normalizeLinearizationLedger,
    normalizeLocalityLedger,
    normalizePredicationLedger,
    normalizeParticleLedger,
    normalizeEvidentialityLedger,
    normalizeMirativityLedger,
    normalizeHonorificityLedger,
    normalizeSwitchReferenceLedger,
    normalizeLogophoraLedger,
    normalizeEventStructureLedger,
    ensureStructuredEntryIds
  };
};
