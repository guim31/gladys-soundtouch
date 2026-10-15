// -----------------------------------------------------------------------------
// End to end: the integration against the SDK's fake Gladys and simulated
// speakers (test/helpers/fakeSpeaker.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import {
  allSpeakers,
  createAll,
  createWorld,
  deviceId,
  featureId,
  settle,
} from './helpers/world.js';
import { FIXTURES, createSpeaker, setNowPlaying, setVolume, push } from './helpers/fakeSpeaker.js';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/soundtouch/${name}`, import.meta.url), 'utf8');

const statesOf = (gladys, externalId) =>
  gladys.fake.states.filter((state) => state.device_feature_external_id === externalId);

const last = (gladys, externalId) => {
  const states = statesOf(gladys, externalId);
  const state = states[states.length - 1];
  return state?.text ?? state?.state;
};

test('the speakers announced over mDNS become devices in the Discovery tab', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    assert.deepEqual(gladys.fake.scans, [{ type: 'mdns', timeout_seconds: 5 }]);
    assert.deepEqual(
      gladys.fake.discoveredDevices.map((device) => device.name),
      ['My SoundTouch 1', 'My SoundTouch 2', 'Home'],
    );
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
    // Nothing published for devices the user has not added (Gladys drops them).
    assert.equal(gladys.fake.states.length, 0);
    // One live WebSocket per speaker, sub-protocol "gabbo".
    assert.equal(
      network.speakers.every((speaker) => speaker.sockets.size === 1),
      true,
    );
    assert.deepEqual(network.sockets[0].protocols, ['gabbo']);
  } finally {
    await world.app.stop();
  }
});

test('a typed address is enough when mDNS finds nothing', async () => {
  const world = await createWorld({ mdns: false, config: { hosts: '192.0.2.2, 300.0.0.1' } });
  try {
    assert.deepEqual(
      world.gladys.fake.discoveredDevices.map((device) => device.name),
      ['My SoundTouch 2'],
    );
    const ack = await world.gladys.fake.action('search', {});
    assert.equal(ack.success, true);
    assert.match(
      ack.data.message.en,
      /1 speaker\(s\), 1 answering: My SoundTouch 2 \(SoundTouch 10, 192\.0\.2\.2, live\)/,
    );
    assert.match(ack.data.message.fr, /Adresses ignorées : 300\.0\.0\.1/);
  } finally {
    await world.app.stop();
  }
});

test('an older core refusing the mDNS scan: typed addresses still work, the user is told', async () => {
  const world = await createWorld({ connect: false, config: { hosts: '192.0.2.1' } });
  world.gladys.scanNetwork = async () => {
    throw new GladysApiError(403, 'FORBIDDEN', 'network discovery not declared');
  };
  try {
    await world.gladys.connect();
    await world.app.ready;
    await settle(world.hub);
    assert.equal(world.gladys.fake.discoveredDevices.length, 1);
    const ack = await world.gladys.fake.action('search', {});
    assert.match(ack.data.message.de, /automatische Erkennung \(mDNS\).*Gib die IP-Adressen ein/);
  } finally {
    await world.app.stop();
  }
});

test('no speaker at all: Gladys shows why', async () => {
  const world = await createWorld({ speakers: [] });
  try {
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.fr, /Aucune enceinte SoundTouch/);
    const ack = await world.gladys.fake.action('search', {});
    assert.equal(ack.data.message.es, 'No se ha encontrado ningún altavoz SoundTouch.');
  } finally {
    await world.app.stop();
  }
});

test('adding a device publishes its states at once, then only what changes', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [kitchen] = network.speakers;
    await createAll(world);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'power')), 1);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'volume')), 12);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'source')), 'preset-2');
    assert.equal(last(gladys, featureId(gladys, kitchen, 'title')), 'MockTrack');
    assert.equal(
      last(gladys, featureId(gladys, kitchen, 'zone')),
      'Pilote My SoundTouch 2, 020000000003',
    );
    // Transport badges once the devices exist.
    assert.deepEqual(
      gladys.fake.transports.map((entry) => entry.transport),
      ['local', 'local', 'local'],
    );
    // The widget is told to re-pull.
    assert.ok(gladys.fake.widgetRefreshes.includes('player'));

    const count = gladys.fake.states.length;
    await world.hub.refresh(world.hub.speakers.get('020000000001'));
    await settle(world.hub);
    assert.equal(gladys.fake.states.length, count, 'an unchanged refresh publishes nothing');
  } finally {
    await world.app.stop();
  }
});

test('a device updated from the Discovery tab gets its states again', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [kitchen] = network.speakers;
    await createAll(world);
    const id = featureId(gladys, kitchen, 'volume');
    const before = statesOf(gladys, id).length;
    const device = gladys.fake.devices.find(
      (item) => item.external_id === deviceId(gladys, kitchen),
    );
    await gladys.fake.deviceUpdated(device);
    await settle(world.hub);
    assert.equal(statesOf(gladys, id).length, before + 1);
  } finally {
    await world.app.stop();
  }
});

test('commands: volume, mute, power, play/pause, next', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [kitchen] = network.speakers;
    await createAll(world);
    const device = gladys.fake.devices.find(
      (item) => item.external_id === deviceId(gladys, kitchen),
    );
    const feature = (key) =>
      device.features.find((item) => item.external_id === featureId(gladys, kitchen, key));
    const set = async (key, value) => {
      const ack = await gladys.fake.setValue(device, feature(key), value);
      await settle(world.hub);
      return ack;
    };

    assert.deepEqual(await set('volume', 30), { success: true });
    assert.equal(kitchen.volume.level, 30);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'volume')), 30);

    await set('mute', 1);
    assert.equal(kitchen.volume.muted, true);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'mute')), 1);
    await set('mute', 1);
    assert.deepEqual(kitchen.keys, ['MUTE'], 'already muted: MUTE not sent again');

    await set('pause', 1);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'playback-state')), 0);
    await set('play', 1);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'playback-state')), 1);
    await set('next', 1);
    await set('previous', 1);
    assert.deepEqual(kitchen.keys.slice(-2), ['NEXT_TRACK', 'PREV_TRACK']);

    await set('power', 0);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'power')), 0);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'title')), 'Veille');
    await set('power', 0);
    assert.equal(
      kitchen.keys.filter((key) => key === 'POWER').length,
      1,
      'POWER toggles: sent once',
    );
    await set('power', 1);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'power')), 1);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'source')), 'preset-2');
  } finally {
    await world.app.stop();
  }
});

test('the source select plays a preset or switches input, without firing the trigger', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const bedroom = network.speakers[1];
    await createAll(world);
    const device = gladys.fake.devices.find(
      (item) => item.external_id === deviceId(gladys, bedroom),
    );
    const source = device.features.find((item) => item.type === 'select');

    await gladys.fake.setValue(device, source, 'preset-3');
    await settle(world.hub);
    assert.match(bedroom.selected[0], /location="spotify:user:XXXX"/);
    assert.equal(last(gladys, featureId(gladys, bedroom, 'source')), 'preset-3');
    assert.equal(last(gladys, featureId(gladys, bedroom, 'title')), 'Rock Ballads');
    assert.deepEqual(gladys.fake.sceneEvents, [], 'started by Gladys: no event');

    await gladys.fake.setValue(device, source, 'BLUETOOTH');
    await settle(world.hub);
    assert.equal(bedroom.selected[1], '<ContentItem source="BLUETOOTH"></ContentItem>');
    assert.equal(last(gladys, featureId(gladys, bedroom, 'source')), 'BLUETOOTH');

    // "Other" changes nothing and shows the real source back.
    const before = bedroom.selected.length;
    await gladys.fake.setValue(device, source, 'other');
    await settle(world.hub);
    assert.equal(bedroom.selected.length, before);
    assert.equal(last(gladys, featureId(gladys, bedroom, 'source')), 'BLUETOOTH');

    const refused = await gladys.fake.setValue(device, source, 'preset-6');
    assert.equal(refused.success, false);
    assert.match(refused.error, /Preset 6 is empty/);
  } finally {
    await world.app.stop();
  }
});

test('a preset started on the speaker fires the scene trigger', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [kitchen] = network.speakers;
    await createAll(world);
    setNowPlaying(kitchen, fixture('ha_device1_now_playing_aux.xml'));
    await settle(world.hub);
    assert.deepEqual(gladys.fake.sceneEvents, []);
    setNowPlaying(kitchen, fixture('ha_device1_now_playing_radio.xml'));
    await settle(world.hub);
    assert.deepEqual(gladys.fake.sceneEvents, [
      {
        key: 'preset_selected',
        data: { device: deviceId(gladys, kitchen), preset: 2, preset_name: 'MockStation' },
      },
    ]);
    // The same preset again (a new song on the radio): no new event.
    setNowPlaying(
      kitchen,
      fixture('ha_device1_now_playing_radio.xml').replace(/MockTrack/, 'Other'),
    );
    await settle(world.hub);
    assert.equal(gladys.fake.sceneEvents.length, 1);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'title')), 'Other');
  } finally {
    await world.app.stop();
  }
});

test('notifications: volume knob, group change, preset renamed in the app', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [kitchen, bedroom] = network.speakers;
    await createAll(world);

    setVolume(kitchen, { level: 45 });
    await settle(world.hub);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'volume')), 45);

    // The bedroom leaves the group.
    bedroom.zoneXml = fixture('doc_zone_empty.xml');
    push(bedroom, '<zoneUpdated/>');
    await settle(world.hub);
    assert.equal(last(gladys, featureId(gladys, bedroom, 'zone')), 'Hors groupe');

    // A preset stored from the Bose app: the select options follow.
    const presetsDocument = fixture('lib_ws_presets.xml').replace('Zedd', 'France Inter');
    bedroom.presetsXml = presetsDocument.match(/<presets>[\s\S]*<\/presets>/)[0];
    push(bedroom, presetsDocument.match(/<presetsUpdated>[\s\S]*<\/presetsUpdated>/)[0]);
    await settle(world.hub);
    const device = gladys.fake.discoveredDevices.find(
      (item) => item.external_id === deviceId(gladys, bedroom),
    );
    const options = device.features.find((item) => item.type === 'select').supported_options;
    assert.ok(options.some((option) => option.label === 'Présélection 1 · France Inter'));

    // Garbage on the socket is ignored.
    push(bedroom, '<unknownUpdate/>');
    for (const socket of bedroom.sockets) {
      socket.deliver('not xml <');
    }
    await settle(world.hub);
  } finally {
    await world.app.stop();
  }
});

test('a speaker lost and back: transport badge, connection status, widget', async () => {
  const speakers = [createSpeaker(FIXTURES.kitchen)];
  const world = await createWorld({ speakers });
  try {
    const { gladys } = world;
    const [kitchen] = speakers;
    await createAll(world);
    const record = world.hub.speakers.get('020000000001');

    kitchen.offline = true;
    for (const socket of [...kitchen.sockets]) {
      socket.drop();
    }
    await world.hub.refresh(record);
    await settle(world.hub);
    assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.match(gladys.fake.connectionStatus.message.en, /No SoundTouch speaker answers/);

    // A command on an unreachable speaker fails, and says so.
    const device = gladys.fake.devices[0];
    const ack = await gladys.fake.setValue(device, device.features[1], 20);
    assert.equal(ack.success, false);
    assert.match(ack.error, /unreachable/);

    kitchen.offline = false;
    await world.hub.refresh(record);
    await settle(world.hub);
    assert.equal(gladys.fake.transports.at(-1).transport, 'local');
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.app.stop();
  }
});

test('a speaker moved by DHCP keeps its device, with its new address', async () => {
  const speakers = [createSpeaker(FIXTURES.kitchen)];
  const world = await createWorld({ speakers });
  try {
    const { gladys, network } = world;
    const [kitchen] = speakers;
    network.byHost.delete(kitchen.host);
    kitchen.host = '192.0.2.99';
    network.byHost.set(kitchen.host, kitchen);
    gladys.fake.scanResults.mdns = network.mdnsResults();
    await gladys.fake.scanRequest();
    await settle(world.hub);
    const [device] = gladys.fake.discoveredDevices;
    assert.equal(device.external_id, deviceId(gladys, kitchen));
    assert.deepEqual(device.params[0], { name: 'IP_ADDRESS', value: '192.0.2.99' });
  } finally {
    await world.app.stop();
  }
});

test('after a restart, the speakers seen before are known even while off', async () => {
  const first = await createWorld();
  await first.app.stop();
  const speakers = allSpeakers();
  for (const speaker of speakers) {
    speaker.offline = true;
  }
  const second = await createWorld({ speakers, mdns: false, dataDir: first.dataDir });
  try {
    assert.equal(second.gladys.fake.discoveredDevices.length, 3);
    assert.equal(second.gladys.fake.connectionStatus.connected, false);
  } finally {
    await second.app.stop();
  }
});

test('the core poll still works as a fallback', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [kitchen] = network.speakers;
    await createAll(world);
    setVolume(kitchen, { level: 66 }, { notify: false });
    const device = gladys.fake.devices.find(
      (item) => item.external_id === deviceId(gladys, kitchen),
    );
    assert.deepEqual(await gladys.fake.poll(device), { success: true });
    await settle(world.hub);
    assert.equal(last(gladys, featureId(gladys, kitchen, 'volume')), 66);
  } finally {
    await world.app.stop();
  }
});

test('a new language rewrites the texts', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const bedroom = network.speakers[1];
    await createAll(world);
    assert.equal(last(gladys, featureId(gladys, bedroom, 'title')), 'Veille');
    await gladys.fake.configUpdated({ language: 'es' });
    await settle(world.hub);
    assert.equal(last(gladys, featureId(gladys, bedroom, 'title')), 'En espera');
    assert.equal(last(gladys, featureId(gladys, bedroom, 'zone')), 'Sigue a My SoundTouch 1');
    const names = gladys.fake.discoveredDevices[0].features.map((feature) => feature.name);
    assert.ok(names.includes('Volumen') && names.includes('Grupo multisala'));
  } finally {
    await world.app.stop();
  }
});

test('Gladys restarting: everything is published again on reconnection', async () => {
  const world = await createWorld();
  try {
    const { gladys } = world;
    await createAll(world);
    const count = gladys.fake.states.length;
    await gladys.disconnect();
    await gladys.connect();
    await settle(world.hub);
    assert.ok(gladys.fake.states.length >= count + 3 * 8, 'states sent again');
  } finally {
    await world.app.stop();
  }
});
