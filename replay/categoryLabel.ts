export interface CategoryShape {
  /** The first member's category; a compound head names several. */
  category: string;
  head: string;
  kind: 'head' | 'bar' | 'phrase';
  compound: boolean;
  /** Every member's head category in authored order: "v+T" and "T+v" each
   * bundle v and T, and a simple label has one member. */
  members: string[];
  /** Set only when the label names no syntactic category (see the notes
   * above `readLabellingNotation`): 'shared-feature' for ⟨φ,φ⟩, 'unlabelled'
   * for {T, vP} or α, and 'root' for √EAT, √P or a complex led by a root.
   * Shared-feature and unlabelled readings have an empty `head` and no
   * members, so they never match a category or a compound head. */
  labelling?: 'shared-feature' | 'unlabelled' | 'root';
}

// A feature bundle closes a label in brackets (T[uφ:_]) or braces (T{uφ},
// as in Chomsky 2000, 2001 and Adger 2003). A braced group with nothing
// before it is set notation ({T, vP}), not features.
const FEATURE_CLOSERS: Record<string, string> = { ']': '[', '}': '{' };

const withoutFeatures = (label: string): string => {
  const text = label.trim();
  let end = text.length;
  while (FEATURE_CLOSERS[text[end - 1]]) {
    const close = text[end - 1], open = FEATURE_CLOSERS[close];
    let depth = 1, start = end - 1;
    while (start > 0 && depth) {
      const character = text[--start];
      if (character === close) depth++;
      if (character === open) depth--;
    }
    // Leave malformed notation uninterpreted instead of manufacturing a head.
    if (depth) return text;
    if (open === '{' && !text.slice(0, start).trim()) break;
    end = start;
    while (end > 0 && /\s/u.test(text[end - 1])) end--;
  }
  return text.slice(0, end);
};

/* Labels that name no syntactic category.
 *
 * Shared-feature labels. Under the labeling algorithm (Chomsky 2013 "Problems
 * of Projection", 2015 "Problems of Projection: Extensions"), {XP, YP} has no
 * head for minimal search to find. It is labelled by the most prominent feature
 * its two members share: ⟨φ,φ⟩ for a subject agreeing with T, ⟨Q,Q⟩ for a wh-phrase
 * in an interrogative C's edge. The label is that feature pair, not a category
 * of either member, so the set reads as phrasal with no head category and
 * neither member projects. A pair of different features is not this notation.
 *
 * Unlabelled objects. Merge(α, β) = {α, β} carries no label (Chomsky 2013), so
 * set notation lists members without naming a label, and α, β, γ, δ stand for
 * syntactic objects whose label is not (yet) determined. Babel does not run
 * the labeling algorithm for the author, so {T, vP}, {DP, vP} and α read as
 * unlabelled. Only sets need labelling (a lexical item is its own label), so
 * these read as phrasal. Two cases stay uninterpreted. A set of heads ({v, V})
 * may be a complex head formed by head adjunction (Chomsky 1995 §4.7), so the
 * tree's structure decides. Chomsky's 1995 labelled set {T, {T, vP}}, whose first
 * member is the label, is not an unlabelled set.
 *
 * Roots. In Distributed Morphology a root (√EAT, or a bare √ over its word)
 * is acategorial and gets a category only by merging with n, v or a (Marantz
 * 1997; Embick & Marantz 2008, the Categorization Assumption). A root is a
 * terminal, so it reads as a minimal object whose category is the root type
 * √ rather than any syntactic category; the root's name is an identity index,
 * like V_give. A root that takes a complement projects √P (Harley 2014 "On
 * the identity of roots"). */
