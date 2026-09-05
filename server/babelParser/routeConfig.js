import fs from 'node:fs';
import path from 'node:path';

const loadLocalEnv = () => {
  if (process.env.NODE_ENV === 'production') return;
  const envPaths = ['.env.local', '.env'].map((name) => path.resolve(process.cwd(), name));
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (process.env[key]) continue;
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = value;
    }
  }
};

loadLocalEnv();

export const GEMINI_MODEL = String(process.env.GEMINI_MODEL || '').trim() || 'gemini-3.1-pro-preview';
export const OPENAI_MODEL = String(process.env.OPENAI_MODEL || '').trim() || 'gpt-5.5';
export const ANTHROPIC_MODEL = String(process.env.ANTHROPIC_MODEL || '').trim() || 'claude-opus-4-8';
const normalizeGeminiThinkingLevel = (value) => {
  const normalized = String(value || 'high').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (normalized === 'minimal') return 'LOW';
  if (normalized === 'low') return 'LOW';
  if (normalized === 'medium') return 'MEDIUM';
  if (normalized === 'high') return 'HIGH';
  return normalized.toUpperCase();
};
export const GEMINI_THINKING_LEVEL = normalizeGeminiThinkingLevel(process.env.GEMINI_THINKING_LEVEL);
const GEMINI_THINKING_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);
if (!GEMINI_THINKING_LEVELS.has(GEMINI_THINKING_LEVEL)) {
  throw new Error('GEMINI_THINKING_LEVEL must be one of: low, medium, high.');
}
const normalizeOpenAIReasoningEffort = (value) => {
  const normalized = String(value || 'xhigh').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'extra_high' || normalized === 'extra') return 'xhigh';
  return normalized;
};
export const OPENAI_REASONING_EFFORT = normalizeOpenAIReasoningEffort(process.env.OPENAI_REASONING_EFFORT);
const OPENAI_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
if (!OPENAI_REASONING_EFFORTS.has(OPENAI_REASONING_EFFORT)) {
  throw new Error('OPENAI_REASONING_EFFORT must be one of: low, medium, high, xhigh.');
}
export const OPENAI_BACKGROUND_RESPONSES = String(process.env.OPENAI_BACKGROUND_RESPONSES || '1').trim() !== '0';
export const OPENAI_BACKGROUND_POLL_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.OPENAI_BACKGROUND_POLL_INTERVAL_MS || 5000)
);
const normalizeAnthropicEffort = (value) => {
  const normalized = String(value || 'max').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'extra_high' || normalized === 'extra') return 'xhigh';
  return normalized;
};
export const ANTHROPIC_EFFORT = normalizeAnthropicEffort(process.env.ANTHROPIC_EFFORT);
const ANTHROPIC_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
if (!ANTHROPIC_EFFORTS.has(ANTHROPIC_EFFORT)) {
  throw new Error('ANTHROPIC_EFFORT must be one of: low, medium, high, xhigh, max.');
}
export const ANTHROPIC_THINKING_CONFIG = Object.freeze({
  type: 'adaptive',
  display: 'omitted'
});

const REASONING_EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const PROVIDER_REASONING_EFFORTS = Object.freeze({
  gemini: Object.freeze(['low', 'medium', 'high']),
  gpt: Object.freeze(['low', 'medium', 'high', 'xhigh']),
  claude: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
});

const normalizeReasoningAlias = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'extra_high' || normalized === 'extra') return 'xhigh';
  if (normalized === 'minimal') return 'minimal';
  if (normalized === 'low') return 'low';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'high') return 'high';
  if (normalized === 'xhigh') return 'xhigh';
  if (normalized === 'max' || normalized === 'maximum') return 'max';
  return '';
};

const defaultReasoningEffortForRoute = (modelRoute) => {
  const route = String(modelRoute || '').toLowerCase();
  if (route === 'gpt') return OPENAI_REASONING_EFFORT;
  if (route === 'claude') return ANTHROPIC_EFFORT;
  return String(GEMINI_THINKING_LEVEL || 'HIGH').toLowerCase();
};

