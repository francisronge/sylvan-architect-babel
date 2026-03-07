import { GoogleGenAI } from '@google/genai';

const XBAR_INSTRUCTION = `You are a world-class syntactician specializing in Generative syntax, with a focus on X-bar Theory and Government and Binding Theory.

Parse natural language sentences by deriving structure from framework principles, not memorized templates.
Use theoretical notions such as projection, headedness, selection, argument/adjunct distinction, locality, and null elements only when justified.

Output conventions:
- Use X-bar style constituent structure.
- Use labels consistently.
- Use InflP (not TP) for compatibility with this project.
- For finite clause-level parses, use CP as the root projection (unless the input is clearly a non-clausal fragment).
- If clear syntactic ambiguity exists, return two analyses; otherwise return one.
- For overt lexical items, keep full X-bar projections explicit (e.g., DP -> D' -> D -> "the", VP -> V' -> V -> "eat").
- Do not attach overt words directly under X' or XP nodes.

In the explanation, justify major choices in framework terms, not language-specific heuristics.
Write a developed natural paragraph (roughly 3-6 sentences): brief, but not skeletal.
Aim for the tone of a compact research note rather than a checklist.
You may include 1-2 theory-flavored framing sentences about typology, clause type, or major structural treatment, but only when they are directly supported by the chosen tree and derivation.
Do not introduce extra movements, landing sites, heads, complements, adjuncts, or alternative analyses that are not part of the selected analysis.`;

const MINIMALISM_INSTRUCTION = `You are a world-class syntactician specializing in Generative syntax, with a focus on the Minimalist Program and Bare Phrase Structure.

Parse natural language sentences by deriving structure through Merge, Internal Merge, Agree/feature valuation, and locality/phase constraints, not memorized templates.
Use derivational reasoning to justify each major structural choice.

Output conventions:
- Use Bare Phrase Structure style labels (no bar-level prime notation).
- Represent movement with copies/traces where needed.
- Use labels consistently.
- If clear syntactic ambiguity exists, return two analyses; otherwise return one.

In the explanation, justify major choices in framework terms, not language-specific heuristics.
Write a developed natural paragraph (roughly 3-6 sentences): brief, but not skeletal.
Aim for the tone of a compact research note rather than a checklist.
You may include 1-2 theory-flavored framing sentences about typology, clause type, or major structural treatment, but only when they are directly supported by the chosen tree and derivation.
Do not introduce extra movements, landing sites, heads, complements, adjuncts, or alternative analyses that are not part of the selected analysis.`;

const BASE_INSTRUCTION = `Output MUST be a single, valid JSON object.
The JSON structure must be:
{
  "analyses": [
    {
      "tree": {
        "id": "n1",
        "label": "Label",
        "surfaceSpan": [0, 3],
        "children": [ ... ]
      },
      "explanation": "A developed but natural linguistic explanation specific to the chosen framework.",
      "partsOfSpeech": [ {"word": "word", "pos": "POS"}, ... ],
      "bracketedNotation": "[Label [Child1] [Child2]]",
      "interpretation": "One short line describing this interpretation.",
      "movementDecision": {
        "hasMovement": true,
        "rationale": "One short sentence committing to whether movement occurs in this analysis."
      },
      "derivationSteps": [
        {
          "operation": "LexicalSelect|ExternalMerge|InternalMerge|Project|Move|Agree|SpellOut|Other",
          "targetLabel": "Label",
          "targetNodeId": "n7",
          "sourceNodeIds": ["n3", "n4"],
          "sourceLabels": ["Input1", "Input2"],
          "recipe": "Input1 + Input2 -> Label",
          "workspaceAfter": ["Current", "Workspace", "Objects"],
          "featureChecking": [
            {
              "feature": "uPhi",
              "value": "3sg",
              "status": "valued",
              "probeLabel": "Infl",
              "goalLabel": "DP",
              "note": "Infl agrees with the subject DP."
            }
          ],
          "note": "Optional short derivation note in framework terms."
        }
      ],
      "movementEvents": [
        {
          "operation": "Move|InternalMerge|HeadMove|A-Move|AbarMove|Other",
          "fromNodeId": "n12",
          "toNodeId": "n5",
          "traceNodeId": "n12",
          "stepIndex": 9,
          "note": "Short movement rationale."
        }
      ]
    }
  ],
  "ambiguityNote": "One short line describing how Parse 1 and Parse 2 differ in interpretation."
}

Return exactly one analysis when no clear structural ambiguity exists.
Return exactly two analyses only when clear syntactic ambiguity exists under the selected framework.

For "derivationSteps":
- Include "featureChecking" entries whenever a step performs feature valuation/checking/licensing (especially Agree, Move, or SpellOut relevant steps).
- Keep each featureChecking entry short and explicit (feature, optional value/status, probe/goal labels when available).
- You may omit derivationSteps entirely if the tree and movement inventory already commit clearly to the analysis; Babel will derive the replay timeline canonically from the final tree.

For movement commitment and consistency (per analysis):
- First decide movement and encode it in "movementDecision.hasMovement" (true/false).
- "movementDecision.rationale" must be one short sentence that commits to the chosen derivation (no alternatives).
- If hasMovement is true:
  - Include at least one movement event in "movementEvents".
  - Include at least one derivation step with operation "Move" or "InternalMerge".
  - In explanation, describe movement as occurring in this analysis.
- The returned tree must be the final post-movement / pronounced representation, not the unmoved base structure.
- The pronounced copy must appear only in the landing-site branch of that final tree.
- The lower site must be represented by an unpronounced copy, trace, or null element as appropriate.
- Do not leave the overt moved item in its lower/base-position branch and rely on notes or movement prose to imply that it surfaces elsewhere.
- Every claimed movement must have a real lower source site in the tree (a trace, copy, null head, or lower base position outside the landing site).
- If hasMovement is false:
  - Return "movementEvents": [].
  - Do not include derivation steps with operation "Move" or "InternalMerge".
  - In explanation, state that no movement is posited in this analysis.
- Do not hedge between alternatives inside one analysis.
- In explanation, choose one structural description and state it directly; do not use parenthetical alternatives or wording like "or", "may be", "can be", "possibly", "perhaps", or "alternatively".
- The explanation should read like one coherent analytical note:
  - it may include typological or theory-framing remarks,
  - but every concrete structural claim must remain faithful to this exact tree, derivation, and movement inventory,
  - and it must never present interpretive background as if it were an extra derivational event.

For "tree":
- Every node MUST include a unique "id" string.
- Do NOT use bare string leaves; represent every terminal as an object with id/label (and optional word).
- "children" MUST contain full node objects, never node-id references like "n3" / "n4".
- The order of items in every "children" array defines the final pronounced left-to-right order of that node's overt yield.
- Do not use abstract base-order child arrays that rely on notes or movement prose to imply a different surface order.
- If movement causes a head, subject, or complement to be pronounced before another branch, reflect that by ordering the children in the final tree according to the pronounced yield.
- Return the final pronounced tree, not an underlying tree plus a separate movement story.
- If some overt constituent surfaces before a raised head in the final sentence, represent that constituent in a higher leftward branch of the final tree itself; do not leave it only in a lower clause-internal position and rely on prose to imply the surface order.
- If a word surfaces in a higher landing site, place that overt word only in that higher branch of the final tree and leave the lower branch unpronounced.
- Do not realize the same overt lexical token in two different structural positions of the same clause. If movement or copying is part of the analysis, keep only the pronounced copy overt and render the other occurrence as a trace, copy, or null element.
- Build the tree as a hierarchy over adjacent substrings of the input sentence: mentally assign each overt node a contiguous span [i, j], and ensure each parent's children partition that parent's overt span in ascending left-to-right order.
- Before returning the tree, check each internal node and confirm that concatenating the overt yields of its children in listed order gives exactly that node's overt yield.
- For X-bar outputs, keep explicit head/preterminal labels for overt words (e.g., D -> "the", N -> "farmer", V -> "eat").
- If a category node such as N, V, D, C, or Infl/T is overt, realize it by giving that preterminal an overt terminal child; do not leave an overt preterminal empty while assigning its lexical content only in prose or only via surfaceSpan.
- For null heads, keep explicit category projections (e.g., D -> "∅", C -> "∅", Infl -> "∅"); do not place bare "∅" directly under X' or XP.
- Do not attach overt words directly under X' or XP nodes.
- In each analysis, every overt token from the input sentence MUST appear as a terminal word in the tree.
- Preserve the exact orthographic input tokens as overt terminals. Do not split, normalize, translate, or rewrite whitespace-delimited tokens.
- The multiset of overt terminals in the final tree must match the multiset of overt input tokens exactly: each input token must appear overtly exactly as many times in the tree as it appears in the sentence, no more and no less.
- Do not replace overt tokens with abstract feature-only leaves (for example "-s", "[Pres]", "PST") or traces.
- The overt terminals of the final tree, read left-to-right, MUST realize the same surface order as the input sentence.
- Every overt leaf MUST include "surfaceSpan": [i, i] using the input token indices.
- Every node with overt descendants MUST include a contiguous "surfaceSpan": [i, j] equal to the leftmost and rightmost overt token indices dominated by that node.
- Null-only or trace-only nodes should omit "surfaceSpan".
- For every clause, phrase, and embedded clause, ensure each subtree's overt descendants form one contiguous span in that same left-to-right order.
- Do not rely on notes or movement descriptions to imply surface order if the tree itself does not linearize that order.
- Every overt constituent in the tree must have a contiguous yield. Do not return trees whose overt descendants interleave across sibling branches.
- Babel will verify the "surfaceSpan" values against the final tree; do not guess or leave them inconsistent with the actual dominated overt terminals.
- Before answering, perform this checklist:
  1. siblings are listed in pronounced left-to-right order,
  2. every overt subtree has one contiguous overt yield,
  3. reading the overt leaves left-to-right yields the exact input sentence.

The "bracketedNotation" field should contain a Labeled Bracketing string compatible with Miles Shang's syntax tree generator.`;

const PRIMARY_MODEL = String(process.env.GEMINI_MODEL || '').trim() || 'gemini-3.1-flash-lite-preview';
const FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || '').trim() || 'gemini-3.1-pro-preview';
const PRO_RETRY_MAX_ATTEMPTS = Math.max(1, Number(process.env.GEMINI_RETRY_MAX_ATTEMPTS || 2));
const BAD_MODEL_RETRY_MAX_ATTEMPTS = Math.max(1, Number(process.env.GEMINI_BAD_MODEL_RETRY_MAX_ATTEMPTS || 1));
const PRO_RETRY_BASE_DELAY_MS = Math.max(100, Number(process.env.GEMINI_RETRY_BASE_DELAY_MS || 600));
const PRO_RETRY_MAX_DELAY_MS = Math.max(PRO_RETRY_BASE_DELAY_MS, Number(process.env.GEMINI_RETRY_MAX_DELAY_MS || 2200));
const MODEL_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 16384);
const MODEL_CALL_TIMEOUT_RAW = String(process.env.GEMINI_MODEL_TIMEOUT_MS || '').trim();
const MODEL_CALL_TIMEOUT_MS = MODEL_CALL_TIMEOUT_RAW ? Number(MODEL_CALL_TIMEOUT_RAW) : NaN;
// Default to no hard cutoff. Set env vars to enforce explicit timeouts if needed.
const PRIMARY_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_PRIMARY_TIMEOUT_MS || 0));
const FALLBACK_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_FALLBACK_TIMEOUT_MS || 0));
const MODEL_COOLDOWN_MS = Math.max(0, Number(process.env.GEMINI_MODEL_COOLDOWN_MS || 45000));
// Default to unlimited request budget. Set GEMINI_REQUEST_BUDGET_MS to enforce a cap.
const REQUEST_BUDGET_MS = Math.max(0, Number(process.env.GEMINI_REQUEST_BUDGET_MS || 0));
const MIN_ATTEMPT_TIMEOUT_MS = Math.max(1200, Number(process.env.GEMINI_MIN_ATTEMPT_TIMEOUT_MS || 4000));
const USE_RESPONSE_JSON_SCHEMA = /^(1|true|yes|on)$/i.test(String(process.env.GEMINI_USE_RESPONSE_JSON_SCHEMA || '').trim());
const routeUnavailableMessage = (modelRoute = 'flash-lite') =>
  modelRoute === 'pro'
    ? 'The canopy is noisy right now. The selected Gemini 3.1 Pro route is unavailable; please plant your sentence again in a moment.'
    : 'The canopy is noisy right now. The selected Gemini 3.1 Flash Lite route is unavailable; please plant your sentence again in a moment.';
