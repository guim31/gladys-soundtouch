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
  musicValues,
  playingTexts,
  positionOf,
  sourceOptions,
  speakerValues,
  zoneText,
} from '../src/devices.js';
import {
  mergeNowPlaying,
  parseInfo,
  parseNowPlaying,
  parseUpdate,
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
      'music/mute',
      'music/play',
      'music/pause',
      'music/previous',
      'music/next',
      'music/playback_state',
      'text/select',
      'music/title',
      'music/artist',
      'text/text',
      'music/album',
      'music/artwork',
      'music/duration',
      'music/position',
      'music/shuffle',
      'music/repeat',
    ],
  );
  // The 1.0 external ids are kept: mute, title and artist convert in place.
  const byKey = Object.fromEntries(
    device.features.map((feature) => [feature.external_id.split(':').pop(), feature]),
  );
  assert.deepEqual(Object.keys(byKey).slice(0, 12), [
    'power',
    'volume',
    'mute',
    'play',
    'pause',
    'previous',
    'next',
    'playback-state',
    'source',
    'title',
    'artist',
    'zone',
  ]);
  // Writable music features answer with feedback; position is read only (no seek).
  assert.deepEqual(
    Object.entries(byKey)
      .filter(([, feature]) => feature.category === 'music' && !feature.read_only)
      .map(([key, feature]) => `${key}:${feature.max}:${feature.has_feedback}`),
    [
      'volume:100:true',
      'mute:1:true',
      'play:1:false',
      'pause:1:false',
      'previous:1:false',
      'next:1:false',
      'playback-state:2:true',
      'shuffle:1:true',
      'repeat:2:true',
    ],
  );
  assert.equal(byKey.position.read_only, true);
  assert.equal(byKey.position.unit, 'seconds');
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
      source: { text: 'preset-2' },
      zone: { text: 'Leads Bedroom, 020000000003' },
    },
  );
  // A radio reports no time: duration 0, the position counted by the hub.
  assert.deepEqual(musicValues(speaker(), 'en', 75), {
    playback_state: 1,
    title: 'MockTrack',
    artist: 'MockArtist',
    album: 'MockAlbum',
    artwork_url: 'http://cdn-profiles.tunein.com/sXXXXX/images/logoq.png',
    duration: 0,
    position: 75,
    volume: 12,
    mute: 0,
  });
});

test('music values on Spotify (libsoundtouch): artwork, time, shuffle, repeat', () => {
  const spotify = speaker({ nowPlaying: nowPlaying('lib_spotify.xml') });
  assert.deepEqual(musicValues(spotify, 'en', 402), {
    playback_state: 1,
    title: 'Nothing Else Matters (Live)',
    artist: 'Metallica',
    album: 'Metallica Through The Never (Music from the Motion Picture)',
    // The URL comes indented in the document.
    artwork_url: 'http://i.scdn.co/image/1362a06f43',
    duration: 441,
    position: 402,
    shuffle: 0,
    repeat: 0,
    volume: 12,
    mute: 0,
  });
  // The WebSocket push of libsoundtouch: shuffle on.
  const pushed = parseUpdate(fixture('lib_ws_status.xml')).payload;
  assert.equal(musicValues(speaker({ nowPlaying: pushed }), 'en', 30).shuffle, 1);
  // Stored music: no artwork (SHOW_DEFAULT_IMAGE), repeat one written by the speaker.
  const stored = nowPlaying('lib_stored_music.xml');
  const values = musicValues(
    speaker({ nowPlaying: { ...stored, repeat: 'REPEAT_ONE' } }),
    'en',
    77,
  );
  assert.equal(values.artwork_url, null);
  assert.equal(values.repeat, 2);
});

test('music values: standby clears everything, buffering is 3, stop is idle', () => {
  const standby = musicValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_standby.xml') }),
    'fr',
    12,
  );
  assert.deepEqual(standby, {
    playback_state: 2,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
    volume: 12,
    mute: 0,
  });
  const buffering = parseUpdate(
    `<updates deviceID="11223344">${fixture('lib_spotify_buffering.xml')}</updates>`,
  ).payload;
  const merged = mergeNowPlaying(nowPlaying('lib_spotify.xml'), buffering);
  assert.equal(musicValues(speaker({ nowPlaying: merged }), 'en', 0).playback_state, 3);
  assert.equal(
    musicValues(speaker({ nowPlaying: merged }), 'en', 0).title,
    'Nothing Else Matters (Live)',
  );
  const stopped = { ...nowPlaying('lib_spotify.xml'), playStatus: 'STOP_STATE' };
  assert.equal(musicValues(speaker({ nowPlaying: stopped }), 'en', 0).playback_state, 2);
  // AUX: no metadata, the input's name keeps the player from looking empty.
  const aux = musicValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_aux.xml') }),
    'en',
    0,
  );
  assert.deepEqual([aux.title, aux.artist, aux.album, aux.duration], ['AUX IN', '', '', 0]);
  // Bluetooth: the phone's name is the station, not repeated as album.
  const bt = musicValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_bluetooth.xml') }),
    'en',
    0,
  );
  assert.deepEqual([bt.title, bt.artist, bt.album], ['MockTrack', 'MockArtist', 'MockAlbum']);
  // A radio without song: the station is the title, nothing below.
  const radio = musicValues(speaker({ nowPlaying: nowPlaying('lib_radio.xml') }), 'en', 0);
  assert.deepEqual([radio.title, radio.artist, radio.album], ['RMC Info Talk Sport', '', '']);
});

