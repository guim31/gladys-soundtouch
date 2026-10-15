// -----------------------------------------------------------------------------
// Scene actions: play a preset, play an address.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAll, createWorld, deviceId, settle } from './helpers/world.js';

test('play_preset plays the preset and returns its name', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const bedroom = world.network.speakers[1];
    const ack = await world.gladys.fake.sceneAction('play_preset', {
      device: deviceId(world.gladys, bedroom),
      preset: '2',
    });
    assert.deepEqual(ack, {
      success: true,
      data: { outputs: { preset_name: 'Afternoon Accoustic' } },
    });
    assert.match(bedroom.selected[0], /Afternoon Accoustic/);
    await settle(world.hub);
    assert.deepEqual(world.gladys.fake.sceneEvents, [], 'no loop through the trigger');

    const empty = await world.gladys.fake.sceneAction('play_preset', {
      device: deviceId(world.gladys, bedroom),
      preset: '6',
    });
    assert.equal(empty.success, false);
    assert.match(empty.error, /Preset 6 is empty on My SoundTouch 2/);
  } finally {
    await world.app.stop();
  }
});

test('play_url sends an http address to the UPnP renderer, at the volume asked', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const [kitchen] = world.network.speakers;
    const device = deviceId(world.gladys, kitchen);
    const ack = await world.gladys.fake.sceneAction('play_url', {
      device,
      url: 'http://192.0.2.50:8000/doorbell.mp3',
      volume: 35,
    });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(kitchen.playedUrls, ['http://192.0.2.50:8000/doorbell.mp3']);
    assert.equal(kitchen.volume.level, 35);

    const https = await world.gladys.fake.sceneAction('play_url', {
      device,
      url: 'https://example.com/a.mp3',
    });
    assert.equal(https.success, false);
    assert.match(https.error, /only plays http:\/\//);
    assert.equal(kitchen.playedUrls.length, 1);
  } finally {
    await world.app.stop();
  }
});

test('an unknown speaker fails the action, not the scene', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.sceneAction('play_preset', {
      device: 'ext:test-integration:speaker:ffffffffffff',
      preset: '1',
    });
    assert.equal(ack.success, false);
    assert.match(ack.error, /Unknown SoundTouch device/);
  } finally {
    await world.app.stop();
  }
});
