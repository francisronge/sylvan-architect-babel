import type { SyntaxNode } from '../types.ts';

const KNOWN_CATEGORY_LABELS = new Set([
  'A',
  "A'",
  'ADJ',
  'ADJP',
  'ADVP',
  'ASP',
  "ASP'",
  'ASPP',
  'C',
  "C'",
  'CP',
  'D',
  "D'",
  'DP',
  'I',
  "I'",
  'IP',
  'INFL',
  "INFL'",
  'INFLP',
  'N',
  "N'",
  'NEG',
  "NEG'",
  'NEGP',
  'NP',
  'P',
  "P'",
  'PP',
  'PRT',
  'PRTP',
  'T',
  "T'",
  'TP',
  'V',
  "V'",
  'VP'
]);

const normalizeCategoryToken = (token: string): string =>
  token
    .trim()
    .replace(/’/g, "'")
    .replace(/\s+/g, '')
    .toUpperCase();

const isLikelySyntacticCategory = (label: string): boolean => {
  const raw = label.trim();
  if (!raw) return false;
  const normalized = normalizeCategoryToken(raw);
  if (KNOWN_CATEGORY_LABELS.has(normalized)) return true;
  return /^[A-Z][A-Z0-9]*(?:P|')?$/.test(raw);
};

const sanitizeMilesToken = (token: string): string =>
  token
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')');

const serializeMilesNode = (node: SyntaxNode): string => {
  if (!node || typeof node !== 'object') return '';
  const label = String(node.label || '').trim();
  const word = String(node.word || '').trim();
  const children = Array.isArray(node.children)
    ? node.children.filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
    : [];

  if (children.length === 0) {
    const rawSurface = (word || label || '∅').trim();
    const token = sanitizeMilesToken(rawSurface || '∅');
    if (word) return token;
    if (label && isLikelySyntacticCategory(label)) {
      return `[${sanitizeMilesToken(label)} ${token === sanitizeMilesToken(label) ? '∅' : token}]`;
    }
    return token;
  }

  const serializedChildren = children
    .map((child) => serializeMilesNode(child))
    .filter((value) => value.length > 0);
  const nodeLabel = sanitizeMilesToken(label || word || 'X');
  if (serializedChildren.length === 0) return `[${nodeLabel}]`;
  return `[${nodeLabel} ${serializedChildren.join(' ')}]`;
};

export const buildMilesNotation = (forest: SyntaxNode[]): string => {
  return forest.map((root) => serializeMilesNode(root).trim()).filter(Boolean).join('\n');
};

