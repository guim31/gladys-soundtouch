// -----------------------------------------------------------------------------
// From a SoundTouch speaker to a Gladys device, and back: the discovery
// payload, the state values, and what each command does on the speaker.
//
// One device per speaker, a music player in the Gladys sense: the `music/*`
// features drive the core's Music dashboard box (play, pause, previous, next,
// volume slider, playback state), and the rest (power, mute, source, what is
// playing, multi-room group) shows in the device box.
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
} from '@gladysassistant/integration-sdk';
import { KEYS } from './soundtouch/client.js';
import { activePreset, isOn, isPlaying } from './soundtouch/model.js';

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
};

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
    title: 'Now playing',
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
    title: 'En cours',
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
    title: 'Aktueller Titel',
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
    title: 'Reproduciendo',
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
    {
      key: FEATURE_KEYS.MUTE,
      name: names.mute,
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: false,
    },
    button(FEATURE_KEYS.PLAY, names, TYPES.MUSIC.PLAY),
    button(FEATURE_KEYS.PAUSE, names, TYPES.MUSIC.PAUSE),
    button(FEATURE_KEYS.PREVIOUS, names, TYPES.MUSIC.PREVIOUS),
    button(FEATURE_KEYS.NEXT, names, TYPES.MUSIC.NEXT),
    {
      key: FEATURE_KEYS.PLAYBACK,
      name: names[FEATURE_KEYS.PLAYBACK],
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.PLAYBACK_STATE,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
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
    text(FEATURE_KEYS.TITLE, names),
    text(FEATURE_KEYS.ARTIST, names),
    text(FEATURE_KEYS.ZONE, names),
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
 * Feature values of a speaker, by feature key: a number, or `{ text }`.
 * Only what is known (a speaker never read yet has no values).
 */
export function speakerValues(speaker, language, nameOf = (id) => id) {
  const values = {};
  const { nowPlaying, volume } = speaker;
  if (nowPlaying) {
    values[FEATURE_KEYS.POWER] = isOn(nowPlaying) ? 1 : 0;
    values[FEATURE_KEYS.PLAYBACK] = isPlaying(nowPlaying) ? 1 : 0;
    values[FEATURE_KEYS.SOURCE] = { text: sourceValue(speaker) };
    const { title, artist } = playingTexts(nowPlaying, language);
    values[FEATURE_KEYS.TITLE] = { text: title };
    values[FEATURE_KEYS.ARTIST] = { text: artist };
  }
  if (volume) {
    values[FEATURE_KEYS.VOLUME] = volume.level;
    values[FEATURE_KEYS.MUTE] = volume.muted ? 1 : 0;
  }
  if (speaker.zoneKnown) {
    values[FEATURE_KEYS.ZONE] = { text: zoneText(speaker, language, nameOf) };
  }
  return values;
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
      // MUTE toggles too.
      const wanted = Number(value) === 1;
      return wanted === Boolean(speaker.volume?.muted) ? null : { key: KEYS.MUTE };
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