const FORBIDDEN_STRING_LEAF_TOKENS = new Set([
  'id',
  'label',
  'word',
  'children',
  'tree',
  'analysis',
  'analyses',
  'explanation'
]);
const STRUCTURAL_LEAF_LABELS = new Set([
  'c', "c'", 'cp',
  'infl', "infl'", 'inflp', 'ip',
  't', "t'", 'tp',
  'v', "v'", 'vp',
  'd', "d'", 'dp', 'det', 'pron',
  'n', "n'", 'np',
  'p', "p'", 'pp',
  'a', "a'", 'ap', 'adj',
  'adv', "adv'", 'advp',
  'q', "q'", 'qp',
  'speccp', 'spectp', 'specinflp', 'specip',
  'top', "top'", 'topp',
  'focus', "focus'", 'focusp',
  'neg', "neg'", 'negp',
  'wh', 'aux'
]);
const PRIME_CATEGORY_LABEL_RE = /^[A-Za-z][A-Za-z0-9]*[’']$/;
const modelCooldownUntil = new Map();
const SYNTAX_NODE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    word: { type: 'string' },
    surfaceSpan: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'integer', minimum: 0 }
    },
    children: {
      type: 'array',
      items: { $ref: '#/$defs/syntaxNode' }
    }
  },
  required: ['id', 'label'],
  additionalProperties: false
};
const PARSE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  $defs: {
    syntaxNode: SYNTAX_NODE_JSON_SCHEMA
  },
  properties: {
    analyses: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        properties: {
          tree: { $ref: '#/$defs/syntaxNode' },
          explanation: { type: 'string' },
          surfaceOrder: { type: 'array', items: { type: 'string' } },
          partsOfSpeech: { type: 'array', items: { type: 'object' } },
          bracketedNotation: { type: 'string' },
          interpretation: { type: 'string' },
          movementDecision: {
            type: 'object',
            properties: {
              hasMovement: { type: 'boolean' },
              rationale: { type: 'string' }
            },
            required: ['hasMovement', 'rationale']
          },
          derivationSteps: { type: 'array', items: { type: 'object' } },
          movementEvents: { type: 'array', items: { type: 'object' } }
        },
        required: ['tree', 'explanation']
      }
    },
    ambiguityNote: { type: 'string' }
  },
  required: ['analyses']
};

export class ParseApiError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'ParseApiError';
    this.code = code;
    this.status = status;
  }
}

const getErrorMeta = (error) => {
  const msg = String(error?.message || '');
  const details = JSON.stringify(error || {});
  const haystack = `${msg}\n${details}`.toLowerCase();
  const statusCode = Number(
    error?.status ??
    error?.response?.status ??
    (typeof error?.code === 'number' ? error.code : NaN)
  );
  return { msg, haystack, statusCode };
};

const isRetryableCapacityError = (error) => {
  const { haystack, statusCode } = getErrorMeta(error);
  return (
    statusCode === 503 ||
    statusCode === 429 ||
    haystack.includes('service unavailable') ||
    haystack.includes('backend error') ||
    haystack.includes('resource_exhausted') ||
    haystack.includes('overloaded') ||
    haystack.includes('high demand') ||
    haystack.includes('unavailable')
  );
};

const isModelUnavailableError = (error) => {
  const { haystack, statusCode } = getErrorMeta(error);
  return (
    statusCode === 404 ||
    (haystack.includes('model') && (
      haystack.includes('not found') ||
      haystack.includes('not available') ||
      haystack.includes('unsupported')
    ))
  );
};

const isNetworkTransportError = (error) => {
  const { haystack } = getErrorMeta(error);
  return (
    haystack.includes('fetch failed') ||
    haystack.includes('network') ||
    haystack.includes('timed out') ||
    haystack.includes('econnreset') ||
    haystack.includes('etimedout') ||
    haystack.includes('enotfound') ||
    haystack.includes('socket')
  );
};

const summarizeErrorForLog = (error) => {
  const { msg, statusCode } = getErrorMeta(error);
  const shortMessage = String(msg || '')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
  return {
    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
    message: shortMessage || undefined
  };
};

const isSchemaConfigError = (error) => {
  const { haystack, statusCode } = getErrorMeta(error);
  return (
    statusCode === 400 &&
    (
      haystack.includes('response_json_schema') ||
      haystack.includes('responseschema') ||
      haystack.includes('response schema')
    )
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (run, timeoutMs, label) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return run(undefined);
  }

  const controller = new AbortController();
  let timeoutId = null;
  const timeoutMessage = `${label} timed out after ${timeoutMs}ms.`;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const isTruncatedGeneration = (generation) => {
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase();
  return finishReason.includes('MAX_TOKENS') || finishReason.includes('LENGTH');
};

const getRetryDelayMs = (attempt) => {
  const expDelay = Math.min(PRO_RETRY_MAX_DELAY_MS, PRO_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(expDelay * jitter);
};

const resolveModelTimeoutMs = (model) => {
  if (Number.isFinite(MODEL_CALL_TIMEOUT_MS) && MODEL_CALL_TIMEOUT_MS > 0) {
    return MODEL_CALL_TIMEOUT_MS;
  }
  return model === PRIMARY_MODEL ? PRIMARY_MODEL_TIMEOUT_MS : FALLBACK_MODEL_TIMEOUT_MS;
};

const getRemainingRequestBudgetMs = (requestStartedAt) => {
  if (!(Number.isFinite(REQUEST_BUDGET_MS) && REQUEST_BUDGET_MS > 0)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, REQUEST_BUDGET_MS - (Date.now() - requestStartedAt));
};

const resolveAttemptTimeoutMs = ({
  baseTimeoutMs,
  remainingBudgetMs,
  hasNextModel,
  attempt
}) => {
  const attemptFloor = MIN_ATTEMPT_TIMEOUT_MS;
  const budgetCap = Number.isFinite(remainingBudgetMs)
    ? Math.max(1200, remainingBudgetMs - 250)
    : Number.POSITIVE_INFINITY;

  let attemptCap = budgetCap;
  if (Number.isFinite(remainingBudgetMs)) {
    if (hasNextModel) {
      // Keep enough budget reserved so fallback gets a meaningful attempt window.
      const reserveForFallbackMs = Math.max(attemptFloor + 250, Math.floor(remainingBudgetMs * 0.4));
      attemptCap = Math.max(1200, Math.min(attemptCap, remainingBudgetMs - reserveForFallbackMs));
    } else if (attempt < PRO_RETRY_MAX_ATTEMPTS) {
      // Preserve room for at least one retry on the final route.
      const reserveForRetryMs = Math.max(PRO_RETRY_BASE_DELAY_MS + attemptFloor, attemptFloor + 250);
      attemptCap = Math.max(1200, Math.min(attemptCap, remainingBudgetMs - reserveForRetryMs));
    }
  }

  if (!Number.isFinite(baseTimeoutMs) || baseTimeoutMs <= 0) {
    return Math.max(1200, Math.min(attemptCap, budgetCap));
  }
  return Math.max(1200, Math.min(baseTimeoutMs, attemptCap));
};

const getModelCooldownRemainingMs = (model) => {
  const until = Number(modelCooldownUntil.get(model) || 0);
  return Math.max(0, until - Date.now());
};

const markModelCoolingDown = (model, reason) => {
  if (MODEL_COOLDOWN_MS <= 0) return;
  const until = Date.now() + MODEL_COOLDOWN_MS;
  modelCooldownUntil.set(model, until);
  console.warn(`[gemini] cooling down ${model} for ${Math.round(MODEL_COOLDOWN_MS / 1000)}s after ${reason}.`);
};

const summarizeGeneration = (generation) => {
  const rawText = String(generation?.text || '');
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase() || 'UNKNOWN';
  const preview = rawText
    .slice(0, 220)
    .replace(/\s+/g, ' ')
    .trim();
  return {
    rawText,
    finishReason,
    textLength: rawText.length,
    preview
  };
};

const nextGeneratedNodeId = (usedIds, counterRef) => {
  let candidate = `n${counterRef.value}`;
  while (usedIds.has(candidate)) {
    counterRef.value += 1;
    candidate = `n${counterRef.value}`;
  }
  usedIds.add(candidate);
  counterRef.value += 1;
  return candidate;
};

const NULL_SYMBOL_LABEL = /^(∅|Ø|ε|null|epsilon)$/i;

const normalizeCategoryKey = (label) => String(label || '').trim().replace(/['′\s]/g, '').toUpperCase();

const inferHeadFromPrimeLabel = (label) => {
  const trimmed = String(label || '').trim();
  const match = trimmed.match(/^(.+?)['′]+$/);
  if (!match?.[1]) return null;
  return match[1].trim() || null;
};

const canonicalizeBareNullHeadChildren = (parentLabel, children, usedIds, counterRef) => {
  if (!Array.isArray(children) || children.length === 0) return children;
  const headLabel = inferHeadFromPrimeLabel(parentLabel);
  if (!headLabel) return children;

  const headKey = normalizeCategoryKey(headLabel);
  const hasExplicitHeadChild = children.some((child) => normalizeCategoryKey(child?.label) === headKey);
  if (hasExplicitHeadChild) return children;

  return children.map((child) => {
    const childChildren = Array.isArray(child?.children) ? child.children : [];
    if (childChildren.length > 0) return child;

    const childLabel = String(child?.label || '').trim();
    const childWord = typeof child?.word === 'string' ? child.word.trim() : '';
    const surface = childWord || childLabel;
    if (!NULL_SYMBOL_LABEL.test(surface)) return child;

    return {
      id: nextGeneratedNodeId(usedIds, counterRef),
      label: headLabel,
      children: [child]
    };
  });
};

const collectNodeReferencesById = (value) => {
  const references = new Map();
  const seen = new Set();

  const walk = (current) => {
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    const id = typeof current.id === 'string' ? current.id.trim() : '';
    const label = typeof current.label === 'string' ? current.label.trim() : '';
    if (id && label && !references.has(id)) {
      references.set(id, current);
    }

    Object.values(current).forEach(walk);
  };

  walk(value);
  return references;
};

const normalizeLabelForFramework = (rawLabel, framework) => {
  const label = String(rawLabel || '').trim();
  if (framework !== 'minimalism') return label;
  if (!PRIME_CATEGORY_LABEL_RE.test(label)) return label;
  return label.slice(0, -1);
};

const normalizeSurfaceSpan = (value) => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const start = Number(value[0]);
  const end = Number(value[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return undefined;
  return [start, end];
};

const normalizeSyntaxNode = (value, usedIds, counterRef, context) => {
  if (typeof value === 'string') {
    const token = value.trim();
    if (!token) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        'Malformed tree node from model (empty string leaf).',
        502
      );
    }
    if (/^n\d+$/i.test(token)) {
      const referencedNode = context?.nodeReferences?.get(token);
      if (referencedNode) {
        if (context.resolvingIds.has(token)) {
          throw new ParseApiError(
            'BAD_MODEL_RESPONSE',
            `Malformed tree node from model (cyclic node reference: ${token}).`,
            502
          );
        }
        context.resolvingIds.add(token);
        try {
          return normalizeSyntaxNode(referencedNode, usedIds, counterRef, context);
        } finally {
          context.resolvingIds.delete(token);
        }
      }
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Malformed tree node from model (unresolved node-id reference: ${token}).`,
        502
      );
    }
    if (FORBIDDEN_STRING_LEAF_TOKENS.has(token.toLowerCase())) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Malformed tree node from model (metadata token leaked into leaves: ${token}).`,
        502
      );
    }
    const id = nextGeneratedNodeId(usedIds, counterRef);
    return { id, label: token, word: token };
  }

  if (Array.isArray(value)) {
    throw new ParseApiError(
      'BAD_MODEL_RESPONSE',
      'Malformed tree node from model (array node where object node was required).',
      502
    );
  }

  if (!value || typeof value !== 'object') {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed structural components from model.', 502);
  }

  const node = value;
  const rawLabel = typeof node.label === 'string' ? node.label.trim() : '';
  const label = normalizeLabelForFramework(rawLabel, context.framework);
  if (!label) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed structural components from model.', 502);
  }

  const requestedId = typeof node.id === 'string' ? node.id.trim() : '';
  let id = requestedId;
  if (!id || usedIds.has(id)) {
    id = nextGeneratedNodeId(usedIds, counterRef);
  } else {
    usedIds.add(id);
  }

  const normalized = { id, label };
  const surfaceSpan = normalizeSurfaceSpan(node.surfaceSpan);
  if (surfaceSpan) {
    normalized.surfaceSpan = surfaceSpan;
  }
  const rawChildren = Array.isArray(node.children)
    ? node.children.map((child) => normalizeSyntaxNode(child, usedIds, counterRef, context))
    : [];
  const children = canonicalizeBareNullHeadChildren(label, rawChildren, usedIds, counterRef);

  if (children.length > 0) {
    normalized.children = children;
  } else if (typeof node.word === 'string' && node.word.trim()) {
    normalized.word = node.word.trim();
  }

  return normalized;
};

const normalizeSyntaxTreeWithIds = (value, nodeReferences = new Map(), framework = 'xbar') => {
  const nodeIds = new Set();
  const counterRef = { value: 1 };
  const tree = normalizeSyntaxNode(value, nodeIds, counterRef, {
    nodeReferences,
    resolvingIds: new Set(),
    framework
  });
  return { tree, nodeIds };
};

const normalizePartsOfSpeech = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      word: String(item?.word ?? '').trim(),
      pos: String(item?.pos ?? '').trim()
    }))
    .filter((item) => item.word.length > 0 && item.pos.length > 0);
};

const normalizeSurfaceToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, '')
    .replace(/^⟨|⟩$/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const tokenizeSentenceSurfaceOrder = (sentence) =>
  String(sentence || '')
    .split(/\s+/)
    .map((token) => String(token || '').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);

const collectOvertTerminalNodes = (tree) => {
  const terminals = [];

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      if (surface && !isTraceLikeNode(node) && !isNullLikeNode(node)) {
        terminals.push(node);
      }
      return;
    }
    children.forEach(visit);
  };

  visit(tree);
  return terminals;
};

const countTokens = (tokens) => {
  const counts = new Map();
  tokens.forEach((token) => {
    counts.set(token, Number(counts.get(token) || 0) + 1);
  });
  return counts;
};

const sameTokenCounts = (leftTokens, rightTokens) => {
  const leftCounts = countTokens(leftTokens);
  const rightCounts = countTokens(rightTokens);
  if (leftCounts.size !== rightCounts.size) return false;
  for (const [token, count] of leftCounts.entries()) {
    if (Number(rightCounts.get(token) || 0) !== count) return false;
  }
  return true;
};

const subtreeHasOvertYield = (node) => {
  if (!node || typeof node !== 'object') return false;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
    return Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node);
  }
  return children.some((child) => subtreeHasOvertYield(child));
};

const canonicalizeNullSubtree = (node) => {
  if (!node || typeof node !== 'object') {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during surface-span normalization.', 502);
  }

  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length > 0) {
    node.children = children.map((child) => canonicalizeNullSubtree(child));
  }
  delete node.surfaceSpan;
  return node;
};

const canonicalizeTreeToSentenceOrder = (tree, normalizedSentenceTokens) => {
  const alignNode = (node, startIndex) => {
    if (!node || typeof node !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during surface-span normalization.', 502);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      const overt = Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node);

      if (!overt) {
        delete node.surfaceSpan;
        return { node, nextIndex: startIndex, overtCount: 0 };
      }

      if (startIndex >= normalizedSentenceTokens.length) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Tree realizes more overt terminals than the sentence contains.',
          502
        );
      }

      if (surface !== normalizedSentenceTokens[startIndex]) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Tree overt terminals do not match the committed surface order.',
          502
        );
      }

      node.surfaceSpan = [startIndex, startIndex];
      return { node, nextIndex: startIndex + 1, overtCount: 1 };
    }

    const overtSlots = [];
    const nullSlots = [];
    children.forEach((child, index) => {
      if (subtreeHasOvertYield(child)) {
        overtSlots.push({ index, child });
      } else {
        nullSlots.push({ index, child: canonicalizeNullSubtree(child) });
      }
    });

    if (overtSlots.length === 0) {
      node.children = children.map((child) => canonicalizeNullSubtree(child));
      delete node.surfaceSpan;
      return { node, nextIndex: startIndex, overtCount: 0 };
    }

    const search = (remaining, currentIndex, chosen) => {
      if (remaining.length === 0) {
        return { nextIndex: currentIndex, chosen };
      }

      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        try {
          const aligned = alignNode(candidate.child, currentIndex);
          if (aligned.overtCount === 0) continue;
          const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
          const resolved = search(rest, aligned.nextIndex, chosen.concat(aligned.node));
          if (resolved) return resolved;
        } catch (error) {
          if (!(error instanceof ParseApiError) || error.code !== 'BAD_MODEL_RESPONSE') {
            throw error;
          }
        }
      }
      return null;
    };

    const aligned = search(overtSlots, startIndex, []);
    if (!aligned) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        'Tree overt terminals do not match the committed surface order.',
        502
      );
    }

    const rebuiltChildren = new Array(children.length);
    nullSlots.forEach(({ index, child }) => {
      rebuiltChildren[index] = child;
    });
    overtSlots.forEach((slot, overtIndex) => {
      rebuiltChildren[slot.index] = aligned.chosen[overtIndex];
    });

    node.children = rebuiltChildren;
    node.surfaceSpan = [startIndex, aligned.nextIndex - 1];
    return {
      node,
      nextIndex: aligned.nextIndex,
      overtCount: aligned.nextIndex - startIndex
    };
  };

  const root = alignNode(tree, 0);
  if (!Number.isInteger(root.node?.surfaceSpan?.[0]) || !Number.isInteger(root.node?.surfaceSpan?.[1])) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'The tree contains no overt span for the sentence.', 502);
  }
  if (root.nextIndex !== normalizedSentenceTokens.length) {
    throw new ParseApiError(
      'BAD_MODEL_RESPONSE',
      'Tree overt terminals do not match the committed surface order.',
      502
    );
  }
  return root.node;
};

const materializeSingletonSpanLexicalLeaves = (tree, normalizedSentenceTokens) => {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const existingWord = String(node.word || '').trim();
      if (existingWord) return;
      const span = normalizeSurfaceSpan(node.surfaceSpan);
      if (!span || span[0] !== span[1]) return;
      const tokenIndex = span[0];
      const expected = String(normalizedSentenceTokens[tokenIndex] || '').trim();
      if (!expected) return;
      const label = String(node.label || '').trim();
      if (!label) return;
      if (normalizeSurfaceToken(label) === expected) {
        node.word = label;
      }
      return;
    }
    children.forEach(visit);
  };
  visit(tree);
};

const validateAndCommitSurfaceOrder = (_surfaceOrder, tree, sentence) => {
  const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
  const normalizedSentenceTokens = sentenceTokens.map(normalizeSurfaceToken).filter(Boolean);
  if (normalizedSentenceTokens.length === 0) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Unable to derive overt sentence tokens for surface-order validation.', 502);
  }

  materializeSingletonSpanLexicalLeaves(tree, normalizedSentenceTokens);

  const overtTerminals = collectOvertTerminalNodes(tree);
  const normalizedTreeTokens = overtTerminals
    .map((node) => normalizeSurfaceToken(resolveNodeSurface(node)))
    .filter(Boolean);

  if (
    normalizedTreeTokens.length !== normalizedSentenceTokens.length ||
    !sameTokenCounts(normalizedTreeTokens, normalizedSentenceTokens)
  ) {
    throw new ParseApiError(
      'BAD_MODEL_RESPONSE',
      'Tree overt terminals do not match the committed surface order.',
      502
    );
  }

  const canonicalTree = canonicalizeTreeToSentenceOrder(tree, normalizedSentenceTokens);

  return {
    tree: canonicalTree,
    surfaceOrder: sentenceTokens
  };
};

const validateSpelloutConsistency = (derivationSteps, sentenceTokens, surfaceOrder) => {
  if (!Array.isArray(derivationSteps) || derivationSteps.length === 0) {
    return false;
  }

  const spelloutSteps = derivationSteps.filter((step) => String(step?.operation || '').trim() === 'SpellOut');
  if (spelloutSteps.length === 0) {
    return false;
  }

  const finalSpelloutStep = spelloutSteps[spelloutSteps.length - 1];
  const normalizedSpelloutOrder = (finalSpelloutStep.spelloutOrder || [])
    .map((token) => normalizeSurfaceToken(token))
    .filter(Boolean);
  const normalizedSurfaceOrder = (surfaceOrder || [])
    .map((token) => normalizeSurfaceToken(token))
    .filter(Boolean);
  const normalizedSentenceTokens = (sentenceTokens || [])
    .map((token) => normalizeSurfaceToken(token))
    .filter(Boolean);

  if (
    normalizedSpelloutOrder.length === 0 ||
    JSON.stringify(normalizedSpelloutOrder) !== JSON.stringify(normalizedSurfaceOrder) ||
    JSON.stringify(normalizedSpelloutOrder) !== JSON.stringify(normalizedSentenceTokens)
  ) {
    return false;
  }
  return true;
};

const serializeTreeToBracketedNotation = (node) => {
  if (!node || typeof node !== 'object') return '';
  const label = String(node.label || '').trim();
  const word = typeof node.word === 'string' ? node.word.trim() : '';
  const children = Array.isArray(node.children) ? node.children : [];

  if (children.length === 0) {
    const surface = word || label || '∅';
    if (word && label && label !== word) {
      return `[${label} ${surface}]`;
    }
    return surface;
  }

  const childNotation = children
    .map((child) => serializeTreeToBracketedNotation(child))
    .filter(Boolean)
    .join(' ');
  return childNotation ? `[${label} ${childNotation}]` : `[${label}]`;
};

const normalizeFeatureChecking = (value, nodeIds) => {
  if (!Array.isArray(value)) return undefined;

  const entries = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const feature = String(item.feature || '').trim();
      if (!feature) return null;

      const valueText = String(item.value || '').trim();
      const status = String(item.status || '').trim().toLowerCase();
      const probeNodeId = String(item.probeNodeId || '').trim();
      const goalNodeId = String(item.goalNodeId || '').trim();
      const probeLabel = String(item.probeLabel || '').trim();
      const goalLabel = String(item.goalLabel || '').trim();
      const note = String(item.note || '').trim();

      return {
        feature,
        value: valueText || undefined,
        status: status || undefined,
        probeNodeId: probeNodeId && nodeIds.has(probeNodeId) ? probeNodeId : undefined,
        goalNodeId: goalNodeId && nodeIds.has(goalNodeId) ? goalNodeId : undefined,
        probeLabel: probeLabel || undefined,
        goalLabel: goalLabel || undefined,
        note: note || undefined
      };
    })
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
};

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const normalizeDerivationOperation = (value) => {
  const key = normalizeKey(value);
  if (!key) return undefined;
  if (key === 'lexicalselect' || key === 'select' || key === 'lexicalitemselect') return 'LexicalSelect';
  if (key === 'externalmerge' || key === 'merge') return 'ExternalMerge';
  if (key === 'internalmerge' || key === 'internalmove') return 'InternalMerge';
  if (key === 'headmove' || key === 'headmovement') return 'HeadMove';
  if (key === 'amove' || key === 'amovement') return 'A-Move';
  if (key === 'abarmove' || key === 'abarmovement' || key === 'whmove') return 'AbarMove';
  if (key === 'project' || key === 'projection') return 'Project';
  if (key === 'label' || key === 'labelling' || key === 'labeling') return 'Label';
  if (key === 'move' || key === 'movement') return 'Move';
  if (key === 'agree') return 'Agree';
  if (key === 'spellout' || key === 'spelloutphase') return 'SpellOut';
  if (key === 'other') return 'Other';
  return 'Other';
};

const normalizeSpelloutOrder = (value) => {
  if (!Array.isArray(value)) return undefined;
  const tokens = value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens : undefined;
};

