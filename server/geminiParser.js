import { GoogleGenAI } from '@google/genai';

const EXPLANATION_INSTRUCTION = `In the explanation, justify major choices in framework terms, not language-specific heuristics.
Write a developed natural paragraph (roughly 4-7 sentences): substantial enough to sound like a compact research note, not a compressed checklist.
Prefer academically natural prose over symbolic shorthand.
Name only the selected framework in the explanation. If the requested analysis is X-bar, do not describe it as Minimalist or Minimalism; if the requested analysis is Minimalist, do not describe it as X-bar Theory.
You may include 1-2 theory-flavored framing sentences about typology, clause type, or major structural treatment, and you may include at most one brief reference to a well-known analytical tradition or scholar, but only when that framing is directly supported by the chosen tree and derivation.
Make the explanation read the derivation you encoded: explain how the actual clause architecture, movement path, and major derivational operations produce the observed surface order.
When the derivation is non-trivial, say what major structural choice this analysis makes and how that choice follows from the committed tree and derivation.
If movement is encoded in the analysis, say explicitly that the relevant phrase or head moves (or undergoes Internal Merge / head movement) from a lower position; do not describe a derived position as if it were only externally merged there.
If you mention a scholar or analytical tradition, give a complete name or complete reference phrase; do not leave scholar references truncated or reduced to an isolated initial.
Do not introduce extra movements, landing sites, heads, complements, adjuncts, or alternative analyses that are not part of the selected analysis.`;

const XBAR_INSTRUCTION = `You are a world-class syntactician specializing in Generative syntax, with a focus on X-bar Theory and Government and Binding Theory.

Parse natural language sentences by deriving structure from framework principles, not memorized templates.
Use theoretical notions such as projection, headedness, selection, argument/adjunct distinction, locality, and null elements only when justified.
Assume endocentric phrase structure: every XP or X' must be projected from a head X, and the category of the projection must come from that head.

Output conventions:
- Use X-bar style constituent structure.
- Use labels consistently.
- Use InflP (not TP) for compatibility with this project.
- For finite clause-level parses, use CP as the root projection (unless the input is clearly a non-clausal fragment).
- If clear syntactic ambiguity exists, return two analyses; otherwise return one.
- For overt lexical items, keep full X-bar projections explicit (e.g., DP -> D' -> D -> "the", VP -> V' -> V -> "eat").
- Do not attach overt words directly under X' or XP nodes.
- Keep X-bar structure endocentric: every phrasal projection must be headed by a matching lexical or functional head.

${EXPLANATION_INSTRUCTION}`;

const MINIMALISM_INSTRUCTION = `You are a world-class syntactician specializing in Generative syntax, with a focus on the Minimalist Program and Bare Phrase Structure.

Parse natural language sentences by deriving structure through Merge, Internal Merge, Agree/feature valuation, and locality/phase constraints, not memorized templates.
Use derivational reasoning to justify each major structural choice.

Output conventions:
- Use Bare Phrase Structure style labels (no bar-level prime notation).
- Represent movement with copies/traces where needed.
- Use labels consistently.
- If clear syntactic ambiguity exists, return two analyses; otherwise return one.

${EXPLANATION_INSTRUCTION}`;

const BASE_INSTRUCTION = `Output MUST be a single valid JSON object with an "analyses" array containing one or two analyses.

Each analysis must include:
- "tree"
- "explanation"
- "movementDecision"

Each analysis may also include:
- "partsOfSpeech"
- "bracketedNotation"
- "interpretation"
- "derivationSteps"
- "movementEvents"

General rules:
- Return one analysis unless there is clear structural ambiguity.
- The tree must be the final pronounced structure.
- Every node must have a unique "id".
- Use full node objects in "children"; never node-id references.
- Use the field "word" for overt or null terminal surface forms. Do not use alternate fields such as "value".
- "word" is a field name, not a category label. Do not return nodes whose literal label is "word".
- Every overt terminal leaf should include "tokenIndex", pointing to its exact position in the input sentence token list.
- Every overt input token must appear in the tree exactly as pronounced and in the same left-to-right order as the sentence.
- Do not split, rewrite, translate, or duplicate overt tokens unless the token appears multiple times in the sentence.
- When tokenIndex is used, each overt token index must be used exactly once, and overt children must appear in ascending tokenIndex/surfaceSpan order.
- Do not attach overt words directly under X' or XP nodes.
- If a node is phrasal (XP or X'), it must realize structure through children, not through a word field.
- Keep phrase structure endocentric: if a node is phrasal, its category must be projected from a matching head inside that phrase, not treated as an unheaded word-bearing shell.
- Do not attach overt words directly to phrasal labels such as DP, NP, VP, TP, InflP, or CP. Overt words must appear on head/preterminal nodes beneath those phrases.
- If you include a silent/null terminal anywhere in the analysis, represent it only as "∅".
- If you explicitly commit to a case assignment on a DP or argument phrase, you may annotate that node with optional fields "case", "assigner", "caseEvidence", and "caseOvert". Omit these fields if the analysis is not explicitly committing to case there.
- Keep lower copy notation consistent within a tree. Use one coherent lower-copy style across the analysis, including phrasal and head movement.
- If you use trace labels, use only canonical trace forms such as "t", "trace", "t_1", or "trace_DP". Do not use hyphenated trace forms.
- Do not introduce helper position labels (for example labels beginning with "Spec") as separate structural nodes. Represent the phrase itself in the tree.
- If a head is overt in a higher functional position, realize it there as a single overt head. Do not stack extra overt head labels such as C > V > word merely to preserve its source category.
- At the landing site of head movement, use exactly one overt head label above the pronounced word. Do not return unary chains of overt head labels with the same overt yield.
- If a head lands in C, Infl, or another higher head position, that landing head should directly dominate the overt word. Do not wrap the overt word in an extra overt source-category head beneath the landing site.
- Every overt lexical item must be visibly headed exactly once: either place the overt word on a head node itself, or let a single head node directly dominate that overt word as its only overt child.
- Every overt lexical item must appear on a terminal/head node, never directly on a phrasal projection.
- Do not make one head node directly dominate both an overt word and a trace/null/copy sibling. If a lower head copy is needed, encode it in a distinct lower head position.

For movement:
- First decide movement and encode it in "movementDecision.hasMovement" (true/false).
- "movementDecision.rationale" must be one short sentence that commits to the chosen derivation.
- For every apparent dependency, choose exactly one analysis: direct merge or movement. Do not leave that choice undecided in the final output.
- If movementDecision.hasMovement is true:
  - Include at least one movement event in "movementEvents".
  - Include at least one derivation step with operation "Move", "InternalMerge", or "HeadMove".
  - In the explanation, describe movement as occurring in this analysis.
- If movementDecision.hasMovement is false:
  - Return "movementEvents": [].
  - Do not include derivation steps with operation "Move", "InternalMerge", or "HeadMove".
  - In the explanation, state that no movement is posited in this analysis.
- If movement is part of the analysis, encode it consistently in the tree with traces/copies/null sites that match the committed movement story.
- Keep only the pronounced copy overt and render the lower occurrence as a trace, copy, or null element.
- Use "HeadMove" only for head movement and "Move" only for phrasal movement.
- For phrasal movement, the lower source/trace must be a lower copy of the moved phrase, not merely a head trace inside that phrase.
- Do not split one overt moved phrase across an overt C/head node plus a separate DP/NP/PP phrase shell. If a phrase moves to the clause edge, keep all overt words of that phrase inside that single moved phrase node.
- For head movement, the lower source/trace must be a lower head or head-copy of the moved head, not a whole phrase containing that head.
- If the final tree places an overt head in a higher functional head position (such as C, T, or Infl) and the corresponding lower head position is silent, this must be encoded as a HeadMove with an explicit lower head source. Do not leave higher-overt/lower-silent head configurations undercommitted.
- Do not reuse one lower node as the source for both a phrasal Move and a HeadMove unless the analysis explicitly represents both dependencies there.
- In "movementEvents", use exactly these keys: "operation", "fromNodeId", "toNodeId", optional "traceNodeId", optional "stepIndex", optional "note". Do not use alternate keys such as "type", "source", "target", or "trace".
- Do not describe movement in the explanation unless it is encoded in the analysis.
- Do not return undercommitted hybrids such as: a fronted phrase plus a lower null/trace/copy but no explicit movement commitment; or an overt higher head plus a lower null counterpart but no explicit head-movement commitment.

For derivationSteps:
- Include derivationSteps only when they help make the chosen analysis explicit.
- Keep them lightweight.
- Prefer only: "operation", "targetNodeId", "sourceNodeIds", optional "trigger", optional "chainId", optional "spelloutDomain", optional "featureChecking", and optional "note".
- If a short reason for the step is clear from the analysis, you may add "trigger" with values like "wh", "focus", "EPP", "agreement", "case", "tense", or "spellout".
- If multiple steps belong to one dependency, you may reuse a short "chainId" such as "ch1".
- For SpellOut steps, you may add "spelloutDomain" when the committed analysis explicitly treats the transfer domain as important.
- When case, agreement, EPP, wh/focus licensing, or other syntactic feature relations are central to the committed analysis, encode them in "featureChecking" on the relevant derivation step rather than leaving them only in the prose.
- Use "Agree" as a derivational operation only when agreement or valuation is itself part of the committed analysis.
- Do not invent extra labels, recipes, or workspace metadata unless they are genuinely needed.

For featureChecking:
- Use it for explicit feature-licensing commitments such as case, phi/agreement, EPP, wh/focus licensing, tense/aspect checking, or other feature valuation relations that are part of the selected analysis.
- When you explicitly claim a case assignment in the explanation, prefer to encode the same commitment in featureChecking and/or on the relevant DP node.
- Each featureChecking entry may include: "feature", optional "value", optional "status", optional "probeNodeId", optional "goalNodeId", optional "probeLabel", optional "goalLabel", and optional "note".

The "bracketedNotation" field should contain a Labeled Bracketing string compatible with Miles Shang's syntax tree generator.`;

const LITE_FORMAT_INSTRUCTION = `Flash Lite format discipline:
- Return analyses[].nodes plus optional rootId as the only structural format. Do not return a nested tree.
- Treat parentId, siblingOrder, and overt tokenIndex as the primary structural commitments for linear order.
- Every node, including the root, must include siblingOrder to state its left-to-right position among siblings.
- Every overt terminal leaf must include tokenIndex.
- Only overt terminal leaves may include tokenIndex.
- Sister nodes with overt descendants must realize disjoint, non-interleaving token intervals. Do not place one sibling so its overt tokens fall inside the overt interval of a sister node.
- If a bar-level or binary shell would force a subject/specifier to surface between the overt descendants of another sibling, do not use that shell. Instead, encode the locally ordered head, subject/specifier, and complement material directly as siblings of the phrasal node with explicit siblingOrder so the committed structure itself spells the sentence correctly.
- In head-initial structures, do not bury the overt head and its complement together under one shell if the subject surfaces between them. Encode the head, subject/specifier, and complement sequence directly in the local sibling order.
- Keep overt headedness local and explicit. If a node is the overt realization of a head, let that head node carry the overt word itself or directly dominate that overt word as its sole overt child; do not place an overt word and a lower trace/null sibling under the same head node.
- The literal label "word" is not an allowed category label in the node table. Use the field "word" for surface forms and keep structural labels as actual categories or terminal surfaces.
- If you are unsure about a phrasal surfaceSpan, omit it rather than guessing. Babel will derive spans from the committed overt token indices.
- The final node table must already imply the correct sentence order through parent relations plus overt tokenIndex commitments.`;

const SERIALIZER_SYSTEM_INSTRUCTION = `You are a syntax-tree serializer for Babel.
Rewrite the provided draft tree into Babel's exact canonical tree schema without changing the chosen syntactic analysis.

Preserve:
- the same sentence and overt token inventory
- the same number of analyses
- the same hierarchy and constituent relations
- the same movement commitments
- the same overt/null distinction

You may only normalize serialization details, such as:
- adding missing node labels when the draft already makes the category clear
- converting terminal surface fields to "word"
- ensuring children are node objects
- ensuring ids are consistent
- ensuring silent terminals use exactly "∅"
- reordering child arrays when necessary so the same committed overt terminals are realized in the exact pronounced sentence order

Your job is canonical tree serialization, not new analysis. You may reorder child arrays only to make the existing overt terminals realize the same pronounced sentence in the correct left-to-right order, while preserving the same dominance relations and movement commitments.

Do not invent new movement, delete committed movement, change direct merge into movement, change movement into direct merge, change the overt token inventory, or replace the draft with a different analysis.

Output only the canonical JSON object.`;

const PRIMARY_MODEL = String(process.env.GEMINI_MODEL || '').trim() || 'gemini-3.1-flash-lite-preview';
const FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || '').trim() || 'gemini-3.1-pro-preview';
const PRO_RETRY_MAX_ATTEMPTS = Math.max(1, Number(process.env.GEMINI_RETRY_MAX_ATTEMPTS || 2));
const BAD_MODEL_RETRY_MAX_ATTEMPTS = Math.max(1, Number(process.env.GEMINI_BAD_MODEL_RETRY_MAX_ATTEMPTS || 1));
const PRO_RETRY_BASE_DELAY_MS = Math.max(100, Number(process.env.GEMINI_RETRY_BASE_DELAY_MS || 600));
const PRO_RETRY_MAX_DELAY_MS = Math.max(PRO_RETRY_BASE_DELAY_MS, Number(process.env.GEMINI_RETRY_MAX_DELAY_MS || 2200));
const MODEL_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 16384);
const MODEL_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_TEMPERATURE))
  ? Number(process.env.GEMINI_TEMPERATURE)
  : 0;
const MODEL_CALL_TIMEOUT_RAW = String(process.env.GEMINI_MODEL_TIMEOUT_MS || '').trim();
const MODEL_CALL_TIMEOUT_MS = MODEL_CALL_TIMEOUT_RAW ? Number(MODEL_CALL_TIMEOUT_RAW) : NaN;
// Default to no hard cutoff. Set env vars to enforce explicit timeouts if needed.
const PRIMARY_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_PRIMARY_TIMEOUT_MS || 0));
const FALLBACK_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_FALLBACK_TIMEOUT_MS || 0));
const PRO_ROUTE_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_PRO_ROUTE_TIMEOUT_MS || 0));
const MODEL_COOLDOWN_MS = Math.max(0, Number(process.env.GEMINI_MODEL_COOLDOWN_MS || 45000));
// Default to unlimited request budget. Set GEMINI_REQUEST_BUDGET_MS to enforce a cap.
const REQUEST_BUDGET_MS = Math.max(0, Number(process.env.GEMINI_REQUEST_BUDGET_MS || 0));
const PRO_ROUTE_REQUEST_BUDGET_MS = Math.max(0, Number(process.env.GEMINI_PRO_REQUEST_BUDGET_MS || 0));
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
  'i', 'infl', "infl'", 'inflp', 'ip',
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
const MOVEMENT_INDEX_SUBSCRIPT_MAP = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  'ᵢ': 'i', 'ⱼ': 'j', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm',
  'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't'
};
const modelCooldownUntil = new Map();
const SYNTAX_NODE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    word: { type: 'string' },
    case: { type: 'string' },
    assigner: { type: 'string' },
    caseEvidence: { type: 'string' },
    caseOvert: { type: 'boolean' },
    tokenIndex: { type: 'integer', minimum: 0 },
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
const FLAT_SYNTAX_NODE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    word: { type: 'string' },
    case: { type: 'string' },
    assigner: { type: 'string' },
    caseEvidence: { type: 'string' },
    caseOvert: { type: 'boolean' },
    tokenIndex: { type: 'integer', minimum: 0 },
    siblingOrder: { type: 'integer', minimum: 0 },
    surfaceSpan: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'integer', minimum: 0 }
    },
    parentId: { type: 'string' }
  },
  required: ['id', 'label', 'siblingOrder'],
  additionalProperties: false
};
const MOVEMENT_EVENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    operation: { type: 'string' },
    fromNodeId: { type: 'string' },
    toNodeId: { type: 'string' },
    traceNodeId: { type: 'string' },
    stepIndex: { type: 'integer', minimum: 0 },
    note: { type: 'string' }
  },
  required: ['operation', 'fromNodeId', 'toNodeId'],
  additionalProperties: false
};
const ANALYSIS_JSON_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        tree: { $ref: '#/$defs/syntaxNode' },
        explanation: { type: 'string' },
        movementDecision: {
          type: 'object',
          properties: {
            hasMovement: { type: 'boolean' },
            rationale: { type: 'string' }
          },
          required: ['hasMovement', 'rationale']
        },
        surfaceOrder: { type: 'array', items: { type: 'string' } },
        partsOfSpeech: { type: 'array', items: { type: 'object' } },
        bracketedNotation: { type: 'string' },
        interpretation: { type: 'string' },
        derivationSteps: { type: 'array', items: { type: 'object' } },
        movementEvents: { type: 'array', items: MOVEMENT_EVENT_JSON_SCHEMA }
      },
      required: ['tree', 'explanation', 'movementDecision']
    },
    {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/flatSyntaxNode' }
        },
        rootId: { type: 'string' },
        explanation: { type: 'string' },
        movementDecision: {
          type: 'object',
          properties: {
            hasMovement: { type: 'boolean' },
            rationale: { type: 'string' }
          },
          required: ['hasMovement', 'rationale']
        },
        surfaceOrder: { type: 'array', items: { type: 'string' } },
        partsOfSpeech: { type: 'array', items: { type: 'object' } },
        bracketedNotation: { type: 'string' },
        interpretation: { type: 'string' },
        derivationSteps: { type: 'array', items: { type: 'object' } },
        movementEvents: { type: 'array', items: MOVEMENT_EVENT_JSON_SCHEMA }
      },
      required: ['nodes', 'explanation', 'movementDecision']
    }
  ]
};
const FLAT_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    nodes: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/flatSyntaxNode' }
    },
    rootId: { type: 'string' },
    explanation: { type: 'string' },
    movementDecision: {
      type: 'object',
      properties: {
        hasMovement: { type: 'boolean' },
        rationale: { type: 'string' }
      },
      required: ['hasMovement', 'rationale']
    },
    surfaceOrder: { type: 'array', items: { type: 'string' } },
    partsOfSpeech: { type: 'array', items: { type: 'object' } },
    bracketedNotation: { type: 'string' },
    interpretation: { type: 'string' },
    derivationSteps: { type: 'array', items: { type: 'object' } },
    movementEvents: { type: 'array', items: MOVEMENT_EVENT_JSON_SCHEMA }
  },
  required: ['nodes', 'explanation', 'movementDecision'],
  additionalProperties: false
};
const PARSE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  $defs: {
    syntaxNode: SYNTAX_NODE_JSON_SCHEMA,
    flatSyntaxNode: FLAT_SYNTAX_NODE_JSON_SCHEMA
  },
  properties: {
    analyses: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: ANALYSIS_JSON_SCHEMA
    },
    ambiguityNote: { type: 'string' }
  },
  required: ['analyses']
};
const LITE_PARSE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  $defs: {
    flatSyntaxNode: FLAT_SYNTAX_NODE_JSON_SCHEMA
  },
  properties: {
    analyses: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: FLAT_ANALYSIS_JSON_SCHEMA
    },
    ambiguityNote: { type: 'string' }
  },
  required: ['analyses']
};

