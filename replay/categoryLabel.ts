/** Read the category independently of trailing feature annotations; never rewrite the authored label. */
export const categoryLabel = (label?: string | null): string => String(label || '')
  .trim()
  .replace(/(?:\s*\[[^\[\]]*\])+$/u, '')
  .replace(/[′’']/gu, '')
  .trim();