const normalizeMovementOperation = (value) => {
  const key = normalizeKey(value);
  if (!key) return undefined;
  if (key === 'move' || key === 'movement') return 'Move';
  if (key === 'internalmerge' || key === 'internalmove') return 'InternalMerge';
  if (key === 'headmove' || key === 'headmovement') return 'HeadMove';
  if (key === 'amove' || key === 'amovement') return 'A-Move';
  if (key === 'abarmove' || key === 'abarmovement' || key === 'whmove') return 'AbarMove';
  if (key === 'other') return 'Other';
  return 'Other';
};

const normalizeDerivationSteps = (value, nodeIds) => {
  if (!Array.isArray(value)) return undefined;
  const steps = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const operation = normalizeDerivationOperation(item.operation);
      if (!operation) return null;
      return {
        operation,
        targetLabel: typeof item.targetLabel === 'string' ? item.targetLabel : undefined,
        targetNodeId:
          typeof item.targetNodeId === 'string' && nodeIds.has(item.targetNodeId)
            ? item.targetNodeId
            : undefined,
        sourceNodeIds: Array.isArray(item.sourceNodeIds)
          ? item.sourceNodeIds
              .map((id) => String(id || '').trim())
              .filter((id) => id.length > 0 && nodeIds.has(id))
          : undefined,
        sourceLabels: Array.isArray(item.sourceLabels)
          ? item.sourceLabels
              .map((label) => String(label || '').trim())
              .filter((label) => label.length > 0)
          : undefined,
        recipe: typeof item.recipe === 'string' ? item.recipe : undefined,
        workspaceAfter: Array.isArray(item.workspaceAfter)
          ? item.workspaceAfter
              .map((label) => String(label || '').trim())
              .filter((label) => label.length > 0)
          : undefined,
        spelloutOrder: normalizeSpelloutOrder(item.spelloutOrder),
        featureChecking: normalizeFeatureChecking(item.featureChecking, nodeIds),
        note: typeof item.note === 'string' ? item.note : undefined
      };
    })
    .filter(Boolean);

  return steps.length > 0 ? steps : undefined;
};

const MOVE_LIKE_OPERATION_RE = /^(move|internal[\s-]*merge|head[\s-]*move|a[\s-]*move|a(?:bar)?[\s-]*move)$/i;

const isMoveLikeOperation = (operation) => MOVE_LIKE_OPERATION_RE.test(String(operation || '').trim());

const isHeadMovementLandingNode = (node) => {
  const label = String(node?.label || '').trim().toLowerCase();
  return ['c', 't', 'infl', 'i', 'aux'].includes(label);
};

const stepHasTraceLikeSource = (step, nodeById) => {
  const sourceIds = Array.isArray(step?.sourceNodeIds)
    ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  return sourceIds.some((sourceId) => {
    const sourceNode = nodeById.get(sourceId);
    if (!sourceNode) return false;
    if (isTraceLikeNode(sourceNode) || isNullLikeNode(sourceNode)) return true;
    return collectLeafNodes(sourceNode).some((leaf) => isTraceLikeNode(leaf) || isNullLikeNode(leaf));
  });
};

const isImplicitHeadMoveProjectionStep = (step, nodeById) => {
  if (String(step?.operation || '').trim() !== 'Project') return false;
  const targetNodeId = String(step?.targetNodeId || '').trim();
  if (!targetNodeId) return false;
  const targetNode = nodeById.get(targetNodeId);
  if (!targetNode || !isHeadMovementLandingNode(targetNode)) return false;
  return stepHasTraceLikeSource(step, nodeById);
};

const resolveMovementEventStepIndex = (event, derivationSteps) => {
  if (!Array.isArray(derivationSteps) || derivationSteps.length === 0) return undefined;

  const explicitStep = Number(event.stepIndex);
  if (Number.isInteger(explicitStep) && explicitStep >= 0 && explicitStep < derivationSteps.length) {
    return explicitStep;
  }

  const fromNodeId = String(event.fromNodeId || '').trim();
  const toNodeId = String(event.toNodeId || '').trim();
  const traceNodeId = String(event.traceNodeId || '').trim();

  let bestIndex = -1;
  let bestScore = -1;

  derivationSteps.forEach((step, index) => {
    if (!step || typeof step !== 'object') return;
    const stepTarget = String(step.targetNodeId || '').trim();
    const stepSources = Array.isArray(step.sourceNodeIds)
      ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    let score = 0;
    if (stepTarget && stepTarget === toNodeId) score += 6;
    if (stepSources.includes(fromNodeId)) score += 5;
    if (stepTarget && stepTarget === fromNodeId) score += 2;
    if (stepSources.includes(toNodeId)) score += 1;
    if (traceNodeId && (stepTarget === traceNodeId || stepSources.includes(traceNodeId))) score += 2;
    if (isMoveLikeOperation(step.operation)) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex >= 0 && bestScore > 0) return bestIndex;

  const fallbackMoveIndex = derivationSteps.findIndex((step) => isMoveLikeOperation(step?.operation));
  if (fallbackMoveIndex >= 0) return fallbackMoveIndex;

  return undefined;
};

const normalizeMovementEvents = (value, nodeIds, derivationSteps) => {
  if (!Array.isArray(value)) return undefined;

  const events = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const fromNodeId = String(item.fromNodeId || '').trim();
      const toNodeId = String(item.toNodeId || '').trim();
      if (!fromNodeId || !toNodeId) return null;
      if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return null;

      const traceNodeId = String(item.traceNodeId || '').trim();
      const stepIndexRaw = Number(item.stepIndex);
      const hasDerivationTimeline = Array.isArray(derivationSteps) && derivationSteps.length > 0;
      const stepIndex = Number.isInteger(stepIndexRaw) &&
        stepIndexRaw >= 0 &&
        (!hasDerivationTimeline || stepIndexRaw < derivationSteps.length)
        ? stepIndexRaw
        : undefined;
      const operation = normalizeMovementOperation(item.operation);

      return {
        operation,
        fromNodeId,
        toNodeId,
        traceNodeId: traceNodeId && nodeIds.has(traceNodeId) ? traceNodeId : undefined,
        stepIndex: stepIndex ?? resolveMovementEventStepIndex({
          fromNodeId,
          toNodeId,
          traceNodeId: traceNodeId && nodeIds.has(traceNodeId) ? traceNodeId : undefined
        }, derivationSteps),
        note: typeof item.note === 'string' ? item.note : undefined
      };
    })
    .filter(Boolean);

  return events.length > 0 ? events : undefined;
};

const TRACE_LIKE_SURFACE_RE = /^(?:t|trace|t\d+|trace\d+|t[_-][a-z0-9]+|trace[_-][a-z0-9]+|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\})$/i;
const NULL_LIKE_SURFACE_RE = /^(∅|Ø|ε|null|epsilon)$/i;

const buildNodeIndexFromTree = (tree) => {
  const byId = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id || '').trim();
    if (id) byId.set(id, node);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(tree);
  return byId;
};

const buildParentIndexFromTree = (tree) => {
  const parents = new Map();
  const visit = (node, parentId = null) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id || '').trim();
    if (id && parentId) parents.set(id, parentId);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => visit(child, id || parentId));
  };
  visit(tree);
  return parents;
};

const collectLeafNodes = (node) => {
  const leaves = [];
  const visit = (current) => {
    if (!current || typeof current !== 'object') return;
    const children = Array.isArray(current.children) ? current.children : [];
    if (children.length === 0) {
      leaves.push(current);
      return;
    }
    children.forEach(visit);
  };
  visit(node);
  return leaves;
};

const collectSubtreeNodeIds = (node) => {
  const ids = new Set();
  const visit = (current) => {
    if (!current || typeof current !== 'object') return;
    const id = String(current.id || '').trim();
    if (id) ids.add(id);
    const children = Array.isArray(current.children) ? current.children : [];
    children.forEach(visit);
  };
  visit(node);
  return ids;
};

const resolveNodeSurface = (node) => {
  const word = String(node?.word || '').trim();
  const label = String(node?.label || '').trim();
  return word || label;
};

const isStructuralLeafLabel = (label) => {
  const raw = String(label || '').trim();
  if (!raw) return false;
  if (!STRUCTURAL_LEAF_LABELS.has(raw.toLowerCase())) return false;
  return raw === raw.toUpperCase() || /^[A-Z]/.test(raw) || PRIME_CATEGORY_LABEL_RE.test(raw);
};

const resolveOvertLeafSurface = (node) => {
  const word = String(node?.word || '').trim();
  if (word) return word;
  const children = Array.isArray(node?.children) ? node.children : [];
  if (children.length > 0) return '';
  const label = String(node?.label || '').trim();
  if (!label) return '';
  if (isStructuralLeafLabel(label)) return '';
  return label;
};

const isTraceLikeNode = (node) => TRACE_LIKE_SURFACE_RE.test(resolveNodeSurface(node));

const isNullLikeNode = (node) => NULL_LIKE_SURFACE_RE.test(resolveNodeSurface(node));

const isNodeDominatedBy = (nodeId, ancestorId, parentById) => {
  const target = String(nodeId || '').trim();
  const ancestor = String(ancestorId || '').trim();
  if (!target || !ancestor) return false;
  let current = target;
  while (current) {
    if (current === ancestor) return true;
    current = String(parentById.get(current) || '').trim();
  }
  return false;
};

const isExternalTraceLikeNode = (node, targetNodeId, parentById) => {
  const id = String(node?.id || '').trim();
  if (!id) return false;
  if (isNodeDominatedBy(id, targetNodeId, parentById)) return false;
  return isTraceLikeNode(node) || isNullLikeNode(node);
};

const findUniqueTraceLikeLeafOutsideSubtree = (searchRoot, excludedSubtree, parentById) => {
  if (!searchRoot || !excludedSubtree) return null;
  const excludedIds = collectSubtreeNodeIds(excludedSubtree);
  const candidates = collectLeafNodes(searchRoot).filter((leaf) => {
    const id = String(leaf.id || '').trim();
    if (!id || excludedIds.has(id)) return false;
    return isExternalTraceLikeNode(leaf, String(excludedSubtree.id || '').trim(), parentById);
  });
  return candidates.length === 1 ? candidates[0] : null;
};

