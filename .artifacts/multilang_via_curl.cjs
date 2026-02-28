const { spawnSync } = require('node:child_process');

const endpoint = 'http://127.0.0.1:5177/api/parse';

const cases = [
  { lang: 'English', sentence: 'The farmer eats the pig' },
  { lang: 'Irish', sentence: 'Ní bhfuair siad amach riamh cé a bhí ag goid' },
  { lang: 'French', sentence: 'Le fermier mange le cochon' },
  { lang: 'Spanish', sentence: 'El granjero come el cerdo' },
  { lang: 'German', sentence: 'Der Bauer isst das Schwein' },
  { lang: 'Italian', sentence: 'Il contadino mangia il maiale' },
  { lang: 'Portuguese', sentence: 'O fazendeiro come o porco' },
  { lang: 'Dutch', sentence: 'De boer eet het varken' },
  { lang: 'Swedish', sentence: 'Bonden äter grisen' },
  { lang: 'Polish', sentence: 'Rolnik je świnię' },
  { lang: 'Turkish', sentence: 'Çiftçi domuzu yiyor' },
  { lang: 'Japanese (romaji)', sentence: 'Noufu ga buta o taberu' }
];

const norm = (s) => String(s || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[“”"'`´‘’]/g, '')
  .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenize = (s) => norm(s).split(' ').filter(Boolean);

const leaves = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  const kids = Array.isArray(node.children) ? node.children : [];
  if (kids.length === 0) {
    const surface = typeof node.word === 'string' && node.word.trim()
      ? node.word.trim()
      : (node.label || '').trim();
    if (surface) out.push(surface);
    return out;
  }
  for (const c of kids) leaves(c, out);
  return out;
};

const hasHeadLabel = (node, wanted, out = { found: false }) => {
  if (!node || typeof node !== 'object' || out.found) return out;
  if (String(node.label || '').trim().toUpperCase() === wanted) out.found = true;
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const c of kids) hasHeadLabel(c, wanted, out);
  return out;
};

const results = [];

for (const c of cases) {
  const payload = JSON.stringify({ sentence: c.sentence, framework: 'xbar' });
  const start = Date.now();
  const curl = spawnSync('curl', [
    '-sS',
    '-w', '\n__HTTP__%{http_code}',
    '-X', 'POST',
    endpoint,
    '-H', 'Content-Type: application/json',
    '--data', payload
  ], { encoding: 'utf8' });
  const ms = Date.now() - start;

  if (curl.status !== 0) {
    results.push({
      lang: c.lang,
      sentence: c.sentence,
      ok: false,
      status: 0,
      code: 'CURL_FAILED',
      message: (curl.stderr || '').trim() || 'curl failed',
      ms
    });
    continue;
  }

  const out = curl.stdout || '';
  const marker = '\n__HTTP__';
  const idx = out.lastIndexOf(marker);
  if (idx < 0) {
    results.push({ lang: c.lang, sentence: c.sentence, ok: false, status: 0, code: 'BAD_CURL_OUTPUT', message: 'Missing HTTP marker', ms });
    continue;
  }

  const bodyText = out.slice(0, idx);
  const status = Number(out.slice(idx + marker.length).trim()) || 0;

  let body = null;
  try { body = JSON.parse(bodyText); } catch {
    results.push({ lang: c.lang, sentence: c.sentence, ok: false, status, code: 'NON_JSON', message: bodyText.slice(0, 200), ms });
    continue;
  }

  if (status < 200 || status >= 300) {
    results.push({
      lang: c.lang,
      sentence: c.sentence,
      ok: false,
      status,
      code: body?.error?.code || 'HTTP_ERROR',
      message: body?.error?.message || '',
      ms
    });
    continue;
  }

  const tree = body?.analyses?.[0]?.tree;
  const inputTokens = tokenize(c.sentence);
  const leafTokens = leaves(tree, []).map(norm).filter(Boolean);
  const missingTokens = inputTokens.filter((t) => !leafTokens.includes(t));

  results.push({
    lang: c.lang,
    sentence: c.sentence,
    ok: true,
    status,
    ms,
    model: body?.modelUsed || null,
    fallback: !!body?.fallbackUsed,
    analyses: Array.isArray(body?.analyses) ? body.analyses.length : 0,
    missingTokens,
    hasD: hasHeadLabel(tree, 'D').found,
    hasN: hasHeadLabel(tree, 'N').found,
    hasV: hasHeadLabel(tree, 'V').found
  });
}

const summary = {
  total: results.length,
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  fallbackUsed: results.filter((r) => r.ok && r.fallback).length,
  missingTokenIssues: results.filter((r) => r.ok && r.missingTokens.length > 0).length,
  avgMs: Math.round(results.reduce((a, r) => a + (r.ms || 0), 0) / Math.max(1, results.length))
};

console.log(JSON.stringify({ summary, results }, null, 2));
