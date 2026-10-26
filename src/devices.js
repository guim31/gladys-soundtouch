// -----------------------------------------------------------------------------
// From a SoundTouch speaker to a Gladys device, and back: the discovery
// payload, the state values, and what each command does on the speaker.
//
// One device per speaker, a music player in the Gladys sense: the `music/*`
// features drive the core's Music dashboard box (Gladys 5.3: what plays, its
// artwork and progress, play / pause / stop, previous, next, shuffle, repeat,
// mute, volume), and the rest (power, source, multi-room group) shows in the
// device box. The music features are published with publishNowPlaying.
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  MUSIC_PLAYBACK_STATE as PLAYBACK,
  MUSIC_REPEAT_MODE as REPEAT,
} from '@gladysassistant/integration-sdk';
import { KEYS } from './soundtouch/client.js';
import { activePreset, isOn } from './soundtouch/model.js';

export const DEVICE_TYPE = 'speaker';

export const FEATURE_KEYS = {
  POWER: 'power',
  VOLUME: 'volume',
  MUTE: 'mute',
  PLAY: 'play',
  PAUSE: 'pause',
  PREVIOUS: 'previous',
  NEXT: 'next',
  PLAYBACK: 'playback-state',
  SOURCE: 'source',
  TITLE: 'title',
  ARTIST: 'artist',
  ZONE: 'zone',
  // Gladys 5.3 music player.
  ALBUM: 'album',
  ARTWORK: 'artwork',
  DURATION: 'duration',
  POSITION: 'position',
  SHUFFLE: 'shuffle',
  REPEAT: 'repeat',
};

/**
 * Music type → feature key, for publishNowPlaying (`featureExternalIds`): the
 * 1.0 keys are kept (`playback-state`, `mute`, `title`…), external ids are
 * forever.
 */
export const MUSIC_KEYS = {
  [TYPES.MUSIC.PLAYBACK_STATE]: FEATURE_KEYS.PLAYBACK,
  [TYPES.MUSIC.TITLE]: FEATURE_KEYS.TITLE,
  [TYPES.MUSIC.ARTIST]: FEATURE_KEYS.ARTIST,
  [TYPES.MUSIC.ALBUM]: FEATURE_KEYS.ALBUM,
  [TYPES.MUSIC.ARTWORK]: FEATURE_KEYS.ARTWORK,
  [TYPES.MUSIC.DURATION]: FEATURE_KEYS.DURATION,
  [TYPES.MUSIC.POSITION]: FEATURE_KEYS.POSITION,
  [TYPES.MUSIC.SHUFFLE]: FEATURE_KEYS.SHUFFLE,
  [TYPES.MUSIC.REPEAT]: FEATURE_KEYS.REPEAT,
  [TYPES.MUSIC.MUTE]: FEATURE_KEYS.MUTE,
  [TYPES.MUSIC.VOLUME]: FEATURE_KEYS.VOLUME,
};

// The speaker's settings and the core's values (MUSIC_REPEAT_MODE).
const REPEAT_SETTINGS = {
  REPEAT_OFF: REPEAT.OFF,
  REPEAT_ALL: REPEAT.ALL,
  REPEAT_ONE: REPEAT.ONE,
};
const REPEAT_KEYS = {
  [REPEAT.OFF]: KEYS.REPEAT_OFF,
  [REPEAT.ALL]: KEYS.REPEAT_ALL,
  [REPEAT.ONE]: KEYS.REPEAT_ONE,
};

// A day: the bound of the duration and position features.
const LONG = 24 * 60 * 60;

// Values of the source select. A preset is `preset-<n>`; `other` is any
// source Gladys cannot select itself (Spotify, a radio outside the presets,
// standby…): picking it does nothing. Stored by Gladys: permanent.
export const SOURCE_VALUES = { OTHER: 'other', AUX: 'AUX', BLUETOOTH: 'BLUETOOTH' };
export const presetValue = (id) => `preset-${id}`;

// Shown when there is nothing to say: Gladys ignores an empty text state.
export const NOTHING = '—';

