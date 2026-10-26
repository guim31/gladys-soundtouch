// -----------------------------------------------------------------------------
// The Gladys 5.3 music player, end to end against the SDK's fake Gladys and
// the simulated speakers (recorded answers of Home Assistant and
// libsoundtouch): what publishNowPlaying sends, the player commands, the
// presets as a catalog, and the artwork served to the core.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { validateMediaItems } from '@gladysassistant/integration-sdk';
import { createAll, createWorld, deviceId, featureId, settle } from './helpers/world.js';
import { push, setVolume } from './helpers/fakeSpeaker.js';
import { downloadArtwork, isLanHost } from '../src/music.js';

const statesOf = (gladys, externalId) =>
  gladys.fake.states.filter((state) => state.device_feature_external_id === externalId);

const last = (gladys, externalId) => {
  const states = statesOf(gladys, externalId);
  const state = states[states.length - 1];
  return state?.text ?? state?.state;
};

async function world(options) {
  const created = await createWorld(options);
  await createAll(created);
  const { gladys, network } = created;
  const [kitchen, bedroom, living] = network.speakers;
  const deviceOf = (speaker) =>
    gladys.fake.devices.find((item) => item.external_id === deviceId(gladys, speaker));
  const set = async (speaker, key, value) => {
    const device = deviceOf(speaker);
    const feature = device.features.find(
      (item) => item.external_id === featureId(gladys, speaker, key),
    );
    const ack = await gladys.fake.setValue(device, feature, value);
    await settle(created.hub);
    return ack;
  };
  const value = (speaker, key) => last(gladys, featureId(gladys, speaker, key));
  return { ...created, kitchen, bedroom, living, deviceOf, set, value };
}

const artworkFixture = readFileSync(
  new URL('./fixtures/artwork/baseline-420.jpg', import.meta.url),
);

/** A fetch answering images by URL, recording what was asked. */
function imageFetch(images) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    const entry = images[url];
    if (!entry) {
      return new Response('not found', { status: 404 });
    }
    if (entry.redirect) {
      return new Response(null, { status: 302, headers: { location: entry.redirect } });
    }
    return new Response(entry, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  return { fetch, asked };
}

test('now playing: one publication per speaker, through the 1.0 ids and the new ones', async () => {
  const w = await world();
  try {
    const { gladys, kitchen, bedroom, living, value } = w;
    // Kitchen: a TuneIn preset (HA fixture), no time in the document.
    assert.equal(value(kitchen, 'playback-state'), 1);
    assert.equal(value(kitchen, 'title'), 'MockTrack');
    assert.equal(value(kitchen, 'artist'), 'MockArtist');
    assert.equal(value(kitchen, 'album'), 'MockAlbum');
    assert.equal(
      value(kitchen, 'artwork'),
      gladys.artworkKey('http://cdn-profiles.tunein.com/sXXXXX/images/logoq.png'),
    );
    assert.equal(value(kitchen, 'duration'), 0);
    assert.equal(value(kitchen, 'mute'), 0);
    assert.equal(value(kitchen, 'volume'), 12);
    // No shuffle/repeat on a radio: off.
    assert.equal(value(kitchen, 'shuffle'), 0);
    // Bedroom: standby, cleared explicitly.
    assert.equal(value(bedroom, 'playback-state'), 2);
    assert.equal(value(bedroom, 'title'), '');
    assert.equal(value(bedroom, 'artwork'), '');
    // Living: Spotify (libsoundtouch), muted.
    assert.equal(value(living, 'duration'), 441);
    assert.ok(value(living, 'position') >= 402);
    assert.equal(value(living, 'shuffle'), 0);
    assert.equal(value(living, 'repeat'), 0);
    assert.equal(value(living, 'mute'), 1);
    // Every state targets a feature of the device.
    const ids = new Set(
      gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
    );
    for (const state of gladys.fake.states) {
      assert.ok(ids.has(state.device_feature_external_id), state.device_feature_external_id);
    }
  } finally {
    await w.app.stop();
  }
});

test('a volume push republishes neither the position nor the track', async () => {
  const w = await world();
  try {
    const { gladys, living, value } = w;
    const before = gladys.fake.states.length;
    setVolume(living, { level: 40 });
    await settle(w.hub);
    assert.equal(value(living, 'volume'), 40);
    const sent = gladys.fake.states.slice(before).map((state) => state.device_feature_external_id);
    assert.deepEqual(sent, [featureId(gladys, living, 'volume')]);
    // The next HTTP check reads the same track a few ms later: nothing sent.
    await w.hub.refresh(w.hub.speakers.get(living.id.toLowerCase()));
    assert.equal(gladys.fake.states.length, before + 1);
  } finally {
    await w.app.stop();
  }
});

