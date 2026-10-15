// -----------------------------------------------------------------------------
// Where to look for SoundTouch speakers: the mDNS announcements relayed by the
// Gladys core (`_soundtouch._tcp`, declared in the manifest
// `network_discovery`), the addresses typed in the configuration, and the
// addresses already known.
//
// The integration container sits on a bridge network: it never sees mDNS
// itself, the core browses for it (mediated network discovery). Each address
// is then asked for its /info, and the device id the speaker reports
// identifies it whatever address it answers on.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { normalizeDeviceId } from './soundtouch/model.js';

export const MDNS_SERVICE = '_soundtouch._tcp';
export const MDNS_TIMEOUT_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Candidate addresses from the raw mDNS results of `scanNetwork('mdns')`:
 * `[{ host, id, name }]`. Only IPv4: a link-local IPv6 address cannot be
 * reached from the container. The TXT record carries the MAC address
 * (`MAC=...`), which is the speaker's device id.
 * @param {Array} results `[{ name, host, addresses, port, txt }]`
 */
export function mdnsCandidates(results) {
  const candidates = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || typeof result !== 'object') {
      continue;
    }
    const addresses = Array.isArray(result.addresses) ? result.addresses : [];
    const host = addresses.find((address) => typeof address === 'string' && IPV4.test(address));
    if (!host || candidates.some((candidate) => candidate.host === host)) {
      continue;
    }
    const txt = parseMdnsTxt(Array.isArray(result.txt) ? result.txt : []);
    candidates.push({
      host,
      id: normalizeDeviceId(txt.mac),
      name: typeof result.name === 'string' ? result.name : null,
    });
  }
  return candidates;
}

/**
 * Run `task` on every item, `limit` at a time; resolves with the results in
 * order (`{ value }` or `{ error }`).
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
