export interface CategoryShape {
  /** The first member's category; a compound head names several. */
  category: string;
  head: string;
  kind: 'head' | 'bar' | 'phrase';
  compound: boolean;
  /** Every member's head category in authored order: "v+T" and "T+v" each
   * bundle v and T, and a simple label has one member. */
  members: string[];
}

const withoutFeatures = (label: string): string => {
  const text = label.trim();
  let end = text.length;
  while (text[end - 1] === ']') {
    let depth = 1, start = end - 1;
    while (start > 0 && depth) {
      const character = text[--start];
      if (character === ']') depth++;
      if (character === '[') depth--;
    }
    // Leave malformed notation uninterpreted instead of manufacturing a head.
    if (depth) return text;
    end = start;
    while (end > 0 && /\s/u.test(text[end - 1])) end--;
  }
  return text.slice(0, end);
};

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
  // Each member of a compound head may carry its own features.
  const parts = spelling.split(/[+/]/u).map(part => {
    // A star marks a strong phase head (v*, v*P, v*′) and does not change the category.
    const match = /^([A-Za-z\p{Script=Greek}]+)(?:\*([A-Za-z\p{Script=Greek}]*))?(?:_[A-Za-z][A-Za-z0-9_-]*)?(⁰|°|\^?0|[′’'])?$/u.exec(withoutFeatures(part));
    if (!match) return;
    const category = match[1] + (match[2] ?? '');
    const kind = /[′’']/u.test(match[3] ?? '') ? 'bar' : category !== 'P' && /P$/u.test(category) ? 'phrase' : 'head';
    return { category, head: kind === 'phrase' ? category.slice(0, -1) : category, kind } as const;
  });
  if (parts.some(part => !part) || parts.length > 1 && parts.some(part => part?.kind !== 'head')
    || projection && parts.length !== 1) return;
  const first = parts[0]!;
  return { ...first, kind: projection ? 'bar' : first.kind, compound: parts.length > 1, members: parts.map(part => part!.head) };
};

/** Category identity for consumers that do not need its projection level. */
export const categoryLabel = (label?: string | null): string => readCategoryLabel(label)?.category
  ?? withoutFeatures(String(label || '')).replace(/[′’']/gu, '').trim();
