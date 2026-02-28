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

const endpoint = 'http://127.0.0.1:5177/api/parse';

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

const categoryNodes = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  const kids = Array.isArray(node.children) ? node.children : [];
  if (kids.length > 0) out.push(String(node.label || '').trim());
  for (const c of kids) categoryNodes(c, out);
  return out;
};

(async () => {
  const results = [];

  for (const c of cases) {
    const t0 = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sentence: c.sentence, framework: 'xbar' })
      });
      const ms = Date.now() - t0;
      let payload = null;
      try { payload = await res.json(); } catch {}

      if (!res.ok) {
        results.push({
          lang: c.lang,
          sentence: c.sentence,
          ok: false,
          status: res.status,
          code: payload?.error?.code || 'HTTP_ERROR',
          message: payload?.error?.message || '',
          ms
        });
        continue;
      }

      const tree = payload?.analyses?.[0]?.tree;
      const inputTokens = tokenize(c.sentence);
      const leafTokens = leaves(tree, []).map(norm).filter(Boolean);
      const missing = inputTokens.filter((tok) => !leafTokens.includes(tok));
      const cats = categoryNodes(tree, []);

      results.push({
        lang: c.lang,
        sentence: c.sentence,
        ok: true,
        status: res.status,
        model: payload?.modelUsed || null,
        fallback: !!payload?.fallbackUsed,
        ms,
        analyses: Array.isArray(payload?.analyses) ? payload.analyses.length : 0,
        missingTokens: missing,
        categoryLabelCount: cats.length,
        sampleTopLabels: cats.slice(0, 12)
      });
    } catch (e) {
      results.push({
        lang: c.lang,
        sentence: c.sentence,
        ok: false,
        status: 0,
        code: e?.name || 'FETCH_ERROR',
        message: e?.message || String(e),
        ms: Date.now() - t0
      });
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    fallbackCount: results.filter((r) => r.ok && r.fallback).length,
    missingTokenIssues: results.filter((r) => r.ok && r.missingTokens.length > 0).length,
    avgMs: Math.round(results.reduce((a, r) => a + (r.ms || 0), 0) / Math.max(1, results.length))
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
})();
