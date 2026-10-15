// -----------------------------------------------------------------------------
// The SoundTouch documents, read into plain objects.
//
// Endpoints of the speaker's web API (port 8090): /info, /now_playing,
// /volume, /presets, /sources, /getZone. The WebSocket (port 8080) pushes the
// same documents wrapped in <updates>. Field names and behaviours follow the
// Bose SoundTouch Web API documentation and libsoundtouch (Apache-2.0), whose
// recorded answers are the fixtures of the tests.
// -----------------------------------------------------------------------------

import { child, childText, children, parseXml, toXml } from './xml.js';

export const STANDBY = 'STANDBY';
// Play states the speaker reports while sound comes out (or is about to).
const PLAYING_STATES = new Set(['PLAY_STATE', 'BUFFERING_STATE']);
export const PRESET_COUNT = 6;

/** A device id is the MAC address of the speaker's main module (12 hex digits). */
export function normalizeDeviceId(raw) {
  const id =
    typeof raw === 'string'
      ? raw
          .trim()
          .toLowerCase()
          .replace(/[^0-9a-f]/g, '')
      : '';
  return /^[0-9a-f]{8,16}$/.test(id) ? id : null;
}

/** Accepts a document or an already parsed element named `name`. */
function element(source, name) {
  const node = typeof source === 'string' ? parseXml(source) : source;
  if (node?.name !== name) {
    throw new Error(`Expected <${name}>, got <${node?.name}>`);
  }
  return node;
}

/** GET /info: identity of the speaker. */
export function parseInfo(source) {
  const node = element(source, 'info');
  const id = normalizeDeviceId(node.attributes.deviceID);
  if (!id) {
    throw new Error('The speaker answered without a device id');
  }
  const components = children(child(node, 'components'), 'component');
  const scm = components.find((item) => childText(item, 'componentCategory') === 'SCM');
  const networks = children(node, 'networkInfo');
  const network = networks.find((item) => item.attributes.type === 'SMSC') ?? networks[0];
  return {
    id,
    name: childText(node, 'name') ?? id,
    type: childText(node, 'type') ?? 'SoundTouch',
    firmware: childText(scm, 'softwareVersion')?.split(/\s+/)[0] ?? null,
    ip: childText(network, 'ipAddress'),
  };
}

/** A <ContentItem>: what is (or would be) playing. */
export function parseContentItem(node) {
  if (!node) {
    return null;
  }
  return {
    source: node.attributes.source ?? null,
    account: node.attributes.sourceAccount ?? '',
    location: node.attributes.location ?? '',
    type: node.attributes.type ?? '',
    name: childText(node, 'itemName'),
    presetable: node.attributes.isPresetable === 'true',
  };
}

/**
 * GET /now_playing, or the <nowPlaying> of a nowPlayingUpdated push.
 * A push may be partial (a buffering state carries no ContentItem).
 */
export function parseNowPlaying(source) {
  const node = element(source, 'nowPlaying');
  const time = child(node, 'time');
  const position = Number.parseInt(time?.text ?? '', 10);
  const duration = Number.parseInt(time?.attributes.total ?? '', 10);
  return {
    source: node.attributes.source ?? null,
    content: parseContentItem(child(node, 'ContentItem')),
    track: childText(node, 'track'),
    artist: childText(node, 'artist'),
    album: childText(node, 'album'),
    station: childText(node, 'stationName'),
    playStatus: childText(node, 'playStatus'),
    position: Number.isFinite(position) ? position : null,
    duration: Number.isFinite(duration) ? duration : null,
  };
}

/** GET /volume, or the <volume> of a volumeUpdated push. */
export function parseVolume(source) {
  const node = element(source, 'volume');
  const actual = Number.parseInt(childText(node, 'actualvolume') ?? '', 10);
  const target = Number.parseInt(childText(node, 'targetvolume') ?? '', 10);
  const level = Number.isFinite(actual) ? actual : target;
  if (!Number.isFinite(level)) {
    throw new Error('The speaker answered without a volume');
  }
  return {
    level: Math.min(100, Math.max(0, level)),
    muted: childText(node, 'muteenabled') === 'true',
  };
}

/**
 * GET /presets, or the <presets> of a presetsUpdated push: the stored
 * presets (1 to 6), each with its ContentItem kept as XML, which is what
 * /select takes back to play it.
 */
