import { useCallback, useEffect, useMemo, useState } from 'react';
import { GENERATION_MODEL_IDS, getGenerationModel } from '../server/babelParser/researchModelCatalog.js';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

/** The value when the route's first control offers it, otherwise that control's qualification default. */
const coerceReasoningEffortForRoute = (route: string, value?: string): ReasoningEffort => {
  const control = getGenerationModel(route)!.controls[0];
  return (control.values.includes(value || '') ? value : control.qualificationDefault) as ReasoningEffort;
};

/**
 * The research model and effort the next generation request names. A route
 * outside `modelIds` becomes the first offered route, and an effort the route's
 * control does not offer becomes that control's default.
 */
export function useModelSelection(modelIds: readonly string[] = GENERATION_MODEL_IDS) {
  const options = useMemo(() => modelIds.map(id => getGenerationModel(id)!), [modelIds]);
  const defaultModelId = modelIds[0];
  const coerceModelRoute = useCallback((value?: string): string =>
    modelIds.includes(value || '') ? value! : defaultModelId, [modelIds, defaultModelId]);
  const inferModelRoute = useCallback((modelUsed?: string): string =>
    options.find(model => model.providerModel === modelUsed)?.id || defaultModelId, [options, defaultModelId]);
  const [modelRoute, setModelRoute] = useState<string>(defaultModelId);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('high');

  useEffect(() => {
    setReasoningEffort((current) => coerceReasoningEffortForRoute(modelRoute, current));
  }, [modelRoute]);

  /** Take the route and effort of an accepted analysis, coerced to what is offered. */
  const adoptModel = useCallback((route: string | undefined, effort: string | undefined) => {
    const nextRoute = coerceModelRoute(route);
    setModelRoute(nextRoute);
    setReasoningEffort(coerceReasoningEffortForRoute(nextRoute, effort));
  }, [coerceModelRoute]);
  const adoptEffort = useCallback((effort: string | undefined) => {
    setReasoningEffort(coerceReasoningEffortForRoute(modelRoute, effort));
  }, [modelRoute]);
  /** A route chosen in the menu starts at High effort. */
  const selectModel = useCallback((route: string) => {
    setModelRoute(route);
    setReasoningEffort('high');
  }, []);

  const selectedModel = getGenerationModel(modelRoute)!;
  const effortControl = selectedModel.controls[0];
  const activeReasoningEffort = coerceReasoningEffortForRoute(modelRoute, reasoningEffort);
  return {
    options,
    modelRoute,
    selectedModel,
    reasoningEffort,
    activeReasoningEffort,
    effortControl,
    /** The `settings` of the generation request. */
    requestSettings: { [effortControl.id]: activeReasoningEffort },
    inferModelRoute,
    adoptModel,
    adoptEffort,
    selectModel,
    setReasoningEffort
  };
}

export type ModelSelection = ReturnType<typeof useModelSelection>;
