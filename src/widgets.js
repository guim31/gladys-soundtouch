// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `player`.
//
// The core's Music box already has play, pause, previous, next and the volume
// slider. What this widget adds: what is playing (title, artist, source), the
// multi-room group, and the six presets behind one button (a form with the
// list, Gladys 5.2.0+: GladysAssistant/Gladys#3168).
//
// Budget (8 components, 2 texts, 1 status, 4 buttons): a heading and a
// caption, the live volume tile, one status list, four buttons. The current
// state is told by the icon of the play/pause button, never by its style:
// `primary` is invisible in dark mode.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  NOTHING,
  playingTexts,
  presetLabel,
  sourceLabel,
  speakerIds,
  zoneText,
} from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { activePreset, isOn, isPlaying } from './soundtouch/model.js';

export const ACTIONS = { PLAY_PAUSE: 'play_pause', POWER: 'power', PRESET: 'preset' };

export const TEXT = {
  pick: {
    en: 'Choose a SoundTouch speaker in the settings of this widget.',
    fr: 'Choisissez une enceinte SoundTouch dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets einen SoundTouch-Lautsprecher aus.',
    es: 'Elija un altavoz SoundTouch en la configuración de este widget.',
  },
  unknown: {
    en: 'This speaker is not known yet: run a search in the integration.',
    fr: 'Cette enceinte est inconnue : lancez une recherche dans l’intégration.',
    de: 'Dieser Lautsprecher ist noch unbekannt: Starte eine Suche in der Integration.',
    es: 'Este altavoz aún no es conocido: inicie una búsqueda en la integración.',
  },
  updateGladys: {
    en: 'Update Gladys to pick a preset from the widget.',
    fr: 'Mettez Gladys à jour pour choisir une présélection depuis le widget.',
    de: 'Aktualisiere Gladys, um eine Voreinstellung im Widget auszuwählen.',
    es: 'Actualice Gladys para elegir una presintonía desde el widget.',
  },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  source: { en: 'Source', fr: 'Source', de: 'Quelle', es: 'Fuente' },
  group: { en: 'Group', fr: 'Groupe', de: 'Gruppe', es: 'Grupo' },
  playing: { en: 'Playing', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproduciendo' },
  paused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  standby: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  previous: { en: 'Previous', fr: 'Précédent', de: 'Zurück', es: 'Anterior' },
  next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  play: { en: 'Play', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  powerOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  presets: { en: 'Presets', fr: 'Présélections', de: 'Voreinstellungen', es: 'Presintonías' },
  preset: { en: 'Preset', fr: 'Présélection', de: 'Voreinstellung', es: 'Presintonía' },
};

const t = (text, language) => text[language] ?? text.en;
const truncate = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Every language of a text table entry, with a suffix: a toast. */
const allLanguages = (build) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, build(language)]));

/** The content of one widget instance. */
export function playerContent(hub, { settings = {}, language = 'en' } = {}) {
  if (!settings.device) {
    return { components: [{ type: 'text', variant: 'body', text: t(TEXT.pick, language) }] };
  }
  const speaker = hub.resolveDevice(settings.device);
  if (!speaker?.info) {
    return { components: [{ type: 'text', variant: 'body', text: t(TEXT.unknown, language) }] };
  }
  const ids = speakerIds(hub.gladys, speaker);
  const { nowPlaying } = speaker;
  const on = isOn(nowPlaying);
  const playing = isPlaying(nowPlaying);
  const { title, artist } = playingTexts(nowPlaying, language);
  const preset = activePreset(nowPlaying, speaker.presets);
  const source = preset ? presetLabel(preset, language) : sourceLabel(nowPlaying, language);

  let state = { label: TEXT.standby, color: WIDGET_COLORS.NEUTRAL };
  if (!speaker.reachable) {
    state = { label: TEXT.unreachable, color: WIDGET_COLORS.DANGER };
  } else if (on) {
    state = playing
      ? { label: TEXT.playing, color: WIDGET_COLORS.SUCCESS }
      : { label: TEXT.paused, color: WIDGET_COLORS.WARNING };
  }

  const caption = [artist === NOTHING ? null : artist, on ? source : null]
    .filter(Boolean)
    .join(' · ');
  const components = [
    { type: 'text', variant: 'heading', text: truncate(on ? title : speaker.info.name, 40) },
    {
      type: 'text',
      variant: 'caption',
      text: truncate(caption || speaker.info.name, 80),
    },
    {
      type: 'value',
      label: t(TEXT.volume, language),
      icon: speaker.volume?.muted ? 'volume-x' : 'volume-2',
      device_feature: ids.feature(FEATURE_KEYS.VOLUME),
    },
    {
      type: 'status',
      items: [
        { label: t(TEXT.state, language), value: t(state.label, language), color: state.color },
        { label: t(TEXT.source, language), value: truncate(on ? source : NOTHING, 40) },
        {
          label: t(TEXT.group, language),
          value: truncate(
            zoneText(speaker, language, (id) => hub.nameOf(id)),
            40,
          ),
        },
      ],
    },
    {
      type: 'button',
      label: t(TEXT.previous, language),
      icon: 'skip-back',
      style: 'secondary',
      device_feature: ids.feature(FEATURE_KEYS.PREVIOUS),
      value: 1,
    },
    on
      ? {
          type: 'button',
          label: t(playing ? TEXT.pause : TEXT.play, language),
          icon: playing ? 'pause' : 'play',
          style: 'secondary',
          action: { key: ACTIONS.PLAY_PAUSE },
        }
      : {
          type: 'button',
          label: t(TEXT.powerOn, language),
          icon: 'power',
          style: 'secondary',
          action: { key: ACTIONS.POWER },
        },
    {
      type: 'button',
      label: t(TEXT.next, language),
      icon: 'skip-forward',
      style: 'secondary',
      device_feature: ids.feature(FEATURE_KEYS.NEXT),
      value: 1,
    },
  ];
  const presets = speaker.presets ?? [];
  if (presets.length > 0) {
    components.push({
      type: 'button',
      label: t(TEXT.presets, language),
      icon: 'radio',
      style: 'secondary',
      action: {
        key: ACTIONS.PRESET,
        fields: [
          {
            key: 'preset',
            type: 'select',
            required: true,
            label: allLanguages((lang) => t(TEXT.preset, lang)),
            options: presets.map((item) => ({
              value: String(item.id),
              label: allLanguages((lang) => truncate(presetLabel(item, lang), 40)),
            })),
            default: String((preset ?? presets[0]).id),
          },
        ],
      },
    });
  }
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => playerContent(hub, request),

    async action(hub, { actionKey, settings = {}, values }) {
      switch (actionKey) {
        case ACTIONS.PLAY_PAUSE:
          await hub.playPause(settings.device);
          return undefined;
        case ACTIONS.POWER: {
          const speaker = hub.require(settings.device);
          await hub.setValue(
            { external_id: speakerIds(hub.gladys, speaker).device },
            { external_id: speakerIds(hub.gladys, speaker).feature(FEATURE_KEYS.POWER) },
            1,
          );
          return undefined;
        }
        case ACTIONS.PRESET: {
          // An older core relays the tap without the form values.
          if (!values?.preset) {
            throw new Error(TEXT.updateGladys.en);
          }
          const preset = await hub.playPreset(settings.device, values.preset);
          return allLanguages((language) => truncate(presetLabel(preset, language), 200));
        }
        default:
          throw new Error(`Unknown widget action ${actionKey}`);
      }
    },
  },
};
