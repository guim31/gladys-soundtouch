// -----------------------------------------------------------------------------
// Builds a complete test world: the SDK's fake Gladys, a simulated network of
// SoundTouch speakers, a temporary /data, and the integration wired on top
// through registerHandlers — the very wiring index.js uses.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FIXTURES, createNetwork, createSpeaker, settle } from './fakeSpeaker.js';

// The integration logs every discovery; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

/** One speaker per fixture, each on its own address. */
export const allSpeakers = () => Object.values(FIXTURES).map((spec) => createSpeaker(spec));

/**
 * @param {object} [options]
 * @param {Array} [options.speakers] from createSpeaker
 * @param {object} [options.config] raw integration config
 * @param {boolean} [options.mdns] the core relays the speakers' mDNS announcements
 * @param {Array} [options.gladysDevices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {string} [options.dataDir]
 * @param {object} [options.timings] hub timing overrides
 * @param {boolean} [options.timers] run the hub's own timers (refresh, rescan)
 * @param {typeof fetch} [options.artworkFetch] what the artwork handler downloads with
 */
export async function createWorld({
  speakers = allSpeakers(),
  config = {},
  mdns = true,
  gladysDevices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-soundtouch-')),
  timings = {},
  timers = false,
  socketTimings,
  now,
  artworkFetch,
} = {}) {
  const network = createNetwork(speakers);
  const gladys = createFakeGladys({
    config,
    devices: gladysDevices,
    scanResults: { mdns: mdns ? network.mdnsResults() : [] },
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: network.fetch,
    createSocket: network.createSocket,
    timers,
    timings: { debounceMs: 0, afterCommandMs: 0, ...timings },
    socketTimings,
    now,
    artworkFetch,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle(app.hub);
  }
  return { gladys, network, app, hub: app.hub, dataDir };
}

/** External id of the device of a simulated speaker. */
export const deviceId = (gladys, speaker) =>
  gladys.externalIds('speaker', speaker.id.toLowerCase()).device;

/** External id of one feature of a simulated speaker. */
export const featureId = (gladys, speaker, key) =>
  gladys.externalIds('speaker', speaker.id.toLowerCase()).feature(key);

/** Create every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
  await settle(world.hub);
}

export { settle };
