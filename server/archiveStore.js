import { createHash, createHmac } from 'node:crypto';

/**
 * Where the Generation Archive puts its records: a private Cloudflare R2
 * bucket reached through R2's S3-compatible API with an access key limited to
 * that bucket. Only Babel's official deployment sets these variables, so local
 * runs and forks never upload (ROADMAP, Program 6A, item 5).
 *
 * Requests are signed with AWS Signature Version 4, which R2 accepts with the
 * region "auto". The server only writes one object at a time;
 * scripts/pullGenerationArchive.mjs reads the bucket with the same signing.
 */

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// RFC 3986 encoding, as Signature Version 4 requires; a path keeps its '/'.
export const encodeRfc3986 = (value) => encodeURIComponent(value)
  .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (key) => key.split('/').map(encodeRfc3986).join('/');
// The canonical query: every parameter encoded, sorted by name.
const canonicalQuery = (params) => [...params].map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)])
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, value]) => `${name}=${value}`).join('&');

/** The headers that sign one request; `now` is a Date. */
export const signRequest = ({ method, url, headers, body, accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = new Date() }) => {
  const target = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? '');
  const signed = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
    host: target.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(signed).sort();
  const canonical = [method, target.pathname, canonicalQuery(target.searchParams),
    names.map(name => `${name}:${signed[name]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = [day, region, service, 'aws4_request'].reduce((k, part) => hmac(k, part), `AWS4${secretAccessKey}`);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...signed,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
};

/**
 * The archive store from the environment, or null when this deployment does
 * not archive. `put(key, body, contentType)` writes one object and refuses to
 * replace an existing one, so a record, once written, is never changed. A
 * refusal throws with the HTTP `status`; a lost answer throws without one.
 */
/** The archive settings from the environment, or null when any is missing. */
export const readArchiveSettings = (env) => {
  const settings = {
    endpoint: String(env.BABEL_ARCHIVE_R2_ENDPOINT || '').trim().replace(/\/+$/, ''),
    bucket: String(env.BABEL_ARCHIVE_R2_BUCKET || '').trim(),
    accessKeyId: String(env.BABEL_ARCHIVE_R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(env.BABEL_ARCHIVE_R2_SECRET_ACCESS_KEY || '').trim()
  };
  return Object.values(settings).every(Boolean) ? settings : null;
};

export const readArchiveStore = (env, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) => {
  const settings = readArchiveSettings(env);
  if (!settings) return null;
  const { endpoint, bucket, accessKeyId, secretAccessKey } = settings;
  const base = `${endpoint}/${encodeRfc3986(bucket)}`;
  return {
    async put(key, body, contentType = 'application/octet-stream') {
      const url = `${base}/${encodePath(key)}`;
      const headers = signRequest({ method: 'PUT', url, body, accessKeyId, secretAccessKey,
        headers: { 'content-type': contentType, 'if-none-match': '*' } });
      const response = await fetchImpl(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw Object.assign(new Error(`Archive store refused the record (HTTP ${response.status}).`), { status: response.status });
    }
  };
};
