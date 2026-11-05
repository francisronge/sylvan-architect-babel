import type { GenerationError } from '../../services/generationState';

/**
 * Which failure screen a failed parse shows, and what it says. Public Babel's
 * failure screens (Francis, 5 Nov 2026: "let's tell the users what the problem
 * could have been, maybe if they got unlucky"; "They should be able to retry")
 * are one layout with a tree in a different state for each kind of failure:
 *
 * - broken: the model wrote an analysis Babel cannot use. Another try usually
 *   works, so it offers one.
 * - noAnswer: no answer came back (timeout, busy, dropped connection). It
 *   offers another try too.
 * - visitorLimit / siteLimit: today's parses are used up, for this visitor or
 *   for everyone. Trying again cannot work until tomorrow, so it offers the
 *   Tree Bank instead.
 * - sentence: Babel would not send the sentence. It offers editing it.
 *
 * It reads only Babel's own error code and failure class, which production
 * error bodies keep; it never shows provider text.
 */
export type FailureKind = 'broken' | 'noAnswer' | 'visitorLimit' | 'siteLimit' | 'sentence';
export type FailureAction = 'retry' | 'edit' | 'treeBank';

export interface FailureCopy {
  kind: FailureKind;
  headline: string;
  explanation: string;
  actions: readonly FailureAction[];
}

const LUCK = "That's the luck of the draw: the same sentence usually works on another try.";
const BROKEN_CODES = new Set(['BAD_MODEL_RESPONSE', 'INCOMPLETE_GENERATION', 'PARSE_FAILED', 'INSPECTION_LIMIT']);
const MODEL_OUTPUT_CLASSES = new Set([
  'transport_serialization', 'incomplete_generation', 'contract_misunderstanding', 'linguistic_failure', 'deterministic_engine_failure'
]);

const brokenExplanation = (error: GenerationError) => {
  const ruleId = error.failure?.ruleId ?? '';
  const failureClass = error.failure?.class;
  // Public Babel's route fails a tree whose words are the sentence's in another
  // order (SPELLOUT_WORD_ORDER); a mismatch beyond that leaves out or adds a word.
  if (ruleId === 'SPELLOUT_WORD_ORDER') return `The model's tree puts some of your sentence's words in the wrong order. ${LUCK}`;
  if (ruleId === 'SPELLOUT_MISMATCH') return `The model's tree leaves out a word of your sentence, or adds one. ${LUCK}`;
  if (error.code === 'INCOMPLETE_GENERATION' || failureClass === 'incomplete_generation' || failureClass === 'transport_serialization') {
    return `The model stopped before its analysis was finished. ${LUCK}`;
  }
  return `The pieces of the model's analysis don't fit together. ${LUCK}`;
};

const sentenceExplanation = (error: GenerationError) => {
  const ruleId = error.failure?.ruleId;
  if (ruleId === 'REQUEST_SENTENCE_LENGTH') return "It's longer than 600 characters. Shorten it and try again.";
  if (ruleId === 'REQUEST_SENTENCE_REQUIRED') return 'Type a sentence first.';
  return 'Check the sentence and try again.';
};

export const describeFailure = (error: GenerationError): FailureCopy => {
  const code = error.code ?? '';
  if (code === 'RATE_LIMITED_DAILY') {
    return { kind: 'visitorLimit', headline: "That's all your trees for today.",
      explanation: "They're saved in your Tree Bank. You can grow more tomorrow.", actions: ['treeBank'] };
  }
  if (code === 'DAILY_CAPACITY_REACHED' || code === 'PROVIDER_QUOTA') {
    return { kind: 'siteLimit', headline: 'Babel has grown all its trees for today.',
      explanation: 'It makes a set number each day. Come back tomorrow; your Tree Bank is still here.', actions: ['treeBank'] };
  }
  // Babel's own check of the request names a REQUEST_ rule; a provider refusing
  // Babel's request is not the visitor's sentence, so it reads as no answer.
  if (code === 'INVALID_REQUEST' && error.failure?.ruleId?.startsWith('REQUEST_')) {
    return { kind: 'sentence', headline: "Babel couldn't send this sentence.", explanation: sentenceExplanation(error), actions: ['edit'] };
  }
  if (code !== 'INVALID_REQUEST' && (BROKEN_CODES.has(code) || (error.failure && MODEL_OUTPUT_CLASSES.has(error.failure.class)))) {
    return { kind: 'broken', headline: 'This tree came out broken.', explanation: brokenExplanation(error), actions: ['retry', 'edit'] };
  }
  if (code === 'PROVIDER_TIMEOUT' || code === 'PROVIDER_DEADLINE_EXCEEDED') {
    return { kind: 'noAnswer', headline: 'No answer came back.',
      explanation: 'The model took too long this time. Try again; most sentences finish in a few minutes.', actions: ['retry', 'edit'] };
  }
  return { kind: 'noAnswer', headline: 'No answer came back.',
    explanation: 'The model may be busy, or the connection dropped. Wait a minute and try again.', actions: ['retry', 'edit'] };
};

export const FAILURE_ACTION_LABELS: Record<FailureAction, string> = {
  retry: 'Try again',
  edit: 'Edit sentence',
  treeBank: 'Open Tree Bank'
};
