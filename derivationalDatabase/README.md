# W17a durable-record envelope

This package implements the model-invisible, persistence-free core of W17:
a canonical native-JSON envelope for an already-normalized derivation.

The envelope:

- preserves every JSON scalar and every array order exactly;
- canonicalizes object-key order only for hashing and serialization;
- binds the derivation and four evidence records to externally supplied
  source references and canonical SHA-256 hashes;
- records the adopted contract artifact, contract version, engine version,
  framework identity,
  optional prior-record reference, and caller provenance;
- contains no provider transport, browser storage, server persistence,
  benchmark, publication, visual, or rendering dependency.

`normalizedDerivation` is deliberately opaque here. Its contract-specific
validator belongs to a later W17 adapter tied to the adopted contract artifact.
This envelope therefore does not roll out model-facing wording or encode a
live-field migration. A caller must validate the derivation against the
contract named by `contractVersion` before creating the envelope.

The envelope also does not implement legacy mapping, session-memory export,
supersession actions, legal tombstones, final-tree export formats, licensing
decisions, or database writes. `supersedesRecordId` is evidence supplied by the
caller; this package neither resolves nor mutates history. `providerNotice` is
dated source evidence, not a license or publication authorization.

Raw provider bytes have no dedicated field in this carrier. They remain
eligible only for the separate explicit-submission or benchmark-archive
boundaries. Because artifact values and provenance are intentionally opaque,
the caller remains responsible for keeping raw bytes outside them. Hashes prove
content integrity, not source authenticity; the caller must verify every
external source reference.

## W17b record-evidence schemas

`recordEvidence.js` validates the four non-derivational evidence artifacts
carried by W17a:

- generation provenance, including externally supplied provider, model,
  effort, prompt hashes, sent configuration, timing, token use, and labeled
  cost estimate;
- review state with open tier and judgment labels;
- ambiguity grouping by bundle ID and nonnegative analysis index;
- dated provider-notice references and hashes.

These schemas preserve the caller's JSON values and add no provider roster,
reasoning policy, review taxonomy, cost policy, legal conclusion, publication
state, or source-authenticity claim. The returned copies are deeply frozen.
They are not a product integration and do not validate the opaque normalized
derivation.

## W17c evidence-bound envelope adapter

`recordEnvelopeAdapter.js` is the single join between the W17a envelope and
W17b evidence schemas. It validates the complete evidence set, requires the
generation record's framework identity to equal the W17a plan's framework
identity, and then creates or validates the canonical durable record.

The adapter does not interpret the normalized derivation, infer a framework,
repair evidence, add defaults, or authenticate external hashes. It introduces
no persistence or product path.

## W17d native-record export boundary

`nativeRecordExport.js` creates the sole full-derivation export: the canonical
native-JSON bytes of an already validated W17c record. Its validator checks the
raw byte hash, parses the canonical carrier, revalidates the complete W17
record, and binds the export to that record's hash.

Calling the pure function is the explicit export action. The module writes
nothing, persists nothing, and has no product, Tree Bank, server, publication,
license-selection, or alternate-carrier path. Final-tree-only interchange
formats remain outside this package.

## Browser-local Tree Bank

`services/treeBankRecords.ts` preserves received analyses and generation context
as immutable local records using this package's canonical JSON helpers. It does
not claim W17 export compatibility: current runtime responses do not provide all
the contract-artifact and dated provider-notice evidence required above. Missing
metadata remains missing. Native import/export adaptation is separate work.

`services/treeBankStore.ts` owns IndexedDB version 2. A save commits its ordered
analysis references, shared generation context, view state, and preview in one
transaction. Hashes are calculated before starting that transaction and checked
before reopening a saved analysis. Invalid bytes remain in storage and produce
an explicit error; other entries remain accessible. Listing reads thin wrappers,
and previews load separately as cards enter view. Version-1 entries remain in
their original store and retain the existing read/delete path without migration.

An explicit delete removes the selected saved-work wrapper and any content or
preview that no remaining wrapper references. When malformed references prevent
that determination, content is retained. Concurrent tabs share the database and
receive change notifications. Data remains browser-local and origin-specific;
atomic writes and integrity hashes do not provide a remote backup or prevent
browser storage eviction.