const parseResponseJsonSchemaForRoute = (modelRoute = 'flash-lite') =>
  modelRoute === 'pro' ? PARSE_RESPONSE_JSON_SCHEMA : LITE_PARSE_RESPONSE_JSON_SCHEMA;

const TREE_SERIALIZER_RESPONSE_JSON_SCHEMA = {
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
          tree: { $ref: '#/$defs/syntaxNode' }
        },
        required: ['tree'],
        additionalProperties: false
      }
    }
  },
  required: ['analyses'],
  additionalProperties: false
};

export class ParseApiError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = 'ParseApiError';
    this.code = code;
    this.status = status;
    this.details = details;
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

const resolveModelTimeoutMs = (model, modelRoute = 'flash-lite') => {
  if (modelRoute === 'pro' && PRO_ROUTE_TIMEOUT_MS > 0) {
    return PRO_ROUTE_TIMEOUT_MS;
  }
  if (modelRoute === 'pro' && !(Number.isFinite(MODEL_CALL_TIMEOUT_MS) && MODEL_CALL_TIMEOUT_MS > 0)) {
    return 0;
  }
  if (Number.isFinite(MODEL_CALL_TIMEOUT_MS) && MODEL_CALL_TIMEOUT_MS > 0) {
    return MODEL_CALL_TIMEOUT_MS;
  }
  return model === PRIMARY_MODEL ? PRIMARY_MODEL_TIMEOUT_MS : FALLBACK_MODEL_TIMEOUT_MS;
};

const getRemainingRequestBudgetMs = (requestStartedAt, modelRoute = 'flash-lite') => {
  if (modelRoute === 'pro' && PRO_ROUTE_REQUEST_BUDGET_MS > 0) {
    return Math.max(0, PRO_ROUTE_REQUEST_BUDGET_MS - (Date.now() - requestStartedAt));
  }
  if (modelRoute === 'pro') {
    return Number.POSITIVE_INFINITY;
  }
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
  let label = String(rawLabel || '').trim();
  label = label.replace(/^([A-Za-z]+)_bar$/i, "$1'");
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

const isPhrasalLabel = (label) => {
  const raw = String(label || '').trim();
  if (!raw) return false;
  if (PRIME_CATEGORY_LABEL_RE.test(raw)) return true;
  return /p$/i.test(raw);
};

const inferLexicalChildTemplateForPhrase = (label) => {
  const raw = String(label || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return null;
  if (lower === 'dp') {
    return ['NP', 'N'];
  }
  if (lower === 'np') return ['N'];
  if (lower === 'vp') return ['V'];
  if (lower === 'tp') return ['T'];
  if (lower === 'ip') return ['I'];
  if (lower === 'inflp') return ['Infl'];
  if (lower === 'cp') return ['C'];
  if (lower === 'pp') return ['P'];
  if (lower === 'ap') return ['A'];
  if (lower === 'advp') return ['Adv'];
  return null;
};

const materializeLexicalPhrasalLeaves = (tree) => {
  if (!tree || typeof tree !== 'object') return tree;

  const existingIds = new Set();
  const collectIds = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id || '').trim();
    if (id) existingIds.add(id);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(collectIds);
  };
  collectIds(tree);
  const counterRef = { value: existingIds.size + 1 };

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);

    if (children.length > 0) return;
    if (!isPhrasalLabel(node.label)) return;

    const word = String(node.word || '').trim();
    if (!word || isTraceLikeSurface(word) || NULL_LIKE_SURFACE_RE.test(word)) return;

    const lexicalTemplate = inferLexicalChildTemplateForPhrase(node.label);
    if (!lexicalTemplate || lexicalTemplate.length === 0) return;

    const makeLexicalChain = (labels) => {
      if (labels.length === 0) return null;
      const [headLabel, ...rest] = labels;
      const childId = nextGeneratedNodeId(existingIds, counterRef);
      const childNode = { id: childId, label: headLabel };
      if (rest.length === 0) {
        childNode.word = word;
        if (node.tokenIndex !== undefined) childNode.tokenIndex = node.tokenIndex;
        if (Array.isArray(node.surfaceSpan)) childNode.surfaceSpan = [...node.surfaceSpan];
        return childNode;
      }
      childNode.children = [makeLexicalChain(rest)];
      if (Array.isArray(node.surfaceSpan)) childNode.surfaceSpan = [...node.surfaceSpan];
      return childNode;
    };

    delete node.word;
    delete node.tokenIndex;
    node.children = [makeLexicalChain(lexicalTemplate)];
  };

  visit(tree);
  return tree;
};

const normalizeTokenIndex = (value, sentenceLength) => {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) return undefined;
  if (Number.isInteger(sentenceLength) && sentenceLength >= 0 && index >= sentenceLength) return undefined;
  return index;
};

const normalizeOptionalMetadataText = (value) => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
};

const normalizeOptionalMetadataBoolean = (value) =>
  typeof value === 'boolean' ? value : undefined;

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
  const explicitWord = typeof node.word === 'string' && node.word.trim()
    ? node.word.trim()
    : typeof node.value === 'string' && node.value.trim()
      ? node.value.trim()
      : '';
  const rawNodeLabel = typeof node.label === 'string' && node.label.trim()
    ? node.label.trim()
    : '';
  const rawLabel = rawNodeLabel
    ? (/^word$/i.test(rawNodeLabel) && explicitWord ? explicitWord : rawNodeLabel)
    : explicitWord;
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
  const caseValue = normalizeOptionalMetadataText(node.case);
  const assigner = normalizeOptionalMetadataText(node.assigner);
  const caseEvidence = normalizeOptionalMetadataText(node.caseEvidence);
  const caseOvert = normalizeOptionalMetadataBoolean(node.caseOvert);
  if (caseValue) normalized.case = caseValue;
  if (assigner) normalized.assigner = assigner;
  if (caseEvidence) normalized.caseEvidence = caseEvidence;
  if (caseOvert !== undefined) normalized.caseOvert = caseOvert;
  const surfaceSpan = normalizeSurfaceSpan(node.surfaceSpan);
  if (surfaceSpan) {
    normalized.surfaceSpan = surfaceSpan;
  }
  const tokenIndex = normalizeTokenIndex(node.tokenIndex, context?.sentenceTokens?.length);
  if (tokenIndex !== undefined) {
    normalized.tokenIndex = tokenIndex;
  }
  const terminalWord = explicitWord;
  const rawChildren = Array.isArray(node.children)
    ? node.children.map((child) => normalizeSyntaxNode(child, usedIds, counterRef, context))
    : [];
  const children = canonicalizeBareNullHeadChildren(label, rawChildren, usedIds, counterRef);

  if (children.length > 0) {
    normalized.children = children;
  } else if (terminalWord) {
    normalized.word = terminalWord;
  }

  return normalized;
};

const normalizeSyntaxTreeWithIds = (value, nodeReferences = new Map(), framework = 'xbar', sentenceTokens = []) => {
  const nodeIds = new Set();
  const counterRef = { value: 1 };
  const tree = normalizeSyntaxNode(value, nodeIds, counterRef, {
    nodeReferences,
    resolvingIds: new Set(),
    framework,
    sentenceTokens
  });
  return { tree, nodeIds };
};

const compileFlatNodeTableToTree = (nodesValue, rootIdValue, framework = 'xbar', sentenceTokens = []) => {
  if (!Array.isArray(nodesValue) || nodesValue.length === 0) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Flat node table must contain at least one node.', 502);
  }

  const nodesById = new Map();
  const childrenByParent = new Map();
  const normalizedSentenceTokens = sentenceTokens.map(normalizeSurfaceToken).filter(Boolean);
  const tokenPositionsBySurface = new Map();

  normalizedSentenceTokens.forEach((token, index) => {
    const positions = tokenPositionsBySurface.get(token) || [];
    positions.push(index);
    tokenPositionsBySurface.set(token, positions);
  });

  nodesValue.forEach((rawNode, index) => {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed flat node record from model.', 502);
    }

    const rawId = typeof rawNode.id === 'string' ? rawNode.id.trim() : '';
    if (!rawId) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Every flat node must include a non-empty id.', 502);
    }
    if (nodesById.has(rawId)) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', `Duplicate flat node id: ${rawId}.`, 502);
    }

    const explicitWordValue =
      typeof rawNode.word === 'string' && rawNode.word.trim()
        ? rawNode.word.trim()
        : typeof rawNode.value === 'string' && rawNode.value.trim()
          ? rawNode.value.trim()
          : '';
    const rawNodeLabel = typeof rawNode.label === 'string' && rawNode.label.trim()
      ? rawNode.label.trim()
      : '';
    const rawLabel = rawNodeLabel
      ? (/^word$/i.test(rawNodeLabel) && explicitWordValue ? explicitWordValue : rawNodeLabel)
      : explicitWordValue;
    const label = normalizeLabelForFramework(rawLabel, framework);
    if (!label) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node ${rawId} is missing a usable label.`, 502);
    }

    const structuralProfile = getLabelProfile(label);
    const word =
      explicitWordValue
        ? explicitWordValue
        : label
          && !structuralProfile.isPhrasal
          && !structuralProfile.isHeadLikeStructural
          && !isTraceLikeSurface(label)
          && !NULL_LIKE_SURFACE_RE.test(label)
            ? label
            : undefined;
    const explicitTokenIndex = normalizeTokenIndex(rawNode.tokenIndex, sentenceTokens.length);
    const normalizedWordSurface = normalizeSurfaceToken(word);
    const inferredTokenIndex =
      explicitTokenIndex === undefined &&
      normalizedWordSurface &&
      !isTraceLikeSurface(word) &&
      !NULL_LIKE_SURFACE_RE.test(String(word || '').trim())
        ? (() => {
            const positions = tokenPositionsBySurface.get(normalizedWordSurface) || [];
            return positions.length === 1 ? positions[0] : undefined;
          })()
        : undefined;
    const tokenIndex = explicitTokenIndex ?? inferredTokenIndex;
    const surfaceSpan = normalizeSurfaceSpan(rawNode.surfaceSpan);
    const parentId = typeof rawNode.parentId === 'string' && rawNode.parentId.trim()
      ? rawNode.parentId.trim()
      : undefined;
    const caseValue = normalizeOptionalMetadataText(rawNode.case);
    const assigner = normalizeOptionalMetadataText(rawNode.assigner);
    const caseEvidence = normalizeOptionalMetadataText(rawNode.caseEvidence);
    const caseOvert = normalizeOptionalMetadataBoolean(rawNode.caseOvert);
    const siblingOrder = Number.isInteger(Number(rawNode.siblingOrder))
      ? Math.max(0, Number(rawNode.siblingOrder))
      : undefined;

    nodesById.set(rawId, {
      id: rawId,
      label,
      word,
      tokenIndex,
      siblingOrder,
      surfaceSpan,
      parentId,
      case: caseValue,
      assigner,
      caseEvidence,
      caseOvert,
      __order: index
    });
  });

  const getNodeInterval = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node.surfaceSpan)) return node.surfaceSpan;
    if (node.tokenIndex !== undefined) return [node.tokenIndex, node.tokenIndex];
    return null;
  };

  const intervalContains = (parentInterval, childInterval) => {
    if (!Array.isArray(parentInterval) || !Array.isArray(childInterval)) return false;
    if (parentInterval[0] > childInterval[0] || parentInterval[1] < childInterval[1]) return false;
    return true;
  };

  const explicitRootId = typeof rootIdValue === 'string' && rootIdValue.trim() ? rootIdValue.trim() : '';

  for (const node of nodesById.values()) {
    if (node.parentId) continue;
    if (explicitRootId && node.id === explicitRootId) continue;

    const nodeInterval = getNodeInterval(node);
    if (!nodeInterval) continue;

    const candidates = Array.from(nodesById.values())
      .filter((candidate) => {
        if (!candidate || candidate.id === node.id) return false;
        const candidateInterval = getNodeInterval(candidate);
        if (!intervalContains(candidateInterval, nodeInterval)) return false;
        return candidate.__order < node.__order;
      })
      .sort((left, right) => {
        const leftInterval = getNodeInterval(left);
        const rightInterval = getNodeInterval(right);
        const leftWidth = leftInterval ? (leftInterval[1] - leftInterval[0]) : Number.POSITIVE_INFINITY;
        const rightWidth = rightInterval ? (rightInterval[1] - rightInterval[0]) : Number.POSITIVE_INFINITY;
        if (leftWidth !== rightWidth) return leftWidth - rightWidth;
        return right.__order - left.__order;
      });

    if (candidates.length > 0) {
      node.parentId = candidates[0].id;
    }
  }

  for (const node of nodesById.values()) {
    if (node.parentId) {
      if (!nodesById.has(node.parentId)) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node ${node.id} points to missing parentId ${node.parentId}.`, 502);
      }
      const siblings = childrenByParent.get(node.parentId) || [];
      siblings.push(node.id);
      childrenByParent.set(node.parentId, siblings);
    }
  }

  let rootId = explicitRootId;
  if (rootId) {
    if (!nodesById.has(rootId)) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node rootId ${rootId} does not exist.`, 502);
    }
  } else {
    const rootCandidates = Array.from(nodesById.values()).filter((node) => !node.parentId);
    if (rootCandidates.length !== 1) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Flat node table must determine exactly one root node.', 502);
    }
    rootId = rootCandidates[0].id;
  }

  const visiting = new Set();
  const built = new Map();

  const buildNode = (nodeId) => {
    if (built.has(nodeId)) return built.get(nodeId);
    if (visiting.has(nodeId)) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node table contains a cycle at ${nodeId}.`, 502);
    }
    visiting.add(nodeId);
    const node = nodesById.get(nodeId);
    const childIds = childrenByParent.get(nodeId) || [];
    const childEntries = childIds.map((childId) => buildNode(childId));
    const sortedChildren = childEntries
      .slice()
      .sort((left, right) => {
        const leftSiblingOrder = left.siblingOrder;
        const rightSiblingOrder = right.siblingOrder;
        if (Number.isInteger(leftSiblingOrder) || Number.isInteger(rightSiblingOrder)) {
          if (!Number.isInteger(leftSiblingOrder)) return 1;
          if (!Number.isInteger(rightSiblingOrder)) return -1;
          if (leftSiblingOrder !== rightSiblingOrder) return leftSiblingOrder - rightSiblingOrder;
        }
        const leftStart = left.sortStart;
        const rightStart = right.sortStart;
        if (leftStart === rightStart) return left.order - right.order;
        if (leftStart === null) return 1;
        if (rightStart === null) return -1;
        return leftStart - rightStart;
      });

    const compiled = { id: node.id, label: node.label };
    if (typeof node.word === 'string' && node.word.trim()) {
      compiled.word = node.word.trim();
    }
    if (node.tokenIndex !== undefined) {
      compiled.tokenIndex = node.tokenIndex;
    }
    if (node.surfaceSpan) {
      compiled.surfaceSpan = node.surfaceSpan;
    }
    if (node.case) {
      compiled.case = node.case;
    }
    if (node.assigner) {
      compiled.assigner = node.assigner;
    }
    if (node.caseEvidence) {
      compiled.caseEvidence = node.caseEvidence;
    }
    if (node.caseOvert !== undefined) {
      compiled.caseOvert = node.caseOvert;
    }
    if (sortedChildren.length > 0) {
      compiled.children = sortedChildren.map((entry) => entry.node);
    }

    let sortStart = null;
    if (node.tokenIndex !== undefined) {
      sortStart = node.tokenIndex;
    } else {
      for (const child of sortedChildren) {
        if (Number.isInteger(child.sortStart)) {
          sortStart = child.sortStart;
          break;
        }
      }
      if (sortStart === null && node.surfaceSpan) {
        sortStart = node.surfaceSpan[0];
      }
    }

    const entry = {
      node: compiled,
      sortStart,
      order: node.__order,
      siblingOrder: node.siblingOrder
    };
    built.set(nodeId, entry);
    visiting.delete(nodeId);
    return entry;
  };

  const rootEntry = buildNode(rootId);
  return alignCompiledTreeToSentence(rootEntry.node, sentenceTokens);
};

