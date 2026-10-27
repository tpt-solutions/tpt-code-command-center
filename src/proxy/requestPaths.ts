import * as crypto from 'crypto';

// Endpoints a client may reach through the proxy. Anything else (files, batches,
// organisation admin) would let a token holder read or spend with the real provider key.
const ALLOWED_PATHS = ['/v1/messages', '/v1/chat/completions', '/v1/models', '/v1/embeddings'];

export function pathOnly(requestUrl: string): string {
  const q = requestUrl.indexOf('?');
  return q >= 0 ? requestUrl.slice(0, q) : requestUrl;
}

export function isAllowedPath(requestUrl: string): boolean {
  const p = pathOnly(requestUrl);
  return ALLOWED_PATHS.some((allowed) => p === allowed || p.startsWith(allowed + '/'));
}

// Joins a provider base URL path with the path the client requested. Client base URLs
// and provider base URLs often both end in "/v1" (for example OPENAI_BASE_URL=.../v1 and
// https://api.openai.com/v1), so the overlapping segment is only kept once.
export function buildUpstreamPath(basePathname: string, requestUrl: string): string {
  const query = requestUrl.includes('?') ? requestUrl.slice(requestUrl.indexOf('?')) : '';
  const baseSegs = basePathname.split('/').filter(Boolean);
  const reqSegs = pathOnly(requestUrl).split('/').filter(Boolean);

  for (let k = Math.min(baseSegs.length, reqSegs.length); k > 0; k--) {
    if (baseSegs.slice(-k).join('/') === reqSegs.slice(0, k).join('/')) {
      return '/' + [...baseSegs, ...reqSegs.slice(k)].join('/') + query;
    }
  }
  return '/' + [...baseSegs, ...reqSegs].join('/') + query;
}

// Constant-time comparison of the presented session token against the expected one.
// A repeated header arrives as an array and is rejected outright.
export function tokenMatches(presented: string | string[] | undefined, expected: string | undefined): boolean {
  if (typeof presented !== 'string' || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