const findPreferredHeadTraceOutsideSubtree = (searchRoot, excludedSubtree, parentById, nodeById) => {
  if (!searchRoot || !excludedSubtree) return null;
  const excludedIds = collectSubtreeNodeIds(excludedSubtree);
  const rootId = String(searchRoot.id || '').trim();
  const candidates = collectLeafNodes(searchRoot).filter((leaf) => {
    const id = String(leaf.id || '').trim();
    if (!id || excludedIds.has(id)) return false;
    return isExternalTraceLikeNode(leaf, String(excludedSubtree.id || '').trim(), parentById);
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const scoreCandidate = (leaf) => {
    let currentId = String(parentById.get(String(leaf.id || '').trim()) || '').trim();
    let distance = 0;
    while (currentId && currentId !== rootId) {
      const currentNode = nodeById.get(currentId);
      if (isHeadMovementLandingNode(currentNode)) {
        return { landingDistance: distance, hasLanding: true };
      }
      currentId = String(parentById.get(currentId) || '').trim();
      distance += 1;
    }
    if (currentId === rootId && isHeadMovementLandingNode(nodeById.get(currentId))) {
      return { landingDistance: distance, hasLanding: true };
    }
    return { landingDistance: Number.POSITIVE_INFINITY, hasLanding: false };
  };

  const ranked = candidates
    .map((leaf) => ({ leaf, ...scoreCandidate(leaf) }))
    .sort((a, b) => {
      if (a.hasLanding !== b.hasLanding) return a.hasLanding ? -1 : 1;
      if (a.landingDistance !== b.landingDistance) return a.landingDistance - b.landingDistance;
      return String(a.leaf.id || '').localeCompare(String(b.leaf.id || ''));
    });

  return ranked[0]?.leaf || null;
};

const getMoveLikeTraceSourceFromStep = (step, nodeById, targetNodeId, parentById) => {
  const sourceIds = Array.isArray(step?.sourceNodeIds)
    ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  for (const sourceId of sourceIds) {
    const sourceNode = nodeById.get(sourceId);
    if (!sourceNode) continue;
    if (isExternalTraceLikeNode(sourceNode, targetNodeId, parentById)) return sourceNode;
    const leafCandidate = collectLeafNodes(sourceNode).find((leaf) =>
      isExternalTraceLikeNode(leaf, targetNodeId, parentById)
    );
    if (leafCandidate) return leafCandidate;
  }
  return null;
};

const groundMovementEvent = ({
  event,
  step,
  tree,
  nodeById,
  parentById
}) => {
  if (!event) return null;
  const fromNodeId = String(event.fromNodeId || '').trim();
  const toNodeId = String(event.toNodeId || '').trim();
  if (!fromNodeId || !toNodeId) return null;

  const fromNode = nodeById.get(fromNodeId);
  const toNode = nodeById.get(toNodeId);
  if (!fromNode || !toNode) return null;

  const op = inferMovementOperationFromContext({
    baseOperation: event.operation,
    toNode,
    step,
    event
  });

  const explicitTraceId = String(event.traceNodeId || '').trim();
  const explicitTraceNode = explicitTraceId ? nodeById.get(explicitTraceId) : undefined;
  const groundedExplicitTrace = explicitTraceNode && isExternalTraceLikeNode(explicitTraceNode, toNodeId, parentById)
    ? explicitTraceNode
    : null;

  if (op === 'HeadMove') {
    if (groundedExplicitTrace) {
      return {
        ...event,
        operation: op,
        fromNodeId: String(groundedExplicitTrace.id || '').trim(),
        traceNodeId: String(groundedExplicitTrace.id || '').trim()
      };
    }

    const parentId = String(parentById.get(toNodeId) || '').trim();
    const parentNode = parentId ? nodeById.get(parentId) : undefined;
    const siblingTrace = parentNode
      ? (findPreferredHeadTraceOutsideSubtree(parentNode, toNode, parentById, nodeById)
          || findUniqueTraceLikeLeafOutsideSubtree(parentNode, toNode, parentById))
      : null;
    if (siblingTrace) {
      return {
        ...event,
        operation: op,
        fromNodeId: String(siblingTrace.id || '').trim(),
        traceNodeId: String(siblingTrace.id || '').trim()
      };
    }

    const stepTrace = getMoveLikeTraceSourceFromStep(step, nodeById, toNodeId, parentById);
    if (stepTrace) {
      return {
        ...event,
        operation: op,
        fromNodeId: String(stepTrace.id || '').trim(),
        traceNodeId: String(stepTrace.id || '').trim()
      };
    }

    // Head movement must always launch from a genuine lower copy/trace/null site.
    // If the analysis does not contain one, we do not preserve a drawable movement event.
    return null;
  }

  if (groundedExplicitTrace) {
    return {
      ...event,
      operation: op,
      traceNodeId: String(groundedExplicitTrace.id || '').trim()
    };
  }

  if (isNodeDominatedBy(fromNodeId, toNodeId, parentById)) {
    const stepTrace = getMoveLikeTraceSourceFromStep(step, nodeById, toNodeId, parentById);
    if (stepTrace) {
      return {
        ...event,
        operation: op,
        fromNodeId: String(stepTrace.id || '').trim(),
        traceNodeId: String(stepTrace.id || '').trim()
      };
    }

    const externalTrace = findUniqueTraceLikeLeafOutsideSubtree(tree, toNode, parentById);
    if (externalTrace) {
      return {
        ...event,
        operation: op,
        fromNodeId: String(externalTrace.id || '').trim(),
        traceNodeId: String(externalTrace.id || '').trim()
      };
    }

    return null;
  }

  return {
    ...event,
    operation: op,
    traceNodeId: undefined
  };
};

const hasHeadLikeLabel = (node) => {
  const label = String(node?.label || '').trim().toLowerCase();
  return ['c', 't', 'infl', 'i', 'v', 'aux'].includes(label);
};

const WH_CONTEXT_RE = /\b(wh|uwh|\[\+wh\]|spec[, ]*cp|a-?bar)\b/i;
const A_MOVE_CONTEXT_RE = /\b(epp|uphi|case|nom|spec[, ]*tp|spec[, ]*inflp)\b/i;

const inferMovementOperationFromContext = ({
  baseOperation,
  toNode,
  step,
  event
}) => {
  const base = normalizeMovementOperation(baseOperation) || 'Move';
  if (!['Move', 'InternalMerge'].includes(base)) return base;

  if (hasHeadLikeLabel(toNode)) return 'HeadMove';

  const featureText = Array.isArray(step?.featureChecking)
    ? step.featureChecking
        .map((item) => `${item?.feature || ''} ${item?.probeLabel || ''} ${item?.goalLabel || ''} ${item?.note || ''}`)
        .join(' ')
    : '';
  const contextText = [
    step?.note,
    step?.recipe,
    step?.targetLabel,
    Array.isArray(step?.sourceLabels) ? step.sourceLabels.join(' ') : '',
    event?.note,
    featureText
  ]
    .map((value) => String(value || ''))
    .join(' ');

  if (WH_CONTEXT_RE.test(contextText)) return 'AbarMove';
  if (A_MOVE_CONTEXT_RE.test(contextText)) return 'A-Move';
  return base;
};

const getNodeLabelLower = (nodeById, nodeId) =>
  String(nodeById.get(String(nodeId || '').trim())?.label || '').trim().toLowerCase();

const isPlausibleRawMovementEvent = (event, nodeById) => {
  const fromNodeId = String(event?.fromNodeId || '').trim();
  const toNodeId = String(event?.toNodeId || '').trim();
  if (!fromNodeId || !toNodeId) return false;
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return false;

  const op = normalizeMovementOperation(event?.operation) || 'Move';
  const fromLabel = getNodeLabelLower(nodeById, fromNodeId);
  const toLabel = getNodeLabelLower(nodeById, toNodeId);

  if (op === 'AbarMove') {
    if (['vp', 'tp', 'inflp', 'ip'].includes(fromLabel)) return false;
    if (!['dp', 'cp', 'spec', 'speccp'].some((candidate) => toLabel.includes(candidate))) return false;
  }

  if (op === 'HeadMove') {
    if (!['c', 't', 'infl', 'i', 'v', 'aux'].includes(toLabel)) return false;
  }

  return true;
};

const buildCanonicalMovementEvents = ({
  tree,
  derivationSteps,
  rawMovementEvents
}) => {
  const nodeById = buildNodeIndexFromTree(tree);
  const parentById = buildParentIndexFromTree(tree);
  const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
  const rawEvents = Array.isArray(rawMovementEvents) ? rawMovementEvents : [];
  const explicitMoveTargets = new Set(
    steps
      .filter((step) => isMoveLikeOperation(step?.operation))
      .map((step) => String(step?.targetNodeId || '').trim())
      .filter(Boolean)
  );
  const moveStepIndexes = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => {
      if (isMoveLikeOperation(step?.operation)) return true;
      const targetNodeId = String(step?.targetNodeId || '').trim();
      if (!targetNodeId || explicitMoveTargets.has(targetNodeId)) return false;
      return isImplicitHeadMoveProjectionStep(step, nodeById);
    })
    .map(({ index }) => index);

  const canonical = [];
  const seen = new Set();

  const pushEvent = (event, stepForContext) => {
    if (!event) return;
    const groundedEvent = groundMovementEvent({
      event,
      step: stepForContext,
      tree,
      nodeById,
      parentById
    });
    if (!groundedEvent) return;

    const fromNodeId = String(groundedEvent.fromNodeId || '').trim();
    const toNodeId = String(groundedEvent.toNodeId || '').trim();
    if (!fromNodeId || !toNodeId) return;
    if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return;
    if (fromNodeId === toNodeId) return;
    const stepIndex = Number(event.stepIndex);
    const safeStepIndex = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length
      ? stepIndex
      : undefined;
    const inferredOperation = normalizeMovementOperation(groundedEvent.operation) || 'Move';
    const key = `${fromNodeId}->${toNodeId}@${safeStepIndex ?? 'na'}:${inferredOperation}`;
    if (seen.has(key)) return;
    seen.add(key);
    canonical.push({
      operation: inferredOperation,
      fromNodeId,
      toNodeId,
      traceNodeId: (() => {
        const trace = String(groundedEvent.traceNodeId || '').trim();
        if (trace && nodeById.has(trace)) return trace;
        return undefined;
      })(),
      stepIndex: safeStepIndex,
      note: typeof groundedEvent.note === 'string' ? groundedEvent.note : undefined
    });
  };

  if (moveStepIndexes.length > 0) {
    moveStepIndexes.forEach((stepIndex) => {
      const step = steps[stepIndex] || {};
      const matchedRaw = rawEvents
        .filter((event) => Number(event?.stepIndex) === stepIndex)
        .filter((event) => isPlausibleRawMovementEvent(event, nodeById));
      if (matchedRaw.length > 0) {
        matchedRaw.forEach((event) => pushEvent({ ...event, stepIndex }, step));
        return;
      }

      const targetNodeId = String(step.targetNodeId || '').trim();
      const sourceNodeIds = Array.isArray(step.sourceNodeIds)
        ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      if (!targetNodeId || !nodeById.has(targetNodeId) || sourceNodeIds.length === 0) return;

      const targetNode = nodeById.get(targetNodeId);
      const orderedSources = sourceNodeIds
        .filter((id) => id !== targetNodeId && nodeById.has(id))
        .map((id) => ({ id, node: nodeById.get(id) }));
      if (orderedSources.length === 0) return;

      const traceSource = orderedSources.find(({ node }) => isTraceLikeNode(node) || isNullLikeNode(node));
      const headPreferred = hasHeadLikeLabel(targetNode);
      const lexicalSource = orderedSources.find(({ node }) => !isTraceLikeNode(node));
      const chosenSource = headPreferred
        ? (traceSource || lexicalSource || orderedSources[0])
        : (lexicalSource || traceSource || orderedSources[0]);

      pushEvent({
        operation: isImplicitHeadMoveProjectionStep(step, nodeById)
          ? 'HeadMove'
          : (normalizeMovementOperation(step.operation) || 'Move'),
        fromNodeId: chosenSource.id,
        toNodeId: targetNodeId,
        traceNodeId: traceSource?.id || undefined,
        stepIndex,
        note: typeof step.note === 'string' ? step.note : undefined
      }, step);
    });
  }

  // Backward compatibility: if no derivation move steps survived, keep model-provided events.
  if (canonical.length === 0 && rawEvents.length > 0) {
    rawEvents
      .filter((event) => isPlausibleRawMovementEvent(event, nodeById))
      .forEach((event) => pushEvent(event));
  }

  return canonical.length > 0 ? canonical : undefined;
};

const reconcileDerivationStepOperations = (derivationSteps, movementEvents) => {
  if (!Array.isArray(derivationSteps) || derivationSteps.length === 0) return derivationSteps;
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) {
    return derivationSteps.map((step) => {
      if (!isMoveLikeOperation(step?.operation)) return step;
      return {
        ...step,
        operation: 'Other'
      };
    });
  }

  const eventOpsByStep = new Map();
  movementEvents.forEach((event) => {
    const stepIndex = Number(event?.stepIndex);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= derivationSteps.length) return;
    const op = normalizeMovementOperation(event?.operation) || 'Move';
    const bucket = eventOpsByStep.get(stepIndex) || [];
    bucket.push(op);
    eventOpsByStep.set(stepIndex, bucket);
  });

  if (eventOpsByStep.size === 0) return derivationSteps;

  return derivationSteps.map((step, index) => {
    const ops = eventOpsByStep.get(index);
    if (!ops || ops.length === 0) {
      if (!isMoveLikeOperation(step?.operation)) return step;
      return {
        ...step,
        operation: 'Other'
      };
    }
    const uniqueOps = Array.from(new Set(ops));
    const chosen = uniqueOps.length === 1 ? uniqueOps[0] : 'Move';
    return {
      ...step,
      operation: chosen
    };
  });
};

