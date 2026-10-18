# Input segmentation study

Requested by Francis on 17 October 2026, describing Babel at `main` after #53,
using Node v24.16.0 (ICU 78.3, Unicode 17). The investigation changed no
contract, prompt, analysis or drawing. [ROADMAP.md](../../ROADMAP.md#current-work-order)
owns the follow-up work.

## Question

Babel splits each input sentence into tokens before the model sees it, and the
final tree must account for every token exactly once. If Babel is to treat all
languages alike, can that split depend on a dictionary that works well for some
writing systems and poorly for others?

## Answer

No. Word boundaries are a linguistic analysis, and the current split is neither
neutral nor reproducible:

- For scripts written without spaces, the boundaries come from ICU dictionaries
  built for line wrapping. They cut through Japanese verbs and Chinese names,
  and merge words in Thai, Lao and Khmer.
- The same sentence is segmented differently by different JavaScript engines,
  and the language standard allows this.
- Across 589 saved analyses, no response was rejected because of a token
  boundary. But models spend considerable effort repairing Babel's splits in
  Japanese and Mandarin, and a few analyses appear to be shaped by them.
- No theory of grammar offers a word segmentation that holds across languages
  and can be fixed before analysis. Distributed Morphology has no lexicon at all.

Recommendation: Babel should fix only the characters of the input and let the
model decide where words are, checking the spell-out character by character.
That is a contract change; it needs a controlled comparison before adoption
(see [Proposed experiment](#proposed-experiment)). Two smaller defects can be
fixed now without touching the contract (see [Fixes independent of the
contract](#fixes-independent-of-the-contract)).

## How Babel tokenizes today

`tokenizeSentenceSurfaceOrder` in `server/babelParser/surfaceTokens.js` runs
`Intl.Segmenter('und', { granularity: 'word' })` and keeps word-like segments
(version label `unicode-word-v2`). The prompt sends the indexed token list; the
final stage's pronounced terminals must match it in order. Optional realization
groups let several tokens form one word, or one token realize several syntactic
terminals ([morphology audit](morphology-realization-audit.md)).

## Findings

### What models do with the tokens

All saved analyses were audited: 589 accepted analyses of 324 sentences in 38
languages, 3,937 tokens, de-duplicated by authored content. Almost all were
written by GPT-6.1 Sol and GPT-6 Astra.

| Script type | Tokens | Token = one terminal | Several tokens merged into a word | One token split into several terminals |
|---|---|---|---|---|
| Dictionary-segmented (Japanese, Mandarin, Thai) | 775 | 70.6% | 24.6% | 4.8% (Mandarin compounds ICU had merged) |
| Spaced scripts | 3,162 | 94.9% | 0.3% | 4.7% |

- No response was rejected for a token boundary. The few rejections were word
  order, a duplicate node id, and token indices in Dutch that the recovery merged
  on 15 October now accepts.
- 116 of the 265 realization groups repair a bad split:
  - 111 are dictionary cuts in Japanese and Mandarin. All 66 Japanese merges
    rejoin inflected verbs, such as 買|っ|た and 開|け|さ|せ|た; 41 of 43 Japanese
    analyses needed them.
  - 5 are cuts at spaces or hyphens, such as Vietnamese *học|sinh* and Indonesian
    *anak|anak*.
  - Mandarin names such as 小|李 were rejoined in 8 of 10 occurrences, and ICU's
    compounds such as 那本书 and 很高 were split back into separate words.
- The other 149 groups are real morphology inside spaced words: Korean case and
  honorifics, Turkish suffixes, Arabic and Hebrew clitics, Romance *aux* = à + les.
- Repairs carry overhead. Analyses author relations whose only purpose is to
  explain a token mismatch, about 58 in Japanese and 43 in Mandarin, and 122
  analyses spend prose explaining tokenization.
- Some analyses appear to follow the bad split rather than the language, for
  example 読|ん kept as two terminals inside one verb, and 小 analysed as a name
  prefix. A counterfactual run would be needed to prove the cause.
- 78 groups (29%) name their pieces by lemma or underlying form, for example
  読む for 読ん, *à* + *les* for *aux*, and 시 + 었 for 셨. This is legitimate
  fused morphology, and any replacement must keep it.
- Every saved token list matches today's tokenizer. All saved runs used ICU 78.3,
  so drift between ICU versions is untested rather than ruled out.

The data is thin for Vietnamese, Thai and Korean, has no Khmer, Lao, Burmese or
Cantonese, and comes almost entirely from two OpenAI models.

### The same input in different runtimes

36 probe sentences across 16 writing systems were segmented in Node 24 and 26
(ICU 78.3), Playwright Chromium 151, Google Chrome 155, Playwright WebKit 26.5
and Playwright Firefox 153.

| Writing system | Probes | Word boundaries differ between runtimes | Character (grapheme) counts differ |
|---|---|---|---|
| Chinese | 5 | 5 | 0 |
| Japanese | 5 | 5 | 0 |
| Thai | 4 | 4 | 0 |
| Lao | 3 | 2 | 0 |
| Khmer | 3 | 3 | 0 |
| Burmese | 3 | 3 | 0 |
| Tibetan | 2 | 2 | 0 |
| Hindi, Tamil | 2 | 2 | 0 |
| Emoji and combining marks | 1 | 1 | 0 |
| Vietnamese, Korean, Arabic, Hebrew, English, German | 7 | 0 | 0 |

- Firefox disagrees with the ICU-based engines on every Chinese and Japanese
  probe, and even places a boundary inside a word (李四批评 → 四批|评).
- Node and WebKit agree with each other, but Chrome segments Lao and Khmer
  differently: ຮູ້ວ່າ against ຮູ້|ວ່າ, and មិនដឹង|ថា against មិន|ដឹងថា.
- This is expected. ECMA-402 states that "boundary determination is
  implementation-dependent" ([ECMA-402](https://tc39.es/ecma402/)). Chromium ships
  an abridged Khmer dictionary, an older Lao dictionary and a patched Chinese and
  Japanese dictionary ([README.chromium](https://chromium.googlesource.com/chromium/deps/icu/+/refs/heads/main/README.chromium)).
- Character counts agreed everywhere. Grapheme rules do still change between
  Unicode versions: the Indic conjunct rule GB9c was added in 15.1 and revised in
  18.0 ([UAX #29](https://www.unicode.org/reports/tr29/)). The most stable unit is
  the code point after NFC normalization.

Babel tokenizes on the server, so a model receives Node's split. Two browser
paths tokenize again in whichever browser is open (see [Fixes independent of
the contract](#fixes-independent-of-the-contract)).

### What theory and practice say

- **Unicode.** UAX #29 defines only default boundaries. It states that reliable
  word boundaries in Thai, Lao, Chinese or Japanese require "dictionary lookup or
  other mechanisms", and that "it is not possible to provide a uniform set of rules
  that resolves all issues across languages"
  ([UAX #29 §2, §4.2](https://www.unicode.org/reports/tr29/)). ICU's Lao list "was
  created in order to aid in word wrapping issues"
  ([laodict.txt](https://github.com/unicode-org/icu/blob/main/icu4c/source/data/brkitr/dictionaries/laodict.txt)).
- **Universal Dependencies.** UD annotates syntactic words and separates them
  from orthographic tokens. Multiword tokens such as *dámelo* or *au* carry their
  words separately, and the original text stays recoverable
  ([UD tokenization](https://universaldependencies.org/u/overview/tokenization.html),
  [CoNLL-U](https://universaldependencies.org/format.html)). Segmentation is still
  decided per language and per treebank: Japanese has four official segmentation
  standards, and Chinese treebanks disagree with each other
  ([Omura et al. 2021](https://aclanthology.org/2021.udw-1.12.pdf),
  [UD Chinese](https://universaldependencies.org/zh/tokenization.html)).
- **Conflicting standards.** The Chinese Treebank writes 姚明 as one word, while
  PKU writes 姚|明 ([Chen et al. 2017](https://aclanthology.org/P17-1110.pdf)).
  Native Chinese speakers agreed on segmentation only 0.76 of the time
  ([Sproat et al. 1996](https://aclanthology.org/J96-3004.pdf)). Thai segmentation
  has "no common standard" ([NECTEC 2011](https://aclanthology.org/W11-3003.pdf)).
- **Wordhood.** No criterion is necessary and sufficient for "word" across
  languages ([Haspelmath 2011](https://zenodo.org/records/225844)). Phonological
  and grammatical words systematically diverge
  ([Dixon & Aikhenvald 2002](https://linguistlist.org/issues/14/2411/)). In
  Distributed Morphology, "there is no Lexicon … word formation takes place either
  in syntax or through postsyntactic operations"
  ([Embick & Noyer 2001](https://babel.ucsc.edu/~hank/mrg.readings/embick&noyer2001.pdf)).
- **Character-anchored alignment.** The CoNLL 2018 shared task compared systems
  whose tokenizations differed by aligning their non-whitespace characters. Words
  inside a multiword token that is not a plain concatenation, such as *zum* = zu +
  dem, were aligned within their span ([Zeman et al. 2018](https://aclanthology.org/K18-2001.pdf)).
  Stanza, UDPipe and standoff formats such as brat and TEI also anchor annotation
  to character offsets ([Stanza](https://stanfordnlp.github.io/stanza/tokenize.html),
  [brat](https://brat.nlplab.org/standoff.html),
  [TEI](https://tei-c.org/release/doc/tei-p5-doc/en/html/SA.html)).

## Options

| Option | Neutral across languages | Reproducible | Keeps fused morphology | Cost |
|---|---|---|---|---|
| Keep ICU word tokens (today) | No: dictionary scripts are cut arbitrarily | No: varies by engine | Yes, through groups | Repair work in Japanese and Chinese |
| Language-specific segmenters | No: picks one of several conflicting standards | Per tool version | Yes | Adds a language rule for each language |
| Whitespace-only tokens with offsets inside them | Yes | Yes | Yes | For Chinese or Thai the whole sentence is one token, so offsets do all the work |
| Character anchoring: the model decides words, Babel checks spell-out | Yes | Yes, after NFC normalization | Yes, if spans keep groups | Contract change; rules for whitespace, punctuation and epenthesis |

## Recommendation

Anchor the input to its characters, with the two levels UD uses:

1. **Spans.** The model's pronounced words, in order, spell out the input's
   characters exactly once, ignoring whitespace and punctuation under one
   explicit rule. The model writes words, not offsets; Babel aligns them to the
   input from left to right. Models are poor at counting characters, so the
   contract should never ask for numbers it can derive
   ([CUTE, 2024](https://arxiv.org/abs/2409.15452)).
2. **Syntactic terminals.** A span can be realized by several terminals, whose
   forms are free inside it. This is today's realization group, keyed to a span
   rather than to token indices, so *aux* = à + les and 読む for 読ん remain
   possible. Silent terminals own no characters.

Detail to settle in the contract change:

- Compare NFC code points, not graphemes. Report a word boundary inside a grapheme
  cluster as an observation rather than an error, since Japanese か can hold the
  end of a root and the start of a suffix.
- Report a word that crosses whitespace as an observation, since Vietnamese
  *học sinh* is one word.
- Define whitespace and punctuation precisely. U+200B, which separates Khmer
  words, is not Unicode White_Space, and word-internal marks such as *l·l*, gershayim
  and apostrophes need one shared rule.
- Keep a hyphen or epenthetic letter (French *a-t-il*) inside a span that its
  terminals jointly realize.
- Saved records keep the token list and tokenizer version they were generated
  with. Replay must continue to read them unchanged.

## Proposed experiment

Francis approved the comparison on 17 October 2026. It changes the model-facing
prompt only inside the qualification runner:
`npm run qualification:codex -- --contract spellout`.

- **Variant** `character-spellout-v1`, in `contractQualification/spelloutContract.js`.
  - The request sends the sentence without a token list, and terminals have no
    `tokenIndex`. A realization group names its `text`, a contiguous stretch of
    whole final words, instead of token indices. All other instructions stay
    word for word.
  - Babel aligns the final words to the sentence from left to right, ignoring
    case, whitespace and punctuation. The model's own words become the tokens,
    spelled as in the sentence, and the unchanged parser, Replay and review
    process the result.
  - Restated in this form, every complete committed fixture reaches the same
    parse and Replay. The five that change are the splits this study found
    (読/ん/だ, 小/李), and each becomes one word.
  - Limits: a group cannot cover a discontinuous stretch, which indices can.
    A word that differs from its stretch only in inner marks (*don't* for
    *don’t*) is recorded as a single-leaf group after conversion.
  - Version 2 (`character-spellout-v2`, 18 October) cuts one word list wherever
    any analysis or earlier stage divides a word. Analyses that divide a word
    differently, and a word that grows across stages (吃完, then 吃完了), then
    share it; a word over several tokens is recorded as a single-leaf group.
    Its wording also says that the writing, including its spacing, does not
    prescribe word boundaries, after one Thai run treated a whole unspaced
    sentence as one written word.
- **Conditions.** The same sentences run under today's indexed token list and
  under character spell-out, with GPT-6.1 Sol at high effort through Codex OAuth.
  Each condition's prompt and contract version is recorded.
- **Sentences.** About 16, chosen where the evidence is thin or the split is worst:
  Japanese and Mandarin (names and inflected verbs), Thai, Lao, Khmer, Burmese,
  Vietnamese and Korean. English and German serve as controls.
- **Measures.**
  - validity and failure kinds;
  - realization groups, and relations written only to explain tokenization;
  - whether words follow the language or the old split, judged in review;
  - spell-out mismatches under the new check.
- **Adoption** only if validity does not drop, repair work falls, and review finds
  no analyses shaped by segmentation.

## Fixes independent of the contract

Both are done.

- Generation provenance records the runtime's Unicode, ICU and CLDR versions,
  since today's tokens depend on them (#55).
- The browser no longer tokenizes again (#56). Failure inspection uses the tokens
  the server sent, and records saved without a token list recover them from
  their own final words where they can.

## Adoption

Babel adopted spell-out on 18 October 2026 for every provider route and both
qualification runners, as `character-spellout-v3`.
`server/babelParser/spellout.js` checks the spelling and converts each response
into token positions over one word list, so parsing, Replay and saved records
keep their form. The open points were resolved as follows:

- **A word that grows.** The word list is cut wherever any analysis or stage
  divides a word (version 2), so 吃完 and 吃完了 share it.
- **Unspaced scripts.** The writing, including its spacing, does not prescribe
  word boundaries, and groups are omitted when the pronounced terminals' own
  words, in tree order, spell the sentence. Under version 2's wording Sol split
  Thai into words, but Astra still grouped a whole Thai sentence in 2 runs;
  version 3 states the rule by the terminals' own words.
- **Nothing the token list allowed is lost.** Token positions let a group cover
  separate words and claim its words anywhere, while the remaining terminals
  matched in tree order. Version 3 keeps both: a group's text may be an array
  of pieces in sentence order, and each group claims its own stretches. Babel
  first tries each group where its first covered terminal is read, so every
  analysis that passed before converts identically: 219 of 221 saved analyses,
  and the other 2 are the growing-word failures, which now pass.
- **Metalanguage** is unchanged. It occurs under either prompt and is a
  separate decision.
