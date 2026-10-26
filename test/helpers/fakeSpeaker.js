// -----------------------------------------------------------------------------
// Simulated SoundTouch speakers on an in-memory network: the web API (port
// 8090), the notification WebSocket (port 8080) and the UPnP renderer (port
// 8091), behind a `fetch` and a `createSocket` the integration takes as test
// seams. The speakers answer with the recorded fixtures
// (test/fixtures/soundtouch), change state on the commands like the real
// ones (POWER and MUTE toggle, /select switches, /volume sets) and push the
// change to the open WebSockets. No real network is touched.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/soundtouch/${name}`, import.meta.url), 'utf8');

export const FIXTURES = {
  // SoundTouch 10, playing a TuneIn station stored as preset 2.
  kitchen: {
    host: '192.0.2.1',
    info: 'ha_device1_info.xml',
    nowPlaying: 'ha_device1_now_playing_radio.xml',
    volume: 'ha_device1_volume.xml',
    presets: 'ha_device1_presets.xml',
    zone: 'ha_device1_getZone_master.xml',
    sources: 'doc_sources.xml',
  },
  // SoundTouch 10 in standby, member of the kitchen's group.
  bedroom: {
    host: '192.0.2.2',
    info: 'ha_device2_info.xml',
    nowPlaying: 'ha_device2_now_playing_standby.xml',
    volume: 'ha_device2_volume.xml',
    presets: 'lib_ws_presets.xml',
    zone: 'ha_device2_getZone_slave.xml',
    sources: 'doc_sources_no_aux.xml',
  },
  // SoundTouch 20 (libsoundtouch), playing Spotify, an older firmware
  // without /sources.
  living: {
    host: '192.0.2.20',
    info: 'lib_device_info.xml',
    nowPlaying: 'lib_spotify.xml',
    volume: 'ha_device1_volume_muted.xml',
    presets: 'lib_ws_presets.xml',
    zone: 'doc_zone_empty.xml',
    sources: null,
  },
};

const NOW_PLAYING_BY_SOURCE = {
  AUX: fixture('ha_device1_now_playing_aux.xml'),
  BLUETOOTH: fixture('ha_device1_now_playing_bluetooth.xml'),
};

const stripDeclaration = (xml) => xml.replace(/<\?xml[^>]*\?>\s*/, '').trim();

/** The <presets> body of a presetsUpdated push (libsoundtouch's ws_presets.xml). */
function presetsDocument(name) {
  const xml = fixture(name);
  const match = xml.match(/<presets>[\s\S]*<\/presets>/);
  return match ? match[0] : xml;
}

/**
 * @param {object} spec one entry of FIXTURES, or a variant of one
 */
export function createSpeaker(spec) {
  const infoXml = fixture(spec.info);
  const id = infoXml.match(/deviceID="([^"]+)"/)[1];
  const volumeXml = fixture(spec.volume);
  const speaker = {
    id,
    host: spec.host,
    infoXml,
    nowPlayingXml: fixture(spec.nowPlaying),
    lastPlayingXml: null,
    volume: {
      level: Number(volumeXml.match(/<actualvolume>(\d+)/)[1]),
      muted: /<muteenabled>true/.test(volumeXml),
    },
    presetsXml: presetsDocument(spec.presets),
    zoneXml: fixture(spec.zone),
    sourcesXml: spec.sources ? fixture(spec.sources) : null,
    /** Off the network: requests fail, sockets do not open. */
    offline: false,
    /** WebSocket refused (an old firmware, a firewall). */
    noWebSocket: false,
    requests: [],
    keys: [],
    selected: [],
    playedUrls: [],
    sockets: new Set(),
  };
  if (!/source="STANDBY"/.test(speaker.nowPlayingXml)) {
    speaker.lastPlayingXml = speaker.nowPlayingXml;
  }
  return speaker;
}

function volumeXml(speaker) {
  const { level, muted } = speaker.volume;
  return (
    `<volume deviceID="${speaker.id}"><targetvolume>${level}</targetvolume>` +
    `<actualvolume>${level}</actualvolume><muteenabled>${muted}</muteenabled></volume>`
  );
}

const standbyXml = (speaker) =>
  `<nowPlaying deviceID="${speaker.id}" source="STANDBY"><ContentItem source="STANDBY" isPresetable="false" /></nowPlaying>`;

function withDeviceId(xml, speaker) {
  return xml.replace(/deviceID="[^"]*"/, `deviceID="${speaker.id}"`);
}

/** Push one <updates> document to the open WebSockets of the speaker. */
export function push(speaker, inner) {
  const message = `<updates deviceID="${speaker.id}">${inner}</updates>`;
  for (const socket of speaker.sockets) {
    socket.deliver(message);
  }
}

