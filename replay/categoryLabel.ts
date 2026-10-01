export interface CategoryShape {
  category: string;
  head: string;
  kind: 'head' | 'bar' | 'phrase';
  compound: boolean;
}

const withoutFeatures = (label: string) => label.trim().replace(/(?:\s*\[[^\[\]]*\])+$/u, '').trim();

/** Read conventional category notation, keeping projection level separate from
 * explanatory annotations. The authored display label is never rewritten. */
export const readCategoryLabel = (label?: string | null): CategoryShape | undefined => {
  const raw = withoutFeatures(String(label || ''));
  // A comma followed by prose annotates the category, just like a colon.
  // A second category alone is ambiguous and remains uninterpreted.
  const annotated = raw.replace(/,\s*[A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)+$/u, '');
  const categoryText = withoutFeatures(annotated.split(':', 1)[0]);
  const projection = /\s+\([^)]*\bprojection\b[^)]*\)$/u.test(categoryText);
  const spelling = projection ? categoryText.replace(/\s+\([^)]*\)$/u, '')
    : categoryText.replace(/(?:\s*\([^()]+\))+$/u, '').trim();
  const parts = spelling.split('+').map(part => {
    const match = /^([A-Za-z][A-Za-z]*)(?:_[A-Za-z][A-Za-z0-9_-]*)?(⁰|°|\^?0|[′’'])?$/u.exec(part.trim());
    if (!match) return;
    const category = match[1];
    const kind = /[′’']/u.test(match[2] ?? '') ? 'bar' : category !== 'P' && /P$/u.test(category) ? 'phrase' : 'head';
    return { category, head: kind === 'phrase' ? category.slice(0, -1) : category, kind } as const;
  });
  if (parts.some(part => !part) || parts.length > 1 && parts.some(part => part?.kind !== 'head')
    || projection && parts.length !== 1) return;
  const first = parts[0]!;
  return { ...first, kind: projection ? 'bar' : first.kind, compound: parts.length > 1 };
};

/** Category identity for consumers that do not need its projection level. */
export const categoryLabel = (label?: string | null): string => readCategoryLabel(label)?.category
  ?? withoutFeatures(String(label || '')).replace(/[′’']/gu, '').trim();
