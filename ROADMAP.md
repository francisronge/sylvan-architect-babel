# Babel Roadmap

Status date: 2026-11-03

This is Babel's single list of remaining work, in order. Completed work and its
evidence live in Git history. Durable rules and contracts live in the canonical
documents listed in [the documentation map](docs/README.md).

Babel must accommodate all languages. Test languages expose general limitations;
they do not define a supported-language allowlist or authorize language-specific
syntactic rules. Desktop remains the primary experience.

## Current work order

The focus now is designing public Babel (Francis, 3 Nov 2026): "Make the UI
really good and simple, make the treebank much more interesting (make it into
a syntaciticians workbench without being super opinionated, we'll start off
simple and minimalistic)". Items 1 to 4 are launch work, in order; items 5 to 8
are not.

1. **Public Babel's UI** (Program 3): a new public front end on the shared
   engine, with today's first screen minus its framework switch (Minimalism
   only); Replay as the only view; no model controls; automatic saving; a
   small way back to the input screen; the waiting screen; the failure
   screen. Today's app stays as the internal
   one.
2. **The Tree Bank as a syntactician's workbench** (Program 4): a first,
   minimal version inside the Tree Bank, shipped with launch.
3. **Server work**: done in code. A deployed server sends only public
   Babel's request (3B, item 4) and limits parses to 5 per visitor and 100 in
   total a day (Program 5, item 4). Requests that outlive Vercel's 300 s cap
   are done: public Babel starts a background parse and checks back (parse
   tickets, below). Left for deployment: the shared counter store and the
   OpenAI hard spend cap (Program 5, item 4).
4. **Hosting and the Generation Archive**: the checklist in Program 5 and the
   archive in Program 6A.
5. Run Claude Opus 5.5/high batches through `npm run qualification:anthropic` once
   the Max plan's monthly API credits can be claimed. On 2026-10-24 the claim
   option had not yet appeared in Billing. Spend only those credits.
