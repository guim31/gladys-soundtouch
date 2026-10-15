// -----------------------------------------------------------------------------
// The HTTP client: what it sends to the speaker, and how it fails.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, SoundTouchClient } from '../src/soundtouch/client.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/soundtouch/${name}`, import.meta.url), 'utf8');

/** A fetch that records the requests and answers `reply(url, init)`. */
function recorder(reply = () => '<?xml version="1.0" ?><status>ok</status>') {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body, headers: init.headers });
    const answer = reply(url, init);
    if (answer instanceof Error) {
      throw answer;
    }
    const { status = 200, text = answer } = typeof answer === 'object' ? answer : {};
    return { ok: status < 300, status, text: async () => text };
  };
  return { calls, fetch };
}

test('a key is a press then a release, sent by "Gabbo"', async () => {
  const { calls, fetch } = recorder();
  await new SoundTouchClient('192.0.2.10', { fetch }).sendKey(KEYS.NEXT);
  assert.deepEqual(
    calls.map(({ url, method, body }) => [method, url, body]),
    [
      ['POST', 'http://192.0.2.10:8090/key', '<key state="press" sender="Gabbo">NEXT_TRACK</key>'],
      [
        'POST',
        'http://192.0.2.10:8090/key',
        '<key state="release" sender="Gabbo">NEXT_TRACK</key>',
      ],
    ],
  );
});

test('only the known keys are sent: no PRESET key (holding it stores a preset)', async () => {
  const { calls, fetch } = recorder();
  await assert.rejects(new SoundTouchClient('192.0.2.10', { fetch }).sendKey('PRESET_1'));
  assert.equal(calls.length, 0);
});

test('volume is clamped and rounded', async () => {
  const { calls, fetch } = recorder();
  const client = new SoundTouchClient('192.0.2.10', { fetch });
  await client.setVolume(42.6);
  await client.setVolume(150);
  await assert.rejects(client.setVolume('loud'));
  assert.deepEqual(
    calls.map((call) => call.body),
    ['<volume>43</volume>', '<volume>100</volume>'],
  );
});

test('inputs and presets are selected with a ContentItem', async () => {
  const { calls, fetch } = recorder();
  const client = new SoundTouchClient('192.0.2.10', { fetch });
  await client.selectSource('AUX', 'AUX3');
  await client.selectSource('BLUETOOTH', '');
  await client.selectPreset({ xml: '<ContentItem source="TUNEIN" location="/x"></ContentItem>' });
  assert.deepEqual(
    calls.map((call) => [call.url, call.body]),
    [
      [
        'http://192.0.2.10:8090/select',
        '<ContentItem source="AUX" sourceAccount="AUX3"></ContentItem>',
      ],
      ['http://192.0.2.10:8090/select', '<ContentItem source="BLUETOOTH"></ContentItem>'],
      [
        'http://192.0.2.10:8090/select',
        '<ContentItem source="TUNEIN" location="/x"></ContentItem>',
      ],
    ],
  );
});

test('an address is played through the UPnP renderer, escaped', async () => {
  const { calls, fetch } = recorder();
  await new SoundTouchClient('192.0.2.10', { fetch }).playUrl('http://192.0.2.5/a.mp3?x=1&y=2');
  const [call] = calls;
  assert.equal(call.url, 'http://192.0.2.10:8091/AVTransport/Control');
  assert.match(call.body, /<CurrentURI>http:\/\/192\.0\.2\.5\/a\.mp3\?x=1&amp;y=2<\/CurrentURI>/);
  assert.equal(
    call.headers.SOAPACTION,
    '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"',
  );
});

test('an <errors> answer is a failure, not an unreachable speaker', async () => {
  const { fetch } = recorder(() => fixture('doc_errors.xml'));
  const error = await new SoundTouchClient('192.0.2.10', { fetch })
    .setVolume(10)
    .catch((err) => err);
  assert.match(error.message, /CLIENT_XML_ERROR/);
  assert.equal(error.unreachable, false);
});

test('a network failure or a timeout marks the speaker unreachable', async () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const { fetch } = recorder(() => refused);
  const error = await new SoundTouchClient('192.0.2.10', { fetch }).getInfo().catch((err) => err);
  assert.equal(error.unreachable, true);
  assert.match(error.message, /ECONNREFUSED/);

  const slow = new SoundTouchClient('192.0.2.10', {
    timeoutMs: 20,
    fetch: (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  });
  // AbortSignal.timeout does not keep the event loop alive on its own.
  const keepAlive = setTimeout(() => {}, 1_000);
  const timeout = await slow.getVolume().catch((err) => err);
  clearTimeout(keepAlive);
  assert.equal(timeout.unreachable, true);
  assert.match(timeout.message, /no answer/);
});

test('an HTTP error keeps its status', async () => {
  const { fetch } = recorder(() => ({ status: 404, text: 'Not Found' }));
  const error = await new SoundTouchClient('192.0.2.10', { fetch }).getSources().catch((e) => e);
  assert.equal(error.status, 404);
  assert.equal(error.unreachable, false);
});

test('a snapshot reads everything, without /sources on an older firmware', async () => {
  const answers = {
    '/info': fixture('ha_device1_info.xml'),
    '/now_playing': fixture('ha_device1_now_playing_aux.xml'),
    '/volume': fixture('ha_device1_volume.xml'),
    '/presets': fixture('ha_device1_presets.xml'),
    '/getZone': fixture('doc_zone_empty.xml'),
  };
  const { fetch } = recorder((url) => answers[new URL(url).pathname] ?? { status: 404, text: '' });
  const snapshot = await new SoundTouchClient('192.0.2.10', { fetch }).getSnapshot();
  assert.equal(snapshot.info.id, '020000000001');
  assert.equal(snapshot.nowPlaying.source, 'AUX');
  assert.equal(snapshot.presets.length, 2);
  assert.equal(snapshot.zone, null);
  assert.equal(snapshot.sources, null);
});