test('the position: sample moved forward while playing, frozen in pause, counted for a stream', () => {
  const upnp = nowPlaying('ha_device1_now_playing_upnp.xml'); // 7 s of 42
  const at = 1_000_000;
  assert.equal(positionOf({ nowPlaying: upnp, sampledAt: at }, at + 10_400), 17);
  assert.equal(positionOf({ nowPlaying: upnp, sampledAt: at }, at + 60_000), 42);
  const paused = nowPlaying('ha_device1_now_playing_upnp_paused.xml');
  assert.equal(positionOf({ nowPlaying: paused, sampledAt: at }, at + 60_000), paused.position);
  const radio = nowPlaying('ha_device1_now_playing_radio.xml');
  assert.equal(positionOf({ nowPlaying: radio, trackStart: at }, at + 95_000), 95);
  assert.equal(
    positionOf(
      { nowPlaying: { ...radio, playStatus: 'PAUSE_STATE' }, trackStart: at },
      at + 95_000,
    ),
    0,
  );
});

test('values in standby, on AUX, on Bluetooth, paused', () => {
  const standby = speakerValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_standby.xml') }),
    'fr',
  );
  assert.equal(standby.power, 0);
  assert.deepEqual(standby.source, { text: 'other' });

  const aux = speakerValues(
    speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_aux.xml') }),
    'en',
  );
  assert.deepEqual(aux.source, { text: 'AUX' });

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
  assert.equal(
    musicValues(
      speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_upnp_paused.xml') }),
      'en',
      0,
    ).playback_state,
    0,
  );
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
  assert.throws(() => commandFor(on, FEATURE_KEYS.POSITION, 30), /no command/);
});

test('the music player commands: playback state, shuffle, repeat', () => {
  const on = speaker();
  assert.deepEqual(commandFor(on, FEATURE_KEYS.PLAYBACK, 1), { key: 'PLAY' });
  assert.deepEqual(commandFor(on, FEATURE_KEYS.PLAYBACK, 0), { key: 'PAUSE' });
  assert.deepEqual(commandFor(on, FEATURE_KEYS.PLAYBACK, 2), { key: 'STOP' });
  assert.throws(() => commandFor(on, FEATURE_KEYS.PLAYBACK, 3), /Invalid playback state/);
  const standby = speaker({ nowPlaying: nowPlaying('ha_device1_now_playing_standby.xml') });
  assert.equal(commandFor(standby, FEATURE_KEYS.PLAYBACK, 2), null);
  assert.equal(commandFor(standby, FEATURE_KEYS.PLAYBACK, 0), null);

  // A radio has neither shuffle nor repeat: refused, nothing sent.
  assert.throws(() => commandFor(on, FEATURE_KEYS.SHUFFLE, 1), /no shuffle/);
  assert.throws(() => commandFor(on, FEATURE_KEYS.REPEAT, 1), /no repeat/);
  const spotify = speaker({ nowPlaying: nowPlaying('lib_spotify.xml') });
  assert.deepEqual(commandFor(spotify, FEATURE_KEYS.SHUFFLE, 1), { key: 'SHUFFLE_ON' });
  assert.equal(commandFor(spotify, FEATURE_KEYS.SHUFFLE, 0), null);
  assert.deepEqual(commandFor(spotify, FEATURE_KEYS.REPEAT, 1), { key: 'REPEAT_ALL' });
  assert.deepEqual(commandFor(spotify, FEATURE_KEYS.REPEAT, 2), { key: 'REPEAT_ONE' });
  assert.equal(commandFor(spotify, FEATURE_KEYS.REPEAT, 0), null);
  assert.throws(() => commandFor(spotify, FEATURE_KEYS.REPEAT, 5), /Invalid repeat/);
});
