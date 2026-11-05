import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/**
 * The Generation Archive (ROADMAP, Program 6A): every parse that public Babel's
 * hosted function finishes, successful or failed, kept as one compressed JSON
 * record that is never changed. It is research infrastructure, not the
 * visitor's Tree Bank, and PRIVACY.md promises what it holds: the sentence and
 * what Babel and the model made of it, with no IP address, visitor hash, parse
 * ticket or anything else that could link a record to a person.
 *
 * A record is laid out like a qualification run's bundle.json (`request` and
 * `response`), so scripts/buildReplayReview.mjs reads a pulled archive as it
 * reads a saved batch.
 *
 * Money: the bucket's free tier is 10 GB. Babel counts the bytes it has stored
 * in the shared counter store and stops archiving at `capBytes` (9 GB), so the
 * archive can never be billed (Francis, 5 Nov 2026: "I don't want to spend any
 * real money on this"). Without the counter store it does not archive at all.
 */

export const ARCHIVE_RECORD_VERSION = 1;
export const ARCHIVE_CAP_BYTES = 9_000_000_000;
export const ARCHIVE_BYTES_KEY = 'babel:archive:bytes';
// The counter store gives every key an expiry; ten years is longer than this
// count will be needed.
const ARCHIVE_BYTES_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

const day = (time) => new Date(time).toISOString().slice(0, 10);
// Provider response IDs are letters, digits, '_' and '-'; anything else gets a fresh ID.
const safeId = (value) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null);

/** The archive's record for one finished parse. `outcome` is { response } or { failure }. */
export const buildArchiveRecord = ({ id, archivedAt, request, outcome, commit }) => ({
  archiveVersion: ARCHIVE_RECORD_VERSION,
  id,
  archivedAt: new Date(archivedAt).toISOString(),
  outcome: outcome.response ? 'parsed' : 'failed',
  request: {
    sentence: request.sentence,
    framework: request.framework,
    modelId: request.modelId,
    settings: request.settings ?? {}
  },
  ...(outcome.response ? { response: outcome.response } : { failure: outcome.failure }),
  babel: { commit: commit || null }
});

/**
 * `store` writes objects (server/archiveStore.js); `counter` is the shared
 * counter store. `record()` never throws: the archive must not break a parse.
 * It answers what happened: 'archived', 'already' (this generation's record
 * exists), 'full', 'unavailable' (no counter store) or 'failed'.
 */
export const createGenerationArchive = ({ store, counter, capBytes = ARCHIVE_CAP_BYTES, now = Date.now, newId = randomUUID, commit = null, log = console.error }) => ({
  async record({ request, outcome, responseId, startedAt }) {
    if (!counter) {
      log('[archive] not archiving: no shared counter store to keep the archive under its cap');
      return 'unavailable';
    }
    const archivedAt = now();
    // One generation is one record: a finished parse checked twice keeps its first.
    const id = safeId(responseId) ?? newId();
    const body = gzipSync(JSON.stringify(buildArchiveRecord({ id, archivedAt, request, outcome, commit })));
    const key = `parses/${day(startedAt ?? archivedAt)}/${id}.json.gz`;
    let reserved = false;
    try {
      const total = await counter.add(ARCHIVE_BYTES_KEY, body.length, ARCHIVE_BYTES_TTL_SECONDS);
      reserved = true;
      if (total > capBytes) {
        log(`[archive] FULL: the archive has reached its ${capBytes}-byte cap and is no longer saving parses`);
        await counter.add(ARCHIVE_BYTES_KEY, -body.length, ARCHIVE_BYTES_TTL_SECONDS);
        return 'full';
      }
      await store.put(key, body, 'application/gzip');
      return 'archived';
    } catch (error) {
      const already = /HTTP 412/.test(error?.message || '');
      if (reserved) await counter.add(ARCHIVE_BYTES_KEY, -body.length, ARCHIVE_BYTES_TTL_SECONDS).catch(() => {});
      if (already) return 'already';
      log(`[archive] could not archive a parse: ${error?.message || 'error'}`);
      return 'failed';
    }
  }
});
