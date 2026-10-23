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

export const OPENAI_BACKGROUND_POLL_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.OPENAI_BACKGROUND_POLL_INTERVAL_MS || 5000)
);
const PROVIDER_MODEL_TIMEOUT_MS = Math.max(0, Number(process.env.BABEL_PROVIDER_MODEL_TIMEOUT_MS || 0));
const PROVIDER_REQUEST_BUDGET_MS = Math.max(0, Number(process.env.BABEL_PROVIDER_REQUEST_BUDGET_MS || 900000));
const DEFAULT_PROVIDER_MODEL_TIMEOUT_MS = 900000;

// Never return 0 here. withTimeout() treats non-finite/zero as "no timeout".
export const resolveModelTimeoutMs = () =>
  PROVIDER_MODEL_TIMEOUT_MS > 0 ? PROVIDER_MODEL_TIMEOUT_MS : DEFAULT_PROVIDER_MODEL_TIMEOUT_MS;

export const getRemainingRequestBudgetMs = (requestStartedAt) =>
  Math.max(0, PROVIDER_REQUEST_BUDGET_MS - (Date.now() - requestStartedAt));

export const resolveRequestTimeoutMs = ({ baseTimeoutMs, remainingBudgetMs }) => {
  const budgetCap = Number.isFinite(remainingBudgetMs)
    ? Math.max(1200, remainingBudgetMs - 250)
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(baseTimeoutMs) || baseTimeoutMs <= 0) {
    return Math.max(1200, budgetCap);
  }
  return Math.max(1200, Math.min(baseTimeoutMs, budgetCap));
};
