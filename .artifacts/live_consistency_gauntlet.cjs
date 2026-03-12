const fs = require('fs');
const path = require('path');
require('./helpers/loadLocalEnv.cjs')();
const { parseSentenceWithGemini } = require('../server/geminiParser');

const cases = [
  { framework: 'xbar', sentence: 'The student said that the lecture ended early.' },
  { framework: 'xbar', sentence: 'Per sa at Eva kom tidlig.' },
  { framework: 'xbar', sentence: 'Marie a dit que Paul partirait.' },
  { framework: 'xbar', sentence: 'Giulia pensa che Paolo dorma.' },
  { framework: 'xbar', sentence: 'Hat Maria den Brief gelesen?' },
  { framework: 'xbar', sentence: 'Ha comprado Ana el libro?' },
  { framework: 'minimalism', sentence: 'Czy Piotr zamknal drzwi?' },
  { framework: 'minimalism', sentence: 'Melyik konyvet vette meg Anna?' },
  { framework: 'minimalism', sentence: 'Welke film heeft Noor bekeken?' },
  { framework: 'xbar', sentence: 'Gheall se go bhfillfeadh se ar an bhaile.' }
];

const outDir = path.join(process.cwd(), '.artifacts', `live-consistency-${new Date().toISOString().replace(/[:.]/g,'-')}`);
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function collectLeaves(tree) {
  const leaves = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = String(node.word || node.label || '').trim();
      if (surface && !/^(t(?:race)?(?:[_-]?[a-z0-9]+)?|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i.test(surface)) {
        leaves.push(surface);
      }
      return;
    }
    children.forEach(visit);
  };
  visit(tree);
  return leaves;
}

async function runCase(testCase) {
  const attempts = [];
  for (let i = 0; i < 4; i += 1) {
    try {
      const bundle = await parseSentenceWithGemini(testCase.sentence, testCase.framework, 'flash-lite');
      const analysis = bundle?.analyses?.[0];
      const result = {
        ok: true,
        sentence: testCase.sentence,
        framework: testCase.framework,
        modelUsed: bundle?.metadata?.modelUsed || null,
        leaves: collectLeaves(analysis?.tree),
        surfaceOrder: analysis?.surfaceOrder || null,
        movementEvents: Array.isArray(analysis?.movementEvents) ? analysis.movementEvents : [],
        derivationOps: Array.isArray(analysis?.derivationSteps) ? analysis.derivationSteps.map((s) => s.operation) : [],
        explanation: analysis?.explanation || '',
        interpretation: analysis?.interpretation || '',
        bracketedNotation: analysis?.bracketedNotation || ''
      };
      attempts.push({ attempt: i + 1, ok: true, result });
      return { final: result, attempts };
    } catch (error) {
      const entry = {
        attempt: i + 1,
        ok: false,
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || String(error)
      };
      attempts.push(entry);
      if (error?.status === 503) {
        await sleep(5000);
        continue;
      }
      break;
    }
  }
  return { final: null, attempts };
}

(async () => {
  const report = [];
  for (const testCase of cases) {
    const outcome = await runCase(testCase);
    report.push({ ...testCase, ...outcome });
    fs.writeFileSync(
      path.join(outDir, `${testCase.framework}-${testCase.sentence.replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,80)}.json`),
      JSON.stringify({ ...testCase, ...outcome }, null, 2)
    );
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outDir, report }, null, 2));
})();
