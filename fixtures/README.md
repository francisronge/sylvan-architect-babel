# Offline parse fixtures

`raw/` contains hand-authored model-shaped payloads for the current parser contract. Each file follows the instruction surface in `server/babelParser/systemInstruction.js` and contains `sentence`, `framework`, `modelRoute`, and a four-field `derivationStages` payload. The fixtures make no provider or network calls.

`raw/*.output.txt` files are unaltered provider responses that exercise JSON ingress; their tests name the sentence, model and run. `de-verb-cluster-overclosed-lines.output.txt` has twelve one-line trees with two extra closers each, recovered by the over-closed line repair in `server/babelParser/strictJson.js`.

`normalized/` contains committed whole-output snapshots produced by:

```sh
npm run fixtures:build
```

The builder removes only volatile provenance fields before writing snapshots: `timestamp`, `promptVersion`, `parserVersion`, and `uiVersion`. The first changes every run; the other three may come from local environment configuration and therefore cannot be part of a clean-checkout snapshot. No environment values are printed or serialized.

The suite currently covers a simple declarative clause and an interrogative derivation with wh movement, a silent lower occurrence, auxiliary movement, open relation names, and exact surface-token order. The movement fixture normalized on its second bounded authoring attempt.

Run the clean-checkout, provider-free verification path with:

```sh
npm run verify:offline
```

`npm run verify:all` adds the repository-wide TypeScript check before the offline path.

A diff under `normalized/` is a parser-contract behavior change. Review it as such; never regenerate and accept snapshots blindly.
