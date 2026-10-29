# Jev

Jev maps the model's words to Babel's words; Babel decides everything else.

## What it is

The model does the linguistics. Jev is part of Babel's recognition, like the
synonym index in `replay/relations/tier2Synonyms.ts`: it reads the model's own
terms. The synonym index reads the role and value names Babel already knows,
and that list is frozen. Jev reads the names it cannot, such as `assignee` or
`valuee`, and says which of Babel's slot names each one means. Babel's existing
checks then read the tree as they do for every claim. Jev never judges,
completes or extends the analysis.

## When it runs

Once, after generation, for one analysis. It is asked only about claims that
recognition leaves wholly neutral (`replay/jevClaims.ts`). A relation with a
contract failure is not asked about, and neither is a relation with an exactly
registered (Tier-1) name: re-reading the keys of a malformed registered claim
would repair it, and a malformed exact Tier-1 claim stays neutral.

## What it sees and what it may answer

The question (`contractQualification/jev.js`) carries, for each claim, the
relation name, the role keys and the value keys and strings. It carries no
sentence, tree, node, label, word or id.

The answer is closed. For each claim Jev names one family, or `none`, and maps
each of the claim's own keys to one slot of that family, or `none`. The
families and slots come from Babel's code (`replay/relations/jev.ts`):

- the families are the Tier-2 recipes of `tier2FacetRecipes.ts`, with their
  anchor concepts as role slots and their value concepts as value slots;
- movement families are not offered. Movement is recognised from the tree
  (`structuralMovement.ts`), and its endpoints are read by the movement
  reader's own vocabulary, which an alias does not reach.

Jev maps a key only when the key's own words say what the slot says. A key
naming only a position or a category, such as `head`, `specifier` or
`complement`, maps to `none`: which of them is a source or a target is a claim
about the syntax, and structure cannot check it. A key whose name qualifies its
participant, such as `potentialLocalBinder` or `failedGoal`, is not that
participant and maps to `none`.

`validateJevAnswer` rejects the whole answer if any part lies outside these
sets: an unknown family, a key the claim did not author, a slot of another
family, a slot under `none`, an extra field. Jev therefore cannot name a node,
add a value or invent a relation.

## How a reading is used

A checked answer is used only when it reads the whole claim (`jevReadingGap`):
every anchor key maps to a slot, and no two keys share a slot the recipe fills
with one participant. A key left out would keep its old meaning beside the new
ones; in the benchmark that drew a successful binding path from a "potential
binder" to the pronoun it does not bind, and coindexed two split antecedents
with each other. Two keys on one participant slot, such as an introducer and a
lexical verb both read as the predicate, would let the recipe choose between
them.

Such an answer is an alias layer for that one claim. `jevSynonymIndex`
copies the synonym index and makes each mapped key read as its slot's concept
and nothing else; every other spelling is unchanged. Dispatch
(`dispatchStagesInOrder` in `tier2RelationDispatch.ts`) reads the claim again
with that index, through the same Tier-2 recipes and structure checks as any
claim. The reading stands only when the claim then draws, and
draws only the family Jev named (`jevReadingDraws`). Otherwise the claim keeps
exactly its neutral dispatch. The authored relation, its keys and its values
are never changed; drawn items keep the authored `relationRef`.

## Saved and offline

The answers are saved as the analysis's Jev record:

```json
{ "version": 1, "mappings": [{ "stageIndex": 1, "relationIndex": 0,
  "terms": { "relation": "theta-marking", "roles": ["assigner", "assignee"], "values": { "role": ["Theme"] } },
  "answer": { "family": "theta-grid", "roles": { "assigner": "predicate", "assignee": "theta.arguments" },
    "values": { "role": "role.label" } } }],
  "provenance": { "model": "openai:gpt-6.1-sol", "effort": "high", "promptVersion": "jev-3", "requestSha256": "…" } }
```

A mapping applies only to the claim at that position whose words equal its
`terms`, and it is checked again against the closed sets and the whole-claim
rule when read. Replay
takes the record as `prepareReplay({ …, jev })` and never calls a model, so it
stays offline and repeatable. With no record, or no applicable mapping, plans
are byte-identical to today's.

A reading that stands can inform later claims the way any drawn claim does,
for example through assignment continuity.

## Running it

`node scripts/runJev.mjs --cases cases.json --out DIR --run` sends one request
per analysis through the Codex subscription login (`codexOAuth.js`), at most
two at a time, with no retries. GPT-6.1 Sol at high effort is the default. The
reply is plain-text JSON checked by Babel; no provider schema is used. Each
request, the received bytes, the reply check, the receipt with usage and the
record are kept, readable only by the owner. Without `--run` it only saves the
requests.

## Where the record lives

Only in qualification runs, beside the run (`runs/<run>/…/jev.json` or the
benchmark directory), passed to `prepareReplay` by the tools that read those
runs. The app makes no Jev call, the parse response does not change and the
Personal Tree Bank stores no Jev record.

Open product question: whether Jev's record should reach the app, and if so
whether it travels in the parse response or the Tree Bank record, and whether
the app runs Jev after a parse. Each is a new provider call or a contract
change, and needs Francis's decision.
