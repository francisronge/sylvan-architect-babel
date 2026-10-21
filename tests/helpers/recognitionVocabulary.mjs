/** Reads the name-keyed recognition vocabulary in replay/relations/ from source.
 *
 * Tier 2 recognises authored relation, role and value names through literal
 * word lists: synonym groups, Sets and arrays of names, regex alternatives and
 * equality checks against normalized names. The list is frozen, so
 * tests/recognitionVocabularyFrozen.test.mjs compares every entry found here
 * with tests/helpers/recognitionVocabulary.frozen.json.
 *
 * An entry is vocabulary-shaped text: lowercase or uncased letters, digits,
 * spaces and apostrophes, which is the form normalizeTier2Synonym produces.
 * Concept ids (`movement.source`), type tags (`fallback-mark`), field names
 * (`priorAnchors`) and primitive titles (`Movement curve`) are not entries.
 * Regex entries are the literal alternatives of each pattern. Equality checks
 * count when the literal has a space or the other side reads a name. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const VOCABULARY = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N} '’]*$/u;
const NAME_READER = /\bnormalizeTier2Synonym\(|\bfeatureParticipantName\(|\bnormalizeOutcomeLiteral\(|\.key\b|^(?:key|name|label|role|spelling|clause|noun|qualifier|property|relation)$/u;
const COMPARISON = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const NAME_TEST_METHODS = new Set(['startsWith', 'endsWith', 'includes', 'has', 'get']);

const isVocabulary = text => VOCABULARY.test(text) && /\p{L}{2}/u.test(text);

/** The literal alternatives of a regex body, without escapes, classes or group syntax. */
export const regexAlternatives = pattern => pattern
  .replace(/\\[pP]\{[^}]*\}/gu, '\u0000')
  .replace(/\\u\{[0-9a-fA-F]+\}|\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/gu, '\u0000')
  .replace(/\[(?:\\.|[^\]\\])*\]/gu, '\u0000')
  .replace(/\\./gu, '\u0000')
  .replace(/\(\?(?::|=|!|<=|<!|<[A-Za-z]\w*>)/gu, '\u0000')
  .replace(/\{\d+(?:,\d*)?\}/gu, '\u0000')
  .split(/[\u0000|()?*+^$.]/u)
  .map(fragment => fragment.trim())
  .filter(isVocabulary);

const stringText = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

/** Every vocabulary entry of one source file, with its kind and line. */
export const sourceVocabulary = (fileName, sourceText) => {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const entries = [];
  const add = (kind, text, node) => entries.push({
    kind, text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  });
  const visit = node => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const body = node.text.slice(1, node.text.lastIndexOf('/'));
      regexAlternatives(body).forEach(text => add('regex', text, node));
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(element => {
        const text = stringText(element);
        if (text !== undefined && isVocabulary(text)) add('list', text, element);
      });
    } else if (ts.isBinaryExpression(node) && COMPARISON.has(node.operatorToken.kind)) {
      [[node.left, node.right], [node.right, node.left]].forEach(([literal, other]) => {
        const text = stringText(literal);
        if (text !== undefined && isVocabulary(text) && (text.includes(' ') || NAME_READER.test(other.getText(source))))
          add('comparison', text, literal);
      });
    } else if (ts.isCaseClause(node)) {
      const text = stringText(node.expression);
      if (text !== undefined && isVocabulary(text) && text.includes(' ')) add('comparison', text, node.expression);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && NAME_TEST_METHODS.has(node.expression.name.text)) {
      const text = node.arguments[0] && stringText(node.arguments[0]);
      if (text !== undefined && isVocabulary(text) && text.includes(' ')) add('comparison', text, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return entries;
};

/** Entry counts by file, kind and text for every module in a directory. */
export const directoryVocabulary = directory => {
  const inventory = {};
  readdirSync(directory).filter(name => /\.(?:ts|js)$/u.test(name)).sort().forEach(name => {
    const counts = {};
    sourceVocabulary(name, readFileSync(path.join(directory, name), 'utf8')).forEach(({ kind, text }) => {
      const key = `${kind}: ${text}`;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    if (Object.keys(counts).length) inventory[name] = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a < b ? -1 : 1));
  });
  return inventory;
};

/** Entries whose count exceeds the frozen inventory. Removals are allowed. */
export const vocabularyGrowth = (frozen, current) => Object.entries(current).flatMap(([file, counts]) =>
  Object.entries(counts).flatMap(([entry, count]) => {
    const allowed = frozen[file]?.[entry] ?? 0;
    return count > allowed ? [{ file, entry, count, allowed }] : [];
  }));