export const normalizeProviderReasoningEffort = (modelRoute = 'gemini', value) => {
  const route = String(modelRoute || '').toLowerCase();
  const allowed = PROVIDER_REASONING_EFFORTS[route] || PROVIDER_REASONING_EFFORTS.gemini;
  const requested = normalizeReasoningAlias(value) || normalizeReasoningAlias(defaultReasoningEffortForRoute(route)) || 'high';
  if (allowed.includes(requested)) return requested;

  const requestedRank = REASONING_EFFORT_ORDER.indexOf(requested);
  if (requestedRank >= 0) {
    for (let index = requestedRank; index >= 0; index -= 1) {
      const candidate = REASONING_EFFORT_ORDER[index];
      if (allowed.includes(candidate)) return candidate;
    }
    for (let index = requestedRank + 1; index < REASONING_EFFORT_ORDER.length; index += 1) {
      const candidate = REASONING_EFFORT_ORDER[index];
      if (allowed.includes(candidate)) return candidate;
    }
  }
  return allowed.includes('high') ? 'high' : allowed[0];
};

export const buildGeminiThinkingConfig = (reasoningEffort = GEMINI_THINKING_LEVEL) => Object.freeze({
  thinkingLevel: normalizeGeminiThinkingLevel(reasoningEffort)
});
export const LOCAL_MODEL_NAME = String(process.env.BABEL_LOCAL_MODEL_NAME || '').trim() || 'gemma3:4b';
export const LOCAL_MODEL_URL = String(process.env.BABEL_LOCAL_MODEL_URL || '').trim() || 'http://127.0.0.1:11434/api/generate';
export const LOCAL_MODEL_COMMAND = String(process.env.BABEL_LOCAL_MODEL_COMMAND || '').trim();
export const LOCAL_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.BABEL_LOCAL_MODEL_TIMEOUT_MS || 1800000));
export const LOCAL_MODEL_NUM_CTX = Math.max(4096, Number(process.env.BABEL_LOCAL_MODEL_NUM_CTX || 12288));
export const LOCAL_MODEL_MAX_OUTPUT_TOKENS = Math.max(1024, Number(process.env.BABEL_LOCAL_MODEL_MAX_OUTPUT_TOKENS || 4096));
const resolveBoundedOutputAllowance = (value, fallback, documentedMaximum) => {
  const requested = Number(value);
  const finiteValue = Number.isFinite(requested) && requested > 0 ? requested : fallback;
  return Math.min(documentedMaximum, Math.max(8192, finiteValue));
};
export const DEFAULT_MAX_OUTPUT_TOKENS = resolveBoundedOutputAllowance(
  process.env.GEMINI_MAX_OUTPUT_TOKENS,
  65536,
  65536
);
export const GEMINI_ROUTE_MAX_OUTPUT_TOKENS = resolveBoundedOutputAllowance(
  process.env.GEMINI_ROUTE_MAX_OUTPUT_TOKENS ||
  process.env.GEMINI_MAX_OUTPUT_TOKENS,
  65536,
  65536
);
export const OPENAI_MAX_OUTPUT_TOKENS = resolveBoundedOutputAllowance(
  process.env.OPENAI_MAX_OUTPUT_TOKENS,
  128000,
  128000
);
export const ANTHROPIC_MAX_OUTPUT_TOKENS = Math.max(8192, Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || 32768));
export const PROVIDER_OUTPUT_ALLOWANCE_POLICIES = Object.freeze({
  gemini: Object.freeze({
    model: GEMINI_MODEL,
    configuredMaxOutputTokens: GEMINI_ROUTE_MAX_OUTPUT_TOKENS,
    documentedMaximum: 65536,
    admissionProbeConfirmed: false,
    source: 'corrected-canonical-architecture.md §5.4, retrieved 2026-07-23'
  }),
  gpt: Object.freeze({
    model: OPENAI_MODEL,
    configuredMaxOutputTokens: OPENAI_MAX_OUTPUT_TOKENS,
    documentedMaximum: 128000,
    admissionProbeConfirmed: false,
    source: 'corrected-canonical-architecture.md §5.4, retrieved 2026-07-23'
  }),
  claude: Object.freeze({
    model: ANTHROPIC_MODEL,
    configuredMaxOutputTokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
    documentedMaximum: null,
    admissionProbeConfirmed: false,
    source: 'corrected-canonical-architecture.md §5.4; numeric per-model ceiling unresolved'
  })
});
export const MODEL_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_TEMPERATURE))
  ? Number(process.env.GEMINI_TEMPERATURE)
  : 0.2;
