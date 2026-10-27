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
contract failure is not asked about.

## What it sees and what it may answer

The question (`contractQualification/jev.js`) carries, for each claim, the
relation name, the role keys and the value keys and strings. It carries no
sentence, tree, node, label, word or id.

The answer is closed. For each claim Jev names one family, or `none`, and maps
each of the claim's own keys to one slot of that family, or `none`. The
families and slots come from Babel's code (`replay/relations/jev.ts`):

- an unregistered relation is offered the Tier-2 recipes of
  `tier2FacetRecipes.ts`, with their anchor concepts as role slots and their
  value concepts as value slots;
- an exactly registered relation is offered only its own Tier-1 family, with
  the registered role names as slots, so Tier 2 never stands in for a
  registered claim;
- movement families are not offered. Movement is recognised from the tree
  (`structuralMovement.ts`), and its endpoints are read by the movement
  reader's own vocabulary, which an alias does not reach.

Jev maps a key only when the key's own words say what the slot says. A key
naming only a position or a category, such as `head`, `specifier` or
`complement`, maps to `none`: which of them is a source or a target is a claim
about the syntax, and structure cannot check it.

`validateJevAnswer` rejects the whole answer if any part lies outside these
sets: an unknown family, a key the claim did not author, a slot of another
family, a slot under `none`, an extra field. Jev therefore cannot name a node,
add a value or invent a relation.

## How a reading is used

A checked answer is an alias layer for that one claim. `jevSynonymIndex`
copies the synonym index and makes each mapped key read as its slot's concept
and nothing else; every other spelling is unchanged. Dispatch
(`dispatchStagesInOrder` in `tier2RelationDispatch.ts`) reads the claim again
with that index, through the same Tier-1 binding, Tier-2 recipes and structure
checks as any claim. The reading stands only when the claim then draws, and
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
  "provenance": { "model": "openai:gpt-6.1-sol", "effort": "high", "promptVersion": "jev-2", "requestSha256": "…" } }
```

A mapping applies only to the claim at that position whose words equal its
`terms`, and it is checked again against the closed sets when read. Replay
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

## Not yet decided

- Where the record lives in the product: beside the analysis in the parse
  response, in the Personal Tree Bank record, or only in qualification runs.
  The prototype keeps it beside the run and passes it to `prepareReplay`.
- Whether the app runs Jev itself after a parse; that is a new provider call
  and a contract change.
