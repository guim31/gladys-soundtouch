// -----------------------------------------------------------------------------
// The Gladys 5.3 music panel: the presets of a speaker as a catalog, and the
// artwork of what it plays, served to the core on demand.
//
// The web API has no queue, no search and no library browsing: the six
// presets are what Gladys can play by id (their ContentItem sent back to
// /select, like the hub's play_preset action). Artwork URLs come from the
// speaker (`<art>` of /now_playing, `<containerArt>` of a preset): Spotify and
// TuneIn covers are small, a stored-music cover from a media server may be
// the full file, made small here (src/artwork-resize.js).
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { MUSIC_MEDIA_TYPES, createLogger } from '@gladysassistant/integration-sdk';
import { MAX_ARTWORK_DOWNLOAD, prepareArtwork, readLimited } from './artwork-resize.js';
import { presetLabel } from './devices.js';

const logger = createLogger({ name: 'soundtouch-music' });

// --- Presets: the catalog ------------------------------------------------------

const PRESET_ID = /^preset:([1-6])$/;
// Sources whose presets are radio stations.
const RADIO_SOURCES = new Set([
  'TUNEIN',
  'INTERNET_RADIO',
  'LOCAL_INTERNET_RADIO',
  'IHEART',
  'RADIOPLAYER',
  'SIRIUSXM',
]);

/**
 * The stored presets of a speaker as MediaItems (only the stored ones: an
 * empty preset key does nothing).
 * @param {object} gladys for artworkKey
 * @param {Array<{ id: number, name: string|null, source: string, art?: string|null }>} presets
 * @param {string} language
 */
export function presetItems(gladys, presets, language) {
  return (presets ?? []).map((preset) => {
    const item = {
      id: `preset:${preset.id}`,
      type: RADIO_SOURCES.has(preset.source) ? MUSIC_MEDIA_TYPES.RADIO : MUSIC_MEDIA_TYPES.PLAYLIST,
      title: presetLabel(preset, language),
      duration: null,
      browsable: false,
      playable: true,
    };
    if (preset.art) {
      item.artwork_key = gladys.artworkKey(preset.art);
    }
    return item;
  });
}

/** The preset number of a MediaItem id, null when it is not one. */
export function presetNumberOf(id) {
  const match = PRESET_ID.exec(String(id ?? ''));
  return match ? Number(match[1]) : null;
}

// --- Artwork -------------------------------------------------------------------

const ARTWORK_TIMEOUT_MS = 10_000;
const PREPARED_ARTWORKS = 20;
const REDIRECTS = 3;

/** IPv4 of an IPv4-mapped IPv6 (`::ffff:c0a8:101`, `::ffff:192.168.1.1`), or null. */
function mappedIpv4(host) {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (dotted) {
    return dotted[1];
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hex) {
    return null;
  }
  const [high, low] = [Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/**
 * A private-network host (a media server on the LAN, the speaker itself): by
 * its address or its name. A public name that resolves into the LAN (DNS
 * rebinding) is not caught; only a validated image comes out anyway.
 */
export function isLanHost(hostname) {
  let host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  host = mappedIpv4(host) ?? host;
  const family = isIP(host);
  if (family === 4) {
    return /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      host,
    );
  }
  if (family === 6) {
    return /^(fe[89ab][0-9a-f]|f[cd][0-9a-f]{2}):/.test(host);
  }
  // A bare name (nas, router) or a local suffix.
  return !host.includes('.') || /\.(local|lan|home|internal|home\.arpa)$/.test(host);
}

/** Loopback or unspecified: the container itself, never fetched. */
function isLocalHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1?|::ffff:127\..*|::ffff:7f[0-9a-f]{2}:.*)$/.test(
    host,
  );
}

/**
 * The bytes of an artwork URL: redirects followed by hand (an Internet cover
 * never leads into the LAN), size and time bounded.
 * @param {string} url
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function downloadArtwork(
  url,
  { fetch: fetchImpl, timeoutMs = ARTWORK_TIMEOUT_MS } = {},
) {
  const fetcher = fetchImpl ?? globalThis.fetch;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  let previousLan = true;
  for (let hop = 0; hop <= REDIRECTS; hop += 1) {
    const target = new URL(current);
    target.hash = '';
    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new Error('not an http(s) URL');
    }
    if (isLocalHost(target.hostname)) {
      throw new Error('a local address');
    }
    const lan = isLanHost(target.hostname);
    if (hop > 0 && lan && !previousLan) {
      throw new Error('redirected to the local network');
    }
    previousLan = lan;
    const response = await fetcher(target.href, { redirect: 'manual', signal });
    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel?.().catch(() => {});
      current = new URL(location, target).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    return readLimited(response.body, MAX_ARTWORK_DOWNLOAD);
  }
  throw new Error('too many redirects');
}

/**
 * onMusicGetArtwork: the image of a key handed out by artworkKey, made small
 * enough for the core (300 KB, 4096 px) when it is not.
 * @param {object} gladys
 * @param {{ fetch?: typeof fetch }} [options]
 */
export function createArtworkHandler(gladys, { fetch: fetchImpl } = {}) {
  const prepared = new Map();
  return async (key) => {
    const known = prepared.get(key);
    if (known) {
      return known;
    }
    const url = gladys.artworkUrls?.get(key);
    if (!url) {
      throw new Error(`Unknown artwork ${key}`);
    }
    let base64;
    try {
      base64 = (await prepareArtwork(await downloadArtwork(url, { fetch: fetchImpl }))).toString(
        'base64',
      );
    } catch (err) {
      logger.debug(`Artwork ${key} not served (${err.message})`);
      throw new Error(`Artwork not available: ${err.message}`, { cause: err });
    }
    prepared.set(key, base64);
    while (prepared.size > PREPARED_ARTWORKS) {
      prepared.delete(prepared.keys().next().value);
    }
    return base64;
  };
}
