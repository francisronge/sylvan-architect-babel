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
Write a developed natural paragraph (roughly 3-6 sentences): brief, but not skeletal.`;

const MINIMALISM_INSTRUCTION = `You are a world-class syntactician specializing in Generative syntax, with a focus on the Minimalist Program and Bare Phrase Structure.

Parse natural language sentences by deriving structure through Merge, Internal Merge, Agree/feature valuation, and locality/phase constraints, not memorized templates.
Use derivational reasoning to justify each major structural choice.

Output conventions:
- Use Bare Phrase Structure style labels (no bar-level prime notation).
- Represent movement with copies/traces where needed.
- Use labels consistently.
- If clear syntactic ambiguity exists, return two analyses; otherwise return one.

In the explanation, justify major choices in framework terms, not language-specific heuristics.
Write a developed natural paragraph (roughly 3-6 sentences): brief, but not skeletal.`;

const BASE_INSTRUCTION = `Output MUST be a single, valid JSON object.
The JSON structure must be:
{
  "analyses": [
    {
      "tree": {
        "id": "n1",
        "label": "Label",
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

For movement commitment and consistency (per analysis):
- First decide movement and encode it in "movementDecision.hasMovement" (true/false).
- "movementDecision.rationale" must be one short sentence that commits to the chosen derivation (no alternatives).
- If hasMovement is true:
  - Include at least one movement event in "movementEvents".
  - Include at least one derivation step with operation "Move" or "InternalMerge".
  - In explanation, describe movement as occurring in this analysis.
- If hasMovement is false:
  - Return "movementEvents": [].
  - Do not include derivation steps with operation "Move" or "InternalMerge".
  - In explanation, state that no movement is posited in this analysis.
- Do not hedge between alternatives inside one analysis. Avoid wording like "or", "may be", "can be", "possibly" for movement status.

For "tree":
- Every node MUST include a unique "id" string.
- Do NOT use bare string leaves; represent every terminal as an object with id/label (and optional word).
- "children" MUST contain full node objects, never node-id references like "n3" / "n4".
- For X-bar outputs, keep explicit head/preterminal labels for overt words (e.g., D -> "the", N -> "farmer", V -> "eat").
- For null heads, keep explicit category projections (e.g., D -> "∅", C -> "∅", Infl -> "∅"); do not place bare "∅" directly under X' or XP.
- Do not attach overt words directly under X' or XP nodes.
- In each analysis, every overt token from the input sentence MUST appear as a terminal word in the tree.
- Do not replace overt tokens with abstract feature-only leaves (for example "-s", "[Pres]", "PST") or traces.

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
const modelCooldownUntil = new Map();
const SYNTAX_NODE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    word: { type: 'string' },
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
  const label = typeof node.label === 'string' ? node.label.trim() : '';
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

const normalizeSyntaxTreeWithIds = (value, nodeReferences = new Map()) => {
  const nodeIds = new Set();
  const counterRef = { value: 1 };
  const tree = normalizeSyntaxNode(value, nodeIds, counterRef, {
    nodeReferences,
    resolvingIds: new Set()
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

const normalizeDerivationSteps = (value, nodeIds) => {
  if (!Array.isArray(value)) return undefined;
  const steps = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const operation = String(item.operation || '').trim();
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
        featureChecking: normalizeFeatureChecking(item.featureChecking, nodeIds),
        note: typeof item.note === 'string' ? item.note : undefined
      };
    })
    .filter(Boolean);

  return steps.length > 0 ? steps : undefined;
};

const normalizeMovementEvents = (value, nodeIds) => {
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
      const stepIndex = Number.isInteger(stepIndexRaw) && stepIndexRaw >= 0 ? stepIndexRaw : undefined;
      const operation = String(item.operation || '').trim();

      return {
        operation: operation || undefined,
        fromNodeId,
        toNodeId,
        traceNodeId: traceNodeId && nodeIds.has(traceNodeId) ? traceNodeId : undefined,
        stepIndex,
        note: typeof item.note === 'string' ? item.note : undefined
      };
    })
    .filter(Boolean);

  return events.length > 0 ? events : undefined;
};

const normalizeParseResult = (value) => {
  const parsed = value;
  if (!parsed || typeof parsed !== 'object') {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed parse result from model.', 502);
  }

  const explanation = typeof parsed.explanation === 'string' && parsed.explanation.trim()
    ? parsed.explanation
    : 'No explanation provided.';

  const nodeReferences = collectNodeReferencesById(parsed);
  const { tree, nodeIds } = normalizeSyntaxTreeWithIds(parsed.tree, nodeReferences);

  return {
    tree,
    explanation,
    partsOfSpeech: normalizePartsOfSpeech(parsed.partsOfSpeech),
    bracketedNotation: typeof parsed.bracketedNotation === 'string' ? parsed.bracketedNotation : undefined,
    interpretation: typeof parsed.interpretation === 'string' ? parsed.interpretation : undefined,
    derivationSteps: normalizeDerivationSteps(parsed.derivationSteps, nodeIds),
    movementEvents: normalizeMovementEvents(parsed.movementEvents, nodeIds)
  };
};

const normalizeParseBundle = (value) => {
  const parsed = value;
  const analysesSource = Array.isArray(parsed?.analyses)
    ? parsed.analyses
    : parsed
      ? [parsed]
      : [];

  const analyses = analysesSource
    .map((analysis) => normalizeParseResult(analysis))
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

export const parseSentenceWithGemini = async (sentence, framework = 'xbar', modelRoute = 'flash-lite') => {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new ParseApiError('API_KEY_MISSING', 'Gemini API key is not configured on the server.', 500);
  }

  const ai = new GoogleGenAI({ apiKey });
  const normalizedModelRoute = modelRoute === 'pro' ? 'pro' : 'flash-lite';
  const systemInstruction = (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) + '\n\n' + BASE_INSTRUCTION;
  const contents =
    `Analyze the sentence: "${sentence}" and return a complete syntactic tree analysis using ` +
    `${framework === 'xbar' ? 'X-Bar Theory' : 'The Minimalist Program (Bare Phrase Structure)'} in the specified JSON format. ` +
    `Return the complete analysis in one pass.`;
  const preferredModel = normalizedModelRoute === 'pro' ? FALLBACK_MODEL : PRIMARY_MODEL;
  const secondaryModel = normalizedModelRoute === 'pro' ? PRIMARY_MODEL : FALLBACK_MODEL;
  const baseModelCandidates = Array.from(
    new Set(
      [preferredModel, secondaryModel]
        .map((model) => String(model || '').trim())
        .filter(Boolean)
    )
  );
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
            'The canopy is noisy right now. I tried both model routes. Please plant your sentence again in a moment.',
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
            candidateNormalized = normalizeParseBundle(payload);
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
            'The canopy is noisy right now. I tried both model routes. Please plant your sentence again in a moment.',
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
      const triedBoth = attemptedModels.length > 1;
      throw new ParseApiError(
        'GEMINI_UNAVAILABLE',
        triedBoth
          ? 'The canopy is noisy right now. I tried both model routes. Please plant your sentence again in a moment.'
          : 'The canopy is noisy right now. Please plant your sentence again in a moment.',
        503
      );
    }

    if (isNetworkTransportError(error)) {
      const triedBoth = attemptedModels.length > 1;
      throw new ParseApiError(
        'GEMINI_UNAVAILABLE',
        triedBoth
          ? 'The canopy is noisy right now. I tried both model routes. Please plant your sentence again in a moment.'
          : 'The canopy is noisy right now. Please plant your sentence again in a moment.',
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
