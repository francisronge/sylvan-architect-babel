#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="http://127.0.0.1:5177/api/parse"
TMP_JSON="/tmp/babel_multilang_resp.json"

cases=$(cat <<'CASES'
English|The farmer eats the pig
Irish|Ní bhfuair siad amach riamh cé a bhí ag goid
French|Le fermier mange le cochon
Spanish|El granjero come el cerdo
German|Der Bauer isst das Schwein
Italian|Il contadino mangia il maiale
Portuguese|O fazendeiro come o porco
Dutch|De boer eet het varken
Polish|Rolnik je świnię
Turkish|Çiftçi domuzu yiyor
CASES
)

ok=0
fail=0

while IFS='|' read -r lang sentence; do
  [ -z "$lang" ] && continue
  payload=$(node -e 'const s=process.argv[1];process.stdout.write(JSON.stringify({sentence:s,framework:"xbar"}));' "$sentence")
  start=$(date +%s)
  http=$(curl -sS -o "$TMP_JSON" -w "%{http_code}" -X POST "$ENDPOINT" -H 'Content-Type: application/json' --data "$payload" --max-time 180 || true)
  end=$(date +%s)
  ms=$(( (end - start) * 1000 ))

  if [ "$http" != "200" ]; then
    fail=$((fail+1))
    code=$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j?.error?.code||"HTTP_ERROR"));}catch{process.stdout.write("HTTP_ERROR");}' "$TMP_JSON")
    echo "FAIL | $lang | status=$http | code=$code | ${ms}ms"
    continue
  fi

  row=$(node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const sentence=process.argv[2];
const norm=(s)=>String(s||"").normalize("NFKC").toLowerCase().replace(/[“”"'"'"'`´‘’]/g,"").replace(/[^\\p{L}\\p{N}\\s-]/gu," ").replace(/\\s+/g," ").trim();
const toks=norm(sentence).split(" ").filter(Boolean);
function leaves(n,o=[]){if(!n||typeof n!=="object") return o; const c=Array.isArray(n.children)?n.children:[]; if(c.length===0){const s=typeof n.word==="string"&&n.word.trim()?n.word.trim():String(n.label||"").trim(); if(s)o.push(norm(s)); return o;} for(const k of c) leaves(k,o); return o;}
function has(n,l){if(!n||typeof n!=="object") return false; if(String(n.label||"").trim().toUpperCase()===l) return true; const c=Array.isArray(n.children)?n.children:[]; return c.some((k)=>has(k,l));}
const tree=j?.analyses?.[0]?.tree||null;
const lf=leaves(tree,[]);
const missing=toks.filter((t)=>!lf.includes(t));
const out={model:j.modelUsed||"",fallback:!!j.fallbackUsed,missing:missing.join(","),hasD:has(tree,"D"),hasN:has(tree,"N"),hasV:has(tree,"V")};
process.stdout.write(JSON.stringify(out));
' "$TMP_JSON" "$sentence")

  model=$(node -e 'const r=JSON.parse(process.argv[1]);process.stdout.write(r.model);' "$row")
  fb=$(node -e 'const r=JSON.parse(process.argv[1]);process.stdout.write(String(r.fallback));' "$row")
  missing=$(node -e 'const r=JSON.parse(process.argv[1]);process.stdout.write(r.missing||"-");' "$row")
  hasD=$(node -e 'const r=JSON.parse(process.argv[1]);process.stdout.write(String(r.hasD));' "$row")
  hasN=$(node -e 'const r=JSON.parse(process.argv[1]);process.stdout.write(String(r.hasN));' "$row")
  hasV=$(node -e 'const r=JSON.parse(process.argv[1]);process.stdout.write(String(r.hasV));' "$row")

  ok=$((ok+1))
  echo "OK   | $lang | model=$model | fallback=$fb | missing=$missing | D/N/V=$hasD/$hasN/$hasV | ${ms}ms"
done <<< "$cases"

echo "---"
echo "SUMMARY ok=$ok fail=$fail total=$((ok+fail))"
