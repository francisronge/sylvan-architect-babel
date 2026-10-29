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

## What Jev is, and what it sees

Jev is TypeSafe's System One model (https://docs.typesafe.ai). It does not
generate text: it is sent a state and typed questions and returns, for each
Choice question, the chosen option, a probability for every option and a
confidence. Babel uses only Choice questions.

The state (`jevState` in `contractQualification/jev.js`) is the claim's own
words: the relation name, the role keys and the value keys and strings. It
carries no sentence, tree, node, label, word or id. Before each request the
runner rebuilds it with every anchor id replaced and sends it only if the two
are identical (`anchorIdsReachRequest`), so an id spelled like one of the
claim's words is still never read from the tree.

The options are closed and come from Babel's code (`replay/relations/jev.ts`):

- the families are the Tier-2 recipes of `tier2FacetRecipes.ts`, with their
  anchor concepts as role slots and their value concepts as value slots;
- movement families are not offered. Movement is recognised from the tree
  (`structuralMovement.ts`), and its endpoints are read by the movement
  reader's own vocabulary, which an alias does not reach.

## The questions

Each claim is asked in at most two requests over the same state:

1. One Choice, `family`: `none` and every family offered for the claim, each
   described by what it draws and its role and value slots.
2. Only when the family is not `none`: one Choice per role key over that
   family's role slots and `none`, and one per value key over its value slots
   and `none`. A family without value slots asks nothing about value keys.

The second request exists because its options depend on the first answer.
Asking every family's slots in one request would make the median benchmark
claim 129 questions and the largest 497, near the 64k-token request limit;
two requests keep the first one small and add a round trip only for claims
given a family. `none` is listed first in every option list: Jev 1.13 is
documented to lean toward the first option, and the safe lean is toward
leaving the claim neutral.

Jev maps a key only when the key's own words say what the slot says. A key
naming only a position or a category, such as `head`, `specifier` or
`complement`, maps to `none`: which of them is a source or a target is a claim
about the syntax, and structure cannot check it. A key whose name qualifies its
participant, such as `potentialLocalBinder` or `failedGoal`, is not that
participant and maps to `none`.

`readChoiceAnswer` accepts an answer only when its choice is one of the
options asked, it gives a probability from 0 to 1 for exactly those options,
the probabilities sum to one within rounding, the choice is the most probable
option and its confidence follows from the probabilities by TypeSafe's
documented formula. A response with an answer missing or to a question not
asked is rejected whole. The assembled answer then passes `validateJevAnswer`,
which rejects it if any part lies outside the claim's sets: an unknown family,
a key the claim did not author, a slot of another family, a slot under `none`,
an extra field. Jev therefore cannot name a node, add a value or invent a
relation.

## Confidence

A reading's confidence is the least confidence of the answers it is made of:
the family and every key's slot. Replay applies a saved reading only when that
confidence is at least `JEV_CONFIDENCE_THRESHOLD`. The record keeps every
checked answer with its confidence, so a new threshold needs no new requests.

The threshold is 0.9, provisional: TypeSafe's examples gate a reversible
action at 0.6 and an irreversible one at 0.85, and a wrong drawing teaches a
wrong analysis even when structure accepts it. It is calibrated on the live
benchmark with `scripts/calibrateJev.mjs`, which reapplies every saved record
at thresholds from 0.50 to 1.00 and counts, at each, the readings that reach
it, those that stand, and those that disagree with reviewed reference
readings. The adopted threshold is the lowest with no disagreement, after the
standing readings without a reference have been reviewed. Pin the model
version the threshold was calibrated on (`jev-1.14.0`); `jev-latest` moves.

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
{ "version": 2, "mappings": [{ "stageIndex": 1, "relationIndex": 0,
  "terms": { "relation": "theta-marking", "roles": ["assigner", "assignee"], "values": { "role": ["Theme"] } },
  "answer": { "family": "theta-grid", "roles": { "assigner": "predicate", "assignee": "theta.arguments" },
    "values": { "role": "role.label" } }, "confidence": 0.94 }],
  "provenance": { "service": "typesafe", "requestedModel": "jev-1.14.0", "models": ["jev-1.14.0"],
    "promptVersion": "jev-ts-1", "at": "…", "thresholdAtRun": 0.9 } }
```

A mapping applies only to the claim at that position whose words equal its
`terms`, and it is checked again against the threshold, the closed sets and
the whole-claim rule when read. Version 1 records, which carry no confidence,
never apply. Replay
takes the record as `prepareReplay({ …, jev })` and never calls a model, so it
stays offline and repeatable. With no record, or no applicable mapping, plans
are byte-identical to today's.

A reading that stands can inform later claims the way any drawn claim does,
for example through assignment continuity.

## Running it

```sh
node scripts/runJev.mjs --cases cases.json --out DIR --dry-run
node scripts/runJev.mjs --cases cases.json --out DIR --run [--key-file PATH | --keychain-item NAME]
node scripts/calibrateJev.mjs --cases cases.json --run DIR --reference readings.json
```

`--run` posts each request once to `https://api.typesafe.ai/v1/systemone`
with plain `fetch`, no SDK and no retries; a 429 or 529 is recorded as a
failed request. The API key is read into memory from `--key-file PATH` or the
macOS Keychain item `Babel TypeSafe API` (`--keychain-item` names another),
and is never written or logged; without one the runner stops before writing
anything and names both options. `--dry-run` builds and saves every first
request and sizes the largest possible second one, with no key and no
network. Every request, the received bytes, the answer check, per-analysis
receipt and record and a summary with the cost at TypeSafe's published price
(input tokens only; output is free) are kept, readable only by the owner.

## Where the record lives

Only in qualification runs, beside the run (`runs/<run>/…/jev.json` or the
benchmark directory), passed to `prepareReplay` by the tools that read those
runs. The app makes no Jev call, the parse response does not change and the
Personal Tree Bank stores no Jev record.

Open product question: whether Jev's record should reach the app, and if so
whether it travels in the parse response or the Tree Bank record, and whether
the app runs Jev after a parse. Each is a new provider call or a contract
change, and needs Francis's decision.
