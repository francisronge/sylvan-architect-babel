#!/usr/bin/env bash
set -euo pipefail

npm run dev > /tmp/babel-multilang-dev.log 2>&1 &
DEV_PID=$!
cleanup(){ kill "$DEV_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for _ in $(seq 1 50); do
  if curl -s --max-time 2 http://127.0.0.1:5177 >/dev/null; then
    break
  fi
  sleep 0.2
done

run_case(){
  local lang="$1"
  local sentence="$2"
  local payload response_file http_code start end ms code meta

  payload=$(node -e 'const s=process.argv[1];process.stdout.write(JSON.stringify({sentence:s,framework:"xbar"}));' "$sentence")
  response_file=$(mktemp)
  start=$(date +%s)
  http_code=$(curl -sS -o "$response_file" -w "%{http_code}" -X POST http://127.0.0.1:5177/api/parse -H 'Content-Type: application/json' --data "$payload" --max-time 180 || true)
  end=$(date +%s)
  ms=$(( (end - start) * 1000 ))

  if [[ "$http_code" != "200" ]]; then
    code=$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j?.error?.code||"HTTP_ERROR"));}catch{process.stdout.write("HTTP_ERROR");}' "$response_file")
    echo "FAIL | $lang | status=$http_code | code=$code | ${ms}ms"
    rm -f "$response_file"
    return
  fi

  meta=$(node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const tree=j?.analyses?.[0]?.tree;
const has=(n,l)=>{if(!n||typeof n!=="object")return false; if(String(n.label||"").trim().toUpperCase()===l)return true; const c=Array.isArray(n.children)?n.children:[]; return c.some(k=>has(k,l));};
process.stdout.write([j.modelUsed||"", !!j.fallbackUsed, Array.isArray(j.analyses)?j.analyses.length:0, has(tree,"D"), has(tree,"N"), has(tree,"V")].join("\t"));
' "$response_file")

  rm -f "$response_file"
  echo "OK   | $lang | model=$(echo "$meta" | cut -f1) | fallback=$(echo "$meta" | cut -f2) | analyses=$(echo "$meta" | cut -f3) | D/N/V=$(echo "$meta" | cut -f4)/$(echo "$meta" | cut -f5)/$(echo "$meta" | cut -f6) | ${ms}ms"
}

run_case "English" "The farmer eats the pig"
run_case "Irish" "Ní bhfuair siad amach riamh cé a bhí ag goid"
run_case "French" "Le fermier mange le cochon"
run_case "Spanish" "El granjero come el cerdo"
run_case "German" "Der Bauer isst das Schwein"
run_case "Italian" "Il contadino mangia il maiale"
run_case "Polish" "Rolnik je świnię"
run_case "Turkish" "Çiftçi domuzu yiyor"