const EXPLANATION_MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head[\s-]*move(?:ment)?|raising|raised|trace|copy|a-?bar|a-?move|wh-?move|front(?:ing|ed)?|displac(?:e|ed|ement|ing)|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;
const EXPLANATION_HEDGE_RE = /\b(may|might|possibly|can)\b/gi;
const EXPLANATION_HEADMOVE_RE = /\b(head[\s-]*move(?:ment)?|v\s*-?to\s*-?[ct]|t\s*-?to\s*-?c)\b/i;
const EXPLANATION_WHMOVE_RE = /\b(wh-?move|wh-?movement|wh-?fronting|\[\+wh\]|a-?bar|spec[, ]*cp)\b/i;
const EXPLANATION_AMOVE_RE = /\b(a-?move|a-?movement|spec(?:ifier)?[, ]*tp|epp)\b/i;
const EXPLANATION_INTERNALMERGE_RE = /\binternal\s*merge\b/i;
const MOVEMENT_OPERATION_PHRASE = {
  Move: 'movement',
  InternalMerge: 'internal merge',
  HeadMove: 'head movement',
  'A-Move': 'A-movement',
  AbarMove: 'A-bar movement',
  Other: 'movement'
};

const joinWithAnd = (items = []) => {
  const values = items.filter(Boolean);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const splitExplanationSentences = (text) => String(text || '')
  .split(/(?<=[.!?])\s+/)
  .map((segment) => segment.trim())
  .filter((segment) => segment.length > 0);

const cleanExplanationWhitespace = (text) => String(text || '')
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:!?])/g, '$1')
  .trim();

const ensureExplanationTerminator = (text) => {
  const value = cleanExplanationWhitespace(text);
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
};

const removeWeakHedging = (text) => cleanExplanationWhitespace(
  String(text || '')
    .replace(EXPLANATION_HEDGE_RE, '')
);

const extractMovementClaimsFromSentence = (sentence) => {
  const text = String(sentence || '');
  return {
    mentionsMovement: EXPLANATION_MOVEMENT_RE.test(text),
    claimsHeadMove: EXPLANATION_HEADMOVE_RE.test(text),
    claimsWhMove: EXPLANATION_WHMOVE_RE.test(text),
    claimsAMove: EXPLANATION_AMOVE_RE.test(text),
    claimsInternalMerge: EXPLANATION_INTERNALMERGE_RE.test(text)
  };
};

const extractMovementEventKinds = (movementEvents) => {
  const kinds = new Set();
  if (!Array.isArray(movementEvents)) return kinds;
  movementEvents.forEach((event) => {
    const op = normalizeMovementOperation(event?.operation);
    if (op === 'HeadMove') kinds.add('head');
    if (op === 'AbarMove') kinds.add('wh');
    if (op === 'A-Move') kinds.add('a');
    if (op === 'InternalMerge') kinds.add('internal');
  });
  return kinds;
};

const movementKindFromOperation = (operation) => {
  const op = normalizeMovementOperation(operation);
  if (op === 'HeadMove') return 'head';
  if (op === 'AbarMove') return 'wh';
  if (op === 'A-Move') return 'a';
  if (op === 'InternalMerge') return 'internal';
  return null;
};

const extractClaimedMovementKindsFromText = (text) => {
  const kinds = new Set();
  splitExplanationSentences(text).forEach((sentence) => {
    const claims = extractMovementClaimsFromSentence(sentence);
    if (claims.claimsHeadMove) kinds.add('head');
    if (claims.claimsWhMove) kinds.add('wh');
    if (claims.claimsAMove) kinds.add('a');
    if (claims.claimsInternalMerge) kinds.add('internal');
    if (
      claims.mentionsMovement
      && !claims.claimsHeadMove
      && !claims.claimsWhMove
      && !claims.claimsAMove
      && !claims.claimsInternalMerge
    ) {
      kinds.add('generic');
    }
  });
  return kinds;
};

const buildSupplementalMovementSummary = (compatibleText, movementEvents) => {
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) return '';
  const claimedKinds = extractClaimedMovementKindsFromText(compatibleText);
  if (claimedKinds.size === 0) {
    return summarizeGroundedMovement(movementEvents);
  }

  const missingEvents = movementEvents.filter((event) => {
    const kind = movementKindFromOperation(event?.operation);
    if (!kind) return false;
    return !claimedKinds.has(kind);
  });
  if (missingEvents.length === 0) return '';
  return summarizeGroundedMovement(missingEvents);
};

const movementSignatureForSentence = (sentence) => {
  const claims = extractMovementClaimsFromSentence(sentence);
  if (!claims.mentionsMovement) return '';
  const tags = [];
  if (claims.claimsHeadMove) tags.push('head');
  if (claims.claimsWhMove) tags.push('wh');
  if (claims.claimsAMove) tags.push('a');
  if (claims.claimsInternalMerge) tags.push('internal');
  if (tags.length === 0) tags.push('generic');
  return tags.sort().join('+');
};

const dedupeMovementSentences = (sentences) => {
  const seenSignatures = new Set();
  const output = [];
  sentences.forEach((sentence) => {
    const signature = movementSignatureForSentence(sentence);
    if (!signature) {
      output.push(sentence);
      return;
    }
    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);
    output.push(sentence);
  });
  return output;
};

const isCompatibleMovementSentence = (sentence, movementEventKinds) => {
  const claims = extractMovementClaimsFromSentence(sentence);
  if (!claims.mentionsMovement) return true;
  if (/\bor\b/i.test(sentence)) return false;
  if (claims.claimsHeadMove && !movementEventKinds.has('head')) return false;
  if (claims.claimsWhMove && !movementEventKinds.has('wh')) return false;
  if (claims.claimsAMove && !movementEventKinds.has('a')) return false;
  if (claims.claimsInternalMerge && !movementEventKinds.has('internal')) return false;
  return true;
};

const summarizeGroundedMovement = (movementEvents) => {
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) return '';

  const operationOrder = [];
  movementEvents.forEach((event) => {
    const operation = normalizeMovementOperation(event?.operation) || 'Other';
    if (!operationOrder.includes(operation)) operationOrder.push(operation);
  });
  const operationPhrases = operationOrder
    .map((operation) => MOVEMENT_OPERATION_PHRASE[operation] || 'movement')
    .filter(Boolean);
  const eventDetails = movementEvents
    .slice(0, 3)
    .map((event) => {
      const operation = normalizeMovementOperation(event?.operation) || 'Other';
      const phrase = MOVEMENT_OPERATION_PHRASE[operation] || 'movement';
      const note = cleanExplanationWhitespace(String(event?.note || ''));
      return note ? `${phrase} (${note})` : phrase;
    })
    .filter(Boolean);
  const movementSummary = operationPhrases.length > 0
    ? `Movement in this derivation includes ${joinWithAnd(operationPhrases)}.`
    : 'Movement is present in this derivation.';
  const detailsSuffix = eventDetails.length > 0
    ? ` Grounded in the tree as: ${eventDetails.join('; ')}.`
    : '';
  return `${movementSummary}${detailsSuffix}`;
};

const collectOvertTreeWords = (tree) => {
  const words = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = String(resolveOvertLeafSurface(node) || '').trim();
      if (surface && !isTraceLikeNode(node) && !isNullLikeNode(node)) {
        words.push(surface);
      }
      return;
    }
    children.forEach(visit);
  };
  visit(tree);
  return words;
};

const summarizeDerivationFacts = ({ framework, tree, derivationSteps }) => {
  const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
  if (steps.length === 0) return '';

  const rootLabel = String(tree?.label || (framework === 'xbar' ? 'CP' : 'TP')).trim() || 'clause';
  const words = collectOvertTreeWords(tree);
  const wordSummary = words.length === 0
    ? ''
    : words.length <= 12
      ? ` over lexical material (${words.join(', ')})`
      : ` over the full overt string "${words.join(' ')}"`;

  const hasMergeLikeOps = steps.some((step) => {
    const op = String(step?.operation || '').trim();
    return op === 'LexicalSelect' || op === 'ExternalMerge' || op === 'Project' || op === 'Label';
  });
  const hasMovementOps = steps.some((step) => {
    const op = normalizeMovementOperation(step?.operation);
    return op === 'Move' || op === 'InternalMerge' || op === 'HeadMove' || op === 'A-Move' || op === 'AbarMove';
  });
  const hasFeatureOps = steps.some((step) => {
    const op = String(step?.operation || '').trim();
    const featureItems = Array.isArray(step?.featureChecking) ? step.featureChecking : [];
    return op === 'Agree' || featureItems.length > 0;
  });
  const processClauses = [];
  if (hasMergeLikeOps) processClauses.push('merge/projection');
  if (hasFeatureOps) processClauses.push('feature checking');
  if (hasMovementOps) processClauses.push('displacement operations');
  const processSummary = processClauses.length > 0
    ? ` The derivation proceeds through ${joinWithAnd(processClauses)}.`
    : '';

  const featureEvents = [];
  steps.forEach((step) => {
    const items = Array.isArray(step?.featureChecking) ? step.featureChecking : [];
    items.forEach((item) => {
      if (featureEvents.length >= 3) return;
      const feature = String(item?.feature || '').trim();
      if (!feature) return;
      const probe = String(item?.probeLabel || item?.probeNodeId || '').trim();
      const goal = String(item?.goalLabel || item?.goalNodeId || '').trim();
      const status = String(item?.status || '').trim();
      const relation = probe && goal ? `${probe} -> ${goal}` : (probe || goal || '');
      const statusText = status ? ` (${status})` : '';
      featureEvents.push(`${feature}${statusText}${relation ? ` at ${relation}` : ''}`);
    });
  });
  const featureSummary = featureEvents.length > 0
    ? ` Feature checking includes ${featureEvents.join('; ')}.`
    : '';

  return `This ${framework === 'xbar' ? 'X-bar' : 'Minimalist'} analysis projects a ${rootLabel}${wordSummary}.${processSummary}${featureSummary}`.trim();
};

