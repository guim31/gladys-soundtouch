#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only check of a real SoundTouch speaker, with the integration's own
// client and parsers: `node scripts/probe.mjs <ip> [seconds]`.
//
// It reads /info, /now_playing, /volume, /presets, /sources and /getZone,
// listens to the notification WebSocket for a few seconds (change the volume
// or the track meanwhile to see the pushes), and checks that the UPnP
// renderer answers. It sends no command: nothing changes on the speaker.
//
// Nothing sensitive is printed: no account name (Spotify, Amazon…), no
// serial number, and the device id (the MAC address) is shortened.
// -----------------------------------------------------------------------------

import { SoundTouchClient, UPNP_PORT } from '../src/soundtouch/client.js';
import { activePreset, parseUpdate } from '../src/soundtouch/model.js';
import { LiveSocket } from '../src/soundtouch/socket.js';
import { speakerValues } from '../src/devices.js';

const [host, secondsArgument = '10'] = process.argv.slice(2);
if (!host) {
  console.error('Usage: node scripts/probe.mjs <speaker ip> [seconds of WebSocket listening]');
  process.exit(2);
}
const seconds = Math.min(120, Math.max(1, Number(secondsArgument) || 10));
const short = (id) => (id ? `${id.slice(0, 6)}…` : null);
const client = new SoundTouchClient(host);
let failures = 0;

async function step(label, fn) {
  try {
    const result = await fn();
    console.log(`OK   ${label}`, result === undefined ? '' : JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${label}: ${err.message}`);
    return null;
  }
}

const info = await step('/info', async () => {
  const value = await client.getInfo();
  return { ...value, id: short(value.id) };
});
const nowPlaying = await step('/now_playing', async () => {
  const value = await client.getNowPlaying();
  // The account of a streaming service is a user name: left out.
  return { ...value, content: value.content ? { ...value.content, account: undefined } : null };
});
const volume = await step('/volume', () => client.getVolume());
await step('/presets', async () =>
  (await client.getPresets()).map(({ id, name, source }) => ({ id, name, source })),
);
const sources = await step('/sources', async () =>
  (await client.getSources()).map(({ source, status, local }) => ({ source, status, local })),
);
await step('/getZone', async () => {
  const value = await client.getZone();
  return value
    ? { master: short(value.master), members: value.members.map((m) => short(m.id)) }
    : 'not grouped';
});

if (info && nowPlaying) {
  await step('what Gladys would show', async () => {
    const fullPresets = await client.getPresets();
    const speaker = {
      id: info.id,
      info,
      nowPlaying: await client.getNowPlaying(),
      volume,
      presets: fullPresets,
      sources: sources ? await client.getSources() : null,
      zone: await client.getZone(),
      zoneKnown: true,
    };
    return {
      activePreset: activePreset(speaker.nowPlaying, fullPresets)?.id ?? null,
      values: speakerValues(speaker, 'en', short),
    };
  });
}

await step(`UPnP renderer (port ${UPNP_PORT})`, async () => {
  const response = await fetch(`http://${host}:${UPNP_PORT}/`, {
    signal: AbortSignal.timeout(5_000),
  });
  return `answers (HTTP ${response.status})`;
});

console.log(`\nListening to the notifications for ${seconds} s (ws://${host}:8080, "gabbo")…`);
const kinds = [];
await new Promise((resolve) => {
  const socket = new LiveSocket({
    url: client.websocketUrl,
    timings: { reconnectMinMs: 60_000 },
    onOpen: () => console.log('OK   WebSocket open'),
    onClose: () => console.log('INFO WebSocket closed'),
    onMessage: (text) => {
      try {
        const update = parseUpdate(text);
        kinds.push(update.kind);
        const detail =
          update.kind === 'volume'
            ? update.payload
            : update.kind === 'nowPlaying'
              ? { source: update.payload?.source, playStatus: update.payload?.playStatus }
              : '';
        console.log(`PUSH ${update.kind}`, detail ? JSON.stringify(detail) : '');
      } catch (err) {
        console.log(`FAIL unreadable notification: ${err.message}`);
      }
    },
  });
  socket.start();
  setTimeout(() => {
    if (!socket.connected) {
      failures += 1;
      console.log('FAIL WebSocket did not open');
    }
    socket.stop();
    resolve();
  }, seconds * 1000);
});
console.log(
  `Notifications received: ${kinds.length} (${[...new Set(kinds)].join(', ') || 'none'})`,
);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
