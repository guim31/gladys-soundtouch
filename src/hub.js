// -----------------------------------------------------------------------------
// The SoundTouch hub: finds the speakers, keeps one live link per speaker,
// publishes their devices and states to Gladys, and runs the commands.
//
// Real time: every speaker pushes its changes over its notification
// WebSocket (port 8080). The hub also refreshes every speaker by itself over
// HTTP: every 2 minutes while the WebSocket is up (a lost push, a link that
// died silently), every 30 seconds while it is down. Gladys never polls these
// devices (should_poll: false): its scheduler cannot follow a push, and a
// device created without polling fields is never polled (Gladys#3198). The
// core's onPoll stays as a fallback and refreshes the speaker at once.
//
// Logs: the info level only tells what changes (a speaker found, lost or
// back, Gladys refusing updates then accepting them again) and one line per
// user command. Pushes, refreshes and reconnection attempts are debug lines;
// a failure that repeats is logged once when it starts and once when it is
// over (src/issues.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  MUSIC_KEYS,
  buildDevice,
  commandFor,
  musicValues,
  positionOf,
  presetLabel,
  sourceValue,
  speakerIds,
  speakerValues,
  trackIdentity,
} from './devices.js';
import { presetItems, presetNumberOf } from './music.js';
import { MDNS_TIMEOUT_SECONDS, mapLimit, mdnsCandidates } from './discovery.js';
import { IssueLog } from './issues.js';
import { KEYS, SoundTouchClient } from './soundtouch/client.js';
import {
  activePreset,
  isOn,
  mergeNowPlaying,
  normalizeDeviceId,
  parseUpdate,
} from './soundtouch/model.js';
import { LiveSocket } from './soundtouch/socket.js';

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noSpeaker: {
    en: 'No SoundTouch speaker found. Check that it is on the same network, or enter its IP address.',
    fr: "Aucune enceinte SoundTouch trouvée. Vérifiez qu'elle est sur le même réseau, ou saisissez son adresse IP.",
    de: 'Kein SoundTouch-Lautsprecher gefunden. Prüfe, ob er im selben Netzwerk ist, oder gib seine IP-Adresse ein.',
    es: 'No se ha encontrado ningún altavoz SoundTouch. Compruebe que está en la misma red o introduzca su dirección IP.',
  },
  noAnswer: {
    en: 'No SoundTouch speaker answers.',
    fr: 'Aucune enceinte SoundTouch ne répond.',
    de: 'Kein SoundTouch-Lautsprecher antwortet.',
    es: 'Ningún altavoz SoundTouch responde.',
  },
};

const logger = createLogger({ name: 'soundtouch' });

export const WIDGET_KEY = 'player';
export const PRESET_TRIGGER = 'preset_selected';

export const HUB_TIMINGS = {
  // HTTP refresh of a speaker whose WebSocket is up: catches a lost push and
  // a link that died without closing.
  checkMs: 2 * 60_000,
  // HTTP refresh of a speaker whose WebSocket is down.
  fallbackPollMs: 30_000,
  // New scan (mDNS + typed addresses), to follow DHCP changes and new speakers.
  rediscoveryMs: 15 * 60_000,
  // Pushes closer than this are published together (a volume knob turned).
  debounceMs: 300,
  // Refresh after a command, when no WebSocket will bring the result.
  afterCommandMs: 1_500,
  // A preset starting this long after a Gladys command is Gladys' own.
  ownCommandMs: 5_000,
  // An unchanged value is published again this often ("no recent value"
  // shows after 48 h in the Gladys interface).
  heartbeatMs: 6 * 60 * 60_000,
};

const PROBE_CONCURRENCY = 8;
const MAX_TRANSPORTS_PER_REQUEST = 100;