test('playback state written: play, pause, stop through the remote keys', async () => {
  const w = await world();
  try {
    const { kitchen, bedroom, set, value } = w;
    assert.deepEqual(await set(kitchen, 'playback-state', 0), { success: true });
    assert.equal(value(kitchen, 'playback-state'), 0);
    await set(kitchen, 'playback-state', 2);
    assert.equal(value(kitchen, 'playback-state'), 2);
    await set(kitchen, 'playback-state', 1);
    assert.equal(value(kitchen, 'playback-state'), 1);
    assert.deepEqual(kitchen.keys, ['PAUSE', 'STOP', 'PLAY']);
    // Stopping a speaker in standby sends nothing.
    await set(bedroom, 'playback-state', 2);
    assert.deepEqual(bedroom.keys, []);
    const refused = await set(kitchen, 'playback-state', 3);
    assert.equal(refused.success, false);
  } finally {
    await w.app.stop();
  }
});

test('shuffle and repeat on Spotify; refused on a radio', async () => {
  const w = await world();
  try {
    const { kitchen, living, set, value } = w;
    await set(living, 'shuffle', 1);
    assert.equal(value(living, 'shuffle'), 1);
    await set(living, 'repeat', 2);
    assert.equal(value(living, 'repeat'), 2);
    await set(living, 'repeat', 1);
    assert.equal(value(living, 'repeat'), 1);
    assert.deepEqual(living.keys, ['SHUFFLE_ON', 'REPEAT_ONE', 'REPEAT_ALL']);
    const refused = await set(kitchen, 'shuffle', 1);
    assert.equal(refused.success, false);
    assert.match(refused.error, /no shuffle/);
    assert.deepEqual(kitchen.keys, []);
  } finally {
    await w.app.stop();
  }
});

test('mute is a toggle: decided on /volume read just before, not on a stale state', async () => {
  const w = await world();
  try {
    const { kitchen, set, value } = w;
    // Muted from the remote, the push lost: the integration still thinks unmuted.
    setVolume(kitchen, { muted: true }, { notify: false });
    await set(kitchen, 'mute', 1);
    assert.deepEqual(kitchen.keys, [], 'already muted: MUTE not sent');
    assert.equal(value(kitchen, 'mute'), 1);
    await set(kitchen, 'mute', 0);
    assert.deepEqual(kitchen.keys, ['MUTE']);
    assert.equal(value(kitchen, 'mute'), 0);
  } finally {
    await w.app.stop();
  }
});

test('the presets as a catalog: listed at the root, played by id', async () => {
  const w = await world({ config: { language: 'en' } });
  try {
    const { gladys, kitchen, deviceOf } = w;
    const ack = await gladys.fake.musicBrowse(deviceOf(kitchen), { parentId: null });
    assert.equal(ack.success, true);
    const { items, total } = ack.data;
    assert.deepEqual(validateMediaItems(items), []);
    assert.equal(total, 2);
    assert.deepEqual(
      items.map((item) => [item.id, item.type, item.title, Boolean(item.artwork_key)]),
      [
        ['preset:1', 'playlist', 'Preset 1', false],
        ['preset:2', 'radio', 'Preset 2 · MockStation', true],
      ],
    );
    // Nothing below a preset.
    const below = await gladys.fake.musicBrowse(deviceOf(kitchen), { parentId: 'preset:1' });
    assert.deepEqual(below.data, { items: [], total: 0 });

    const played = await gladys.fake.musicPlay(deviceOf(kitchen), { id: 'preset:1' });
    assert.equal(played.success, true);
    await settle(w.hub);
    assert.match(
      kitchen.selected.at(-1),
      /location="http:\/\/192\.0\.2\.50:8000\/music\/test\.mp3"/,
    );
    assert.deepEqual(kitchen.keys, [], 'never a PRESET_n key (a long press stores)');
    const unknown = await gladys.fake.musicPlay(deviceOf(kitchen), { id: 'spotify:x' });
    assert.equal(unknown.success, false);
    const empty = await gladys.fake.musicPlay(deviceOf(kitchen), { id: 'preset:5' });
    assert.equal(empty.success, false);
  } finally {
    await w.app.stop();
  }
});

