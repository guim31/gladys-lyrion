// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Lyrion's defaults: web server and JSON-RPC on 9000, CLI (telnet) on 9090.
export const DEFAULT_HTTP_PORT = 9000;
export const DEFAULT_CLI_PORT = 9090;

export const DEFAULT_CONFIG = {
  host: '',
  port: DEFAULT_HTTP_PORT,
  username: '',
  password: '',
  cli_port: DEFAULT_CLI_PORT,
  language: 'fr',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function portOf(value, fallback, { allowZero = false } = {}) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(number)) {
    return fallback;
  }
  if (allowZero && number === 0) {
    return 0;
  }
  return number >= 1 && number <= 65535 ? number : fallback;
}

/**
 * The server address the user typed: `192.0.2.10`, `lms.lan`, `192.0.2.10:9000`
 * or a full `http(s)://` URL. Returns null when it is not usable.
 * @returns {{ host: string, port: number|null, protocol: string } | null}
 */
export function parseHost(raw) {
  const typed = text(raw);
  if (typed === '') {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    // Credentials in the address would end up in logs; LMS serves its API at
    // the root of its web server.
    return null;
  }
  return { host: url.hostname, port: url.port ? Number(url.port) : null, protocol: url.protocol };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const parsed = parseHost(source.host);
  const port = parsed?.port ?? portOf(source.port, DEFAULT_HTTP_PORT);
  return {
    configured: text(source.host) !== '',
    valid: parsed !== null,
    host: parsed?.host ?? '',
    // URL.hostname keeps the brackets of an IPv6 address.
    baseUrl: parsed ? `${parsed.protocol}//${parsed.host}:${port}` : '',
    cliPort: portOf(source.cli_port, DEFAULT_CLI_PORT, { allowZero: true }),
    username: text(source.username),
    // Not trimmed: a password may start or end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