const GEMINI_ROUTE_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_ROUTE_TEMPERATURE))
  ? Number(process.env.GEMINI_ROUTE_TEMPERATURE)
  : MODEL_TEMPERATURE;
const MODEL_CALL_TIMEOUT_RAW = String(process.env.GEMINI_MODEL_TIMEOUT_MS || '').trim();
const MODEL_CALL_TIMEOUT_MS = MODEL_CALL_TIMEOUT_RAW ? Number(MODEL_CALL_TIMEOUT_RAW) : NaN;
const PROVIDER_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.BABEL_PROVIDER_MODEL_TIMEOUT_MS || 0));
const GEMINI_ROUTE_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_ROUTE_TIMEOUT_MS || 0));
const REQUEST_BUDGET_MS = Math.max(0, Number(process.env.GEMINI_REQUEST_BUDGET_MS || 0));
const GEMINI_ROUTE_REQUEST_BUDGET_MS = Math.max(0, Number(process.env.GEMINI_ROUTE_REQUEST_BUDGET_MS || 0));
const EXTERNAL_PROVIDER_REQUEST_BUDGET_MS = Math.max(0, Number(process.env.BABEL_PROVIDER_REQUEST_BUDGET_MS || 900000));
const DEFAULT_PROVIDER_MODEL_TIMEOUT_MS = 900000;

export const routeUnavailableMessage = () =>
  'The canopy is noisy right now. The selected Gemini route is unavailable; please plant your sentence again in a moment.';

export const localRouteUnavailableMessage = () =>
  'The local model route is unavailable. Start the configured local runtime and try again.';

export const resolveRouteTemperature = () => GEMINI_ROUTE_TEMPERATURE;

export const estimateGeminiOutputBudget = () => GEMINI_ROUTE_MAX_OUTPUT_TOKENS;

export const resolveRouteMaxOutputTokens = (modelRoute = 'gemini') => {
  const route = String(modelRoute || '').toLowerCase();
  if (route === 'gpt') return OPENAI_MAX_OUTPUT_TOKENS;
  if (route === 'claude') return ANTHROPIC_MAX_OUTPUT_TOKENS;
  return estimateGeminiOutputBudget();
};

export const resolveModelTimeoutMs = (_model, modelRoute = 'gemini') => {
  const route = String(modelRoute || '').toLowerCase();
  if (route === 'local') return LOCAL_MODEL_TIMEOUT_MS;
  if (route === 'gemini' && GEMINI_ROUTE_TIMEOUT_MS > 0) {
    return GEMINI_ROUTE_TIMEOUT_MS;
  }
  if (route === 'gemini' && Number.isFinite(MODEL_CALL_TIMEOUT_MS) && MODEL_CALL_TIMEOUT_MS > 0) {
    return MODEL_CALL_TIMEOUT_MS;
  }
  if (PROVIDER_MODEL_TIMEOUT_MS > 0) {
    return PROVIDER_MODEL_TIMEOUT_MS;
  }
  // Never return 0 here. withTimeout() treats non-finite/zero as "no timeout".
  return DEFAULT_PROVIDER_MODEL_TIMEOUT_MS;
};

export const getRemainingRequestBudgetMs = (requestStartedAt, modelRoute = 'gemini') => {
  if (['gpt', 'claude', 'kimi', 'grok'].includes(String(modelRoute || '').toLowerCase())) {
    return Math.max(0, EXTERNAL_PROVIDER_REQUEST_BUDGET_MS - (Date.now() - requestStartedAt));
  }
  if (modelRoute !== 'local' && GEMINI_ROUTE_REQUEST_BUDGET_MS > 0) {
    return Math.max(0, GEMINI_ROUTE_REQUEST_BUDGET_MS - (Date.now() - requestStartedAt));
  }
  if (!(Number.isFinite(REQUEST_BUDGET_MS) && REQUEST_BUDGET_MS > 0)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, REQUEST_BUDGET_MS - (Date.now() - requestStartedAt));
};

export const resolveRequestTimeoutMs = ({ baseTimeoutMs, remainingBudgetMs }) => {
  const budgetCap = Number.isFinite(remainingBudgetMs)
    ? Math.max(1200, remainingBudgetMs - 250)
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(baseTimeoutMs) || baseTimeoutMs <= 0) {
    return Math.max(1200, budgetCap);
  }
  return Math.max(1200, Math.min(baseTimeoutMs, budgetCap));
};
