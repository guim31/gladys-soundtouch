// -----------------------------------------------------------------------------
// Reading the SoundTouch documents: the recorded answers of the Home Assistant
// and libsoundtouch tests (test/fixtures/soundtouch).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activePreset,
  isOn,
  isPlaying,
  mergeNowPlaying,
  normalizeDeviceId,
  parseInfo,
  parseNowPlaying,
  parsePresets,
  parseSources,
  parseUpdate,
  parseVolume,
  parseZone,
} from '../src/soundtouch/model.js';
import { parseXml, toXml } from '../src/soundtouch/xml.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/soundtouch/${name}`, import.meta.url), 'utf8');

test('the XML reader handles what the speakers send', () => {
  const node = parseXml(
    `<?xml version="1.0" encoding="UTF-8" ?><!-- c --><a x='1' y="&amp;2"><b>Lily &amp; Madeleine</b><c/><d><![CDATA[<raw>]]></d></a>`,
  );
  assert.equal(node.name, 'a');
  assert.deepEqual(node.attributes, { x: '1', y: '&2' });
  assert.equal(node.children[0].text, 'Lily & Madeleine');
  assert.equal(node.children[1].name, 'c');
  assert.equal(node.children[2].text, '<raw>');
  assert.equal(parseXml('<a>&#233;&#xE9;</a>').text, 'éé');
});

test('a truncated or broken answer throws instead of reading as empty', () => {
  assert.throws(() => parseXml('<info deviceID="1"><name>Kitchen</name>'), /not closed/);
  assert.throws(() => parseXml('<a></b>'), /unexpected/);
  assert.throws(() => parseXml(''), /no element/);
  assert.throws(() => parseXml('<html'), /invalid/);
});

test('/info: identity of a SoundTouch 10 (Home Assistant fixture)', () => {
  assert.deepEqual(parseInfo(fixture('ha_device1_info.xml')), {
    id: '020000000001',
    name: 'My SoundTouch 1',
    type: 'SoundTouch 10',
    firmware: '27.0.3.46298.4608935',
    ip: '192.0.2.1',
  });
});

test('/info: libsoundtouch fixtures, with a multi-line version and a UTF-8 name', () => {
  const info = parseInfo(fixture('lib_device_info.xml'));
  assert.equal(info.type, 'SoundTouch 20');
  assert.equal(info.firmware, '13.0.9.29919.1889959');
  assert.equal(info.name, 'Home');
  // No account id, no serial number in what the integration keeps.
  assert.equal(JSON.stringify(info).includes('AccountUUIDValue'), false);
});

test('/info without a device id is refused', () => {
  assert.throws(() => parseInfo('<info><name>x</name></info>'), /device id/);
  assert.throws(() => parseInfo('<nowPlaying source="AUX"/>'), /Expected <info>/);
});

test('device ids are normalized', () => {
  assert.equal(normalizeDeviceId('68:9E:19:8D:DB:3A'), '689e198ddb3a');
  assert.equal(normalizeDeviceId('XXXX'), null);
  assert.equal(normalizeDeviceId(undefined), null);
});

test('/now_playing: radio, Bluetooth, AUX, UPnP, standby, Spotify', () => {
  const radio = parseNowPlaying(fixture('ha_device1_now_playing_radio.xml'));
  assert.equal(radio.source, 'TUNEIN');
  assert.equal(radio.station, 'MockStation');
  assert.equal(radio.content.location, '/v1/playback/station/sXXXXX');
  assert.ok(isOn(radio) && isPlaying(radio));

  const bluetooth = parseNowPlaying(fixture('ha_device1_now_playing_bluetooth.xml'));
  assert.equal(bluetooth.source, 'BLUETOOTH');
  assert.equal(bluetooth.track, 'MockTrack');

  const aux = parseNowPlaying(fixture('ha_device1_now_playing_aux.xml'));
  assert.equal(aux.content.name, 'AUX IN');
  assert.equal(aux.track, null);

  const paused = parseNowPlaying(fixture('ha_device1_now_playing_upnp_paused.xml'));
  assert.ok(isOn(paused) && !isPlaying(paused));
  assert.equal(paused.position, 7);
  assert.equal(paused.duration, 42);

  const standby = parseNowPlaying(fixture('ha_device1_now_playing_standby.xml'));
  assert.equal(standby.source, 'STANDBY');
  assert.ok(!isOn(standby) && !isPlaying(standby));

  const spotify = parseNowPlaying(fixture('lib_spotify.xml'));
  assert.equal(spotify.track, 'Nothing Else Matters (Live)');
  assert.equal(spotify.artist, 'Metallica');
});

