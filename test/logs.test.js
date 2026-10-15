// -----------------------------------------------------------------------------
// Quiet logs: nothing at the info level for a normal cycle (refreshes,
// notifications, states, widget pulls), one line per user command, and never
// an account name or an address with credentials, even in debug.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAll, createWorld, deviceId, settle } from './helpers/world.js';
import { setNowPlaying, setVolume } from './helpers/fakeSpeaker.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/soundtouch/${name}`, import.meta.url), 'utf8');

/** Capture every log line (the SDK logger writes through console). */
function capture(t) {
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return lines;
}

async function withLevel(level, fn) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  try {
    return await fn();
  } finally {
    process.env.LOG_LEVEL = previous;
  }
}

test('a normal cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  try {
    await createAll(world);
    const { gladys, network, hub } = world;
    const [kitchen] = network.speakers;
    const lines = capture(t);
    await withLevel('info', async () => {
      for (const speaker of hub.speakers.values()) {
        await hub.refresh(speaker);
      }
      setVolume(kitchen, { level: 20 });
      setNowPlaying(kitchen, fixture('ha_device1_now_playing_bluetooth.xml'));
      await settle(hub);
      const device = gladys.fake.devices.find(
        (item) => item.external_id === deviceId(gladys, kitchen),
      );
      await gladys.fake.poll(device);
      await gladys.fake.widgetGet('player', {
        settings: { device: device.external_id },
        language: 'fr',
      });
      await settle(hub);
    });
    assert.deepEqual(lines, []);
  } finally {
    await world.app.stop();
  }
});

test('one info line per user command', async (t) => {
  const world = await createWorld();
  try {
    await createAll(world);
    const { gladys, network } = world;
    const [kitchen] = network.speakers;
    const device = gladys.fake.devices.find(
      (item) => item.external_id === deviceId(gladys, kitchen),
    );
    const lines = capture(t);
    await withLevel('info', async () => {
      await gladys.fake.setValue(device, device.features[1], 25);
      await settle(world.hub);
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[INFO\].*My SoundTouch 1: volume ← 25/);
  } finally {
    await world.app.stop();
  }
});

test('a speaker failing again and again is logged once, and once when it is back', async (t) => {
  const world = await createWorld();
  try {
    await createAll(world);
    const [kitchen] = world.network.speakers;
    const record = world.hub.speakers.get('020000000001');
    const lines = capture(t);
    await withLevel('info', async () => {
      kitchen.offline = true;
      for (let round = 0; round < 4; round += 1) {
        await world.hub.refresh(record);
      }
      kitchen.offline = false;
      await world.hub.refresh(record);
      await settle(world.hub);
    });
    assert.deepEqual(
      lines.map((line) => line.replace(/^\[[^\]]+\] /, '')),
      [
        '[INFO] [soundtouch] My SoundTouch 1 is unreachable',
        '[INFO] [soundtouch] My SoundTouch 1 is reachable',
      ],
    );
  } finally {
    await world.app.stop();
  }
});

test('no account name nor credentials in the logs, even in debug', async (t) => {
  const lines = capture(t);
  await withLevel('debug', async () => {
    const world = await createWorld({ config: { hosts: '192.0.2.1' } });
    try {
      await createAll(world);
      const { gladys, network } = world;
      const [kitchen] = network.speakers;
      setNowPlaying(kitchen, fixture('lib_spotify.xml'));
      await settle(world.hub);
      const device = gladys.fake.devices.find(
        (item) => item.external_id === deviceId(gladys, kitchen),
      );
      await gladys.fake.sceneAction('play_url', {
        device: device.external_id,
        url: 'http://listener:s3cret@192.0.2.50:8000/live.mp3',
      });
      await settle(world.hub);
    } finally {
      await world.app.stop();
    }
  });
  const text = lines.join('\n');
  assert.ok(text.length > 0, 'debug lines were written');
  for (const secret of [
    's3cret',
    'listener',
    'spotify_account',
    'UPnPUserName',
    'AccountUUIDValue',
  ]) {
    assert.equal(text.includes(secret), false, `"${secret}" leaked into the logs`);
  }
});
