// Response security headers for every route Babel serves. Express applies them
// through helmet; `vercel.json` repeats helmet's output as static headers, and
// tests/securityHeaders.test.mjs keeps the two identical.

export const CONTENT_SECURITY_DIRECTIVES = Object.freeze({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"]
});

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

/** Helmet options; HSTS is omitted only for a local plain-HTTP runtime. */
export const helmetOptions = ({ hsts }) => ({
  contentSecurityPolicy: { useDefaults: false, directives: CONTENT_SECURITY_DIRECTIVES },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: hsts ? undefined : false
});
