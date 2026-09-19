// @ts-check

// Credentials that must never be written to an exported settings backup when they appear
// in an AI endpoint query string. Kept locally so the lightweight extension has no desktop
// protocol dependency.
export const SECRET_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'session',
  'sessionid',
  'sid',
  'auth',
  'authorization',
  'api_key',
  'apikey',
  'password',
  'pwd',
  'secret',
  'signature',
  'sig',
  'code',
  'key'
]);

/**
 * Strip credentials from a URL the user typed, keeping everything else.
 * Local HTTP endpoints remain valid because local model servers commonly use them.
 *
 * @param {unknown} raw
 * @returns {{ url: string, changed: boolean }}
 */
export function redactUrlCredentials(raw) {
  const text = typeof raw === 'string' ? raw : '';

  let url;
  try {
    url = new URL(text);
  } catch {
    return { url: text, changed: false };
  }

  let changed = Boolean(url.username || url.password);
  url.username = '';
  url.password = '';

  /** @type {Array<[string, string]>} */
  const kept = [];
  for (const [name, value] of url.searchParams) {
    if (SECRET_QUERY_KEYS.has(name.toLowerCase().replaceAll('-', '_'))) {
      changed = true;
      continue;
    }
    kept.push([name, value]);
  }

  url.search = '';
  for (const [name, value] of kept) url.searchParams.append(name, value);
  return { url: url.toString(), changed };
}
