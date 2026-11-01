# Qualification runs

How to generate real model analyses for development and qualification. The
rules that govern qualification batches are in `CONTEXT.md`.

## Accounts

- OpenAI: `npm run qualification:codex` with the user's Codex (ChatGPT
  subscription) login. Never substitute API-key requests or a paid fallback
  without the user's explicit authorization.
- Anthropic: `npm run qualification:anthropic` with the API key in the macOS
  Keychain item `Babel Anthropic API`, whose Console organization receives the
  Max plan's API credits. Never use another key or organization without
  the user's explicit authorization.

Keep credentials out of artifacts, repositories and public CI.

## In the app

```sh
npm run qualification:codex:app
```

Open `http://127.0.0.1:8454/`. The sentence box, framework selector, Replay and
browser-local Tree Bank are the real app components. GPT-6.1
Sol at high effort is the default; GPT-6 Astra and GPT-6 Sol are also
available. Each Parse runs the OAuth runner once and saves its artifacts under
`~/Library/Application Support/Babel/codex-qualification`. The app fingerprints
the working tree, including uncommitted changes, and the receipt records whether
those sources match the named commit. `-- --out DIRECTORY --port NUMBER` changes
the archive or port. Closing the page cancels its unfinished request and keeps
what arrived. This does not enable OAuth on Babel's public provider routes.

## From the command line

```sh
npm run qualification:codex -- --sentence 'Mia laughed.' --framework xbar \
  --out /tmp/babel-sol-check --run
npm run qualification:anthropic -- --sentence 'Mia laughed.' --framework xbar \
  --out /tmp/babel-opus-check --run
npm run qualification:review -- --run /tmp/babel-sol-check
```

- Each invocation needs a new output directory and makes exactly one request,
  with no retries or model fallbacks.
- Omit `--run` to save and inspect the request without credentials or network.
- The CLI requires committed contract sources; `--working-tree` fingerprints
  uncommitted ones instead.
- Codex defaults to GPT-6.1 Sol at high effort; `--model openai:gpt-6-astra`
  selects GPT-6 Astra and `--model openai:gpt-6-sol` GPT-6 Sol. `--auth-file`
  selects another Codex login (default
  `$CODEX_HOME/auth.json` or `~/.codex/auth.json`). An expired token needs a
  fresh `codex login`.
- Anthropic defaults to Claude Opus 5.5 at high effort.

## What the runners send

The Codex runner sends Babel's exact prompts to the Codex Responses endpoint. It
launches no agent and loads no Codex instructions, history, tools, skills, project
files or profile configuration; it reads only the login file, in memory. The
subscription endpoint requires streaming and `store: false`; background polling
and the API output-token limit are omitted and recorded as transport differences.
These are subscription development checks, not verification of the public API
route or proof that the backend behaves identically to the paid API.

The Anthropic runner sends the request Babel's Anthropic route builds, adding only
`stream: true`. It reads the key from the Keychain into memory and never writes it.

Both runners send Babel's prompts unchanged and apply Babel's spelling check
through `contractQualification/spelloutArtifacts.js`. The analyses that pass
become one attempt over their shared word list; each analysis that fails is
recorded as its own attempt, and `spellout.json` keeps the alignment. (The app
instead rejects a response when any analysis fails the check.)

## Artifacts

Every output directory, its new parents and every artifact are readable only by
the owner. Artifacts include the exact request, source fingerprint, received SSE
bytes, terminal provider response and usage, extracted output and Babel's usual
inspection evidence. Only a provider-confirmed complete response enters Babel
processing; partial output stays in `output.txt` and `response.sse`, and
cancellation saves what has arrived. There is no client-imposed time limit.

- `transport-diagnostics.ndjson` is appended during the request: five-second
  checkpoints, provider and request IDs, HTTP/TLS lifecycle events, known
  socket-error codes, cancellation and local runner failures. It survives a
  killed runner. It excludes credentials, cookies, socket addresses and arbitrary
  error messages. A remote socket closure identifies a transport failure, but
  naming the responsible backend needs its logs and the captured IDs.
- An interruption stays a failed transport observation; no replacement request
  or invented usage is added.
- Receipts record a hypothetical API cost in USD from dated, sourced Standard
  global rates, with provider-specific cache accounting (reasoning is already in
  output tokens). Missing usage stays unpriced; missing cache details give a
  range. Retained estimates keep their pricing date when rates change. For Codex this is not a subscription charge; for Anthropic it estimates
  the credit charge, and the Console shows the actual one.

The runners work from a local or private remote checkout with Node 24 and
`npm ci`; they do not provision a machine or copy a login.
