import {
  acceptedOutcomeConcept,
  authoredOutcomeLiterals,
  resolveOutcomeLiteral,
  type OutcomeConcept
} from './outcomeResolver.ts';
import type { ProductionRenderFamily } from './renderFamilies.ts';
import type { PlanRelationRef } from './renderPlan.ts';

export const scalarValue = (
  values: Record<string, string | string[]> | undefined,
  key: string,
  fallback = ''
): string => {
  if (key === 'outcome') {
    const items = authoredOutcomeLiterals(values);
    return items.length === 1 ? items[0] : fallback;
  }
  const value = values?.[key];
  return String(Array.isArray(value) ? value.length === 1 ? value[0] : fallback : value ?? fallback);
};

export const listValue = (
  values: Record<string, string | string[]> | undefined,
  key: string
): string[] => {
  const value = values?.[key];
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
};

/** Verbatim `values` rows in authored order. Literals are never parsed. */
export const verbatimRows = (
  values: Record<string, string | string[]> | undefined
): Array<{ label: string; value: string }> =>
  Object.entries(values || {}).flatMap(([label, value]) =>
    (Array.isArray(value) ? value : [value]).map((entryValue) => ({
      label,
      value: String(entryValue ?? '')
    })));

/** One vocabulary rule is one visual row, preserving both authored literals. */
const realizationRows = (
  values: Record<string, string | string[]> | undefined
): Array<{ label: string; value: string }> => {
  const rows = verbatimRows(values);
  const inputs = rows.filter((row) => row.label === 'input').map((row) => row.value);
  const outputs = rows.filter((row) => row.label === 'output').map((row) => row.value);
  return inputs.length === 1 && outputs.length === 1
    ? [{ label: inputs[0], value: outputs[0] }] : [];
};

export const nativeRealizationContent = (values: PlanRelationRef['values']) => {
  const rewriteRows = realizationRows(values);
  const literals = verbatimRows(values).filter((row) => !rewriteRows.length || !['input', 'output'].includes(row.label));
  return {
    rows: [...rewriteRows, ...literals],
    realizationRowKinds: [...rewriteRows.map(() => 'rewrite' as const), ...literals.map(() => 'literal' as const)]
  };
};

/**
 * Resolve an authored outcome through the shared literal catalog, then apply
 * the registered family's explicit concept-to-visual-state mapping. The
 * concept remains distinct in the resolver; only this family-specific policy
 * decides that, for example, both `blocked` and `failed` earn a blocked path.
 */
export const recognizedOutcome = <T extends string>(
  raw: string,
  family: ProductionRenderFamily,
  stateByConcept: Readonly<Partial<Record<OutcomeConcept, T>>>
): T | undefined => {
  const concept = acceptedOutcomeConcept(
    resolveOutcomeLiteral(raw),
    family.acceptedOutcomeConcepts
  );
  return concept ? stateByConcept[concept] : undefined;
};

export const LICENSED_OR_BLOCKED_OUTCOME_STATES = {
  licensed: 'licensed',
  successful: 'licensed',
  allowed: 'licensed',
  accepted: 'licensed',
  valid: 'licensed',
  blocked: 'blocked',
  failed: 'blocked',
  illicit: 'blocked',
  rejected: 'blocked',
  unlicensed: 'blocked',
  impossible: 'blocked',
  violation: 'blocked'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'licensed' | 'blocked'>>>;

export const LICENSED_OR_FAILED_OUTCOME_STATES = {
  licensed: 'licensed',
  successful: 'licensed',
  allowed: 'licensed',
  accepted: 'licensed',
  valid: 'licensed',
  blocked: 'failed',
  failed: 'failed',
  illicit: 'failed',
  rejected: 'failed',
  unlicensed: 'failed',
  impossible: 'failed',
  violation: 'failed'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'licensed' | 'failed'>>>;

export const BLOCKED_OUTCOME_STATES = {
  blocked: 'blocked',
  failed: 'blocked',
  illicit: 'blocked',
  rejected: 'blocked',
  unlicensed: 'blocked',
  impossible: 'blocked',
  violation: 'blocked'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'blocked'>>>;

export const ILLICIT_OUTCOME_STATES = {
  illicit: 'illicit'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'illicit'>>>;
