// -----------------------------------------------------------------------------
// From a speaker to a Gladys device: features, values, commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  FEATURE_KEYS,
  NOTHING,
  buildDevice,
  commandFor,
  playingTexts,
  sourceOptions,
  speakerValues,
  zoneText,
} from '../src/devices.js';
import {
  parseInfo,
  parseNowPlaying,
  parsePresets,
  parseSources,
  parseVolume,
  parseZone,
} from '../src/soundtouch/model.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/soundtouch/${name}`, import.meta.url), 'utf8');

function speaker(overrides = {}) {
  return {
    id: '020000000001',
    host: '192.0.2.1',
    info: parseInfo(fixture('ha_device1_info.xml')),
    nowPlaying: parseNowPlaying(fixture('ha_device1_now_playing_radio.xml')),
    volume: parseVolume(fixture('ha_device1_volume.xml')),
    presets: parsePresets(fixture('ha_device1_presets.xml')),
    sources: parseSources(fixture('doc_sources.xml')),
    zone: parseZone(fixture('ha_device1_getZone_master.xml')),
    zoneKnown: true,
    ...overrides,
  };
}

const nowPlaying = (name) => parseNowPlaying(fixture(name));

test('one music player device per speaker, keyed on its device id', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, speaker(), { language: 'en' });
  assert.equal(device.external_id, 'ext:test-integration:speaker:020000000001');
  assert.equal(device.name, 'My SoundTouch 1');
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  assert.deepEqual(device.params, [
    { name: 'IP_ADDRESS', value: '192.0.2.1' },
    { name: 'MODEL', value: 'SoundTouch 10' },
    { name: 'FIRMWARE', value: '27.0.3.46298.4608935' },
  ]);
  assert.deepEqual(
    device.features.map((feature) => `${feature.category}/${feature.type}`),
    [
      'switch/binary',
      'music/volume',
      'switch/binary',
      'music/play',
      'music/pause',
      'music/previous',
      'music/next',
      'music/playback_state',
      'text/select',
      'text/text',
      'text/text',
      'text/text',
    ],
  );
  // The Music box needs exactly these to show a speaker.
  for (const type of ['play', 'pause', 'previous', 'next', 'volume', 'playback_state']) {
    assert.ok(
      device.features.some((feature) => feature.type === type),
      type,
    );
  }
});

test('the source select: AUX, Bluetooth and the stored presets, named', () => {
  assert.deepEqual(
    sourceOptions(speaker(), 'fr').map(({ value, label }) => `${value}=${label}`),
    [
      'other=Autre',
      'AUX=AUX',
      'BLUETOOTH=Bluetooth',
      'preset-1=Présélection 1',
      'preset-2=Présélection 2 · MockStation',
    ],
  );
  // A speaker without AUX in /sources (SoundTouch 10 series III style).
  const noAux = speaker({ sources: parseSources(fixture('doc_sources_no_aux.xml')) });
  assert.ok(!sourceOptions(noAux, 'en').some((option) => option.value === 'AUX'));
  // No /sources answer: both inputs are offered.
  const old = speaker({ sources: null });
  assert.ok(sourceOptions(old, 'en').some((option) => option.value === 'AUX'));
});

test('values while a preset radio plays', () => {
  assert.deepEqual(
    speakerValues(speaker(), 'en', (id) => (id === '020000000002' ? 'Bedroom' : id)),
    {
      power: 1,
      'playback-state': 1,
      source: { text: 'preset-2' },
      title: { text: 'MockTrack' },
      artist: { text: 'MockArtist' },
      volume: 12,
      mute: 0,
      zone: { text: 'Leads Bedroom, 020000000003' },
    },
  );
});

test('values in standby, on AUX, on Bluetooth, paused', () => {
  const standby = speakerValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_standby.xml') }),
    'fr',
  );
  assert.equal(standby.power, 0);
  assert.equal(standby['playback-state'], 0);
  assert.deepEqual(standby.source, { text: 'other' });
  assert.deepEqual(standby.title, { text: 'Veille' });
  assert.deepEqual(standby.artist, { text: NOTHING });

  const aux = speakerValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_aux.xml') }),
    'en',
  );
  assert.deepEqual(aux.source, { text: 'AUX' });
  assert.deepEqual(aux.title, { text: 'AUX IN' });

  const bluetooth = speakerValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_bluetooth.xml') }),
    'en',
  );
  assert.deepEqual(bluetooth.source, { text: 'BLUETOOTH' });

  const paused = speakerValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_upnp_paused.xml') }),
    'en',
  );
  assert.equal(paused.power, 1);
  assert.equal(paused['playback-state'], 0);
  // The UPnP address is stored as preset 1.
  assert.deepEqual(paused.source, { text: 'preset-1' });
});