export class SoundTouchHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {typeof fetch} [options.fetch] test seam for the HTTP client
   * @param {(url: string, protocols: string[]) => WebSocket} [options.createSocket] test seam
   * @param {boolean} [options.timers] periodic timers (the tests may turn them off)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.socketTimings] SOCKET_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, fetch, createSocket, timers = true, timings, socketTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.createSocket = createSocket;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.socketTimings = socketTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<string, object>} speaker records, by device id */
    this.speakers = new Map();
    this.pending = new Set();
    this.rediscoveryTimer = null;
    this.lastScan = { mdns: 'not-run', found: 0 };
    this.stopped = false;
    this.issues = new IssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    await this.discover();
    await this.publishDevices();
    for (const speaker of this.speakers.values()) {
      this.connect(speaker);
    }
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    if (this.timersEnabled) {
      this.rediscoveryTimer = setInterval(
        () => this.track(this.rediscover()),
        this.timings.rediscoveryMs,
      );
      this.rediscoveryTimer.unref?.();
    }
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous && previous.hosts.join(',') !== config.hosts.join(',')) {
      await this.discover();
      for (const speaker of this.speakers.values()) {
        this.connect(speaker);
      }
    }
    // The language changes the texts (and the names of the devices to add).
    if (previous && previous.language !== config.language) {
      this.gladys.forgetPublishedStates();
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.rediscoveryTimer);
    for (const speaker of this.speakers.values()) {
      this.disconnect(speaker);
    }
    await this.idle();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => {
        // Gladys API failures are already logged (once) by toGladys.
        if (!err?.logged) {
          this.issues.fail(`task:${err?.message}`, `Background task failed: ${err?.message}`);
        }
      })
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /** Resolves once no background work is left. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const [rawId, saved] of Object.entries(data.speakers ?? {})) {
      const id = normalizeDeviceId(rawId);
      if (!id || !saved || typeof saved.host !== 'string' || typeof saved.info?.name !== 'string') {
        continue;
      }
      const speaker = this.createRecord(id, saved.host);
      speaker.info = { ...saved.info, id };
      speaker.presets = Array.isArray(saved.presets) ? saved.presets : [];
      speaker.sources = Array.isArray(saved.sources) ? saved.sources : null;
      this.speakers.set(id, speaker);
    }
  }

  save() {
    const speakers = {};
    for (const speaker of this.speakers.values()) {
      if (speaker.info) {
        speakers[speaker.id] = {
          host: speaker.host,
          info: speaker.info,
          presets: speaker.presets,
          sources: speaker.sources,
        };
      }
    }
    return this.store.save({ speakers });
  }

  // --- Discovery -------------------------------------------------------------

  createRecord(id, host) {
    return {
      id,
      host,
      client: new SoundTouchClient(host, { fetch: this.fetch }),
      info: null,
      nowPlaying: null,
      volume: null,
      presets: [],
      sources: null,
      zone: null,
      zoneKnown: false,
      reachable: false,
      socket: null,
      timer: null,
      timerMs: null,
      debounceTimer: null,
      refreshing: null,
      ownCommandAt: null,
      widgetKey: null,
      // Position bookkeeping (Date.now(), the clock the SDK extrapolates with):
      // when the last position was read, and when the current track started.
      sampledAt: null,
      trackStart: null,
      trackIdentity: null,
      // Last time the music snapshot was forgotten (heartbeat).
      musicForgottenAt: null,
    };
  }

  /**
   * Scan: mDNS through the Gladys core, the typed addresses and the known
   * ones. Resolves with the number of speakers answering.
   */
  async discover() {
    // Priority when one speaker answers on several addresses: the typed one,
    // then the one mDNS announces, then the one known from before.
    const hosts = [];
    const add = (host) => {
      if (host && !hosts.includes(host)) {
        hosts.push(host);
      }
    };
    this.config.hosts.forEach(add);
    (await this.scanMdns()).forEach((candidate) => add(candidate.host));
    [...this.speakers.values()].forEach((speaker) => add(speaker.host));

    const results = await mapLimit(hosts, PROBE_CONCURRENCY, (host) => this.probe(host));
    const answers = new Map();
    results.forEach((result, index) => {
      if (result.error) {
        logger.debug(`No SoundTouch answer from ${hosts[index]}: ${result.error.message}`);
      } else if (!answers.has(result.value.snapshot.info.id)) {
        answers.set(result.value.snapshot.info.id, result.value);
      }
    });
    for (const answer of answers.values()) {
      this.adopt(answer);
    }
    for (const speaker of this.speakers.values()) {
      // A live WebSocket is a better proof than one probe that timed out.
      if (!answers.has(speaker.id) && !speaker.socket?.connected) {
        this.setReachable(speaker, false);
      }
    }
    this.lastScan = { ...this.lastScan, found: answers.size };
    await this.save();
    return answers.size;
  }

  async scanMdns() {
    try {
      const results = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: MDNS_TIMEOUT_SECONDS,
      });
      const candidates = mdnsCandidates(results);
      this.issues.recover('mdns', 'mDNS scan through Gladys works again');
      this.lastScan = { ...this.lastScan, mdns: 'ok', mdnsCount: candidates.length };
      return candidates;
    } catch (err) {
      // 403: an older core, or the capture refused. Typed addresses still work.
      this.issues.fail('mdns', `mDNS scan through Gladys failed: ${err.message}`);
      this.lastScan = { ...this.lastScan, mdns: 'unavailable' };
      return [];
    }
  }

  /** Ask one address who it is, and what it plays. */
  async probe(host) {
    const client = new SoundTouchClient(host, { fetch: this.fetch });
    return { host, client, snapshot: await client.getSnapshot() };
  }

  /**
   * Take a probe answer: a new speaker is added, a known one found at a new
   * address (DHCP) moves there.
   */
  adopt({ host, client, snapshot }) {
    const id = snapshot.info.id;
    let speaker = this.speakers.get(id);
    if (!speaker) {
      speaker = this.createRecord(id, host);
      speaker.client = client;
      this.speakers.set(id, speaker);
      logger.info(
        `SoundTouch speaker ${snapshot.info.name} (${snapshot.info.type}) found at ${host}`,
      );
    } else if (speaker.host !== host) {
      logger.info(`SoundTouch speaker ${snapshot.info.name} moved from ${speaker.host} to ${host}`);
      this.disconnect(speaker);
      speaker.host = host;
      speaker.client = client;
    }
    this.applySnapshot(speaker, snapshot);
    this.setReachable(speaker, true);
    return speaker;
  }

  applySnapshot(speaker, { info, nowPlaying, volume, presets, zone, sources }) {
    speaker.info = info;
    this.setNowPlaying(speaker, nowPlaying);
    speaker.volume = volume;
    speaker.presets = presets;
    speaker.zone = zone;
    speaker.zoneKnown = true;
    if (sources) {
      speaker.sources = sources;
    }
  }

  async rediscover() {
    await this.discover();
    for (const speaker of this.speakers.values()) {
      this.connect(speaker);
    }
    // New speakers, and new addresses (DHCP) for the params of the created
    // devices.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.speakers.values()]
      .filter((speaker) => speaker.info)
      .map((speaker) => buildDevice(this.gladys, speaker, this.config));
    await this.toGladys('publishDiscoveredDevices', devices);
  }

  /** The speaker behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    for (const speaker of this.speakers.values()) {
      if (speakerIds(this.gladys, speaker).device === externalId) {
        return speaker;
      }
    }
    return null;
  }

  /** External ids of the devices the user created in Gladys. */
  createdDeviceIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** Name of a speaker for the group texts: its own name, else its id. */
  nameOf(id) {
    return this.speakers.get(id)?.info?.name ?? id.toUpperCase();
  }

  // --- States ----------------------------------------------------------------

  /**
   * Publish the states of one speaker's device, if the user created it. The
   * SDK only sends what changed (Gladys caps states at 300 a minute and
   * re-evaluates the scenes on each one), plus a heartbeat of what did not.
   * The music features go through publishNowPlaying (one batch per change,
   * position only on an event or a jump); the others through
   * publishChangedStates. Published even before the user clicks "Update" on a
   * 1.0 device: Gladys ignores the features it does not have yet, and the SDK
   * publishes everything again after the update.
   */
  async publishStates(speaker) {
    const ids = speakerIds(this.gladys, speaker);
    if (!speaker.info || !this.createdDeviceIds().has(ids.device)) {
      return;
    }
    // publishNowPlaying has no heartbeat: everything again as often.
    if (speaker.musicForgottenAt === null) {
      speaker.musicForgottenAt = this.now();
    } else if (this.now() - speaker.musicForgottenAt >= this.timings.heartbeatMs) {
      speaker.musicForgottenAt = this.now();
      this.gladys.forgetPublishedStates(ids.device);
    }
    const music = musicValues(speaker, this.config.language, positionOf(speaker, Date.now()));
    if (Object.keys(music).length > 0) {
      const featureExternalIds = Object.fromEntries(
        Object.entries(MUSIC_KEYS).map(([type, key]) => [type, ids.feature(key)]),
      );
      await this.toGladys('publishNowPlaying', ids.device, music, { featureExternalIds });
    }
    const values = speakerValues(speaker, this.config.language, (id) => this.nameOf(id));
    const states = Object.entries(values).map(([key, value]) =>
      typeof value === 'object'
        ? { device_feature_external_id: ids.feature(key), text: value.text }
        : { device_feature_external_id: ids.feature(key), state: value },
    );
    if (states.length > 0) {
      await this.toGladys('publishChangedStates', states, { heartbeat: this.timings.heartbeatMs });
    }
    this.widgetChanged(speaker);
  }

  async publishAllStates() {
    for (const speaker of this.speakers.values()) {
      try {
        await this.publishStates(speaker);
      } catch (err) {
        if (!err.logged) {
          logger.warn(`Cannot publish the states of ${speaker.info?.name}: ${err.message}`);
        }
      }
    }
  }

  /** The user added a device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const speaker = this.resolveDevice(device?.external_id);
    if (!speaker) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(speaker);
    await this.publishTransports([speaker]);
    this.requestWidgetRefresh();
  }

  async publishTransports(speakers = [...this.speakers.values()]) {
    const created = this.createdDeviceIds();
    const entries = speakers
      .map((speaker) => ({
        external_id: speakerIds(this.gladys, speaker).device,
        transport: speaker.reachable ? 'local' : 'unreachable',
      }))
      .filter((entry) => created.has(entry.external_id));
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      await this.toGladys('publishTransports', entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST));
    }
  }

  async publishConnectionStatus() {
    const speakers = [...this.speakers.values()];
    if (speakers.length === 0) {
      await this.toGladys('setConnectionStatus', false, CONNECTION_TEXT.noSpeaker);
    } else if (!speakers.some((speaker) => speaker.reachable)) {
      await this.toGladys('setConnectionStatus', false, CONNECTION_TEXT.noAnswer);
    } else {
      await this.toGladys('setConnectionStatus', true);
    }
  }

  /**
   * A call to the Gladys host API. While Gladys restarts every call fails:
   * one warning when it starts, one info line when Gladys accepts them again.
   * The error is marked `logged` and thrown on.
   */
  async toGladys(method, ...args) {
    try {
      const result = await this.gladys[method](...args);
      this.issues.recover('gladys', 'Gladys accepts the updates again');
      return result;
    } catch (err) {
      this.issues.fail('gladys', `Gladys refused an update (${method}): ${err.message}`);
      if (err && typeof err === 'object') {
        err.logged = true;
      }
      throw err;
    }
  }

  requestWidgetRefresh() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Nudge the widget when what it shows (besides the live volume) changed. */
  widgetChanged(speaker) {
    const values = {
      ...speakerValues(speaker, this.config.language, (id) => this.nameOf(id)),
      ...musicValues(speaker, this.config.language, 0),
    };
    // The volume tile is bound to its feature: it moves on its own.
    delete values.volume;
    const key = JSON.stringify([
      speaker.reachable,
      speaker.info?.name,
      values,
      (speaker.presets ?? []).map((preset) => preset.name),
    ]);
    if (speaker.widgetKey !== null && speaker.widgetKey !== key) {
      this.requestWidgetRefresh();
    }
    speaker.widgetKey = key;
  }

  setReachable(speaker, reachable) {
    if (speaker.reachable === reachable) {
      return false;
    }
    speaker.reachable = reachable;
    if (speaker.info) {
      logger.info(`${speaker.info.name} is ${reachable ? 'reachable' : 'unreachable'}`);
    }
    return true;
  }

  async reachabilityChanged(speaker, reachable) {
    if (this.setReachable(speaker, reachable)) {
      await this.publishTransports([speaker]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh();
    }
  }

  // --- Live link and refresh --------------------------------------------------

  connect(speaker) {
    if (this.stopped || speaker.socket) {
      return;
    }
    speaker.socket = new LiveSocket({
      url: speaker.client.websocketUrl,
      createSocket: this.createSocket,
      timings: this.socketTimings,
      logger,
      onMessage: (text) => this.receive(speaker, text),
      onOpen: () => {
        logger.debug(`${speaker.info?.name ?? speaker.host}: notifications connected`);
        this.schedule(speaker);
        // What changed while the link was down.
        this.track(this.refresh(speaker));
      },
      onClose: () => {
        logger.debug(`${speaker.info?.name ?? speaker.host}: notifications lost`);
        this.schedule(speaker);
      },
    });
    speaker.socket.start();
    this.schedule(speaker);
  }

  disconnect(speaker) {
    speaker.socket?.stop();
    speaker.socket = null;
    clearTimeout(speaker.timer);
    speaker.timer = null;
    speaker.timerMs = null;
    clearTimeout(speaker.debounceTimer);
    speaker.debounceTimer = null;
  }

  /**
   * The integration's own refresh timer: every `checkMs` while the
   * WebSocket is up, every `fallbackPollMs` while it is down.
   */
  schedule(speaker) {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    const period = speaker.socket?.connected ? this.timings.checkMs : this.timings.fallbackPollMs;
    if (speaker.timer && speaker.timerMs === period) {
      return;
    }
    clearTimeout(speaker.timer);
    speaker.timerMs = period;
    speaker.timer = setTimeout(async () => {
      speaker.timer = null;
      speaker.timerMs = null;
      await this.track(this.refresh(speaker));
      this.schedule(speaker);
    }, period);
    speaker.timer.unref?.();
  }

  /**
   * Read everything over HTTP and publish what changed. Concurrent callers
   * share the refresh in progress. Never throws: a speaker that does not
   * answer is flagged unreachable.
   */
  refresh(speaker) {
    if (!speaker.refreshing) {
      speaker.refreshing = this.doRefresh(speaker).finally(() => {
        speaker.refreshing = null;
      });
    }
    return speaker.refreshing;
  }

  async doRefresh(speaker) {
    let snapshot;
    try {
      snapshot = await speaker.client.getSnapshot();
    } catch (err) {
      logger.debug(`Refresh of ${speaker.host} failed: ${err.message}`);
      if (err.unreachable) {
        // A link still "open" to a speaker that no longer answers is dead.
        if (speaker.socket?.connected) {
          speaker.socket.restart();
        }
        await this.reachabilityChanged(speaker, false);
      } else {
        this.issues.fail(
          `read:${speaker.id}`,
          `${speaker.info?.name}: unexpected answer (${err.message})`,
        );
      }
      return;
    }
    if (snapshot.info.id !== speaker.id) {
      // Another speaker took this address (DHCP): find both again.
      logger.debug(`${speaker.host} now answers as ${snapshot.info.id}: new scan`);
      await this.reachabilityChanged(speaker, false);
      this.track(this.rediscover());
      return;
    }
    this.issues.recover(`read:${speaker.id}`, `${speaker.info?.name}: answers normally again`);
    const previous = speaker.nowPlaying;
    const presetsBefore = JSON.stringify(speaker.presets);
    const infoBefore = JSON.stringify(speaker.info);
    this.applySnapshot(speaker, snapshot);
    await this.reachabilityChanged(speaker, true);
    await this.afterChange(speaker, {
      previous,
      catalogChanged:
        presetsBefore !== JSON.stringify(speaker.presets) ||
        infoBefore !== JSON.stringify(speaker.info),
    });
  }

  /**
   * One WebSocket message. Volume, now playing and presets come with the
   * message; zone, name and sources are read again over HTTP.
   */
  receive(speaker, text) {
    let update;
    try {
      update = parseUpdate(text);
    } catch (err) {
      logger.debug(`${speaker.host}: unreadable notification ignored (${err.message})`);
      return;
    }
    if (update.deviceId && update.deviceId !== speaker.id) {
      // A group leader relays its members' changes: not this speaker's.
      return;
    }
    if (!speaker.reachable) {
      this.track(this.reachabilityChanged(speaker, true));
    }
    logger.debug(`${speaker.info?.name ?? speaker.host}: ${update.kind} notification`);
    switch (update.kind) {
      case 'volume':
        if (update.payload) {
          speaker.volume = update.payload;
          this.changedSoon(speaker);
        }
        break;
      case 'nowPlaying':
        if (update.payload) {
          this.track(this.nowPlayingChanged(speaker, update.payload));
        }
        break;
      case 'presets':
        if (update.payload) {
          speaker.presets = update.payload;
          this.track(this.afterChange(speaker, { catalogChanged: true }));
        }
        break;
      case 'zone':
        this.track(this.zoneChanged(speaker));
        break;
      case 'info':
      case 'sources':
        this.track(this.refresh(speaker));
        break;
      default:
        break;
    }
  }

  /**
   * A new now playing, read or pushed (`merge`: a push, possibly partial).
   * Keeps the position bookkeeping of positionOf.
   */
  setNowPlaying(speaker, next, { merge = false } = {}) {
    speaker.nowPlaying = merge ? mergeNowPlaying(speaker.nowPlaying, next) : next;
    const identity = trackIdentity(speaker.nowPlaying);
    if (identity !== speaker.trackIdentity) {
      speaker.trackIdentity = identity;
      speaker.trackStart = Date.now();
    }
    if (next.position !== null) {
      speaker.sampledAt = Date.now();
    }
  }

  async nowPlayingChanged(speaker, nowPlaying) {
    const previous = speaker.nowPlaying;
    this.setNowPlaying(speaker, nowPlaying, { merge: true });
    this.firePresetTrigger(speaker, previous);
    this.changedSoon(speaker);
  }

  async zoneChanged(speaker) {
    try {
      speaker.zone = await speaker.client.getZone();
      speaker.zoneKnown = true;
    } catch (err) {
      logger.debug(`Zone of ${speaker.host} unreadable: ${err.message}`);
      return;
    }
    // The other members' texts name this speaker's group too.
    for (const other of this.speakers.values()) {
      this.changedSoon(other);
    }
  }

  /** Publish soon: pushes closer than `debounceMs` are published together. */
  changedSoon(speaker) {
    if (this.timings.debounceMs <= 0) {
      this.track(this.publishStates(speaker));
      return;
    }
    if (!speaker.debounceTimer) {
      speaker.debounceTimer = setTimeout(() => {
        speaker.debounceTimer = null;
        this.track(this.publishStates(speaker));
      }, this.timings.debounceMs);
    }
  }

  async afterChange(speaker, { previous, catalogChanged = false } = {}) {
    if (previous !== undefined) {
      this.firePresetTrigger(speaker, previous);
    }
    if (catalogChanged) {
      // New preset names reach the created device through a new publication
      // (its select options are upserted).
      await this.publishDevices();
      await this.save();
      this.requestWidgetRefresh();
    }
    await this.publishStates(speaker);
  }

  /**
   * A preset started (from the speaker, the remote or the Bose app): fire
   * the scene trigger, unless Gladys itself asked for it a moment ago.
   */
  firePresetTrigger(speaker, previous) {
    if (!previous) {
      return;
    }
    const before = activePreset(previous, speaker.presets);
    const after = activePreset(speaker.nowPlaying, speaker.presets);
    if (!after || after.id === before?.id) {
      return;
    }
    if (
      speaker.ownCommandAt !== null &&
      this.now() - speaker.ownCommandAt < this.timings.ownCommandMs
    ) {
      // Started by Gladys: an event here could loop through a scene.
      return;
    }
    this.track(
      this.toGladys('publishSceneEvent', PRESET_TRIGGER, {
        device: speakerIds(this.gladys, speaker).device,
        preset: after.id,
        preset_name: after.name ?? presetLabel(after, this.config.language),
      }),
    );
  }

  // --- Commands --------------------------------------------------------------

  /** Run one command on the speaker; refresh when no push will bring the result. */
  async run(speaker, command, { own = false } = {}) {
    if (own) {
      speaker.ownCommandAt = this.now();
    }
    try {
      if (command.key) {
        await speaker.client.sendKey(command.key);
      } else if (command.volume !== undefined) {
        await speaker.client.setVolume(command.volume);
      } else if (command.preset) {
        await speaker.client.selectPreset(command.preset);
      } else if (command.input) {
        await speaker.client.selectSource(command.input.source, command.input.account);
      } else if (command.url) {
        await speaker.client.playUrl(command.url);
      }
    } catch (err) {
      if (err.unreachable) {
        await this.reachabilityChanged(speaker, false);
      }
      throw err;
    }
    await this.reachabilityChanged(speaker, true);
    if (!speaker.socket?.connected) {
      const later = () => this.track(this.refresh(speaker));
      if (this.timings.afterCommandMs <= 0) {
        await later();
      } else {
        setTimeout(later, this.timings.afterCommandMs).unref?.();
      }
    }
  }

  /** One read for a command, flagging the speaker unreachable when it does not answer. */
  async read(speaker, call) {
    try {
      return await call();
    } catch (err) {
      if (err.unreachable) {
        await this.reachabilityChanged(speaker, false);
      }
      throw err;
    }
  }

  /** A Gladys command on a feature of a speaker device. */
  async setValue(device, feature, value) {
    const speaker = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    if (key === FEATURE_KEYS.MUTE) {
      // MUTE toggles: decide on the speaker's state of now, not a stale one.
      speaker.volume = await this.read(speaker, () => speaker.client.getVolume());
    }
    const command = commandFor(speaker, key, value);
    logger.info(`${speaker.info.name}: ${key} ← ${value}`);
    if (command === null) {
      // Already in that state, or "Other" picked: show the real state back.
      this.gladys.forgetPublishedStates(device.external_id);
      await this.publishStates(speaker);
      return;
    }
    const own = [FEATURE_KEYS.POWER, FEATURE_KEYS.SOURCE].includes(key);
    await this.run(speaker, command, { own });
  }

  // --- Music panel (presets) -------------------------------------------------------

  /** onMusicBrowse: the stored presets, at the root (nothing below). */
  browse(device, { parentId, offset = 0, limit = 100 } = {}) {
    const speaker = this.require(device?.external_id);
    if (parentId !== null && parentId !== undefined) {
      return { items: [], total: 0 };
    }
    const items = presetItems(this.gladys, speaker.presets, this.config.language);
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  /** onMusicPlay: a preset (the only media the catalog hands out). */
  async playMedia(device, media) {
    const number = presetNumberOf(media?.id);
    if (number === null) {
      throw new Error(`Unknown media ${String(media?.id).slice(0, 60)}`);
    }
    await this.playPreset(device?.external_id, number);
  }

  /** Gladys poll (fallback: these devices have should_poll: false). */
  async poll(device) {
    const speaker = this.resolveDevice(device?.external_id);
    if (speaker) {
      await this.refresh(speaker);
    }
  }

  /**
   * Play a stored preset (1 to 6).
   * @returns {object} the preset played
   */
  async playPreset(deviceExternalId, presetId) {
    const speaker = this.require(deviceExternalId);
    const id = Number(presetId);
    const preset = (speaker.presets ?? []).find((item) => item.id === id);
    if (!preset) {
      throw new Error(`Preset ${presetId} is empty on ${speaker.info.name}`);
    }
    logger.info(`${speaker.info.name}: preset ${id}`);
    await this.run(speaker, { preset }, { own: true });
    return preset;
  }

  /** Play an http:// address through the speaker's UPnP renderer. */
  async playUrl(deviceExternalId, url, volume) {
    const speaker = this.require(deviceExternalId);
    const address = String(url ?? '').trim();
    if (!/^http:\/\/[^\s/]+/i.test(address)) {
      throw new Error('The speaker only plays http:// addresses (no https)');
    }
    logger.info(`${speaker.info.name}: playing an address`);
    if (volume !== undefined && volume !== null && volume !== '') {
      await this.run(speaker, commandFor(speaker, FEATURE_KEYS.VOLUME, volume));
    }
    await this.run(speaker, { url: address }, { own: true });
  }

  /** Play / pause from the widget (one key, whatever the cached widget shows). */
  async playPause(deviceExternalId) {
    const speaker = this.require(deviceExternalId);
    logger.info(`${speaker.info.name}: play/pause`);
    await this.run(speaker, { key: KEYS.PLAY_PAUSE });
  }

  require(deviceExternalId) {
    const speaker = this.resolveDevice(deviceExternalId);
    if (!speaker) {
      throw new Error(`Unknown SoundTouch device ${deviceExternalId}`);
    }
    if (!speaker.info) {
      throw new Error(`${speaker.host} has not answered yet`);
    }
    return speaker;
  }

  /** What the Configuration screen's "Search" action reports. */
  summary() {
    return {
      mdns: this.lastScan.mdns,
      invalidHosts: this.config.invalidHosts,
      speakers: [...this.speakers.values()]
        .filter((speaker) => speaker.info)
        .map((speaker) => ({
          name: speaker.info.name,
          model: speaker.info.type,
          host: speaker.host,
          reachable: speaker.reachable,
          live: Boolean(speaker.socket?.connected),
          on: isOn(speaker.nowPlaying),
          source: speaker.nowPlaying ? sourceValue(speaker) : null,
        })),
    };
  }
}