const buildCanonicalDerivationFromTree = ({
  tree,
  movementEvents,
  surfaceOrder,
  modelDerivationSteps
}) => {
  const nodeById = buildNodeIndexFromTree(tree);
  const postorder = [];
  const visitPostorder = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visitPostorder);
    postorder.push(node);
  };
  visitPostorder(tree);

  const existingSteps = Array.isArray(modelDerivationSteps) ? modelDerivationSteps : [];
  const structuralFeatureChecksByTarget = new Map();
  const movementFeatureSteps = [];
  existingSteps.forEach((step) => {
    const targetNodeId = String(step?.targetNodeId || '').trim();
    const featureChecking = Array.isArray(step?.featureChecking) && step.featureChecking.length > 0
      ? step.featureChecking
      : undefined;
    if (!featureChecking) return;
    if (isMoveLikeOperation(step?.operation)) {
      movementFeatureSteps.push(featureChecking);
      return;
    }
    if (targetNodeId && !structuralFeatureChecksByTarget.has(targetNodeId)) {
      structuralFeatureChecksByTarget.set(targetNodeId, featureChecking);
    }
  });

  const workspace = new Map();
  const derivationSteps = [];
  postorder.forEach((node) => {
    const nodeId = String(node.id || '').trim();
    const children = Array.isArray(node.children) ? node.children : [];
    const targetLabel = String(node.label || '').trim() || String(node.word || '').trim() || 'Node';

    if (children.length === 0) {
      const surface = resolveNodeSurface(node) || targetLabel;
      workspace.set(nodeId, targetLabel);
      derivationSteps.push({
        operation: 'LexicalSelect',
        targetNodeId: nodeId || undefined,
        targetLabel,
        sourceNodeIds: [],
        sourceLabels: [surface],
        recipe: `Select ${surface}`,
        workspaceAfter: Array.from(workspace.values())
      });
      return;
    }

    children.forEach((child) => {
      const childId = String(child?.id || '').trim();
      if (childId) workspace.delete(childId);
    });
    workspace.set(nodeId, targetLabel);
    derivationSteps.push({
      operation: children.length === 1 ? 'Project' : 'ExternalMerge',
      targetNodeId: nodeId || undefined,
      targetLabel,
      sourceNodeIds: children
        .map((child) => String(child?.id || '').trim())
        .filter(Boolean),
      sourceLabels: children
        .map((child) => String(child?.label || child?.word || '').trim())
        .filter(Boolean),
      recipe: `${children
        .map((child) => String(child?.label || child?.word || '').trim())
        .filter(Boolean)
        .join(' + ')} -> ${targetLabel}`,
      workspaceAfter: Array.from(workspace.values()),
      featureChecking: structuralFeatureChecksByTarget.get(nodeId)
    });
  });

  const rootLabel = String(tree?.label || 'Tree').trim() || 'Tree';
  const canonicalMovementEvents = Array.isArray(movementEvents) ? movementEvents : [];
  canonicalMovementEvents
    .slice()
    .sort((left, right) => {
      const a = Number(left?.stepIndex);
      const b = Number(right?.stepIndex);
      const safeA = Number.isInteger(a) ? a : Number.MAX_SAFE_INTEGER;
      const safeB = Number.isInteger(b) ? b : Number.MAX_SAFE_INTEGER;
      return safeA - safeB;
    })
    .forEach((event, index) => {
      const targetNodeId = String(event?.toNodeId || '').trim();
      const sourceNodeIds = Array.from(new Set([
        String(event?.fromNodeId || '').trim(),
        String(event?.traceNodeId || '').trim()
      ].filter(Boolean)));
      const featureChecking = movementFeatureSteps[index];
      const op = normalizeMovementOperation(event?.operation) || 'Move';
      const targetLabel = String(nodeById.get(targetNodeId)?.label || '').trim() || 'Move';
      const sourceLabels = sourceNodeIds
        .map((id) => {
          const node = nodeById.get(id);
          return resolveNodeSurface(node) || String(node?.label || '').trim();
        })
        .filter(Boolean);
      derivationSteps.push({
        operation: op,
        targetNodeId: targetNodeId || undefined,
        targetLabel,
        sourceNodeIds,
        sourceLabels,
        recipe: `${sourceLabels.join(' + ')} -> ${targetLabel}`,
        workspaceAfter: [rootLabel],
        featureChecking,
        note: typeof event?.note === 'string' ? event.note : undefined
      });
    });

  derivationSteps.push({
    operation: 'SpellOut',
    targetNodeId: String(tree?.id || '').trim() || undefined,
    targetLabel: rootLabel,
    sourceNodeIds: String(tree?.id || '').trim() ? [String(tree.id).trim()] : undefined,
    sourceLabels: [rootLabel],
    recipe: `SpellOut(${rootLabel})`,
    workspaceAfter: [rootLabel],
    spelloutOrder: Array.isArray(surfaceOrder) ? surfaceOrder : undefined,
    note: 'Final spellout of the committed surface order.'
  });

  const movementStepIndexesByKey = new Map();
  derivationSteps.forEach((step, index) => {
    if (!isMoveLikeOperation(step?.operation)) return;
    const targetNodeId = String(step?.targetNodeId || '').trim();
    const sourceNodeIds = Array.isArray(step?.sourceNodeIds)
      ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    sourceNodeIds.forEach((sourceNodeId) => {
      movementStepIndexesByKey.set(`${sourceNodeId}->${targetNodeId}`, index);
    });
  });

  const movementEventsWithCanonicalSteps = canonicalMovementEvents.map((event) => {
    const fromNodeId = String(event?.fromNodeId || '').trim();
    const toNodeId = String(event?.toNodeId || '').trim();
    const traceNodeId = String(event?.traceNodeId || '').trim();
    const canonicalStepIndex =
      movementStepIndexesByKey.get(`${fromNodeId}->${toNodeId}`) ??
      (traceNodeId ? movementStepIndexesByKey.get(`${traceNodeId}->${toNodeId}`) : undefined);
    return {
      ...event,
      stepIndex: Number.isInteger(canonicalStepIndex) ? canonicalStepIndex : event?.stepIndex
    };
  });

  return {
    derivationSteps,
    movementEvents: movementEventsWithCanonicalSteps
  };
};

const harmonizeExplanationWithDerivation = (explanation, derivationSteps, movementEvents, tree, framework = 'xbar') => {
  const base = ensureExplanationTerminator(removeWeakHedging(explanation));
  const hasMovementEvents = Array.isArray(movementEvents) && movementEvents.length > 0;
  const derivationFactsSummary = summarizeDerivationFacts({ framework, tree, derivationSteps });

  if (hasMovementEvents) {
    const movementKinds = extractMovementEventKinds(movementEvents);
    const compatibleSentences = dedupeMovementSentences(splitExplanationSentences(base)
      .map((sentence) => removeWeakHedging(sentence))
      .filter((sentence) => isCompatibleMovementSentence(sentence, movementKinds)));

    const cleanedCompatible = ensureExplanationTerminator(cleanExplanationWhitespace(compatibleSentences.join(' ')));
    const supplementalMovementSummary = buildSupplementalMovementSummary(cleanedCompatible, movementEvents);
    const parts = [cleanedCompatible, derivationFactsSummary, supplementalMovementSummary]
      .map((part) => cleanExplanationWhitespace(part))
      .filter(Boolean);
    return ensureExplanationTerminator(parts.join(' '));
  }

  const kept = splitExplanationSentences(base).filter((sentence) => !EXPLANATION_MOVEMENT_RE.test(sentence));
  const cleaned = cleanExplanationWhitespace(kept.join(' '));
  const parts = [cleaned, derivationFactsSummary]
    .map((part) => cleanExplanationWhitespace(part))
    .filter(Boolean);
  if (parts.length > 0) return ensureExplanationTerminator(parts.join(' '));
  return ensureExplanationTerminator(`No movement is posited in this analysis. ${derivationFactsSummary}`.trim());
};

const harmonizeInterpretationWithDerivation = (interpretation, movementEvents) => {
  const raw = cleanExplanationWhitespace(String(interpretation || ''));
  if (!raw) return undefined;

  const movementKinds = extractMovementEventKinds(movementEvents);
  if (movementKinds.size === 0 && EXPLANATION_MOVEMENT_RE.test(raw)) {
    return undefined;
  }

  const kept = splitExplanationSentences(raw).filter((sentence) =>
    isCompatibleMovementSentence(sentence, movementKinds)
  );
  const cleaned = cleanExplanationWhitespace(kept.join(' '));
  return cleaned || undefined;
};

const normalizeParseResult = (value, framework = 'xbar', sentence = '') => {
  const parsed = value;
  if (!parsed || typeof parsed !== 'object') {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed parse result from model.', 502);
  }

  const explanation = typeof parsed.explanation === 'string' && parsed.explanation.trim()
    ? parsed.explanation
    : 'No explanation provided.';

  const nodeReferences = collectNodeReferencesById(parsed);
  const { tree: rawTree, nodeIds } = normalizeSyntaxTreeWithIds(parsed.tree, nodeReferences, framework);
  const derivationSteps = normalizeDerivationSteps(parsed.derivationSteps, nodeIds);
  const { tree, surfaceOrder } = validateAndCommitSurfaceOrder(parsed.surfaceOrder, rawTree, sentence);
  validateSpelloutConsistency(derivationSteps, tokenizeSentenceSurfaceOrder(sentence), surfaceOrder);
  const rawMovementEvents = normalizeMovementEvents(parsed.movementEvents, nodeIds, derivationSteps);
  const movementEvents = buildCanonicalMovementEvents({
    tree,
    derivationSteps,
    rawMovementEvents
  });
  const canonicalTimeline = buildCanonicalDerivationFromTree({
    tree,
    movementEvents,
    surfaceOrder,
    modelDerivationSteps: derivationSteps
  });
  const reconciledDerivationSteps = reconcileDerivationStepOperations(
    canonicalTimeline.derivationSteps,
    canonicalTimeline.movementEvents
  );
  const coherentExplanation = harmonizeExplanationWithDerivation(
    explanation,
    reconciledDerivationSteps,
    canonicalTimeline.movementEvents,
    tree,
    framework
  );
  const coherentInterpretation = harmonizeInterpretationWithDerivation(
    parsed.interpretation,
    canonicalTimeline.movementEvents
  );

  return {
    tree,
    explanation: coherentExplanation,
    surfaceOrder,
    partsOfSpeech: normalizePartsOfSpeech(parsed.partsOfSpeech),
    bracketedNotation: serializeTreeToBracketedNotation(tree),
    interpretation: coherentInterpretation,
    derivationSteps: reconciledDerivationSteps,
    movementEvents: canonicalTimeline.movementEvents
  };
};

const normalizeParseBundle = (value, framework = 'xbar', sentence = '') => {
  const parsed = value;
  const analysesSource = Array.isArray(parsed?.analyses)
    ? parsed.analyses
    : parsed
      ? [parsed]
      : [];

  const analyses = analysesSource
    .map((analysis) => normalizeParseResult(analysis, framework, sentence))
    .slice(0, 2);

  if (analyses.length === 0) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'No valid analyses returned by model.', 502);
  }

  return {
    analyses,
    ambiguityDetected: analyses.length === 2,
    ambiguityNote: typeof parsed?.ambiguityNote === 'string' ? parsed.ambiguityNote : undefined
  };
};

