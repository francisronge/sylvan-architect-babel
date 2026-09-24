# Third-Party Notices

The Apache License 2.0 applies only to rights the project can grant. It does not
replace the licenses or rights described below.

## Relation Orchard Bundles

`docs/research/relation-orchard/relation-orchard.bundle.js` includes React,
React DOM, Scheduler, D3 modules, and their bundled dependencies. Exact package
versions, copyright notices, and license texts are preserved in
[`LICENSES/RELATION-ORCHARD-BUNDLE.txt`](LICENSES/RELATION-ORCHARD-BUNDLE.txt).

`docs/design/visual-relations-current-lab.production-only-audit.r96.bundle.js`
is byte-identical to the current Orchard bundle and therefore embeds the same
React and D3 software. Its notices and license texts are preserved in the same
file.

## Fonts

The Relation Orchard distributes six Crimson Pro, JetBrains Mono, and
Quicksand font files under the SIL Open Font License 1.1:

- Crimson Pro: Copyright 2018 The Crimson Pro Project Authors.
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors.
- Quicksand: Copyright 2019 The Quicksand Project Authors. `Quicksand` is a
  Reserved Font Name.

The complete copyright notices and license accompany the fonts at
[`docs/research/relation-orchard/assets/fonts/OFL-1.1.txt`](docs/research/relation-orchard/assets/fonts/OFL-1.1.txt).

## Academic Source Material

The Relation Orchard displays small previews of selected academic figures under
`docs/research/relation-orchard/assets/source-previews/`. Each source panel names
the work, identifies what the image illustrates, and links to the original.
These third-party excerpts are not covered by Babel's Apache license; copyright
remains with their authors or publishers. The larger research copies under
`docs/design/visual-relations-assets/` remain outside the release.

Four separately licensed source figures are published in the Orchard's optional
source viewer. `poole-dependent-case-low.png` is an unmodified page image from
Ethan Poole, “Dependent-case assignment could be AGREE” (2024), page 8,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The
[original article](https://www.glossa-journal.org/articles/10.16995/glossa.9894/)
provides the source and license. `parasitic-gap-tree.png` is the unmodified
“Parasitic gap tree” by Kvandervelden (2021),
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Its
[Wikimedia Commons page](https://commons.wikimedia.org/wiki/File:Parasitic_gap_tree.png)
provides the source and license. These images retain their own licenses; Babel's
Apache license does not cover them.

`assmann-et-al-focus-marking-example-49.png` is a cropped page excerpt from
Muriel Assmann, Daniel Büring, Izabela Jordanoska, and Max Prüller,
“Towards a theory of morphosyntactic focus marking” (2023), example (49).
The [original article](https://pmc.ncbi.nlm.nih.gov/articles/PMC10643371/)
is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

`poole-keine-reconstruction-example-2.png` is a cropped excerpt of example (2)
from Ethan Poole and Stefan Keine, “Not all reconstruction effects are syntactic”
(2024). The [original article](https://link.springer.com/article/10.1007/s11049-023-09603-3)
is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Model and Provider Outputs

Files under `docs/research/assets/` may depict outputs produced by third-party
models and rendered in Babel. The Apache grant extends only to rights the
project holds in those files. The project makes no claim about ownership of the
underlying model output; reusers should consult the relevant provider terms.

## Installed Packages

Packages installed through `package-lock.json` retain their own licenses. They
are not relicensed by Babel; their package distributions include the applicable
license text and notices.