6. Renderer: done for launch. It was launch work (Francis, 2 Nov 2026, on
   calling it optional: "Wtf are you saying? NO"), and Francis decided every
   open item on 3 Nov 2026. What stays below is known and has no fix within
   the rules.
   - **Movements drawn without an arrow** (measured 3 Nov over 3,692 saved
     analyses): on the current and the previous prompt, one across-the-board
     movement into a complex head lacked its arrows; #374 draws them. What
     remains there is one run each: labels written as sets (`{C}`), and a
     Swahili claim whose wording reads phrasal against its name "head
     movement". The other kinds (one claim naming two movements, wording that
     draws only a coindex) appear only on earlier prompts. Claims whose role
     names offer two landings stay neutral by design (18 saved runs).
   - **Motion faults in real analyses**: 368 in the committed corpus after
     #373 and the head-first order (382 before them). By cause on main before
     both (measured 3 Nov): 75 are a parent inserted above
     a host beside a waiting sister (the accepted trade-off below); 128 a
     movement source whose lower occurrence stands at another x; 71 an
     existing node gaining a daughter at a movement; 64 a landing's new parent
     standing at another x; 44 leaves laid out again at a stage crossing.
     Every further fix measured so far moves finished trees (up to 26 of them)
     or widens earlier frames, which Francis declined on 27 Oct.
   - Settled: when one stage moves both a head and a phrase, Replay shows the
     head movement first (approved 2026-10-23; shipped in the head-first PR).
     It fixes the Icelandic raising sentence, a far plaque in Opus n4-13 and
     one phone off-canvas case, and real-analysis motion faults go from 377 to
     368. Francis accepted its new faults on 3 Nov 2026 after the
     click-through pages ("I approve of 1. and 2."; on three more slides:
     "i'm fine with those. yes."): in the Hebrew relative V′ slides 241 units
     where main slid `mi` 1,051; in the German embedded clause the jump comes
     two steps later and grows from 639 to 752, with two more slides (136 and
     164); a German participle tree gains slides of 80 and 63; plaques sit
     1.12–1.2 times their reach in four trees; and the Portuguese coordination
     first paints 25 px off the desktop canvas when stepping back.
   - Settled: a waiting phrase that slides when its new parent is drawn above
     it. A parent stands centred over its daughters, so the phrase or the tree
     above it must move; Francis accepted this on 27 Oct ("alright. then it's
     whatever.").
   - Settled: on phones a moved phrase first paints past the canvas edge, then
     the camera zooms out to it within about a third of a second (8 test trees,
     `MOVED_OFF_CANVAS` in `tests/helpers/cameraExceptions.mjs`). Francis, 3 Nov
     2026, after watching the recordings: "the phone recording is fine."
   - Settled: the Chinese tree with 我 and 昨天 jumps 60 px when stepping back
     into stage 2, the mirror of the forward jump approved on 21 Oct; no carry
     brings it under the 24 px limit (best 30 px). Francis accepted it on
     3 Nov 2026 after the click-through page ("I approve of 1. and 2.").
   - Settled: in compact-current-root a new landing pushes the T head 57 px
     past the phone canvas's left edge as stage 3 begins; only a first pose
     that zooms out (by 16%) would clear it, which changes the shared camera
     rule. Francis accepted it on 3 Nov 2026 ("3. Yes.").
7. Recognition:
   - Neutral relations can earn a shared-lineage coindex or a single-host
     plaque from structure alone; the adjunction fork stays off because
     structure cannot tell scope from modification (see the
     [dispatch spec](docs/design/visual-relations-tier2-shape-dispatch-spec.md#structure-only-recognition-of-neutral-relations)).
     Run the same geometry-first experiment for movement and the other
     relations: measure the wrong-picture rate where Babel already draws, and
     decide whether each further measured rule can claim its whole envelope.
   - Measured over 26,587 relations in about 2,100 saved model analyses
     (29 Oct 2026, grouped by keywords in the names, so rough): relations Babel
     can already draw are often left neutral. Binding and coreference 64%,
     scope and negation 74%, relative clauses 76%, adjunction and modification
     48%. Close these recognition gaps from structure first.
   - Later, Jev as the fallback for relations structure cannot settle (mostly
     non-movement relations): run it once after generation, only for claims
     recognition leaves neutral, to map the model's role names to drawing
     roles; Babel still checks the structure, and Jev's answer is saved with
     the analysis so Replay stays offline and repeatable.
   - Possibly, if it proves worth it: shared structure (multidominance) as an
     alternative to copies for movement and sharing.
8. Merge duplicated layout checks without changing a pixel, proving identical
   output with the fixture layout fingerprint (`npm run verify:visual-offline`)
   and `npm run verify:corpus`.

## Execution Order

Programs run in numeric order, except for small provider-free maintenance that
keeps later work buildable. Launch is public Babel only, as defined in
[CONTEXT.md](CONTEXT.md): it needs public generation from Program 1, public
Babel from Program 3, the first minimal Tree Bank workbench from Program 4,
Program 5 and the Generation Archive (6A). It also needed the Replay layout
follow-ups in the current work order, item 6 (Francis, 2026-11-02, on calling
them optional: "Wtf are you saying? NO"); he decided the last of them on
3 Nov 2026.

The research workbench is not part of the public app (see
[Research workbench](#research-workbench-outside-the-public-app)). It, the
later Tree Bank workbench tranches, the Reviewed Derivational Corpus (6B) and
the benchmark in Programs 7 and 8 come after launch.

## Program 1: Contract Qualification

Qualification tests the path from model instruction to authored record, parser,
Replay and production renderer. Batches follow the
[contract qualification rules](CONTEXT.md#contract-qualification-rules) and run
through the commands in [docs/qualification-runs.md](docs/qualification-runs.md).

1. Technically qualify the chosen public route, and any provider before the
   research workbench uses it: authentication, native controls,
   request/response shape, exact raw/version capture, typed failures and
   deployed limits.
2. Prove a single owner for a pronunciation association when movement and a
   separate morphology claim name the same contributors. Until one owner is
   proved, the association becomes visible at the latest covering relation's
   moment, once every candidate has played. Do not prescribe model role names or
   force a drawing to eliminate that conservative fallback.

Complete when demonstrated product defects have verified resolutions and each
contract/recovery proposal has an evidence-backed adopt, reject or hold decision.
Perfect model analyses, a large corpus and an endless qualification loop are not
release criteria.

## Program 2: Durable Personal Tree Bank

[derivationalDatabase/README.md](derivationalDatabase/README.md#browser-local-tree-bank)
describes the browser-local record layer. The remaining work is explicit import
and export, designed with the new application in Program 3.

1. Design explicit backup, import and export with the application. Version-1
   entries keep their existing read path and do not need a migration project.
2. Decide whether a legacy importer or an export-and-retire interface is needed.
3. Implement native import and export as explicit, hash-verified actions, with a
   duplicate and collision policy, corrupt-import tests and export-based recovery
   in a fresh browser. Local and private use is the minimum supported boundary.
4. Local Tree Bank records are not W17 export envelopes. The export adapter must
   distinguish unavailable evidence from recorded evidence and never invent
   missing evidence, such as dated provider-notice references.

Done when a saved analysis round-trips through export and import, including
recovery in a fresh browser, and every corrupt or colliding import is
quarantined or reported honestly.

## Program 3: Public Babel

Goal: make public Babel a simple, good syntax generator around the completed
engine. The public app has no research surface: no model controls, no
research link and no `/research` route.

Public Babel is a new front end in this repo on the shared engine (Francis,
3 Nov 2026, choosing it over a separate app or stripping down today's app:
"Then we'll go with **New public front end on the shared engine**"). It uses
the same `replay/` engine, renderer, parser and Tree Bank records as today's
app, so an analysis saved in one opens in the other; only the front end is
new, and only the public front end is deployed. Today's app becomes the
internal one Francis runs locally, with its model and effort menus; it loses
Canopy and Notes too (#343; Francis: "we don't want them anyway"). Do not
copy the engine, and do not keep growing today's `App.tsx`.

### 3A. Product Foundation

1. Define stable application boundaries around provider execution, current
   analysis state, durable records, renderer inputs, exports, and view state.
2. Prototype the complete flows before changing production: parse, inspect,
   Replay, save, reopen, export, and recover from failure.
3. Anything built later outside the public app, such as the research
   workbench, uses the same parser, renderer and durable records. It changes
   the available controls, not the meaning or storage of an analysis.

### 3B. Public Babel At `/`

1. Make the first screen the usable product: sentence input and Generate,
   kept as it is today apart from the removals below (Francis, 3 Nov: "We
   don't need to change anything for 1 right?"). Do not add a marketing
   landing page before it. Public Babel is Minimalism only, with no framework
   switch, and the public route ignores any framework the browser sends
   (Francis, 3 Nov: "Of course it's just going to be Minimalism???"). X-bar
   stays in the internal app and the qualification runners. Built in
   `publicApp/` (`npm run dev:public`), not yet deployed: the start screen,
   Replay as the only view, and nothing above the tree but the logo and the
   Tree Bank. The logo returns to the sentence box ("The logo goes home
   might be genius"), there is no footer, and F toggles fullscreen with a
   hint that fades after a few seconds on devices with a keyboard; phones
   get neither (Francis, 4 Nov 2026: "Let's just do F. No fullscreen. just
   that on the screen for a bit"). The Tree Bank's entry sits beside the
   title: a small grove, one syntax tree per saved analysis up to five with
   the newest in green, and the label "Tree Bank" with no printed count
   (Francis, 4 Nov 2026: "Grove."). It opens the Tree Bank as its own
   screen, which will be redesigned as the workbench. The browser names GPT-6.1 Sol at high effort, which the
   parse route sends through Babel's OpenAI API key.
   The "Arboretum link" label and its glowing dot go, with nothing in their
   place for now (Francis, 3 Nov: "we don't need it yet, let's keep
   minimal"). Constituent glyphing goes from the public app (see Program 4).
2. Replay is the only view (Francis, 31 Oct 2026: "we should remove Canopy
   ... and Babel will just be Replay"): no Canopy tab, no Notes, and no labeled
   bracketing in the public app. Keep Tree Bank, ambiguity selection, save and
   export. Preserve the established visual design unless a concrete product
   defect requires change. While a tree is shown, nothing takes its room: a
   small control, for example in a top corner, returns to the input screen to
   parse another sentence (Francis, 3 Nov: "anything is fine as long as it
   doesn't hog space from the tree"). Its exact form is part of the design.
3. Every finished parse is saved to the Tree Bank automatically; the header
   has one "Tree Bank" entry instead of "Tree Bank" and "Save to Tree Bank";
   a star on the tree marks the analyses to keep, and unkept ones can be
   cleared later (Francis, 3 Nov: "Yes, perfect."). Built: public Babel saves each
   finished parse as it arrives, and a star in the Replay controls, left of
   Fit, keeps it. Clearing unstarred analyses, and how starred ones look in the
   Tree Bank, belong to the Tree Bank redesign (Program 4): Francis, 4 Nov
   2026, will replace its design entirely and keep only its behaviour, where
   a saved parse opens and you leave it as easily.
4. Hide provider, model, and reasoning controls; the server chooses them and
   ignores the browser's choice. Built: a deployed server (`NODE_ENV=production`
   or the hosted function) sends Minimalism with GPT-6.1 Sol at high effort
   whatever the browser names (`PUBLIC_PARSE_REQUEST`); local runtimes keep the
   internal app's menus. The public model is GPT-6.1 Sol at high effort
   (Francis, 3 Nov 2026: "Then we'll go with high."), through the OpenAI API key
   already saved for Babel (Francis, 3 Nov: "yes we already have one saved").
   The generation route calls GPT-6.1 Sol through that key at low to max
   effort (`model-routes-v2`); the Codex runner keeps its own subscription
   transport, which also offers ultra. Babel uses one empirically selected model and a bounded server-selected generation policy while
   recording its complete provenance. Do not place AI or provider
   branding at the front of the experience, but disclose model generation and
   backend retention honestly through appropriate About and Privacy surfaces.
   Raw responses, hashes, provider settings, token use, latency, and other
   research details never appear in the ordinary public workspace.
5. Retire Notes as a top-level view (#343 does this). `stageRecord` remains
   part of every stage and stays visible with its corresponding Replay frame.
   Decide separately, after auditing actual use, whether labeled bracketing
   and Miles Shang output remain as exports or are retired.

### 3C. Product Quality

1. Preserve and characterize the existing loading experience, arbitrary-count
   parse selection, and the single provider request per parse (no automatic
   transport retry; a retry on the public site may come later). Each workspace
   view and the page root have error boundaries; give any new page its own.
   Decide separately whether
   user-triggered parse cancellation or additional retry UI is useful.
   A parse takes minutes: in the 29 Oct held-out batch the median wait was
   2.4 min on GPT-6.1 Sol and 1.5 min on Claude Opus 5.5 (90th percentile 3.5
   and 2.5 min), about 60% of it model reasoning before any output. Design the
   progress experience for waits of minutes, not seconds, as part of building
   the product UI. GPT-6.1 Sol is in `GENERATION_MODEL_IDS`; Opus 5.5 is not. Vercel
   ends a function at 300 s, and GPT-6.1 Sol at high passed 285 s on 2 of 100
   held-out parses (31 Oct). Built: public Babel starts the parse in the
   background (`{ start: true }` to `/api/parse`), receives a signed ticket,
   and checks back every 4 s (`{ ticket }`), so no request outlives a check,
   and a phone that sleeps or a page that reloads resumes the same parse from
   the ticket kept in the tab's session storage. A ticket lives 20 minutes; checks use no
   parse allowance. The internal app keeps the one long request. The waiting
   screen grows a syntax tree on the measured wait (Francis, 4 Nov 2026,
   option A).
2. Make desktop and mobile layouts explicit. Verify all key flows with
   screenshots and interaction tests, not only component snapshots.
3. Preserve local-first operation. Hosted accounts or synchronization remain a
   later explicit decision.

Done when `/` provides the complete simple syntax-generator workflow, Notes
has been retired without losing stage explanations or exports, and the old
monolithic path can be removed without semantic or visual regression.

### Research workbench (outside the public app)

The research workbench will not be part of the public app. Francis, 3 Nov
2026: "for now, you can scratch the idea of the research Babel being available
inside the public app, it won't. Either only I have access to it, and it
becomes more of a test area for models and things, or we build it and I give
access to a select few people or they can bring their own api keys, etc."

It comes after launch. When it is built, it holds what the public app hides:
provider, model and native reasoning controls (Francis chooses every model in
its catalog), generation provenance, raw and normalized outputs, and typed
failures. It keeps the shared parser contract and never manufactures
cross-provider equivalence. Until then the local app's model menu and the
qualification runners serve this purpose.

## Program 4: The Tree Bank As A Syntactician's Workbench

Goal: make the Personal Tree Bank much more interesting by turning it into a
syntactician's workbench, without being opinionated about how syntacticians
work. It starts simple and minimal, inside the Tree Bank: the first version
ships with launch (Francis, 3 Nov 2026, quoted in the current work order).
What that first version holds, and how it looks, is decided with Francis
later (3 Nov: "tree bank workbench: we'll figure this out later").

Triangles (constituent glyphing) come back here as something you do by hand,
not as automatic pattern matching: you click a phrase to collapse it into a
triangle or open it again, as in Miles Shang's tool, because no rule can say
which phrases should be shortened. The textbook use is to abbreviate a phrase
whose inner structure is not the point of the tree. Guard rails: only phrases,
never a single head; never a phrase holding something the tree shows (a
movement's start or end, a coindex, a plaque's word); and a view setting on
the saved analysis that never changes the derivation. Whether triangles also
apply during Replay is decided in the design, and the collapsed tree must
still look right.

The capabilities below are the longer list, in dependency order. Each later
tranche comes after launch, and its workflow and visual form are found with
Francis through prototypes rather than assumed from this roadmap.

1. **Examples and Collections**: user-authored notes, judgments, citations,
   tags, and ordered collections reference immutable analysis records. These
   are genuine user notes and must remain distinct from model-authored
   `stageRecord` text shown in Replay.
2. **Notebook/Saved Work**: thin wrappers group work without embedding record
   payloads.
3. **Sibling analyses and comparison**: preserve alternatives as siblings,
   show authored and derived differences, and never rewrite the original.
4. **Structural query**: first run a real query-needs study; then implement only
   predicates supported by record structure and user evidence.
5. **Interchange**: explicit bundles with checksums, provenance, conflict
   policy, and version support.
6. **Research outputs**: export canonical bundles and faithful static or
   interactive views without claiming interchange formats preserve the full
   derivation when they only carry final trees.
7. **Group exchange**: add collaboration only after local import/export and
   attribution are reliable.
8. **Public releases**: require licensing, citation, withdrawal, correction,
   and governance decisions before any shared corpus is called a database.

Done progressively: every tranche must be useful end to end without requiring
the next tranche or a hosted account.

## Program 5: Operations And Shipping

1. Define supported browsers, hosted runtime conditions and upgrade cadence.
   Node 24 is already selected in the package and CI. The browser features the
   code requires are listed in README (Supported browsers) and checked before
   the app loads.
2. Choose hosting, storage, and operations vendors after measuring the public
   model's cost, expected traffic, archive volume, privacy requirements, and
   recovery needs. Do not lock Babel to a vendor before those facts exist.
   The Vercel production deployment is paused on purpose until Babel is
   ready to ship (Francis, 3 Nov 2026).
3. Keep secrets server-side, preserve provider request shapes, and add abuse
   controls appropriate to the selected host.
4. The public launch direction is anonymous generation without an account and
   without a user charge. GPT-6.1 Sol at high effort costs about $0.08 a
   parse at list price (mean of 121 completed parses; 90th percentile
   $0.14, most $0.22). A deployed server allows each visitor 5 parses and
   the whole site 100 a day (Francis, 5 Nov 2026: "You can build it with 5
   per visitor and 100 a day"), and each visitor 30 requests a minute,
   ticket checks included (`server/parseAllowance.js`). A refused parse
   calls no provider. The hosted function counts in a shared Upstash Redis
   store (`UPSTASH_REDIS_REST_URL` and `_TOKEN`, or the Vercel marketplace's
   `KV_REST_API_URL` and `_TOKEN`) and starts no parse without one, or when
   the store cannot answer. Before launch: add that store, and set a hard
   monthly spend limit on Babel's OpenAI project ($100 suggested to start),
   which stops spending whatever the server does.
5. The public deployment has no research route. If the research workbench is
   ever hosted, only Francis, or the few people he gives access to, can reach
   it, and anonymous traffic never reaches experimental provider spending.
   Invitations and people bringing their own API keys are the options Francis
   named; choose when it is built.
6. Keep public Babel, the research workbench, the Relation Orchard, benchmark
   reports, the Generation Archive, and reviewed corpus releases separate in
   deployment ownership. The Generation Archive has no ordinary navigation.
   Add corpus navigation only if Francis approves a publication.
7. Maintain one pre-launch checklist covering at least the fresh-checkout gate,
   contract qualification, public generation, complete renderer
   integration, Personal Tree Bank round trips, Generation Archive failure
   capture, reviewed-corpus promotion, mobile and desktop behavior,
   accessibility, security, privacy, abuse limits, cost limits, backups,
   monitoring, rollback, licenses, notices, links, and static assets. Add any
   further proof exposed by implementation. Passing an earlier item never
   waives a later defect.
8. Publish from a reviewed clean tree with provenance for contract, engine,
   renderer, bundle, application, and site versions.

Done when the production deployment passes the complete launch checklist, its
cost and retention behavior are bounded and disclosed, and a failed release can
be detected and rolled back without losing accepted work.

## Program 6: Generation Archive And Reviewed Derivational Corpus

Goal: build two backend research layers over the same immutable derivational
record contract. The benchmark is not a prerequisite and must never supply
answers or held-out material to either layer.

Begin implementation after contract qualification and the official hosted
generation path are stable enough to define what must be retained.

### 6A. Automatic Generation Archive

1. Persist every attempt made through the official hosted service, including
   successful analyses and separately typed transport, malformed-output,
   contract, and deterministic-engine failures.
2. Capture every useful and legally permitted fact: input and framework,
   provider/model/native settings, contract and prompt hashes, timestamps, raw
   provider response, normalized analyses, failure evidence, engine and
   renderer versions, latency, token usage, and cost metadata. Never persist
   credentials or unavailable private reasoning traces.
3. Keep the archive out of the ordinary product UI initially. It is research
   infrastructure, not the user's Personal Tree Bank.
4. Define disclosure, privacy, security, retention, access, deletion, and
   jurisdiction rules before enabling automatic persistence.
5. Do not upload from self-hosted or forked installations by default.
6. Preserve repeated generation events independently even when their content is
   identical; internal content deduplication may not erase event provenance.

### 6B. Reviewed Derivational Corpus

1. Promote only deliberately reviewed analyses from the Generation Archive.
2. Preserve complete derivations, provenance, reviewer evidence, licensing
   status, and correction history so the result can support serious linguistic
   research and, where legally permitted, specialized-model training.
3. Define selection, review, disagreement, attribution, withdrawal,
   versioning, correction, citation, and training-eligibility policies.
4. Obtain legal decisions for model outputs, user inputs, source examples,
   screenshots, licenses, redistribution, and training use.
5. Decide later whether the Generation Archive or reviewed corpus is private,
   shared, or public. Do not expose either through Personal Tree Bank search by
   default.
6. Build any publication as a release projection with stable identifiers and
   checksums rather than exposing the mutable operational database directly.
7. Prove the promotion and correction workflow on a small reviewed set before
   scaling it. Corpus size is not a product launch metric.

Done when hosted attempts are retained honestly and securely, and reviewed
derivations can be independently cited, validated, corrected, and withdrawn
without mutating Personal Tree Bank work or benchmark archives.

## Program 7: Benchmark D0

Goal: after the product and research infrastructure are useful, publish a
development-grade, non-linguistic contract-validation release before claiming
syntactic performance.

1. Reconcile the W13-W16 modules into one documented provider-free execution
   path and delete duplicate or unreachable dry-run scaffolding.
2. Define Francis-owned S0 declarations: purpose, model selection authority,
   cost ceiling, data retention, rerun policy, and release label.
3. Author versioned draft items and complete the structural/taxonomy audit
   receipts. Draft status must never imply linguistic validity.
4. Freeze an explicit model manifest and admission evidence.
5. Record each selected model's own documentation, retrieval date, native
   controls, effective request settings, and admission probe. Family-level
   documentation is not evidence for a specific model.
6. Exercise the full runner/archive/typed-failure/report/development-bundle
   path with stubs, then with approved provider executions.
7. Publish only run-level validity and typed failure evidence under D0. Do not
   report linguistic conformance, quality rankings, or benchmark scores.

Done when a third party can reconstruct every D0 run and verify its artifacts,
manifest, conditions, and limitations from released data.

## Program 8: Benchmark D1-D3

Goal: progress from engineering evidence to defensible linguistic claims only
with qualified syntactician and methods collaborators.

1. **D1 recruitment**: recruit qualified reviewers and document expertise,
   conflicts, training, and family coverage.
2. **D2 calibration**: calibrate item interpretations, judgment categories,
   disagreement handling, missingness, and adjudication. Obtain method review
   for estimands, uncertainty, and any measurement model.
3. Run complete predeclared suites; preserve invalid outputs rather than
   silently dropping them.
4. Judge every valid run in the adjudicated set; never select a representative,
   best, median, or modal run after seeing results.
5. Produce judgments, agreement evidence, score draws, sensitivity analyses,
   exposure/twin evidence, item audits, and correction plans through the
   existing hash-bound interfaces.
6. **D3 release**: satisfy the release bundler's external preconditions,
   legal/licensing review, methods sign-off, accessible report review, and
   Francis's publication approval.
7. Version corrections additively; never rewrite an earlier release.

Done when every public claim has an estimand, evidence chain, uncertainty,
review authority, and correction path.

## Decisions Still Owned By Francis

- Separate approval for provider tests, model-visible prompt changes,
  publication, deployment, licensing, and hosted synchronization.
- The import/export experience, including any legacy importer or export-only
  retirement, during application design.
- Public Babel's information architecture and visual direction.
- What the first, minimal Tree Bank workbench holds, and the workflows and
  interaction model of each later tranche.
- The exact public anonymous-use limits after the selected model's cost and
  reliability are measured.
- Whether the research workbench is built, who besides Francis may use it,
  and how they get access (for example by bringing their own API keys).
- Every model admitted to the research workbench's catalog and how each
  proprietary or open-weight model is operated. Arbitrary model identifiers
  stay out unless Francis approves them.
- Detailed public failure presentation and retry behavior. Babel must never
  silently switch providers.
- Whether contract-review artifacts live inside the research workbench, as
  generated click-through files, or both.
- Whether labeled bracketing and Miles Shang output remain supported exports.
- Every provider/model launch, cost ceiling, and model manifest.
- Contract/recovery adoptions after empirical comparison.
- Reviewer and methods authority for claim-bearing benchmark stages.
- Final product names for the Generation Archive and Reviewed Derivational
  Corpus, including a possible mythological name for the latter.
- Generation Archive disclosure, privacy, retention, access, and deletion
  policy.
- The Reviewed Derivational Corpus's licensing, correction model, publication
  scope and timing, and training-eligibility rules.
- Whether research writing or future public datasets receive a separate
  Creative Commons or data license after the ownership audit.
- Deployment target and public product timing.

## Explicitly Not Active

- New relation pictures before shipping. Selection (13% of all neutral
  relations) and coordination (always neutral) are the largest kinds Babel has
  no drawing for; government, clause typing, and tense and auxiliaries follow.
  The planned work: research how textbooks and papers draw each, bring mockups
  for Francis to choose from, as for Tier 3, then build the chosen ones as
  Tier 2 families with Orchard cards. This follows the original relation-design
  workflow. Francis (29 Oct 2026): probably not before shipping.

- Bringing far plaques nearer by moving other marks. On 2026-10-24, 256
  plaques in 179 of 1,274 saved and committed analyses sat beyond their
  nearby reach, 197 of them within 1.3 times it and none beyond 1.92; none of
  them overlaps or crosses syntax on desktop. Every remaining fix moves other
  plaques or breaks the no-teleport rule (Francis: "Plaques: Ok." on
  2026-10-23; "if there's no way to solve it easily, then it's probably fine"
  on 2026-10-24).

- Finished trees tighter than their stage's widest step. Every frame of a
  stage shares one set of leaf positions (`reserveContours` in
  `buildStageLocalCoordinates`), so a finished tree keeps the spacing its most
  crowded step needed: 46 of 234 fixtures paint a finished tree wider than the
  same last frame laid out alone, by up to about 40% (measured 3 Nov). Closing
  more would need a visible tidy-up step at the end of a stage, or a finished
  tree that differs from the last frame. Francis on 2026-11-03: "I don't want 1
  or 2, they sound ugly. so I guess we're keeping 3."

- Bending movement arrows or connector lines around words and labels they
  cross. Their shape stays as designed (Francis: "I'm fine with movement
  arrows crossing words and labels, same with lines, can't really do much
  about them, since we're not changing how they look, so we won't bend them
  or anything" on 2026-10-24). Case arrows are different: they always bend.

- Gliding layout changes between Replay steps (Francis: "no glide." on
  2026-10-18). When a parent is inserted above existing syntax, the smaller
  side of the insertion moves one row instead: the syntax above it rises, or a
  smaller phrase below it drops, and untouched pieces and waiting phrases keep
  their rows (`replay/replayRows.ts`; Francis on 2026-11-02, replacing the
  2026-10-23 step-down: "yes try it", "It's better").

- A research link, research route or model controls in the public app
  (Francis, 3 Nov 2026; see
  [Research workbench](#research-workbench-outside-the-public-app)).
- More relation-card design without a reproducible defect.
- Provider calls as part of default verification.
- Reintroducing automatic JSON delimiter repair. Francis removed it on 22 Oct
  2026: a response whose brackets do not balance now fails as
  `TRANSPORT_JSON_DELIMITERS_BALANCED` with its raw output. A stricter rule that
  only drops stray closers after the complete value
  (`exp/json-repair-preserve-nesting`) is held for the public app.
- Reintroducing the model-based payload transcriber.
- A model-authored final tree, notes ledger, compatibility ledger, or fixed
  relation ontology.
- Undisclosed server parse logging or persistence, and automatic uploads from
  self-hosted or forked installations.
- Benchmark settings inside the ordinary Babel workbench.
- A manual syntax editor before the analysis and record workflows are proven.
- Additional teaching layers beyond the model-authored Replay record without a
  concrete demonstrated need.
- Hosted sync before local persistence, export/import, integrity, and conflict
  behavior are complete.
- A public Reviewed Derivational Corpus before legal and governance decisions.