const parseModelJson = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Empty model response.', 502);
  }

  const stripTrailingCommas = (input) => {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (inString) {
        out += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        out += ch;
        continue;
      }

      if (ch === ',') {
        let j = i + 1;
        while (j < input.length && /\s/.test(input[j])) j += 1;
        if (j < input.length && (input[j] === '}' || input[j] === ']')) {
          continue;
        }
      }

      out += ch;
    }
    return out;
  };

  const extractBalancedJsonObjects = (input) => {
    const matches = [];
    let inString = false;
    let escaped = false;
    let depth = 0;
    let start = -1;

    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === '}') {
        if (depth > 0) depth -= 1;
        if (depth === 0 && start >= 0) {
          matches.push(input.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return matches;
  };

  const sanitizeJsonCandidate = (input) => {
    return stripTrailingCommas(
      String(input || '')
        .replace(/^\uFEFF/, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
    ).trim();
  };

  const normalizeParsedRoot = (value) => {
    if (Array.isArray(value)) return { analyses: value };
    if (value && typeof value === 'object') return value;
    return null;
  };

  const parseCandidate = (candidate) => {
    let parsed = JSON.parse(candidate);

    if (typeof parsed === 'string') {
      const nested = parsed.trim();
      if (nested.startsWith('{') || nested.startsWith('[')) {
        parsed = JSON.parse(nested);
      }
    }

    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      const embedded = parsed.text.trim();
      if (embedded.startsWith('{') || embedded.startsWith('[')) {
        const reparsed = JSON.parse(embedded);
        const normalizedEmbedded = normalizeParsedRoot(reparsed);
        if (normalizedEmbedded) return normalizedEmbedded;
      }
    }

    const normalized = normalizeParsedRoot(parsed);
    if (!normalized) {
      throw new Error('Not a JSON object root');
    }
    return normalized;
  };

  const seen = new Set();
  const candidates = [];
  const pushCandidate = (value) => {
    const candidate = String(value || '').trim();
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(text);

  const fencedBlocks = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/ig) || [];
  fencedBlocks.forEach((block) => {
    const inner = block.replace(/```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    pushCandidate(inner);
  });

  extractBalancedJsonObjects(text).forEach(pushCandidate);

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    pushCandidate(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const variants = [candidate, sanitizeJsonCandidate(candidate)];
    for (const variant of variants) {
      if (!variant) continue;
      try {
        return parseCandidate(variant);
      } catch {
        // try next variant
      }
    }
  }

  for (const fragment of extractBalancedJsonObjects(sanitizeJsonCandidate(text))) {
    try {
      return parseCandidate(fragment);
    } catch {
      // try next fragment
    }
  }

  throw new ParseApiError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
};

const generateStructuredContent = async ({ ai, model, contents, systemInstruction, temperature = 0.2, abortSignal }) => {
  const baseConfig = {
    systemInstruction,
    responseMimeType: 'application/json',
    maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
    temperature,
    abortSignal
  };

  if (!USE_RESPONSE_JSON_SCHEMA) {
    return ai.models.generateContent({
      model,
      contents,
      config: baseConfig
    });
  }

  try {
    return await ai.models.generateContent({
      model,
      contents,
      config: {
        ...baseConfig,
        responseJsonSchema: PARSE_RESPONSE_JSON_SCHEMA
      }
    });
  } catch (error) {
    if (isSchemaConfigError(error)) {
      console.warn(`[gemini] schema-constrained response rejected on ${model}; retrying without schema.`);
      return ai.models.generateContent({
        model,
        contents,
        config: baseConfig
      });
    }
    throw error;
  }
};

const buildSystemInstruction = (framework = 'xbar') =>
  (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) + '\n\n' + BASE_INSTRUCTION;

const buildParseContentsPrompt = (sentence, framework = 'xbar') =>
  `Analyze the sentence: "${sentence}" and return a complete syntactic tree analysis using ` +
  `${framework === 'xbar' ? 'X-Bar Theory' : 'The Minimalist Program (Bare Phrase Structure)'} in the specified JSON format. ` +
  `Return the complete analysis in one pass. ` +
  `Use these exact overt input tokens as your pronounced terminals: ${tokenizeSentenceSurfaceOrder(sentence).join(' | ')}. ` +
  `The input token indices are: ${tokenizeSentenceSurfaceOrder(sentence).map((token, index) => `${index}:${token}`).join(' ; ')}. ` +
  `Do not split or rewrite those overt tokens. ` +
  `Return surfaceSpan on every overt leaf and every overt projection using those token indices. ` +
  `The order of children in your final tree must itself encode the pronounced left-to-right order at every node. ` +
  `Ensure sibling children partition their parent's overt surfaceSpan in ascending left-to-right order. ` +
  `For every internal node, concatenating the overt yields of its listed children must reproduce that node's overt yield exactly. ` +
  `Use each overt input token exactly once in the final tree unless that token occurs multiple times in the sentence itself. ` +
  `Before answering, read the overt terminals of your final tree from left to right and ensure they spell out the exact sentence order: ${tokenizeSentenceSurfaceOrder(sentence).join(' | ')}. ` +
  `Do not return a tree unless its own overt leaves realize that exact sequence and every overt parent yield is the contiguous union of its overt children.`;

export const parseSentenceWithGemini = async (sentence, framework = 'xbar', modelRoute = 'flash-lite') => {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new ParseApiError('API_KEY_MISSING', 'Gemini API key is not configured on the server.', 500);
  }

  const ai = new GoogleGenAI({ apiKey });
  const normalizedModelRoute = modelRoute === 'pro' ? 'pro' : 'flash-lite';
  const systemInstruction = buildSystemInstruction(framework);
  const contents = buildParseContentsPrompt(sentence, framework);
  const preferredModel = normalizedModelRoute === 'pro' ? FALLBACK_MODEL : PRIMARY_MODEL;
  const baseModelCandidates = Array.from(new Set([preferredModel].map((model) => String(model || '').trim()).filter(Boolean)));
  const healthyModels = baseModelCandidates.filter((model) => getModelCooldownRemainingMs(model) <= 0);
  const coolingModels = baseModelCandidates.filter((model) => getModelCooldownRemainingMs(model) > 0);
  if (healthyModels.length > 0 && coolingModels.length > 0) {
    coolingModels.forEach((model) => {
      const remaining = getModelCooldownRemainingMs(model);
      console.warn(`[gemini] skipping cooled model ${model} for this request (${Math.ceil(remaining / 1000)}s remaining).`);
    });
  }
  const modelCandidates = healthyModels.length > 0 ? healthyModels : baseModelCandidates;
  const attemptedModels = [];
  const requestStartedAt = Date.now();

  try {
    let normalized = null;
    let lastError = null;
    let usedModel = null;
    for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
      const currentModel = modelCandidates[modelIndex];
      const hasNextModel = modelIndex < modelCandidates.length - 1;
      let moveToNextModel = false;
      if (!attemptedModels.includes(currentModel)) {
        attemptedModels.push(currentModel);
      }

      for (let attempt = 1; attempt <= PRO_RETRY_MAX_ATTEMPTS; attempt += 1) {
        const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt);
        if (remainingBudgetMs <= 1200) {
          lastError = new ParseApiError(
            'GEMINI_UNAVAILABLE',
            routeUnavailableMessage(normalizedModelRoute),
            503
          );
          moveToNextModel = false;
          break;
        }
        try {
          const baseTimeoutMs = resolveModelTimeoutMs(currentModel);
          const boundedTimeoutMs = resolveAttemptTimeoutMs({
            baseTimeoutMs,
            remainingBudgetMs,
            hasNextModel,
            attempt
          });
          const generation = await withTimeout(
            (abortSignal) => generateStructuredContent({
              ai,
              model: currentModel,
              contents,
              systemInstruction,
              temperature: 0.2,
              abortSignal
            }),
            boundedTimeoutMs,
            `Model generation (${currentModel})`
          );
          const generationMeta = summarizeGeneration(generation);

          if (isTruncatedGeneration(generation)) {
            throw new ParseApiError('BAD_MODEL_RESPONSE', 'Model output was truncated before JSON completion.', 502);
          }

          let payload;
          try {
            payload = parseModelJson(generationMeta.rawText);
          } catch (error) {
            if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
              console.warn(
                `[gemini] json parse failure on ${currentModel} ` +
                `(attempt ${attempt}/${PRO_RETRY_MAX_ATTEMPTS}, finishReason=${generationMeta.finishReason}, textLength=${generationMeta.textLength}). ` +
                `Preview: ${generationMeta.preview || '<empty>'}`
              );
            }
            throw error;
          }

          let candidateNormalized;
          try {
            candidateNormalized = normalizeParseBundle(payload, framework, sentence);
          } catch (error) {
            if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
              let payloadPreview = '<unserializable>';
              try {
                payloadPreview = JSON.stringify(payload).slice(0, 320);
              } catch {
                // keep fallback preview
              }
              console.warn(
                `[gemini] normalization failure on ${currentModel} ` +
                `(attempt ${attempt}/${PRO_RETRY_MAX_ATTEMPTS}, finishReason=${generationMeta.finishReason}, textLength=${generationMeta.textLength}). ` +
                `Error: ${error.message}. Payload preview: ${payloadPreview}`
              );
            }
            throw error;
          }

          normalized = candidateNormalized;
          usedModel = currentModel;
          if (modelIndex > 0) {
            console.warn(`[gemini] fallback model active: ${currentModel}`);
          }
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
            if (attempt < BAD_MODEL_RETRY_MAX_ATTEMPTS) {
              console.warn(
                `[gemini] invalid model payload from ${currentModel} ` +
                `(attempt ${attempt}/${BAD_MODEL_RETRY_MAX_ATTEMPTS}): ${error.message}. Retrying.`
              );
              continue;
            }
            if (hasNextModel) {
              console.warn(
                `[gemini] invalid model payload persisted on ${currentModel}: ${error.message}. ` +
                `Falling back to ${modelCandidates[modelIndex + 1]}.`
              );
              moveToNextModel = true;
              break;
            }
          }

          if (isModelUnavailableError(error) && hasNextModel) {
            const meta = summarizeErrorForLog(error);
            console.warn(
              `[gemini] model unavailable on ${currentModel} ` +
              `(attempt ${attempt}/${PRO_RETRY_MAX_ATTEMPTS}, status=${meta.statusCode ?? 'n/a'}): ${meta.message ?? 'no message'}`
            );
            markModelCoolingDown(currentModel, 'model unavailable');
            console.warn(`[gemini] model unavailable: ${currentModel}. Falling back to ${modelCandidates[modelIndex + 1]}.`);
            moveToNextModel = true;
            break;
          }

          if (isNetworkTransportError(error)) {
            const meta = summarizeErrorForLog(error);
            console.warn(
              `[gemini] transport issue on ${currentModel} ` +
              `(attempt ${attempt}/${PRO_RETRY_MAX_ATTEMPTS}, status=${meta.statusCode ?? 'n/a'}): ${meta.message ?? 'no message'}`
            );
            markModelCoolingDown(currentModel, 'transport error');
            const shouldRetrySameModel =
              attempt < PRO_RETRY_MAX_ATTEMPTS &&
              !(currentModel === PRIMARY_MODEL && hasNextModel);
            if (shouldRetrySameModel) {
              const delayMs = getRetryDelayMs(attempt);
              await sleep(delayMs);
              continue;
            }
            if (hasNextModel) {
              console.warn(`[gemini] transport error on ${currentModel}. Falling back to ${modelCandidates[modelIndex + 1]}.`);
              moveToNextModel = true;
              break;
            }
          }

          if (isRetryableCapacityError(error)) {
            const meta = summarizeErrorForLog(error);
            console.warn(
              `[gemini] capacity issue on ${currentModel} ` +
              `(attempt ${attempt}/${PRO_RETRY_MAX_ATTEMPTS}, status=${meta.statusCode ?? 'n/a'}): ${meta.message ?? 'no message'}`
            );
            markModelCoolingDown(currentModel, 'capacity issue');
            const shouldRetrySameModel =
              attempt < PRO_RETRY_MAX_ATTEMPTS &&
              !(currentModel === PRIMARY_MODEL && hasNextModel);
            if (shouldRetrySameModel) {
              const delayMs = getRetryDelayMs(attempt);
              await sleep(delayMs);
              continue;
            }
            if (hasNextModel) {
              console.warn(`[gemini] capacity issue on ${currentModel}. Falling back to ${modelCandidates[modelIndex + 1]}.`);
              moveToNextModel = true;
              break;
            }
          }

          throw error;
        }
      }

      if (normalized) break;
      if (!moveToNextModel) break;
    }

    if (!normalized) {
      if (lastError && attemptedModels.length > 1) {
        const unavailable = isRetryableCapacityError(lastError) || isNetworkTransportError(lastError) || isModelUnavailableError(lastError);
        if (unavailable) {
          throw new ParseApiError(
            'GEMINI_UNAVAILABLE',
            routeUnavailableMessage(normalizedModelRoute),
            503
          );
        }
      }
      if (lastError instanceof ParseApiError && lastError.code === 'BAD_MODEL_RESPONSE') {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'The canopy tangled while shaping structure. Please plant your sentence again.',
          502
        );
      }
      throw lastError || new Error('Empty model response.');
    }
    if (usedModel) {
      console.info(`[gemini] parse success via ${usedModel}`);
    }

    const fallbackUsed = Boolean(usedModel && attemptedModels.length > 0 && usedModel !== attemptedModels[0]);
    return {
      ...normalized,
      requestedModelRoute: normalizedModelRoute,
      modelUsed: usedModel || undefined,
      modelsTried: attemptedModels,
      fallbackUsed
    };
  } catch (error) {
    if (error instanceof ParseApiError) {
      throw error;
    }

    const { msg, haystack, statusCode } = getErrorMeta(error);

    if (
      haystack.includes('api key expired') ||
      haystack.includes('api_key_expired') ||
      haystack.includes('invalid api key') ||
      haystack.includes('api_key_invalid') ||
      haystack.includes('unauthenticated') ||
      haystack.includes('permission_denied') ||
      statusCode === 401 ||
      statusCode === 403
    ) {
      throw new ParseApiError('API_KEY_INVALID', 'Server API key is invalid or expired.', 500);
    }

    if (
      statusCode === 503 ||
      haystack.includes('service unavailable') ||
      haystack.includes('backend error')
    ) {
      throw new ParseApiError(
        'GEMINI_UNAVAILABLE',
        routeUnavailableMessage(normalizedModelRoute),
        503
      );
    }

    if (isNetworkTransportError(error)) {
      throw new ParseApiError(
        'GEMINI_UNAVAILABLE',
        routeUnavailableMessage(normalizedModelRoute),
        503
      );
    }

    if (haystack.includes('resource_exhausted') || haystack.includes('quota') || statusCode === 429) {
      throw new ParseApiError('GEMINI_QUOTA', 'Rate limit or quota reached for this server key.', 429);
    }

    if (
      statusCode === 404 ||
      (haystack.includes('model') && (
        haystack.includes('not found') ||
        haystack.includes('not available') ||
        haystack.includes('unsupported')
      ))
    ) {
      throw new ParseApiError('MODEL_UNAVAILABLE', 'Requested model is unavailable for this project/key.', 503);
    }

    if (haystack.includes('invalid_argument') || statusCode === 400) {
      throw new ParseApiError('INVALID_REQUEST', 'Request was rejected by Gemini (invalid argument).', 400);
    }

    throw new ParseApiError('PARSE_FAILED', msg || 'Syntactic parsing failed.', 500);
  }
};

export const __test__ = {
  normalizeParseBundle,
  normalizeParseResult,
  validateAndCommitSurfaceOrder,
  buildCanonicalMovementEvents,
  buildCanonicalDerivationFromTree,
  reconcileDerivationStepOperations,
  harmonizeExplanationWithDerivation,
  buildSystemInstruction,
  buildParseContentsPrompt,
  parseModelJson
};
