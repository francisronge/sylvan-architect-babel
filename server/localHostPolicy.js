import net from 'node:net';

import { parseCsvEnv } from './parseHttpPolicy.js';

/**
 * Host admission for Babel's local runtimes: the Vite development server's
 * parse middleware, a non-production `npm start`, the manual qualification app
 * and the Tier 2 review file server. A page that rebinds its own DNS name to
 * 127.0.0.1 becomes same-origin with them, so neither CORS nor an Origin check
 * stops it, but the browser still sends that name as Host. These runtimes
 * therefore answer only names that cannot be rebound: `localhost` and
 * `*.localhost`, IP literals (which is how another device reaches a runtime
 * opened with BABEL_LISTEN_HOST=0.0.0.0) and names the developer lists in
 * BABEL_DEV_ALLOWED_HOSTS, where `.example.com` admits that domain and its
 * subdomains. This is the rule Vite applies to every other development path.
 * Production runtimes are outside this policy.
 */

const FORBIDDEN_HOST = {
  status: 403,
  body: { error: { code: 'FORBIDDEN_HOST', message: 'Use the local Babel app address.' } }
};

const HOST_HEADER = /^(?:\[([^\]]+)\]|([^:[\]]+))(?::(\d+))?$/;

/** `port`, when given, must also appear in Host; it pins a runtime that serves one fixed port. */
export const readLocalHostPolicy = (env = {}, { port } = {}) => ({
  allowedHosts: parseCsvEnv(env.BABEL_DEV_ALLOWED_HOSTS).map((entry) => entry.toLowerCase()),
  port: port === undefined ? undefined : String(port)
});

const isAdmittedHost = (policy, hostHeader) => {
  const match = String(hostHeader || '').trim().toLowerCase().match(HOST_HEADER);
  if (!match) return false;
  const [, ipv6, hostname, port = ''] = match;
  if (policy.port !== undefined && port !== policy.port) return false;
  if (ipv6 !== undefined) return net.isIP(ipv6) === 6;
  return net.isIP(hostname) === 4
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || policy.allowedHosts.some((entry) => (entry.startsWith('.')
      ? hostname === entry.slice(1) || hostname.endsWith(entry)
      : hostname === entry));
};

/** Returns a 403 FORBIDDEN_HOST rejection, or null when Host names an admitted local address. */
export const checkLocalRuntimeHost = (policy, hostHeader) =>
  (isAdmittedHost(policy, hostHeader) ? null : FORBIDDEN_HOST);
