import type { DerivationOperation, DerivationStageRelation, ReplayDetailBlock } from '../types.ts';
import type { PlaybackStep, ReplaySupportLine } from './replayCompiler.ts';

/** Pure panel text and detail-block formatting; relation ownership stays in the compiler. */
export const formatOperationLabel = (operation?: DerivationOperation): string => {
  if (!operation) return 'Derivation';
  if (operation === 'Other') return 'Derivation';
  if (operation === 'LexicalSelect') return 'Select';
  if (operation === 'HeadMove') return 'Head Movement';
  if (operation === 'A-Move') return 'A-Movement';
  if (operation === 'AbarMove') return 'A-bar Move';
  if (operation === 'ExternalMerge') return 'External Merge';
  if (operation === 'InternalMerge') return 'Internal Merge';
  if (operation === 'StageRecord') return 'Stage Record';
  return String(operation);
};

export const formatPlaybackOperationTitle = (step?: PlaybackStep | null): string => {
  if (step?.replayKind === 'relation') return String(step.operation || '');
  const operation = formatOperationLabel(step?.operation);
  const target = String(step?.targetLabel || '').trim();
  return target && (step?.operation === 'LexicalSelect' || step?.operation === 'Project')
    ? `${operation} ${target}`
    : operation;
};

const toReplayTitleCase = (value?: string): string =>
  String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z]{2,}$/.test(word)) return word;
      const lower = word.toLowerCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(' ');

export const formatReplayBlockTitle = (title?: string): string => {
  return String(title ?? '');
};

export const formatReplayBlockLine = (
  _title: string,
  line: string,
  _steps: PlaybackStep[] = []
): string => {
  return String(line ?? '');
};

const normalizeReplayBlockTitleKey = (title?: string): string =>
  String(title || '').trim().toUpperCase();

export const normalizeReplayTargetLabel = (label?: string): string =>
  String(label || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

export const isGenericReplayStructuralLabel = (label?: string): boolean => {
  const normalized = normalizeReplayTargetLabel(label);
  if (!normalized) return true;
  return new Set([
    'WORKSPACE',
    'CP',
    'C',
    'TP',
    'T',
    "T'",
    'TBAR',
    'VP',
    'V',
    "V'",
    'VBAR',
    'DP',
    'D',
    "D'",
    'DBAR',
    'NP',
    'N',
    "N'",
    'NBAR',
    'PP',
    'P',
    "P'",
    'PBAR',
    'IP',
    'FP',
    'XP'
  ]).has(normalized);
};

export const formatReplaySupportValue = (value?: string): string =>
  String(value ?? '').trim();

export const formatReplayLabelSeries = (labels: string[]): string => {
  const cleaned = labels.map((label) => String(label || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
};

export const mergeReplayDetailBlocks = (
  ...sources: Array<ReplayDetailBlock[] | undefined>
): ReplayDetailBlock[] | undefined => {
  const mergedByTitle = new Map<string, ReplayDetailBlock>();
  sources
    .flat()
    .filter((block): block is ReplayDetailBlock => Boolean(block && typeof block === 'object'))
    .forEach((block) => {
      const title = String(block.title || '').trim();
      if (!title) return;
      const normalizedTitle = normalizeReplayBlockTitleKey(title);
      const lines = (Array.isArray(block.lines) ? block.lines : [])
        .map((line) => String(line || '').trim())
        .filter(Boolean);
      if (lines.length === 0) return;
      const existing = mergedByTitle.get(normalizedTitle);
      if (!existing) {
        mergedByTitle.set(normalizedTitle, {
          title,
          lines: Array.from(new Set(lines))
        });
        return;
      }
      existing.lines = Array.from(new Set([...(existing.lines || []), ...lines]));
    });
  const merged = Array.from(mergedByTitle.values());
  return merged.length > 0 ? merged : undefined;
};

export const formatReplayInputsValue = (labels?: string[]): string =>
  (Array.isArray(labels) ? labels : [])
    .map((label) => formatReplaySupportValue(label))
    .filter(Boolean)
    .join(' + ');

export const formatRelationAnchorRole = (role: string): string =>
  toReplayTitleCase(
    String(role || '')
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
  );

export const buildLiteralRelationValueLines = (
  values: DerivationStageRelation['values']
): ReplaySupportLine[] => Object.entries(values ?? {}).flatMap(([label, value]) => (
  Array.isArray(value)
    ? (value.length ? value.map(item => ({ label, value: item })) : [{ label, value: '[]', emptyList: true as const }])
    : [{ label, value }]
));

export const buildReplayDisplayDetailBlocks = (
  steps: PlaybackStep[]
): Map<number, ReplayDetailBlock[]> => {
  const byStep = new Map<number, ReplayDetailBlock[]>();
  const pushBlockLine = (stepIndex: number, title: string, line: string) => {
    if (!line) return;
    const bucket = byStep.get(stepIndex) || [];
    const normalizedTitle = normalizeReplayBlockTitleKey(title);
    const existing = bucket.find((block) => normalizeReplayBlockTitleKey(block.title) === normalizedTitle);
    if (existing) {
      existing.lines.push(line);
    } else {
      bucket.push({ title, lines: [line] });
    }
    byStep.set(stepIndex, bucket);
  };

  // Detail blocks come from the Stage Record and the authored relations of
  // their own step. Nothing here reads prose to move a line elsewhere.
  steps.forEach((step, sourceIndex) => {
    const blocks = Array.isArray(step.detailBlocks) ? step.detailBlocks : [];
    blocks.forEach((block) => {
      const title = String(block?.title || '').trim();
      const lines = Array.isArray(block?.lines) ? block.lines.filter(Boolean) : [];
      if (!title || lines.length === 0) return;
      lines.forEach((line) => pushBlockLine(sourceIndex, title, line));
    });
  });

  return byStep;
};