// Feature names are frozen when the user creates the device: written in the
// language chosen in the configuration at that moment. The other entries are
// state texts, written in the current language.
export const NAMES = {
  en: {
    power: 'Power',
    volume: 'Volume',
    mute: 'Mute',
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous',
    next: 'Next',
    'playback-state': 'Playback',
    source: 'Source',
    title: 'Title',
    album: 'Album',
    artwork: 'Artwork',
    duration: 'Duration',
    position: 'Position',
    shuffle: 'Shuffle',
    repeat: 'Repeat',
    artist: 'Artist',
    zone: 'Multi-room group',
    other: 'Other',
    preset: 'Preset',
    standby: 'Standby',
    zoneNone: 'Not grouped',
    zoneLeader: 'Leads',
    zoneMember: 'Follows',
  },
  fr: {
    power: 'Marche',
    volume: 'Volume',
    mute: 'Sourdine',
    play: 'Lecture',
    pause: 'Pause',
    previous: 'Précédent',
    next: 'Suivant',
    'playback-state': 'État de la lecture',
    source: 'Source',
    title: 'Titre',
    album: 'Album',
    artwork: 'Pochette',
    duration: 'Durée',
    position: 'Position',
    shuffle: 'Aléatoire',
    repeat: 'Répétition',
    artist: 'Artiste',
    zone: 'Groupe multi-room',
    other: 'Autre',
    preset: 'Présélection',
    standby: 'Veille',
    zoneNone: 'Hors groupe',
    zoneLeader: 'Pilote',
    zoneMember: 'Suit',
  },
  de: {
    power: 'Betrieb',
    volume: 'Lautstärke',
    mute: 'Stummschaltung',
    play: 'Wiedergabe',
    pause: 'Pause',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
    'playback-state': 'Wiedergabestatus',
    source: 'Quelle',
    title: 'Titel',
    album: 'Album',
    artwork: 'Cover',
    duration: 'Dauer',
    position: 'Position',
    shuffle: 'Zufallswiedergabe',
    repeat: 'Wiederholen',
    artist: 'Interpret',
    zone: 'Multiroom-Gruppe',
    other: 'Andere',
    preset: 'Voreinstellung',
    standby: 'Standby',
    zoneNone: 'Nicht gruppiert',
    zoneLeader: 'Steuert',
    zoneMember: 'Folgt',
  },
  es: {
    power: 'Encendido',
    volume: 'Volumen',
    mute: 'Silencio',
    play: 'Reproducir',
    pause: 'Pausa',
    previous: 'Anterior',
    next: 'Siguiente',
    'playback-state': 'Estado de reproducción',
    source: 'Fuente',
    title: 'Título',
    album: 'Álbum',
    artwork: 'Carátula',
    duration: 'Duración',
    position: 'Posición',
    shuffle: 'Aleatorio',
    repeat: 'Repetir',
    artist: 'Artista',
    zone: 'Grupo multisala',
    other: 'Otra',
    preset: 'Presintonía',
    standby: 'En espera',
    zoneNone: 'Sin grupo',
    zoneLeader: 'Dirige',
    zoneMember: 'Sigue a',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;

export const speakerIds = (gladys, speaker) => gladys.externalIds(DEVICE_TYPE, speaker.id);

/** A command button of the Music box: Gladys sends 1, nothing to read back. */
const button = (key, names, type) => ({
  key,
  name: names[key],
  category: CATEGORIES.MUSIC,
  type,
  min: 1,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
});

/**
 * A music feature: read only, or writable with feedback (the speaker is the
 * source of truth, its confirmation comes back as a state).
 */
const music = (key, names, type, { max = 0, writable = false, unit } = {}) => ({
  key,
  name: names[key],
  category: CATEGORIES.MUSIC,
  type,
  min: 0,
  max,
  ...(unit ? { unit } : {}),
  read_only: !writable,
  has_feedback: writable,
  keep_history: false,
});

const text = (key, names) => ({
  key,
  name: names[key],
  category: CATEGORIES.TEXT,
  type: TYPES.TEXT.TEXT,
  // NOT NULL in the core, even for a text (422 on "Add to Gladys" otherwise).
  min: 0,
  max: 0,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

/** Label of a preset in the source select and the widget: "Preset 2 · FIP". */
export function presetLabel(preset, language) {
  const prefix = `${namesFor(language).preset} ${preset.id}`;
  return preset.name ? `${prefix} · ${preset.name}` : prefix;
}

/**
 * The inputs Gladys can switch to: AUX and Bluetooth when the speaker lists
 * them in /sources (both when it does not answer it), with the AUX account
 * to send back (`AUX`, or `AUX3` on some systems).
 */
export function selectableInputs(speaker) {
  const listed = speaker.sources;
  if (!Array.isArray(listed)) {
    return [
      { value: SOURCE_VALUES.AUX, source: 'AUX', account: 'AUX' },
      { value: SOURCE_VALUES.BLUETOOTH, source: 'BLUETOOTH', account: '' },
    ];
  }
  const inputs = [];
  const aux = listed.find((item) => item.source === 'AUX');
  if (aux) {
    inputs.push({ value: SOURCE_VALUES.AUX, source: 'AUX', account: aux.account || 'AUX' });
  }
  if (listed.some((item) => item.source === 'BLUETOOTH')) {
    inputs.push({ value: SOURCE_VALUES.BLUETOOTH, source: 'BLUETOOTH', account: '' });
  }
  return inputs;
}

/** Options of the source select, in display order. */
export function sourceOptions(speaker, language) {
  const names = namesFor(language);
  const options = [{ value: SOURCE_VALUES.OTHER, label: names.other }];
  for (const input of selectableInputs(speaker)) {
    options.push({ value: input.value, label: input.value === 'AUX' ? 'AUX' : 'Bluetooth' });
  }
  for (const preset of speaker.presets ?? []) {
    options.push({ value: presetValue(preset.id), label: presetLabel(preset, language) });
  }
  return options.map((option, index) => ({ ...option, sort_order: index }));
}

/** Feature specs of a speaker: what the Gladys device declares. */
export function speakerSpecs(speaker, language) {
  const names = namesFor(language);
  return [
    {
      key: FEATURE_KEYS.POWER,
      name: names.power,
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    {
      key: FEATURE_KEYS.VOLUME,
      name: names.volume,
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.VOLUME,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
      keep_history: false,
    },
    // A switch in 1.0: converted in place (same external id) by "Update".
    music(FEATURE_KEYS.MUTE, names, TYPES.MUSIC.MUTE, { max: 1, writable: true }),
    button(FEATURE_KEYS.PLAY, names, TYPES.MUSIC.PLAY),
    button(FEATURE_KEYS.PAUSE, names, TYPES.MUSIC.PAUSE),
    button(FEATURE_KEYS.PREVIOUS, names, TYPES.MUSIC.PREVIOUS),
    button(FEATURE_KEYS.NEXT, names, TYPES.MUSIC.NEXT),
    // Writable since 1.1: 0 pause, 1 play, 2 stop (3, buffering, is reported only).
    music(FEATURE_KEYS.PLAYBACK, names, TYPES.MUSIC.PLAYBACK_STATE, {
      max: PLAYBACK.IDLE,
      writable: true,
    }),
    {
      key: FEATURE_KEYS.SOURCE,
      name: names.source,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: sourceOptions(speaker, language),
    },
    // Texts in 1.0: converted in place (same external ids) by "Update".
    music(FEATURE_KEYS.TITLE, names, TYPES.MUSIC.TITLE),
    music(FEATURE_KEYS.ARTIST, names, TYPES.MUSIC.ARTIST),
    text(FEATURE_KEYS.ZONE, names),
    music(FEATURE_KEYS.ALBUM, names, TYPES.MUSIC.ALBUM),
    music(FEATURE_KEYS.ARTWORK, names, TYPES.MUSIC.ARTWORK),
    music(FEATURE_KEYS.DURATION, names, TYPES.MUSIC.DURATION, { max: LONG, unit: UNITS.SECONDS }),
    // Read only: the web API has no seek.
    music(FEATURE_KEYS.POSITION, names, TYPES.MUSIC.POSITION, { max: LONG, unit: UNITS.SECONDS }),
    music(FEATURE_KEYS.SHUFFLE, names, TYPES.MUSIC.SHUFFLE, { max: 1, writable: true }),
    music(FEATURE_KEYS.REPEAT, names, TYPES.MUSIC.REPEAT, { max: REPEAT.ONE, writable: true }),
  ];
}

/** The Gladys discovery payload of a speaker. */
export function buildDevice(gladys, speaker, config) {
  const ids = speakerIds(gladys, speaker);
  const params = [{ name: 'IP_ADDRESS', value: speaker.host }];
  if (speaker.info.type) {
    params.push({ name: 'MODEL', value: speaker.info.type });
  }
  if (speaker.info.firmware) {
    params.push({ name: 'FIRMWARE', value: speaker.info.firmware });
  }
  return {
    name: speaker.info.name,
    external_id: ids.device,
    model: speaker.info.type,
    // Pushed over the WebSocket and refreshed by the integration itself:
    // the Gladys scheduler never polls these devices (see src/hub.js).
    should_poll: false,
    params,
    features: speakerSpecs(speaker, config.language).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

/** Value of the source select for what the speaker plays. */
export function sourceValue(speaker) {
  const nowPlaying = speaker.nowPlaying;
  if (!isOn(nowPlaying)) {
    return SOURCE_VALUES.OTHER;
  }
  const preset = activePreset(nowPlaying, speaker.presets);
  if (preset) {
    return presetValue(preset.id);
  }
  const offered = selectableInputs(speaker).map((input) => input.value);
  return offered.includes(nowPlaying.source) ? nowPlaying.source : SOURCE_VALUES.OTHER;
}

/** Human name of what the speaker plays: "Bluetooth", "AUX", "Spotify"… */
export function sourceLabel(nowPlaying, language) {
  const names = namesFor(language);
  if (!isOn(nowPlaying)) {
    return names.standby;
  }
  const source = nowPlaying.source;
  const known = {
    AUX: 'AUX',
    BLUETOOTH: 'Bluetooth',
    SPOTIFY: 'Spotify',
    DEEZER: 'Deezer',
    PANDORA: 'Pandora',
    AMAZON: 'Amazon Music',
    TUNEIN: 'TuneIn',
    IHEART: 'iHeartRadio',
    INTERNET_RADIO: 'Radio',
    LOCAL_INTERNET_RADIO: 'Radio',
    STORED_MUSIC: 'SoundTouch',
    UPNP: 'UPnP',
    AIRPLAY: 'AirPlay',
    PRODUCT: 'TV',
    ALEXA: 'Alexa',
  };
  if (known[source]) {
    return known[source];
  }
  // SLAVE_SOURCE (in a group), QPLAY…: the raw name, readable.
  return source
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** "Now playing" and "Artist" texts. */
export function playingTexts(nowPlaying, language) {
  if (!isOn(nowPlaying)) {
    return { title: namesFor(language).standby, artist: NOTHING };
  }
  const { track, artist, station, content } = nowPlaying;
  const title = track ?? station ?? content?.name ?? sourceLabel(nowPlaying, language);
  // A radio gives its name as station and the song (when it does) as track.
  const second = artist ?? (track && station && station !== track ? station : null);
  return { title: title.slice(0, 200), artist: (second ?? NOTHING).slice(0, 200) };
}

/**
 * Multi-room text: "Not grouped", "Leads Kitchen, Bedroom", "Follows Living
 * room". `nameOf(id)` gives the name of another speaker (its id when unknown).
 */
export function zoneText(speaker, language, nameOf) {
  const names = namesFor(language);
  const zone = speaker.zone;
  if (!zone) {
    return names.zoneNone;
  }
  if (zone.master === speaker.id) {
    const others = zone.members.filter((member) => member.id !== speaker.id);
    if (others.length === 0) {
      return names.zoneNone;
    }
    return `${names.zoneLeader} ${others.map((member) => nameOf(member.id)).join(', ')}`.slice(
      0,
      200,
    );
  }
  return `${names.zoneMember} ${nameOf(zone.master)}`.slice(0, 200);
}

/**
 * Values of the features that are not music ones (power, source, multi-room
 * group), by feature key: a number, or `{ text }`. Only what is known (a
 * speaker never read yet has no values).
 */
export function speakerValues(speaker, language, nameOf = (id) => id) {
  const values = {};
  const { nowPlaying } = speaker;
  if (nowPlaying) {
    values[FEATURE_KEYS.POWER] = isOn(nowPlaying) ? 1 : 0;
    values[FEATURE_KEYS.SOURCE] = { text: sourceValue(speaker) };
  }
  if (speaker.zoneKnown) {
    values[FEATURE_KEYS.ZONE] = { text: zoneText(speaker, language, nameOf) };
  }
  return values;
}

/** MUSIC_PLAYBACK_STATE of what the speaker reports; standby is idle. */
export function playbackState(nowPlaying) {
  if (!isOn(nowPlaying)) {
    return PLAYBACK.IDLE;
  }
  switch (nowPlaying.playStatus) {
    case 'PLAY_STATE':
      return PLAYBACK.PLAYING;
    case 'BUFFERING_STATE':
      return PLAYBACK.BUFFERING;
    case 'PAUSE_STATE':
      return PLAYBACK.PAUSED;
    default:
      // STOP_STATE, or no status at all.
      return PLAYBACK.IDLE;
  }
}

/**
 * Title, artist and album of the music player: the track, else the station,
 * else the source ("AUX", "Bluetooth"…) so the player never looks empty while
 * something plays. A radio's station goes to the album line when the track
 * is a song. Empty when the speaker is in standby.
 */
export function musicTexts(nowPlaying, language) {
  if (!isOn(nowPlaying)) {
    return { title: '', artist: '', album: '' };
  }
  const { track, artist, album, station, content } = nowPlaying;
  const title = track ?? station ?? content?.name ?? sourceLabel(nowPlaying, language);
  const stationLine = station && station !== title ? station : null;
  return { title, artist: artist ?? '', album: album ?? stationLine ?? '' };
}

/**
 * The now playing of a speaker as publishNowPlaying takes it (keys are the
 * SDK's: playback_state, title, artwork_url…). Only what is known: shuffle and
 * repeat only on a source that reports them (another source leaves them
 * unchanged), volume and mute once /volume was read.
 * @param {object} speaker hub speaker: nowPlaying, volume
 * @param {string} language
 * @param {number} position seconds, from positionOf
 */
export function musicValues(speaker, language, position) {
  const values = {};
  const { nowPlaying, volume } = speaker;
  if (nowPlaying) {
    values.playback_state = playbackState(nowPlaying);
    Object.assign(values, musicTexts(nowPlaying, language));
    const on = isOn(nowPlaying);
    values.artwork_url = on ? (nowPlaying.art ?? nowPlaying.content?.art ?? null) : null;
    values.duration = on ? (nowPlaying.duration ?? 0) : 0;
    values.position = on ? position : 0;
    if (on && nowPlaying.shuffle) {
      values.shuffle = nowPlaying.shuffle === 'SHUFFLE_ON' ? 1 : 0;
    }
    if (on && nowPlaying.repeat in REPEAT_SETTINGS) {
      values.repeat = REPEAT_SETTINGS[nowPlaying.repeat];
    }
  }
  if (volume) {
    values.volume = volume.level;
    values.mute = volume.muted ? 1 : 0;
  }
  return values;
}

/**
 * What identifies a track: when it changes, a stream without position starts
 * counting from zero.
 */
export function trackIdentity(nowPlaying) {
  if (!isOn(nowPlaying)) {
    return null;
  }
  const { source, track, artist, album, station, content } = nowPlaying;
  return JSON.stringify([source, content?.location, track, artist, album, station]);
}

/**
 * The position to publish, in seconds, at `now` (ms, the SDK's clock):
 * the speaker's last sample moved forward while it plays, capped at the
 * duration. A stream that reports none (a radio) counts from its start while
 * it plays, so the SDK, which extrapolates the same way, never republishes.
 * @param {object} speaker nowPlaying, sampledAt (ms of the last position read), trackStart (ms)
 * @param {number} now
 */
export function positionOf(speaker, now) {
  const { nowPlaying } = speaker;
  const playing = playbackState(nowPlaying) === PLAYBACK.PLAYING;
  if (nowPlaying?.position === null || nowPlaying?.position === undefined) {
    return playing && speaker.trackStart
      ? Math.max(0, Math.floor((now - speaker.trackStart) / 1000))
      : 0;
  }
  let position = nowPlaying.position;
  if (playing && speaker.sampledAt) {
    position += Math.max(0, Math.floor((now - speaker.sampledAt) / 1000));
  }
  return nowPlaying.duration ? Math.min(position, nowPlaying.duration) : position;
}

/**
 * What a Gladys command does on the speaker:
 * `{ key }` (remote key), `{ volume }`, `{ preset }`, `{ input }`, or null
 * (nothing to do: already in that state, or `other` picked in the select).
 * @throws on a feature that takes no command
 */
export function commandFor(speaker, featureKey, value) {
  const on = isOn(speaker.nowPlaying);
  switch (featureKey) {
    case FEATURE_KEYS.POWER: {
      // POWER toggles: only send it when the state differs.
      const wanted = Number(value) === 1;
      return wanted === on ? null : { key: KEYS.POWER };
    }
    case FEATURE_KEYS.VOLUME: {
      const level = Number(value);
      if (!Number.isFinite(level)) {
        throw new Error(`Invalid volume ${value}`);
      }
      return { volume: Math.round(Math.min(100, Math.max(0, level))) };
    }
    case FEATURE_KEYS.MUTE: {
      // MUTE toggles too (the hub reads /volume again just before).
      const wanted = Number(value) === 1;
      return wanted === Boolean(speaker.volume?.muted) ? null : { key: KEYS.MUTE };
    }
    case FEATURE_KEYS.PLAYBACK: {
      const wanted = Number(value);
      if (wanted === PLAYBACK.PLAYING) {
        return { key: KEYS.PLAY };
      }
      if (wanted !== PLAYBACK.PAUSED && wanted !== PLAYBACK.IDLE) {
        throw new Error(`Invalid playback state ${value}`);
      }
      // Pause or stop a speaker in standby: nothing to do.
      if (!on) {
        return null;
      }
      return { key: wanted === PLAYBACK.PAUSED ? KEYS.PAUSE : KEYS.STOP };
    }
    case FEATURE_KEYS.SHUFFLE: {
      const current = on ? speaker.nowPlaying.shuffle : null;
      if (!current) {
        throw new Error(`${speaker.info.name}: the current source has no shuffle`);
      }
      const wanted = Number(value) === 1;
      if (wanted === (current === 'SHUFFLE_ON')) {
        return null;
      }
      return { key: wanted ? KEYS.SHUFFLE_ON : KEYS.SHUFFLE_OFF };
    }
    case FEATURE_KEYS.REPEAT: {
      const current = on ? REPEAT_SETTINGS[speaker.nowPlaying.repeat] : undefined;
      if (current === undefined) {
        throw new Error(`${speaker.info.name}: the current source has no repeat`);
      }
      const key = REPEAT_KEYS[Number(value)];
      if (!key) {
        throw new Error(`Invalid repeat mode ${value}`);
      }
      return Number(value) === current ? null : { key };
    }
    case FEATURE_KEYS.PLAY:
      return { key: KEYS.PLAY };
    case FEATURE_KEYS.PAUSE:
      return { key: KEYS.PAUSE };
    case FEATURE_KEYS.PREVIOUS:
      return { key: KEYS.PREVIOUS };
    case FEATURE_KEYS.NEXT:
      return { key: KEYS.NEXT };
    case FEATURE_KEYS.SOURCE: {
      const choice = String(value);
      const presetMatch = choice.match(/^preset-(\d)$/);
      if (presetMatch) {
        const preset = (speaker.presets ?? []).find((item) => item.id === Number(presetMatch[1]));
        if (!preset) {
          throw new Error(`Preset ${presetMatch[1]} is empty on ${speaker.info.name}`);
        }
        return { preset };
      }
      const input = selectableInputs(speaker).find((item) => item.value === choice);
      if (input) {
        return { input };
      }
      if (choice === SOURCE_VALUES.OTHER) {
        return null;
      }
      throw new Error(`Unknown source ${choice}`);
    }
    default:
      throw new Error(`The feature ${featureKey} takes no command`);
  }
}