test('/volume: level and mute', () => {
  assert.deepEqual(parseVolume(fixture('ha_device1_volume.xml')), { level: 12, muted: false });
  assert.deepEqual(parseVolume(fixture('ha_device1_volume_muted.xml')), {
    level: 12,
    muted: true,
  });
  assert.throws(() => parseVolume('<volume/>'), /without a volume/);
});

test('/presets: the stored presets, with the ContentItem to send back', () => {
  const presets = parsePresets(fixture('ha_device1_presets.xml'));
  assert.deepEqual(
    presets.map(({ id, name, source }) => ({ id, name, source })),
    [
      { id: 1, name: null, source: 'UPNP' },
      { id: 2, name: 'MockStation', source: 'TUNEIN' },
    ],
  );
  // The XML sent to /select is the speaker's own ContentItem, re-read whole.
  const item = parseXml(presets[1].xml);
  assert.equal(item.name, 'ContentItem');
  assert.equal(item.attributes.location, '/v1/playback/station/sXXXXX');
  assert.equal(item.children.find((node) => node.name === 'itemName').text, 'MockStation');
  assert.equal(toXml(parseXml(presets[1].xml)), presets[1].xml);
});

test('/sources: the inputs of the speaker', () => {
  const sources = parseSources(fixture('doc_sources.xml'));
  assert.deepEqual(sources[0], {
    source: 'AUX',
    account: 'AUX',
    status: 'READY',
    local: true,
    label: 'AUX IN',
  });
  assert.ok(sources.some((item) => item.source === 'BLUETOOTH'));
});

test('/getZone: leader, member, no group', () => {
  const leader = parseZone(fixture('ha_device1_getZone_master.xml'));
  assert.equal(leader.master, '020000000001');
  assert.equal(leader.members.length, 3);
  const member = parseZone(fixture('ha_device2_getZone_slave.xml'));
  assert.deepEqual(member, {
    master: '020000000001',
    members: [{ id: '020000000002', ip: '192.0.2.2' }],
  });
  assert.equal(parseZone(fixture('doc_zone_empty.xml')), null);
});

test('WebSocket notifications (libsoundtouch recordings)', () => {
  const volume = parseUpdate(fixture('lib_ws_volume.xml'));
  assert.deepEqual(volume, {
    kind: 'volume',
    deviceId: null,
    payload: { level: 21, muted: false },
  });

  const status = parseUpdate(fixture('lib_ws_status.xml'));
  assert.equal(status.kind, 'nowPlaying');
  assert.equal(status.payload.track, 'Devil We Know');
  assert.equal(status.payload.artist, 'Lily & Madeleine');

  const presets = parseUpdate(fixture('lib_ws_presets.xml'));
  assert.equal(presets.kind, 'presets');
  assert.deepEqual(
    presets.payload.map((preset) => preset.name),
    ['Zedd', 'Afternoon Accoustic', 'Rock Ballads'],
  );

  assert.equal(parseUpdate(fixture('lib_ws_zone.xml')).kind, 'zone');
  assert.equal(parseUpdate(fixture('lib_ws_info.xml')).kind, 'info');
  assert.equal(parseUpdate(fixture('doc_ws_greeting.xml')).kind, 'other');
});

test('a buffering push keeps the track known before', () => {
  const playing = parseNowPlaying(fixture('lib_spotify.xml'));
  const buffering = parseNowPlaying(
    fixture('lib_spotify_buffering.xml').match(/<nowPlaying [\s\S]*<\/nowPlaying>/)[0],
  );
  assert.equal(buffering.content, null);
  const merged = mergeNowPlaying(playing, buffering);
  assert.equal(merged.track, 'Nothing Else Matters (Live)');
  assert.equal(merged.playStatus, 'BUFFERING_STATE');
  assert.ok(isPlaying(merged));
});

test('the active preset is found by source and location', () => {
  const presets = parsePresets(fixture('ha_device1_presets.xml'));
  const radio = parseNowPlaying(fixture('ha_device1_now_playing_radio.xml'));
  assert.equal(activePreset(radio, presets).id, 2);
  const upnp = parseNowPlaying(fixture('ha_device1_now_playing_upnp.xml'));
  assert.equal(activePreset(upnp, presets).id, 1);
  const aux = parseNowPlaying(fixture('ha_device1_now_playing_aux.xml'));
  assert.equal(activePreset(aux, presets), null);
  const standby = parseNowPlaying(fixture('ha_device1_now_playing_standby.xml'));
  assert.equal(activePreset(standby, presets), null);
});