export const pushNowPlaying = (speaker) =>
  push(
    speaker,
    `<nowPlayingUpdated>${stripDeclaration(speaker.nowPlayingXml)}</nowPlayingUpdated>`,
  );

export const pushVolume = (speaker) =>
  push(
    speaker,
    `<volumeUpdated>${volumeXml(speaker).replace(/ deviceID="[^"]*"/, '')}</volumeUpdated>`,
  );

/** Change what the speaker plays, as its own buttons or the Bose app would. */
export function setNowPlaying(speaker, xml, { notify = true } = {}) {
  speaker.nowPlayingXml = withDeviceId(xml, speaker);
  if (!/source="STANDBY"/.test(xml)) {
    speaker.lastPlayingXml = speaker.nowPlayingXml;
  }
  if (notify) {
    pushNowPlaying(speaker);
  }
}

export function setVolume(speaker, volume, { notify = true } = {}) {
  speaker.volume = { ...speaker.volume, ...volume };
  if (notify) {
    pushVolume(speaker);
  }
}

function playPreset(speaker, contentItem) {
  const nameMatch = contentItem.match(/<itemName>([^<]*)<\/itemName>/);
  const name = nameMatch ? nameMatch[1] : '';
  const source = contentItem.match(/source="([^"]+)"/)[1];
  setNowPlaying(
    speaker,
    `<nowPlaying deviceID="${speaker.id}" source="${source}">${contentItem}` +
      `<track></track><artist></artist><stationName>${name}</stationName>` +
      '<playStatus>PLAY_STATE</playStatus></nowPlaying>',
  );
}

function handleKey(speaker, key) {
  speaker.keys.push(key);
  const standby = /source="STANDBY"/.test(speaker.nowPlayingXml);
  switch (key) {
    case 'POWER':
      setNowPlaying(
        speaker,
        standby ? (speaker.lastPlayingXml ?? NOW_PLAYING_BY_SOURCE.AUX) : standbyXml(speaker),
      );
      break;
    case 'MUTE':
      setVolume(speaker, { muted: !speaker.volume.muted });
      break;
    case 'PLAY':
    case 'PAUSE':
    case 'PLAY_PAUSE': {
      if (standby) {
        break;
      }
      const playing = /PLAY_STATE/.test(speaker.nowPlayingXml);
      const next = key === 'PLAY' || (key === 'PLAY_PAUSE' && !playing);
      setNowPlaying(
        speaker,
        speaker.nowPlayingXml.replace(
          /<playStatus>[^<]*<\/playStatus>/,
          `<playStatus>${next ? 'PLAY_STATE' : 'PAUSE_STATE'}</playStatus>`,
        ),
      );
      break;
    }
    case 'STOP':
      if (!standby) {
        setNowPlaying(
          speaker,
          speaker.nowPlayingXml.replace(
            /<playStatus>[^<]*<\/playStatus>/,
            '<playStatus>STOP_STATE</playStatus>',
          ),
        );
      }
      break;
    case 'SHUFFLE_ON':
    case 'SHUFFLE_OFF':
      // Only a source with the mode changes it (Spotify, stored music).
      setNowPlaying(
        speaker,
        speaker.nowPlayingXml.replace(
          /<shuffleSetting>[^<]*<\/shuffleSetting>/,
          `<shuffleSetting>${key}</shuffleSetting>`,
        ),
      );
      break;
    case 'REPEAT_OFF':
    case 'REPEAT_ALL':
    case 'REPEAT_ONE':
      setNowPlaying(
        speaker,
        speaker.nowPlayingXml.replace(
          /<repeatSetting>[^<]*<\/repeatSetting>/,
          `<repeatSetting>${key}</repeatSetting>`,
        ),
      );
      break;
    default:
      break;
  }
}

