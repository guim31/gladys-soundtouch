// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  hosts: '',
  language: 'fr',
};

// A host is an IPv4 address or a DNS name, without port: the SoundTouch ports
// are fixed (8090 for the API, 8080 for the notifications). mDNS names
// (`kitchen.local`) do not resolve inside the integration container.
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_HOSTS = 32;

/**
 * Parse the manual address list (commas, semicolons, spaces or new lines).
 * @param {unknown} raw
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    // Users paste URLs copied from the browser (http://192.0.2.10:8090/info):
    // keep the host part only, the port is always the same.
    const host = entry
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/:(8090|8080)$/, '')
      .toLowerCase();
    if (!host) {
      continue;
    }
    if (!isValidHost(host)) {
      invalid.push(entry.trim());
    } else if (!hosts.includes(host) && hosts.length < MAX_HOSTS) {
      hosts.push(host);
    }
  }
  return { hosts, invalid };
}

function isValidHost(host) {
  const ipv4 = host.match(IPV4_PATTERN);
  if (ipv4) {
    return ipv4.slice(1, 5).every((part) => Number(part) <= 255);
  }
  // A dotted string made of digits only is a mistyped address, not a name.
  if (/^[\d.]+$/.test(host)) {
    return false;
  }
  return HOST_PATTERN.test(host);
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  return {
    hosts,
    invalidHosts: invalid,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