test('artwork: served as is when small, made small when large, refused when odd', async () => {
  // A 1200 px noisy JPEG well over 300 KB, like a cover read from a media server.
  const width = 1200;
  const pixels = Buffer.alloc(width * width * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = (i * 2654435761) >>> 24;
  }
  const large = jpeg.encode({ data: pixels, width, height: width }, 95).data;
  assert.ok(large.length > 300 * 1024);
  const urls = {
    small: 'http://cdn-profiles.tunein.com/sXXXXX/images/logoq.png',
    large: 'http://192.0.2.50:8200/AlbumArt/77-1.jpg',
    trap: 'http://i.scdn.co/image/redirect',
  };
  const { fetch, asked } = imageFetch({
    [urls.small]: artworkFixture,
    [urls.large]: large,
    [urls.trap]: { redirect: 'http://192.168.1.1/admin.jpg' },
  });
  const w = await world({ artworkFetch: fetch });
  try {
    const { gladys } = w;
    const small = await gladys.fake.musicGetArtwork(gladys.artworkKey(urls.small));
    assert.equal(small.success, true);
    assert.equal(Buffer.from(small.data.image, 'base64').compare(artworkFixture), 0);

    const resized = await gladys.fake.musicGetArtwork(gladys.artworkKey(urls.large));
    assert.equal(resized.success, true);
    assert.ok(Buffer.from(resized.data.image, 'base64').length <= 300 * 1024);

    const trap = await gladys.fake.musicGetArtwork(gladys.artworkKey(urls.trap));
    assert.equal(trap.success, false);
    assert.ok(!asked.includes('http://192.168.1.1/admin.jpg'));

    const unknown = await gladys.fake.musicGetArtwork('art-000000000000');
    assert.equal(unknown.success, false);
  } finally {
    await w.app.stop();
  }
});

test('downloadArtwork refuses the container itself and other schemes', async () => {
  await assert.rejects(
    downloadArtwork('http://127.0.0.1:8080/x.jpg', { fetch: () => {} }),
    /local/,
  );
  await assert.rejects(downloadArtwork('file:///etc/passwd', { fetch: () => {} }), /http/);
});

test('a pushed track change is one batch, with the position of the push', async () => {
  const w = await world();
  try {
    const { gladys, living, value } = w;
    const before = gladys.fake.states.length;
    push(
      living,
      readFileSync(new URL('./fixtures/soundtouch/lib_ws_status.xml', import.meta.url), 'utf8')
        // The recorded push without its <updates> envelope (push adds it).
        .match(/<nowPlayingUpdated>[\s\S]*<\/nowPlayingUpdated>/)[0]
        .replaceAll('XXXX', living.id),
    );
    await settle(w.hub);
    assert.equal(value(living, 'title'), 'Devil We Know');
    assert.equal(value(living, 'artist'), 'Lily & Madeleine');
    assert.equal(value(living, 'duration'), 201);
    assert.equal(value(living, 'position'), 30);
    assert.equal(value(living, 'shuffle'), 1);
    assert.equal(
      value(living, 'artwork'),
      gladys.artworkKey('http://i.scdn.co/image/9778636ff8df7a3bee6941df472ef269d6d7fe88'),
    );
    assert.ok(gladys.fake.states.length - before <= 8);
  } finally {
    await w.app.stop();
  }
});

test('isLanHost: private addresses in every spelling, local names', () => {
  for (const host of [
    '192.168.1.20',
    '[::ffff:192.168.1.20]',
    new URL('http://[::ffff:192.168.1.20]/').hostname,
    '100.100.1.2',
    '[fd00::1]',
    'nas',
    'router.lan',
    'box.home.arpa',
    'speaker.local',
  ]) {
    assert.equal(isLanHost(host), true, host);
  }
  for (const host of ['i.scdn.co', '8.8.8.8', '100.128.0.1', '[2001:db8::1]', '[::ffff:8.8.8.8]']) {
    assert.equal(isLanHost(host), false, host);
  }
});

test('downloadArtwork: an Internet cover redirected to a mapped LAN address is refused', async () => {
  const fetch = async () => ({
    status: 302,
    headers: { get: () => 'http://[::ffff:192.168.1.20]/cover.jpg' },
  });
  await assert.rejects(downloadArtwork('https://i.scdn.co/image/x', { fetch }), /local network/);
});