function respond(status, text) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** The HTTP side of one speaker. */
function answer(speaker, port, method, path, body) {
  speaker.requests.push({ port, method, path, body });
  if (port === 8091) {
    const url = body?.match(/<CurrentURI>([^<]*)<\/CurrentURI>/)?.[1]?.replace(/&amp;/g, '&');
    speaker.playedUrls.push(url);
    setNowPlaying(
      speaker,
      `<nowPlaying deviceID="${speaker.id}" source="UPNP" sourceAccount="UPnPUserName">` +
        `<ContentItem source="UPNP" location="${url}" sourceAccount="UPnPUserName" isPresetable="true" />` +
        '<track>Stream</track><playStatus>PLAY_STATE</playStatus></nowPlaying>',
    );
    return respond(200, '<?xml version="1.0"?><s:Envelope></s:Envelope>');
  }
  if (port !== 8090) {
    throw new TypeError('fetch failed');
  }
  if (method === 'GET') {
    switch (path) {
      case '/info':
        return respond(200, speaker.infoXml);
      case '/now_playing':
        return respond(200, speaker.nowPlayingXml);
      case '/volume':
        return respond(200, volumeXml(speaker));
      case '/presets':
        return respond(200, speaker.presetsXml);
      case '/getZone':
        return respond(200, speaker.zoneXml);
      case '/sources':
        return speaker.sourcesXml
          ? respond(200, speaker.sourcesXml)
          : respond(404, '<html>Not Found</html>');
      default:
        return respond(404, '<html>Not Found</html>');
    }
  }
  switch (path) {
    case '/key': {
      const state = body.match(/state="([^"]+)"/)[1];
      const key = body.match(/>([A-Z_0-9]+)</)[1];
      if (state === 'release') {
        handleKey(speaker, key);
      }
      return respond(200, '<?xml version="1.0" encoding="UTF-8" ?><status>/key</status>');
    }
    case '/volume': {
      const level = Number(body.match(/<volume>(\d+)<\/volume>/)?.[1]);
      if (!Number.isFinite(level)) {
        return respond(200, fixture('doc_errors.xml'));
      }
      setVolume(speaker, { level, muted: false });
      return respond(200, '<?xml version="1.0" encoding="UTF-8" ?><status>/volume</status>');
    }
    case '/select': {
      speaker.selected.push(body);
      const source = body.match(/source="([^"]+)"/)?.[1];
      if (NOW_PLAYING_BY_SOURCE[source]) {
        setNowPlaying(speaker, NOW_PLAYING_BY_SOURCE[source]);
      } else {
        playPreset(speaker, body);
      }
      return respond(200, '<?xml version="1.0" encoding="UTF-8" ?><status>/select</status>');
    }
    default:
      return respond(404, '<html>Not Found</html>');
  }
}

class FakeSocket extends EventTarget {
  constructor(speaker, protocols) {
    super();
    this.speaker = speaker;
    this.protocols = protocols;
    this.readyState = 0;
    setImmediate(() => {
      if (!speaker || speaker.offline || speaker.noWebSocket) {
        this.dispatchEvent(new Event('error'));
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
        return;
      }
      this.readyState = 1;
      speaker.sockets.add(this);
      this.dispatchEvent(new Event('open'));
      this.deliver(fixture('doc_ws_greeting.xml'));
    });
  }

  deliver(data) {
    if (this.readyState !== 1) {
      return;
    }
    const event = new Event('message');
    event.data = data;
    this.dispatchEvent(event);
  }

  send() {}

  close() {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.speaker?.sockets.delete(this);
  }

  /** The speaker drops the connection (power cut, reboot). */
  drop() {
    this.close();
    this.dispatchEvent(new Event('close'));
  }
}

/**
 * An in-memory network of speakers.
 * @param {object[]} speakers from createSpeaker
 */
export function createNetwork(speakers) {
  const byHost = new Map(speakers.map((speaker) => [speaker.host, speaker]));
  const network = {
    speakers,
    byHost,
    sockets: [],
    async fetch(url, init = {}) {
      const { hostname, port, pathname } = new URL(url);
      const speaker = byHost.get(hostname);
      await new Promise((resolve) => setImmediate(resolve));
      if (!speaker || speaker.offline) {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'EHOSTUNREACH' };
        throw error;
      }
      return answer(speaker, Number(port), init.method ?? 'GET', pathname, init.body);
    },
    createSocket(url, protocols) {
      const { hostname, port } = new URL(url);
      const speaker = Number(port) === 8080 ? byHost.get(hostname) : null;
      const socket = new FakeSocket(speaker, protocols);
      network.sockets.push(socket);
      return socket;
    },
    /** What the Gladys core relays for an mDNS scan of `_soundtouch._tcp`. */
    mdnsResults() {
      return speakers.map((speaker) => ({
        name: `${speaker.id}._soundtouch._tcp.local`,
        host: `soundtouch-${speaker.id}.local`,
        addresses: [speaker.host, 'fe80::1'],
        port: 8090,
        txt: [
          'DESCRIPTION=SoundTouch',
          `MAC=${speaker.id}`,
          'MANUFACTURER=Bose Corporation',
          'MODEL=SoundTouch',
        ],
      }));
    },
  };
  return network;
}

/** Wait until the hub has nothing left to do. */
export async function settle(hub) {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await hub.idle();
  }
}