test('a text state is never empty (Gladys would ignore it)', () => {
  for (const name of [
    'ha_device1_now_playing_aux.xml',
    'ha_device1_now_playing_standby.xml',
    'lib_radio.xml',
    'lib_stored_music.xml',
  ]) {
    const { title, artist } = playingTexts(nowPlaying(name), 'de');
    assert.ok(title.trim() && artist.trim(), name);
  }
  // A radio without song: the station is the title.
  assert.deepEqual(playingTexts(nowPlaying('lib_radio.xml'), 'en'), {
    title: 'RMC Info Talk Sport',
    artist: NOTHING,
  });
});

test('the group text, from the leader and from a member', () => {
  const names = { '020000000001': 'Kitchen', '020000000002': 'Bedroom' };
  const nameOf = (id) => names[id] ?? id.toUpperCase();
  assert.equal(zoneText(speaker(), 'fr', nameOf), 'Pilote Bedroom, 020000000003');
  const member = speaker({
    id: '020000000002',
    zone: parseZone(fixture('ha_device2_getZone_slave.xml')),
  });
  assert.equal(zoneText(member, 'de', nameOf), 'Folgt Kitchen');
  assert.equal(zoneText(speaker({ zone: null }), 'es', nameOf), 'Sin grupo');
});

test('power and mute toggle on the speaker: only sent when the state differs', () => {
  const on = speaker();
  assert.equal(commandFor(on, FEATURE_KEYS.POWER, 1), null);
  assert.deepEqual(commandFor(on, FEATURE_KEYS.POWER, 0), { key: 'POWER' });
  const standby = speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_standby.xml') });
  assert.deepEqual(commandFor(standby, FEATURE_KEYS.POWER, 1), { key: 'POWER' });
  assert.equal(commandFor(on, FEATURE_KEYS.MUTE, 0), null);
  assert.deepEqual(commandFor(on, FEATURE_KEYS.MUTE, 1), { key: 'MUTE' });
});

test('the other commands', () => {
  const on = speaker();
  assert.deepEqual(commandFor(on, FEATURE_KEYS.VOLUME, 33.4), { volume: 33 });
  assert.deepEqual(commandFor(on, FEATURE_KEYS.VOLUME, 140), { volume: 100 });
  assert.throws(() => commandFor(on, FEATURE_KEYS.VOLUME, 'x'));
  assert.deepEqual(commandFor(on, FEATURE_KEYS.PLAY, 1), { key: 'PLAY' });
  assert.deepEqual(commandFor(on, FEATURE_KEYS.PAUSE, 1), { key: 'PAUSE' });
  assert.deepEqual(commandFor(on, FEATURE_KEYS.NEXT, 1), { key: 'NEXT_TRACK' });
  assert.deepEqual(commandFor(on, FEATURE_KEYS.PREVIOUS, 1), { key: 'PREV_TRACK' });
  assert.equal(commandFor(on, FEATURE_KEYS.SOURCE, 'preset-2').preset.id, 2);
  assert.deepEqual(commandFor(on, FEATURE_KEYS.SOURCE, 'AUX'), {
    input: { value: 'AUX', source: 'AUX', account: 'AUX' },
  });
  assert.equal(commandFor(on, FEATURE_KEYS.SOURCE, 'other'), null);
  assert.throws(() => commandFor(on, FEATURE_KEYS.SOURCE, 'preset-5'), /empty/);
  assert.throws(() => commandFor(on, FEATURE_KEYS.SOURCE, 'SPOTIFY'), /Unknown source/);
  assert.throws(() => commandFor(on, FEATURE_KEYS.TITLE, 'x'), /no command/);
  assert.throws(() => commandFor(on, FEATURE_KEYS.PLAYBACK, 1), /no command/);
});