const alignCompiledTreeToSentence = (tree, sentenceTokens = []) => {
  const normalizedSentenceTokens = sentenceTokens.map(normalizeSurfaceToken).filter(Boolean);

  const permutationsOf = (items) => {
    if (items.length <= 1) return [items];
    const out = [];
    items.forEach((item, index) => {
      const rest = items.slice(0, index).concat(items.slice(index + 1));
      permutationsOf(rest).forEach((suffix) => out.push([item, ...suffix]));
    });
    return out;
  };

  const explicitOrder = (children) =>
    children
      .slice()
      .sort((left, right) => {
        const leftOrder = Number.isInteger(left?.siblingOrder) ? left.siblingOrder : undefined;
        const rightOrder = Number.isInteger(right?.siblingOrder) ? right.siblingOrder : undefined;
        if (leftOrder === undefined && rightOrder === undefined) return 0;
        if (leftOrder === undefined) return 1;
        if (rightOrder === undefined) return -1;
        return leftOrder - rightOrder;
      });

  const tokenBounds = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Number.isInteger(node.tokenIndex)) {
      return [node.tokenIndex, node.tokenIndex];
    }
    const children = Array.isArray(node.children) ? node.children : [];
    let start = null;
    let end = null;
    children.forEach((child) => {
      const bounds = tokenBounds(child);
      if (!bounds) return;
      start = start === null ? bounds[0] : Math.min(start, bounds[0]);
      end = end === null ? bounds[1] : Math.max(end, bounds[1]);
    });
    return start === null || end === null ? null : [start, end];
  };

  const flattenHeadInitialShells = (node) => {
    if (!node || typeof node !== 'object') return node;
    const children = Array.isArray(node.children)
      ? node.children.map((child) => flattenHeadInitialShells(child))
      : [];
    if (children.length === 0) return node;

    let flattenedChildren = children;
    if (children.length === 2) {
      const [specifierChild, shellChild] = children;
      const shellChildren = Array.isArray(shellChild?.children) ? shellChild.children : [];
      if (shellChildren.length === 2) {
        const [headChild, complementChild] = shellChildren;
        const specifierBounds = tokenBounds(specifierChild);
        const headBounds = tokenBounds(headChild);
        const complementBounds = tokenBounds(complementChild);
        const headProfile = getLabelProfile(headChild?.label);
        if (
          headProfile.isHeadLikeStructural &&
          specifierBounds &&
          headBounds &&
          complementBounds &&
          headBounds[0] < specifierBounds[0] &&
          specifierBounds[1] < complementBounds[0]
        ) {
          flattenedChildren = [headChild, specifierChild, complementChild];
        }
      }
    }

    return { ...node, children: flattenedChildren };
  };

  const flattenInterleavingChildren = (node) => {
    if (!node || typeof node !== 'object') return node;
    let children = Array.isArray(node.children)
      ? node.children.map((child) => flattenInterleavingChildren(child))
      : [];
    if (children.length <= 1) return { ...node, children };

    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        const childBounds = tokenBounds(child);
        const grandChildren = Array.isArray(child?.children) ? child.children : [];
        if (!childBounds || grandChildren.length === 0) continue;

        const containsSibling = children.some((sibling, siblingIndex) => {
          if (siblingIndex === index) return false;
          const siblingBounds = tokenBounds(sibling);
          if (!siblingBounds) return false;
          return childBounds[0] < siblingBounds[0] && siblingBounds[1] < childBounds[1];
        });

        if (!containsSibling) continue;

        children = [
          ...children.slice(0, index),
          ...grandChildren,
          ...children.slice(index + 1)
        ];
        changed = true;
        break;
      }
    }

    return { ...node, children };
  };

  const preparedTree = flattenInterleavingChildren(flattenHeadInitialShells(tree));

  const alignNode = (node, startIndex) => {
    if (!node || typeof node !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during flat-node sentence alignment.', 502);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      if (!surface || isTraceLikeNode(node) || isNullLikeNode(node)) {
        const silentLeaf = { ...node };
        delete silentLeaf.tokenIndex;
        delete silentLeaf.surfaceSpan;
        return { success: true, node: silentLeaf, nextIndex: startIndex, overtCount: 0 };
      }

      if (startIndex >= normalizedSentenceTokens.length || normalizedSentenceTokens[startIndex] !== surface) {
        return { success: false };
      }

      const overtLeaf = {
        ...node,
        word: String(sentenceTokens[startIndex] || resolveOvertLeafSurface(node) || '').trim(),
        tokenIndex: startIndex,
        surfaceSpan: [startIndex, startIndex]
      };
      return { success: true, node: overtLeaf, nextIndex: startIndex + 1, overtCount: 1 };
    }

    const orderedChildren = explicitOrder(children);
    const candidateOrders = [orderedChildren];
    const seenOrders = new Set([
      orderedChildren.map((child) => String(child?.id || '')).join('|')
    ]);

    const tryCandidate = (candidate) => {
      let nextIndex = startIndex;
      let overtCount = 0;
      const builtChildren = [];

      for (const child of candidate) {
        const alignedChild = alignNode(child, nextIndex);
        if (!alignedChild.success) {
          return null;
        }
        nextIndex = alignedChild.nextIndex;
        overtCount += alignedChild.overtCount;
        builtChildren.push(alignedChild.node);
      }

      const alignedNode = { ...node, children: builtChildren };
      if (overtCount > 0) {
        alignedNode.surfaceSpan = [startIndex, nextIndex - 1];
      } else {
        delete alignedNode.surfaceSpan;
      }
      return { success: true, node: alignedNode, nextIndex, overtCount };
    };

    for (const candidate of candidateOrders) {
      const alignedCandidate = tryCandidate(candidate);
      if (alignedCandidate) return alignedCandidate;
    }

    for (const candidate of permutationsOf(children)) {
      const key = candidate.map((child) => String(child?.id || '')).join('|');
      if (seenOrders.has(key)) continue;
      seenOrders.add(key);
      const alignedCandidate = tryCandidate(candidate);
      if (alignedCandidate) return alignedCandidate;
    }

    return { success: false };
  };

  const aligned = alignNode(preparedTree, 0);
  if (!aligned.success || aligned.nextIndex !== normalizedSentenceTokens.length) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Tree overt terminals do not match the input sentence order.', 502);
  }
  return aligned.node;
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

const sameTokenSequence = (leftTokens, rightTokens) => {
  if (leftTokens.length !== rightTokens.length) return false;
  for (let index = 0; index < leftTokens.length; index += 1) {
    if (normalizeSurfaceToken(leftTokens[index]) !== normalizeSurfaceToken(rightTokens[index])) {
      return false;
    }
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

const canonicalizeTreeToTraversalOrder = (tree) => {
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

      node.surfaceSpan = [startIndex, startIndex];
      return { node, nextIndex: startIndex + 1, overtCount: 1 };
    }

    let nextIndex = startIndex;
    let overtCount = 0;
    node.children = children.map((child) => {
      if (!subtreeHasOvertYield(child)) {
        return canonicalizeNullSubtree(child);
      }

      const alignedChild = alignNode(child, nextIndex);
      nextIndex = alignedChild.nextIndex;
      overtCount += alignedChild.overtCount;
      return alignedChild.node;
    });

    if (overtCount === 0) {
      delete node.surfaceSpan;
      return { node, nextIndex: startIndex, overtCount: 0 };
    }

    node.surfaceSpan = [startIndex, nextIndex - 1];
    return {
      node,
      nextIndex,
      overtCount
    };
  };

  const root = alignNode(tree, 0);
  if (!Number.isInteger(root.node?.surfaceSpan?.[0]) || !Number.isInteger(root.node?.surfaceSpan?.[1])) {
    delete root.node?.surfaceSpan;
  }
  return root.node;
};

const anchorOvertLeavesToSentenceTokens = (tree, sentenceTokens) => {
  const normalizedSentenceTokens = sentenceTokens.map(normalizeSurfaceToken).filter(Boolean);
  const overtLeaves = [];

  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during token anchoring.', 502);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      let surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      const traceLike = isTraceLikeNode(node);
      const nullLike = isNullLikeNode(node);
      const tokenIndex = normalizeTokenIndex(node.tokenIndex, normalizedSentenceTokens.length);
      const singletonSpan = normalizeSurfaceSpan(node.surfaceSpan);
      const spanTokenIndex = singletonSpan && singletonSpan[0] === singletonSpan[1]
        ? normalizeTokenIndex(singletonSpan[0], normalizedSentenceTokens.length)
        : undefined;
      const hintedTokenIndex = tokenIndex ?? spanTokenIndex;

      if (!surface && hintedTokenIndex !== undefined) {
        const hintedSurface = normalizedSentenceTokens[hintedTokenIndex];
        const labelSurface = normalizeSurfaceToken(String(node.label || '').trim());
        if (hintedSurface && labelSurface === hintedSurface && !traceLike && !nullLike) {
          surface = hintedSurface;
          node.word = String(sentenceTokens[hintedTokenIndex] || '').trim();
        }
      }

      if (tokenIndex !== undefined) {
        if (traceLike || nullLike) {
          delete node.tokenIndex;
        } else {
          const expectedToken = normalizedSentenceTokens[tokenIndex];
          if (!expectedToken) {
            throw new ParseApiError('BAD_MODEL_RESPONSE', 'Overt tokenIndex falls outside the sentence token inventory.', 502);
          }
          if (surface && surface !== expectedToken) {
            throw new ParseApiError('BAD_MODEL_RESPONSE', 'Leaf tokenIndex does not match the overt sentence token it claims to realize.', 502);
          }
          node.tokenIndex = tokenIndex;
          node.word = String(sentenceTokens[tokenIndex] || '').trim();
          overtLeaves.push(node);
          return;
        }
      }

      delete node.tokenIndex;
      if (surface && !traceLike && !nullLike) {
        overtLeaves.push(node);
      }
      return;
    }

    children.forEach(visit);
  };

  visit(tree);

  const traversalOrder = overtLeaves
    .map((node) => normalizeSurfaceToken(resolveOvertLeafSurface(node)))
    .filter(Boolean);
  if (!sameTokenSequence(traversalOrder, normalizedSentenceTokens)) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Tree overt terminals do not match the input sentence order.', 502);
  }

  // Once the tree itself spells the sentence correctly, derive canonical token
  // anchoring from that committed left-to-right order rather than treating
  // partial/sloppy tokenIndex metadata as a second competing truth source.
  overtLeaves.forEach((node, index) => {
    node.tokenIndex = index;
    node.word = String(sentenceTokens[index] || '').trim();
  });
};

const deriveCanonicalSurfaceSpans = (tree) => {
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during surface-span normalization.', 502);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      const overt = Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node);
      if (!overt) {
        delete node.surfaceSpan;
        return null;
      }

      const tokenIndex = normalizeTokenIndex(node.tokenIndex, Number.POSITIVE_INFINITY);
      if (tokenIndex === undefined) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Overt leaves must carry tokenIndex after sentence anchoring.', 502);
      }
      node.surfaceSpan = [tokenIndex, tokenIndex];
      return node.surfaceSpan;
    }

    const childSpans = [];
    children.forEach((child) => {
      const childSpan = visit(child);
      if (childSpan) childSpans.push(childSpan);
    });

    if (childSpans.length === 0) {
      delete node.surfaceSpan;
      return null;
    }

    for (let index = 1; index < childSpans.length; index += 1) {
      if (childSpans[index - 1][0] > childSpans[index][0]) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Children arrays do not follow ascending surface-span order.', 502);
      }
    }

    node.surfaceSpan = [childSpans[0][0], childSpans[childSpans.length - 1][1]];
    return node.surfaceSpan;
  };

  visit(tree);
  return tree;
};

const getLabelProfile = (label) => {
  const raw = String(label || '').trim();
  const withoutPrime = raw.replace(/[’']+$/g, '');
  const lower = withoutPrime.toLowerCase();
  const isPrime = PRIME_CATEGORY_LABEL_RE.test(raw);
  const isPhrasal = Boolean(withoutPrime) && (isPrime || /p$/i.test(withoutPrime));
  const base = isPhrasal && lower.endsWith('p') ? lower.slice(0, -1) : lower;
  const structural = STRUCTURAL_LEAF_LABELS.has(raw.toLowerCase());
  return {
    raw,
    base,
    isPhrasal,
    isHeadLikeStructural: structural && !isPhrasal
  };
};

const collectCollapsedHeadLandingLeaf = (node) => {
  if (!node || typeof node !== 'object') return null;
  const profile = getLabelProfile(node.label);
  if (!profile.isHeadLikeStructural) return null;

  const removed = [node];
  let current = node;

  while (current && typeof current === 'object') {
    const children = Array.isArray(current.children) ? current.children : [];
    if (children.length === 0) {
      const surface = String(resolveOvertLeafSurface(current) || '').trim();
      if (!surface || isTraceLikeNode(current) || isNullLikeNode(current)) return null;
      return {
        surface,
        keptLeafId: String(current.id || '').trim(),
        removed
      };
    }
    if (children.length !== 1) return null;
    const child = children[0];
    if (!child || typeof child !== 'object') return null;
    removed.push(child);

    const childChildren = Array.isArray(child.children) ? child.children : [];
    if (childChildren.length === 0) {
      const surface = String(resolveOvertLeafSurface(child) || '').trim();
      if (!surface || isTraceLikeNode(child) || isNullLikeNode(child)) return null;
      return {
        surface,
        keptLeafId: String(child.id || '').trim(),
        removed
      };
    }

    const childProfile = getLabelProfile(child.label);
    if (!childProfile.isHeadLikeStructural) return null;
    current = child;
  }

  return null;
};

const collapseOvertHeadLandingChains = (tree) => {
  const redirects = new Map();

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);

    const profile = getLabelProfile(node.label);
    if (!profile.isHeadLikeStructural) return;
    if (children.length !== 1) return;

    const child = children[0];
    const collapsed = collectCollapsedHeadLandingLeaf(child);
    if (!collapsed) return;

    const surface = String(collapsed.surface || '').trim();
    if (!surface) return;
    if (normalizeMovementLabelKey(getNodeOvertYield(node)) !== normalizeMovementLabelKey(surface)) return;

    const directLeafId = collapsed.keptLeafId || `${String(node.id || 'node').trim() || 'node'}__lex`;
    node.children = [{ id: directLeafId, label: surface, word: surface }];
    delete node.word;
    delete node.surfaceSpan;

    const parentId = String(node.id || '').trim();
    collapsed.removed.forEach((removedNode) => {
      const removedId = String(removedNode?.id || '').trim();
      if (!removedId || !parentId || removedId === parentId || removedId === directLeafId) return;
      redirects.set(removedId, parentId);
    });
  };

  visit(tree);
  return redirects;
};

const baseHeadLabelForProjection = (label) => {
  const raw = String(label || '').trim();
  if (!raw) return '';
  if (/^(.+?)(?:'|_bar)$/i.test(raw)) {
    return raw.replace(/(?:'|_bar)$/i, '');
  }
  const lower = raw.toLowerCase();
  if (lower === 'inflp') return 'Infl';
  if (lower === 'ip') return 'I';
  if (lower === 'tp') return 'T';
  if (lower === 'vp') return 'V';
  if (lower === 'cp') return 'C';
  if (lower === 'pp') return 'P';
  if (lower === 'dp') return 'D';
  if (lower === 'np') return 'N';
  if (lower === 'ap') return 'A';
  if (lower === 'advp') return 'Adv';
  return '';
};

const collectExistingNodeIds = (tree) => {
  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id || '').trim();
    if (id) ids.add(id);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(tree);
  return ids;
};

const canonicalizeHeadMoveSourceShells = (tree, movementEvents) => {
  if (!tree || !Array.isArray(movementEvents) || movementEvents.length === 0) return [];

  const nodeById = buildNodeIndexFromTree(tree);
  const parentById = buildParentIndexFromTree(tree);
  const usedIds = collectExistingNodeIds(tree);
  const counterRef = { value: usedIds.size + 1 };
  const remappedEvents = movementEvents.map((event) => ({ ...event }));

  const nextId = () => nextGeneratedNodeId(usedIds, counterRef);

  remappedEvents.forEach((event) => {
    if (normalizeMovementOperation(event?.operation) !== 'HeadMove') return;
    const fromNodeId = String(event?.fromNodeId || '').trim();
    const toNodeId = String(event?.toNodeId || '').trim();
    const explicitTraceId = String(event?.traceNodeId || '').trim();
    if (!fromNodeId || !toNodeId) return;
    if (explicitTraceId && nodeById.has(explicitTraceId)) return;

    const fromNode = nodeById.get(fromNodeId);
    const toNode = nodeById.get(toNodeId);
    if (!fromNode || !toNode) return;

    const fromProfile = getLabelProfile(fromNode.label);
    if (!fromProfile.isPhrasal) return;

    const headLabel = baseHeadLabelForProjection(fromNode.label) || baseHeadLabelForProjection(toNode.label);
    if (!headLabel) return;

    const children = Array.isArray(fromNode.children) ? fromNode.children : [];
    const existingHeadChild = children.find((child) => normalizeMovementLabelKey(child?.label) === normalizeMovementLabelKey(headLabel));
    if (existingHeadChild) {
      const directNullSource =
        (isTraceLikeNode(existingHeadChild) || isNullLikeNode(existingHeadChild))
          ? existingHeadChild
          : null;
      const descendantNullSource = directNullSource
        ? null
        : collectLeafNodes(existingHeadChild).find((child) => isTraceLikeNode(child) || isNullLikeNode(child));
      const groundedSource = directNullSource || descendantNullSource;
      if (groundedSource?.id) {
        event.fromNodeId = String(groundedSource.id);
        event.traceNodeId = String(groundedSource.id);
        return;
      }
    }

    const nullLeafId = nextId();
    const headId = nextId();
    const nullLeaf = {
      id: nullLeafId,
      label: '∅',
      word: '∅'
    };
    const lowerHead = {
      id: headId,
      label: headLabel,
      children: [nullLeaf]
    };

    fromNode.children = [lowerHead, ...children];
    event.fromNodeId = nullLeafId;
    event.traceNodeId = nullLeafId;

    nodeById.set(headId, lowerHead);
    nodeById.set(nullLeafId, nullLeaf);
    parentById.set(headId, fromNode.id);
    parentById.set(nullLeafId, headId);
  });

  return remappedEvents;
};

const getNodeTokenBounds = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (Number.isInteger(node.tokenIndex)) {
    return [node.tokenIndex, node.tokenIndex];
  }
  const span = normalizeSurfaceSpan(node.surfaceSpan);
  if (span) return span;
  const children = Array.isArray(node.children) ? node.children : [];
  let start = null;
  let end = null;
  children.forEach((child) => {
    const bounds = getNodeTokenBounds(child);
    if (!bounds) return;
    start = start === null ? bounds[0] : Math.min(start, bounds[0]);
    end = end === null ? bounds[1] : Math.max(end, bounds[1]);
  });
  return start === null || end === null ? null : [start, end];
};

const findSingleOvertLeafForSplitFronting = (node) => {
  if (!node || typeof node !== 'object') return null;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length !== 1) return null;
  const child = children[0];
  if (!child || typeof child !== 'object') return null;
  const grandChildren = Array.isArray(child.children) ? child.children : [];
  if (grandChildren.length === 0) {
    const surface = String(resolveOvertLeafSurface(child) || '').trim();
    if (!surface || isTraceLikeNode(child) || isNullLikeNode(child)) return null;
    return { carrier: node, leaf: child };
  }
  if (grandChildren.length === 1) {
    const grandChild = grandChildren[0];
    const greatGrandChildren = Array.isArray(grandChild?.children) ? grandChild.children : [];
    if (greatGrandChildren.length === 0) {
      const surface = String(resolveOvertLeafSurface(grandChild) || '').trim();
      if (!surface || isTraceLikeNode(grandChild) || isNullLikeNode(grandChild)) return null;
      return { carrier: child, leaf: grandChild };
    }
  }
  return null;
};