const SHARED_FEATURE = /^(?:⟨([^⟨⟩,]+),([^⟨⟩,]+)⟩|<([^<>,]+),([^<>,]+)>|〈([^〈〉,]+),([^〈〉,]+)〉)$/u;
const FEATURE_NAME = /^[A-Za-z\p{Script=Greek}][\p{L}\p{N}]*$/u;
const PLACEHOLDER = /^[αβγδ]$/u;
const ROOT = /^√(?:(P)|[\p{L}\p{N}_-]*)(⁰|°|\^?0|[′’'])?$/u;
const OPENERS: Record<string, string> = { '{': '}', '[': ']', '(': ')', '⟨': '⟩', '〈': '〉', '<': '>' };

// The two members of {α, β}, split at the one top-level comma; undefined unless
// the braces enclose the whole text.
const setMembers = (text: string): string[] | undefined => {
  if (!text.startsWith('{') || !text.endsWith('}')) return;
  const members: string[] = [], closers: string[] = [];
  let from = 1;
  for (let index = 1; index < text.length - 1; index++) {
    const character = text[index];
    if (OPENERS[character]) closers.push(OPENERS[character]);
    else if (character === closers.at(-1)) closers.pop();
    else if (Object.values(OPENERS).includes(character) && !closers.length) return;
    else if (character === ',' && !closers.length) { members.push(text.slice(from, index).trim()); from = index + 1; }
  }
  members.push(text.slice(from, -1).trim());
  return closers.length || members.length !== 2 || members.some(member => !member) ? undefined : members;
};

const unlabelled = (category: string, labelling: 'shared-feature' | 'unlabelled'): CategoryShape =>
  ({ category, head: '', kind: 'phrase', compound: false, members: [], labelling });

/** Shared-feature, set and placeholder labels; undefined for anything else. */
const readLabellingNotation = (text: string): CategoryShape | undefined => {
  const pair = SHARED_FEATURE.exec(text)?.slice(1).filter(Boolean).map(feature => feature.trim());
  if (pair) return pair[0] === pair[1] && FEATURE_NAME.test(pair[0]) ? unlabelled(text, 'shared-feature') : undefined;
  if (PLACEHOLDER.test(text)) return unlabelled(text, 'unlabelled');
  const members = setMembers(text);
  if (!members) return;
  const shapes = members.map(member => readCategoryLabel(member));
  if (shapes.some(shape => !shape) || shapes.every(shape => shape!.kind === 'head')) return;
  const label = shapes[0]!;
  if (label.kind === 'head' && setMembers(members[1]) && setMembers(members[1])!
    .some(member => readCategoryLabel(member)?.members.some(head => label.members.includes(head)))) return;
  return unlabelled(text, 'unlabelled');
};

/** Read conventional category notation, keeping projection level separate from
 * explanatory annotations. The authored display label is never rewritten. */
export const readCategoryLabel = (label?: string | null): CategoryShape | undefined => {
  const raw = withoutFeatures(String(label || ''));
  if (raw.startsWith('{') || SHARED_FEATURE.test(raw)) return readLabellingNotation(raw);
  // A comma followed by prose annotates the category, just like a colon.
  // A second category alone is ambiguous and remains uninterpreted.
  const annotated = raw.replace(/,\s*[A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)+$/u, '');
  const categoryText = withoutFeatures(annotated.split(':', 1)[0]);
  const projection = /\s+\([^)]*\bprojection\b[^)]*\)$/u.test(categoryText);
  const spelling = projection ? categoryText.replace(/\s+\([^)]*\)$/u, '')
    : categoryText.replace(/(?:\s*\([^()]+\))+$/u, '').trim();
  if (!projection && (PLACEHOLDER.test(spelling) || SHARED_FEATURE.test(spelling))) return readLabellingNotation(spelling);
  // Each member of a compound head may carry its own features.
  const parts = spelling.split(/[+/]/u).map(part => {
    const text = withoutFeatures(part);
    const root = ROOT.exec(text);
    if (root) {
      const kind = /[′’']/u.test(root[2] ?? '') ? 'bar' : root[1] ? 'phrase' : 'head';
      return { category: root[1] ? '√P' : '√', head: '√', kind, labelling: 'root' } as const;
    }
    // A star marks a strong phase head (v*, v*P, v*′) and does not change the category.
    const match = /^([A-Za-z\p{Script=Greek}]+)(?:\*([A-Za-z\p{Script=Greek}]*))?(?:_[A-Za-z][A-Za-z0-9_-]*)?(⁰|°|\^?0|[′’'])?$/u.exec(text);
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
