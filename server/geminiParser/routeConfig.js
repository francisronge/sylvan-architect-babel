export const PRIMARY_MODEL = String(process.env.GEMINI_MODEL || '').trim() || 'gemini-3.1-pro-preview';
export const PRO_MODEL = String(process.env.GEMINI_PRO_MODEL || '').trim() || 'gemini-3.1-pro-preview';
export const PAYLOAD_TRANSCRIBER_MODEL = String(process.env.GEMINI_PAYLOAD_TRANSCRIBER_MODEL || '').trim() || 'gemini-3.1-flash-lite-preview';
export const LOCAL_MODEL_NAME = String(process.env.BABEL_LOCAL_MODEL_NAME || '').trim() || 'gemma3:4b';
export const LOCAL_MODEL_URL = String(process.env.BABEL_LOCAL_MODEL_URL || '').trim() || 'http://127.0.0.1:11434/api/generate';
export const LOCAL_MODEL_COMMAND = String(process.env.BABEL_LOCAL_MODEL_COMMAND || '').trim();
export const LOCAL_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.BABEL_LOCAL_MODEL_TIMEOUT_MS || 1800000));
export const LOCAL_MODEL_NUM_CTX = Math.max(4096, Number(process.env.BABEL_LOCAL_MODEL_NUM_CTX || 12288));
export const LOCAL_MODEL_MAX_OUTPUT_TOKENS = Math.max(1024, Number(process.env.BABEL_LOCAL_MODEL_MAX_OUTPUT_TOKENS || 4096));
export const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 16384);
export const PAYLOAD_TRANSCRIBER_MAX_OUTPUT_TOKENS = Math.max(2048, Number(process.env.GEMINI_PAYLOAD_TRANSCRIBER_MAX_OUTPUT_TOKENS || 16384));
export const PAYLOAD_TRANSCRIBER_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_PAYLOAD_TRANSCRIBER_TIMEOUT_MS || 45000));
export const PAYLOAD_TRANSCRIBER_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_PAYLOAD_TRANSCRIBER_TEMPERATURE))
  ? Number(process.env.GEMINI_PAYLOAD_TRANSCRIBER_TEMPERATURE)
  : 0;
export const PRO_MAX_OUTPUT_TOKENS = Number(
  process.env.GEMINI_PRO_MAX_OUTPUT_TOKENS ||
  process.env.GEMINI_MAX_OUTPUT_TOKENS ||
  8192
);
export const MODEL_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_TEMPERATURE))
  ? Number(process.env.GEMINI_TEMPERATURE)
  : 0.2;
const PRO_MODEL_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_PRO_TEMPERATURE))
  ? Number(process.env.GEMINI_PRO_TEMPERATURE)
  : MODEL_TEMPERATURE;
const MODEL_CALL_TIMEOUT_RAW = String(process.env.GEMINI_MODEL_TIMEOUT_MS || '').trim();
const MODEL_CALL_TIMEOUT_MS = MODEL_CALL_TIMEOUT_RAW ? Number(MODEL_CALL_TIMEOUT_RAW) : NaN;
const PRIMARY_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_PRIMARY_TIMEOUT_MS || 0));
const PRO_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_PRO_TIMEOUT_MS || 0));
const PRO_ROUTE_TIMEOUT_MS = Math.max(0, Number(process.env.GEMINI_PRO_ROUTE_TIMEOUT_MS || 0));
const REQUEST_BUDGET_MS = Math.max(0, Number(process.env.GEMINI_REQUEST_BUDGET_MS || 0));
const PRO_ROUTE_REQUEST_BUDGET_MS = Math.max(0, Number(process.env.GEMINI_PRO_REQUEST_BUDGET_MS || 0));
const DEFAULT_PRIMARY_MODEL_TIMEOUT_MS = 45000;
const DEFAULT_PRO_MODEL_TIMEOUT_MS = 180000;

export const routeUnavailableMessage = () =>
  'The canopy is noisy right now. The selected Gemini 3.1 Pro route is unavailable; please plant your sentence again in a moment.';

export const localRouteUnavailableMessage = () =>
  'The local model route is unavailable. Start the configured local runtime and try again.';

export const resolveRouteTemperature = () => PRO_MODEL_TEMPERATURE;

export const estimateProOutputBudget = () => PRO_MAX_OUTPUT_TOKENS;

export const resolveRouteMaxOutputTokens = (_modelRoute = 'pro', sentence = '') =>
  estimateProOutputBudget(sentence);

export const resolveModelTimeoutMs = (model, modelRoute = 'pro') => {
  if (modelRoute === 'pro' && PRO_ROUTE_TIMEOUT_MS > 0) {
    return PRO_ROUTE_TIMEOUT_MS;
  }
  if (Number.isFinite(MODEL_CALL_TIMEOUT_MS) && MODEL_CALL_TIMEOUT_MS > 0) {
    return MODEL_CALL_TIMEOUT_MS;
  }
  const routeSpecificTimeoutMs = modelRoute === 'pro'
    ? PRO_MODEL_TIMEOUT_MS
    : model === PRIMARY_MODEL
      ? PRIMARY_MODEL_TIMEOUT_MS
      : PRO_MODEL_TIMEOUT_MS;
  if (routeSpecificTimeoutMs > 0) {
    return routeSpecificTimeoutMs;
  }
  // Never return 0 here. withTimeout() treats non-finite/zero as "no timeout",
  // which lets a hung provider call block the entire Pro route forever.
  return modelRoute === 'pro' ? DEFAULT_PRO_MODEL_TIMEOUT_MS : DEFAULT_PRIMARY_MODEL_TIMEOUT_MS;
};

export const getRemainingRequestBudgetMs = (requestStartedAt, modelRoute = 'pro') => {
  if (modelRoute === 'pro' && PRO_ROUTE_REQUEST_BUDGET_MS > 0) {
    return Math.max(0, PRO_ROUTE_REQUEST_BUDGET_MS - (Date.now() - requestStartedAt));
  }
  if (!(Number.isFinite(REQUEST_BUDGET_MS) && REQUEST_BUDGET_MS > 0)) {
    if (modelRoute === 'pro') {
      return Number.POSITIVE_INFINITY;
    }
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