const findEmptyHeadSlotForSplitFronting = (node) => {
  if (!node || typeof node !== 'object') return null;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const profile = getLabelProfile(child?.label);
    if (!profile.isHeadLikeStructural) continue;
    const grandChildren = Array.isArray(child?.children) ? child.children : [];
    if (grandChildren.length === 1 && isNullLikeNode(grandChildren[0])) {
      return { carrier: child, placeholder: grandChildren[0] };
    }
  }
  return null;
};

const canonicalizeSplitClauseEdgeMovedPhrases = (tree, movementEvents) => {
  if (!tree || typeof tree !== 'object' || !Array.isArray(movementEvents) || movementEvents.length === 0) {
    return tree;
  }

  const moveTargetIds = new Set(
    movementEvents
      .filter((event) => normalizeMovementOperation(event?.operation) === 'Move')
      .map((event) => String(event?.toNodeId || '').trim())
      .filter(Boolean)
  );
  if (moveTargetIds.size === 0) return tree;

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);

    const nodeProfile = getLabelProfile(node.label);
    if (nodeProfile.base !== 'c') return;
    if (children.length < 2) return;

    for (let index = 1; index < children.length; index += 1) {
      const targetNode = children[index];
      const leftSibling = children[index - 1];
      const targetId = String(targetNode?.id || '').trim();
      if (!targetId || !moveTargetIds.has(targetId)) continue;

      const leftProfile = getLabelProfile(leftSibling?.label);
      if (leftProfile.base !== 'c' || !leftProfile.isHeadLikeStructural) continue;

      const overtLeafEntry = findSingleOvertLeafForSplitFronting(leftSibling);
      const emptyHeadSlot = findEmptyHeadSlotForSplitFronting(targetNode);
      if (!overtLeafEntry || !emptyHeadSlot) continue;

      const leftBounds = getNodeTokenBounds(overtLeafEntry.leaf);
      const targetBounds = getNodeTokenBounds(targetNode);
      if (!leftBounds || !targetBounds) continue;
      if (leftBounds[0] !== leftBounds[1]) continue;
      if (targetBounds[0] !== targetBounds[1]) continue;
      if (leftBounds[0] + 1 !== targetBounds[0]) continue;

      const overtLeaf = overtLeafEntry.leaf;
      const placeholder = emptyHeadSlot.placeholder;
      emptyHeadSlot.carrier.children = [overtLeaf];
      overtLeafEntry.carrier.children = [placeholder];

      delete overtLeaf.tokenIndex;
      delete overtLeaf.surfaceSpan;
      delete placeholder.tokenIndex;
      delete placeholder.surfaceSpan;
      delete emptyHeadSlot.carrier.surfaceSpan;
      delete leftSibling.surfaceSpan;
      delete targetNode.surfaceSpan;
    }
  };

  visit(tree);
  return tree;
};

const resolveRedirectedNodeId = (nodeId, redirects) => {
  let current = String(nodeId || '').trim();
  const seen = new Set();
  while (current && redirects?.has(current) && !seen.has(current)) {
    seen.add(current);
    current = String(redirects.get(current) || '').trim();
  }
  return current;
};

const remapDerivationStepsNodeIds = (steps, redirects) => {
  if (!Array.isArray(steps) || steps.length === 0 || !(redirects instanceof Map) || redirects.size === 0) {
    return steps;
  }

  return steps.map((step) => {
    const targetNodeId = resolveRedirectedNodeId(step?.targetNodeId, redirects);
    const sourceNodeIds = Array.isArray(step?.sourceNodeIds)
      ? Array.from(new Set(step.sourceNodeIds
          .map((id) => resolveRedirectedNodeId(id, redirects))
          .filter(Boolean)))
      : step?.sourceNodeIds;
    const featureChecking = Array.isArray(step?.featureChecking)
      ? step.featureChecking.map((item) => ({
          ...item,
          probeNodeId: resolveRedirectedNodeId(item?.probeNodeId, redirects) || item?.probeNodeId,
          goalNodeId: resolveRedirectedNodeId(item?.goalNodeId, redirects) || item?.goalNodeId
        }))
      : step?.featureChecking;

    return {
      ...step,
      targetNodeId: targetNodeId || undefined,
      sourceNodeIds,
      featureChecking
    };
  });
};

const remapMovementEventsNodeIds = (events, redirects) => {
  if (!Array.isArray(events) || events.length === 0 || !(redirects instanceof Map) || redirects.size === 0) {
    return events;
  }

  return events.map((event) => ({
    ...event,
    fromNodeId: resolveRedirectedNodeId(event?.fromNodeId, redirects) || event?.fromNodeId,
    toNodeId: resolveRedirectedNodeId(event?.toNodeId, redirects) || event?.toNodeId,
    traceNodeId: resolveRedirectedNodeId(event?.traceNodeId, redirects) || event?.traceNodeId
  }));
};

const validateAndCommitSurfaceOrder = (_surfaceOrder, tree, sentence) => {
  const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
  anchorOvertLeavesToSentenceTokens(tree, sentenceTokens);
  const canonicalTree = deriveCanonicalSurfaceSpans(tree);
  const surfaceOrder = collectOvertTerminalNodes(canonicalTree)
    .map((node) => resolveNodeSurface(node))
    .map((token) => String(token || '').trim())
    .filter(Boolean);

  return {
    tree: canonicalTree,
    surfaceOrder: surfaceOrder.length > 0 ? surfaceOrder : sentenceTokens
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

const normalizeOptionalStepText = (value) => {
  const text = String(value || '').trim();
  return text || undefined;
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

const normalizeIndexedText = (value) =>
  [...String(value || '').trim()].map((ch) => MOVEMENT_INDEX_SUBSCRIPT_MAP[ch] || ch).join('');

const extractMovementIndex = (value) => {
  const text = normalizeIndexedText(value);
  if (!text) return null;
  const braced = text.match(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
  if (braced?.[1]) return braced[1].toLowerCase();
  const bareBraced = text.match(/(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
  if (bareBraced?.[1]) return bareBraced[1].toLowerCase();
  const postBracket = text.match(/[\]\)\}]([a-z]\d?|\d{1,2})$/i);
  if (postBracket?.[1]) return postBracket[1].toLowerCase();
  const plain = text.match(/_([A-Za-z0-9]+)$/);
  if (plain?.[1]) return plain[1].toLowerCase();
  const danglingSubscript = text.match(/([A-Za-z0-9]+)$/);
  return danglingSubscript?.[1] && /[₀-₉ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜ]/.test(String(value || ''))
    ? danglingSubscript[1].toLowerCase()
    : null;
};

const stripMovementIndex = (value) => {
  const text = normalizeIndexedText(value);
  if (!text) return '';
  return text
    .replace(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/, '')
    .replace(/(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/, '')
    .replace(/([\]\)\}])([a-z]\d?|\d{1,2})$/i, '$1')
    .replace(/_([A-Za-z0-9]+)$/, '')
    .trim();
};

const normalizeDerivationSteps = (value, nodeIds) => {
  if (!Array.isArray(value)) return undefined;
  const steps = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const operation = normalizeDerivationOperation(item.operation);
      if (!operation) return null;
      return {
        stepId: normalizeOptionalStepText(item.stepId),
        operation,
        trigger: normalizeOptionalStepText(item.trigger),
        chainId: normalizeOptionalStepText(item.chainId),
        spelloutDomain: normalizeOptionalStepText(item.spelloutDomain),
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

const assignDerivationStepIds = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) return steps;

  const seen = new Set();
  return steps.map((step, index) => {
    const preferred = normalizeOptionalStepText(step?.stepId);
    const stepId = preferred && !seen.has(preferred) ? preferred : `s${index + 1}`;
    seen.add(stepId);
    return {
      ...step,
      stepId
    };
  });
};


const MOVE_LIKE_OPERATION_RE = /^(move|internal[\s-]*merge|head[\s-]*move|a[\s-]*move|a(?:bar)?[\s-]*move)$/i;

const isMoveLikeOperation = (operation) => MOVE_LIKE_OPERATION_RE.test(String(operation || '').trim());

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

const normalizeMovementDecision = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.hasMovement !== 'boolean') return undefined;
  const rationale = cleanExplanationWhitespace(String(value.rationale || ''));
  return {
    hasMovement: value.hasMovement,
    rationale: rationale || (value.hasMovement
      ? 'Movement is posited in this analysis.'
      : 'No movement is posited in this analysis.')
  };
};

const reconcileMovementDecisionWithCommittedAnalysis = (movementDecision, movementEvents) => {
  const hasEncodedMovement = Array.isArray(movementEvents) && movementEvents.length > 0;
  if (!movementDecision) {
    return {
      hasMovement: hasEncodedMovement,
      rationale: hasEncodedMovement
        ? 'The final committed analysis explicitly encodes movement.'
        : 'No movement is encoded in the final committed analysis.'
    };
  }

  if (movementDecision.hasMovement === hasEncodedMovement) {
    return movementDecision;
  }

  return {
    hasMovement: hasEncodedMovement,
    rationale: hasEncodedMovement
      ? 'The final committed analysis explicitly encodes movement.'
      : 'No movement is encoded in the final committed analysis.'
  };
};

const buildNodeLabelIndexFromTree = (tree) => {
  const byLabel = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id || '').trim();
    const label = String(node.label || '').trim();
    if (id && label) {
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(id);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(tree);
  return byLabel;
};

const resolveMovementNodeReference = (rawRef, nodeIds, labelIndex) => {
  const ref = String(rawRef || '').trim();
  if (!ref) return '';
  if (nodeIds.has(ref)) return ref;
  const labelMatches = labelIndex.get(ref) || [];
  if (labelMatches.length === 1) return String(labelMatches[0] || '').trim();
  return '';
};

const normalizeMovementEvents = (value, nodeIds, derivationSteps, nodeById, labelIndex) => {
  if (!Array.isArray(value)) return undefined;
  const steps = Array.isArray(derivationSteps) ? derivationSteps : [];

  const events = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const operation = normalizeMovementOperation(item.operation || item.type);
      const explicitSourceRef = String(item.fromNodeId || item.source || '').trim();
      const explicitTargetRef = String(item.toNodeId || item.target || '').trim();
      const explicitTraceRef = String(item.traceNodeId || item.trace || '').trim();
      let fromNodeId = resolveMovementNodeReference(explicitSourceRef, nodeIds, labelIndex);
      let toNodeId = resolveMovementNodeReference(explicitTargetRef, nodeIds, labelIndex);
      let traceNodeId = resolveMovementNodeReference(explicitTraceRef, nodeIds, labelIndex);
      const stepIndexRaw = Number(item.stepIndex);
      const hasDerivationTimeline = steps.length > 0;
      let stepIndex = Number.isInteger(stepIndexRaw) &&
        stepIndexRaw >= 0 &&
        (!hasDerivationTimeline || stepIndexRaw < steps.length)
        ? stepIndexRaw
        : undefined;

      if (stepIndex === undefined) {
        stepIndex = resolveMovementEventStepIndex({
          operation,
          fromNodeId,
          toNodeId,
          traceNodeId
        }, steps);
      }

      const alignedStep = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length
        ? steps[stepIndex]
        : undefined;

      if (!fromNodeId && Array.isArray(alignedStep?.sourceNodeIds) && alignedStep.sourceNodeIds.length === 1) {
        fromNodeId = String(alignedStep.sourceNodeIds[0] || '').trim();
      }
      if (!toNodeId && alignedStep?.targetNodeId) {
        toNodeId = String(alignedStep.targetNodeId || '').trim();
      }
      if (!traceNodeId && fromNodeId) {
        const sourceNode = nodeById.get(fromNodeId);
        if (sourceNode && (isTraceLikeNode(sourceNode) || isNullLikeNode(sourceNode))) {
          traceNodeId = fromNodeId;
        }
      }

      if (!fromNodeId || !toNodeId) return null;
      if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return null;

      return {
        operation,
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

const TRACE_LIKE_SURFACE_RE = /^(?:t|trace|t\d+|trace\d+|(?:t|trace)(?:_[a-z0-9]+)+|[a-z]+_trace(?:_[a-z0-9]+)*|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\})$/i;
const NULL_LIKE_SURFACE_RE = /^(∅|Ø|ε|null|epsilon)$/i;
const normalizeTraceLikeSurface = (surface) =>
  String(surface || '')
    .trim()
    .replace(/\{([^}]*)\}/g, '$1');

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

const isTraceLikeSurface = (surface) => {
  const raw = String(surface || '').trim();
  if (!raw) return false;
  const normalized = normalizeTraceLikeSurface(raw);
  return TRACE_LIKE_SURFACE_RE.test(raw) || TRACE_LIKE_SURFACE_RE.test(normalized);
};

const isTraceLikeNode = (node) => isTraceLikeSurface(resolveNodeSurface(node));

const isNullLikeNode = (node) => NULL_LIKE_SURFACE_RE.test(resolveNodeSurface(node));

const nodeMovementIndex = (node) =>
  extractMovementIndex(String(node?.label || '').trim()) ||
  extractMovementIndex(String(node?.word || '').trim()) ||
  null;

const isIndexedTraceOrNullNode = (node) => {
  const label = stripMovementIndex(String(node?.label || '').trim());
  const surface = stripMovementIndex(resolveNodeSurface(node));
  return isTraceLikeSurface(label) ||
    isTraceLikeSurface(surface) ||
    NULL_LIKE_SURFACE_RE.test(label) ||
    NULL_LIKE_SURFACE_RE.test(surface);
};

const hasSameIndexedAncestor = (nodeId, movementIndex, nodeById, parentById) => {
  let currentId = String(parentById.get(String(nodeId || '').trim()) || '').trim();
  while (currentId) {
    const current = nodeById.get(currentId);
    if (current && nodeMovementIndex(current) === movementIndex) return true;
    currentId = String(parentById.get(currentId) || '').trim();
  }
  return false;
};

const findIndexedTraceLeaf = (node, movementIndex) =>
  collectLeafNodes(node).find((leaf) => {
    const index = nodeMovementIndex(leaf);
    if (index && index === movementIndex && isIndexedTraceOrNullNode(leaf)) return true;
    return !index && (isTraceLikeNode(leaf) || isNullLikeNode(leaf));
  }) || null;

const deriveIndexedMovementEvents = ({ tree }) => {
  const nodeById = buildNodeIndexFromTree(tree);
  const parentById = buildParentIndexFromTree(tree);
  const grouped = new Map();

  nodeById.forEach((node, nodeId) => {
    const movementIndex = nodeMovementIndex(node);
    if (!movementIndex) return;
    const bucket = grouped.get(movementIndex) || [];
    bucket.push({ nodeId, node });
    grouped.set(movementIndex, bucket);
  });

  const derived = [];
  grouped.forEach((entries, movementIndex) => {
    const siteEntries = entries.filter(({ nodeId }) =>
      !hasSameIndexedAncestor(nodeId, movementIndex, nodeById, parentById)
    );

    const landingCandidates = siteEntries.filter(({ node }) =>
      subtreeHasOvertYield(node) && !isIndexedTraceOrNullNode(node)
    );
    const sourceCandidates = siteEntries.filter(({ node }) =>
      !subtreeHasOvertYield(node) || isIndexedTraceOrNullNode(node)
    );

    if (landingCandidates.length !== 1 || sourceCandidates.length !== 1) return;

    const landing = landingCandidates[0];
    const source = sourceCandidates[0];
    if (!landing?.nodeId || !source?.nodeId || landing.nodeId === source.nodeId) return;

    const traceLeaf = findIndexedTraceLeaf(source.node, movementIndex);
    derived.push({
      operation: 'Move',
      fromNodeId: source.nodeId,
      toNodeId: landing.nodeId,
      traceNodeId: traceLeaf ? String(traceLeaf.id || '').trim() || undefined : undefined
    });
  });

  return derived.length > 0 ? derived : undefined;
};

const TRACE_ID_RE = /^trace[_-]?(\d+)?$/i;

const deriveTraceIdMovementEvents = ({ tree }) => {
  const nodeById = buildNodeIndexFromTree(tree);
  const derived = [];

  nodeById.forEach((traceNode, traceNodeId) => {
    const match = TRACE_ID_RE.exec(traceNodeId);
    if (!match) return;
    if (subtreeHasOvertYield(traceNode)) return;

    const traceCategory = String(traceNode.label || '').trim();
    if (!traceCategory) return;

    const suffix = match[1];
    let landingNodeId = null;

    if (suffix) {
      const target = `${traceCategory}_${suffix}`.toLowerCase();
      for (const [nid, nnode] of nodeById) {
        if (nid.toLowerCase() === target && subtreeHasOvertYield(nnode)) {
          landingNodeId = nid;
          break;
        }
      }
    }

    if (!landingNodeId) {
      const candidates = [];
      nodeById.forEach((n, nid) => {
        if (nid === traceNodeId) return;
        if (String(n.label || '').trim().toLowerCase() !== traceCategory.toLowerCase()) return;
        if (!subtreeHasOvertYield(n)) return;
        candidates.push(nid);
      });
      if (candidates.length === 1) {
        landingNodeId = candidates[0];
      }
    }

    if (landingNodeId) {
      derived.push({
        operation: 'Move',
        fromNodeId: traceNodeId,
        toNodeId: landingNodeId,
        traceNodeId: traceNodeId
      });
    }
  });

  return derived.length > 0 ? derived : undefined;
};

const deriveOrphanedMovementEvents = ({ tree, priorEvents }) => {
  const nodeById = buildNodeIndexFromTree(tree);
  const claimed = new Set();
  (priorEvents || []).forEach((e) => {
    if (e.fromNodeId) claimed.add(e.fromNodeId);
    if (e.toNodeId) claimed.add(e.toNodeId);
    if (e.traceNodeId) claimed.add(e.traceNodeId);
  });

  const orphanedLandings = [];
  nodeById.forEach((node, nodeId) => {
    if (claimed.has(nodeId)) return;
    const idx = nodeMovementIndex(node);
    if (!idx) return;
    if (!subtreeHasOvertYield(node)) return;
    if (isIndexedTraceOrNullNode(node)) return;
    orphanedLandings.push({ nodeId, node, index: idx });
  });

  const orphanedTraces = [];
  nodeById.forEach((node, nodeId) => {
    if (claimed.has(nodeId)) return;
    if (nodeMovementIndex(node)) return;
    if (subtreeHasOvertYield(node)) return;
    if (!isTraceLikeNode(node) && !isNullLikeNode(node)) return;
    orphanedTraces.push({ nodeId, node });
  });

  if (orphanedLandings.length === 0 || orphanedTraces.length === 0) return undefined;

  const derived = [];
  const usedTraces = new Set();

  for (const landing of orphanedLandings) {
    let bestTrace = null;
    if (orphanedTraces.length - usedTraces.size === 1) {
      bestTrace = orphanedTraces.find((t) => !usedTraces.has(t.nodeId)) || null;
    }
    if (bestTrace) {
      derived.push({
        operation: 'Move',
        fromNodeId: bestTrace.nodeId,
        toNodeId: landing.nodeId,
        traceNodeId: bestTrace.nodeId
      });
      usedTraces.add(bestTrace.nodeId);
    }
  }

  return derived.length > 0 ? derived : undefined;
};