export function parsePresets(source) {
  const node = element(source, 'presets');
  const presets = [];
  for (const preset of children(node, 'preset')) {
    const id = Number.parseInt(preset.attributes.id, 10);
    const item = child(preset, 'ContentItem');
    if (!Number.isInteger(id) || id < 1 || id > PRESET_COUNT || !item) {
      continue;
    }
    const content = parseContentItem(item);
    presets.push({
      id,
      name: content.name,
      source: content.source,
      location: content.location,
      xml: toXml(item),
    });
  }
  return presets.sort((a, b) => a.id - b.id);
}

/**
 * GET /sources: the inputs and services of the speaker. The account of a
 * streaming service is a user name: only the AUX one (`AUX`, `AUX3`…) is kept.
 */
export function parseSources(source) {
  const node = element(source, 'sources');
  return children(node, 'sourceItem').map((item) => {
    const aux = item.attributes.source === 'AUX';
    return {
      source: item.attributes.source ?? '',
      account: aux ? (item.attributes.sourceAccount ?? '') : '',
      status: item.attributes.status ?? '',
      local: item.attributes.isLocal === 'true',
      label: aux ? item.text.trim() || null : null,
    };
  });
}

/**
 * GET /getZone: the multi-room group. A speaker outside any group answers an
 * empty <zone/>; the leader lists every member (itself included), a member
 * only itself.
 */
export function parseZone(source) {
  const node = element(source, 'zone');
  const master = normalizeDeviceId(node.attributes.master);
  const members = children(node, 'member')
    .map((member) => ({
      id: normalizeDeviceId(member.text),
      ip: member.attributes.ipaddress ?? null,
    }))
    .filter((member) => member.id);
  if (!master || members.length === 0) {
    return null;
  }
  return { master, members };
}

/**
 * One WebSocket message: `{ kind, deviceId, payload }`. Kinds the hub acts on:
 * volume, nowPlaying, presets (payload parsed), zone, info, sources (payload
 * null: read again over HTTP). Anything else (the SDK greeting, user
 * activity, recents) is `{ kind: 'other' }`.
 */
export function parseUpdate(raw) {
  const node = parseXml(raw);
  if (node.name !== 'updates') {
    return { kind: 'other', deviceId: null, payload: null };
  }
  const deviceId = normalizeDeviceId(node.attributes.deviceID);
  const update = node.children[0];
  switch (update?.name) {
    case 'volumeUpdated': {
      const volume = child(update, 'volume');
      return { kind: 'volume', deviceId, payload: volume ? parseVolume(volume) : null };
    }
    case 'nowPlayingUpdated': {
      const nowPlaying = child(update, 'nowPlaying');
      return {
        kind: 'nowPlaying',
        deviceId,
        payload: nowPlaying ? parseNowPlaying(nowPlaying) : null,
      };
    }
    case 'presetsUpdated': {
      const presets = child(update, 'presets');
      return { kind: 'presets', deviceId, payload: presets ? parsePresets(presets) : null };
    }
    case 'zoneUpdated':
      return { kind: 'zone', deviceId, payload: null };
    case 'infoUpdated':
    case 'nameUpdated':
      return { kind: 'info', deviceId, payload: null };
    case 'sourcesUpdated':
      return { kind: 'sources', deviceId, payload: null };
    default:
      return { kind: 'other', deviceId, payload: null };
  }
}

/**
 * Merge a pushed now-playing into the known one: a buffering push only
 * carries the play status, the track arrives with the next push.
 */
export function mergeNowPlaying(previous, next) {
  if (!previous || next.content || next.source !== previous.source) {
    return next;
  }
  return { ...previous, playStatus: next.playStatus ?? previous.playStatus };
}

export const isOn = (nowPlaying) => Boolean(nowPlaying?.source) && nowPlaying.source !== STANDBY;

export const isPlaying = (nowPlaying) =>
  isOn(nowPlaying) && PLAYING_STATES.has(nowPlaying.playStatus);

/** The preset the speaker is playing (same source and location), or null. */
export function activePreset(nowPlaying, presets) {
  const content = nowPlaying?.content;
  if (!isOn(nowPlaying) || !content?.source || !content.location) {
    return null;
  }
  return (
    (presets ?? []).find(
      (preset) =>
        // The account is left out: some firmwares drop it from one side.
        preset.source === content.source && preset.location === content.location,
    ) ?? null
  );
}

/** XML body of POST /select for an input (AUX, BLUETOOTH). */
export function contentItemXml(source, account) {
  const sourceAccount = account ? ` sourceAccount="${account.replace(/[^\w.-]/g, '')}"` : '';
  return `<ContentItem source="${source.replace(/[^A-Z_]/g, '')}"${sourceAccount}></ContentItem>`;
}