const stripMovementIndicesFromTree = (node) => {
  if (!node || typeof node !== 'object') return node;
  const label = String(node.label || '').trim();
  if (label) {
    const stripped = stripMovementIndex(label);
    if (stripped && stripped !== label) {
      node.label = stripped;
    }
  }
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child) => stripMovementIndicesFromTree(child));
  return node;
};

const materializeEmptyStructuralLeaves = (node, sentenceTokens) => {
  if (!node || typeof node !== 'object') return node;
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child) => materializeEmptyStructuralLeaves(child, sentenceTokens));
  if (children.length === 0) {
    const label = String(node.label || '').trim();
    const word = String(node.word || '').trim();
    if (label && !word && isStructuralLeafLabel(label)) {
      const normalizedLabel = normalizeSurfaceToken(label);
      if (normalizedLabel && sentenceTokens && sentenceTokens.has(normalizedLabel)) return node;
      node.children = [{ label: '\u2205', id: `null_${String(node.id || 'anon').trim()}` }];
    }
  }
  return node;
};

const promoteSentenceMatchingLeaves = (tree, sentenceTokenSet) => {
  if (!tree || typeof tree !== 'object' || !sentenceTokenSet) return;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      if (String(node.word || '').trim()) return;
      const label = String(node.label || '').trim();
      if (!label) return;
      const normalized = normalizeSurfaceToken(label);
      if (normalized && sentenceTokenSet.has(normalized) && isStructuralLeafLabel(label)) {
        node.word = label;
      }
      return;
    }
    children.forEach(visit);
  };
  visit(tree);
};

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

  const op = normalizeMovementOperation(event.operation) || 'Move';

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
      ? findUniqueTraceLikeLeafOutsideSubtree(parentNode, toNode, parentById)
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

  const fromProfile = getLabelProfile(fromNode.label);
  const toProfile = getLabelProfile(toNode.label);
  if (toProfile.isPhrasal && fromProfile.isHeadLikeStructural) {
    const stepTrace = getMoveLikeTraceSourceFromStep(step, nodeById, toNodeId, parentById);
    if (stepTrace) {
      const stepTraceProfile = getLabelProfile(stepTrace.label);
      if (!stepTraceProfile.isHeadLikeStructural) {
        return {
          ...event,
          operation: op,
          fromNodeId: String(stepTrace.id || '').trim(),
          traceNodeId: String(stepTrace.id || '').trim()
        };
      }
    }

    const externalTrace = findUniqueTraceLikeLeafOutsideSubtree(tree, toNode, parentById);
    if (externalTrace) {
      const traceProfile = getLabelProfile(externalTrace.label);
      if (!traceProfile.isHeadLikeStructural) {
        return {
          ...event,
          operation: op,
          fromNodeId: String(externalTrace.id || '').trim(),
          traceNodeId: String(externalTrace.id || '').trim()
        };
      }
    }

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

const isPlausibleRawMovementEvent = (event, nodeById) => {
  const fromNodeId = String(event?.fromNodeId || '').trim();
  const toNodeId = String(event?.toNodeId || '').trim();
  if (!fromNodeId || !toNodeId) return false;
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return false;
  return fromNodeId !== toNodeId;
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
  const canonical = [];
  const seen = new Set();
  const claimedLaunchSites = new Set();

  const pushEvent = (event, stepForContext) => {
    if (!event) return;
    const fromNodeId = String(event.fromNodeId || '').trim();
    const toNodeId = String(event.toNodeId || '').trim();
    if (!fromNodeId || !toNodeId) return;
    if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return;
    if (fromNodeId === toNodeId) return;
    const stepIndex = Number(event.stepIndex);
    const safeStepIndex = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length
      ? stepIndex
      : undefined;
    const explicitOperation = normalizeMovementOperation(event.operation) || 'Move';
    const traceNodeId = (() => {
      const trace = String(event.traceNodeId || '').trim();
      if (trace && nodeById.has(trace)) return trace;
      return undefined;
    })();
    const launchSiteId = traceNodeId || fromNodeId;
    if (launchSiteId && claimedLaunchSites.has(launchSiteId)) return;
    const key = `${fromNodeId}->${toNodeId}@${safeStepIndex ?? 'na'}:${explicitOperation}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (launchSiteId) claimedLaunchSites.add(launchSiteId);
    canonical.push({
      operation: explicitOperation,
      fromNodeId,
      toNodeId,
      traceNodeId,
      stepIndex: safeStepIndex,
      note: typeof event.note === 'string' ? event.note : undefined
    });
  };

  rawEvents
    .filter((event) => isPlausibleRawMovementEvent(event, nodeById))
    .forEach((event) => {
      const stepIndex = Number(event?.stepIndex);
      const step = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length
        ? steps[stepIndex]
        : undefined;
      const op = normalizeMovementOperation(event?.operation) || 'Move';
      const grounded = op === 'HeadMove'
        ? event
        : groundMovementEvent({
            event,
            step,
            tree,
            nodeById,
            parentById
          });
      pushEvent(grounded, step);
    });

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

const EXPLANATION_MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head[\s-]*move(?:ment)?|rais(?:e|es|ed|ing)|lower(?:ing|ed)|trace|copy|a-?bar|a-?move|wh-?move|front(?:ing|ed)?|displac(?:e|ed|ement|ing)|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;
const EXPLANATION_HEADMOVE_RE = /\b(head[\s-]*move(?:ment)?|v\s*-?to\s*-?[ct]|t\s*-?to\s*-?c|lower(?:ing|ed)|(?:move(?:d|s|ment)?|rais(?:e|es|ed|ing))[^.!?]{0,120}\b(?:c|t|infl|i|v)\s+head\b|\b(?:c|t|infl|i|v)\s+head\b[^.!?]{0,120}\b(?:move(?:d|s|ment)?|rais(?:e|es|ed|ing))\b)\b/i;
const EXPLANATION_SUCCESSIVE_HEADMOVE_RE = /\b(v\s*-?to\s*-?(?:infl|i|t)|verb raises? to (?:infl|i|t)|infl\s*-?to\s*-?c|(?:infl|i|t) (?:raises?|moves?) to c|finally to c|subsequently to c)\b/i;
const EXPLANATION_WHMOVE_RE = /\b(wh-?move|wh-?movement|wh-?fronting|\[\+wh\]|a-?bar|spec[, ]*cp)\b/i;
const EXPLANATION_AMOVE_RE = /\b(a-?move|a-?movement|spec(?:ifier)?[, ]*tp|epp)\b/i;
const EXPLANATION_INTERNALMERGE_RE = /\binternal\s*merge\b/i;
const EXPLANATION_NO_MOVEMENT_RE = /\b(no\s+(?:movement|displacement)|movement is not posited|no displacement operation is encoded|read directly from the final tree)\b/i;
const EXPLANATION_DENIES_VERB_MOVEMENT_RE = /\bno\s+(?:phrasal\s+)?movement\b[^.!?]{0,120}\bverb\b/i;
const MOVEMENT_OPERATION_PHRASE = {
  Move: 'movement',
  InternalMerge: 'internal merge',
  HeadMove: 'head movement',
  'A-Move': 'A-movement',
  AbarMove: 'A-bar movement',
  Other: 'movement'
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
    if (op === 'Move' || op === 'AbarMove' || op === 'A-Move' || op === 'InternalMerge') {
      kinds.add('generic');
    }
    if (op === 'AbarMove') kinds.add('wh');
    if (op === 'A-Move') kinds.add('a');
    if (op === 'InternalMerge') kinds.add('internal');
  });
  return kinds;
};

const countMovementEventsByOperation = (movementEvents, wantedOperation) =>
  Array.isArray(movementEvents)
    ? movementEvents.filter((event) => normalizeMovementOperation(event?.operation) === wantedOperation).length
    : 0;

const countPhrasalMovementEvents = (movementEvents) =>
  Array.isArray(movementEvents)
    ? movementEvents.filter((event) => normalizeMovementOperation(event?.operation) !== 'HeadMove').length
    : 0;

const isTruncatedScholarReferenceSentence = (sentence) => {
  const text = cleanExplanationWhitespace(sentence);
  if (!text) return false;
  return /\b(?:tradition|framework|approach|analysis)\s+of\s+[A-ZÀ-ÖØ-Þ]\.?(?:["')\]]|[.!?])?$/u.test(text)
    || /\b[A-ZÀ-ÖØ-Þ]\.(?:["')\]]|[.!?])?$/u.test(text);
};

const isImplementationLeakSentence = (sentence) => {
  const text = cleanExplanationWhitespace(sentence);
  if (!text) return false;
  return /\bflatten(?:ed|ing)?\b/i.test(text)
    || /\bnode-table\b/i.test(text)
    || /\bsiblingOrder\b/i.test(text)
    || /\btokenIndex\b/i.test(text)
    || /\bsurface order reflects\b/i.test(text)
    || /\bpronounced tokens\b/i.test(text)
    || /\bread directly from the final tree\b/i.test(text);
};

const isVagueScholarReferenceSentence = (sentence) => {
  const text = cleanExplanationWhitespace(sentence);
  if (!text) return false;
  return /\bsuch as\b.+\band others\b/i.test(text)
    || /\band others\b/i.test(text)
    || /\bothers\b.*\bgenerative studies\b/i.test(text);
};

const usesMergeLanguageForDerivedPeripheralPosition = (sentence, movementEvents) => {
  const text = cleanExplanationWhitespace(sentence);
  if (!text) return false;
  if (countPhrasalMovementEvents(movementEvents) === 0) return false;
  if (EXPLANATION_MOVEMENT_RE.test(text)) return false;
  return /\bmerge(?:d|s|ing)?\b/i.test(text) && /\bSpec(?:ifier)?[, ]*(?:CP|TP|InflP|IP)\b/i.test(text);
};

const isDirectlyContradictoryMovementSentence = (sentence, movementEventKinds, movementEvents) => {
  const claims = extractMovementClaimsFromSentence(sentence);
  const movementCount = Array.isArray(movementEvents) ? movementEvents.length : 0;
  const headMoveCount = countMovementEventsByOperation(movementEvents, 'HeadMove');
  const phrasalMoveCount = countPhrasalMovementEvents(movementEvents);

  if (EXPLANATION_NO_MOVEMENT_RE.test(sentence)) {
    return movementCount > 0;
  }

  if (!claims.mentionsMovement) return false;
  if (movementCount === 0) return true;
  if (headMoveCount > 0 && EXPLANATION_DENIES_VERB_MOVEMENT_RE.test(sentence)) return true;
  if (claims.claimsHeadMove && headMoveCount === 0) return true;
  if (EXPLANATION_SUCCESSIVE_HEADMOVE_RE.test(sentence) && headMoveCount < 2) return true;
  if (claims.claimsWhMove && phrasalMoveCount === 0) return true;
  if (claims.claimsAMove && phrasalMoveCount === 0) return true;
  if (claims.claimsInternalMerge && !movementEventKinds.has('internal') && phrasalMoveCount === 0) return true;
  if (usesMergeLanguageForDerivedPeripheralPosition(sentence, movementEvents)) return true;
  return false;
};

const removeUnsupportedSuccessiveHeadMoveSentences = (text, movementEvents) => {
  const groundedHeadMoves = countMovementEventsByOperation(movementEvents, 'HeadMove');
  if (groundedHeadMoves >= 2) return ensureExplanationTerminator(text);
  const kept = splitExplanationSentences(text).filter((sentence) => !EXPLANATION_SUCCESSIVE_HEADMOVE_RE.test(sentence));
  return ensureExplanationTerminator(cleanExplanationWhitespace(kept.join(' ')));
};

const resolveMovementSiteNode = (nodeById, parentById, nodeId) => {
  const rawId = String(nodeId || '').trim();
  if (!rawId) return null;
  let current = nodeById.get(rawId) || null;
  if (!current) return null;
  if (!isTraceLikeNode(current) && !isNullLikeNode(current)) {
    return current;
  }
  let currentId = rawId;
  while (currentId) {
    const parentId = String(parentById.get(currentId) || '').trim();
    if (!parentId) break;
    const parent = nodeById.get(parentId) || null;
    if (!parent) break;
    const profile = getLabelProfile(parent?.label);
    if (profile.isHeadLikeStructural || profile.isPhrasal) {
      return parent;
    }
    currentId = parentId;
  }
  return current;
};

const getMovementDisplayLabel = (node, { preserveIndex = false } = {}) => {
  const label = getNodeExplanationLabel(node, { preserveIndex });
  if (label) return label;
  const surface = String(resolveOvertLeafSurface(node) || '').trim();
  return surface || '';
};

const normalizeMovementLabelKey = (label) =>
  String(label || '')
    .trim()
    .replace(/[_\s,.-]+/g, '')
    .toLowerCase();

const resolveHeadMovementLandingNode = (node, nodeById, parentById) => {
  if (!node) return null;

  let current = node;
  let currentId = String(node.id || '').trim();
  let currentYield = getNodeOvertYield(current);

  while (currentId) {
    const parentId = String(parentById.get(currentId) || '').trim();
    if (!parentId) break;
    const parent = nodeById.get(parentId) || null;
    if (!parent) break;

    const profile = getLabelProfile(parent.label);
    if (!profile.isHeadLikeStructural) break;

    const parentYield = getNodeOvertYield(parent);
    if (!parentYield || !currentYield) break;
    if (normalizeMovementLabelKey(parentYield) !== normalizeMovementLabelKey(currentYield)) break;

    current = parent;
    currentId = parentId;
    currentYield = parentYield;
  }

  return current;
};

const buildMovedPhraseDescriptor = (node, { preserveIndex = false } = {}) => {
  if (!node) return '';
  const label = getMovementDisplayLabel(node, { preserveIndex });
  const overtYield = getNodeOvertYield(node);
  if (overtYield && overtYield.split(/\s+/).length <= 5) {
    if (label && normalizeMovementLabelKey(label) !== normalizeMovementLabelKey(overtYield)) {
      return `${label} "${overtYield}"`;
    }
    return `"${overtYield}"`;
  }
  return label;
};

const preferExplicitMovementSiteNode = (rawNode, resolvedNode, operation) => {
  if (operation === 'HeadMove') return resolvedNode || rawNode || null;
  if (rawNode) {
    const profile = getLabelProfile(rawNode?.label);
    if (profile.isPhrasal || profile.isHeadLikeStructural) {
      return rawNode;
    }
  }
  return resolvedNode || rawNode || null;
};

const buildMovementDetail = ({ event, nodeById, parentById }) => {
  const operation = normalizeMovementOperation(event?.operation) || 'Other';
  const phrase = MOVEMENT_OPERATION_PHRASE[operation] || 'movement';
  const rawSourceNode = nodeById.get(String(event?.fromNodeId || event?.traceNodeId || '').trim()) || null;
  const traceNode = nodeById.get(String(event?.traceNodeId || '').trim()) || null;
  const rawToNode = nodeById.get(String(event?.toNodeId || '').trim()) || null;
  const resolvedToNode = resolveMovementSiteNode(nodeById, parentById, event?.toNodeId) || null;
  const toNode = operation === 'HeadMove'
    ? resolveHeadMovementLandingNode(resolvedToNode, nodeById, parentById) || resolvedToNode
    : preferExplicitMovementSiteNode(rawToNode, resolvedToNode, operation);
  const note = cleanExplanationWhitespace(String(event?.note || ''));
  const resolvedSourceNode = rawSourceNode
    ? resolveMovementSiteNode(nodeById, parentById, event?.fromNodeId || event?.traceNodeId)
    : null;
  const sourceNode = preferExplicitMovementSiteNode(rawSourceNode, resolvedSourceNode, operation);

  const landingIndex = nodeMovementIndex(toNode);
  const sourceIndex = nodeMovementIndex(rawSourceNode) || nodeMovementIndex(traceNode);
  const sourceLabel = getMovementDisplayLabel(rawSourceNode, { preserveIndex: true });
  const landingLabel = getMovementDisplayLabel(toNode, { preserveIndex: true });
  const movedDescriptor = buildMovedPhraseDescriptor(toNode, { preserveIndex: true });

  if (operation === 'HeadMove') {
    const movedHeadSurface = getNodeOvertYield(toNode) || getNodeOvertYield(resolvedToNode);
    const movedHead = movedHeadSurface ? `"${movedHeadSurface}"` : buildMovedPhraseDescriptor(toNode);
    const landingHead = getMovementDisplayLabel(toNode);
    const sourceHead = getMovementDisplayLabel(sourceNode);
    const normalizedSourceHead = normalizeMovementLabelKey(sourceHead);
    const normalizedLandingHead = normalizeMovementLabelKey(landingHead);
    const directionalPhrase =
      normalizedSourceHead === 'c' && /^(?:infl|inflp|i|t)$/.test(normalizedLandingHead)
        ? 'lowering'
        : phrase;
    if (
      movedHead &&
      sourceHead &&
      landingHead &&
      normalizedSourceHead !== normalizedLandingHead
    ) {
      return `${directionalPhrase} of ${movedHead} from ${sourceHead} to ${landingHead}`;
    }
    if (movedHead && landingHead) {
      return `${directionalPhrase} of ${movedHead} to ${landingHead}`;
    }
    if (landingHead) {
      return `${directionalPhrase} to ${landingHead}`;
    }
  }

  if (toNode && landingIndex && (sourceIndex === landingIndex || isTraceLikeNode(rawSourceNode) || isNullLikeNode(rawSourceNode) || isTraceLikeNode(traceNode) || isNullLikeNode(traceNode))) {
    if (movedDescriptor) {
      return `${phrase} of ${movedDescriptor} from its lower copy`;
    }
    if (landingLabel) {
      return `${phrase} of ${landingLabel} from its lower copy`;
    }
  }

  if (
    operation === 'Move' &&
    sourceLabel &&
    landingLabel &&
    normalizeMovementLabelKey(sourceLabel) === normalizeMovementLabelKey(landingLabel)
  ) {
    if (movedDescriptor) {
      return `${phrase} of ${movedDescriptor} from its lower copy`;
    }
    return `${phrase} of ${landingLabel} from its lower copy`;
  }

  if (rawSourceNode && (isTraceLikeNode(rawSourceNode) || isNullLikeNode(rawSourceNode) || (traceNode && (isTraceLikeNode(traceNode) || isNullLikeNode(traceNode))))) {
    if (operation === 'Move' && movedDescriptor) {
      return `${phrase} of ${movedDescriptor} from its lower copy`;
    }
    const toLabel = getMovementDisplayLabel(toNode);
    if (toLabel) {
      return `${phrase} to ${toLabel}`;
    }
    if (note) {
      return `${phrase} (${note})`;
    }
    return phrase;
  }

  const fromNode = sourceNode;
  const fromLabel = getMovementDisplayLabel(fromNode);
  const toLabel = getMovementDisplayLabel(toNode);
  if (
    operation === 'Move' &&
    fromLabel &&
    toLabel &&
    normalizeMovementLabelKey(fromLabel) === normalizeMovementLabelKey(toLabel)
  ) {
    if (movedDescriptor) {
      return `${phrase} of ${movedDescriptor} from its lower copy`;
    }
    return `${phrase} of ${toLabel} from its lower copy`;
  }
  if (fromLabel && toLabel) {
    return `${phrase} from ${fromLabel} to ${toLabel}`;
  }
  if (note) {
    return `${phrase} (${note})`;
  }
  return phrase;
};

const summarizeGroundedMovement = (movementEvents, tree = null) => {
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) return '';

  const nodeById = tree ? buildNodeIndexFromTree(tree) : null;
  const parentById = tree ? buildParentIndexFromTree(tree) : null;
  const eventDetails = movementEvents
    .slice(0, 3)
    .map((event) => (nodeById && parentById ? buildMovementDetail({ event, nodeById, parentById }) : null))
    .filter(Boolean);
  if (eventDetails.length > 0) {
    return `The derivation explicitly records ${eventDetails.join('; ')}.`;
  }
  return 'The derivation explicitly records movement.';
};

const formatFeatureCheckingSummary = (item) => {
  const feature = String(item?.feature || '').trim();
  if (!feature) return '';
  const value = String(item?.value || '').trim();
  const status = String(item?.status || '').trim();
  const probe = String(item?.probeLabel || item?.probeNodeId || '').trim();
  const goal = String(item?.goalLabel || item?.goalNodeId || '').trim();

  const featureText = value ? `${feature}=${value}` : feature;
  const statusText = status ? ` (${status})` : '';

  if (probe && goal) {
    return `${featureText}${statusText} with ${probe} probing ${goal}`;
  }
  if (probe) {
    return `${featureText}${statusText} on ${probe}`;
  }
  if (goal) {
    return `${featureText}${statusText} targeting ${goal}`;
  }
  return `${featureText}${statusText}`;
};

const summarizeDerivationFacts = ({ derivationSteps }) => {
  const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
  if (steps.length === 0) return '';

  const featureEvents = [];
  steps.forEach((step) => {
    const items = Array.isArray(step?.featureChecking) ? step.featureChecking : [];
    items.forEach((item) => {
      if (featureEvents.length >= 3) return;
      const summary = formatFeatureCheckingSummary(item);
      if (summary) featureEvents.push(summary);
    });
  });
  const featureSummary = featureEvents.length > 0
    ? `The derivation also records feature valuation involving ${featureEvents.join('; ')}.`
    : '';
  return featureSummary;
};

const collectOvertYieldWords = (node, words = []) => {
  if (!node || typeof node !== 'object') return words;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    const surface = String(resolveOvertLeafSurface(node) || '').trim();
    if (surface && !isTraceLikeNode(node) && !isNullLikeNode(node)) {
      words.push(surface);
    }
    return words;
  }
  children.forEach((child) => collectOvertYieldWords(child, words));
  return words;
};

const getNodeOvertYield = (node) => collectOvertYieldWords(node, []).join(' ').trim();

const getNodeExplanationLabel = (node, { preserveIndex = false } = {}) => {
  const raw = String(node?.label || '').trim();
  if (!raw) return '';
  if (preserveIndex) return raw;
  const stripped = stripMovementIndex(raw);
  return stripped || raw;
};

const getClauseSpineInfo = (clauseNode) => {
  if (!clauseNode || typeof clauseNode !== 'object') {
    return {
      spineNode: null,
      headNode: null,
      complementNode: null
    };
  }

  const clauseChildren = Array.isArray(clauseNode.children) ? clauseNode.children : [];
  const clauseProfile = getLabelProfile(clauseNode.label);
  const sameBaseProjection = clauseChildren.find((child) => {
    const profile = getLabelProfile(child?.label);
    return profile.isPhrasal && profile.base === clauseProfile.base;
  });
  const spineNode = sameBaseProjection || clauseNode;
  const spineChildren = Array.isArray(spineNode?.children) ? spineNode.children : [];
  const headNode = spineChildren.find((child) => {
    const profile = getLabelProfile(child?.label);
    return profile.isHeadLikeStructural && ['c', 'q', 'wh'].includes(profile.base);
  }) || null;
  const complementNode = spineChildren.find((child) => {
    const profile = getLabelProfile(child?.label);
    return profile.isPhrasal && ['infl', 't', 'ip', 'v'].includes(profile.base);
  }) || null;

  return { spineNode, headNode, complementNode };
};

const findNearestOvertDescendant = (node, predicate) => {
  const queue = Array.isArray(node?.children) ? [...node.children] : [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (predicate(current) && subtreeHasOvertYield(current)) return current;
    const children = Array.isArray(current.children) ? current.children : [];
    queue.push(...children);
  }
  return null;
};

const findClauseCoreComplement = (node) =>
  findNearestOvertDescendant(node, (child) => {
    const profile = getLabelProfile(child?.label);
    return profile.isPhrasal && ['infl', 't', 'ip', 'v'].includes(profile.base);
  });

const getOvertHeadSurfaceForExplanation = (node) => {
  if (!node || typeof node !== 'object') return '';
  const directSurface = String(resolveOvertLeafSurface(node) || '').trim();
  if (directSurface && !isTraceLikeNode(node) && !isNullLikeNode(node)) {
    return directSurface;
  }
  const overtHeadDescendant = findNearestOvertDescendant(node, (child) => {
    const profile = getLabelProfile(child?.label);
    return profile.isHeadLikeStructural;
  });
  const descendantYield = getNodeOvertYield(overtHeadDescendant);
  return descendantYield || getNodeOvertYield(node);
};

const collectDescendantNodes = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child) => {
    out.push(child);
    collectDescendantNodes(child, out);
  });
  return out;
};

const getMatrixClauseNode = (tree) => {
  const rootProfile = getLabelProfile(tree?.label);
  if (rootProfile.base === 'c' && rootProfile.isPhrasal) {
    const { headNode, complementNode } = getClauseSpineInfo(tree);
    return complementNode || findClauseCoreComplement(headNode) || tree;
  }
  return tree;
};

const getFrameworkLead = (framework) =>
  framework === 'minimalism'
    ? 'On the committed Minimalist analysis'
    : 'On the committed X-bar analysis';

const labelRoleForExplanation = (profile) => {
  if (profile.base === 'q') return 'question element';
  if (profile.base === 'wh') return 'wh-element';
  if (profile.base === 'c') return 'left-peripheral head';
  if (profile.base === 'infl' || profile.base === 't' || profile.base === 'aux') return 'inflectional head';
  if (profile.base === 'v') return 'verbal head';
  if (profile.base === 'd') return 'determiner head';
  return 'head';
};

const buildClausalEdgeSentence = (tree) => {
  const rootProfile = getLabelProfile(tree?.label);
  if (!(rootProfile.base === 'c' && rootProfile.isPhrasal)) return '';

  const children = Array.isArray(tree?.children) ? tree.children : [];
  if (children.length < 2) return '';

  const leftChild = children[0];
  if (!subtreeHasOvertYield(leftChild)) return '';

  const leftProfile = getLabelProfile(leftChild?.label);
  if (!leftProfile.isPhrasal) return '';

  const leftYield = getNodeOvertYield(leftChild);
  const leftLabel = String(leftChild?.label || '').trim() || 'constituent';
  if (!leftYield) return '';

  if (leftProfile.base === 'd') {
    return `At the left edge of the ${String(tree?.label || 'CP').trim() || 'CP'}, the ${leftLabel} "${leftYield}" occupies the initial peripheral position.`;
  }

  return `At the left edge of the ${String(tree?.label || 'CP').trim() || 'CP'}, the ${leftLabel} "${leftYield}" occupies the initial peripheral position.`;
};

const buildRootArchitectureSentence = (tree, framework = 'xbar') => {
  const rootLabel = String(tree?.label || 'clause').trim() || 'clause';
  const rootProfile = getLabelProfile(rootLabel);
  const frameworkLead = getFrameworkLead(framework);
  const rootYield = getNodeOvertYield(tree);

  if (rootProfile.base === 'c' && rootProfile.isPhrasal) {
    const { headNode, complementNode } = getClauseSpineInfo(tree);
    const leftHead = headNode && subtreeHasOvertYield(headNode) ? headNode : null;
    const derivedComplement = !complementNode && leftHead ? findClauseCoreComplement(leftHead) : null;
    const complement = [complementNode, derivedComplement].find((node) => node && subtreeHasOvertYield(node)) || null;
    const headYield = getOvertHeadSurfaceForExplanation(leftHead);
    const headProfile = getLabelProfile(leftHead?.label);
    const complementLabel = getNodeExplanationLabel(complement);
    const interrogative = headProfile.base === 'q' || /[?؟]$/.test(rootYield);
    if (headYield && complementLabel) {
      const role = labelRoleForExplanation(headProfile);
      const clauseDescriptor = interrogative ? `an interrogative ${rootLabel}` : `a ${rootLabel}`;
      return `${frameworkLead}, the sentence is analyzed as ${clauseDescriptor}, with the overt ${role} "${headYield}" and a ${complementLabel} clausal core.`;
    }
    if (headYield) {
      const role = labelRoleForExplanation(headProfile);
      return `${frameworkLead}, the sentence is analyzed as a ${rootLabel} whose left periphery is overtly realized by the ${role} "${headYield}".`;
    }
    if (complementLabel) {
      return `${frameworkLead}, the sentence is analyzed as a ${rootLabel} dominating a ${complementLabel} as its finite core.`;
    }
  }

  if (rootProfile.isPhrasal) {
    return `${frameworkLead}, the clause is rooted in a ${rootLabel}.`;
  }

  return `${frameworkLead}, the committed structure is rooted in ${rootLabel}.`;
};

const buildMatrixOrganizationSentence = (tree) => {
  const clauseNode = getMatrixClauseNode(tree);

  if (!clauseNode || typeof clauseNode !== 'object') return '';

  const overtChildren = (Array.isArray(clauseNode.children) ? clauseNode.children : [])
    .filter((child) => subtreeHasOvertYield(child));
  const clauseLabel = String(clauseNode.label || '').trim() || 'clause';
  if (overtChildren.length === 0) return '';

  if (overtChildren.length === 1) {
    const onlyYield = getNodeOvertYield(overtChildren[0]);
    return onlyYield ? `Within the ${clauseLabel}, the overt material is confined to "${onlyYield}".` : '';
  }

  const leftChild = overtChildren[0];
  const leftYield = getNodeOvertYield(leftChild);
  const rightYield = overtChildren.slice(1).map(getNodeOvertYield).filter(Boolean).join(' ');
  if (!leftYield || !rightYield) return '';

  return `Within the matrix ${clauseLabel}, the left branch yields "${leftYield}", while the remaining material yields "${rightYield}".`;
};

const buildEmbeddedClauseSentence = (tree) => {
  const nodeById = buildNodeIndexFromTree(tree);
  const parentById = buildParentIndexFromTree(tree);
  const embeddedClauses = collectDescendantNodes(tree)
    .filter((node) => {
      const profile = getLabelProfile(node?.label);
      return profile.base === 'c' && profile.isPhrasal && /p$/i.test(String(node?.label || '').trim()) && subtreeHasOvertYield(node);
    });
  if (embeddedClauses.length === 0) return '';

  const embedded = embeddedClauses[0];
  const { headNode } = getClauseSpineInfo(embedded);
  const head = headNode && subtreeHasOvertYield(headNode) ? headNode : null;
  const headYield = getOvertHeadSurfaceForExplanation(head);
  const clauseYield = getNodeOvertYield(embedded);
  const embeddedLabel = getNodeExplanationLabel(embedded) || 'CP';
  const parent = nodeById.get(String(parentById.get(String(embedded?.id || '')) || ''));
  const parentProfile = getLabelProfile(parent?.label);
  if (headYield && clauseYield) {
    if (parentProfile.base === 'v') {
      return `The matrix predicate selects an embedded ${embeddedLabel} introduced by "${headYield}", yielding "${clauseYield}".`;
    }
    return `The analysis also contains an embedded ${embeddedLabel} introduced by "${headYield}", with overt yield "${clauseYield}".`;
  }
  if (clauseYield) {
    return `The analysis also contains an embedded ${embeddedLabel} with the overt yield "${clauseYield}".`;
  }
  return '';
};

const buildNoMovementSentence = () => 'No displacement operation is encoded in the derivation.';

const buildGroundedExplanation = ({ tree, derivationSteps, movementEvents, framework = 'xbar' }) => {
  const parts = [
    buildRootArchitectureSentence(tree, framework),
    buildClausalEdgeSentence(tree),
    buildMatrixOrganizationSentence(tree),
    buildEmbeddedClauseSentence(tree),
    summarizeDerivationFacts({ derivationSteps }),
    Array.isArray(movementEvents) && movementEvents.length > 0
      ? summarizeGroundedMovement(movementEvents, tree)
      : buildNoMovementSentence()
  ]
    .map((part) => ensureExplanationTerminator(part))
    .filter(Boolean);

  return ensureExplanationTerminator(parts.join(' '));
};

const explanationHasEnoughTexture = (text) => {
  const cleaned = cleanExplanationWhitespace(text);
  if (!cleaned) return false;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const sentenceCount = splitExplanationSentences(cleaned).length;
  return wordCount >= 18 || sentenceCount >= 2;
};

const explanationHasMinimumSubstance = (text) => {
  const cleaned = cleanExplanationWhitespace(text);
  if (!cleaned) return false;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const sentenceCount = splitExplanationSentences(cleaned).length;
  return wordCount >= 12 || sentenceCount >= 2;
};

const mergeExplanationWithGroundedFallback = (primaryText, fallbackText) => {
  const primarySentences = splitExplanationSentences(primaryText);
  const fallbackSentences = splitExplanationSentences(fallbackText);
  const existing = new Set(
    primarySentences.map((sentence) =>
      cleanExplanationWhitespace(sentence).toLowerCase()
    )
  );

  const merged = [...primarySentences];
  for (const sentence of fallbackSentences) {
    const key = cleanExplanationWhitespace(sentence).toLowerCase();
    if (!key || existing.has(key)) continue;
    merged.push(sentence);
    existing.add(key);
    if (explanationHasEnoughTexture(merged.join(' '))) break;
  }

  return ensureExplanationTerminator(cleanExplanationWhitespace(merged.join(' ')));
};

const sentenceHasSpecificHeadMovementDetail = (sentence) => {
  const text = cleanExplanationWhitespace(sentence);
  if (!text) return false;
  return /\blowering\b/i.test(text)
    || /"[^"]+"/.test(text)
    || /\bfrom\b[^.!?]{0,120}\bto\b/i.test(text);
};

const shouldPreferFallbackHeadMovementSentence = (modelSentence, fallbackSentence) => {
  const model = cleanExplanationWhitespace(modelSentence);
  const fallback = cleanExplanationWhitespace(fallbackSentence);
  if (!model || !fallback) return false;
  if (model.toLowerCase() === fallback.toLowerCase()) return false;
  if (/\blowering\b/i.test(fallback) && !/\blowering\b/i.test(model)) return true;
  if (/^the derivation explicitly records head movement\.?$/i.test(model) && sentenceHasSpecificHeadMovementDetail(fallback)) {
    return true;
  }
  return sentenceHasSpecificHeadMovementDetail(fallback) && !sentenceHasSpecificHeadMovementDetail(model);
};

const ensureEncodedMovementIsMentioned = (text, fallbackText, movementEvents) => {
  const rawCleaned = cleanExplanationWhitespace(text);
  if (!rawCleaned) return rawCleaned;
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) {
    return ensureExplanationTerminator(rawCleaned);
  }

  const headMoveCount = countMovementEventsByOperation(movementEvents, 'HeadMove');
  const phrasalMoveCount = countPhrasalMovementEvents(movementEvents);
  const fallbackSentences = splitExplanationSentences(fallbackText);
  const sentences = splitExplanationSentences(rawCleaned);
  const headMoveSentenceIndex = headMoveCount > 0
    ? sentences.findIndex((sentence) => EXPLANATION_HEADMOVE_RE.test(sentence))
    : -1;
  const fallbackHeadMoveSentence = headMoveCount > 0
    ? fallbackSentences.find((sentence) => EXPLANATION_HEADMOVE_RE.test(sentence))
    : null;
  if (
    headMoveSentenceIndex >= 0
    && shouldPreferFallbackHeadMovementSentence(sentences[headMoveSentenceIndex], fallbackHeadMoveSentence)
  ) {
    sentences[headMoveSentenceIndex] = fallbackHeadMoveSentence;
  }

  const cleaned = cleanExplanationWhitespace(sentences.join(' '));
  const mentionsHeadMove = sentences.some((sentence) => EXPLANATION_HEADMOVE_RE.test(sentence));
  const mentionsPhrasalMove = sentences.some((sentence) => {
    const claims = extractMovementClaimsFromSentence(sentence);
    return claims.claimsWhMove || claims.claimsAMove || claims.claimsInternalMerge
      || (claims.mentionsMovement && !claims.claimsHeadMove);
  });

  if ((headMoveCount === 0 || mentionsHeadMove) && (phrasalMoveCount === 0 || mentionsPhrasalMove)) {
    return ensureExplanationTerminator(cleaned);
  }

  const fallbackMovementSentence =
    (headMoveCount > 0 && !mentionsHeadMove
      ? fallbackSentences.find((sentence) => EXPLANATION_HEADMOVE_RE.test(sentence))
      : null)
    || (phrasalMoveCount > 0 && !mentionsPhrasalMove
      ? fallbackSentences.find((sentence) => {
          const claims = extractMovementClaimsFromSentence(sentence);
          return claims.claimsWhMove || claims.claimsAMove || claims.claimsInternalMerge
            || (claims.mentionsMovement && !claims.claimsHeadMove);
        })
      : null)
    || fallbackSentences.find((sentence) => EXPLANATION_MOVEMENT_RE.test(sentence));

  const generatedMovementSentence = (() => {
    if (headMoveCount > 0 && phrasalMoveCount > 0) {
      return 'The derivation explicitly records phrasal movement and head movement.';
    }
    if (headMoveCount > 0) {
      return 'The derivation explicitly records head movement.';
    }
    if (phrasalMoveCount > 0) {
      return 'The derivation explicitly records movement.';
    }
    return '';
  })();

  const cleanedSentences = new Set(
    splitExplanationSentences(cleaned).map((sentence) => cleanExplanationWhitespace(sentence).toLowerCase())
  );
  const normalizedFallbackMovementSentence = cleanExplanationWhitespace(fallbackMovementSentence || '').toLowerCase();
  const shouldPreferGeneratedMovementSentence =
    Boolean(generatedMovementSentence)
    && Boolean(normalizedFallbackMovementSentence)
    && cleanedSentences.has(normalizedFallbackMovementSentence);

  const movementSentence = shouldPreferGeneratedMovementSentence
    ? generatedMovementSentence
    : (fallbackMovementSentence || generatedMovementSentence);
  if (!movementSentence) {
    return ensureExplanationTerminator(cleaned);
  }

  const merged = cleanExplanationWhitespace(`${cleaned} ${movementSentence}`);
  return ensureExplanationTerminator(merged);
};

const reconcileModelExplanationWithDerivation = (modelExplanation, fallbackExplanation, movementEvents) => {
  const raw = cleanExplanationWhitespace(String(modelExplanation || ''));
  if (!raw) return fallbackExplanation;

  const movementKinds = extractMovementEventKinds(movementEvents);
  if ((!Array.isArray(movementEvents) || movementEvents.length === 0) && EXPLANATION_MOVEMENT_RE.test(raw)) {
    return fallbackExplanation;
  }

  const kept = splitExplanationSentences(raw).filter((sentence) =>
      !isDirectlyContradictoryMovementSentence(sentence, movementKinds, movementEvents)
      && !isTruncatedScholarReferenceSentence(sentence)
      && !isVagueScholarReferenceSentence(sentence)
      && !isImplementationLeakSentence(sentence)
  );
  const cleaned = removeUnsupportedSuccessiveHeadMoveSentences(
    cleanExplanationWhitespace(kept.join(' ')),
    movementEvents
  );
  if (!cleaned) return fallbackExplanation;
  const movementAware = ensureEncodedMovementIsMentioned(cleaned, fallbackExplanation, movementEvents);
  if (!explanationHasMinimumSubstance(cleaned)) return fallbackExplanation;
  if (!explanationHasEnoughTexture(movementAware)) {
    return mergeExplanationWithGroundedFallback(movementAware, fallbackExplanation);
  }
  return ensureExplanationTerminator(movementAware);
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
  const structuralMetaByTarget = new Map();
  const movementStepMeta = [];
  let spelloutStepMeta = null;
  existingSteps.forEach((step) => {
    const targetNodeId = String(step?.targetNodeId || '').trim();
    const featureChecking = Array.isArray(step?.featureChecking) && step.featureChecking.length > 0
      ? step.featureChecking
      : undefined;
    const meta = {
      featureChecking,
      trigger: normalizeOptionalStepText(step?.trigger),
      chainId: normalizeOptionalStepText(step?.chainId),
      spelloutDomain: normalizeOptionalStepText(step?.spelloutDomain),
      note: normalizeOptionalStepText(step?.note)
    };
    if (String(step?.operation || '').trim() === 'SpellOut') {
      spelloutStepMeta = meta;
      return;
    }
    if (isMoveLikeOperation(step?.operation)) {
      movementStepMeta.push(meta);
      return;
    }
    if (targetNodeId && !structuralMetaByTarget.has(targetNodeId)) {
      structuralMetaByTarget.set(targetNodeId, meta);
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
      const meta = structuralMetaByTarget.get(nodeId) || {};
      derivationSteps.push({
        operation: 'LexicalSelect',
        trigger: meta.trigger,
        chainId: meta.chainId,
        spelloutDomain: meta.spelloutDomain,
        targetNodeId: nodeId || undefined,
        targetLabel,
        sourceNodeIds: [],
        sourceLabels: [surface],
        recipe: `Select ${surface}`,
        workspaceAfter: Array.from(workspace.values()),
        featureChecking: meta.featureChecking,
        note: meta.note
      });
      return;
    }

    children.forEach((child) => {
      const childId = String(child?.id || '').trim();
      if (childId) workspace.delete(childId);
    });
    workspace.set(nodeId, targetLabel);
    const meta = structuralMetaByTarget.get(nodeId) || {};
    derivationSteps.push({
      operation: children.length === 1 ? 'Project' : 'ExternalMerge',
      trigger: meta.trigger,
      chainId: meta.chainId,
      spelloutDomain: meta.spelloutDomain,
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
      featureChecking: meta.featureChecking,
      note: meta.note
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
      const meta = movementStepMeta[index] || {};
      const featureChecking = meta.featureChecking;
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
        trigger: meta.trigger,
        chainId: meta.chainId,
        spelloutDomain: meta.spelloutDomain,
        targetNodeId: targetNodeId || undefined,
        targetLabel,
        sourceNodeIds,
        sourceLabels,
        recipe: `${sourceLabels.join(' + ')} -> ${targetLabel}`,
        workspaceAfter: [rootLabel],
        featureChecking,
        note: typeof event?.note === 'string' ? event.note : meta.note
      });
    });

  derivationSteps.push({
    operation: 'SpellOut',
    trigger: spelloutStepMeta?.trigger,
    chainId: spelloutStepMeta?.chainId,
    spelloutDomain: spelloutStepMeta?.spelloutDomain || rootLabel,
    targetNodeId: String(tree?.id || '').trim() || undefined,
    targetLabel: rootLabel,
    sourceNodeIds: String(tree?.id || '').trim() ? [String(tree.id).trim()] : undefined,
    sourceLabels: [rootLabel],
    recipe: `SpellOut(${rootLabel})`,
    workspaceAfter: [rootLabel],
    spelloutOrder: Array.isArray(surfaceOrder) ? surfaceOrder : undefined,
    note: spelloutStepMeta?.note || 'Final spellout of the committed surface order.'
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
  const groundedFallback = buildGroundedExplanation({
    tree,
    derivationSteps,
    movementEvents,
    framework
  });
  return reconcileModelExplanationWithDerivation(
    explanation,
    groundedFallback,
    movementEvents
  );
};

const harmonizeInterpretationWithDerivation = (interpretation, movementEvents) => {
  const raw = cleanExplanationWhitespace(String(interpretation || ''));
  if (!raw) return undefined;

  const movementKinds = extractMovementEventKinds(movementEvents);
  if (movementKinds.size === 0 && EXPLANATION_MOVEMENT_RE.test(raw)) {
    return undefined;
  }

  const kept = splitExplanationSentences(raw).filter((sentence) =>
    !isDirectlyContradictoryMovementSentence(sentence, movementKinds, movementEvents)
      && !isTruncatedScholarReferenceSentence(sentence)
      && !isVagueScholarReferenceSentence(sentence)
      && !isImplementationLeakSentence(sentence)
  );
  const cleaned = removeUnsupportedSuccessiveHeadMoveSentences(
    cleanExplanationWhitespace(kept.join(' ')),
    movementEvents
  );
  return cleaned || undefined;
};

const normalizeParseResult = (value, framework = 'xbar', sentence = '', modelRoute = 'flash-lite') => {
  const parsed = value;
  if (!parsed || typeof parsed !== 'object') {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed parse result from model.', 502);
  }

  const explanation = typeof parsed.explanation === 'string' && parsed.explanation.trim()
    ? parsed.explanation
    : 'No explanation provided.';
  const movementDecision = normalizeMovementDecision(parsed.movementDecision);

  const useAssistedStructurePath = modelRoute === 'flash-lite';
  const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
  const treeSource = parsed.tree && Array.isArray(parsed.tree.nodes)
    ? compileFlatNodeTableToTree(parsed.tree.nodes, parsed.tree.rootId, framework, sentenceTokens)
    : parsed.tree
      ? parsed.tree
      : Array.isArray(parsed.nodes)
        ? compileFlatNodeTableToTree(parsed.nodes, parsed.rootId, framework, sentenceTokens)
        : null;
  const nodeReferences = collectNodeReferencesById(treeSource || parsed);
  const { tree: rawTree, nodeIds } = normalizeSyntaxTreeWithIds(treeSource, nodeReferences, framework, sentenceTokens);
  if (useAssistedStructurePath) {
    materializeLexicalPhrasalLeaves(rawTree);
  }
  const nodeById = buildNodeIndexFromTree(rawTree);
  const labelIndex = buildNodeLabelIndexFromTree(rawTree);
  const derivationSteps = normalizeDerivationSteps(parsed.derivationSteps, nodeIds);
  const rawMovementEvents = normalizeMovementEvents(parsed.movementEvents, nodeIds, derivationSteps, nodeById, labelIndex);
  if (useAssistedStructurePath) {
    canonicalizeSplitClauseEdgeMovedPhrases(rawTree, rawMovementEvents);
  }
  const redirects = useAssistedStructurePath ? collapseOvertHeadLandingChains(rawTree) : new Map();
  const remappedDerivationSteps = redirects.size > 0
    ? remapDerivationStepsNodeIds(derivationSteps, redirects)
    : derivationSteps;
  const remappedRawMovementEvents = redirects.size > 0
    ? remapMovementEventsNodeIds(rawMovementEvents, redirects)
    : rawMovementEvents;
  const canonicalizedRawMovementEvents = useAssistedStructurePath
    ? canonicalizeHeadMoveSourceShells(rawTree, remappedRawMovementEvents)
    : remappedRawMovementEvents;
  const { tree, surfaceOrder } = validateAndCommitSurfaceOrder(parsed.surfaceOrder, rawTree, sentence);
  validateSpelloutConsistency(remappedDerivationSteps, tokenizeSentenceSurfaceOrder(sentence), surfaceOrder);
  const movementEvents = buildCanonicalMovementEvents({
    tree,
    derivationSteps: remappedDerivationSteps,
    rawMovementEvents: canonicalizedRawMovementEvents
  });
  stripMovementIndicesFromTree(tree);
  const sentenceTokenSet = new Set(sentenceTokens.map(normalizeSurfaceToken).filter(Boolean));
  if (useAssistedStructurePath) {
    materializeEmptyStructuralLeaves(tree, sentenceTokenSet);
    promoteSentenceMatchingLeaves(tree, sentenceTokenSet);
  }
  const postStripOvertTerminals = collectOvertTerminalNodes(tree);
  const cleanSurfaceOrder = postStripOvertTerminals
    .map((node) => resolveNodeSurface(node))
    .map((token) => String(token || '').trim())
    .filter(Boolean);
  if (cleanSurfaceOrder.length > 0) {
    surfaceOrder.length = 0;
    cleanSurfaceOrder.forEach((token) => surfaceOrder.push(token));
  }
  const canonicalTimeline = buildCanonicalDerivationFromTree({
    tree,
    movementEvents,
    surfaceOrder,
    modelDerivationSteps: remappedDerivationSteps
  });
  const coherentMovementDecision = reconcileMovementDecisionWithCommittedAnalysis(
    movementDecision,
    canonicalTimeline.movementEvents
  );
  const reconciledDerivationSteps = reconcileDerivationStepOperations(
    canonicalTimeline.derivationSteps,
    canonicalTimeline.movementEvents
  );
  const identifiedDerivationSteps = assignDerivationStepIds(reconciledDerivationSteps);
  const coherentExplanation = harmonizeExplanationWithDerivation(
    explanation,
    identifiedDerivationSteps,
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
    movementDecision: coherentMovementDecision,
    surfaceOrder,
    partsOfSpeech: normalizePartsOfSpeech(parsed.partsOfSpeech),
    bracketedNotation: serializeTreeToBracketedNotation(tree),
    interpretation: coherentInterpretation,
    derivationSteps: identifiedDerivationSteps,
    movementEvents: canonicalTimeline.movementEvents
  };
};

const normalizeParseBundle = (value, framework = 'xbar', sentence = '', modelRoute = 'flash-lite') => {
  const parsed = value;
  const analysesSource = Array.isArray(parsed?.analyses)
    ? parsed.analyses
    : parsed
      ? [parsed]
      : [];

  const analyses = analysesSource
    .map((analysis) => normalizeParseResult(analysis, framework, sentence, modelRoute))
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

const generateStructuredContent = async ({
  ai,
  model,
  contents,
  systemInstruction,
  temperature = MODEL_TEMPERATURE,
  abortSignal,
  responseJsonSchema = PARSE_RESPONSE_JSON_SCHEMA
}) => {
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
        responseJsonSchema
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

const buildSystemInstruction = (framework = 'xbar', modelRoute = 'flash-lite') =>
  (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) +
  '\n\n' +
  BASE_INSTRUCTION +
  (modelRoute === 'flash-lite' ? `\n\n${LITE_FORMAT_INSTRUCTION}` : '');

const buildSingleParseContentsPrompt = (
  sentence,
  framework = 'xbar',
  modelRoute = 'flash-lite',
  { compactOutput = false } = {}
) =>
  `Analyze the sentence: "${sentence}" and return a complete syntactic tree analysis using ` +
  `${framework === 'xbar' ? 'X-Bar Theory' : 'The Minimalist Program (Bare Phrase Structure)'} in the specified JSON format. ` +
  `Return the complete analysis in one pass. ` +
  `${modelRoute === 'flash-lite'
    ? `For the structure, use the flat node-table format only: return analyses[].nodes plus optional rootId, and do not return a nested "tree" field at all. ` +
      `Every node should have id, label, and siblingOrder; non-root nodes should include parentId; overt terminal nodes should include word and tokenIndex; phrasal nodes may include surfaceSpan. ` +
      `Do not place overt word directly on a phrasal node; realize overt words only on head/preterminal nodes below that phrase. ` +
      `Babel will deterministically compile that committed node table into the visible tree, so focus on structural commitments rather than hand-serializing nested children arrays. `
    : `Use the standard nested tree format with explicit ordered children arrays. ` +
      `Each overt subtree must already appear in the correct pronounced order inside the returned tree. `}` +
  `Use these exact overt input tokens as your pronounced terminals: ${tokenizeSentenceSurfaceOrder(sentence).join(' | ')}. ` +
  `For overt terminal leaves, include tokenIndex values tied to that token list: ${tokenizeSentenceSurfaceOrder(sentence).map((token, index) => `${index}:${token}`).join(' | ')}. ` +
  `Do not split or rewrite those overt tokens. ` +
  `CRITICAL LINEARIZATION RULE: Your committed structure must realize the overt terminals in exactly the pronounced sentence order. ` +
  `${modelRoute === 'flash-lite'
      ? `In the flat node-table format, make every parent-child relation and every surfaceSpan/tokenIndex consistent with that order. Every phrasal node's surfaceSpan must match the leftmost and rightmost overt descendant token indices of that node. Only overt terminals may carry tokenIndex; traces, nulls, and silent copies must omit tokenIndex. For phrasal movement, the lower source must be a lower copy of the moved phrase, not merely a head trace inside that phrase. For head movement, the lower source must be a lower head or head-copy, not a whole phrase containing that head. Do not reuse one lower node as the source of both a phrasal Move and a HeadMove unless the analysis explicitly represents both dependencies there. If a bar-level shell would force one child to surface between the overt descendants of another sibling, do not use that shell there; encode the actual head/specifier/complement order directly with siblingOrder instead. `
    : `In the nested tree format, at every node the children array must be ordered so that a left-to-right depth-first traversal of the entire tree reads out the overt terminals in exactly the pronounced sentence order. `}` +
  `Token indices and surface spans must agree with that same left-to-right order. ` +
  `This means: if a child subtree contains an overt terminal that is pronounced earlier in the sentence, that child must appear BEFORE siblings whose overt terminals are pronounced later. This applies at every level of the tree, not just the root. ` +
  `${modelRoute === 'flash-lite'
    ? `For any pair of sisters with overt descendants, one sister's overt token interval must be entirely before or entirely after the other's. Do not create sibling structures whose overt intervals interleave. `
    : ''}` +
  `Use each overt input token exactly once in the final tree unless that token occurs multiple times in the sentence itself. ` +
  `If you include a silent or null terminal, use exactly "∅". ` +
  `Use "word" for terminal surface forms, never "value". ` +
  `Keep lower copy notation consistent within this tree, including phrasal and head movement. ` +
  `If you use traces, use only canonical trace forms like t, trace, t_1, or trace_DP; do not use hyphenated trace forms. ` +
  `Do not use helper position labels such as labels beginning with "Spec" as separate nodes; represent the phrase itself instead. ` +
  `If a node is phrasal (XP or X'), it must realize structure through children, not through a word field. ` +
  `If a head is overt in a higher functional position, realize it there as one overt head rather than stacking labels like C > V > word. ` +
  `Do not split one overt moved phrase across an overt C/head node plus a separate DP/NP/PP phrase shell; if a phrase moves to the clause edge, keep all overt words of that phrase inside that single moved phrase node. ` +
  `At the landing site of head movement, use exactly one overt head label above the pronounced word; do not return unary chains of overt head labels with the same overt yield. ` +
  `If a head lands in C, Infl, or another higher head position, that landing head should directly dominate the overt word rather than an extra overt source-category head. ` +
  `Every overt lexical item must appear on a terminal or head node, never directly on a phrasal projection such as DP, NP, VP, TP, InflP, or CP. ` +
  `Each overt lexical item must be visibly headed exactly once: either put the overt word on a head node itself, or let one head node directly dominate that overt word as its only overt child. ` +
  `Do not let one head node directly dominate both an overt word and a trace/null/copy sibling; encode lower head copies in distinct lower head positions. ` +
  `Before returning, decide whether movement occurs in this analysis and make movementDecision, movementEvents, derivationSteps, explanation, and the tree all match that same one choice. ` +
  `If movement occurs, make it explicit. If movement does not occur, do not leave traces, lower copies, or null heads that imply otherwise. ` +
  `${framework === 'xbar'
    ? `In the explanation, describe the analysis only in X-bar terms; do not call it Minimalist or Minimalism. `
    : `In the explanation, describe the analysis only in Minimalist terms; do not call it X-Bar Theory. `}` +
  `Write the explanation as a developed academic paragraph rather than a compressed checklist. When directly warranted by the committed analysis, you may briefly situate it in a recognized analytical tradition or mention a relevant scholar. If you mention a scholar or tradition, make the reference specific and complete; do not use vague phrases like "and others". ` +
  `In movementEvents, use exactly: operation, fromNodeId, toNodeId, optional traceNodeId, optional stepIndex, optional note. Do not use type/source/target fields. ` +
  `The literal string "word" is a field name only; never use "word" as a node label. ` +
  `If you include derivationSteps, keep them lightweight and use node ids rather than extra serialized labels or workspace metadata. When case, agreement, EPP, wh/focus licensing, or other feature valuation is central to the committed derivation, encode it in featureChecking instead of leaving it only in the prose. ` +
  `If a short reason for the step is clear, you may include trigger, and if multiple steps belong to one dependency, you may reuse a short chainId. For SpellOut steps, you may include spelloutDomain when the transfer domain matters in the committed analysis. ` +
  `If you explicitly assign case to a DP, you may annotate that node with optional fields case, assigner, caseEvidence, and caseOvert. Omit those fields if you are not explicitly committing. ` +
  `${compactOutput
    ? `COMPACT OUTPUT MODE: return exactly one analysis and no ambiguity note. Keep the explanation to 2-4 substantive sentences. Keep derivationSteps minimal: include only the structural commitments needed for the replay, and omit optional note, trigger, chainId, spelloutDomain, workspaceAfter, and featureChecking fields unless they are strictly necessary to encode the committed derivation. Prefer the smallest valid JSON that still fully commits to the analysis. `
    : ''}` +
  `${modelRoute === 'flash-lite'
    ? `FLASH LITE FORMAT CHECK: Return analyses[].nodes plus optional rootId only; never return tree or tree.nodes. tokenIndex belongs only on overt terminals. surfaceSpan must agree with overt descendants and sentence order. ` +
      `FLASH LITE FORMAT CHECK AGAIN: analyses[].nodes is the only allowed structural format. Nulls, traces, and silent copies must omit tokenIndex. Every node must include siblingOrder. ` +
      `FLASH LITE FORMAT CHECK A THIRD TIME: parentId, siblingOrder, and overt tokenIndex are the primary commitments. If unsure about a surfaceSpan, omit it rather than guessing. Every overt terminal must still include tokenIndex. Never place an overt word directly on a phrasal node. If a head-initial clause would spell the sentence wrongly under a bar-level shell, do not use that shell there; encode the overt head, subject/specifier, and complement material as direct ordered siblings. `
    : ''}` +
  `FINAL CHECK: Read the overt terminals of your committed structure in left-to-right order. They must spell out exactly: ${tokenizeSentenceSurfaceOrder(sentence).join(' | ')}. Every overt leaf should point to the matching tokenIndex, and the returned structure should already encode the correct sentence order before you return it.`;

const buildParseContentsPrompt = (
  sentence,
  framework = 'xbar',
  modelRoute = 'flash-lite',
  { compactOutput = false } = {}
) => {
  const basePrompt = buildSingleParseContentsPrompt(sentence, framework, modelRoute, { compactOutput });
  const repeatedConsistencyCheck =
    `CONSISTENCY RECHECK: Before returning, read the same request again and verify that your final JSON already encodes one coherent analysis. ` +
    `The overt terminals must spell exactly: ${tokenizeSentenceSurfaceOrder(sentence).join(' | ')}. ` +
    `movementDecision, movementEvents, derivationSteps, explanation, and the tree must all reflect the same movement story. ` +
    `If your final tree contains an overt higher head with a silent lower head site for that same dependency, the final JSON must include a HeadMove. ` +
    `${compactOutput
      ? `Compact retry mode is active because an earlier answer was cut off. Keep the JSON concise and do not add a second analysis. `
      : ''}` +
    `${modelRoute === 'flash-lite'
      ? `For Flash Lite, analyses[].nodes plus optional rootId is the only allowed structural format, overt terminals must carry tokenIndex, silent terminals must omit tokenIndex, every node must include siblingOrder, sister nodes with overt descendants must realize disjoint non-interleaving token intervals, and any head-initial local order that would fail under a bar-level shell must instead be encoded directly with ordered siblings. `
      : ''}` +
    `Return one final JSON answer only.`;
  return (
    `${basePrompt}\n\n` +
    `${repeatedConsistencyCheck}`
  );
};

const buildSerializerContentsPrompt = (sentence, framework = 'xbar', draftPayload, modelRoute = 'pro') => {
  const tokenText = tokenizeSentenceSurfaceOrder(sentence).join(' | ');
  const tokenIndexText = tokenizeSentenceSurfaceOrder(sentence).map((token, index) => `${index}:${token}`).join(' | ');

  if (modelRoute === 'flash-lite') {
    return (
      `Rewrite the following draft structural output into Babel's canonical flat node-table schema without changing the underlying analysis.\n\n` +
      `Sentence: "${sentence}"\n` +
      `Framework: ${framework === 'xbar' ? 'X-Bar Theory' : 'Minimalist Program'}\n` +
      `Exact pronounced tokens: ${tokenText}\n` +
      `Exact token indices: ${tokenIndexText}\n\n` +
      `Required canonicalization rules:\n` +
      `- Return analyses[].nodes plus optional rootId as the only structural format.\n` +
      `- Preserve the same hierarchy, overt/null distinction, movement commitments, and overt token inventory.\n` +
      `- Use parentId to encode hierarchy.\n` +
      `- Every overt terminal must include tokenIndex.\n` +
      `- Traces, nulls, and silent copies must omit tokenIndex.\n` +
      `- Use "word" for terminal surface forms, not alternate fields like "value".\n` +
      `- Every node must have a usable label.\n` +
      `- If surfaceSpan is present, it must agree with the leftmost and rightmost overt descendant token indices.\n` +
      `- Sister nodes with overt descendants must realize disjoint, non-interleaving token intervals.\n` +
      `- Do not rewrite the analysis into a nested tree.\n\n` +
      `Serializer procedure:\n` +
      `1. Preserve the same committed analysis.\n` +
      `2. Normalize field names, labels, ids, and parentId relations into the flat node-table schema.\n` +
      `3. Ensure every overt terminal is tied to the correct tokenIndex from: ${tokenText}.\n` +
      `4. Ensure the final node table implies exactly that sentence order and no other overt order.\n` +
      `5. Before returning, verify that no overt token is missing, duplicated, or attached to a silent node.\n\n` +
      `Draft analysis JSON (only structural serialization should be rewritten; all non-structural commitments will be preserved outside this serializer pass):\n` +
      '```json\n' +
      `${JSON.stringify({
        analyses: Array.isArray(draftPayload?.analyses)
          ? draftPayload.analyses.map((analysis) => ({
              tree: analysis?.tree,
              nodes: analysis?.nodes,
              rootId: analysis?.rootId
            }))
          : []
      }, null, 2)}\n` +
      '```'
    );
  }

  return (
    `Rewrite the following draft tree into Babel's canonical tree JSON schema without changing the underlying analysis.\n\n` +
    `Sentence: "${sentence}"\n` +
    `Framework: ${framework === 'xbar' ? 'X-Bar Theory' : 'Minimalist Program'}\n` +
    `Exact pronounced tokens: ${tokenText}\n` +
    `Exact token indices: ${tokenIndexText}\n\n` +
    `Required canonicalization rules:\n` +
    `- Use the exact same overt tokens and pronounced order.\n` +
    `- Every overt terminal leaf must include tokenIndex pointing to the corresponding sentence token.\n` +
    `- Overt children must appear in ascending tokenIndex/surfaceSpan order.\n` +
    `- If a subtree's children are out of order, reorder the children array only; do not change the hierarchy, dominance relations, or movement commitments.\n` +
    `- Use "word" for terminal surface forms, not alternate fields like "value".\n` +
    `- Every node must have a usable "label".\n` +
    `- Keep lower-copy and null notation consistent, and use exactly "∅" for silent terminals.\n\n` +
    `Serializer procedure:\n` +
    `1. Preserve the same tree structure and same committed analysis.\n` +
    `2. Normalize field names and missing labels into Babel's canonical tree schema.\n` +
    `3. Reorder child arrays wherever needed so a left-to-right DFS over overt leaves spells exactly: ${tokenText}.\n` +
    `4. Assign tokenIndex values from that final overt DFS order.\n` +
    `5. Before returning, verify that the overt DFS yield of the tree exactly matches the sentence tokens and that no overt token is missing, duplicated, or reordered.\n\n` +
    `Draft analysis JSON (only the tree should be rewritten; all non-tree commitments will be preserved outside this serializer pass):\n` +
    '```json\n' +
    `${JSON.stringify({
      analyses: Array.isArray(draftPayload?.analyses)
        ? draftPayload.analyses.map((analysis) => ({ tree: analysis?.tree }))
        : []
    }, null, 2)}\n` +
    '```'
  );
};

const payloadUsesFlatNodeTable = (payload) => {
  const analyses = Array.isArray(payload?.analyses) ? payload.analyses : payload ? [payload] : [];
  return analyses.some((analysis) => (
    Array.isArray(analysis?.nodes) ||
    Array.isArray(analysis?.tree?.nodes)
  ));
};

const shouldAttemptSerializerPass = (error, modelRoute = 'pro', payload = null) => {
  if (!(error instanceof ParseApiError) || error.code !== 'BAD_MODEL_RESPONSE') return false;
  if (modelRoute === 'pro') return false;
  const message = String(error.message || '');
  return (
    message.includes('Malformed structural components from model.') ||
    message.includes('Malformed tree node from model') ||
    message.includes('Tree overt terminals do not match the input sentence order.') ||
    message.includes('All overt leaves must include tokenIndex once token anchoring is used.') ||
    message.includes('Overt token indices do not cover the sentence exactly once.') ||
    message.includes('Children arrays do not realize overt terminals in ascending tokenIndex order.') ||
    message.includes('Children arrays do not follow ascending surface-span order.') ||
    message.includes('Leaf tokenIndex does not match the overt sentence token it claims to realize.')
  );
};

const runSerializerPass = async ({
  ai,
  model,
  sentence,
  framework,
  draftPayload,
  modelRoute = 'pro',
  abortSignal
}) => {
  const contents = buildSerializerContentsPrompt(sentence, framework, draftPayload, modelRoute);
  const serializerSystemInstruction =
    SERIALIZER_SYSTEM_INSTRUCTION +
    (modelRoute === 'flash-lite'
      ? `\n\nFor Flash Lite route outputs, keep the final structure in flat node-table form only: analyses[].nodes plus optional rootId.`
      : '');
  const generation = await generateStructuredContent({
    ai,
    model,
    contents,
    systemInstruction: serializerSystemInstruction,
    temperature: MODEL_TEMPERATURE,
    abortSignal,
    responseJsonSchema: parseResponseJsonSchemaForRoute(modelRoute)
  });

  if (isTruncatedGeneration(generation)) {
    throw new ParseApiError('BAD_MODEL_RESPONSE', 'Serializer output was truncated before JSON completion.', 502);
  }

  const generationMeta = summarizeGeneration(generation);
  return {
    payload: parseModelJson(generationMeta.rawText),
    generationMeta
  };
};

const mergeSerializedStructureIntoDraftPayload = (draftPayload, serializedPayload) => {
  const draftAnalyses = Array.isArray(draftPayload?.analyses) ? draftPayload.analyses : [];
  const serializedAnalyses = Array.isArray(serializedPayload?.analyses) ? serializedPayload.analyses : [];
  if (draftAnalyses.length === 0 || serializedAnalyses.length === 0) {
    return serializedPayload;
  }

  const mergedAnalyses = draftAnalyses.map((draftAnalysis, index) => {
    const serializedAnalysis = serializedAnalyses[index];
    if (!serializedAnalysis || typeof serializedAnalysis !== 'object') return draftAnalysis;

    const merged = { ...draftAnalysis };
    if (serializedAnalysis.tree && typeof serializedAnalysis.tree === 'object') {
      merged.tree = serializedAnalysis.tree;
      delete merged.nodes;
      delete merged.rootId;
    }
    if (Array.isArray(serializedAnalysis.nodes)) {
      merged.nodes = serializedAnalysis.nodes;
      if (typeof serializedAnalysis.rootId === 'string' && serializedAnalysis.rootId.trim()) {
        merged.rootId = serializedAnalysis.rootId.trim();
      } else {
        delete merged.rootId;
      }
      delete merged.tree;
    }
    return merged;
  });

  return {
    ...draftPayload,
    analyses: mergedAnalyses
  };
};

export const parseSentenceWithGemini = async (sentence, framework = 'xbar', modelRoute = 'flash-lite') => {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new ParseApiError('API_KEY_MISSING', 'Gemini API key is not configured on the server.', 500);
  }

  const ai = new GoogleGenAI({ apiKey });
  const normalizedModelRoute = modelRoute === 'pro' ? 'pro' : 'flash-lite';
  const systemInstruction = buildSystemInstruction(framework, normalizedModelRoute);
  const fullContents = buildParseContentsPrompt(sentence, framework, normalizedModelRoute);
  const compactContents = buildParseContentsPrompt(sentence, framework, normalizedModelRoute, { compactOutput: true });
  const responseJsonSchema = parseResponseJsonSchemaForRoute(normalizedModelRoute);
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
      let useCompactPrompt = false;
      if (!attemptedModels.includes(currentModel)) {
        attemptedModels.push(currentModel);
      }

      for (let attempt = 1; attempt <= PRO_RETRY_MAX_ATTEMPTS; attempt += 1) {
        const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, normalizedModelRoute);
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
          const baseTimeoutMs = resolveModelTimeoutMs(currentModel, normalizedModelRoute);
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
              contents: useCompactPrompt ? compactContents : fullContents,
              systemInstruction,
              temperature: MODEL_TEMPERATURE,
              abortSignal,
              responseJsonSchema
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
              throw new ParseApiError(
                error.code,
                error.message,
                422,
                {
                  stage: 'json-parse',
                  model: currentModel,
                  attempt,
                  finishReason: generationMeta.finishReason || null,
                  textLength: generationMeta.textLength,
                  preview: generationMeta.preview || '',
                  modelsTried: [...attemptedModels, currentModel]
                }
              );
            }
            throw error;
          }

          let candidateNormalized;
          try {
            candidateNormalized = normalizeParseBundle(payload, framework, sentence, normalizedModelRoute);
          } catch (error) {
            if (shouldAttemptSerializerPass(error, normalizedModelRoute, payload)) {
              const serializerRemainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, normalizedModelRoute);
              if (serializerRemainingBudgetMs > 1200) {
                try {
                  const serializerTimeoutMs = resolveAttemptTimeoutMs({
                    baseTimeoutMs: resolveModelTimeoutMs(currentModel, normalizedModelRoute),
                    remainingBudgetMs: serializerRemainingBudgetMs,
                    hasNextModel,
                    attempt
                  });
                  const serialized = await withTimeout(
                    (abortSignal) => runSerializerPass({
                      ai,
                      model: currentModel,
                      sentence,
                      framework,
                      draftPayload: payload,
                      modelRoute: normalizedModelRoute,
                      abortSignal
                    }),
                    serializerTimeoutMs,
                    `Serializer pass (${currentModel})`
                  );
                  const mergedPayload = mergeSerializedStructureIntoDraftPayload(payload, serialized.payload);
                  candidateNormalized = normalizeParseBundle(mergedPayload, framework, sentence, normalizedModelRoute);
                } catch (serializerError) {
                  if (serializerError instanceof ParseApiError && serializerError.code === 'BAD_MODEL_RESPONSE') {
                    let payloadPreview = '<unserializable>';
                    try {
                      payloadPreview = JSON.stringify(payload).slice(0, 320);
                    } catch {
                      // keep fallback preview
                    }
                    console.warn(
                      `[gemini] serializer failure on ${currentModel} ` +
                      `(attempt ${attempt}/${PRO_RETRY_MAX_ATTEMPTS}, finishReason=${generationMeta.finishReason}, textLength=${generationMeta.textLength}). ` +
                      `Original normalization error: ${error.message}. Serializer error: ${serializerError.message}. Payload preview: ${payloadPreview}`
                    );
                    throw new ParseApiError(
                      serializerError.code,
                      serializerError.message,
                      422,
                      {
                        stage: 'serializer',
                        model: currentModel,
                        attempt,
                        finishReason: generationMeta.finishReason || null,
                        textLength: generationMeta.textLength,
                        preview: generationMeta.preview || '',
                        payloadPreview,
                        modelsTried: [...attemptedModels, currentModel]
                      }
                    );
                  }
                  throw serializerError;
                }
              }
            }

            if (candidateNormalized) {
              // serializer pass recovered a canonical payload; continue with the normalized bundle
            } else if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
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
              throw new ParseApiError(
                error.code,
                error.message,
                422,
                {
                  stage: 'normalization',
                  model: currentModel,
                  attempt,
                  finishReason: generationMeta.finishReason || null,
                  textLength: generationMeta.textLength,
                  preview: generationMeta.preview || '',
                  payloadPreview,
                  modelsTried: [...attemptedModels, currentModel]
                }
              );
            }
            if (!candidateNormalized) {
              throw error;
            }
          }
          normalized = candidateNormalized;
          usedModel = currentModel;
          if (modelIndex > 0) {
            console.warn(`[gemini] fallback model active: ${currentModel}`);
          }
          break;
        } catch (error) {
          lastError = error;
          if (
            error instanceof ParseApiError &&
            error.code === 'BAD_MODEL_RESPONSE' &&
            /truncated before JSON completion/i.test(String(error.message || '')) &&
            !useCompactPrompt &&
            attempt < PRO_RETRY_MAX_ATTEMPTS
          ) {
            console.warn(
              `[gemini] truncated output on ${currentModel} ` +
              `(attempt ${attempt}/${PRO_RETRY_MAX_ATTEMPTS}); retrying once with compact output mode.`
            );
            useCompactPrompt = true;
            const delayMs = getRetryDelayMs(attempt);
            await sleep(delayMs);
            continue;
          }
          if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
            if (hasNextModel) {
              console.warn(
                `[gemini] invalid model payload on ${currentModel}: ${error.message}. ` +
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
        throw lastError;
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
  parseResponseJsonSchemaForRoute,
  buildSerializerContentsPrompt,
  reconcileModelExplanationWithDerivation,
  mergeSerializedStructureIntoDraftPayload,
  parseModelJson
};
